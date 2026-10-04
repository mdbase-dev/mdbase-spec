#!/usr/bin/env python3
"""Executable model of the pure concurrent-edit functions in Chapters 02, 07, and 12A.

This is not an mdbase implementation. It models the functions that the
0.3.0-rc.5 conformance fixtures can check without a collection engine:

- path keys, path equivalence, and the collision suffix rule (Chapter 02)
- path-pattern derivation and placeholder validation (Chapter 07)
- default and declared merge strategies (Chapter 07)
- the three-way record merge and writer format fidelity (Chapter 12A)
- move detection pairing (Chapter 12A)
- the mdbase regex profile (Chapter 10), approximated with Python `re` in
  ASCII mode for the constructs the fixtures use
- body edits and their rebase onto a changed body (Chapters 12 and 12A)

`scripts/check_v03_tests.py` runs the corresponding fixtures against it
through `run_fixture`.
The model exists so that the fixtures are self-consistent and so that the
normative text has a second, independent reading. Where the model and the
specification disagree, the specification wins.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

import yaml


# --------------------------------------------------------------------- YAML


class _StringDateLoader(yaml.SafeLoader):
    """Safe loader that keeps timestamps as strings (Chapter 03 YAML profile)."""


_StringDateLoader.yaml_implicit_resolvers = {
    key: [(tag, regexp) for tag, regexp in resolvers if tag != "tag:yaml.org,2002:timestamp"]
    for key, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def load_yaml_text(text: str) -> Any:
    return yaml.load(text, Loader=_StringDateLoader)


# ------------------------------------------------------------------ paths


def path_key(path: str) -> str:
    """Chapter 02: NFC, full default case folding, NFC."""
    return unicodedata.normalize("NFC", unicodedata.normalize("NFC", path).casefold())


def equivalence_groups(paths: list[str]) -> list[list[str]]:
    groups: dict[str, list[str]] = {}
    for path in paths:
        groups.setdefault(path_key(path), []).append(path)
    return sorted(sorted(group) for group in groups.values() if len(group) > 1)


def suffixed(path: str, n: int) -> str:
    folder, _, name = path.rpartition("/")
    prefix = f"{folder}/" if folder else ""
    stem, dot, ext = name.rpartition(".")
    if not dot:
        return f"{prefix}{name} ({n})"
    return f"{prefix}{stem} ({n}).{ext}"


def allocate_path(requested: str, existing: list[str]) -> str:
    used = {path_key(path) for path in existing}
    if path_key(requested) not in used:
        return requested
    n = 2
    while path_key(suffixed(requested, n)) in used:
        n += 1
    return suffixed(requested, n)


class PathError(Exception):
    def __init__(self, code: str, field_name: str | None = None):
        super().__init__(code)
        self.code = code
        self.field = field_name


def derive_path(pattern: str, frontmatter: dict[str, Any]) -> str:
    out = []
    rest = pattern
    while "{" in rest:
        open_index = rest.index("{")
        close_index = rest.index("}", open_index)
        out.append(rest[:open_index])
        name = rest[open_index + 1 : close_index]
        value = frontmatter.get(name)
        if value is None:
            raise PathError("path_value_missing", name)
        if isinstance(value, (list, dict)):
            raise PathError("path_value_invalid", name)
        if isinstance(value, bool):
            text = "true" if value else "false"
        elif isinstance(value, str):
            text = value
        else:
            text = json.dumps(value)
        if text == "" or "/" in text or "\\" in text or "\0" in text or text.startswith("."):
            raise PathError("path_value_invalid", name)
        out.append(text)
        rest = rest[close_index + 1 :]
    out.append(rest)
    return "".join(out)


# --------------------------------------------------------------- equality


def values_equal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(values_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(values_equal(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


MISSING = object()


def states_equal(a: Any, b: Any) -> bool:
    if a is MISSING or b is MISSING:
        return a is b
    return values_equal(a, b)


# ------------------------------------------------------------ documents


@dataclass
class Entry:
    key: str
    lines: list[str]


@dataclass
class Document:
    source: str
    has_frontmatter: bool
    open_delim: str = ""
    close_delim: str = ""
    # Items are Entry or a raw interstitial line.
    items: list[Any] = field(default_factory=list)
    frontmatter: Any = None
    body: str = ""

    def entry(self, key: str) -> Entry | None:
        for item in self.items:
            if isinstance(item, Entry) and item.key == key:
                return item
        return None


_ENTRY_KEY = re.compile(r"""^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:'"][^:]*?)\s*:(?=\s|$)""")


def _split_lines(text: str) -> list[str]:
    return text.splitlines(keepends=True)


def _parse_items(fm_lines: list[str]) -> list[Any]:
    """Split frontmatter lines into top-level entries and interstitial lines."""
    items: list[Any] = []
    current: Entry | None = None
    pending_blank: list[str] = []
    for line in fm_lines:
        if not line.strip():
            pending_blank.append(line)
            continue
        continuation = line[0] in " \t" or line.startswith("- ") or line.rstrip("\r\n") == "-"
        if continuation and current is not None:
            current.lines.extend(pending_blank)
            pending_blank = []
            current.lines.append(line)
            continue
        items.extend(pending_blank)
        pending_blank = []
        match = _ENTRY_KEY.match(line)
        if match and not line.startswith("#"):
            raw_key = match.group(1)
            key = load_yaml_text(raw_key) if raw_key[0] in "\"'" else raw_key
            current = Entry(key=str(key), lines=[line])
            items.append(current)
        else:
            current = None
            items.append(line)
    items.extend(pending_blank)
    return items


def parse_document(source: str) -> Document:
    lines = _split_lines(source)
    if not lines or lines[0].rstrip("\r\n") != "---" or not lines[0].endswith("\n"):
        return Document(source=source, has_frontmatter=False, frontmatter={}, body=source)
    for index in range(1, len(lines)):
        if lines[index].rstrip("\r\n") == "---":
            fm_lines = lines[1:index]
            parsed = load_yaml_text("".join(fm_lines))
            return Document(
                source=source,
                has_frontmatter=True,
                open_delim=lines[0],
                close_delim=lines[index],
                items=_parse_items(fm_lines),
                frontmatter={} if parsed is None else parsed,
                body="".join(lines[index + 1 :]),
            )
    return Document(source=source, has_frontmatter=False, frontmatter={}, body=source)


def _line_ending(doc: Document) -> str:
    return "\r\n" if "\r\n" in doc.source else "\n"


_PLAIN_SCALAR = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./ -]*$")
_YAML_SPECIAL = {"true", "false", "null", "yes", "no", "on", "off", "~", ""}


def emit_scalar(value: Any) -> str:
    if isinstance(value, str):
        if _PLAIN_SCALAR.match(value) and value.lower() not in _YAML_SPECIAL and not value.endswith(" "):
            if not re.match(r"^[0-9.+-]", value):
                return value
        return json.dumps(value, ensure_ascii=False)
    return json.dumps(value, ensure_ascii=False)


def emit_entry(key: str, value: Any, style_from: Entry | None, eol: str) -> list[str]:
    first = style_from.lines[0] if style_from else ""
    comment = ""
    if style_from and len(style_from.lines) == 1:
        found = re.search(r"(\s+#.*)$", first.rstrip("\r\n"))
        if found:
            comment = found.group(1)
    flow = style_from is None or len(style_from.lines) == 1
    if isinstance(value, list):
        if flow or not value:
            return [f"{key}: [{', '.join(emit_scalar(v) for v in value)}]{comment}{eol}"]
        indent = "  "
        if style_from and len(style_from.lines) > 1:
            indent = re.match(r"^(\s*)", style_from.lines[1]).group(1) or ""
        return [f"{key}:{eol}"] + [f"{indent}- {emit_scalar(v)}{eol}" for v in value]
    return [f"{key}: {emit_scalar(value)}{comment}{eol}"]


def render(doc: Document) -> str:
    if not doc.has_frontmatter:
        return doc.body
    out = [doc.open_delim]
    for item in doc.items:
        out.extend(item.lines if isinstance(item, Entry) else [item])
    out.append(doc.close_delim)
    out.append(doc.body)
    return "".join(out)


# --------------------------------------------------------------- types


@dataclass
class TypeDef:
    name: str
    path_globs: list[str]
    merge: dict[str, str]
    lifecycle_time_fields: set[str]
    unique_items_fields: set[str]


def glob_to_regex(glob: str) -> re.Pattern[str]:
    parts = glob.split("/")
    regex = ""
    for index, part in enumerate(parts):
        last = index == len(parts) - 1
        if part == "**":
            regex += "(?:.*/)?" if not last else ".*"
            continue
        piece = ""
        i = 0
        while i < len(part):
            char = part[i]
            if char == "*":
                piece += "[^/]*"
            elif char == "?":
                piece += "[^/]"
            elif char == "[":
                end = part.index("]", i)
                body = part[i + 1 : end]
                if body.startswith("!"):
                    body = "^" + body[1:]
                piece += f"[{body}]"
                i = end
            else:
                piece += re.escape(char)
            i += 1
        regex += piece + ("" if last else "/")
    return re.compile(f"^{regex}$")


def load_type(text: str) -> TypeDef:
    doc = parse_document(text)
    fm = doc.frontmatter
    match = fm.get("match") or {}
    globs = match.get("path_glob") or []
    if isinstance(globs, str):
        globs = [globs]
    collection = fm.get("collection") or {}
    lifecycle = fm.get("lifecycle") or {}
    time_fields: set[str] = set()
    for event in ("on_create", "on_update"):
        actions = lifecycle.get(event) or []
        if isinstance(actions, dict):
            actions = [actions]
        for action in actions:
            for target, provider in (action.get("set") or {}).items():
                if isinstance(provider, dict) and (provider.get("now") is True or provider.get("today") is True):
                    if "." not in target and "[" not in target and not target.startswith("/"):
                        time_fields.add(target)
    unique_items: set[str] = set()
    schema = (fm.get("schema") or {}).get("value") or {}
    for prop, spec in (schema.get("properties") or {}).items():
        if isinstance(spec, dict) and spec.get("uniqueItems") is True:
            unique_items.add(prop)
    return TypeDef(
        name=fm["name"],
        path_globs=globs,
        merge=dict(collection.get("merge") or {}),
        lifecycle_time_fields=time_fields,
        unique_items_fields=unique_items,
    )


def matched_types(types: list[TypeDef], path: str, frontmatter: Any) -> list[TypeDef]:
    by_name = {t.name.lower(): t for t in types}
    if isinstance(frontmatter, dict):
        declared: list[str] = []
        for key in ("type", "types"):
            value = frontmatter.get(key)
            if isinstance(value, str):
                declared.append(value)
            elif isinstance(value, list):
                declared.extend(v for v in value if isinstance(v, str))
        if any(k in frontmatter for k in ("type", "types")):
            return [by_name[n.lower()] for n in dict.fromkeys(declared) if n.lower() in by_name]
    found = [t for t in types if t.path_globs and any(glob_to_regex(g).match(path) for g in t.path_globs)]
    return sorted(found, key=lambda t: t.name.lower())


def strategy(types: list[TypeDef], key: str) -> str:
    declared = {t.merge[key] for t in types if key in t.merge}
    if len(declared) > 1:
        raise ValueError(f"type_conflict: merge strategy for {key}")
    if declared:
        return declared.pop()
    if any(key in t.lifecycle_time_fields for t in types):
        return "max"
    if key == "tags" or any(key in t.unique_items_fields for t in types):
        return "union"
    return "conflict"


# ---------------------------------------------------------------- merge

_DATE_TIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$"
)
_FULL_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _instant(value: str) -> tuple[int, str] | None:
    from datetime import datetime, timezone

    match = _DATE_TIME.match(value)
    if not match:
        return None
    text = value.upper().replace("Z", "+00:00")
    fraction = match.group(7) or ""
    base = text.replace(fraction, "") if fraction else text
    moment = datetime.fromisoformat(base).astimezone(timezone.utc)
    digits = (fraction[1:] + "000000000")[:9] if fraction else "000000000"
    return (int(moment.timestamp()), digits)


def compare(a: Any, b: Any) -> int | None:
    if isinstance(a, bool) or isinstance(b, bool):
        return None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return (a > b) - (a < b)
    if isinstance(a, str) and isinstance(b, str):
        ia, ib = _instant(a), _instant(b)
        if ia is not None and ib is not None:
            return (ia > ib) - (ia < ib)
        return (a > b) - (a < b)
    return None


def as_list(value: Any, key: str) -> list[Any] | None:
    if value is MISSING or value is None:
        return []
    if isinstance(value, list):
        return list(value)
    if key == "tags" and isinstance(value, str):
        return [value]
    return None


def contains(items: list[Any], item: Any) -> bool:
    return any(values_equal(item, other) for other in items)


def union_merge(base: list[Any], first: list[Any], second: list[Any]) -> list[Any]:
    out = [x for x in first if not (contains(base, x) and not contains(second, x))]
    for item in second:
        if not contains(base, item) and not contains(out, item):
            out.append(item)
    return out


@dataclass
class MergeResult:
    document: str
    path: str
    conflicts: list[dict[str, Any]]


def merge_body(base: str, first: str, second: str) -> str | None:
    if first == second or second == base:
        return first
    if first == base:
        return second
    if first.startswith(base) and second.startswith(base):
        first_tail = first[len(base) :]
        second_tail = second[len(base) :]
        separator = "\n" if first_tail and not first_tail.endswith("\n") else ""
        return base + first_tail + separator + second_tail
    return diff3(_split_lines(base), _split_lines(first), _split_lines(second))


def _lcs_pairs(a: list[str], b: list[str]) -> list[tuple[int, int]]:
    n, m = len(a), len(b)
    table = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            table[i][j] = table[i + 1][j + 1] + 1 if a[i] == b[j] else max(table[i + 1][j], table[i][j + 1])
    pairs = []
    i = j = 0
    while i < n and j < m:
        if a[i] == b[j]:
            pairs.append((i, j))
            i += 1
            j += 1
        elif table[i + 1][j] >= table[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs


def diff3(base: list[str], first: list[str], second: list[str]) -> str | None:
    match_first = dict(_lcs_pairs(base, first))
    match_second = dict(_lcs_pairs(base, second))
    out: list[str] = []
    b = f = s = 0
    while True:
        # Find the next base line aligned in both sides at or after the cursors.
        stable = None
        for i in range(b, len(base)):
            if i in match_first and i in match_second and match_first[i] >= f and match_second[i] >= s:
                stable = i
                break
        if stable is None:
            chunk = (base[b:], first[f:], second[s:])
        else:
            chunk = (base[b:stable], first[f : match_first[stable]], second[s : match_second[stable]])
        base_chunk, first_chunk, second_chunk = chunk
        if first_chunk == second_chunk or second_chunk == base_chunk:
            out.extend(first_chunk)
        elif first_chunk == base_chunk:
            out.extend(second_chunk)
        else:
            return None
        if stable is None:
            return "".join(out)
        out.append(base[stable])
        b, f, s = stable + 1, match_first[stable] + 1, match_second[stable] + 1


def merge_records(
    types: list[TypeDef],
    base_text: str,
    first_text: str,
    second_text: str,
    base_path: str,
    first_path: str,
    second_path: str,
) -> MergeResult:
    base, first, second = (parse_document(t) for t in (base_text, first_text, second_text))
    conflicts: list[dict[str, Any]] = []
    eol = _line_ending(first)

    if first_text == second_text or second_text == base_text:
        content_shortcut: str | None = first_text
    elif first_text == base_text:
        content_shortcut = second_text
    else:
        content_shortcut = None

    # Path merges with the conflict strategy.
    if first_path == second_path or second_path == base_path:
        path = first_path
    elif first_path == base_path:
        path = second_path
    else:
        path = first_path
        conflicts.append({"kind": "path", "base": base_path, "first": first_path, "second": second_path})

    if content_shortcut is not None:
        return MergeResult(document=content_shortcut, path=path, conflicts=conflicts)

    mappings = all(isinstance(d.frontmatter, dict) for d in (base, first, second))
    result = parse_document(first_text)
    if mappings:
        record_types = matched_types(types, first_path, first.frontmatter)
        keys: list[str] = []
        for doc in (first, second, base):
            for key in doc.frontmatter:
                if key not in keys:
                    keys.append(key)
        for key in keys:
            b = base.frontmatter.get(key, MISSING)
            f = first.frontmatter.get(key, MISSING)
            s = second.frontmatter.get(key, MISSING)
            if states_equal(f, s) or states_equal(s, b):
                continue
            if states_equal(f, b):
                _take(result, second, key, eol)
                continue
            kind = strategy(record_types, key)
            if kind in ("max", "min"):
                if f is MISSING or s is MISSING:
                    if f is MISSING:
                        _take(result, second, key, eol)
                    continue
                order = compare(f, s)
                if order is not None:
                    if (kind == "max" and order < 0) or (kind == "min" and order > 0):
                        _take(result, second, key, eol)
                    continue
            elif kind == "union":
                lists = [as_list(v, key) for v in (b, f, s)]
                if all(item is not None for item in lists):
                    merged = union_merge(*lists)
                    if not merged and (f is MISSING or s is MISSING):
                        _remove(result, key)
                    elif not (isinstance(f, list) and values_equal(merged, f)):
                        _set(result, first, second, key, merged, eol)
                    continue
            conflicts.append(
                {
                    "kind": "field",
                    "field": key,
                    "base": None if b is MISSING else b,
                    "first": None if f is MISSING else f,
                    "second": None if s is MISSING else s,
                }
            )
    else:
        fm_text = [render_frontmatter(d) for d in (base, first, second)]
        if fm_text[1] == fm_text[2] or fm_text[2] == fm_text[0]:
            pass
        elif fm_text[1] == fm_text[0]:
            result = parse_document(render_frontmatter(second) + first.body)
        else:
            conflicts.append({"kind": "frontmatter"})

    body = merge_body(base.body, first.body, second.body)
    if body is None:
        conflicts.append({"kind": "body"})
        body = first.body
    result.body = body
    return MergeResult(document=render(result), path=path, conflicts=conflicts)


def render_frontmatter(doc: Document) -> str:
    if not doc.has_frontmatter:
        return ""
    copy = Document(**{**doc.__dict__, "body": ""})
    return render(copy)


def _take(result: Document, side: Document, key: str, eol: str) -> None:
    source = side.entry(key)
    if source is None:
        _remove(result, key)
        return
    target = result.entry(key)
    if target is not None:
        target.lines = list(source.lines)
    else:
        if not result.has_frontmatter:
            result.has_frontmatter = True
            result.open_delim = f"---{eol}"
            result.close_delim = f"---{eol}"
        _append_entry(result, Entry(key=key, lines=list(source.lines)))


def _append_entry(result: Document, entry: Entry) -> None:
    """Insert a new entry after the last existing entry (Chapter 12A rule 4)."""
    last = max((i for i, item in enumerate(result.items) if isinstance(item, Entry)), default=-1)
    result.items.insert(last + 1, entry)


def _remove(result: Document, key: str) -> None:
    result.items = [item for item in result.items if not (isinstance(item, Entry) and item.key == key)]


def _set(result: Document, first: Document, second: Document, key: str, value: Any, eol: str) -> None:
    style = first.entry(key) or second.entry(key)
    lines = emit_entry(key, value, style, eol)
    target = result.entry(key)
    if target is not None:
        target.lines = lines
    else:
        _append_entry(result, Entry(key=key, lines=lines))


# ------------------------------------------------------------ moves


def similarity(a: str, b: str) -> float:
    set_a = {line.strip() for line in a.splitlines() if line.strip()}
    set_b = {line.strip() for line in b.splitlines() if line.strip()}
    if not set_a and not set_b:
        return 1.0
    return len(set_a & set_b) / len(set_a | set_b)


def _identity_hint(content: str, id_field: str | None) -> str | None:
    if not id_field:
        return None
    doc = parse_document(content)
    value = doc.frontmatter.get(id_field) if isinstance(doc.frontmatter, dict) else None
    return value if isinstance(value, str) and value else None


def detect_moves(disappeared: list[dict[str, Any]], appeared: list[dict[str, Any]], id_field: str | None) -> dict[str, Any]:
    candidates = []
    for d in disappeared:
        for a in appeared:
            hint_d = _identity_hint(d["content"], id_field)
            hint_a = _identity_hint(a["content"], id_field)
            sim = similarity(d["content"], a["content"])
            if hint_d is not None and hint_a is not None:
                if hint_d == hint_a:
                    candidates.append((0, -sim, d["path"], a["path"]))
                continue
            if d["content"] == a["content"]:
                rank = 1
            elif d.get("file_id") is not None and d.get("file_id") == a.get("file_id") and sim >= 0.5:
                rank = 2
            elif d["path"].rsplit("/", 1)[-1] == a["path"].rsplit("/", 1)[-1] and sim >= 0.8:
                rank = 3
            else:
                continue
            candidates.append((rank, -sim, d["path"], a["path"]))
    candidates.sort()
    used_d: set[str] = set()
    used_a: set[str] = set()
    moves = []
    for _, _, from_path, to_path in candidates:
        if from_path in used_d or to_path in used_a:
            continue
        used_d.add(from_path)
        used_a.add(to_path)
        moves.append({"from": from_path, "to": to_path})
    return {
        "moves": sorted(moves, key=lambda m: m["from"]),
        "deleted": sorted(d["path"] for d in disappeared if d["path"] not in used_d),
        "created": sorted(a["path"] for a in appeared if a["path"] not in used_a),
    }


# ---------------------------------------------------------------- regex


class InvalidPattern(Exception):
    pass


_FORBIDDEN = [
    (re.compile(r"\\[pP]"), "Unicode class"),
    (re.compile(r"\\[1-9]"), "backreference"),
    (re.compile(r"\(\?(=|!|<=|<!|P=)"), "look-around or backreference"),
]


def regex_match(pattern: str, text: str) -> bool:
    """Unanchored search with ASCII-only classes and case folding."""
    for forbidden, what in _FORBIDDEN:
        if forbidden.search(pattern):
            raise InvalidPattern(what)
    translated = re.sub(r"\\x\{([0-9A-Fa-f]+)\}", lambda m: chr(int(m.group(1), 16)), pattern)
    translated = translated.replace("\\z", "\\Z")
    try:
        compiled = re.compile(translated, re.ASCII)
    except re.error as exc:
        raise InvalidPattern(str(exc)) from exc
    return compiled.search(text) is not None


# ----------------------------------------------------------- body edits


class BodyEditError(Exception):
    def __init__(self, code: str, reason: str | None = None):
        super().__init__(code if reason is None else f"{code}: {reason}")
        self.code = code
        self.reason = reason


def body_digest(body: str) -> str:
    import hashlib

    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def apply_edits(base: str, edits: list[dict[str, Any]]) -> str:
    """Apply edits whose offsets count Unicode scalar values of `base`."""
    previous_end = 0
    previous_insert_at: int | None = None
    out = []
    for edit in edits:
        start, end, text = edit["start"], edit["end"], edit.get("text", "")
        if not (isinstance(start, int) and isinstance(end, int)) or start < 0 or end < start or end > len(base):
            raise BodyEditError("invalid_request", "offset_out_of_range")
        if start < previous_end or (start == end and previous_insert_at == start):
            raise BodyEditError("invalid_request", "edits_overlap_or_unordered")
        out.append(base[previous_end:start])
        out.append(text)
        previous_end = end
        previous_insert_at = start if start == end else None
    out.append(base[previous_end:])
    return "".join(out)


def rebase_body_edits(base: str | None, current: str, base_digest: str, edits: list[dict[str, Any]]) -> str:
    if body_digest(current) == base_digest:
        return apply_edits(current, edits)
    if base is None or body_digest(base) != base_digest:
        raise BodyEditError("concurrent_modification", "body_base_unavailable")
    edited = apply_edits(base, edits)
    merged = merge_body(base, current, edited)
    if merged is None:
        raise BodyEditError("concurrent_modification", "body_conflict")
    return merged


# ------------------------------------------------------------- fixtures

FIXTURE_OPERATIONS = {
    "merge_records",
    "merge_strategies",
    "path_equivalence",
    "allocate_path",
    "derive_path",
    "detect_moves",
    "regex_match",
    "apply_body_edits",
}


def setup_types(setup: dict[str, Any]) -> list[TypeDef]:
    return [load_type(text) for text in (setup.get("types") or {}).values()]


def run_fixture(test: dict[str, Any], setup: dict[str, Any]) -> None:
    operation = test["operation"]
    data = test.get("input") or {}
    expect = test.get("expect") or {}

    if operation == "merge_records":
        paths = data.get("paths") or {"base": data["path"], "first": data["path"], "second": data["path"]}
        result = merge_records(
            setup_types(setup), data["base"], data["first"], data["second"], paths["base"], paths["first"], paths["second"]
        )
        if result.document != expect["document"]:
            raise AssertionError(f"merged document differs:\n{result.document!r}\nexpected:\n{expect['document']!r}")
        conflicts = [{k: v for k, v in c.items() if k in ("kind", "field")} for c in result.conflicts]
        if conflicts != expect.get("conflicts", []):
            raise AssertionError(f"conflicts {conflicts} != expected {expect.get('conflicts')}")
        if "path" in expect and expect["path"] != result.path:
            raise AssertionError(f"path {result.path!r} != expected {expect['path']!r}")
        return

    if operation == "merge_strategies":
        document = parse_document(data["document"])
        types = matched_types(setup_types(setup), data["path"], document.frontmatter)
        if "error" in expect:
            field_name = expect["error"]["field"]
            try:
                strategy(types, field_name)
            except ValueError as exc:
                if expect["error"]["code"] not in str(exc):
                    raise AssertionError(f"unexpected error {exc}") from exc
                return
            raise AssertionError("expected an error")
        for field_name, wanted in expect["strategies"].items():
            actual = strategy(types, field_name)
            if actual != wanted:
                raise AssertionError(f"{field_name}: strategy {actual!r} != expected {wanted!r}")
        return

    if operation == "path_equivalence":
        groups = equivalence_groups(data["paths"])
        if groups != expect["groups"]:
            raise AssertionError(f"groups {groups} != expected {expect['groups']}")
        return

    if operation == "allocate_path":
        path = allocate_path(data["requested"], data.get("existing") or [])
        if path != expect["path"]:
            raise AssertionError(f"path {path!r} != expected {expect['path']!r}")
        return

    if operation == "derive_path":
        try:
            path = derive_path(data["pattern"], data.get("frontmatter") or {})
        except PathError as exc:
            if "error" not in expect or expect["error"].get("code") != exc.code or expect["error"].get("field") != exc.field:
                raise AssertionError(f"unexpected {exc.code} for {exc.field}") from exc
            return
        if expect.get("path") != path:
            raise AssertionError(f"path {path!r} != expected {expect.get('path')!r}")
        return

    if operation == "detect_moves":
        result = detect_moves(data.get("disappeared") or [], data.get("appeared") or [], data.get("id_field"))
        for key in ("moves", "deleted", "created"):
            if result[key] != expect.get(key, []):
                raise AssertionError(f"{key} {result[key]} != expected {expect.get(key)}")
        return

    if operation == "regex_match":
        try:
            matched = regex_match(data["pattern"], data["text"])
        except InvalidPattern as exc:
            if expect.get("error", {}).get("code") != "invalid_pattern":
                raise AssertionError(f"unexpected invalid pattern: {exc}") from exc
            return
        if "error" in expect or matched != expect["matches"]:
            raise AssertionError(f"matches {matched} != expected {expect}")
        return

    if operation == "apply_body_edits":
        base = data.get("base")
        digest = body_digest(base) if base is not None else data["body_base"]
        if not data.get("base_available", True):
            base = None
        try:
            body = rebase_body_edits(base, data["current"], digest, data["edits"])
        except BodyEditError as exc:
            want = expect.get("error") or {}
            if want.get("code") != exc.code or (want.get("details") or {}).get("reason") != exc.reason:
                raise AssertionError(f"unexpected {exc}") from exc
            return
        if "error" in expect or body != expect["body"]:
            raise AssertionError(f"body {body!r} != expected {expect}")
        return

    raise AssertionError(f"no executable model for {operation}")
