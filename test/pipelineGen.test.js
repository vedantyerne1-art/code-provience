const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateCIWorkflow } = require('../src/pipelineGen');

test('generateCIWorkflow creates workflow YAML and standalone verification script', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-ci-test-'));

  try {
    const { workflowPath, scriptPath } = generateCIWorkflow(tempDir, { maxAiPercent: 35 });

    assert.ok(fs.existsSync(workflowPath));
    assert.ok(fs.existsSync(scriptPath));

    const yamlContent = fs.readFileSync(workflowPath, 'utf8');
    assert.ok(yamlContent.includes('name: Provenance Gatekeeper'));
    assert.ok(yamlContent.includes('refs/notes/provenance'));
    assert.ok(yamlContent.includes('node .github/scripts/verify-provenance.js'));
    assert.ok(yamlContent.includes('MAX_AI_PERCENT: "35"'));

    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(scriptContent.includes('verifyHashChain'));
    assert.ok(scriptContent.includes('refs/notes/provenance'));
    assert.ok(scriptContent.includes('PROVENANCE GATEKEEPER'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Standalone verifyHashChain logic detects valid chain and catches tampering', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-verify-test-'));
  try {
    const { scriptPath } = generateCIWorkflow(tempDir);
    const { verifyHashChain, computeHash } = require(scriptPath);

    const genesisPrev = '0'.repeat(64);
    const data0 = { file: 'index.js', changeType: 'typed', range: { startLine: 0, endLine: 1 }, lineCount: 2 };
    const hash0 = computeHash({ index: 0, timestamp: 1000, prevHash: genesisPrev, data: data0 });

    const data1 = { file: 'index.js', changeType: 'ai', range: { startLine: 2, endLine: 4 }, lineCount: 5 };
    const hash1 = computeHash({ index: 1, timestamp: 1001, prevHash: hash0, data: data1 });

    const validChain = [
      { index: 0, timestamp: 1000, prevHash: genesisPrev, data: data0, hash: hash0 },
      { index: 1, timestamp: 1001, prevHash: hash0, data: data1, hash: hash1 }
    ];

    const auditResult = verifyHashChain(validChain);
    assert.equal(auditResult.valid, true);
    assert.equal(auditResult.count, 2);

    // Tamper with link 1
    const tamperedChain = [
      { index: 0, timestamp: 1000, prevHash: genesisPrev, data: data0, hash: hash0 },
      { index: 1, timestamp: 1001, prevHash: hash0, data: { ...data1, lineCount: 999 }, hash: hash1 }
    ];

    const tamperedResult = verifyHashChain(tamperedChain);
    assert.equal(tamperedResult.valid, false);
    assert.equal(tamperedResult.brokenIndex, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
