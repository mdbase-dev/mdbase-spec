#!/usr/bin/env python3
"""Stage or apply a complete mdbase v0.2 collection metadata migration.

The migrator rewrites only ``mdbase.yaml`` and control files in the configured
types and contracts folders. Record files are never modified. It flattens v0.2
inheritance, maps field definitions to JSON Schema, and moves collection
behavior into the v0.3 ``collection`` and ``lifecycle`` sections.

TaskNotes-generated types receive a first-class ``tasknotes.task``
implementation and the exact local contract artifact. Source features without
a portable v0.3 mapping are retained under ``x-legacy-v0.2`` and listed in the
report.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator


REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_SCHEMA = REPO_ROOT / "schemas/v0.3/config.schema.json"
TYPE_FILE_SCHEMA = REPO_ROOT / "schemas/v0.3/type-file.schema.json"
DATA_CONTRACT_SCHEMA = REPO_ROOT / "schemas/v0.3/data-contract.schema.json"
TASKNOTES_CONTRACT_SOURCE = (
    REPO_ROOT
    / "examples/v0.3/tasknotes-migration/v0.3/_contracts/tasknotes.task.md"
)
FRONTMATTER = re.compile(r"\A---(?:\r?\n)(.*?)(?:\r?\n)---(?=\r?\n|\Z)", re.S)
CORE_CONFIG_SETTINGS = {
    "types_folder",
    "contracts_folder",
    "record_extensions",
    "validation",
    "explicit_type_keys",
    "id_field",
    "include_subfolders",
    "exclude",
}


@dataclass(frozen=True)
class SourceType:
    path: Path
    frontmatter: dict[str, Any]
    body: str

    @property
    def name(self) -> str:
        return str(self.frontmatter["name"])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Stage or apply an mdbase v0.2 collection metadata migration"
    )
    parser.add_argument("collection", type=Path)
    parser.add_argument("--output", type=Path, required=True, help="analysis/report directory")
    parser.add_argument("--apply", action="store_true", help="replace live metadata after analysis")
    parser.add_argument("--backup-dir", type=Path, help="backup destination used with --apply")
    parser.add_argument("--mdb-bin", type=Path, help="mdb binary used for full staged validation")
    parser.add_argument(
        "--allow-unsupported",
        action="store_true",
        help="apply while retaining unsupported source behavior under x-legacy-v0.2",
    )
    args = parser.parse_args()

    collection = args.collection.resolve()
    output = args.output.resolve()
    if not collection.is_dir():
        parser.error(f"collection is not a directory: {collection}")
    if output == collection or collection in output.parents:
        parser.error("--output must be outside the collection")
    if args.apply and not args.backup_dir:
        parser.error("--backup-dir is required with --apply")

    result = analyze(collection, output, args.mdb_bin)
    report_path = output / "migration-report.json"
    report_path.write_text(json.dumps(result["report"], indent=2, sort_keys=True) + "\n")

    report = result["report"]
    if report["unsupported"] and not args.allow_unsupported:
        print(json.dumps({"ok": False, "report": str(report_path), "reason": "unsupported"}))
        return 2
    if report["target_validation"]["status"] == "failed":
        print(json.dumps({"ok": False, "report": str(report_path), "reason": "invalid-target"}))
        return 3
    if report["record_validation"]["regressions"]:
        print(json.dumps({"ok": False, "report": str(report_path), "reason": "record-regression"}))
        return 4

    backup = None
    if args.apply:
        backup = apply_migration(
            collection,
            output / "proposed",
            args.backup_dir.resolve(),
            report,
        )
        report["apply"] = {"status": "complete", "backup": str(backup)}
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    print(
        json.dumps(
            {
                "ok": True,
                "applied": args.apply,
                "report": str(report_path),
                "backup": str(backup) if backup else None,
                "types": report["summary"]["types_migrated"],
                "unsupported": len(report["unsupported"]),
                "record_regressions": len(report["record_validation"]["regressions"]),
            }
        )
    )
    return 0


def analyze(collection: Path, output: Path, mdb_bin: Path | None) -> dict[str, Any]:
    if output.exists():
        raise SystemExit(f"output already exists: {output}")
    proposed = output / "proposed"
    proposed.mkdir(parents=True)

    config_path = collection / "mdbase.yaml"
    source_config = load_yaml(config_path)
    if not isinstance(source_config, dict):
        raise SystemExit("mdbase.yaml must contain a mapping")
    if not re.fullmatch(r"0\.2\.\d+(?:[-+].*)?", str(source_config.get("spec_version", ""))):
        raise SystemExit("collection is not an mdbase v0.2 collection")

    types_folder = str((source_config.get("settings") or {}).get("types_folder") or "_types")
    type_root = collection / types_folder
    source_types = read_source_types(type_root)
    by_name = {source.name.casefold(): source for source in source_types}
    if len(by_name) != len(source_types):
        raise SystemExit("type names are not unique case-insensitively")

    unsupported: list[dict[str, Any]] = []
    proposed_config = migrate_config(source_config)
    migrated_types: dict[Path, str] = {}
    type_summaries: list[dict[str, Any]] = []

    for source in source_types:
        effective_fields, strict, inheritance = resolve_effective_fields(source, by_name)
        migrated, type_unsupported = migrate_type(
            source,
            effective_fields,
            strict,
            inheritance,
        )
        unsupported.extend(type_unsupported)
        validate_schema(TYPE_FILE_SCHEMA, migrated, f"type {source.name}")
        rendered = render_type(migrated, migrated_body(source, migrated))
        relative = source.path.relative_to(collection)
        migrated_types[relative] = rendered
        type_summaries.append(
            {
                "name": source.name,
                "path": relative.as_posix(),
                "source_sha256": sha256(source.path.read_bytes()),
                "target_sha256": sha256(rendered.encode()),
                "flattened_inheritance": inheritance,
                "tasknotes_contract": next(
                    (
                        implementation.get("contract")
                        for implementation in migrated.get("implements", [])
                        if implementation.get("contract") == "tasknotes.task"
                    ),
                    None,
                ),
            }
        )

    contract_summaries: list[dict[str, Any]] = []
    if any(item["tasknotes_contract"] == "tasknotes.task" for item in type_summaries):
        contracts_folder = str(proposed_config["settings"]["contracts_folder"])
        contract_relative = Path(contracts_folder) / "tasknotes.task.md"
        contract_frontmatter = load_markdown_frontmatter(TASKNOTES_CONTRACT_SOURCE)
        validate_schema(DATA_CONTRACT_SCHEMA, contract_frontmatter, "data contract tasknotes.task")
        contract_bytes = TASKNOTES_CONTRACT_SOURCE.read_bytes()
        contract_target = proposed / contract_relative
        contract_target.parent.mkdir(parents=True, exist_ok=True)
        contract_target.write_bytes(contract_bytes)
        contract_summaries.append(
            {
                "id": "tasknotes.task",
                "version": "0.2.0",
                "path": contract_relative.as_posix(),
                "target_sha256": sha256(contract_bytes),
            }
        )

    validate_schema(CONFIG_SCHEMA, proposed_config, "config")
    (proposed / types_folder).mkdir(parents=True, exist_ok=True)
    (proposed / "mdbase.yaml").write_text(yaml_dump(proposed_config))
    for relative, rendered in migrated_types.items():
        target = proposed / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered)

    target_validation = {"status": "passed", "errors": []}
    record_validation: dict[str, Any] = {
        "status": "not-run",
        "baseline": None,
        "target": None,
        "regressions": [],
    }
    if mdb_bin:
        mdb = mdb_bin.resolve()
        if not mdb.is_file():
            raise SystemExit(f"mdb binary not found: {mdb}")
        target_validation, record_validation = validate_staged_collection(
            collection,
            proposed,
            mdb,
        )

    report = {
        "source": str(collection),
        "source_version": str(source_config["spec_version"]),
        "target_version": "0.3.0",
        "summary": {
            "types_migrated": len(migrated_types),
            "tasknotes_contracts": sum(
                1 for item in type_summaries if item["tasknotes_contract"] == "tasknotes.task"
            ),
        },
        "config": {
            "source_sha256": sha256(config_path.read_bytes()),
            "target_sha256": sha256((proposed / "mdbase.yaml").read_bytes()),
        },
        "types": sorted(type_summaries, key=lambda item: item["name"].casefold()),
        "contracts": contract_summaries,
        "unsupported": unsupported,
        "target_validation": target_validation,
        "record_validation": record_validation,
        "proposed": str(proposed),
        "apply": {"status": "not-requested"},
    }
    return {"report": report}


def read_source_types(type_root: Path) -> list[SourceType]:
    if not type_root.is_dir():
        raise SystemExit(f"types folder not found: {type_root}")
    result = []
    for path in sorted(type_root.rglob("*.md")):
        if ".bak-" in path.name:
            continue
        text = path.read_text()
        match = FRONTMATTER.match(text)
        if not match:
            raise SystemExit(f"type file lacks frontmatter: {path}")
        value = normalize_yaml(yaml.safe_load(match.group(1)) or {})
        if not isinstance(value, dict) or not isinstance(value.get("name"), str):
            raise SystemExit(f"type file has no name: {path}")
        body = text[match.end() :]
        result.append(SourceType(path=path, frontmatter=value, body=body))
    return result


def resolve_effective_fields(
    source: SourceType,
    by_name: dict[str, SourceType],
    chain: tuple[str, ...] = (),
) -> tuple[dict[str, Any], bool, list[str]]:
    name = source.name.casefold()
    if name in chain:
        raise SystemExit(f"circular inheritance: {' -> '.join((*chain, name))}")
    own_fields = copy.deepcopy(source.frontmatter.get("fields") or {})
    strict_value = source.frontmatter.get("strict")
    strict = strict_value is True or strict_value == "error"
    inheritance: list[str] = []
    parent_name = source.frontmatter.get("extends")
    if parent_name is not None:
        if not isinstance(parent_name, str) or parent_name.casefold() not in by_name:
            raise SystemExit(f"type {source.name} has an invalid parent: {parent_name!r}")
        parent = by_name[parent_name.casefold()]
        parent_fields, parent_strict, ancestors = resolve_effective_fields(
            parent, by_name, (*chain, name)
        )
        parent_fields.update(own_fields)
        own_fields = parent_fields
        if strict_value is None:
            strict = parent_strict
        inheritance = [*ancestors, parent.name]
    return own_fields, strict, inheritance


def migrate_config(source: dict[str, Any]) -> dict[str, Any]:
    settings = copy.deepcopy(source.get("settings") or {})
    target_settings = {key: value for key, value in settings.items() if key in CORE_CONFIG_SETTINGS}
    if "extensions" in settings and "record_extensions" not in target_settings:
        target_settings["record_extensions"] = [str(value).lstrip(".") for value in settings["extensions"]]
    target_settings.setdefault("record_extensions", ["md"])
    target_settings.setdefault("contracts_folder", "_contracts")
    target_settings.setdefault("validation", "warn")
    # Preserve an explicitly empty list: this collection uses CSL's `type`
    # field as data and therefore cannot use the default explicit type keys.
    target_settings.setdefault("explicit_type_keys", ["type", "types"])
    target_settings.setdefault("id_field", "id")

    target: dict[str, Any] = {
        "spec_version": "0.3.0",
        "settings": target_settings,
    }
    for key in ("name", "description", "runtime"):
        if key in source:
            target[key] = copy.deepcopy(source[key])
    legacy_settings = {key: value for key, value in settings.items() if key not in CORE_CONFIG_SETTINGS}
    legacy_root = {
        key: value
        for key, value in source.items()
        if key not in {"spec_version", "settings", "name", "description", "runtime"}
    }
    if legacy_settings or legacy_root:
        target["x-legacy-v0.2"] = {
            **({"settings": legacy_settings} if legacy_settings else {}),
            **({"root": legacy_root} if legacy_root else {}),
        }
    return target


def type_matches_types_folder(match: Any) -> bool:
    if not isinstance(match, dict):
        return False
    pattern = match.get("path_glob")
    patterns = pattern if isinstance(pattern, list) else [pattern]
    return any(isinstance(value, str) and "_types/" in value for value in patterns)


def migrate_meta_type(source: SourceType) -> dict[str, Any]:
    return {
        "kind": "mdbase.type",
        "name": "meta",
        "version": 1,
        "description": "mdbase v0.3 type-file schema.",
        "match": migrate_match(source.frontmatter.get("match"))
        or {"path_glob": "_types/**/*.md"},
        "schema": {
            "dialect": "json-schema-2020-12",
            "value": json.loads(TYPE_FILE_SCHEMA.read_text()),
        },
        "x-mdbase": {"materialized": True, "authoritative": "built-in"},
        "x-legacy-v0.2": {"replaced_meta_schema": True},
    }


def migrate_type(
    source: SourceType,
    fields: dict[str, Any],
    strict: bool,
    inheritance: list[str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if source.name.casefold() == "meta" and type_matches_types_folder(source.frontmatter.get("match")):
        return migrate_meta_type(source), []

    required: list[str] = []
    properties: dict[str, Any] = {}
    read_defaults: dict[str, Any] = {}
    links: dict[str, Any] = {}
    unique: list[dict[str, Any]] = []
    projections: dict[str, Any] = {}
    lifecycle: dict[str, Any] = {}
    unsupported: list[dict[str, Any]] = []
    tasknotes_roles: dict[str, str] = {}
    completed_values: list[Any] = []
    is_tasknotes = any(
        isinstance(definition, dict) and isinstance(definition.get("tn_role"), str)
        for definition in fields.values()
    )

    for field_name, definition in fields.items():
        if not isinstance(definition, dict):
            continue
        computed = definition.get("computed")
        if isinstance(computed, str):
            projections[field_name] = {"expr": computed}
            if isinstance(definition.get("description"), str):
                projections[field_name]["description"] = definition["description"]
            continue
        role = definition.get("tn_role") if isinstance(definition.get("tn_role"), str) else None
        schema, field_links = convert_field(
            field_name,
            definition,
            strict=strict,
            tasknotes_role=role if is_tasknotes else None,
            allow_null=definition.get("required") is not True,
        )
        properties[field_name] = schema
        links.update(field_links)
        if definition.get("required") is True:
            required.append(field_name)
        if "default" in definition:
            properties[field_name]["default"] = copy.deepcopy(definition["default"])
            read_defaults[field_name] = copy.deepcopy(definition["default"])
        if definition.get("unique") is True:
            unique.append({"field": field_name, "scope": "type"})
        if role:
            tasknotes_roles[role] = field_name
        if isinstance(definition.get("tn_completed_values"), list):
            completed_values = copy.deepcopy(definition["tn_completed_values"])
        generated = definition.get("generated")
        if generated is not None:
            mapped = add_lifecycle(lifecycle, field_name, generated)
            own_fields = source.frontmatter.get("fields") or {}
            if not mapped and field_name in own_fields:
                unsupported.append(
                    {
                        "type": source.name,
                        "path": source.path.name,
                        "feature": f"fields.{field_name}.generated",
                        "value": generated,
                        "preserved_at": f"x-legacy-v0.2.generated.{field_name}",
                    }
                )

    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": not strict,
        "properties": properties,
    }
    if required:
        schema["required"] = required

    target: dict[str, Any] = {
        "kind": "mdbase.type",
        "name": source.name,
        "version": int(source.frontmatter.get("version") or 1),
        "description": str(source.frontmatter.get("description") or f"{source.name} record."),
        "schema": {"dialect": "json-schema-2020-12", "value": schema},
    }
    match = migrate_match(source.frontmatter.get("match"))
    if match:
        target["match"] = match

    collection: dict[str, Any] = {}
    display = source.frontmatter.get("display_name_key")
    if isinstance(display, str) and is_field_path(display):
        collection["display"] = {"name_field": display}
    if read_defaults:
        collection["read_defaults"] = read_defaults
    if links:
        collection["links"] = links
    if unique:
        collection["unique"] = unique
    path_pattern = source.frontmatter.get("path_pattern") or source.frontmatter.get("filename_pattern")
    if isinstance(path_pattern, str):
        collection["path"] = {"pattern": path_pattern}
    if projections:
        collection["projections"] = projections

    if is_tasknotes:
        title_field = tasknotes_roles.get("title")
        if title_field and is_field_path(title_field):
            properties[title_field]["minLength"] = 1
            collection["display"] = {"name_field": title_field}
        if isinstance(path_pattern, str):
            folder, template = tasknotes_path(path_pattern)
            collection["path"] = {
                "runtime": "tasknotes",
                "template": template,
                "folder": folder,
                "generated_by": "tasknotes.filename.create",
            }
        status_field = tasknotes_roles.get("status")
        priority_field = tasknotes_roles.get("priority")
        target["implements"] = [
            {
                "contract": "tasknotes.task",
                "version": "0.2.0",
                "fields": tasknotes_roles,
                "binding": {
                    "status": {
                        "completed_values": completed_values,
                        **(
                            {"default": read_defaults[status_field]}
                            if status_field in read_defaults
                            else {}
                        ),
                    },
                    "priority": (
                        {"default": read_defaults[priority_field]}
                        if priority_field in read_defaults
                        else {}
                    ),
                    "archive": {"archived_tag": "archived"},
                },
            }
        ]

    if collection:
        target["collection"] = collection
    if lifecycle:
        target["lifecycle"] = lifecycle

    known = {
        "name",
        "version",
        "description",
        "display_name_key",
        "extends",
        "strict",
        "match",
        "path_pattern",
        "filename_pattern",
        "fields",
    }
    unknown_top = {
        key: copy.deepcopy(value)
        for key, value in source.frontmatter.items()
        if key not in known
    }
    source_fields = source.frontmatter.get("fields") or {}
    unsupported_generated = {
        field_name: copy.deepcopy(definition["generated"])
        for field_name, definition in source_fields.items()
        if isinstance(definition, dict)
        and "generated" in definition
        and not lifecycle_has_field(lifecycle, field_name)
    }
    legacy: dict[str, Any] = {}
    if inheritance:
        legacy["flattened_inheritance"] = inheritance
    if unsupported_generated:
        legacy["generated"] = unsupported_generated
    if unknown_top:
        legacy["source_metadata"] = unknown_top
    if legacy:
        target["x-legacy-v0.2"] = legacy
    target.setdefault("x-legacy-v0.2", {})["coercion_compatible_schema"] = True
    return target, unsupported


def convert_field(
    selector: str,
    definition: dict[str, Any],
    *,
    strict: bool,
    tasknotes_role: str | None = None,
    allow_null: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    field_type = definition.get("type")
    links: dict[str, Any] = {}
    if field_type == "string":
        # v0.2 reads coerced scalar values before validation. A migrated schema
        # must therefore accept the raw YAML scalar forms that v0.2 accepted.
        schema = {"type": ["string", "number", "boolean"]}
    elif field_type == "integer":
        schema = {
            "anyOf": [
                {"type": "integer"},
                {"type": "number", "multipleOf": 1},
                {"type": "string", "pattern": r"^-?(?:0|[1-9][0-9]*)(?:\.0+)?$"},
            ]
        }
    elif field_type == "number":
        schema = {
            "anyOf": [
                {"type": "number"},
                {
                    "type": "string",
                    "pattern": r"^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$",
                },
            ]
        }
    elif field_type == "boolean":
        schema = {
            "anyOf": [
                {"type": "boolean"},
                {"enum": ["true", "false", "yes", "no", "on", "off"]},
            ]
        }
    elif field_type == "date":
        schema = {"type": "string", "format": "date"}
    elif field_type == "datetime":
        schema = {
            "type": "string",
            "pattern": (
                r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
                r"(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$"
            ),
        }
    elif field_type == "time":
        schema = {"type": "string", "pattern": r"^[0-9]{2}:[0-9]{2}(?::[0-9]{2})?$"}
    elif field_type == "enum":
        schema = {"enum": copy.deepcopy(definition.get("values") or [])}
    elif field_type == "link":
        schema = {"type": "string"}
        target = definition.get("target") or "any"
        if tasknotes_role in {"recurrenceParent", "blockedBy"} and selector.endswith(("recurrence_parent", ".uid")):
            target = "task"
        links[selector] = {
            "target_type": target,
            "validate_exists": bool(definition.get("validate_exists", False)),
        }
    elif field_type == "list":
        item_definition = definition.get("items") if isinstance(definition.get("items"), dict) else {}
        item_schema, item_links = convert_field(
            f"{selector}[]",
            item_definition,
            strict=strict,
            tasknotes_role=tasknotes_role,
            # v0.2 treats a null list item as empty for optional item schemas.
            # Retain that accepted persisted shape during metadata-only migration.
            allow_null=True,
        )
        schema = {"type": "array", "items": item_schema}
        links.update(item_links)
    elif field_type == "object":
        child_properties: dict[str, Any] = {}
        child_required: list[str] = []
        for child_name, child_definition in (definition.get("fields") or {}).items():
            if not isinstance(child_definition, dict):
                continue
            child_schema, child_links = convert_field(
                f"{selector}.{child_name}",
                child_definition,
                strict=strict,
                tasknotes_role=tasknotes_role,
                allow_null=child_definition.get("required") is not True,
            )
            child_properties[child_name] = child_schema
            links.update(child_links)
            if child_definition.get("required") is True:
                child_required.append(child_name)
        schema = {
            "type": "object",
            "additionalProperties": not strict if child_properties else True,
            "properties": child_properties,
        }
        if child_required:
            schema["required"] = child_required
    else:
        schema = {}

    if isinstance(definition.get("description"), str):
        schema["description"] = definition["description"]
    if isinstance(definition.get("pattern"), str):
        schema["pattern"] = definition["pattern"]
    if definition.get("deprecated"):
        schema["deprecated"] = True
    if isinstance(definition.get("min"), (int, float)):
        if field_type == "string":
            schema["minLength"] = definition["min"]
        elif field_type == "list":
            schema["minItems"] = definition["min"]
        else:
            schema["minimum"] = definition["min"]
    if isinstance(definition.get("max"), (int, float)):
        if field_type == "string":
            schema["maxLength"] = definition["max"]
        elif field_type == "list":
            schema["maxItems"] = definition["max"]
        else:
            schema["maximum"] = definition["max"]
    if isinstance(definition.get("min_length"), int):
        schema["minLength"] = definition["min_length"]
    if isinstance(definition.get("max_length"), int):
        schema["maxLength"] = definition["max_length"]
    if isinstance(definition.get("min_items"), int):
        schema["minItems"] = definition["min_items"]
    if isinstance(definition.get("max_items"), int):
        schema["maxItems"] = definition["max_items"]
    if definition.get("unique") is True and field_type == "list":
        schema["uniqueItems"] = True
    if allow_null:
        schema = {"anyOf": [schema, {"type": "null"}]}
    return schema, links


def add_lifecycle(lifecycle: dict[str, Any], field: str, generated: Any) -> bool:
    on_create: dict[str, Any] | None = None
    on_update: dict[str, Any] | None = None
    if generated == "now":
        on_create = {"now": True}
    elif generated == "now_on_write":
        on_create = {"now": True}
        on_update = {"now": True}
    elif generated == "uuid":
        on_create = {"uuid": True}
    elif generated == "ulid":
        on_create = {"ulid": True}
    elif isinstance(generated, dict) and isinstance(generated.get("from"), str):
        transform = generated.get("transform")
        if transform in (None, "copy"):
            on_create = {"copy": generated["from"]}
        elif transform == "slugify":
            on_create = {"slugify": generated["from"]}
        else:
            return False
    else:
        return False
    if on_create:
        lifecycle.setdefault("on_create", {}).setdefault("set", {})[field] = on_create
    if on_update:
        lifecycle.setdefault("on_update", {}).setdefault("set", {})[field] = on_update
    return True


def lifecycle_has_field(lifecycle: dict[str, Any], field: str) -> bool:
    return any(field in event.get("set", {}) for event in lifecycle.values())


def migrate_match(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    target = copy.deepcopy(value)
    where = target.get("where")
    if isinstance(where, dict):
        normalized: dict[str, Any] = {}
        for key, predicate in where.items():
            if isinstance(key, str) and "." in key:
                field, operator = key.rsplit(".", 1)
                if operator in {
                    "eq",
                    "neq",
                    "contains",
                    "containsAll",
                    "containsAny",
                    "exists",
                    "startsWith",
                    "endsWith",
                    "matches",
                    "gt",
                    "gte",
                    "lt",
                    "lte",
                }:
                    normalized.setdefault(field, {})[operator] = predicate
                    continue
            normalized[key] = predicate
        target["where"] = normalized
    return target or None


def tasknotes_path(pattern: str) -> tuple[str, str]:
    normalized = pattern.replace("\\", "/")
    folder, _, filename = normalized.rpartition("/")
    template = re.sub(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", r"{{\1}}", filename)
    if template.endswith(".md"):
        template = template[:-3]
    return folder, template or "{{title}}"


def migrated_body(source: SourceType, target: dict[str, Any]) -> str:
    if target.get("name") == "meta" and target.get("x-mdbase", {}).get("materialized") is True:
        return (
            "\n\n# Meta\n\n"
            "This materialized meta type mirrors the canonical mdbase v0.3 type-file schema.\n"
            "The implementation's built-in schema remains authoritative during collection bootstrap.\n"
        )
    if any(
        implementation.get("contract") == "tasknotes.task"
        for implementation in target.get("implements", [])
    ):
        return (
            "\n\n# Task\n\n"
            "This type definition is generated from TaskNotes settings for mdbase v0.3.\n"
            "Its JSON Schema describes persisted task frontmatter; collection and lifecycle\n"
            "metadata describe generic mdbase behavior; `implements` maps the exact\n"
            "TaskNotes task data contract.\n\n"
            "This file is automatically generated and should not be edited manually.\n"
        )
    return source.body


def render_type(frontmatter: dict[str, Any], body: str) -> str:
    return f"---\n{yaml_dump(frontmatter).rstrip()}\n---{body}"


def validate_staged_collection(
    collection: Path,
    proposed: Path,
    mdb: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    baseline = run_mdb_validate(mdb, collection)
    with tempfile.TemporaryDirectory(prefix="mdbase-v03-stage-") as temporary:
        stage = Path(temporary)
        copy_markdown_collection(collection, stage)
        shutil.copy2(proposed / "mdbase.yaml", stage / "mdbase.yaml")
        target_types = load_yaml(proposed / "mdbase.yaml")["settings"]["types_folder"]
        staged_types = stage / target_types
        if staged_types.exists():
            shutil.rmtree(staged_types)
        shutil.copytree(proposed / target_types, staged_types)
        target_contracts = load_yaml(proposed / "mdbase.yaml")["settings"].get(
            "contracts_folder", "_contracts"
        )
        proposed_contracts = proposed / target_contracts
        if proposed_contracts.exists():
            staged_contracts = stage / target_contracts
            if staged_contracts.exists():
                shutil.rmtree(staged_contracts)
            shutil.copytree(proposed_contracts, staged_contracts)
        target = run_mdb_validate(mdb, stage)

    baseline_keys = diagnostic_keys(baseline)
    target_keys = diagnostic_keys(target)
    regressions = sorted(target_keys - baseline_keys)
    validation_errors = [
        item for item in target.get("issues", []) if item.get("path", "").startswith("_types/")
    ]
    if target.get("error"):
        validation_errors.append(target["error"])
    target_validation = {
        "status": "failed" if validation_errors else "passed",
        "errors": summarize_diagnostics(validation_errors),
    }
    records = {
        "status": "passed" if not regressions else "failed",
        "baseline": summarize_validation(baseline),
        "target": summarize_validation(target),
        "regressions": [
            {"path": path, "field": field, "code": code}
            for path, field, code in regressions
        ],
    }
    return target_validation, records


def copy_markdown_collection(source: Path, target: Path) -> None:
    ignored_roots = {".git", ".obsidian", ".mdbase", "node_modules"}
    for root, directories, files in os.walk(source):
        directories[:] = [name for name in directories if name not in ignored_roots]
        root_path = Path(root)
        relative_root = root_path.relative_to(source)
        for filename in files:
            if filename == "mdbase.yaml" or filename.endswith(".md"):
                source_file = root_path / filename
                target_file = target / relative_root / filename
                target_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_file, target_file)


def run_mdb_validate(mdb: Path, collection: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [str(mdb), "-C", str(collection), "validate"],
        check=False,
        capture_output=True,
        text=True,
    )
    payload = completed.stdout.strip() or completed.stderr.strip()
    if not payload:
        raise SystemExit("mdb validation produced no JSON")
    try:
        return json.loads(payload)
    except json.JSONDecodeError as error:
        raise SystemExit(f"mdb validation returned invalid JSON: {error}") from error


def diagnostic_keys(result: dict[str, Any]) -> set[tuple[str, str, str]]:
    return {
        (
            str(item.get("path") or ""),
            str(item.get("field") or ""),
            diagnostic_family(str(item.get("code") or "")),
        )
        for item in result.get("issues", [])
        if not str(item.get("path") or "").startswith("_types/")
    }


def diagnostic_family(code: str) -> str:
    if code in {
        "invalid_datetime",
        "invalid_enum",
        "list_item_invalid",
        "missing_required",
        "type_mismatch",
        "schema_validation_error",
        "schema_required",
        "schema_type",
        "schema_enum",
        "schema_one_of",
        "schema_any_of",
        "schema_additional_properties",
        "format_invalid",
    }:
        return "schema"
    return code


def summarize_validation(result: dict[str, Any]) -> dict[str, Any]:
    issues = result.get("issues", [])
    return {
        "valid": bool(result.get("valid")),
        "issue_count": len(issues),
        "codes": summarize_diagnostics(issues),
    }


def summarize_diagnostics(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for item in issues:
        code = str(item.get("code") or "unknown")
        counts[code] = counts.get(code, 0) + 1
    return [{"code": code, "count": counts[code]} for code in sorted(counts)]


def apply_migration(
    collection: Path,
    proposed: Path,
    backup: Path,
    report: dict[str, Any],
) -> Path:
    if backup.exists():
        raise SystemExit(f"backup already exists: {backup}")
    backup.mkdir(parents=True)
    paths = [
        Path("mdbase.yaml"),
        *(Path(item["path"]) for item in report["types"]),
        *(Path(item["path"]) for item in report.get("contracts", [])),
    ]
    manifest = {"collection": str(collection), "files": []}
    for relative in paths:
        source = collection / relative
        existed = source.exists()
        item = {"path": relative.as_posix(), "existed": existed}
        if existed:
            backup_file = backup / relative
            backup_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, backup_file)
            item["sha256"] = sha256(source.read_bytes())
        manifest["files"].append(item)
    (backup / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")

    for relative in paths:
        target = collection / relative
        staged = proposed / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.mdbase-v03.tmp")
        shutil.copy2(staged, temporary)
        os.replace(temporary, target)
    return backup


def validate_schema(schema_path: Path, value: Any, label: str) -> None:
    schema = json.loads(schema_path.read_text())
    errors = sorted(Draft202012Validator(schema).iter_errors(value), key=lambda item: list(item.path))
    if errors:
        details = "; ".join(
            f"{'/'.join(str(part) for part in error.path) or '<root>'}: {error.message}"
            for error in errors[:10]
        )
        raise SystemExit(f"invalid migrated {label}: {details}")


def load_yaml(path: Path) -> Any:
    return normalize_yaml(yaml.safe_load(path.read_text()))


def load_markdown_frontmatter(path: Path) -> dict[str, Any]:
    match = FRONTMATTER.match(path.read_text())
    if not match:
        raise SystemExit(f"control file lacks frontmatter: {path}")
    value = normalize_yaml(yaml.safe_load(match.group(1)) or {})
    if not isinstance(value, dict):
        raise SystemExit(f"control file frontmatter is not a mapping: {path}")
    return value


def normalize_yaml(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): normalize_yaml(child) for key, child in value.items()}
    if isinstance(value, list):
        return [normalize_yaml(child) for child in value]
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    return value


def yaml_dump(value: Any) -> str:
    return yaml.safe_dump(
        value,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=1000,
    )


def is_field_path(value: str) -> bool:
    return bool(
        re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_:-]*(?:\[\])?(?:\.[A-Za-z_][A-Za-z0-9_:-]*(?:\[\])?)*",
            value,
        )
    )


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


if __name__ == "__main__":
    sys.exit(main())
