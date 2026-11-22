import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admittedHistoricalSettlement } from '../services/historical-settlement-store.ts';
test('admission loader fails closed without deployment admission or for unreadable data',async()=>{
 assert.equal(await admittedHistoricalSettlement({},undefined),false);
 assert.equal(await admittedHistoricalSettlement({},'/nonexistent/arc127-admission.json'),false);
 assert.equal(await admittedHistoricalSettlement({},new URL('./manifest.json',import.meta.url)),false);
});
