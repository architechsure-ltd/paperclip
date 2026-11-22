#!/usr/bin/env python3
"""ATS-only upstream merge diagnostic.

Runs AFTER git merge --no-commit, only in a throwaway GitHub Actions checkout.
Resolves the known text conflicts conservatively. It does not push or commit.
Unexpected paths or conflict shapes fail closed. Passing this script is not an
approval of the semantic behaviour or ACPX patch.
"""
from __future__ import annotations
import hashlib
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
        raise RuntimeError("ACPX conflict must use the validated package patch from HEAD")
    raise RuntimeError(f"Unrecognised path: {path}")

def main() -> None:
    found = conflicted_paths()
    if found != EXPECTED:
        raise RuntimeError(f"Expected exactly {sorted(EXPECTED)}, got {sorted(found)}")
    for path in sorted(found):
        p = Path(path)
        if path in {"patches/acpx@0.13.1.patch", "pnpm-lock.yaml"}:
            # These two files were validated together via frozen-lockfile CI.
            # Do not recombine generated patch hunks or old dependency graphs.
            data = subprocess.check_output(["git", "show", f"HEAD:{path}"])
            if path == "patches/acpx@0.13.1.patch":
                digest = hashlib.sha256(data).hexdigest()
                expected = "a861fc566594fdfa90311efde61737e3c37ea3403cb5e52234c25bcf9a99d107"
                if digest != expected:
                    raise RuntimeError(f"Unexpected validated ACPX SHA-256: {digest}")
            else:
                blob = subprocess.check_output(
                    ["git", "rev-parse", f"HEAD:{path}"], text=True
                ).strip()
                if blob != "884de5a436743eafe49c6b0edc06e026ca16bbc2":
                    raise RuntimeError(f"Unexpected frozen-lockfile Git blob SHA: {blob}")
                if data.count(b"znmbdzl4jxbijsedt3w4udsaem") != 4:
                    raise RuntimeError("Frozen-lockfile missing exact ACPX hash references")
            p.write_bytes(data)
            subprocess.run(["git", "add", "--", path], check=True)
            print(f"RECONCILED {path}: exact pinned validated integration artifact")
            continue
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
        if path == "server/src/routes/issues.ts":
            required = [
                "const isLegacySelfHandoff =",
                'req.actor.source === "agent_key"',
                'parseObject(error.details).code === "native_stop_pending"',
                "reassignmentStopRequested === true",
                "includeExecutionEvidence: true",
            ]
            for token in required:
                if token not in resolved:
                    raise RuntimeError(f"ATS / upstream reassignment guarantee missing: {token}")
        if re.search(r"(?m)^<<<<<<< |^=======\s*$|^>>>>>>> ", resolved):
            raise RuntimeError(f"{path}: unresolved conflict markers")
        p.write_text(resolved)
        subprocess.run(["git", "add", "--", path], check=True)
        print(f"RECONCILED {path}: {len(matches)} hunk(s) — semantic validation still required")
    if conflicted_paths():
        raise RuntimeError("Not all git conflicts were resolved")
    # ATS master still checks the legacy inline '.tools' list on the adapter
    # MCP server. The pinned upstream runtime intentionally returns only the
    # gateway endpoint/token; the immutable profile must retain the 251 exact
    # selectors and exclusions, as verified by the remaining assertions.
    test_path = Path("server/src/__tests__/heartbeat-runtime-mcp-servers.test.ts")
    test_source = test_path.read_text()
    legacy = (
        "    expect(servers[0]!.tools).toHaveLength(251);\n"
        "    expect(servers[0]!.tools?.every((tool) => tool.approvalMode === \"unattended\")).toBe(true);\n"
    )
    if test_source.count(legacy) != 1:
        raise RuntimeError("Expected exactly one obsolete inline MCP tool-list assertion")
    if 'expect(generatedEntries).toHaveLength(251)' not in test_source or (
        'expect(effective.allowedToolNames).not.toContain("excluded")' not in test_source
    ):
        raise RuntimeError("Missing immutable-profile exact-permission regression assertions")
    test_path.write_text(test_source.replace(legacy, ""))
    subprocess.run(["git", "add", "--", str(test_path)], check=True)
    print("RECONCILED MCP inline tool-list test: retained exact 251-entry and exclusion checks")
    # The real-process handover test's drain can take over Vitest's default
    # 30-second afterAll hook limit even when every journey assertion passed.
    # Bound its teardown explicitly to 90 seconds, without changing runtime.
    journey = Path("server/src/__tests__/legacy-review-handover.integration.test.ts")
    journey_text = journey.read_text()
    original_hook_end = '  });\n  it("Hermes delivers, Lead requests changes, Hermes corrects, Lead accepts, owner approves, parent unblocks"'
    bounded_hook_end = '  }, 90_000);\n  it("Hermes delivers, Lead requests changes, Hermes corrects, Lead accepts, owner approves, parent unblocks"'
    if journey_text.count(original_hook_end) != 1:
        raise RuntimeError("Unexpected legacy handover teardown hook layout")
    journey.write_text(journey_text.replace(original_hook_end, bounded_hook_end))
    subprocess.run(["git", "add", "--", str(journey)], check=True)
    print("RECONCILED handover fixture: bounded 90-second cleanup afterAll")
    subprocess.run(["git", "diff", "--cached", "--check"], check=True)
    print("MERGE TEXT PASS: all known conflict markers resolved in an ephemeral checkout.")
    print("NO COMMIT/PUSH. Do not treat this as production readiness.")

if __name__ == "__main__":
    main()
