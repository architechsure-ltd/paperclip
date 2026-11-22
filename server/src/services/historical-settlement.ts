import { verify, createPublicKey, KeyObject } from 'node:crypto';

// Trust configuration is deployment-owned. Never obtain keys or evidence from
// wake payloads, run output, or a submitting agent. This module has no write path.
export function hasHistoricalSettlement(source: any, envelope: any, trust: any, now = new Date()) {
  try {
    if (!Number.isFinite(trust?.maxAgeMs) || trust.maxAgeMs <= 0 || trust.maxAgeMs > 300000) return false;
    if (!Array.isArray(trust.approvedEvidenceIds) || !trust.approvedEvidenceIds.every((id: unknown) => typeof id === 'string' && id.length > 0)) return false;
    if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') return false;
    const key = trust.keys[envelope.keyId];
    if (!key || key.revoked || key.role !== 'independent-termination-verifier') return false;
    const publicKey = key.publicKey instanceof KeyObject ? key.publicKey : createPublicKey(key.publicKey);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') return false;
    if (!verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, 'base64'))) return false;
    const e = JSON.parse(envelope.payload);
    const stamp = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;
    const start = source.processStartedAt?.getTime();
    const finish = source.finishedAt?.getTime();
    const observed = stamp(e.observedAt), expires = stamp(e.expiresAt);
    if (![start, finish, observed, expires, now.getTime()].every(Number.isFinite)) return false;
    return e.schema === 'paperclip.historical-local-settlement.v1' &&
      e.companyId === source.companyId && e.issueId === source.issueId && e.runId === source.id &&
      Number.isSafeInteger(source.processPid) && source.processPid > 1 &&
      source.processGroupId === null && e.processPid === source.processPid &&
      stamp(e.processStartedAt) === start && e.processGroupId === null &&
      ['succeeded','cancelled','failed','interrupted','timed_out'].includes(source.status) &&
      finish >= start && observed >= finish && observed <= now.getTime() && expires > now.getTime() &&
      expires > observed && expires - observed <= trust.maxAgeMs && now.getTime() - observed <= trust.maxAgeMs &&
      typeof e.evidenceId === 'string' && e.evidenceId.length > 0 && trust.approvedEvidenceIds.includes(e.evidenceId) &&
      typeof e.hostIdentity === 'string' && e.hostIdentity.length > 0 &&
      e.hostIdentity === trust.sourceHosts[source.id] &&
      e.method === 'independently-verified-process-tree-termination' &&
      e.state === 'terminated-with-all-descendants';
  } catch { return false; }
}

// An authorised platform maintainer admits evidence by adding its independently
// reviewed evidenceId and historical source-to-host binding to deployment-owned
// trust configuration. Admission cannot create a signature. Independent verifier
// keys must be provisioned separately from the maintainer and execution agent.
export function localSettlementReady(source: any, envelope: any, trust: any, liveCheck: (source: any) => boolean) {
  return liveCheck(source) || hasHistoricalSettlement(source, envelope, trust);
}
