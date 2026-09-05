const test = require('node:test');
const assert = require('node:assert/strict');
const { LineStore } = require('../src/lineStore');
const { HashChain } = require('../src/hashChain');
const {
  generateReportData,
  generateMarkdownReport,
  generateHtmlReport
} = require('../src/report');

test('generateReportData handles empty store and chain safely', () => {
  const store = new LineStore();
  const chain = new HashChain();

  const data = generateReportData(store, chain);
  assert.equal(data.summary.totalFiles, 0);
  assert.equal(data.summary.totalLines, 0);
  assert.deepEqual(data.summary.percentages, { typed: 0, pasted: 0, ai: 0, unknown: 0 });
  assert.equal(data.hashChainAudit.valid, true);
  assert.equal(data.hashChainAudit.totalEvents, 0);
});

test('generateReportData computes accurate totals and percentages across multiple files', () => {
  const store = new LineStore();
  const chain = new HashChain();

  // File 1: 5 lines (3 typed, 1 pasted, 1 ai)
  store.documents.set('src/app.js', [
    { origin: 'typed', timestamp: 1000 },
    { origin: 'typed', timestamp: 1001 },
    { origin: 'typed', timestamp: 1002 },
    { origin: 'pasted', timestamp: 1003 },
    { origin: 'ai', timestamp: 1004 }
  ]);

  // File 2: 5 lines (1 typed, 0 pasted, 4 ai)
  store.documents.set('src/utils.js', [
    { origin: 'typed', timestamp: 1010 },
    { origin: 'ai', timestamp: 1011 },
    { origin: 'ai', timestamp: 1012 },
    { origin: 'ai', timestamp: 1013 },
    { origin: 'ai', timestamp: 1014 }
  ]);

  // Hash chain with 2 events
  chain.append({ file: 'src/app.js', changeType: 'typed', range: { startLine: 0, endLine: 2 }, lineCount: 3 });
  chain.append({ file: 'src/utils.js', changeType: 'ai', range: { startLine: 1, endLine: 4 }, lineCount: 4 });

  const data = generateReportData(store, chain);
  assert.equal(data.summary.totalFiles, 2);
  assert.equal(data.summary.totalLines, 10);
  assert.equal(data.summary.typed, 4);
  assert.equal(data.summary.pasted, 1);
  assert.equal(data.summary.ai, 5);
  assert.equal(data.summary.percentages.typed, 40);
  assert.equal(data.summary.percentages.pasted, 10);
  assert.equal(data.summary.percentages.ai, 50);

  assert.equal(data.hashChainAudit.valid, true);
  assert.equal(data.hashChainAudit.totalEvents, 2);
  assert.equal(typeof data.hashChainAudit.latestHash, 'string');
});

test('generateMarkdownReport formats markdown tables and badges correctly', () => {
  const store = new LineStore();
  const chain = new HashChain();

  store.documents.set('main.js', [
    { origin: 'typed', timestamp: 1000 },
    { origin: 'pasted', timestamp: 1001 }
  ]);
  chain.append({ file: 'main.js', changeType: 'typed', range: { startLine: 0, endLine: 0 }, lineCount: 1 });

  const data = generateReportData(store, chain);
  const md = generateMarkdownReport(data);

  assert.ok(md.includes('# Code Provenance Report'));
  assert.ok(md.includes('## 1. Workspace Summary'));
  assert.ok(md.includes('## 2. Cryptographic Hash Chain Audit'));
  assert.ok(md.includes('✅ Verified'));
  assert.ok(md.includes('| `main.js` | 2 | 1 | 1 | 0 |'));
  assert.ok(md.includes('Privacy Notice:'));
});

test('generateMarkdownReport shows tamper alert when chain is broken', () => {
  const store = new LineStore();
  const chain = new HashChain();

  chain.append({ file: 'main.js', changeType: 'typed', range: { startLine: 0, endLine: 0 }, lineCount: 1 });
  chain.append({ file: 'main.js', changeType: 'ai', range: { startLine: 1, endLine: 2 }, lineCount: 2 });

  // Tamper with link 1
  const rawLinks = chain.getChain();
  rawLinks[1].data.lineCount = 999;
  // Stub verify to report broken link
  chain.verify = () => ({ valid: false, brokenIndex: 1, reason: 'Hash mismatch' });

  const data = generateReportData(store, chain);
  const md = generateMarkdownReport(data);

  assert.ok(md.includes('❌ TAMPER DETECTED at link #1'));
});

test('generateHtmlReport produces valid self-contained HTML', () => {
  const store = new LineStore();
  const chain = new HashChain();

  store.documents.set('index.ts', [
    { origin: 'ai', timestamp: 2000 },
    { origin: 'ai', timestamp: 2001 }
  ]);

  const data = generateReportData(store, chain);
  const html = generateHtmlReport(data);

  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Code Provenance Report</title>'));
  assert.ok(html.includes('index.ts'));
  assert.ok(html.includes('AI Copilot'));
  assert.ok(html.includes('Cryptographically Verified'));
  assert.ok(html.includes('Privacy Guarantee:'));
});

test('Privacy verification: no code or clipboard content appears in reports', () => {
  const store = new LineStore();
  const chain = new HashChain();

  const secretCode = 'const secretPassword = "SuperSecretValue123";';
  store.documents.set('auth.js', [
    { origin: 'typed', timestamp: 1000, extraContent: secretCode } // Extra field should never be printed
  ]);

  const data = generateReportData(store, chain);
  const md = generateMarkdownReport(data);
  const html = generateHtmlReport(data);

  assert.equal(md.includes('SuperSecretValue123'), false);
  assert.equal(html.includes('SuperSecretValue123'), false);
  assert.equal(JSON.stringify(data).includes('SuperSecretValue123'), false);
});
