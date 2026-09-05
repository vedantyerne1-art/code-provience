const vscode = require('vscode');
const { registerTracker, markInlineSuggestCommitted } = require('./src/tracker');
const { defaultStore } = require('./src/lineStore');
const { registerDecorations } = require('./src/decorations');
const {
  buildProvenancePayload,
  writeProvenanceNote,
  readProvenanceNote,
  getHeadCommitHash,
  pushProvenance
} = require('./src/gitNotes');
const { defaultChain } = require('./src/hashChain');
const {
  generateReportData,
  generateMarkdownReport,
  generateHtmlReport
} = require('./src/report');
const {
  createAttestationBundle,
  installPreCommitHook
} = require('./src/verifier');
const { runAndAnalyzeCode } = require('./src/runner');
const { registerCodeLens } = require('./src/codeLens');
const { registerPipelineGenerator } = require('./src/pipelineGen');
const { registerCapstone } = require('./src/capstone');

/**
 * Called when the extension is activated.
 * Registers commands, tracker listeners, and heatmap decorations.
 *
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Register the Hello World command
  const helloCommand = vscode.commands.registerCommand('provenance.helloWorld', () => {
    vscode.window.showInformationMessage('Provenance Tracker is active');
  });
  context.subscriptions.push(helloCommand);

  // Phase 2 & 3: Start tracking document changes and maintain LineStore
  registerTracker(context);

  // Phase 4: Register heatmap decorations, debounce mechanism, toggle command & status bar
  registerDecorations(context, defaultStore);

  // Phase 5: Git Notes persistence commands
  const saveNoteCmd = vscode.commands.registerCommand('provenance.saveGitNote', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('No workspace folder open for Git notes.');
      return;
    }

    const repoPath = folders[0].uri.fsPath;
    const headHash = await getHeadCommitHash(repoPath);
    if (!headHash) {
      vscode.window.showWarningMessage('Not in a git repository or HEAD commit not found.');
      return;
    }

    // Collect tracked files from defaultStore
    const trackedKeys = Array.from(defaultStore.documents.keys());
    const payload = buildProvenancePayload(defaultStore, trackedKeys);

    await writeProvenanceNote(repoPath, 'HEAD', payload);
    vscode.window.showInformationMessage(`Provenance saved to Git note on HEAD (${headHash.slice(0, 7)})`);
  });

  const showNoteCmd = vscode.commands.registerCommand('provenance.showGitNote', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('No workspace folder open for Git notes.');
      return;
    }

    const repoPath = folders[0].uri.fsPath;
    const note = await readProvenanceNote(repoPath, 'HEAD');
    if (!note) {
      vscode.window.showInformationMessage('No provenance note found for HEAD.');
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(note, null, 2),
      language: 'json'
    });
    await vscode.window.showTextDocument(doc);
  });

  // Phase 6: Hash chain verification command
  const verifyChainCmd = vscode.commands.registerCommand('provenance.verifyChain', () => {
    const result = defaultChain.verify();
    const count = defaultChain.getChain().length;
    if (result.valid) {
      vscode.window.showInformationMessage(`Hash Chain Valid: ${count} edit events verified successfully.`);
    } else {
      vscode.window.showErrorMessage(`Hash Chain Broken at event #${result.brokenIndex}: ${result.reason}`);
    }
  });

  // Phase 7: Generate Provenance Report command
  const generateReportCmd = vscode.commands.registerCommand('provenance.generateReport', async () => {
    const reportData = generateReportData(defaultStore, defaultChain);

    // If webview panel API is available, show graphical dashboard
    if (vscode.window.createWebviewPanel) {
      const panel = vscode.window.createWebviewPanel(
        'provenanceReport',
        'Provenance Report',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );
      panel.webview.html = generateHtmlReport(reportData);
    } else {
      // Fallback: Open Markdown representation in text editor
      const markdown = generateMarkdownReport(reportData);
      const doc = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown'
      });
      await vscode.window.showTextDocument(doc);
    }
  });

  // Phase 8: Export Attestation Bundle command
  const exportAttestationCmd = vscode.commands.registerCommand('provenance.exportAttestation', async () => {
    const folders = vscode.workspace.workspaceFolders;
    const repo = folders && folders.length > 0 ? folders[0].name : 'workspace';
    const bundle = createAttestationBundle(defaultStore, defaultChain, { repository: repo });

    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(bundle, null, 2),
      language: 'json'
    });
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Exported sealed provenance attestation (SHA-256 digest: ${bundle.attestationDigest.slice(0, 12)}...)`);
  });

  // Phase 8: Install Git Pre-Commit Hook command
  const installHookCmd = vscode.commands.registerCommand('provenance.installPreCommitHook', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('No workspace folder open to install Git pre-commit hook.');
      return;
    }

    try {
      const repoPath = folders[0].uri.fsPath;
      const hookPath = installPreCommitHook(repoPath);
      vscode.window.showInformationMessage(`Provenance pre-commit hook installed to ${hookPath}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to install pre-commit hook: ${err.message}`);
    }
  });

  // Phase 13: Native Execution & Provenance-Aware Error Tracking command
  const runCodeCmd = vscode.commands.registerCommand('provenance.runCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active code file open to run.');
      return;
    }
    await runAndAnalyzeCode(editor.document, defaultStore);
  });

  // Phase 14: One-Click GitHub Sync (Commits + Notes) command
  const pushToGitHubCmd = vscode.commands.registerCommand('provenance.pushToGitHub', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('No workspace folder open for remote push.');
      return;
    }
    const repoPath = folders[0].uri.fsPath;

    if (vscode.window.withProgress) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Provenance: Push Code and Records to Remote',
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: 'Syncing provenance records to remote...' });
          const res = await pushProvenance(repoPath);
          if (res.success) {
            vscode.window.showInformationMessage('Provenance records (refs/notes/provenance) and commits pushed successfully!');
          } else {
            vscode.window.showErrorMessage(`Push failed: ${res.message}`);
          }
        }
      );
    } else {
      const res = await pushProvenance(repoPath);
      if (res.success) {
        vscode.window.showInformationMessage('Provenance records and commits pushed successfully!');
      } else {
        vscode.window.showErrorMessage(`Push failed: ${res.message}`);
      }
    }
  });

  // Phase 15: Intercept inline suggestion commit (Copilot Catcher)
  try {
    const inlineCommitCmd = vscode.commands.registerCommand('editor.action.inlineSuggest.commit', async (...args) => {
      markInlineSuggestCommitted();
      return vscode.commands.executeCommand('default:editor.action.inlineSuggest.commit', ...args);
    });
    context.subscriptions.push(inlineCommitCmd);
  } catch {
    // Built-in command wrapping guarded for unit tests & sandbox
  }

  // Phase 16: Register Function-Level Nutrition Labels (CodeLens)
  registerCodeLens(context, defaultStore);

  // Command alias for CodeLens click and report export
  const exportReportCmd = vscode.commands.registerCommand('provenance.exportReport', async (args) => {
    return vscode.commands.executeCommand('provenance.generateReport', args);
  });

  // Phase 17: Register CI/CD Gatekeeper generator command
  registerPipelineGenerator(context);

  // Phase 18: Register Capstone Repository Seal generator command
  registerCapstone(context, defaultStore, defaultChain);

  context.subscriptions.push(
    saveNoteCmd,
    showNoteCmd,
    verifyChainCmd,
    generateReportCmd,
    exportReportCmd,
    exportAttestationCmd,
    installHookCmd,
    runCodeCmd,
    pushToGitHubCmd
  );
}

/**
 * Called when the extension is deactivated.
 */
function deactivate() {}

module.exports = {
  activate,
  deactivate
};
