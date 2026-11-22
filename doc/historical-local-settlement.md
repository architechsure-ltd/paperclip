# Historical local process settlement

This optional fallback admits separately signed termination evidence for an old local run that has no process group ID. All other retained wake readiness checks still apply.

A platform maintainer must obtain deployment approval and independently verify the source host binding. A separate trusted verifier must prove that the exact process generation and all descendants have terminated. The verifier signs the exact JSON payload bytes with Ed25519. The evidence expires within five minutes and must be refreshed after expiry.

Set PAPERCLIP_HISTORICAL_SETTLEMENT_ADMISSIONS only in protected server deployment configuration. Execution agents must not control this file or the verifier key. The file schema is paperclip.historical-local-admissions.v1. It contains envelopes keyed by source run ID and a trust object with keys, maxAgeMs, approvedEvidenceIds and sourceHosts. Each key has publicKey (SPKI PEM), role independent-termination-verifier and optional revoked. Each envelope has keyId, payload and signature (base64).

The payload schema is paperclip.historical-local-settlement.v1. It binds companyId, issueId, runId, processPid, null processGroupId, processStartedAt, observedAt, expiresAt, evidenceId and hostIdentity. Its method is independently-verified-process-tree-termination. Its state is terminated-with-all-descendants.

No evidence is included in this change. No signer or verifier service is added. PID absence, successful run status, released leases and a controller restart do not establish this proof. If no approved independent proof is available, leave the wake deferred. After approved deployment and admission, use the existing retained wake worker. Verify its successor run and original wake ID before reporting recovery.
