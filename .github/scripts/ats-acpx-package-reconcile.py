#!/usr/bin/env python3
"""Reconcile EXACT ACPX 0.13.1 conflicts between ATS and upstream stable.

Use only in a disposable acpx@0.13.1 checkout after a 3-way merge:
upstream branch checked out; merging the ATS branch. No GitHub writes.
Fail closed on any unrecognised conflict. Runtime JS must be tested separately.
"""
from pathlib import Path
import re
import subprocess

CONFLICTS = {
    "dist/live-checkpoint-BSIrfgVo.js": 4,
    "dist/runtime.d.ts": 1,
    "dist/session-options-DwRDODlr.d.ts": 1,
}
MARKER = re.compile(r"(?ms)^<<<<<<< [^\n]+\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]+\n")

def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()

def pick(path: str, index: int, left: str, right: str) -> str:
    if path == "dist/live-checkpoint-BSIrfgVo.js":
        if index == 0:
            if left.strip() or right.strip() != 'detached: process.platform !== "win32",':
                raise ValueError("Unexpected process spawn ownership hunk")
            return right
        if index == 1:
            if not all(t in left for t in ["await this.options.onAgentSpawn(", 'child.kill("SIGKILL")']) or not all(
                t in right for t in ["processGroupId: processGroupId(child)", "await this.terminateAgentProcess(child)"]
            ):
                raise ValueError("Unexpected agent spawn failure hunk")
            # ATS callback reports the process group, and its close method shuts down descendants.
            return right
        if index == 2:
            if left.strip() or "ownProcessGroup(spawnedChild)" not in right:
                raise ValueError("Unexpected group ownership registration hunk")
            return right
        if index == 3:
            if not all(t in left for t in ["model or config options", "Retained connections"]) or not all(
                t in right for t in ["model", "Retained connections"]
            ):
                raise ValueError("Unexpected upstream comment hunk")
            # Upstream includes a newer config-option replay explanation.
            return left
    if path in {"dist/runtime.d.ts", "dist/session-options-DwRDODlr.d.ts"}:
        if index != 0 or "onAgentSpawn?:" not in left or "processGroupId: number | null" not in right:
            raise ValueError(f"Unexpected callback typing hunk in {path}")
        return right
    raise ValueError(f"Unexpected conflict {path} index {index}")

def main() -> None:
    found = set(filter(None, git("diff", "--name-only", "--diff-filter=U").splitlines()))
    if found != set(CONFLICTS):
        raise RuntimeError(f"Expected conflicts {sorted(CONFLICTS)}, received {sorted(found)}")
    for path, expected_count in CONFLICTS.items():
        p = Path(path)
        source = p.read_text()
        matches = list(MARKER.finditer(source))
        if len(matches) != expected_count:
            raise RuntimeError(f"{path}: expected {expected_count} hunks, found {len(matches)}")
        parts = []
        start = 0
        for i, m in enumerate(matches):
            parts.append(source[start:m.start()])
            parts.append(pick(path, i, m.group(1), m.group(2)))
            start = m.end()
        parts.append(source[start:])
        resolved = "".join(parts)
        if "<<<<<<< " in resolved or ">>>>>>> " in resolved:
            raise RuntimeError(f"Unresolved markers remain in {path}")
        p.write_text(resolved)
        subprocess.run(["git", "add", "--", path], check=True)
        print(f"RESOLVED {path} ({len(matches)} expected sections)")
    if git("diff", "--name-only", "--diff-filter=U"):
        raise RuntimeError("Git still has unmerged paths")
    subprocess.run(["git", "diff", "--cached", "--check"], check=True)
    source = Path("dist/live-checkpoint-BSIrfgVo.js").read_text()
    required = [
        'detached: process.platform !== "win32",',
        'ownProcessGroup(spawnedChild)',
        "await this.terminateAgentProcess(child)",
        "processGroupId: processGroupId(child)",
    ]
    for token in required:
        if token not in source:
            raise RuntimeError(f"Missing ATS process ownership invariant: {token}")
    for path in ("dist/runtime.d.ts", "dist/session-options-DwRDODlr.d.ts"):
        if "processGroupId: number | null" not in Path(path).read_text():
            raise RuntimeError(f"Missing processGroupId type: {path}")
    for name in ("ownProcessGroup", "processGroupId", "closeOwnedProcessGroup"):
        if f"export function {name}(" not in Path("dist/owned-process-group.js").read_text():
            raise RuntimeError(f"Missing owned group API: {name}")
    print("ACPX source reconciliation: EXACT-SHAPE PASS (behavioural tests still required)")

if __name__ == "__main__":
    main()
