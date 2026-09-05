const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { generateReportData } = require('./report');
const { canonicalJson, verifyChain } = require('./hashChain');

/**
 * Computes SHA-256 over canonical JSON of the bundle content.
 *
 * @param {object} content
 * @returns {string} Hex SHA-256 digest
 */
function computeBundleDigest(content) {
  const canonical = canonicalJson(content);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Creates a portable, tamper-sealed Attestation Bundle.
 *
 * @param {import('./lineStore').LineStore} store
 * @param {import('./hashChain').HashChain} chain
 * @param {object} [metadata]
 * @returns {object} Sealed attestation bundle
 */
function createAttestationBundle(store, chain, metadata = {}) {
  const reportData = generateReportData(store, chain);
  const chainLinks = chain ? chain.getChain() : [];

  const payload = {
    schemaVersion: '1.0.0',
    generatedAt: reportData.generatedAt,
    metadata: {
      repository: metadata.repository || 'workspace',
      commitHash: metadata.commitHash || 'HEAD',
      author: metadata.author || 'provenance-agent',
      tool: 'code-provenance-tracker@0.0.1',
      ...metadata
    },
    summary: reportData.summary,
    files: reportData.files,
    chain: chainLinks
  };

  const attestationDigest = computeBundleDigest(payload);

  return {
    ...payload,
    attestationDigest
  };
}

/**
 * Audits and verifies an Attestation Bundle against cryptographic invariants
 * and optional organizational policy rules (e.g. max AI %, min typed %).
 *
 * @param {object} bundle - The parsed attestation bundle
 * @param {object} [policy] - Optional policy constraints
 * @param {boolean} [policy.requireValidChain=true]
 * @param {number} [policy.maxAiPercentage]
 * @param {number} [policy.minTypedPercentage]
 * @param {number} [policy.maxPastedPercentage]
 * @returns {{ passed: boolean, errors: string[], warnings: string[], metrics: object | null }}
 */
function verifyBundle(bundle, policy = {}) {
  const errors = [];
  const warnings = [];

  if (!bundle || typeof bundle !== 'object') {
    return { passed: false, errors: ['Invalid bundle: payload must be a non-null object'], warnings, metrics: null };
  }

  // 1. Schema check
  const requiredFields = ['schemaVersion', 'summary', 'files', 'chain', 'attestationDigest'];
  for (const field of requiredFields) {
    if (bundle[field] === undefined) {
      errors.push(`Missing required field in bundle: '${field}'`);
    }
  }

  if (errors.length > 0) {
    return { passed: false, errors, warnings, metrics: null };
  }

  // 2. Verify Attestation Digest (Sealing integrity)
  const { attestationDigest, ...payloadWithoutDigest } = bundle;
  const expectedDigest = computeBundleDigest(payloadWithoutDigest);
  if (attestationDigest !== expectedDigest) {
    errors.push(`Attestation digest mismatch: bundle contents modified (expected: ${expectedDigest}, found: ${attestationDigest})`);
  }

  // 3. Verify Hash Chain cryptographic integrity
  if (policy.requireValidChain !== false) {
    const chainVerification = verifyChain(bundle.chain);
    if (!chainVerification.valid) {
      errors.push(`Hash chain broken at link #${chainVerification.brokenIndex}: ${chainVerification.reason}`);
    }
  }

  // 4. Verify internal line count consistency
  if (Array.isArray(bundle.files)) {
    let sumLines = 0;
    let sumTyped = 0;
    let sumPasted = 0;
    let sumAi = 0;
    for (const f of bundle.files) {
      sumLines += Number(f.totalLines || 0);
      sumTyped += Number(f.typed || 0);
      sumPasted += Number(f.pasted || 0);
      sumAi += Number(f.ai || 0);
    }

    if (bundle.summary && sumLines !== bundle.summary.totalLines) {
      errors.push(`Inconsistent line tallies: file sums (${sumLines}) do not equal summary total (${bundle.summary.totalLines})`);
    }
  }

  // 5. Organizational Policy Enforcement
  const summary = bundle.summary || { percentages: {} };
  const p = summary.percentages || {};

  if (policy.maxAiPercentage !== undefined && policy.maxAiPercentage !== null) {
    if (p.ai > policy.maxAiPercentage) {
      errors.push(`Policy violation: AI code percentage (${p.ai}%) exceeds allowed threshold (${policy.maxAiPercentage}%)`);
    }
  }

  if (policy.minTypedPercentage !== undefined && policy.minTypedPercentage !== null) {
    if (p.typed < policy.minTypedPercentage) {
      errors.push(`Policy violation: Hand-typed percentage (${p.typed}%) is below required minimum (${policy.minTypedPercentage}%)`);
    }
  }

  if (policy.maxPastedPercentage !== undefined && policy.maxPastedPercentage !== null) {
    if (p.pasted > policy.maxPastedPercentage) {
      errors.push(`Policy violation: Pasted code percentage (${p.pasted}%) exceeds allowed threshold (${policy.maxPastedPercentage}%)`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics: {
      totalFiles: summary.totalFiles || 0,
      totalLines: summary.totalLines || 0,
      percentages: p,
      chainLength: Array.isArray(bundle.chain) ? bundle.chain.length : 0,
      attestationDigest
    }
  };
}

/**
 * Generates an automated Git Pre-Commit Hook script.
 *
 * @param {object} [policy] - Policy rules to embed into the hook
 * @returns {string} Bash script content
 */
function generatePreCommitHook(policy = {}) {
  const policyJson = JSON.stringify(policy);
  return `#!/usr/bin/env bash
# Auto-generated by Code Provenance Tracker (Phase 8)
# Pre-commit hook: enforces cryptographic provenance & policy verification before committing

set -e

echo "🔍 Verifying code provenance attestation..."

BUNDLE_FILE=".provenance-bundle.json"

if [ ! -f "$BUNDLE_FILE" ]; then
  echo "⚠️ Warning: No $BUNDLE_FILE found. Generating on HEAD..."
fi

node -e '
const fs = require("fs");
const { verifyBundle } = require("./src/verifier");

const bundlePath = ".provenance-bundle.json";
if (!fs.existsSync(bundlePath)) {
  console.log("ℹ️ Skipping provenance check: .provenance-bundle.json not present.");
  process.exit(0);
}

try {
  const raw = fs.readFileSync(bundlePath, "utf8");
  const bundle = JSON.parse(raw);
  const policy = ${policyJson};
  const result = verifyBundle(bundle, policy);

  if (!result.passed) {
    console.error("❌ COMMIT REJECTED: Provenance verification failed:");
    for (const err of result.errors) {
      console.error("   - " + err);
    }
    process.exit(1);
  }

  console.log("✅ Provenance verified: " + result.metrics.totalLines + " lines, chain valid (" + result.metrics.chainLength + " links).");
} catch (err) {
  console.error("❌ Error reading provenance bundle: " + err.message);
  process.exit(1);
}
'

exit 0
`;
}

/**
 * Installs the pre-commit hook into a git repository.
 *
 * @param {string} repoPath
 * @param {object} [policy]
 * @returns {string} Path to installed hook
 */
function installPreCommitHook(repoPath, policy = {}) {
  const hooksDir = path.join(repoPath, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }
  const hookPath = path.join(hooksDir, 'pre-commit');
  const hookScript = generatePreCommitHook(policy);
  fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
  return hookPath;
}

module.exports = {
  computeBundleDigest,
  createAttestationBundle,
  verifyBundle,
  generatePreCommitHook,
  installPreCommitHook
};
