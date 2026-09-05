let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}
const { spawn } = require('child_process');
const path = require('path');
const { defaultStore } = require('./lineStore');

let outputChannel = null;

/**
 * Returns or creates the singleton VS Code Output Channel for code execution.
 * @returns {vscode.OutputChannel | null}
 */
function getOutputChannel() {
  if (!outputChannel && vscode && vscode.window && vscode.window.createOutputChannel) {
    outputChannel = vscode.window.createOutputChannel('Provenance Execution');
  }
  return outputChannel;
}

/**
 * Parses stderr output to detect the crash line number.
 * Supports Node.js / JavaScript / TypeScript stack traces, Python tracebacks,
 * and compiler / runtime error patterns (Java, C++, etc.).
 *
 * @param {string} stderr
 * @returns {number | null} 1-based line number or null if undetected
 */
function parseCrashLineNumber(stderr) {
  if (!stderr || typeof stderr !== 'string') {
    return null;
  }

  // 1. Python tracebacks: File "...", line 12, in <module>
  const pyMatch = stderr.match(/line\s+(\d+)/i);
  if (pyMatch) {
    return parseInt(pyMatch[1], 10);
  }

  // 2. Node / JS / TS stack traces: (file.js:14:5) or at file.js:14:5
  const jsMatch = stderr.match(/:(\d+):\d+/);
  if (jsMatch) {
    return parseInt(jsMatch[1], 10);
  }

  // 3. General compiler / syntax errors: Line 14: or (14)
  const generalMatch = stderr.match(/(?:line|at)\s*(\d+)/i);
  if (generalMatch) {
    return parseInt(generalMatch[1], 10);
  }

  return null;
}

/**
 * Converts internal provenance origin tags to clear human-readable labels.
 * @param {string} origin
 * @returns {string}
 */
function formatOriginLabel(origin) {
  switch (origin) {
    case 'ai':
      return 'AI-Generated';
    case 'typed':
      return 'Human-Typed';
    case 'pasted':
      return 'Pasted from Clipboard';
    case 'ignore':
      return 'Whitespace / Ignored';
    case 'unknown':
    default:
      return 'Unknown / Pre-existing';
  }
}

/**
 * Resolves the runner command and arguments based on the document's languageId.
 * @param {vscode.TextDocument} document
 * @returns {{cmd: string, args: string[]}}
 */
function getExecutionCommand(document) {
  const filePath = document.fileName;
  const langId = document.languageId || path.extname(filePath).replace('.', '');

  if (langId === 'python' || langId === 'py') {
    const pyBinary = process.platform === 'win32' ? 'python' : 'python3';
    return { cmd: pyBinary, args: [filePath] };
  }

  if (langId === 'sh' || langId === 'bash' || langId === 'shell') {
    return { cmd: 'bash', args: [filePath] };
  }

  // Default to Node.js for Javascript and Typescript (or tsx if available)
  return { cmd: 'node', args: [filePath] };
}

/**
 * Executes the given code file, displays live stdout/stderr in the output channel,
 * and correlates any runtime crash lines with their provenance origin.
 *
 * @param {vscode.TextDocument} [document]
 * @param {import('./lineStore').LineStore} [store=defaultStore]
 * @returns {Promise<{success: boolean, code: number, stdout: string, stderr: string, crashLine?: number, provenanceOrigin?: string}>}
 */
async function runAndAnalyzeCode(document, store = defaultStore) {
  if (!document) {
    const editor = vscode.window && vscode.window.activeTextEditor;
    if (editor) {
      document = editor.document;
    }
  }

  if (!document) {
    if (vscode.window && vscode.window.showWarningMessage) {
      vscode.window.showWarningMessage('Provenance Tracker: No active code file to execute.');
    }
    return { success: false, code: 1, stdout: '', stderr: 'No active document' };
  }

  // Automatically save document before execution
  if (document.isDirty) {
    await document.save();
  }

  const channel = getOutputChannel();
  if (channel) {
    channel.clear();
    channel.show(true);
    channel.appendLine(`============================================================`);
    channel.appendLine(`🚀 [PROVENANCE RUNNER] Executing: ${document.fileName}`);
    channel.appendLine(`   Language: ${document.languageId || 'auto'} | Lines: ${document.lineCount}`);
    channel.appendLine(`============================================================\n`);
  }

  const { cmd, args } = getExecutionCommand(document);
  const cwd = path.dirname(document.fileName);

  return new Promise((resolve) => {
    let stdoutOutput = '';
    let stderrOutput = '';

    const child = spawn(cmd, args, {
      cwd,
      shell: true
    });

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutOutput += text;
      if (channel) {
        channel.append(text);
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderrOutput += text;
      if (channel) {
        channel.append(text);
      }
    });

    child.on('error', (err) => {
      if (channel) {
        channel.appendLine(`\n❌ Execution spawn error: ${err.message}`);
      }
      resolve({
        success: false,
        code: 1,
        stdout: stdoutOutput,
        stderr: err.message
      });
    });

    child.on('close', (code) => {
      if (channel) {
        channel.appendLine(`\n------------------------------------------------------------`);
      }

      if (code !== 0) {
        const crashLine = parseCrashLineNumber(stderrOutput);
        let provenanceOrigin = 'unknown';

        if (crashLine !== null) {
          const lines = store.getLines(document.uri.toString());
          const lineIndex = crashLine - 1; // Convert 1-based to 0-based index
          const tag = lines && lines[lineIndex];
          provenanceOrigin = tag ? tag.origin : 'unknown';

          const label = formatOriginLabel(provenanceOrigin);
          const alertMessage = `[PROVENANCE ALERT] The code crashed at line ${crashLine}. This line's origin is: ${label}.`;

          if (channel) {
            channel.appendLine(`\n⚠️  ${alertMessage}`);
          }
          if (vscode.window && vscode.window.showErrorMessage) {
            vscode.window.showErrorMessage(alertMessage);
          }

          resolve({
            success: false,
            code,
            stdout: stdoutOutput,
            stderr: stderrOutput,
            crashLine,
            provenanceOrigin
          });
        } else {
          if (channel) {
            channel.appendLine(`⚠️  Process exited with error code ${code}.`);
          }
          resolve({
            success: false,
            code,
            stdout: stdoutOutput,
            stderr: stderrOutput
          });
        }
      } else {
        if (channel) {
          channel.appendLine(`✅ Process completed successfully (exit code 0).`);
        }
        resolve({
          success: true,
          code: 0,
          stdout: stdoutOutput,
          stderr: stderrOutput
        });
      }
    });
  });
}

module.exports = {
  getOutputChannel,
  parseCrashLineNumber,
  formatOriginLabel,
  getExecutionCommand,
  runAndAnalyzeCode
};
