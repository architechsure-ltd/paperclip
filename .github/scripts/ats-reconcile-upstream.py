#!/usr/bin/env python3
"""ATS-only upstream merge diagnostic.

Runs AFTER git merge --no-commit, only in a throwaway GitHub Actions checkout.
Resolves the known text conflicts conservatively. It does not push or commit.
Unexpected paths or conflict shapes fail closed. Passing this script is not an
approval of the semantic behaviour or ACPX patch.
"""
from __future__ import annotations
import re
import subprocess
from pathlib import Path

EXPECTED = {
    "doc/DEVELOPING.md",
    "patches/acpx@0.13.1.patch",
    "pnpm-lock.yaml",
    "server/src/routes/issues.ts",
    "server/src/services/heartbeat.ts",
    "server/src/services/heartbeat/queue.ts",
    "server/src/services/legacy-execution-recovery.ts",
    "tests/runner-e2e/report-lock.json",
    "tests/runner-e2e/report-lock.patch",
}
MARKER = re.compile(r"(?ms)^<<<<<<< [^\n]+\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]+\n")

def conflicted_paths() -> set[str]:
    raw = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=U"], text=True
    )
    return set(filter(None, raw.splitlines()))

def merge_imports(left: str, right: str, path: str) -> str:
    def is_import_fragment(t: str) -> bool:
        return all(not line.strip() or line.lstrip().startswith("import ")
                   for line in t.splitlines())
    if not is_import_fragment(left) or not is_import_fragment(right):
        raise RuntimeError(f"{path}: expected imports-only conflict")
    lines = []
    for line in (left + right).splitlines(keepends=True):
        if line not in lines:
            lines.append(line)
    return "".join(lines)

def reconcile(path: str, left: str, right: str, index: int, whole: str) -> str:
    if path in {
        "server/src/services/heartbeat.ts",
        "server/src/services/heartbeat/queue.ts",
        "server/src/services/legacy-execution-recovery.ts",
    }:
        return merge_imports(left, right, path)
    if path == "server/src/routes/issues.ts":
        if index == 0:
            return merge_imports(left, right, path)
        if index == 1 and "if (runToStopForReassignment && !isHumanSelfHandoff)" in left and "if (runToStopForReassignment && !isLegacySelfHandoff)" in right:
            if "const isLegacySelfHandoff =" not in whole:
                raise RuntimeError("ATS legacy self-handoff predicate not present")
            # Preserve the stable release's robust durable native-stop flow,
            # widening only the self-handoff exemption under the ATS predicate.
            return left.replace("!isHumanSelfHandoff", "!isLegacySelfHandoff")
        raise RuntimeError("Unexpected additional reassignment conflict")
    if path == "doc/DEVELOPING.md":
        # Both branches appended distinct material at the same location.
        return left.rstrip() + "\n\n" + right.lstrip()
    if path in {
        "pnpm-lock.yaml",
        "tests/runner-e2e/report-lock.json",
        "tests/runner-e2e/report-lock.patch",
    }:
        # Always prefer pinned stable proof; regenerate against changed patches
        # only after package-install and report-lock verification.
        return left
    if path == "patches/acpx@0.13.1.patch":
        if index == 0 and left.lstrip().startswith("index "):
            return left
        if "@@" in right:
            return right
        raise RuntimeError("Unexpected ACPX patch conflict; do not guess")
    raise RuntimeError(f"Unrecognised path: {path}")

def main() -> None:
    found = conflicted_paths()
    if found != EXPECTED:
        raise RuntimeError(f"Expected exactly {sorted(EXPECTED)}, got {sorted(found)}")
    for path in sorted(found):
        p = Path(path)
        content = p.read_text()
        matches = list(MARKER.finditer(content))
        if not matches:
            raise RuntimeError(f"{path}: no conflict markers found")
        parts = []
        prior = 0
        for index, match in enumerate(matches):
            parts.append(content[prior:match.start()])
            parts.append(reconcile(path, match.group(1), match.group(2), index, content))
            prior = match.end()
        parts.append(content[prior:])
        resolved = "".join(parts)
        if re.search(r"(?m)^<<<<<<< |^=======\s*$|^>>>>>>> ", resolved):
            raise RuntimeError(f"{path}: unresolved conflict markers")
        p.write_text(resolved)
        subprocess.run(["git", "add", "--", path], check=True)
        print(f"RECONCILED {path}: {len(matches)} hunk(s) — semantic validation still required")
    if conflicted_paths():
        raise RuntimeError("Not all git conflicts were resolved")
    subprocess.run(["git", "diff", "--cached", "--check"], check=True)
    print("MERGE TEXT PASS: all known conflict markers resolved in an ephemeral checkout.")
    print("NO COMMIT/PUSH. Do not treat this as production readiness.")

if __name__ == "__main__":
    main()
