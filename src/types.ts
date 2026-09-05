/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type OriginType = 'typed' | 'pasted' | 'ai' | 'ai-native' | 'ignore' | 'unknown';

export interface LineMetadata {
  origin: OriginType;
  timestamp: number;
}

export interface FileDocument {
  id: string;
  path: string;
  name: string;
  language: string;
  content: string;
  lines: LineMetadata[];
}

export interface ChainLink {
  sequence: number;
  timestamp: number;
  prevHash: string;
  data: {
    file: string;
    changeType: 'typed' | 'pasted' | 'ai' | 'ai-native' | 'ignore' | 'unknown' | 'deletion';
    range: { startLine: number; endLine: number };
    lineCount: number;
  };
  hash: string;
  isTampered?: boolean;
}

export interface DetectionLogEntry {
  id: string;
  timestamp: number;
  type: 'typed' | 'pasted' | 'ai' | 'ai-native' | 'ignore' | 'shift' | 'tamper' | 'exec';
  summary: string;
  details: string;
  lineRange: string;
  hashSnippet?: string;
}

export interface PolicyConfig {
  maxAiPercentage: number;
  minTypedPercentage: number;
  maxPastedPercentage: number;
  requireChain: boolean;
}

export interface FileReportSummary {
  file: string;
  totalLines: number;
  typed: number;
  pasted: number;
  ai: number;
  aiNative?: number;
  ignore: number;
  unknown: number;
  percentages: {
    typed: number;
    pasted: number;
    ai: number;
    aiNative?: number;
    unknown: number;
  };
}
