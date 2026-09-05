const crypto = require('node:crypto');

const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Serializes any JavaScript object or primitive into Canonical JSON.
 * Keys at every level are strictly sorted alphabetically so identical data
 * always yields deterministic byte representations for cryptographic hashing.
 */
function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((key) => JSON.stringify(key) + ':' + canonicalJson(obj[key]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes SHA-256 over canonical JSON of the link content.
 */
function computeLinkHash(payload) {
  const canonicalString = canonicalJson(payload);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

/**
 * Verifies the integrity of a hash chain.
 * Detects any tampered fields, modified timestamps, swapped orders, or altered hashes.
 */
function verifyChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { valid: true };
  }

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];

    if (link.sequence !== i) {
      return { valid: false, brokenIndex: i, reason: `Invalid sequence: expected ${i}, got ${link.sequence}` };
    }

    const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : chain[i - 1].hash;
    if (link.prevHash !== expectedPrevHash) {
      return { valid: false, brokenIndex: i, reason: 'Broken pointer to previous hash' };
    }

    const payloadToHash = {
      sequence: link.sequence,
      timestamp: link.timestamp,
      prevHash: link.prevHash,
      data: link.data
    };

    const calculatedHash = computeLinkHash(payloadToHash);
    if (calculatedHash !== link.hash) {
      return { valid: false, brokenIndex: i, reason: 'Hash mismatch: data or timestamp was tampered' };
    }
  }

  return { valid: true };
}

/**
 * Tamper-evident Hash Chain manager for provenance edit events.
 */
class HashChain {
  constructor() {
    this.chain = [];
  }

  /**
   * Appends a new edit event to the chain.
   */
  append(data, overrideTimestamp) {
    const sequence = this.chain.length;
    const timestamp = overrideTimestamp || Date.now();
    const prevHash = sequence === 0 ? GENESIS_PREV_HASH : this.chain[sequence - 1].hash;

    // Strict privacy guarantee: data must only contain metadata, never code
    const sanitizedData = {
      file: String(data.file || 'untitled'),
      changeType: String(data.changeType || 'unknown'),
      range: {
        startLine: Number(data.range?.startLine || 0),
        endLine: Number(data.range?.endLine || 0)
      },
      lineCount: Number(data.lineCount || 1)
    };

    const payloadToHash = { sequence, timestamp, prevHash, data: sanitizedData };
    const hash = computeLinkHash(payloadToHash);

    const link = { sequence, timestamp, prevHash, data: sanitizedData, hash };
    this.chain.push(link);
    return link;
  }

  verify() {
    return verifyChain(this.chain);
  }

  getChain() {
    return [...this.chain];
  }

  getLatestHash() {
    if (this.chain.length === 0) {
      return GENESIS_PREV_HASH;
    }
    return this.chain[this.chain.length - 1].hash;
  }

  clear() {
    this.chain = [];
  }
}

const defaultChain = new HashChain();

module.exports = {
  GENESIS_PREV_HASH,
  canonicalJson,
  computeLinkHash,
  verifyChain,
  HashChain,
  defaultChain
};
