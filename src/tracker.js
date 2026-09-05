let vscode;
try {
  vscode = require('vscode');
} catch {
  // Unit test fallback
}
const { defaultStore } = require('./lineStore');
const { triggerDebouncedDecorations } = require('./decorations');
const { defaultChain } = require('./hashChain');

const DEFAULT_SUPPORTED_LANGUAGES = [
  'javascript',
  'python',
  'java',
  'cpp',
  'typescript',
  'rust',
  'go',
  'csharp',
  'sql'
];

const warnedLanguages = new Set();

/**
 * Retrieves the configured list of supported programming languages.
 * @returns {string[]}
 */
function getSupportedLanguages() {
  try {
    const config = vscode.workspace.getConfiguration('provenance');
    const configured = config.get('supportedLanguages');
    if (Array.isArray(configured) && configured.length > 0) {
      return configured;
    }
  } catch {
    // vscode config API unavailable in unit test harness
  }
  return DEFAULT_SUPPORTED_LANGUAGES;
}

/**
 * Validates whether the document language is explicitly supported.
 * Issues a single warning per session when encountering an unsupported language.
 *
 * @param {vscode.TextDocument} document
 * @returns {boolean}
 */
function checkLanguageSupport(document) {
  if (!document) return false;
  const langId = document.languageId;
  if (!langId) return true;

  const supported = getSupportedLanguages();
  if (!supported.includes(langId)) {
    if (!warnedLanguages.has(langId)) {
      warnedLanguages.add(langId);
      if (vscode.window && vscode.window.showWarningMessage) {
        vscode.window.showWarningMessage(
          `Provenance Tracker Error: The language '${langId}' is not currently supported or does not match your settings.`
        );
      }
    }
    return false;
  }
  return true;
}

/**
 * Checks if a document should be tracked.
 * Filters out non-file documents, ignored paths, and unsupported languages.
 *
 * @param {vscode.TextDocument} document
 * @returns {boolean}
 */
function shouldTrackDocument(document) {
  if (!document || !document.uri) {
    return false;
  }

  // Only track real files on disk
  if (document.uri.scheme !== 'file') {
    return false;
  }

  const fsPath = document.uri.fsPath || '';
  const ignoredPatterns = ['node_modules', '.git', 'dist', 'out'];

  for (const pattern of ignoredPatterns) {
    if (fsPath.includes(pattern)) {
      return false;
    }
  }

  // Phase 12: Language Validation & Guardrails
  if (!checkLanguageSupport(document)) {
    return false;
  }

  return true;
}

// Phase 15: Timestamp of last inline suggestion accept command or inline commit
let lastInlineSuggestCommitTime = 0;

function markInlineSuggestCommitted() {
  lastInlineSuggestCommitTime = Date.now();
}

/**
 * Classifies a single content change as typed, pasted, ai, ai-native, ignore, unknown, or deletion.
 *
 * Phase 11: Meaningful Content Filter - Pure whitespace and blank lines are classified as "ignore".
 * Phase 15: The Deterministic AI Intercept (Copilot Catcher) - Identifies direct inline completions.
 *
 * @param {string} text - The inserted text (empty if deletion)
 * @param {boolean} [forcedAiNative=false] - Explicit flag indicating inline completion acceptance
 * @returns {Promise<'typed' | 'pasted' | 'ai' | 'ai-native' | 'ignore' | 'unknown' | 'deletion'>}
 */
async function classifyChange(text, forcedAiNative = false) {
  // 1. Deletions have zero length
  if (text.length === 0) {
    return 'deletion';
  }

  // Phase 11: Ignore purely whitespace changes (spaces, tabs, newlines, blank lines)
  if (text.trim().length === 0) {
    return 'ignore';
  }

  // Phase 15: Explicitly intercepted inline suggestion commit or active flag
  const isRecentInlineCommit = (Date.now() - lastInlineSuggestCommitTime) < 500;
  if (forcedAiNative || isRecentInlineCommit) {
    return 'ai-native';
  }

  // 2. Fast human typing: 1 to 3 characters at a time, no newlines
  if (text.length <= 3 && !text.includes('\n')) {
    return 'typed';
  }

  // 3. Multi-line inserts or larger chunks (> 20 chars)
  if (text.length > 20 || text.includes('\n')) {
    try {
      const clipboardText = await vscode.env.clipboard.readText();
      // Note: Never log or store the clipboardText to protect user privacy.
      if (clipboardText === text) {
        return 'pasted';
      }
      // Phase 15: Text appeared without being in clipboard -> deterministic AI-Native Copilot intercept
      return 'ai-native';
    } catch {
      return 'ai-native';
    }
  }

  // 4. Multi-word single line insertion not matching clipboard
  if (text.trim().includes(' ') && text.length > 5) {
    try {
      const clipboardText = await vscode.env.clipboard.readText();
      if (clipboardText === text) {
        return 'pasted';
      }
      return 'ai-native';
    } catch {
      return 'ai-native';
    }
  }

  // 5. Anything else (e.g. 4-20 chars single-line identifier)
  return 'unknown';
}

/**
 * Subscribes to document change events, classifies each change,
 * and maintains the in-memory line provenance store with shift math.
 *
 * @param {vscode.ExtensionContext} context
 */
function registerTracker(context) {
  // When a document opens, initialize line store if needed
  const openSub = vscode.workspace.onDidOpenTextDocument((document) => {
    if (shouldTrackDocument(document)) {
      defaultStore.getOrCreate(document.uri.toString(), document.lineCount);
    }
  });

  // When a document closes, clean up memory
  const closeSub = vscode.workspace.onDidCloseTextDocument((document) => {
    defaultStore.deleteDocument(document.uri.toString());
  });

  const changeSub = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (!shouldTrackDocument(event.document)) {
      return;
    }

    const uri = event.document.uri.toString();

    // Process every change in the event (handles multi-cursor edits cleanly)
    for (const change of event.contentChanges) {
      const classification = await classifyChange(change.text);

      const startLine = change.range.start.line;
      const endLine = change.range.end.line;
      const length = change.text.length;

      // Update the in-memory LineStore with shift calculations
      const effectiveOrigin = classification === 'deletion' ? 'unknown' : classification;
      defaultStore.applyChange(uri, change, effectiveOrigin);

      // Phase 6: Append tamper-evident event to hash chain (metadata only, zero code)
      defaultChain.append({
        file: uri,
        changeType: classification,
        range: { startLine, endLine },
        lineCount: event.document.lineCount
      });
    }

    // Phase 4: Trigger debounced editor heatmap decorations (150ms debounce)
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === uri) {
      triggerDebouncedDecorations(activeEditor, defaultStore, context);
    }
  });

  context.subscriptions.push(openSub, closeSub, changeSub);
}

module.exports = {
  shouldTrackDocument,
  classifyChange,
  markInlineSuggestCommitted,
  registerTracker
};
