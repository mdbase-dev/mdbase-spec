"""Executable model of type-pack assessment and apply for seed upgrades (05A).

This is not an engine. It models the normative rules the seed-upgrade
conformance fixtures exercise: manifest validation of `upgrade_from`, the lock's
seed `origin_digest`, the ordered choice of an upgrade baseline, and a
structural three-way merge of type frontmatter that keeps the live body.
Contract-implementation merging and other engine detail are out of scope.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
PACK_SCHEMA = Draft202012Validator(
    __import__("json").loads((ROOT / "schemas/v0.3/type-pack.schema.json").read_text())
)
MISSING = object()


class PackInvalid(Exception):
    """The manifest is invalid (`invalid_type_pack`)."""


class MergeConflict(Exception):
    """Competing changes; the merge fails closed."""


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def split_document(data: bytes) -> tuple[dict[str, Any], str]:
    text = data.decode()
    if not text.startswith("---\n"):
        raise ValueError("document has no frontmatter")
    end = text.index("\n---\n", 4)
    frontmatter = yaml.safe_load(text[4:end + 1]) or {}
    if not isinstance(frontmatter, dict):
        raise ValueError("frontmatter is not a mapping")
    return frontmatter, text[end + 5:]


def join_document(frontmatter: dict[str, Any], body: str) -> bytes:
    rendered = yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=True)
    return f"---\n{rendered}---\n{body}".encode()


@dataclass
class Baseline:
    digest: str
    document: bytes
    version: int | None


@dataclass
class Resource:
    kind: str
    mode: str
    source: str
    target: str
    digest: str
    document: bytes
    baselines: list[Baseline] = field(default_factory=list)
    declares_upgrade: bool = False


@dataclass
class Pack:
    id: str
    version: str
    digest: str
    resources: list[Resource]


def load_pack(path: Path) -> Pack:
    manifest = yaml.safe_load(path.read_text())
    errors = sorted(PACK_SCHEMA.iter_errors(manifest), key=lambda error: list(error.path))
    if errors:
        raise PackInvalid(errors[0].message)
    resources = []
    for entry in manifest["resources"]:
        document = (path.parent / entry["source"]).read_bytes()
        if digest(document) != entry["digest"]:
            raise PackInvalid(f"digest mismatch for {entry['source']}")
        resource = Resource(
            entry["kind"], entry["mode"], entry["source"], entry["target"], entry["digest"], document
        )
        if "upgrade_from" in entry:
            resource.declares_upgrade = True
            resource.baselines = validate_baselines(resource, entry["upgrade_from"])
        resources.append(resource)
    canonical = __import__("json").dumps(manifest, sort_keys=True, separators=(",", ":"))
    return Pack(manifest["id"], manifest["version"], digest(canonical.encode()), resources)


def validate_baselines(resource: Resource, declared: Any) -> list[Baseline]:
    if resource.kind != "type" or resource.mode != "seed":
        raise PackInvalid("upgrade_from is only valid on seed type resources")
    desired, _ = split_document(resource.document)
    entries = declared if isinstance(declared, list) else [declared]
    baselines: list[Baseline] = []
    seen: set[str] = set()
    for entry in entries:
        document = entry["document"].encode()
        if digest(document) != entry["digest"]:
            raise PackInvalid("an upgrade baseline's digest does not match its document")
        if entry["digest"] in seen:
            raise PackInvalid("upgrade baselines must have distinct digests")
        if entry["digest"] == resource.digest:
            raise PackInvalid("an upgrade baseline cannot be the desired document")
        frontmatter, _ = split_document(document)
        if frontmatter.get("kind") != desired.get("kind") or frontmatter.get("name") != desired.get("name"):
            raise PackInvalid("an upgrade baseline must be the same type kind and name")
        version = entry.get("version")
        if version is not None and frontmatter.get("version") != version:
            raise PackInvalid("an upgrade baseline's version differs from its document")
        seen.add(entry["digest"])
        baselines.append(Baseline(entry["digest"], document, version))
    return baselines


@dataclass
class Planned:
    target: str
    action: str
    bytes: bytes | None
    origin: str | None
    reason: str | None = None
    baseline: Baseline | None = None


@dataclass
class Assessment:
    status: str
    resources: list[Planned]

    @property
    def applicable(self) -> bool:
        return self.status != "conflict"


@dataclass
class Collection:
    files: dict[str, bytes] = field(default_factory=dict)
    lock: dict[str, dict[str, Any]] = field(default_factory=dict)

    def assess(self, pack: Pack) -> Assessment:
        receipt = self.lock.get(pack.id)
        installed = (receipt or {}).get("resources", {})
        planned = [self._plan(resource, installed.get(resource.target)) for resource in pack.resources]
        if any(item.action == "conflict" for item in planned):
            status = "conflict"
        elif receipt is None:
            status = "install"
        elif receipt["version"] == pack.version and receipt["digest"] == pack.digest:
            status = "current"
        else:
            status = "upgrade"
        return Assessment(status, planned)

    def apply(self, pack: Pack) -> Assessment:
        assessment = self.assess(pack)
        if not assessment.applicable:
            return assessment
        for item in assessment.resources:
            if item.bytes is not None:
                self.files[item.target] = item.bytes
        self.lock[pack.id] = {
            "version": pack.version,
            "digest": pack.digest,
            "resources": {
                resource.target: {
                    "mode": resource.mode,
                    "digest": resource.digest,
                    **({"origin_digest": item.origin} if resource.mode == "seed" and item.origin else {}),
                }
                for resource, item in zip(pack.resources, assessment.resources)
            },
        }
        return assessment

    def _plan(self, resource: Resource, entry: dict[str, Any] | None) -> Planned:
        live = self.files.get(resource.target)
        if resource.mode == "managed":
            return self._plan_managed(resource, entry, live)
        previous_origin = (entry or {}).get("origin_digest")
        if live is None:
            if entry is None:
                return Planned(resource.target, "create", resource.document, resource.digest)
            return Planned(resource.target, "preserve", None, previous_origin)
        if live == resource.document:
            return Planned(resource.target, "preserve", None, resource.digest)
        if not resource.declares_upgrade:
            return Planned(resource.target, "preserve", None, previous_origin)
        for baseline in resource.baselines:
            if live == baseline.document:
                return Planned(resource.target, "update", resource.document, resource.digest, baseline=baseline)
        if previous_origin == resource.digest:
            return Planned(resource.target, "preserve", None, previous_origin)
        baseline = next((item for item in resource.baselines if item.digest == previous_origin), None)
        if baseline is None:
            return Planned(
                resource.target, "preserve", None, previous_origin,
                reason=f"{resource.target}: no upgrade baseline applies to this type's origin",
            )
        try:
            merged = merge_documents(baseline.document, live, resource.document)
        except MergeConflict as conflict:
            return Planned(resource.target, "conflict", None, previous_origin, reason=f"{resource.target}: {conflict}")
        return Planned(resource.target, "update", merged, resource.digest, baseline=baseline)

    def _plan_managed(self, resource: Resource, entry: dict[str, Any] | None, live: bytes | None) -> Planned:
        if live is None:
            return Planned(resource.target, "create", resource.document, None)
        if live == resource.document:
            return Planned(resource.target, "unchanged" if entry else "adopt", None, None)
        if entry is not None and digest(live) == entry["digest"]:
            return Planned(resource.target, "update", resource.document, None)
        return Planned(resource.target, "conflict", None, None, reason=f"{resource.target} changed")


def merge_documents(base: bytes, live: bytes, desired: bytes) -> bytes:
    base_frontmatter, _ = split_document(base)
    live_frontmatter, live_body = split_document(live)
    desired_frontmatter, _ = split_document(desired)
    for key in ("kind", "name"):
        if live_frontmatter.get(key) != desired_frontmatter.get(key):
            raise MergeConflict(f"type {key} differs")
    for key in base_frontmatter:
        if key not in desired_frontmatter and key in live_frontmatter:
            raise MergeConflict(f"removing top-level setting {key} requires manual review")
    merged = merge_values(base_frontmatter, live_frontmatter, desired_frontmatter, "")
    return join_document(merged, live_body)


def merge_values(base: Any, live: Any, desired: Any, path: str) -> Any:
    if live == base:
        return desired
    if desired == base or live == desired:
        return live
    if all(isinstance(value, dict) for value in (base, live, desired)) or (
        base is MISSING and isinstance(live, dict) and isinstance(desired, dict)
    ):
        base = {} if base is MISSING else base
        merged: dict[str, Any] = {}
        for key in list(live) + [key for key in desired if key not in live]:
            value = merge_values(
                base.get(key, MISSING), live.get(key, MISSING), desired.get(key, MISSING), f"{path}/{key}"
            )
            if value is not MISSING:
                merged[key] = value
        return merged
    raise MergeConflict(f"competing changes at {path or '/'}")
