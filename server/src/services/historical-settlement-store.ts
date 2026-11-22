import { readFile } from 'node:fs/promises';
import { hasHistoricalSettlement } from './historical-settlement.js';

// The path is supplied only by server deployment configuration. No HTTP body,
// task payload, run metadata or agent-controlled workspace supplies this path.
// Maintainer admission updates this protected file through normal deployment
// approval. There is deliberately no API, SQL update, or receipt-minting command.
export async function admittedHistoricalSettlement(source: any, admissionPath: string | undefined, now?: Date) {
  if (!admissionPath) return false;
  try {
    const admission = JSON.parse(await readFile(admissionPath, 'utf8'));
    if (admission.schema !== 'paperclip.historical-local-admissions.v1') return false;
    return hasHistoricalSettlement(source, admission.envelopes?.[source.id], admission.trust, now ?? new Date());
  } catch { return false; }
}
