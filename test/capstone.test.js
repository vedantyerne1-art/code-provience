const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { sealRepository } = require('../src/capstone');
const { LineStore } = require('../src/lineStore');
const { HashChain } = require('../src/hashChain');

test('sealRepository aggregates distribution, computes Terminal Root Hash, and injects badge into README', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-capstone-test-'));

  try {
    const initialReadme = `# My Project\n\nSome project description.\n`;
    fs.writeFileSync(path.join(tempDir, 'README.md'), initialReadme, 'utf8');

    const store = new LineStore();
    // 8 typed, 2 ai-native = 80% human, 20% ai
    store.documents.set('src/main.js', [
      { origin: 'typed' },
      { origin: 'typed' },
      { origin: 'typed' },
      { origin: 'typed' },
      { origin: 'typed' },
      { origin: 'typed' },
      { origin: 'typed' },
      { origin: 'typed' },
      { origin: 'ai-native' },
      { origin: 'ai-native' }
    ]);

    const chain = new HashChain();
    chain.append({ file: 'src/main.js', changeType: 'typed', range: { startLine: 0, endLine: 7 }, lineCount: 8 });
    chain.append({ file: 'src/main.js', changeType: 'ai-native', range: { startLine: 8, endLine: 9 }, lineCount: 10 });

    const result = sealRepository(tempDir, store, chain);

    assert.equal(result.success, true);
    assert.equal(result.humanPercent, 80);
    assert.equal(result.aiPercent, 20);
    assert.equal(typeof result.terminalRootHash, 'string');
    assert.equal(result.terminalRootHash.length, 64);
    assert.ok(result.badgeMarkdown.includes('80%25_Human'));

    const updatedReadme = fs.readFileSync(path.join(tempDir, 'README.md'), 'utf8');
    assert.ok(updatedReadme.includes('## 🛡️ Cryptographic Authenticity Seal'));
    assert.ok(updatedReadme.includes(result.badgeMarkdown));
    assert.ok(updatedReadme.includes(result.terminalRootHash));
    assert.ok(updatedReadme.includes('80% Human'));
    assert.ok(updatedReadme.includes('20% AI'));

    // Second run: verify idempotent update without duplicate sections
    const secondResult = sealRepository(tempDir, store, chain);
    assert.equal(secondResult.success, true);
    const secondReadme = fs.readFileSync(path.join(tempDir, 'README.md'), 'utf8');
    const matches = secondReadme.match(/## 🛡️ Cryptographic Authenticity Seal/g);
    assert.equal(matches.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
