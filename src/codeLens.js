let vscode;
try {
  vscode = require('vscode');
} catch {
  // Unit test fallback
}
const { defaultStore } = require('./lineStore');

/**
 * Parses source code to locate function declarations, classes, and method definitions.
 *
 * @param {string} text - The full document text
 * @param {string} [languageId='javascript'] - Language identifier
 * @returns {Array<{ name: string, startLine: number, endLine: number }>}
 */
function findFunctionBlocks(text, languageId = 'javascript') {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];

  const isPython = languageId === 'python';

  const fnRegex = isPython
    ? /^([ \t]*)(?:async\s+)?(?:def|class)\s+([a-zA-Z0-9_]+)/
    : /^([ \t]*)(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?function|class\s+([a-zA-Z0-9_$]+)|(?:public|private|protected|static|async|\s)*\s*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{|func\s+(?:\([^)]+\)\s*)?([a-zA-Z0-9_]+)|fn\s+([a-zA-Z0-9_]+))/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(fnRegex);
    if (!match) continue;

    const name = match[2] || match[3] || match[4] || match[5] || match[6] || match[7] || match[8] || 'anonymous';
    const indent = match[1].length;
    let endLine = i;

    if (isPython) {
      // Find where indentation returns to <= indent or document ends
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.trim().length === 0) continue;
        const nextIndent = (nextLine.match(/^[ \t]*/) || [''])[0].length;
        if (nextIndent <= indent) {
          break;
        }
        endLine = j;
      }
    } else {
      // Brace counting
      let openBraces = 0;
      let foundStart = false;
      for (let j = i; j < lines.length; j++) {
        const curLine = lines[j];
        for (const char of curLine) {
          if (char === '{') {
            openBraces++;
            foundStart = true;
          } else if (char === '}') {
            openBraces--;
          }
        }
        endLine = j;
        if (foundStart && openBraces <= 0) {
          break;
        }
      }
    }

    blocks.push({
      name,
      startLine: i,
      endLine: Math.max(i, endLine)
    });
  }

  return blocks;
}

/**
 * Computes human vs. AI vs. pasted distribution exclusively within a function block's line range.
 *
 * @param {Array<{ origin: string }>} lines
 * @param {number} startLine
 * @param {number} endLine
 * @returns {object}
 */
function calculateBlockProvenance(lines, startLine, endLine) {
  let typed = 0;
  let pasted = 0;
  let ai = 0;
  let aiNative = 0;
  let ignore = 0;
  let unknown = 0;

  if (Array.isArray(lines)) {
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const origin = lines[i]?.origin;
      if (origin === 'typed') typed++;
      else if (origin === 'pasted') pasted++;
      else if (origin === 'ai') ai++;
      else if (origin === 'ai-native') aiNative++;
      else if (origin === 'ignore') ignore++;
      else unknown++;
    }
  }

  const meaningful = typed + pasted + ai + aiNative;
  const humanPct = meaningful === 0 ? 100 : Math.round((typed / meaningful) * 100);
  const aiTotalPct = meaningful === 0 ? 0 : Math.round(((ai + aiNative) / meaningful) * 100);
  const pastedPct = meaningful === 0 ? 0 : Math.round((pasted / meaningful) * 100);

  let label;
  if (meaningful === 0 || (humanPct === 100 && aiTotalPct === 0)) {
    label = '⚖️ Origin: 100% Human';
  } else if (pastedPct > 0 && humanPct > 0 && aiTotalPct > 0) {
    label = `⚖️ Origin: ${humanPct}% Human | ${aiTotalPct}% AI | ${pastedPct}% Pasted`;
  } else if (pastedPct > 0 && humanPct === 0) {
    label = `⚖️ Origin: 100% Pasted/AI`;
  } else {
    label = `⚖️ Origin: ${humanPct}% Human | ${aiTotalPct}% AI`;
  }

  return {
    typed,
    pasted,
    ai,
    aiNative,
    humanPct,
    aiTotalPct,
    pastedPct,
    label
  };
}

/**
 * VS Code CodeLensProvider delivering floating nutrition labels above functions.
 */
class ProvenanceCodeLensProvider {
  constructor(store = defaultStore) {
    this.store = store;
  }

  provideCodeLenses(document, token) {
    if (!vscode || !document) return [];
    const text = document.getText();
    const uri = document.uri.toString();
    const docLines = this.store.getLines(uri);
    const blocks = findFunctionBlocks(text, document.languageId);

    const lenses = [];
    for (const block of blocks) {
      const stats = calculateBlockProvenance(docLines, block.startLine, block.endLine);
      const range = new vscode.Range(block.startLine, 0, block.startLine, 0);

      const codeLens = new vscode.CodeLens(range, {
        title: stats.label,
        tooltip: `Function: ${block.name} (Lines ${block.startLine + 1}–${block.endLine + 1}). Click to view detailed provenance report.`,
        command: 'provenance.exportReport',
        arguments: [{ uri, functionName: block.name, startLine: block.startLine, endLine: block.endLine }]
      });

      lenses.push(codeLens);
    }

    return lenses;
  }
}

/**
 * Registers the CodeLens provider across all supported languages.
 *
 * @param {vscode.ExtensionContext} context
 * @param {import('./lineStore').LineStore} store
 */
function registerCodeLens(context, store = defaultStore) {
  if (!vscode || !vscode.languages || !vscode.languages.registerCodeLensProvider) {
    return;
  }

  const provider = new ProvenanceCodeLensProvider(store);
  const selector = [
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'python' },
    { scheme: 'file', language: 'go' },
    { scheme: 'file', language: 'rust' },
    { scheme: 'file', language: 'cpp' },
    { scheme: 'file', language: 'java' },
    { scheme: 'file', language: 'csharp' }
  ];

  const disposable = vscode.languages.registerCodeLensProvider(selector, provider);
  context.subscriptions.push(disposable);
}

module.exports = {
  findFunctionBlocks,
  calculateBlockProvenance,
  ProvenanceCodeLensProvider,
  registerCodeLens
};
