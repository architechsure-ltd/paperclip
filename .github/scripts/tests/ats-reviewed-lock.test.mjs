import assert from 'node:assert/strict';
import test from 'node:test';
import { approveReviewedLock, REVIEWED_PR } from '../ats-reviewed-lock.mjs';

const sha = 'a'.repeat(40), baseSha = 'b'.repeat(40);
const files = Object.keys(REVIEWED_PR.blobs);
const input = () => ({
  repository: REVIEWED_PR.repository, number: REVIEWED_PR.number, author: REVIEWED_PR.author,
  headRepo: REVIEWED_PR.headRepo, branch: REVIEWED_PR.branch, headSha: sha, baseSha,
  changedPaths: [...files], blobAt: (_commit, path) => REVIEWED_PR.blobs[path],
});
test('admits only exact reviewed ATS #15 lock content', () => {
  assert.equal(approveReviewedLock(input()), true);
});
test('denies changed PR identity, repository or branch', () => {
  for (const value of [
    { repository: 'paperclipai/paperclip' }, { number: '16' }, { author: 'other' },
    { headRepo: 'other/paperclip' }, { branch: 'chore/refresh-lockfile' }, { headSha: baseSha },
    { headSha: 'untrusted' }, { baseSha: 'untrusted' },
  ]) assert.equal(approveReviewedLock({ ...input(), ...value }), false, JSON.stringify(value));
});
test('denies any missing, omitted or changed reviewed blob', () => {
  for (const missing of files) {
    assert.equal(approveReviewedLock({ ...input(), changedPaths: files.filter(x => x !== missing) }), false, missing);
    assert.equal(approveReviewedLock({
      ...input(), blobAt: (_commit, path) => path === missing ? '0'.repeat(40) : REVIEWED_PR.blobs[path],
    }), false, missing);
  }
});
test('denies absent file inventory even if all exact blobs exist', () => {
  assert.equal(approveReviewedLock({ ...input(), changedPaths: null }), false);
});
