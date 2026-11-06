"""Verifiable local knowledge bases for the ``knowledge`` claim verifier.

A trusted KB is a directory of curated domains. Each domain has one JSONL
content file and one ``.manifest`` file::

    trusted_kb/
      general/
        general.jsonl
        general.manifest

The manifest is JSON and names the domain URI plus the SHA-256 of the content::

    {
      "format": "zoveli-trusted-kb-v1",
      "domain": "urn:zoveli:kb:general",
      "content": "general.jsonl",
      "sha256": "…64 hex characters…"
    }

Content is hashed after canonicalising CRLF to LF so a Windows checkout with
``core.autocrlf`` still verifies against a manifest generated on POSIX.
A missing, malformed, or mismatched manifest is a hard verification failure:
the knowledge verifier never certifies content it cannot authenticate.

Run ``python -m mathcore.trusted_kb update <root>`` after editing a content
file, or ``verify <root>`` to check every manifest.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

MANIFEST_FORMAT = "zoveli-trusted-kb-v1"
MANIFEST_SUFFIX = ".manifest"
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
_URI = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


class TrustedKbError(Exception):
    """Raised when a trusted KB cannot be authenticated or parsed."""


@dataclass(frozen=True)
class TrustedManifest:
    path: Path
    domain: str
    content_path: Path
    sha256: str
    updated: str = ""


@dataclass(frozen=True)
class TrustedEntry:
    question: str
    answer: str
    source: str
    domain: str
    content: str
    line: int


@dataclass
class LoadedTrustedKb:
    root: Path
    manifests: List[TrustedManifest] = field(default_factory=list)
    entries: List[TrustedEntry] = field(default_factory=list)

    def find(self, normalized_question: str, normalize: Any) -> Tuple[Optional[TrustedEntry], Optional[str]]:
        """Return the matching entry, or an error when the question is ambiguous."""
        matches = [entry for entry in self.entries if normalize(entry.question) == normalized_question]
        if len(matches) > 1:
            domains = ", ".join(sorted({entry.domain for entry in matches}))
            return None, f"question is defined in more than one trusted domain ({domains}); refusing to choose"
        return (matches[0] if matches else None), None


def canonical_bytes(data: bytes) -> bytes:
    """Hash-stable content bytes across Git line-ending conversions."""
    return data.replace(b"\r\n", b"\n")


def content_sha256(path: Path) -> str:
    try:
        return hashlib.sha256(canonical_bytes(path.read_bytes())).hexdigest()
    except OSError as exc:
        raise TrustedKbError(f"could not read trusted content {path}: {exc}") from exc


def manifest_paths(root: Path) -> List[Path]:
    """Resolve manifests for a KB root (directory) or a single content file."""
    root = root.expanduser()
    if root.is_file():
        candidates = [Path(str(root) + MANIFEST_SUFFIX), root.with_suffix(MANIFEST_SUFFIX)]
        return [path for path in candidates if path.is_file()]
    if root.is_dir():
        return sorted(path for path in root.rglob(f"*{MANIFEST_SUFFIX}") if path.is_file())
    return []


def _resolve_content(root: Path, manifest: Path, name: str) -> Path:
    candidate = Path(name).expanduser()
    if candidate.is_absolute():
        raise TrustedKbError(f"manifest {manifest} must reference content relative to its directory")
    content = (manifest.parent / candidate).resolve()
    try:
        content.relative_to(manifest.parent.resolve())
    except ValueError as exc:
        raise TrustedKbError(f"manifest {manifest} content escapes its directory: {name}") from exc
    if root.is_file() and content != root.resolve():
        raise TrustedKbError(f"manifest {manifest} points at {content}, not {root}")
    return content


def _read_manifest(path: Path, root: Path) -> TrustedManifest:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise TrustedKbError(f"could not read manifest {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise TrustedKbError(f"manifest {path} is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise TrustedKbError(f"manifest {path} must be a JSON object")

    fmt = payload.get("format", MANIFEST_FORMAT)
    if fmt != MANIFEST_FORMAT:
        raise TrustedKbError(f"manifest {path} has unsupported format {fmt!r}")

    domain = payload.get("domain")
    if not isinstance(domain, str) or not _URI.match(domain.strip()):
        raise TrustedKbError(f"manifest {path} must declare a domain URI (for example urn:zoveli:kb:general)")

    digest = payload.get("sha256")
    if not isinstance(digest, str) or not _SHA256.match(digest.strip()):
        raise TrustedKbError(f"manifest {path} must declare a 64-character SHA-256 digest")

    raw_content = payload.get("content")
    if raw_content is None:
        if root.is_file():
            content = root.resolve()
        else:
            content = (path.with_suffix(".jsonl")).resolve()
    elif isinstance(raw_content, str) and raw_content.strip():
        content = _resolve_content(root, path, raw_content.strip())
    else:
        raise TrustedKbError(f"manifest {path} content must be a non-empty string")

    updated = payload.get("updated", "")
    if updated is not None and not isinstance(updated, str):
        raise TrustedKbError(f"manifest {path} updated must be a string")
    return TrustedManifest(
        path=path,
        domain=domain.strip(),
        content_path=content,
        sha256=digest.strip().lower(),
        updated=updated or "",
    )


def _read_entries(manifest: TrustedManifest) -> List[TrustedEntry]:
    content = manifest.content_path
    if not content.is_file():
        raise TrustedKbError(f"trusted content for {manifest.domain} is missing: {content}")
    actual = content_sha256(content)
    if actual != manifest.sha256:
        raise TrustedKbError(
            f"trusted content hash mismatch for {manifest.domain} ({content}): "
            f"manifest {manifest.sha256}, actual {actual}"
        )
    try:
        lines = content.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise TrustedKbError(f"could not read trusted content {content}: {exc}") from exc

    entries: List[TrustedEntry] = []
    for line_no, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise TrustedKbError(f"{content} line {line_no} is not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise TrustedKbError(f"{content} line {line_no} must be a JSON object")
        question = payload.get("question")
        answer = payload.get("answer")
        if not isinstance(question, str) or not question.strip():
            raise TrustedKbError(f"{content} line {line_no} has no question")
        if not isinstance(answer, str) or not answer.strip():
            raise TrustedKbError(f"{content} line {line_no} has no answer")
        source = payload.get("source", "")
        if source is not None and not isinstance(source, str):
            raise TrustedKbError(f"{content} line {line_no} source must be a string")
        entries.append(
            TrustedEntry(
                question=question,
                answer=answer,
                source=source or "",
                domain=manifest.domain,
                content=str(content),
                line=line_no,
            )
        )
    return entries


def load_trusted_kb(root: Path) -> LoadedTrustedKb:
    """Authenticate every manifest and parse its content. Fail closed."""
    root = root.expanduser()
    if not root.exists():
        raise TrustedKbError(f"trusted knowledge base does not exist: {root}")
    manifests = manifest_paths(root)
    if not manifests:
        where = f" for {root}" if root.is_file() else f" under {root}"
        raise TrustedKbError(f"missing .manifest{where}; trusted content cannot be certified")
    loaded = LoadedTrustedKb(root=root)
    for path in manifests:
        manifest = _read_manifest(path, root)
        loaded.manifests.append(manifest)
        loaded.entries.extend(_read_entries(manifest))
    return loaded


def verify_root(root: Path) -> List[str]:
    """Return a human-readable status line per manifest; raises on failure."""
    root = root.expanduser()
    loaded = load_trusted_kb(root)
    return [
        f"{manifest.domain}: OK ({manifest.content_path.name}, {manifest.sha256})"
        for manifest in loaded.manifests
    ]


def update_manifests(root: Path) -> List[Path]:
    """Rewrite each manifest's SHA-256 from the current content.

    Also creates a manifest for a bare ``.jsonl`` file when one is missing.
    This is a curation tool, not a verification path: run ``verify_root``
    afterwards and commit both the content and manifest together.
    """
    root = root.expanduser()
    if not root.exists():
        raise TrustedKbError(f"trusted knowledge base does not exist: {root}")
    paths = manifest_paths(root)
    if not paths and root.is_file():
        paths = [Path(str(root) + MANIFEST_SUFFIX)]
    if not paths and root.is_dir():
        paths = [path for path in sorted(root.rglob("*.jsonl"))]
    if not paths:
        raise TrustedKbError(f"no manifests or .jsonl content found under {root}")

    written: List[Path] = []
    for path in paths:
        if path.suffix == ".jsonl":
            manifest_path = path.with_suffix(MANIFEST_SUFFIX)
            domain = f"urn:zoveli:kb:{path.stem.replace('_', '-')}"
            content = path
        else:
            manifest_path = path
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            domain = str(payload.get("domain") or f"urn:zoveli:kb:{path.stem.replace('_', '-')}")
            content_name = payload.get("content")
            content = (
                (path.parent / content_name).resolve()
                if isinstance(content_name, str) and content_name
                else path.with_suffix(".jsonl").resolve()
            )
        if not content.is_file():
            raise TrustedKbError(f"trusted content is missing: {content}")
        manifest = {
            "format": MANIFEST_FORMAT,
            "domain": domain,
            "content": content.name,
            "sha256": content_sha256(content),
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        written.append(manifest_path)
    return written


def _main(argv: Optional[Iterable[str]] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="python -m mathcore.trusted_kb")
    parser.add_argument("action", choices=("verify", "update"))
    parser.add_argument("root", nargs="?", default="trusted_kb")
    args = parser.parse_args(list(argv) if argv is not None else None)
    path = Path(args.root)
    try:
        if args.action == "update":
            for manifest in update_manifests(path):
                print(f"updated {manifest}")
        else:
            for line in verify_root(path):
                print(line)
    except TrustedKbError as exc:
        print(f"ERROR: {exc}")
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the CLI tests
    raise SystemExit(_main())
