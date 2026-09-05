const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { LineStore } = require('../src/lineStore');
const { HashChain } = require('../src/hashChain');
const {
  createAttestationBundle,
  verifyBundle,
  generatePreCommitHook,
  installPreCommitHook
} = require('../src/verifier');

test('createAttestationBundle produces sealed bundle with valid digest and schema', () => {
  const store = new LineStore();
  const chain = new HashChain();

  store.documents.set('src/index.ts', [
    { origin: 'typed', timestamp: 1000 },
    { origin: 'typed', timestamp: 1001 },
    { origin: 'ai', timestamp: 1002 }
  ]);
  chain.append({ file: 'src/index.ts', changeType: 'typed', range: { startLine: 0, endLine: 1 }, lineCount: 2 });
  chain.append({ file: 'src/index.ts', changeType: 'ai', range: { startLine: 2, endLine: 2 }, lineCount: 1 });

  const bundle = createAttestationBundle(store, chain, { repository: 'my-project' });

  assert.equal(bundle.schemaVersion, '1.0.0');
  assert.equal(bundle.metadata.repository, 'my-project');
  assert.equal(bundle.summary.totalLines, 3);
  assert.equal(bundle.summary.typed, 2);
  assert.equal(bundle.summary.ai, 1);
  assert.equal(bundle.chain.length, 2);
  assert.equal(typeof bundle.attestationDigest, 'string');
  assert.equal(bundle.attestationDigest.length, 64);

  // Verification against empty policy should pass
  const result = verifyBundle(bundle);
  assert.equal(result.passed, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.metrics.chainLength, 2);
});

test('verifyBundle rejects bundle with tampered attestationDigest', () => {
  const store = new LineStore();
  const chain = new HashChain();

  store.documents.set('file.js', [{ origin: 'typed', timestamp: 100 }]);
  chain.append({ file: 'file.js', changeType: 'typed', range: { startLine: 0, endLine: 0 }, lineCount: 1 });

  const bundle = createAttestationBundle(store, chain);
  // Tamper with summary
  bundle.summary.totalLines = 9999;

  const result = verifyBundle(bundle);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes('Attestation digest mismatch')));
});

test('verifyBundle rejects bundle with tampered hash chain link', () => {
  const store = new LineStore();
  const chain = new HashChain();

  store.documents.set('file.js', [{ origin: 'typed', timestamp: 100 }]);
  chain.append({ file: 'file.js', changeType: 'typed', range: { startLine: 0, endLine: 0 }, lineCount: 1 });
  chain.append({ file: 'file.js', changeType: 'ai', range: { startLine: 1, endLine: 1 }, lineCount: 1 });

  const bundle = createAttestationBundle(store, chain);
  // Tamper with chain link 1
  bundle.chain[1].data.lineCount = 500;
  // Even if an attacker recomputes attestationDigest, chain verification must catch the tampered link
  const { computeBundleDigest } = require('../src/verifier');
  const { attestationDigest, ...rest } = bundle;
  bundle.attestationDigest = computeBundleDigest(rest);

  const result = verifyBundle(bundle);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes('Hash chain broken at link #1')));
});

test('verifyBundle catches line count sum discrepancy between files and summary', () => {
  const store = new LineStore();
  const chain = new HashChain();

  store.documents.set('a.js', [{ origin: 'typed', timestamp: 10 }]);
  const bundle = createAttestationBundle(store, chain);

  // Invalidate file line count without changing summary
  bundle.files[0].totalLines = 50;
  const { computeBundleDigest } = require('../src/verifier');
  const { attestationDigest, ...rest } = bundle;
  bundle.attestationDigest = computeBundleDigest(rest);

  const result = verifyBundle(bundle);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes('Inconsistent line tallies')));
});

test('verifyBundle enforces policy thresholds (max AI and min Typed)', () => {
  const store = new LineStore();
  const chain = new HashChain();

  // 10 lines: 8 AI (80%), 2 typed (20%)
  const lines = [
    { origin: 'typed', timestamp: 1 },
    { origin: 'typed', timestamp: 2 },
    ...Array(8).fill({ origin: 'ai', timestamp: 3 })
  ];
  store.documents.set('test.js', lines);

  const bundle = createAttestationBundle(store, chain);

  // Strict Policy: max 50% AI
  const strictResult = verifyBundle(bundle, { maxAiPercentage: 50 });
  assert.equal(strictResult.passed, false);
  assert.ok(strictResult.errors.some((e) => e.includes('AI code percentage (80%) exceeds allowed threshold (50%)')));

  // Lenient Policy: max 90% AI, min 10% typed
  const lenientResult = verifyBundle(bundle, { maxAiPercentage: 90, minTypedPercentage: 10 });
  assert.equal(lenientResult.passed, true);

  // Policy demanding 50% typed should fail (only 20% typed)
  const typedPolicyResult = verifyBundle(bundle, { minTypedPercentage: 50 });
  assert.equal(typedPolicyResult.passed, false);
  assert.ok(typedPolicyResult.errors.some((e) => e.includes('Hand-typed percentage (20%) is below required minimum (50%)')));
});

test('generatePreCommitHook creates executable bash script with policy rules', () => {
  const script = generatePreCommitHook({ maxAiPercentage: 40 });
  assert.ok(script.startsWith('#!/usr/bin/env bash'));
  assert.ok(script.includes('.provenance-bundle.json'));
  assert.ok(script.includes('"maxAiPercentage":40'));
  assert.ok(script.includes('COMMIT REJECTED'));
});

test('installPreCommitHook writes executable file into temporary git repository', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hook-test-'));
  try {
    const installedPath = installPreCommitHook(tempDir, { maxAiPercentage: 50 });
    assert.ok(fs.existsSync(installedPath));
    const content = fs.readFileSync(installedPath, 'utf8');
    assert.ok(content.includes('verifyBundle'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Privacy invariant: Attestation bundle contains no code text', () => {
  const store = new LineStore();
  const chain = new HashChain();

  const secretString = 'PRIVATE_KEY_VALUE_XYZ_987';
  store.documents.set('secret.js', [
    { origin: 'typed', timestamp: 100, codeSnippet: secretString }
  ]);

  const bundle = createAttestationBundle(store, chain);
  const bundleStr = JSON.stringify(bundle);

  assert.equal(bundleStr.includes(secretString), false);
});
