# ACPX owned process groups

The patched 0.13.1 runtime creates a detached POSIX group only for its native spawn. The group identity belongs to the live ChildProcess object. Custom spawn callbacks, including remote transports, do not acquire local group authority. Windows retains its existing direct-child behavior.

The adapter forwards reported group identity for fresh and cached sessions. The existing credential gate for warm reuse remains unchanged. The server still requires independent PID and group absence before local stage settlement. Cleanup success is not a settlement receipt.

Shutdown closes stdin, then probes the owned group and direct child. It escalates to TERM and KILL even after direct-child exit. The grace periods are 100ms (750ms for Qoder), 1500ms and 1000ms. Concurrent cleanup calls share one promise. An absent group is never signalled again. Permission errors and a deadline with remaining processes reject cleanup. The normal readiness and recovery paths retain ownership of failed settlement.

This patch does not track a descendant that deliberately leaves the owned group. It does not change historical execution identity or admit historical settlement evidence.

Validation runs in GitHub Actions. The workflow prepares workspace links and plugin SDK build dependencies before test collection. It records lockfile resolution changes, tests, typecheck and build outcomes. Commit the reviewed lockfile refresh before merge. A complete unattended engineering, review, changes-requested, correction and acceptance cycle remains a separate acceptance requirement. Production deployment requires approval.
