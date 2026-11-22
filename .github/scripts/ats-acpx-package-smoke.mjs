// Bounded, local-only smoke tests for an ACPX 0.13.1 patch in a throwaway package directory.
// No provider calls, repository changes, or privileged operations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.env.ACPX_PATCHED_ROOT;
if (!root || !path.isAbsolute(root)) throw new Error('ACPX_PATCHED_ROOT must be absolute');
const { ownProcessGroup, processGroupId, closeOwnedProcessGroup } = await import(
  pathToFileURL(path.join(root, 'dist/owned-process-group.js')).href
);
function absent(pid) {
  try { process.kill(pid, 0); return false; }
  catch (e) { if (e.code === 'ESRCH') return true; throw e; }
}
test('exact patch exports the three ATS owned-group operations', () => {
  assert.equal(typeof ownProcessGroup, 'function');
  assert.equal(typeof processGroupId, 'function');
  assert.equal(typeof closeOwnedProcessGroup, 'function');
});
test('unowned processes fail closed', async () => {
  const fake = { pid: 2147483646, exitCode: 0, signalCode: null, stdin: { end() {} } };
  assert.equal(processGroupId(fake), null);
  await assert.rejects(closeOwnedProcessGroup(fake), /no authority/);
});
for (const parentExit of [false, true]) {
  test(`bounded POSIX process-group shutdown, parent exits early=${parentExit}`, {skip:process.platform==='win32', timeout:15000}, async () => {
    const code = `const {spawn}=require('node:child_process');
      const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
      setTimeout(()=>{console.log(c.pid); ${parentExit ? 'process.exit(0)' : ''}},150);
      process.on('SIGTERM',()=>{}); process.stdin.resume();`;
    const parent = spawn(process.execPath, ['-e', code], {detached:true, stdio:['pipe','pipe','pipe']});
    await once(parent, 'spawn');
    ownProcessGroup(parent);
    const [chunk] = await once(parent.stdout, 'data');
    const descendant = Number(String(chunk).trim());
    assert.ok(descendant>1);
    assert.equal(processGroupId(parent), parent.pid);
    if (parentExit && parent.exitCode === null) await once(parent, 'exit');
    const start = performance.now();
    try {
      const closed = closeOwnedProcessGroup(parent);
      assert.equal(closeOwnedProcessGroup(parent), closed);
      await closed;
      assert.equal(absent(-parent.pid), true);
      assert.equal(absent(descendant), true);
      assert.ok(performance.now()-start < 4000);
    } finally {
      try { process.kill(-parent.pid, 'SIGKILL'); } catch(e) { if (e.code !== 'ESRCH') throw e; }
      parent.stdin.destroy(); parent.stdout.destroy(); parent.stderr.destroy();
    }
  });
}
