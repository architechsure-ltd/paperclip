#!/usr/bin/env node
// Narrow, base-branch-owned trust exception for the ATS Paperclip upstream reconciliation.
// It is intentionally specific to PR #15 and exact reviewed Git blobs.
// Never load this programme from the untrusted pull-request head.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REVIEWED_PR = Object.freeze({
  repository: 'architechsure-ltd/paperclip',
  number: '15',
  author: 'vroommm',
  headRepo: 'architechsure-ltd/paperclip',
  branch: 'ats/upstream-2026-1117-review',
  blobs: Object.freeze({
    'pnpm-lock.yaml': '41f6be281735ac7fcab0eb37b453825d415aeb5e',
    'patches/acpx@0.13.1.patch': '0768e97011ec07e7f6a99633bcbb77493efa8def',
    'tests/runner-e2e/report-lock.patch': '3f6a183d2160e34e0105aafc3b475f0b68eae9e2',
    'tests/runner-e2e/report-lock.json': '51347ff81959ca79bb6f6af4643c66eb8ff07260',
  }),
});

const commitSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export function approveReviewedLock({ repository, number, author, headRepo, branch, headSha, baseSha, blobAt, changedPaths }) {
  if (repository !== REVIEWED_PR.repository || String(number) !== REVIEWED_PR.number ||
      author !== REVIEWED_PR.author || headRepo !== REVIEWED_PR.headRepo || branch !== REVIEWED_PR.branch) return false;
  if (!commitSha(headSha) || !commitSha(baseSha) || headSha === baseSha) return false;
  if (!Array.isArray(changedPaths) || !changedPaths.includes('pnpm-lock.yaml') ||
      !changedPaths.includes('patches/acpx@0.13.1.patch') ||
      !changedPaths.includes('tests/runner-e2e/report-lock.json') ||
      !changedPaths.includes('tests/runner-e2e/report-lock.patch')) return false;
  for (const [path, expected] of Object.entries(REVIEWED_PR.blobs)) {
    if (blobAt(headSha, path) !== expected) return false;
  }
  return true;
}
function git(...args) { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const env = process.env, headSha = env.HEAD_SHA, baseSha = env.BASE_SHA;
    if (!commitSha(headSha) || !commitSha(baseSha)) throw new Error('Missing pinned commit identities');
    const changedPaths = git('diff', '--name-only', baseSha + '...' + headSha).split('\n').filter(Boolean);
    const approved = approveReviewedLock({
      repository: env.GITHUB_REPOSITORY, number: env.PR_NUMBER, author: env.PR_AUTHOR,
      headRepo: env.HEAD_REPO, branch: env.HEAD_REF, headSha, baseSha, changedPaths,
      blobAt: (commit, path) => git('rev-parse', '--verify', commit + ':' + path),
    });
    if (!approved) throw new Error('PR is not the explicitly reviewed ATS ACPX dependency correction');
    console.log('ATS reviewed lockfile: exact PR identity, original-patch blob, corrected-lock blob and proof blobs verified');
  } catch (error) {
    console.error('ATS reviewed lockfile rejected: ' + error.message);
    process.exitCode = 1;
  }
}
