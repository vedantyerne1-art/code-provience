const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GENESIS_PREV_HASH,
  canonicalJson,
  computeLinkHash,
  verifyChain,
  HashChain
} = require('../src/hashChain');

test('canonicalJson produces identical strings regardless of object key order', () => {
  const objA = { z: 1, a: 2, m: { nestedB: true, nestedA: 'hello' } };
  const objB = { a: 2, m: { nestedA: 'hello', nestedB: true }, z: 1 };

  const strA = canonicalJson(objA);
  const strB = canonicalJson(objB);

  assert.equal(strA, strB);
  assert.equal(strA, '{"a":2,"m":{"nestedA":"hello","nestedB":true},"z":1}');
});

test('HashChain genesis link uses 64 zeros as prevHash', () => {
  const chain = new HashChain();
  const link0 = chain.append({
    file: 'src/index.js',
    changeType: 'typed',
    range: { startLine: 0, endLine: 0 },
    lineCount: 1
  });

  assert.equal(link0.sequence, 0);
  assert.equal(link0.prevHash, GENESIS_PREV_HASH);
  assert.equal(typeof link0.hash, 'string');
  assert.equal(link0.hash.length, 64);
});

test('HashChain verifies a valid 5-link sequence', () => {
  const chain = new HashChain();
  const origins = ['typed', 'pasted', 'ai', 'typed', 'ai'];

  for (let i = 0; i < 5; i++) {
    chain.append({
      file: 'src/app.js',
      changeType: origins[i],
      range: { startLine: i, endLine: i },
      lineCount: 1
    }, 1000 + i * 100);
  }

  assert.equal(chain.getChain().length, 5);
  const verification = chain.verify();
  assert.equal(verification.valid, true);
  assert.equal(verification.brokenIndex, undefined);
});

test('verifyChain detects tampering in link 2 (timestamp modified)', () => {
  const chain = new HashChain();
  for (let i = 0; i < 5; i++) {
    chain.append({
      file: 'src/app.js',
      changeType: 'typed',
      range: { startLine: i, endLine: i },
      lineCount: 1
    }, 1000 + i * 100);
  }

  const rawLinks = chain.getChain();
  // Tamper with link 2: alter timestamp by 1 millisecond
  rawLinks[2].timestamp += 1;

  const result = verifyChain(rawLinks);
  assert.equal(result.valid, false);
  assert.equal(result.brokenIndex, 2);
  assert.ok(result.reason.includes('Hash mismatch'));
});

test('verifyChain detects tampering in link 2 (lineCount modified)', () => {
  const chain = new HashChain();
  for (let i = 0; i < 5; i++) {
    chain.append({
      file: 'src/app.js',
      changeType: 'ai',
      range: { startLine: i * 2, endLine: i * 2 + 1 },
      lineCount: 2
    }, 2000 + i * 100);
  }

  const rawLinks = chain.getChain();
  // Tamper with data payload in link 2
  rawLinks[2].data.lineCount = 99;

  const result = verifyChain(rawLinks);
  assert.equal(result.valid, false);
  assert.equal(result.brokenIndex, 2);
});

test('verifyChain detects broken prevHash pointer link', () => {
  const chain = new HashChain();
  for (let i = 0; i < 4; i++) {
    chain.append({
      file: 'src/app.js',
      changeType: 'typed',
      range: { startLine: i, endLine: i },
      lineCount: 1
    }, 3000 + i * 100);
  }

  const rawLinks = chain.getChain();
  // Tamper with prevHash pointer in link 3
  rawLinks[3].prevHash = 'a'.repeat(64);

  const result = verifyChain(rawLinks);
  assert.equal(result.valid, false);
  assert.equal(result.brokenIndex, 3);
  assert.ok(result.reason.includes('Broken pointer'));
});

test('HashChain privacy guarantee: never stores code text', () => {
  const chain = new HashChain();
  chain.append({
    file: 'secret.js',
    changeType: 'typed',
    range: { startLine: 0, endLine: 0 },
    lineCount: 1,
    text: 'sensitiveApiKey = "12345"', // extraneous property should not be saved in data
    rawCode: 'function secret() {}'
  });

  const link = chain.getChain()[0];
  assert.equal(link.data.text, undefined);
  assert.equal(link.data.rawCode, undefined);
  assert.deepEqual(Object.keys(link.data).sort(), ['changeType', 'file', 'lineCount', 'range']);
});
