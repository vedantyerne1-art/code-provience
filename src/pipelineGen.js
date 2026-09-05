const fs = require('fs');
const path = require('path');
let vscode;
try {
  vscode = require('vscode');
} catch {
  // Unit test fallback
}

/**
 * Standard GitHub Actions workflow content for the Provenance Gatekeeper.
 */
function getWorkflowYaml(maxAiPercent = 40) {
  return `name: Provenance Gatekeeper

on:
  pull_request:
    branches: [ main, master, develop ]
  push:
    branches: [ main, master ]

jobs:
  verify-provenance:
    name: Verify Code Provenance & Hash Chain
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code Repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Fetch Cryptographic Provenance Notes
        run: |
          git fetch origin refs/notes/provenance:refs/notes/provenance || echo "Notice: No remote provenance notes found, verifying local ref."

      - name: Setup Node.js Runtime
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Execute Provenance Gatekeeper Verification
        run: node .github/scripts/verify-provenance.js
        env:
          MAX_AI_PERCENT: "${maxAiPercent}"
`;
}

/**
 * Standalone Node.js verification script executed in CI/CD without VS Code dependencies.
 */
function getVerificationScriptJs() {
  return `#!/usr/bin/env node
/**
 * @file verify-provenance.js
 * Standalone CI/CD Provenance Gatekeeper Script.
 * Verifies SHA-256 hash chain integrity and enforces AI contribution thresholds.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

const GENESIS_PREV_HASH = '0'.repeat(64);
const MAX_AI_PERCENT = parseInt(process.env.MAX_AI_PERCENT || '40', 10);

function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalJson(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => JSON.stringify(key) + ':' + canonicalJson(obj[key]));
  return '{' + pairs.join(',') + '}';
}

function computeHash(data) {
  return crypto.createHash('sha256').update(canonicalJson(data)).digest('hex');
}

function verifyHashChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { valid: true, count: 0 };
  }

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    if (i === 0) {
      if (link.prevHash !== GENESIS_PREV_HASH) {
        return { valid: false, brokenIndex: 0, reason: 'Genesis prevHash must be 64 zeros' };
      }
    } else {
      if (link.prevHash !== chain[i - 1].hash) {
        return { valid: false, brokenIndex: i, reason: 'Hash pointer broken between link ' + (i - 1) + ' and ' + i };
      }
    }

    const expectedHash = computeHash({
      index: link.index,
      timestamp: link.timestamp,
      prevHash: link.prevHash,
      data: link.data
    });

    if (link.hash !== expectedHash) {
      return { valid: false, brokenIndex: i, reason: 'Hash mismatch on link ' + i + ' (possible payload tampering)' };
    }
  }

  return { valid: true, count: chain.length };
}

function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🛡️  CODE PROVENANCE GATEKEEPER — CI/CD VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Configured Max AI Contribution Threshold: ' + MAX_AI_PERCENT + '%\\n');

  let rawNotes = '';
  try {
    rawNotes = execSync('git notes --ref=refs/notes/provenance show HEAD 2>/dev/null', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    console.warn('⚠️  No provenance notes attached to HEAD commit.');
    console.log('Proceeding with pass-through for commits without active provenance session.');
    process.exit(0);
  }

  if (!rawNotes) {
    console.log('ℹ️  Empty provenance notes on HEAD. Skipping gatekeeper check.');
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(rawNotes);
  } catch (err) {
    console.error('❌ Malformed Provenance JSON note on HEAD:', err.message);
    process.exit(1);
  }

  // 1. Verify Hash Chain
  if (payload.hashChain && Array.isArray(payload.hashChain)) {
    console.log('🔍 Auditing SHA-256 cryptographic hash chain (' + payload.hashChain.length + ' events)...');
    const audit = verifyHashChain(payload.hashChain);
    if (!audit.valid) {
      console.error('❌ TAMPER DETECTED in Provenance Hash Chain!');
      console.error('   Broken Link #' + audit.brokenIndex + ': ' + audit.reason);
      process.exit(1);
    }
    console.log('✅ Hash chain verified intact. All cryptographic links valid.');
  }

  // 2. Verify AI Contribution Percentage
  const summary = payload.summary || {};
  const typed = summary.typed || 0;
  const pasted = summary.pasted || 0;
  const ai = summary.ai || 0;
  const aiNative = summary.aiNative || 0;
  const totalMeaningful = typed + pasted + ai + aiNative;

  if (totalMeaningful === 0) {
    console.log('✅ No meaningful code changes detected. Gatekeeper passed.');
    process.exit(0);
  }

  const totalAi = ai + aiNative;
  const aiPercent = Math.round((totalAi / totalMeaningful) * 100);
  const humanPercent = Math.round((typed / totalMeaningful) * 100);

  console.log('📊 Commit Provenance Summary:');
  console.log('   • Hand-Typed: ' + humanPercent + '% (' + typed + ' lines)');
  console.log('   • Pasted:     ' + Math.round((pasted / totalMeaningful) * 100) + '% (' + pasted + ' lines)');
  console.log('   • AI-Total:   ' + aiPercent + '% (' + totalAi + ' lines) [AI: ' + ai + ', AI-Native: ' + aiNative + ']');
  console.log('   • Total Lines: ' + (summary.totalLines || totalMeaningful) + '\\n');

  if (aiPercent > MAX_AI_PERCENT) {
    console.error('❌ PROVENANCE GATEKEEPER FAILED:');
    console.error('   AI-generated code (' + aiPercent + '%) exceeds maximum allowed policy threshold (' + MAX_AI_PERCENT + '%).');
    console.error('   Please review code origin with human peer reviewers before merging.');
    process.exit(1);
  }

  console.log('✅ PROVENANCE GATEKEEPER PASSED:');
  console.log('   Commit conforms to provenance policy (' + aiPercent + '% AI <= ' + MAX_AI_PERCENT + '% max).\\n');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  verifyHashChain,
  canonicalJson,
  computeHash
};
`;
}

/**
 * Generates the CI/CD pipeline workflow and verification script in the target workspace.
 *
 * @param {string} workspaceRoot
 * @param {object} [options]
 * @param {number} [options.maxAiPercent=40]
 * @returns {{ workflowPath: string, scriptPath: string }}
 */
function generateCIWorkflow(workspaceRoot, options = {}) {
  const maxAi = options.maxAiPercent || 40;
  const workflowsDir = path.join(workspaceRoot, '.github', 'workflows');
  const scriptsDir = path.join(workspaceRoot, '.github', 'scripts');

  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  const workflowPath = path.join(workflowsDir, 'provenance-gatekeeper.yml');
  const scriptPath = path.join(scriptsDir, 'verify-provenance.js');

  fs.writeFileSync(workflowPath, getWorkflowYaml(maxAi), 'utf8');
  fs.writeFileSync(scriptPath, getVerificationScriptJs(), { encoding: 'utf8', mode: 0o755 });

  return { workflowPath, scriptPath };
}

/**
 * Registers the 'provenance.generateCI' command in VS Code.
 *
 * @param {vscode.ExtensionContext} context
 */
function registerPipelineGenerator(context) {
  if (!vscode || !vscode.commands) return;

  const cmd = vscode.commands.registerCommand('provenance.generateCI', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Provenance: Please open a workspace folder to generate CI/CD pipeline files.');
        return;
      }

      const root = workspaceFolders[0].uri.fsPath;
      generateCIWorkflow(root, { maxAiPercent: 40 });

      vscode.window.showInformationMessage(
        'GitHub Action created! Your repository will now block PRs with broken provenance chains or excessive AI contributions.'
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Provenance CI Generation Error: ${err.message}`);
    }
  });

  context.subscriptions.push(cmd);
}

module.exports = {
  getWorkflowYaml,
  getVerificationScriptJs,
  generateCIWorkflow,
  registerPipelineGenerator
};
