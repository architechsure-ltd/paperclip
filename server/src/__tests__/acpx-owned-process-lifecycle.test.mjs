import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = process.cwd();
const require = createRequire(path.join(root, 'server/package.json'));
const runtimePath = require.resolve('acpx/runtime');
const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import(pathToFileURL(runtimePath));
const { ownProcessGroup, processGroupId, closeOwnedProcessGroup } = await import(pathToFileURL(path.join(path.dirname(runtimePath), 'owned-process-group.js')));
const { hasStoppedLocalProcessTree } = await import(pathToFileURL(path.join(root, 'server/src/services/heartbeat/process-settlement.ts')));
function absent(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
const posix = { skip: process.platform === 'win32', timeout: 15000 };
test('fresh and reused ACP sessions retain the same owned OS group', posix, async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'acpx-group-'));
  const identities = [];
  const fixture = path.join(root, 'scripts/mcp-fixtures/servers/acp-cwd-report-agent.mjs');
  const runtime = createAcpRuntime({ cwd,
    sessionStore: createRuntimeStore({stateDir: path.join(cwd, 'state')}),
    agentRegistry: createAgentRegistry({overrides: {custom: `${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}`}}),
    permissionMode: 'approve-all', nonInteractivePermissions: 'deny',
    onAgentSpawn: meta => identities.push(meta),
  });
  let handle;
  try {
    const options = { sessionKey: 'owned-group-reuse', agent: 'custom', mode: 'persistent', cwd, sessionOptions: {env:{}} };
    handle = await runtime.ensureSession(options);
    await runtime.ensureSession(options);
    assert.equal(identities.length, 1);
    const identity = identities[0];
    assert.equal(identity.processGroupId, identity.pid);
    const stat = await readFile(`/proc/${identity.pid}/stat`, 'utf8');
    assert.equal(Number(stat.split(') ').at(-1).split(' ')[2]), identity.processGroupId);
  } finally {
    if (handle) await runtime.close({handle, reason:'done'});
    await rm(cwd, {recursive:true, force:true});
  }
  assert.equal(absent(identities[0].pid), true);
  assert.equal(absent(-identities[0].processGroupId), true);
});
test('missing group fails settlement without a probe', () => {
  let calls=0;
  assert.equal(hasStoppedLocalProcessTree({processPid:10245,processGroupId:null,processStartedAt:new Date()},()=>{calls++;}), false);
  assert.equal(calls,0);
});
test('absent parent with a surviving or unobservable group cannot settle', () => {
  const identity={processPid:12345,processGroupId:12345,processStartedAt:new Date()};
  assert.equal(hasStoppedLocalProcessTree(identity,pid=>{if(pid>0)throw Object.assign(new Error(),{code:'ESRCH'});}),false);
  assert.equal(hasStoppedLocalProcessTree(identity,()=>{throw Object.assign(new Error(),{code:'ESRCH'});}),true);
  assert.equal(hasStoppedLocalProcessTree(identity,()=>{throw Object.assign(new Error(),{code:'EPERM'});}),false);
});
for (const parentExit of [false,true]) {
  test(`bounded shutdown kills a resistant descendant; direct parent exited=${parentExit}`, posix, async () => {
    const program = `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
      setTimeout(()=>{console.log(child.pid);${parentExit ? 'process.exit(0)' : ''}},150);
      process.on('SIGTERM',()=>{});process.stdin.resume();`;
    const parent = spawn(process.execPath,['-e',program],{detached:true,stdio:['pipe','pipe','pipe']});
    await once(parent,'spawn');
    ownProcessGroup(parent);
    const [output] = await once(parent.stdout,'data');
    const descendant = Number(String(output).trim());
    assert.ok(descendant>1);
    if(parentExit && parent.exitCode===null) await once(parent,'exit');
    const start=performance.now();
    try {
      const first=closeOwnedProcessGroup(parent);
      assert.equal(closeOwnedProcessGroup(parent),first);
      await first;
      assert.equal(absent(-parent.pid),true);
      assert.equal(absent(descendant),true);
      assert.ok(performance.now()-start<4000);
    } finally {
      try {process.kill(-parent.pid,'SIGKILL');} catch(error) {if(error.code!=='ESRCH')throw error;}
      parent.stdin.destroy();parent.stdout.destroy();parent.stderr.destroy();
    }
  });
}
test('unknown ownership and permission denial fail closed', async () => {
  const child={pid:2147483646,exitCode:0,signalCode:null,stdin:{end(){}}};
  assert.equal(processGroupId(child),null);
  await assert.rejects(closeOwnedProcessGroup(child),/no authority/);
  ownProcessGroup(child);
  const original=process.kill;
  const signals=[];
  process.kill=(pid,signal)=>{signals.push(signal);throw Object.assign(new Error('denied'),{code:'EPERM'});};
  try {await assert.rejects(closeOwnedProcessGroup(child),{code:'EPERM'});}
  finally {process.kill=original;}
  assert.deepEqual(signals,[0]);
});
test('spawn admission rejection retires the owned group before returning', posix, async () => {
  const cwd=await mkdtemp(path.join(tmpdir(),'acpx-rejected-'));
  let identity;
  const runtime=createAcpRuntime({cwd,sessionStore:createRuntimeStore({stateDir:path.join(cwd,'state')}),
    agentRegistry:createAgentRegistry({overrides:{custom:`${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(root,'scripts/mcp-fixtures/servers/acp-cwd-report-agent.mjs'))}`}}),
    permissionMode:'approve-all',nonInteractivePermissions:'deny',onAgentSpawn:meta=>{identity=meta;throw new Error('admission rejected');}});
  try {
    await assert.rejects(runtime.ensureSession({sessionKey:'rejected',agent:'custom',mode:'oneshot',cwd,sessionOptions:{env:{}}}),/admission rejected/);
    assert.ok(identity?.processGroupId>1);
    assert.equal(absent(identity.pid),true);
    assert.equal(absent(-identity.processGroupId),true);
  } finally {await rm(cwd,{recursive:true,force:true});}
});
