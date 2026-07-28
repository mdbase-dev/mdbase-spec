#!/usr/bin/env python3
"""Validate the parallel mdbase v0.3 conformance suite.

This is not a v0.3 implementation adapter. It checks suite structure and executes
artifact-level tests that can run directly in this repository:

- JSON Schema files validate against Draft 2020-12
- Markdown frontmatter validates against selected schemas
- embedded JSON Schemas validate against Draft 2020-12
- JSON documents parse and optionally validate against schemas
- YAML documents parse and optionally validate against schemas
- simple YAML pointer presence checks
- the TaskNotes migration prototype can satisfy fixture report assertions

Adapter-target tests for core collection behavior, lifecycle, CEL, and runtime
execution are shape-checked but not executed here.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
except ImportError:
    print("PyYAML is required. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("jsonschema is required. Install with: pip install jsonschema", file=sys.stderr)
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
TEST_ROOT = REPO_ROOT / "tests" / "v0.3"

EXECUTABLE_OPERATIONS = {
    "json_schema_meta_validate",
    "markdown_frontmatter_schema_validate",
    "embedded_json_schema_validate",
    "json_document_schema_validate",
    "yaml_document_schema_validate",
    "json_document_valid",
    "inspect_yaml",
    "migrate_type",
    "type_pack_resources_validate",
    "install_type_pack",
    "data_contract_implementation_validate",
    "data_contract_digest",
    "data_contract_implementation_digest",
    "data_contract_registry_validate",
}

CONFORMANCE_PROFILES = {
    "core_read",
    "collection_semantics",
    "cel",
    "cel_match",
    "cel_query",
    "links",
    "core_write",
    "lifecycle",
    "runtime_contracts/0.1",
    "workflow/0.1",
    "watch",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate mdbase v0.3 conformance fixtures")
    parser.add_argument(
        "--execute-only",
        action="store_true",
        help="fail if a test uses an operation this script cannot execute",
    )
    args = parser.parse_args()

    errors: list[str] = []
    executed = 0
    skipped = 0

    manifest_path = TEST_ROOT / "manifest.yaml"
    fixture_sets, claim_requirements, coverage_complete = validate_manifest(manifest_path, errors)
    referenced_files = {
        file_name
        for fixture_set in fixture_sets.values()
        for file_name in fixture_set.get("files", []) or []
    }
    covered_requirements: set[str] = set()
    test_ids: set[str] = set()

    for suite_path in sorted(TEST_ROOT.glob("**/*.yaml")):
        if suite_path == manifest_path:
            continue
        suite = load_yaml(suite_path)
        relative_path = suite_path.relative_to(TEST_ROOT).as_posix()
        validate_suite_shape(
            suite_path,
            suite,
            fixture_sets,
            relative_path,
            claim_requirements,
            covered_requirements,
            test_ids,
            errors,
        )
        if relative_path not in referenced_files:
            errors.append(f"{suite_path}: suite is not referenced by manifest.yaml")
        for group in suite.get("groups", []) or []:
            for test in group.get("tests", []) or []:
                operation = test.get("operation")
                if operation in EXECUTABLE_OPERATIONS:
                    try:
                        run_executable_test(test, group.get("setup") or {})
                        executed += 1
                    except Exception as exc:  # noqa: BLE001 - diagnostic script should report all failures uniformly.
                        errors.append(f"{suite_path}: {test.get('name', '<unnamed>')}: {exc}")
                else:
                    skipped += 1
                    if args.execute_only:
                        errors.append(f"{suite_path}: unsupported executable operation {operation!r}")

    for profile_id, requirements in coverage_complete.items():
        missing = sorted(requirements - covered_requirements)
        if missing:
            errors.append(
                f"{manifest_path}: coverage_complete profile {profile_id} has uncovered requirements: {missing}"
            )

    if errors:
        print("\n".join(errors), file=sys.stderr)
        print(f"v0.3 suite check failed: {len(errors)} error(s), {executed} executable test(s), {skipped} adapter-target test(s)", file=sys.stderr)
        return 1

    print(f"v0.3 suite ok: {executed} executable test(s), {skipped} adapter-target test(s)")
    return 0


def validate_manifest(
    path: Path, errors: list[str]
) -> tuple[dict[str, dict[str, Any]], set[str], dict[str, set[str]]]:
    manifest = load_yaml(path)
    if manifest.get("spec_version") != "0.3.0":
        errors.append(f"{path}: manifest spec_version must be 0.3.0")
    fixture_sets = manifest.get("fixture_sets")
    if not isinstance(fixture_sets, list) or not fixture_sets:
        errors.append(f"{path}: manifest fixture_sets must be a non-empty list")
        fixture_sets = []
    claim_requirements, coverage_complete = validate_claim_profiles(path, manifest, errors)
    by_id: dict[str, dict[str, Any]] = {}
    referenced_files: set[str] = set()
    for fixture_set in fixture_sets:
        fixture_set_id = fixture_set.get("id")
        if not isinstance(fixture_set_id, str) or not fixture_set_id:
            errors.append(f"{path}: every fixture set must have a non-empty id")
            continue
        if fixture_set_id in by_id:
            errors.append(f"{path}: duplicate fixture set id: {fixture_set_id}")
        by_id[fixture_set_id] = fixture_set
        targets = fixture_set.get("coverage_targets")
        if not isinstance(targets, list):
            errors.append(f"{path}: fixture set {fixture_set_id} coverage_targets must be a list")
        else:
            unknown = sorted(set(targets) - CONFORMANCE_PROFILES)
            if unknown:
                errors.append(f"{path}: fixture set {fixture_set_id} has unknown coverage targets: {unknown}")
        files = fixture_set.get("files")
        if not isinstance(files, list) or not files:
            errors.append(f"{path}: fixture set {fixture_set_id} files must be a non-empty list")
            continue
        for file_name in files:
            if not (TEST_ROOT / file_name).exists():
                errors.append(f"{path}: referenced test file does not exist: {file_name}")
            if file_name in referenced_files:
                errors.append(f"{path}: test file is referenced more than once: {file_name}")
            referenced_files.add(file_name)
    return by_id, claim_requirements, coverage_complete


def validate_claim_profiles(
    path: Path, manifest: dict[str, Any], errors: list[str]
) -> tuple[set[str], dict[str, set[str]]]:
    profiles = manifest.get("claim_profiles")
    if not isinstance(profiles, list):
        errors.append(f"{path}: claim_profiles must be a list")
        return set(), {}
    by_id = {
        profile.get("id"): profile
        for profile in profiles
        if isinstance(profile, dict) and isinstance(profile.get("id"), str)
    }
    missing_profiles = sorted(CONFORMANCE_PROFILES - set(by_id))
    unknown_profiles = sorted(set(by_id) - CONFORMANCE_PROFILES)
    if missing_profiles:
        errors.append(f"{path}: missing claim profile definitions: {missing_profiles}")
    if unknown_profiles:
        errors.append(f"{path}: unknown claim profile definitions: {unknown_profiles}")

    known_requirements: set[str] = set()
    coverage_complete: dict[str, set[str]] = {}
    for profile_id, profile in by_id.items():
        status = profile.get("status")
        if status not in {"draft", "coverage_complete"}:
            errors.append(f"{path}: claim profile {profile_id} has invalid status {status!r}")
        requires = profile.get("requires")
        if not isinstance(requires, list):
            errors.append(f"{path}: claim profile {profile_id} requires must be a list")
        else:
            unknown_dependencies = sorted(set(requires) - CONFORMANCE_PROFILES)
            if unknown_dependencies:
                errors.append(
                    f"{path}: claim profile {profile_id} has unknown dependencies: {unknown_dependencies}"
                )
        requirements = profile.get("requirements")
        if not isinstance(requirements, list):
            errors.append(f"{path}: claim profile {profile_id} requirements must be a list")
            continue
        qualified = {f"{profile_id}.{requirement}" for requirement in requirements}
        if len(qualified) != len(requirements):
            errors.append(f"{path}: claim profile {profile_id} has duplicate requirements")
        known_requirements.update(qualified)
        if status == "coverage_complete":
            if not requirements:
                errors.append(
                    f"{path}: coverage_complete profile {profile_id} must declare requirements"
                )
            coverage_complete[profile_id] = qualified
    return known_requirements, coverage_complete


def validate_suite_shape(
    path: Path,
    suite: dict[str, Any],
    fixture_sets: dict[str, dict[str, Any]],
    relative_path: str,
    claim_requirements: set[str],
    covered_requirements: set[str],
    test_ids: set[str],
    errors: list[str],
) -> None:
    required = ["name", "spec_version", "fixture_set", "category", "spec_ref", "groups"]
    for key in required:
        if key not in suite:
            errors.append(f"{path}: missing required top-level key {key}")
    if suite.get("spec_version") != "0.3.0":
        errors.append(f"{path}: spec_version must be 0.3.0")
    fixture_set_id = suite.get("fixture_set")
    fixture_set = fixture_sets.get(fixture_set_id)
    if fixture_set is None:
        errors.append(f"{path}: unknown fixture_set {fixture_set_id!r}")
    elif relative_path not in (fixture_set.get("files") or []):
        errors.append(f"{path}: fixture_set {fixture_set_id!r} does not reference this suite")
    groups = suite.get("groups")
    if not isinstance(groups, list) or not groups:
        errors.append(f"{path}: groups must be a non-empty list")
        return
    for group_index, group in enumerate(groups):
        if "name" not in group:
            errors.append(f"{path}: group {group_index} missing name")
        validate_setup_artifacts(path, group, errors)
        tests = group.get("tests")
        if not isinstance(tests, list) or not tests:
            errors.append(f"{path}: group {group.get('name', group_index)!r} has no tests")
            continue
        for test_index, test in enumerate(tests):
            for key in ["name", "operation", "input", "expect"]:
                if key not in test:
                    errors.append(f"{path}: test {test_index} in group {group.get('name', group_index)!r} missing {key}")
            covers = test.get("covers")
            if covers is None:
                continue
            if not isinstance(covers, list) or not covers:
                errors.append(
                    f"{path}: test {test.get('name', test_index)!r} covers must be a non-empty list"
                )
                continue
            test_id = test.get("id")
            if not isinstance(test_id, str) or not test_id:
                errors.append(f"{path}: covered test {test_index} must have a non-empty id")
            elif test_id in test_ids:
                errors.append(f"{path}: duplicate test id: {test_id}")
            else:
                test_ids.add(test_id)
            unknown_requirements = sorted(set(covers) - claim_requirements)
            if unknown_requirements:
                errors.append(
                    f"{path}: test {test_id or test_index} covers unknown requirements: {unknown_requirements}"
                )
            covered_requirements.update(set(covers) & claim_requirements)


def validate_setup_artifacts(path: Path, group: dict[str, Any], errors: list[str]) -> None:
    setup = group.get("setup") or {}
    for artifact_kind, identity_key in (("types", "name"), ("contracts", "id")):
        artifacts = setup.get(artifact_kind) or {}
        if not isinstance(artifacts, dict):
            errors.append(
                f"{path}: group {group.get('name')!r} setup.{artifact_kind} must be a mapping"
            )
            continue
        for file_name, content in artifacts.items():
            if not isinstance(content, str):
                errors.append(f"{path}: setup {artifact_kind} {file_name} content must be a string")
                continue
            label = f"{path}: setup {artifact_kind} {file_name}"
            try:
                if str(file_name).endswith(".md"):
                    frontmatter = parse_markdown_frontmatter_text(content, label)
                    if not isinstance(frontmatter.get(identity_key), str) or not frontmatter[identity_key]:
                        errors.append(
                            f"{label}: missing non-empty frontmatter {identity_key}"
                        )
                elif str(file_name).endswith(".json"):
                    parsed = json.loads(content)
                    if not isinstance(parsed, dict):
                        errors.append(f"{label}: JSON schema fixture must be an object")
            except (ValueError, json.JSONDecodeError, yaml.YAMLError) as error:
                errors.append(f"{label}: {error}")


def run_executable_test(test: dict[str, Any], setup: dict[str, Any] | None = None) -> None:
    operation = test["operation"]
    input_data = test.get("input") or {}
    expect = test.get("expect") or {}
    setup = setup or {}

    if operation == "json_schema_meta_validate":
        for path in expand_paths(input_data.get("paths", [])):
            Draft202012Validator.check_schema(load_json(path))
        assert_valid(expect)
        return

    if operation == "markdown_frontmatter_schema_validate":
        schema = load_json(resolve(input_data["schema"]))
        validator = Draft202012Validator(schema)
        for path in expand_paths(input_data.get("paths", [])):
            errors = list(validator.iter_errors(load_markdown_frontmatter(path)))
            assert_document_schema_result(path, errors, expect)
        return

    if operation == "embedded_json_schema_validate":
        pointers = input_data.get("pointers") or [input_data.get("pointer", "/schema/value")]
        for path in expand_paths(input_data.get("paths", [])):
            frontmatter = load_markdown_frontmatter(path)
            for pointer in pointers:
                embedded = get_pointer(frontmatter, pointer)
                Draft202012Validator.check_schema(embedded)
        assert_valid(expect)
        return

    if operation == "json_document_schema_validate":
        schema = load_json(resolve(input_data["schema"]))
        validator = Draft202012Validator(schema)
        for path in expand_paths(input_data.get("paths", [])):
            errors = list(validator.iter_errors(load_json(path)))
            assert_document_schema_result(path, errors, expect)
        return

    if operation == "yaml_document_schema_validate":
        schema = load_json(resolve(input_data["schema"]))
        validator = Draft202012Validator(schema)
        for path in expand_paths(input_data.get("paths", [])):
            errors = list(validator.iter_errors(load_yaml(path)))
            assert_document_schema_result(path, errors, expect)
        return

    if operation == "json_document_valid":
        for path in expand_paths(input_data.get("paths", [])):
            load_json(path)
        assert_valid(expect)
        return

    if operation == "inspect_yaml":
        data = load_markdown_frontmatter(resolve(input_data["path"]))
        for pointer in expect.get("has", []) or []:
            get_pointer(data, pointer)
        for pointer in expect.get("not_has", []) or []:
            if pointer_exists(data, pointer):
                raise AssertionError(f"unexpected pointer exists: {pointer}")
        return

    if operation == "migrate_type":
        run_migrate_type_test(input_data, expect, setup)
        return

    if operation == "type_pack_resources_validate":
        run_type_pack_resources_test(input_data, expect)
        return

    if operation == "install_type_pack":
        run_install_type_pack_test(input_data, expect, setup)
        return

    if operation == "data_contract_implementation_validate":
        run_data_contract_implementation_test(input_data, expect)
        return

    if operation == "data_contract_digest":
        contract = load_markdown_frontmatter(input_data["contract"])
        actual = data_contract_digest(contract)
        if expect.get("digest") != actual:
            raise AssertionError(f"expected digest {expect.get('digest')!r}, got {actual!r}")
        return

    if operation == "data_contract_implementation_digest":
        contract = load_markdown_frontmatter(input_data["contract"])
        type_file = load_markdown_frontmatter(input_data["type"])
        matching = [
            entry
            for entry in type_file.get("implements", []) or []
            if entry.get("contract") == contract.get("id")
            and entry.get("version") == contract.get("version")
        ]
        if len(matching) != 1:
            raise AssertionError("type must have one exact implementation")
        actual = data_contract_implementation_digest(contract, type_file, matching[0])
        if expect.get("digest") != actual:
            raise AssertionError(f"expected digest {expect.get('digest')!r}, got {actual!r}")
        return

    if operation == "data_contract_registry_validate":
        failures: list[str] = []
        registry: dict[tuple[str, str], str] = {}
        for contract_path in expand_paths(input_data.get("paths", [])):
            contract = load_markdown_frontmatter(contract_path)
            key = (contract.get("id"), contract.get("version"))
            digest = data_contract_digest(contract)
            existing = registry.get(key)
            if existing is not None and existing != digest:
                failures.append(f"data contract conflict for {key[0]}@{key[1]}")
            registry[key] = digest
        assert_expected_validation_result(failures, expect)
        return

    raise AssertionError(f"unsupported operation: {operation}")


def assert_valid(expect: dict[str, Any]) -> None:
    if expect.get("valid") is False:
        raise AssertionError("test expected invalid result, but executable artifact check only supports valid=true cases")


def assert_document_schema_result(path: Path, errors: list[Any], expect: dict[str, Any]) -> None:
    if expect.get("valid") is False:
        if not errors:
            raise AssertionError(f"{path}: expected schema validation to fail")
        return
    if errors:
        raise AssertionError(format_schema_errors(path, errors))


def run_migrate_type_test(input_data: dict[str, Any], expect: dict[str, Any], setup: dict[str, Any]) -> None:
    if input_data.get("mode") != "dry_run":
        raise AssertionError("prototype migrate_type executable only supports dry_run mode")

    import prototype_tasknotes_v03_migration as tasknotes_migration  # type: ignore[import-not-found]

    fixture_root = resolve(setup.get("expected_report", "examples/v0.3/tasknotes-migration/migration-report.json")).parent
    source = resolve(input_data["source"])
    if not source.exists():
        source = fixture_root / input_data["source"]
    old = tasknotes_migration.read_markdown_frontmatter(source)
    migrated = tasknotes_migration.migrate_tasknotes_type(old)
    tasknotes_migration.validate_type_file(migrated)
    report = tasknotes_migration.build_report(old, migrated)

    if expect.get("valid") is not None and expect["valid"] is not True:
        raise AssertionError("prototype migrate_type executable only supports valid=true fixture checks")
    if expect.get("detected_source_version") and expect["detected_source_version"] != "0.2.1":
        raise AssertionError("detected_source_version mismatch")
    if expect.get("detected_generator") and expect["detected_generator"] != "tasknotes":
        raise AssertionError("detected_generator mismatch")
    if subset := expect.get("report_contains"):
        assert_subset(report, subset)


def run_type_pack_resources_test(input_data: dict[str, Any], expect: dict[str, Any]) -> None:
    manifest_path = resolve(input_data["path"])
    manifest = load_yaml(manifest_path)
    failures: list[str] = []
    seen_targets: set[str] = set()

    for resource in manifest.get("resources", []) or []:
        source = resource.get("source")
        target = resource.get("target")
        declared = resource.get("digest")
        if not isinstance(source, str) or not isinstance(target, str) or not isinstance(declared, str):
            failures.append("resource is missing source, target, or digest")
            continue
        if target in seen_targets:
            failures.append(f"duplicate target: {target}")
        seen_targets.add(target)
        source_path = (manifest_path.parent / source).resolve()
        try:
            source_path.relative_to(manifest_path.parent.resolve())
        except ValueError:
            failures.append(f"source escapes pack root: {source}")
            continue
        if not source_path.is_file():
            failures.append(f"source does not exist: {source}")
            continue
        actual = "sha256:" + hashlib.sha256(source_path.read_bytes()).hexdigest()
        if actual != declared:
            failures.append(f"digest mismatch for {source}: expected {declared}, got {actual}")

    assert_expected_validation_result(failures, expect)


def run_install_type_pack_test(
    input_data: dict[str, Any], expect: dict[str, Any], setup: dict[str, Any]
) -> None:
    """Simulate the normative preflight/diff/atomicity rules without an engine."""
    manifest_path = resolve(input_data["pack"])
    manifest = load_yaml(manifest_path)
    resources = manifest.get("resources", []) or []
    live = {
        str(target): str(content).encode()
        for target, content in (setup.get("files") or {}).items()
    }
    corrupt_digest = input_data.get("corrupt_digest") is True
    runs: list[dict[str, Any]] = []

    for _ in range(int(input_data.get("repeat", 1))):
        planned: list[tuple[str, bytes, str]] = []
        error: dict[str, str] | None = None
        seen_sources: set[str] = set()
        seen_targets: set[str] = set()
        for index, resource in enumerate(resources):
            source = resource.get("source")
            target = resource.get("target")
            digest = resource.get("digest")
            if not all(isinstance(value, str) for value in (source, target, digest)):
                error = {"code": "invalid_type_pack", "message": "incomplete resource"}
                break
            if source in seen_sources or target in seen_targets:
                error = {"code": "invalid_type_pack", "message": "duplicate resource"}
                break
            seen_sources.add(source)
            seen_targets.add(target)
            source_path = (manifest_path.parent / source).resolve()
            try:
                source_path.relative_to(manifest_path.parent.resolve())
            except ValueError:
                error = {"code": "invalid_type_pack", "message": "unsafe source"}
                break
            if not source_path.is_file():
                error = {"code": "invalid_type_pack", "message": "missing source"}
                break
            document = source_path.read_bytes()
            actual_digest = "sha256:" + hashlib.sha256(document).hexdigest()
            declared_digest = (
                "sha256:" + ("0" * 64) if corrupt_digest and index == 0 else digest
            )
            if actual_digest != declared_digest:
                error = {"code": "invalid_type_pack", "message": "digest mismatch"}
                break
            action = (
                "create"
                if target not in live
                else "unchanged"
                if live[target] == document
                else "replace"
            )
            planned.append((target, document, action))

        if error is None and len(planned) != len(resources):
            error = {"code": "invalid_type_pack", "message": "incomplete pack"}
        if error is None and any(action == "replace" for _, _, action in planned):
            error = {"code": "type_pack_conflict", "message": "target conflict"}

        if error is not None:
            runs.append({"valid": False, "actions": [], "error": error})
            break

        for target, document, _ in planned:
            live[target] = document
        runs.append(
            {
                "valid": True,
                "actions": [action for _, _, action in planned],
            }
        )

    implementation_count = 0
    for target, document in live.items():
        if not target.startswith("_types/") or not target.endswith(".md"):
            continue
        try:
            frontmatter = parse_markdown_frontmatter_text(document.decode(), target)
        except (UnicodeDecodeError, ValueError, yaml.YAMLError):
            continue
        implementation_count += sum(
            1
            for implementation in frontmatter.get("implements", []) or []
            if implementation.get("contract") == "tasknotes.task"
            and implementation.get("version") == "0.2.0"
        )

    last = runs[-1]
    actual = {
        "valid": last["valid"],
        "runs": runs,
        "implementations": implementation_count,
        "targets_exist": [
            resource.get("target") in live for resource in resources
        ],
    }
    if "error" in last:
        actual["error"] = last["error"]
    assert_subset(actual, expect)


def run_data_contract_implementation_test(
    input_data: dict[str, Any], expect: dict[str, Any]
) -> None:
    failures: list[str] = []
    contract = load_markdown_frontmatter(input_data["contract"])
    type_file = load_markdown_frontmatter(input_data["type"])

    contract_meta = Draft202012Validator(load_json("schemas/v0.3/data-contract.schema.json"))
    type_meta = Draft202012Validator(load_json("schemas/v0.3/type-file.schema.json"))
    failures.extend(error.message for error in contract_meta.iter_errors(contract))
    failures.extend(error.message for error in type_meta.iter_errors(type_file))
    if failures:
        assert_expected_validation_result(failures, expect)
        return

    contract_schema = get_pointer(contract, "/schema/value")
    Draft202012Validator.check_schema(contract_schema)
    binding_schema = contract.get("binding_schema", {}).get("value")
    if binding_schema is not None:
        Draft202012Validator.check_schema(binding_schema)

    matching = [
        entry
        for entry in type_file.get("implements", []) or []
        if entry.get("contract") == contract.get("id")
        and entry.get("version") == contract.get("version")
    ]
    if len(matching) != 1:
        failures.append(
            "type must contain exactly one implementation for the contract ID and version"
        )
        assert_expected_validation_result(failures, expect)
        return

    implementation = matching[0]
    fields = implementation.get("fields") or {}
    required = contract_schema.get("required") or []
    for field_name in required:
        if field_name not in fields:
            failures.append(f"required contract field is not mapped: {field_name}")

    for contract_field, record_field in fields.items():
        if not schema_declares_field(contract_schema, contract_field):
            failures.append(f"contract field is not declared: {contract_field}")
        type_schema = get_pointer(type_file, "/schema/value")
        if not schema_declares_field(type_schema, record_field):
            failures.append(f"record field is not declared: {record_field}")

    binding = implementation.get("binding") or {}
    if binding_schema is None:
        if binding:
            failures.append("binding is non-empty but contract has no binding_schema")
    else:
        failures.extend(
            f"binding: {error.message}"
            for error in Draft202012Validator(binding_schema).iter_errors(binding)
        )

    record_path = input_data.get("record")
    if record_path and not failures:
        record_path = resolve(record_path)
        if record_path.suffix.lower() == ".md":
            record = load_markdown_frontmatter(record_path)
        else:
            record = load_yaml(record_path)
        view = {
            contract_field: record[record_field]
            for contract_field, record_field in fields.items()
            if "." not in contract_field
            and "[]" not in contract_field
            and "." not in record_field
            and "[]" not in record_field
            and record_field in record
        }
        failures.extend(
            f"record: {error.message}"
            for error in Draft202012Validator(contract_schema).iter_errors(view)
        )

    assert_expected_validation_result(failures, expect)


def data_contract_digest(contract: dict[str, Any]) -> str:
    payload = {
        key: contract[key]
        for key in ("kind", "id", "version")
        if key in contract
    }
    if "schema" in contract:
        schema = contract["schema"]
        payload["schema"] = (
            schema["value"]
            if isinstance(schema, dict) and "value" in schema
            else schema
        )
    if "binding_schema" in contract:
        binding_schema = contract["binding_schema"]
        payload["binding_schema"] = (
            binding_schema["value"]
            if isinstance(binding_schema, dict) and "value" in binding_schema
            else binding_schema
        )
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def data_contract_implementation_digest(
    contract: dict[str, Any],
    type_file: dict[str, Any],
    implementation: dict[str, Any],
) -> str:
    type_semantics = {
        key: type_file[key]
        for key in ("name", "version", "match", "schema", "collection", "lifecycle")
        if key in type_file
    }
    payload = {
        "contract_digest": data_contract_digest(contract),
        "type": type_semantics,
        "implementation": implementation,
    }
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def schema_declares_field(schema: dict[str, Any], field_path: str) -> bool:
    current: Any = schema
    for part in field_path.replace("[]", "").split("."):
        properties = current.get("properties") if isinstance(current, dict) else None
        if not isinstance(properties, dict) or part not in properties:
            return False
        current = properties[part]
        if "[]" in field_path and isinstance(current, dict) and "items" in current:
            current = current["items"]
    return True


def assert_expected_validation_result(failures: list[str], expect: dict[str, Any]) -> None:
    if expect.get("valid") is False:
        if not failures:
            raise AssertionError("expected validation to fail")
        expected_contains = expect.get("error_contains")
        if expected_contains and not any(expected_contains in failure for failure in failures):
            raise AssertionError(
                f"expected an error containing {expected_contains!r}, got {failures!r}"
            )
        return
    if failures:
        raise AssertionError("; ".join(failures))


def assert_subset(actual: Any, expected_subset: Any) -> None:
    if isinstance(expected_subset, dict):
        if not isinstance(actual, dict):
            raise AssertionError(f"expected mapping subset {expected_subset!r}, got {actual!r}")
        for key, value in expected_subset.items():
            if key not in actual:
                raise AssertionError(f"missing key in actual value: {key}")
            assert_subset(actual[key], value)
        return

    if isinstance(expected_subset, list):
        if not isinstance(actual, list):
            raise AssertionError(f"expected list subset {expected_subset!r}, got {actual!r}")
        for expected_item in expected_subset:
            if isinstance(expected_item, (dict, list)):
                if not any(subset_matches(actual_item, expected_item) for actual_item in actual):
                    raise AssertionError(f"missing list subset item: {expected_item!r}")
            elif expected_item not in actual:
                raise AssertionError(f"missing list item: {expected_item!r}")
        return

    if actual != expected_subset:
        raise AssertionError(f"expected {expected_subset!r}, got {actual!r}")


def subset_matches(actual: Any, expected_subset: Any) -> bool:
    try:
        assert_subset(actual, expected_subset)
        return True
    except AssertionError:
        return False


def expand_paths(patterns: Iterable[str]) -> list[Path]:
    paths: list[Path] = []
    for pattern in patterns:
        matches = [Path(p) for p in glob.glob(str(resolve(pattern)), recursive=True)]
        if not matches:
            raise AssertionError(f"pattern matched no files: {pattern}")
        paths.extend(matches)
    return sorted(set(paths))


def resolve(path: str | Path) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return REPO_ROOT / candidate


def load_json(path: str | Path) -> Any:
    with resolve(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"{path}: expected YAML mapping")
    return loaded


def load_markdown_frontmatter(path: str | Path) -> dict[str, Any]:
    text = resolve(path).read_text(encoding="utf-8")
    return parse_markdown_frontmatter_text(text, str(path))


def parse_markdown_frontmatter_text(text: str, label: str) -> dict[str, Any]:
    if not text.startswith("---\n"):
        raise ValueError(f"{label}: missing opening frontmatter delimiter")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise ValueError(f"{label}: missing closing frontmatter delimiter")
    loaded = yaml.safe_load(text[4:end])
    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        raise ValueError(f"{label}: frontmatter must be a mapping")
    return loaded


def get_pointer(value: Any, pointer: str) -> Any:
    current = value
    if pointer in ("", "/"):
        return current
    for raw_part in pointer.strip("/").split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            raise KeyError(pointer)
    return current


def pointer_exists(value: Any, pointer: str) -> bool:
    try:
        get_pointer(value, pointer)
        return True
    except KeyError:
        return False


def format_schema_errors(path: Path, errors: list[Any]) -> str:
    formatted = []
    for error in errors:
        location = "/" + "/".join(str(part) for part in error.path)
        formatted.append(f"{path}:{location}: {error.message}")
    return "\n".join(formatted)


if __name__ == "__main__":
    raise SystemExit(main())
