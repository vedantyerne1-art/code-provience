/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LineMetadata, OriginType, ChainLink, DetectionLogEntry } from './types';

export const GENESIS_PREV = '0'.repeat(64);

/**
 * Deterministic canonical JSON representation.
 */
export function canonicalJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJson(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(obj[key]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Creates a deterministic 64-hex-char SHA-256 like hash for client-side state.
 */
export function computeHash(data: any): string {
  const str = typeof data === 'string' ? data : canonicalJson(data);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ (ch << 1), 1597334677);
    h3 = Math.imul(h3 ^ (ch >> 1), 3847412027);
    h4 = Math.imul(h4 ^ (ch * 31), 2246822507);
  }

  const hex1 = ((h1 ^ (h1 >>> 16)) >>> 0).toString(16).padStart(8, '0');
  const hex2 = ((h2 ^ (h2 >>> 13)) >>> 0).toString(16).padStart(8, '0');
  const hex3 = ((h3 ^ (h3 >>> 17)) >>> 0).toString(16).padStart(8, '0');
  const hex4 = ((h4 ^ (h4 >>> 15)) >>> 0).toString(16).padStart(8, '0');
  const hex5 = ((h1 ^ h3 ^ 0xabcdef01) >>> 0).toString(16).padStart(8, '0');
  const hex6 = ((h2 ^ h4 ^ 0x12345678) >>> 0).toString(16).padStart(8, '0');
  const hex7 = ((h1 ^ h4 ^ 0x98765432) >>> 0).toString(16).padStart(8, '0');
  const hex8 = ((h2 ^ h3 ^ 0xfedcba98) >>> 0).toString(16).padStart(8, '0');

  return (hex1 + hex2 + hex3 + hex4 + hex5 + hex6 + hex7 + hex8).toLowerCase();
}

/**
 * Applies line shift logic matching LineStore.applyChange (Phase 3 & Phase 11).
 * Pure whitespace and blank lines within insertions are tagged as 'ignore'.
 */
export function applyShiftMath(
  currentLines: LineMetadata[],
  startLine: number,
  endLine: number,
  newText: string,
  origin: OriginType,
  timestamp: number = Date.now()
): LineMetadata[] {
  const lines = [...currentLines];

  while (lines.length <= startLine) {
    lines.push({ origin: 'unknown', timestamp });
  }

  const linesRemoved = endLine - startLine;
  const textLines = newText.split('\n');
  const linesAdded = textLines.length - 1;

  // Phase 11 helper: blank lines or purely whitespace changes become 'ignore'
  const effectiveOrigin = newText.trim().length === 0 ? 'ignore' : origin;

  const resolveLineOrigin = (lineText: string | undefined): OriginType => {
    if (effectiveOrigin === 'ignore') return 'ignore';
    if (newText.trim().length > 0 && lineText !== undefined && lineText.trim().length === 0) {
      return 'ignore';
    }
    return effectiveOrigin;
  };

  if (linesAdded > linesRemoved) {
    const countToInsert = linesAdded - linesRemoved;
    const newEntries: LineMetadata[] = [];
    for (let i = 1; i <= countToInsert; i++) {
      const lineContent = textLines[i];
      newEntries.push({
        origin: resolveLineOrigin(lineContent),
        timestamp
      });
    }
    lines.splice(startLine + 1, 0, ...newEntries);

    const startOrigin =
      textLines[0].length === 0 && newText.trim().length > 0
        ? effectiveOrigin
        : resolveLineOrigin(textLines[0]);
    lines[startLine] = { origin: startOrigin, timestamp };
  } else if (linesAdded < linesRemoved) {
    const countToRemove = linesRemoved - linesAdded;
    lines.splice(startLine, countToRemove);
    if (newText.length > 0 && lines[startLine]) {
      lines[startLine] = { origin: resolveLineOrigin(textLines[0]), timestamp };
    }
  } else {
    for (let i = startLine; i <= startLine + linesAdded && i < lines.length; i++) {
      const lineIndex = i - startLine;
      const lineContent = textLines[lineIndex];
      lines[i] = { origin: resolveLineOrigin(lineContent), timestamp };
    }
  }

  return lines;
}

/**
 * Computes line origin tallies and percentages.
 * Phase 11: Lines tagged as 'ignore' or 'unknown' are excluded from the denominator.
 */
export function computeLineStats(lines: LineMetadata[]) {
  const total = lines.length;
  let typed = 0;
  let pasted = 0;
  let ai = 0;
  let aiNative = 0;
  let ignore = 0;
  let unknown = 0;

  for (const l of lines) {
    if (l.origin === 'typed') typed++;
    else if (l.origin === 'pasted') pasted++;
    else if (l.origin === 'ai') ai++;
    else if (l.origin === 'ai-native') aiNative++;
    else if (l.origin === 'ignore') ignore++;
    else unknown++;
  }

  const meaningfulTotal = typed + pasted + ai + aiNative;

  const pctTyped = meaningfulTotal === 0 ? 0 : Math.round((typed / meaningfulTotal) * 100);
  const pctPasted = meaningfulTotal === 0 ? 0 : Math.round((pasted / meaningfulTotal) * 100);
  const pctAi = meaningfulTotal === 0 ? 0 : Math.round((ai / meaningfulTotal) * 100);
  const pctAiNative = meaningfulTotal === 0 ? 0 : Math.round((aiNative / meaningfulTotal) * 100);
  const pctUnknown = total === 0 ? 0 : Math.round((unknown / total) * 100);

  return {
    total,
    meaningfulTotal,
    typed,
    pasted,
    ai,
    aiNative,
    ignore,
    unknown,
    percentages: {
      typed: pctTyped,
      pasted: pctPasted,
      ai: pctAi,
      aiNative: pctAiNative,
      unknown: pctUnknown
    }
  };
}

