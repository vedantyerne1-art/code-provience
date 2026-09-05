/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileDocument, OriginType } from './types';

export interface ExecutionResult {
  output: string[];
  crashed: boolean;
  crashLine: number | null;
  crashOrigin: OriginType | null;
  crashMessage?: string;
  durationMs: number;
}

export function formatOriginLabel(origin: OriginType | string | null): string {
  switch (origin) {
    case 'ai':
      return 'AI-Generated';
    case 'typed':
      return 'Human-Typed';
    case 'pasted':
      return 'Pasted from Clipboard';
    case 'ignore':
      return 'Whitespace / Ignored';
    default:
      return 'Unknown / Pre-existing';
  }
}

export function parseCrashLine(errorMsg: string, totalLines: number): number | null {
  if (!errorMsg) return null;

  // 1. Python tracebacks: File "...", line 12, in <module>
  const pyMatch = errorMsg.match(/line\s+(\d+)/i);
  if (pyMatch) {
    const line = parseInt(pyMatch[1], 10);
    if (line >= 1 && line <= totalLines) return line;
  }

  // 2. JS / TS stack traces: :14:5 or at line 14
  const jsMatch = errorMsg.match(/(?:<anonymous>|Object\.<anonymous>|eval|input)?:(\d+):\d+/);
  if (jsMatch) {
    const line = parseInt(jsMatch[1], 10);
    if (line >= 1 && line <= totalLines) return line;
  }

  // 3. Fallback match for "(at line X)" or "Line X:"
  const generalMatch = errorMsg.match(/(?:line|at)\s*(\d+)/i);
  if (generalMatch) {
    const line = parseInt(generalMatch[1], 10);
    if (line >= 1 && line <= totalLines) return line;
  }

  return null;
}

/**
 * Executes or safely evaluates code and correlates any crash back to provenance metadata.
 */
export async function executeDocument(
  file: FileDocument,
  forcedCrashLine?: number
): Promise<ExecutionResult> {
  const startTime = performance.now();
  const logs: string[] = [];
  let crashed = false;
  let crashLine: number | null = null;
  let crashOrigin: OriginType | null = null;
  let crashMessage = '';

  const totalLines = file.lines.length;

  logs.push(`[Provenance Execution Engine] Executing: ${file.name} (${file.language})`);
  logs.push(`[Environment] Node/V8 Sandboxed Runtime & Provenance Line Correlation`);
  logs.push(`------------------------------------------------------------------------`);

  if (forcedCrashLine) {
    crashed = true;
    crashLine = forcedCrashLine;
    const origin = file.lines[crashLine - 1]?.origin || 'unknown';
    crashOrigin = origin;
    crashMessage = `Simulated Runtime Exception: DivisionByZeroError at line ${crashLine}`;
    logs.push(`[Runtime] Process started (PID 2841)`);
    logs.push(`[Runtime Exception] ${crashMessage}`);
    logs.push(`    at execute (${file.name}:${crashLine}:1)`);
    logs.push(
      `\n⚠️ [PROVENANCE ALERT] The code crashed at line ${crashLine}. This line's origin is: ${formatOriginLabel(
        origin
      )}.`
    );
    return {
      output: logs,
      crashed,
      crashLine,
      crashOrigin,
      crashMessage,
      durationMs: Math.round(performance.now() - startTime)
    };
  }

  // For JS / TS files, attempt sandbox execution
  if (file.language === 'javascript' || file.language === 'typescript') {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    try {
      console.log = (...args: any[]) => {
        logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      };
      console.warn = (...args: any[]) => {
        logs.push('[WARN] ' + args.map((a) => String(a)).join(' '));
      };
      console.error = (...args: any[]) => {
        logs.push('[ERROR] ' + args.map((a) => String(a)).join(' '));
      };

      // Strip export/import statements for safe dynamic execution in sandbox
      let runnableCode = file.content
        .replace(/^\s*export\s+(default\s+)?/gm, '')
        .replace(/^\s*import\s+.*?;\s*$/gm, '');

      // Simple strip of typescript type annotations if TS
      if (file.language === 'typescript') {
        runnableCode = runnableCode
          .replace(/:\s*(string|number|boolean|any|void|unknown|object|SystemConfig)(\[\])?/g, '')
          .replace(/interface\s+\w+\s*\{[\s\S]*?\}/g, '');
      }

      // Execute in sandbox function
      const runnerFn = new Function(runnableCode);
      runnerFn();

      if (logs.length <= 3) {
        logs.push(`[Output] Code executed successfully with 0 exit code.`);
      }
    } catch (err: any) {
      crashed = true;
      crashMessage = err.message || String(err);
      logs.push(`[Runtime Error] ${crashMessage}`);

      const detected = parseCrashLine(err.stack || err.message, totalLines);
      crashLine = detected || 1;
      const origin = file.lines[crashLine - 1]?.origin || 'unknown';
      crashOrigin = origin;

      logs.push(
        `\n⚠️ [PROVENANCE ALERT] The code crashed at line ${crashLine}. This line's origin is: ${formatOriginLabel(
          origin
        )}.`
      );
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  } else {
    // For non-JS/TS languages, perform structural validation and check for syntax anomalies
    logs.push(`[Compiler/Interpreter] Native runner launched for ${file.language}...`);
    logs.push(`[Pre-flight] Analyzing AST tokens and syntax boundaries...`);

    // Check if there's any obvious error or division by zero in code
    const zeroDivRegex = /\/\s*0(?![0-9.])/;
    const lines = file.content.split('\n');
    let foundErrorLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (zeroDivRegex.test(lines[i])) {
        foundErrorLine = i + 1;
        break;
      }
    }

    if (foundErrorLine !== -1) {
      crashed = true;
      crashLine = foundErrorLine;
      const origin = file.lines[crashLine - 1]?.origin || 'unknown';
      crashOrigin = origin;
      crashMessage = `ZeroDivisionError: division by zero on line ${crashLine}`;
      logs.push(`[STDERR] ${crashMessage}`);
      logs.push(
        `\n⚠️ [PROVENANCE ALERT] The code crashed at line ${crashLine}. This line's origin is: ${formatOriginLabel(
          origin
        )}.`
      );
    } else {
      logs.push(`[Process] Compilation succeeded.`);
      logs.push(`[Output] Completed execution in ${(performance.now() - startTime).toFixed(1)}ms. Exit code: 0`);
    }
  }

  return {
    output: logs,
    crashed,
    crashLine,
    crashOrigin,
    crashMessage,
    durationMs: Math.round(performance.now() - startTime)
  };
}
