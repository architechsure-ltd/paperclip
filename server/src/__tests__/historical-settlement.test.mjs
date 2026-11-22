import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { hasHistoricalSettlement as check, localSettlementReady } from '../services/historical-settlement.ts';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const now = new Date('2026-11-08T16:00:00Z');
const source = { companyId:'company',issueId:'issue',id:'run',processPid:10245,processGroupId:null,processStartedAt:new Date('2026-11-08T14:08:36Z'),finishedAt:new Date('2026-11-08T14:10:38Z'),status:'succeeded' };
const evidence = {schema:'paperclip.historical-local-settlement.v1',companyId:'company',issueId:'issue',runId:'run',processPid:10245,processGroupId:null,processStartedAt:source.processStartedAt.toISOString(),observedAt:'2026-11-08T15:59:00Z',expiresAt:'2026-11-08T16:04:00Z',evidenceId:'proof',hostIdentity:'host',method:'independently-verified-process-tree-termination',state:'terminated-with-all-descendants'};
const trust = {keys:{verifier:{publicKey,role:'independent-termination-verifier'}},maxAgeMs:300000,approvedEvidenceIds:['proof'],sourceHosts:{run:'host'}};
function envelope(changes={}) { const payload=JSON.stringify({...evidence,...changes});return {keyId:'verifier',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')}; }
test('accepts separately signed and maintainer-admitted exact historical identity',()=>assert.equal(check(source,envelope(),trust,now),true));
test('rejects missing, unsigned, altered and untrusted evidence',()=>{
 for(const e of [null,{}, {...envelope(),signature:''},{...envelope(),payload:'{}'},{...envelope(),keyId:'agent'}]) assert.equal(check(source,e,trust,now),false);
 assert.equal(check(source,envelope(),{...trust,approvedEvidenceIds:[]},now),false);
 assert.equal(check(source,envelope(),{...trust,keys:{verifier:{publicKey,role:'execution-agent'}}},now),false);
});
test('rejects stale, future, overlong and pre-terminal observations',()=>{
 for(const change of [{expiresAt:now.toISOString()},{observedAt:'2026-11-08T16:01:00Z'},{expiresAt:'2026-11-09T16:00:00Z'},{observedAt:'2026-11-08T14:00:00Z'}]) assert.equal(check(source,envelope(change),trust,now),false);
});
test('rejects every mismatched process, host, run and evidence binding',()=>{
 for(const field of ['companyId','issueId','runId','processPid','processGroupId','processStartedAt','hostIdentity','method','state','evidenceId','schema']) assert.equal(check(source,envelope({[field]:'wrong'}),trust,now),false,field);
 assert.equal(check({...source,status:'running'},envelope(),trust,now),false);
 assert.equal(check({...source,processGroupId:10245},envelope(),trust,now),false);
 assert.equal(check(source,envelope(),{...trust,sourceHosts:{}},now),false);
});
test('fallback cannot turn missing evidence into settlement',()=>assert.equal(localSettlementReady(source,null,trust,()=>false),false));

test('rejects malformed freshness policy and timestamps',()=>{
 for(const maxAgeMs of [undefined,NaN,Infinity,0,-1,300001]) assert.equal(check(source,envelope(),{...trust,maxAgeMs},now),false);
 for(const field of ['observedAt','expiresAt','processStartedAt']) assert.equal(check(source,envelope({[field]:'invalid'}),trust,now),false);
 assert.equal(check(source,envelope(),trust,new Date('invalid')),false);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 const e=envelope(); e.signature=sign('sha256',Buffer.from(e.payload),rsa.privateKey).toString('base64');
 assert.equal(check(source,e,{...trust,keys:{verifier:{publicKey:rsa.publicKey,role:'independent-termination-verifier'}}},now),false);
});

test('rejects malformed approval lists and empty evidence identities',()=>{
 for(const approvedEvidenceIds of ['prefix-proof-suffix',null,{},[1],['']]) assert.equal(check(source,envelope(),{...trust,approvedEvidenceIds},now),false);
 assert.equal(check(source,envelope({evidenceId:''}),{...trust,approvedEvidenceIds:['']},now),false);
});
