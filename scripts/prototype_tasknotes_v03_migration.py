#!/usr/bin/env python3
"""Prototype migration for TaskNotes' generated mdbase type file.

This is a fixture-oriented prototype for the v0.3 design. It is not a production
TaskNotes migrator. It proves that the representative v0.2 `fields` grammar can
be transformed into the v0.3 split:

- JSON Schema frontmatter shape
- `collection` defaults, links, display, and path policy
- `lifecycle` managed fields
- a first-class `tasknotes.task` implementation
- machine-readable migration report
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT / "examples/v0.3/tasknotes-migration/current-v0.2/_types/task.md"
DEFAULT_REPORT = REPO_ROOT / "examples/v0.3/tasknotes-migration/migration-report.json"
TYPE_FILE_SCHEMA = REPO_ROOT / "schemas/v0.3/type-file.schema.json"


TASKNOTES_ADDITIONAL_FIELDS: dict[str, dict[str, Any]] = {
    "occurrenceMaterialization": {
        "enum": ["manual", "on_completion", "rolling"],
        "default": "manual",
        "role": "occurrenceMaterialization",
        "read_default": True,
    },
    "occurrenceNextTrigger": {
        "enum": ["completion", "completion_or_skip"],
        "default": "completion",
        "role": "occurrenceNextTrigger",
        "read_default": True,
    },
    "occurrenceTemplate": {
        "type": "string",
        "role": "occurrenceTemplate",
        "link": {"target_type": "any", "validate_exists": False},
    },
    "occurrencePastHorizon": {
        "type": "string",
        "role": "occurrencePastHorizon",
    },
    "occurrenceFutureHorizon": {
        "type": "string",
        "role": "occurrenceFutureHorizon",
    },
    "reminders": {
        "schema": {
            "type": "array",
            "items": {
                "oneOf": [
                    {
                        "type": "object",
                        "required": ["id", "type", "absoluteTime"],
                        "additionalProperties": False,
                        "properties": {
                            "id": {"type": "string"},
                            "type": {"const": "absolute"},
                            "description": {"type": "string"},
                            "absoluteTime": {"type": "string", "format": "date-time"},
                        },
                    },
                    {
                        "type": "object",
                        "required": ["id", "type", "relatedTo", "offset"],
                        "additionalProperties": False,
                        "properties": {
                            "id": {"type": "string"},
                            "type": {"const": "relative"},
                            "description": {"type": "string"},
                            "relatedTo": {"enum": ["due", "scheduled"]},
                            "offset": {"type": "string"},
                        },
                    },
                ]
            },
        },
        "role": "reminders",
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Prototype TaskNotes v0.2 type to mdbase v0.3 migration")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--type-out", type=Path, help="write generated v0.3 type file")
    parser.add_argument("--report-out", type=Path, help="write generated migration report JSON")
    parser.add_argument("--check-fixture", action="store_true", help="validate against the checked-in fixture report")
    args = parser.parse_args()

    old = read_markdown_frontmatter(args.source)
    migrated = migrate_tasknotes_type(old)
    report = build_report(old, migrated)

    validate_type_file(migrated)

    if args.check_fixture:
      # Keep the check intentionally report-focused. The generated type is a
      # prototype output; the fixture type remains the edited human-readable target.
        expected = json.loads(DEFAULT_REPORT.read_text(encoding="utf-8"))
        compare_report(report, expected)

    if args.type_out:
        args.type_out.write_text(render_type_file(migrated), encoding="utf-8")
    if args.report_out:
        args.report_out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not args.type_out and not args.report_out and not args.check_fixture:
        print(render_type_file(migrated))

    return 0


def migrate_tasknotes_type(old: dict[str, Any]) -> dict[str, Any]:
    fields = old.get("fields") or {}
    properties: dict[str, Any] = {"type": {"const": "task"}}
    required = ["type"]
    read_defaults: dict[str, Any] = {}
    lifecycle: dict[str, Any] = {}
    links: dict[str, Any] = {}
    field_roles: dict[str, str] = {}
    status_metadata: dict[str, Any] = {}
    priority_metadata: dict[str, Any] = {}

    for field_name, field_def in fields.items():
        schema, nested_links = convert_field(field_name, field_def)
        properties[field_name] = schema
        links.update(nested_links)

        if field_def.get("required") is True:
            required.append(field_name)
        if "default" in field_def:
            properties[field_name]["default"] = field_def["default"]
            read_defaults[field_name] = field_def["default"]
        if role := field_def.get("tn_role"):
            field_roles[role] = field_name
        if field_def.get("tn_completed_values"):
            status_metadata["completed_values"] = field_def["tn_completed_values"]
        if field_def.get("generated"):
            add_generated_lifecycle(lifecycle, field_name, field_def["generated"])

    for field_name, info in TASKNOTES_ADDITIONAL_FIELDS.items():
        if "schema" in info:
            properties[field_name] = info["schema"]
        elif "enum" in info:
            properties[field_name] = {"enum": info["enum"]}
        else:
            properties[field_name] = {"type": info["type"]}

        if "default" in info:
            properties[field_name]["default"] = info["default"]
            if info.get("read_default"):
                read_defaults[field_name] = info["default"]
        if role := info.get("role"):
            field_roles[role] = field_name
        if link := info.get("link"):
            links[field_name] = link

    if "status" in read_defaults:
        status_metadata["default"] = read_defaults["status"]
    if "priority" in read_defaults:
        priority_metadata["default"] = read_defaults["priority"]

    task_type: dict[str, Any] = {
        "kind": "mdbase.type",
        "name": "task",
        "version": 1,
        "description": old.get("description", "A task managed by TaskNotes for Obsidian."),
        "match": old.get("match", {"fields_present": ["title"]}),
        "schema": {
            "dialect": "json-schema-2020-12",
            "value": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "required": dedupe(required),
                "additionalProperties": old.get("strict") is not True,
                "properties": properties,
            },
        },
        "collection": {
            "display": {"name_field": old.get("display_name_key", "title")},
            "read_defaults": read_defaults,
            "links": links,
            "path": migrate_path_policy(old.get("path_pattern")),
        },
        "lifecycle": lifecycle,
        "implements": [
            {
                "contract": "tasknotes.task",
                "version": "0.2.0",
                "fields": field_roles,
                "binding": {
                    "status": status_metadata,
                    "priority": priority_metadata,
                    "archive": {"archived_tag": "archived"},
                },
            }
        ],
    }

    return prune_empty(task_type)


def convert_field(selector: str, field_def: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    field_type = field_def.get("type")
    links: dict[str, Any] = {}

    if field_type == "string":
        schema: dict[str, Any] = {"type": "string"}
    elif field_type == "integer":
        schema = {"type": "integer"}
    elif field_type == "number":
        schema = {"type": "number"}
    elif field_type == "boolean":
        schema = {"type": "boolean"}
    elif field_type == "date":
        schema = {"type": "string", "format": "date"}
    elif field_type == "datetime":
        schema = {"type": "string", "format": "date-time"}
    elif field_type == "time":
        schema = {"type": "string", "format": "time"}
    elif field_type == "enum":
        schema = {"enum": field_def.get("values", [])}
    elif field_type == "link":
        schema = {"type": "string"}
        links[selector] = {"target_type": "task" if selector.endswith("Parent") or selector.endswith("uid") else "any", "validate_exists": False}
    elif field_type == "list":
        item_def = field_def.get("items") or {}
        item_schema, item_links = convert_field(f"{selector}[]", item_def)
        schema = {"type": "array", "items": item_schema}
        links.update(item_links)
    elif field_type == "object":
        properties: dict[str, Any] = {}
        for child_name, child_def in (field_def.get("fields") or {}).items():
            child_selector = f"{selector}.{child_name}"
            child_schema, child_links = convert_field(child_selector, child_def)
            properties[child_name] = child_schema
            links.update(child_links)
        schema = {"type": "object", "additionalProperties": False, "properties": properties}
    else:
        schema = {}

    if "description" in field_def:
        schema["description"] = field_def["description"]
    if "min" in field_def:
        schema["minimum"] = field_def["min"]
    if "max" in field_def:
        schema["maximum"] = field_def["max"]

    return schema, links


def add_generated_lifecycle(lifecycle: dict[str, Any], field_name: str, strategy: str) -> None:
    if strategy == "now":
        lifecycle.setdefault("on_create", {}).setdefault("set", {})[field_name] = {"now": True}
    elif strategy == "now_on_write":
        lifecycle.setdefault("on_update", {}).setdefault("set", {})[field_name] = {"now": True}
    elif strategy == "uuid":
        lifecycle.setdefault("on_create", {}).setdefault("set", {})[field_name] = {"uuid": True}
    elif strategy == "ulid":
        lifecycle.setdefault("on_create", {}).setdefault("set", {})[field_name] = {"ulid": True}


def migrate_path_policy(path_pattern: str | None) -> dict[str, Any]:
    if not path_pattern:
        return {"runtime": "tasknotes", "generated_by": "tasknotes.filename.create"}
    match = re.fullmatch(r"(.*/)?\\{title\\}\\.md", path_pattern)
    if match:
        return {
            "runtime": "tasknotes",
            "template": "{{title}}",
            "folder": (match.group(1) or "").rstrip("/"),
            "generated_by": "tasknotes.filename.create",
        }
    return {
        "runtime": "tasknotes",
        "template": path_pattern,
        "generated_by": "tasknotes.filename.create",
    }


def build_report(old: dict[str, Any], migrated: dict[str, Any]) -> dict[str, Any]:
    fields = old.get("fields") or {}
    read_defaults = migrated.get("collection", {}).get("read_defaults", {})
    lifecycle = migrated.get("lifecycle", {})
    links = migrated.get("collection", {}).get("links", {})
    generated = []
    if lifecycle.get("on_create", {}).get("set", {}).get("dateCreated"):
        generated.append("dateCreated")
    if lifecycle.get("on_update", {}).get("set", {}).get("dateModified"):
        generated.append("dateModified")

    return {
        "source": "current-v0.2/_types/task.md",
        "target": "v0.3/_types/task.md",
        "source_version": "0.2.1",
        "target_version": "0.3.0",
        "summary": {
            "fields_converted": len(fields),
            "required_fields": migrated["schema"]["value"]["required"][1:],
            "defaults_moved_to_read_defaults": [key for key in ["status", "priority", "recurrenceAnchor"] if key in read_defaults],
            "generated_fields_moved_to_lifecycle": generated,
            "link_fields_moved_to_collection_links": [key for key in ["projects[]", "recurrenceParent", "occurrenceTemplate", "blockedBy[].uid"] if key in links],
            "tasknotes_annotations_moved": True,
        },
        "mappings": [
            {"from": "fields.title", "to": ["schema.value.properties.title", "implements.0.fields.title"]},
            {"from": "fields.status.values", "to": "schema.value.properties.status.enum"},
            {"from": "fields.status.default", "to": ["schema.value.properties.status.default", "collection.read_defaults.status", "implements.0.binding.status.default"]},
            {"from": "fields.status.tn_completed_values", "to": "implements.0.binding.status.completed_values"},
            {"from": "fields.dateCreated.generated", "to": "lifecycle.on_create.set.dateCreated"},
            {"from": "fields.dateModified.generated", "to": "lifecycle.on_update.set.dateModified"},
            {"from": "fields.projects.items.type", "to": ["schema.value.properties.projects.items.type", "collection.links.projects[]"]},
            {"from": "fields.blockedBy.items.fields.uid.type", "to": ["schema.value.properties.blockedBy.items.properties.uid.type", "collection.links.blockedBy[].uid"]},
            {"from": "display_name_key", "to": "collection.display.name_field"},
            {"from": "path_pattern", "to": "collection.path"},
        ],
        "warnings": [
            {
                "code": "path_policy_runtime_owned",
                "message": "TaskNotes filename templates may use runtime values that are not schema fields, so the v0.3 target records the path policy as TaskNotes runtime metadata rather than only collection.path.pattern.",
            },
            {
                "code": "additional_properties_true",
                "message": "The migrated schema allows additional properties because TaskNotes supports user-defined fields.",
            },
            {
                "code": "reminders_added_as_v03_shape_example",
                "message": "The v0.3 target includes reminder discriminated unions to show the intended post-v0.3 shape even though the representative v0.2 source did not model reminders accurately.",
            },
        ],
        "unsupported": [],
    }


def validate_type_file(type_file: dict[str, Any]) -> None:
    schema = json.loads(TYPE_FILE_SCHEMA.read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema).iter_errors(type_file), key=lambda error: list(error.path))
    if errors:
        raise ValueError("\n".join(f"/{'/'.join(str(part) for part in error.path)}: {error.message}" for error in errors))
    Draft202012Validator.check_schema(type_file["schema"]["value"])


def compare_report(actual: dict[str, Any], expected: dict[str, Any]) -> None:
    keys = ["source", "target", "source_version", "target_version", "summary", "mappings", "warnings", "unsupported"]
    reduced_actual = {key: actual.get(key) for key in keys}
    reduced_expected = {key: expected.get(key) for key in keys}
    if reduced_actual != reduced_expected:
        print(json.dumps({"actual": reduced_actual, "expected": reduced_expected}, indent=2), file=sys.stderr)
        raise AssertionError("generated migration report does not match fixture")


def render_type_file(frontmatter: dict[str, Any]) -> str:
    return "---\n" + yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=False) + "---\n\n# Task\n\nGenerated prototype v0.3 TaskNotes type.\n"


def read_markdown_frontmatter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path}: missing frontmatter")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise ValueError(f"{path}: missing closing frontmatter delimiter")
    loaded = yaml.safe_load(text[4:end])
    if not isinstance(loaded, dict):
        raise ValueError(f"{path}: frontmatter must be a mapping")
    return loaded


def prune_empty(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: pruned for key, item in value.items() if (pruned := prune_empty(item)) not in ({}, [], None)}
    if isinstance(value, list):
        return [prune_empty(item) for item in value]
    return value


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
