const { calculatePercentages } = require('./decorations');
const { GENESIS_PREV_HASH } = require('./hashChain');

/**
 * Builds a structured, privacy-compliant provenance report object.
 *
 * @param {import('./lineStore').LineStore} store
 * @param {import('./hashChain').HashChain} chain
 * @returns {object} Structured report metrics
 */
function generateReportData(store, chain) {
  const fileEntries = [];
  let totalTyped = 0;
  let totalPasted = 0;
  let totalAi = 0;
  let totalAiNative = 0;
  let totalUnknown = 0;

  for (const [uri, lines] of store.documents.entries()) {
    let typed = 0;
    let pasted = 0;
    let ai = 0;
    let aiNative = 0;
    let unknown = 0;

    for (const line of lines) {
      if (line.origin === 'typed') typed++;
      else if (line.origin === 'pasted') pasted++;
      else if (line.origin === 'ai') ai++;
      else if (line.origin === 'ai-native') aiNative++;
      else unknown++;
    }

    const fileTotal = lines.length;
    totalTyped += typed;
    totalPasted += pasted;
    totalAi += ai;
    totalAiNative += aiNative;
    totalUnknown += unknown;

    const filePercentages = calculatePercentages(lines);
    fileEntries.push({
      file: uri,
      totalLines: fileTotal,
      typed,
      pasted,
      ai,
      aiNative,
      unknown,
      percentages: filePercentages
    });
  }

  const grandTotal = totalTyped + totalPasted + totalAi + totalAiNative + totalUnknown;
  const overallPercentages = grandTotal === 0
    ? { typed: 0, pasted: 0, ai: 0, unknown: 0 }
    : {
        typed: Math.round((totalTyped / grandTotal) * 100),
        pasted: Math.round((totalPasted / grandTotal) * 100),
        ai: Math.round((totalAi / grandTotal) * 100),
        ...(totalAiNative > 0 ? { aiNative: Math.round((totalAiNative / grandTotal) * 100) } : {}),
        unknown: Math.round((totalUnknown / grandTotal) * 100)
      };

  // Audit Hash Chain
  const chainLinks = chain ? chain.getChain() : [];
  const chainVerification = chain ? chain.verify() : { valid: true };
  const latestLink = chainLinks.length > 0 ? chainLinks[chainLinks.length - 1] : null;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalFiles: fileEntries.length,
      totalLines: grandTotal,
      typed: totalTyped,
      pasted: totalPasted,
      ai: totalAi,
      aiNative: totalAiNative,
      unknown: totalUnknown,
      percentages: overallPercentages
    },
    files: fileEntries,
    hashChainAudit: {
      totalEvents: chainLinks.length,
      valid: chainVerification.valid,
      brokenIndex: chainVerification.brokenIndex,
      reason: chainVerification.reason,
      genesisPrevHash: GENESIS_PREV_HASH,
      latestHash: latestLink ? latestLink.hash : GENESIS_PREV_HASH
    }
  };
}

/**
 * Generates a Markdown-formatted Provenance Report.
 *
 * @param {object} reportData - Object returned by generateReportData
 * @returns {string} Markdown text
 */
function generateMarkdownReport(reportData) {
  const { summary, files, hashChainAudit, generatedAt } = reportData;
  const auditStatus = hashChainAudit.valid
    ? '✅ Verified (All cryptographic links intact)'
    : `❌ TAMPER DETECTED at link #${hashChainAudit.brokenIndex} (${hashChainAudit.reason})`;

  let md = `# Code Provenance Report\n\n`;
  md += `*Generated on: ${generatedAt}*\n\n`;

  md += `## 1. Workspace Summary\n\n`;
  md += `- **Total Tracked Lines:** ${summary.totalLines}\n`;
  md += `- **Total Files:** ${summary.totalFiles}\n`;
  md += `- **Hand-Typed:** ${summary.percentages.typed}% (${summary.typed} lines)\n`;
  md += `- **Pasted:** ${summary.percentages.pasted}% (${summary.pasted} lines)\n`;
  md += `- **AI-Generated:** ${summary.percentages.ai}% (${summary.ai} lines)\n`;
  if (summary.aiNative > 0) {
    md += `- **AI-Native (Deterministic):** ${summary.percentages.aiNative || 0}% (${summary.aiNative} lines)\n`;
  }
  if (summary.unknown > 0) {
    md += `- **Unmodified / Unknown:** ${summary.percentages.unknown}% (${summary.unknown} lines)\n`;
  }
  md += `\n`;

  md += `## 2. Cryptographic Hash Chain Audit\n\n`;
  md += `- **Audit Status:** ${auditStatus}\n`;
  md += `- **Total Tamper-Evident Events:** ${hashChainAudit.totalEvents}\n`;
  md += `- **Latest Event Hash (SHA-256):** \`${hashChainAudit.latestHash}\`\n\n`;

  md += `## 3. File Breakdown\n\n`;
  if (files.length === 0) {
    md += `*No files currently tracked in active session.*\n`;
  } else {
    md += `| File | Total Lines | Typed | Pasted | AI | Breakdown |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;
    for (const f of files) {
      const breakdown = f.aiNative > 0
        ? `${f.percentages.typed}% T / ${f.percentages.pasted}% P / ${f.percentages.ai}% AI / ${Math.round((f.aiNative / f.totalLines) * 100)}% AI-Native`
        : `${f.percentages.typed}% T / ${f.percentages.pasted}% P / ${f.percentages.ai}% AI`;
      md += `| \`${f.file}\` | ${f.totalLines} | ${f.typed} | ${f.pasted} | ${f.ai} | ${breakdown} |\n`;
    }
  }

  md += `\n---\n*Privacy Notice: This report contains only aggregate counts, line indices, and cryptographic hashes. No source code or clipboard text is stored or exported.*\n`;
  return md;
}

/**
 * Generates an HTML report suitable for VS Code Webviews or standalone viewing.
 *
 * @param {object} reportData - Object returned by generateReportData
 * @returns {string} HTML document string
 */
function generateHtmlReport(reportData) {
  const { summary, files, hashChainAudit, generatedAt } = reportData;
  const statusColor = hashChainAudit.valid ? '#10b981' : '#f43f5e';
  const statusText = hashChainAudit.valid ? 'Cryptographically Verified' : 'Tampering Detected';

  const rows = files.map((f) => `
    <tr>
      <td style="font-family: monospace; color: #f59e0b;">${escapeHtml(f.file)}</td>
      <td style="text-align: center;">${f.totalLines}</td>
      <td style="text-align: center; color: #10b981;">${f.typed} (${f.percentages.typed}%)</td>
      <td style="text-align: center; color: #facc15;">${f.pasted} (${f.percentages.pasted}%)</td>
      <td style="text-align: center; color: #38bdf8;">${f.ai} (${f.percentages.ai}%)</td>
    </tr>
  `).join('');

  const aiNativeStatHtml = summary.aiNative > 0 ? `
    <div class="stat-item"><div class="stat-val" style="color: #c084fc;">${summary.percentages.aiNative || 0}%</div><div class="stat-lbl">AI-Native (${summary.aiNative} L)</div></div>
  ` : '';

  const aiNativeBarHtml = summary.aiNative > 0 ? `
    <div class="bar-ai-native" style="background: #a855f7; width: ${summary.percentages.aiNative || 0}%;" title="AI-Native: ${summary.percentages.aiNative || 0}%"></div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Code Provenance Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1c1917; color: #f5f5f4; margin: 0; padding: 24px; line-height: 1.5; }
    h1 { font-size: 20px; margin-bottom: 4px; color: #fafaf9; }
    .timestamp { font-size: 12px; color: #a8a29e; margin-bottom: 24px; }
    .card { background: #292524; border: 1px solid #44403c; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .card-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #d6d3d1; margin-bottom: 12px; font-weight: 600; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .stat-item { background: #1c1917; padding: 12px; border-radius: 6px; border: 1px solid #44403c; }
    .stat-val { font-size: 20px; font-weight: 700; }
    .stat-lbl { font-size: 11px; color: #a8a29e; text-transform: uppercase; margin-top: 2px; }
    .bar { height: 10px; border-radius: 5px; display: flex; overflow: hidden; margin-top: 14px; background: #44403c; }
    .bar-typed { background: #10b981; width: ${summary.percentages.typed}%; }
    .bar-pasted { background: #facc15; width: ${summary.percentages.pasted}%; }
    .bar-ai { background: #38bdf8; width: ${summary.percentages.ai}%; }
    .bar-unknown { background: #78716c; width: ${summary.percentages.unknown}%; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #44403c; text-align: left; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #a8a29e; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #fff; background: ${statusColor}; }
    .notice { font-size: 11px; color: #78716c; border-top: 1px solid #44403c; padding-top: 16px; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>Code Provenance Report</h1>
  <div class="timestamp">Generated: ${generatedAt}</div>

  <div class="card">
    <div class="card-title">Cryptographic Integrity Audit</div>
    <div>
      <span class="badge">${statusText}</span>
      <span style="font-size: 12px; color: #d6d3d1; margin-left: 12px;">Events Logged: ${hashChainAudit.totalEvents}</span>
    </div>
    <div style="font-family: monospace; font-size: 11px; color: #a8a29e; margin-top: 10px;">
      Latest Hash: ${hashChainAudit.latestHash}
    </div>
  </div>

  <div class="card">
    <div class="card-title">Provenance Distribution</div>
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-val" style="color: #10b981;">${summary.percentages.typed}%</div><div class="stat-lbl">Hand-Typed (${summary.typed} L)</div></div>
      <div class="stat-item"><div class="stat-val" style="color: #facc15;">${summary.percentages.pasted}%</div><div class="stat-lbl">Pasted (${summary.pasted} L)</div></div>
      <div class="stat-item"><div class="stat-val" style="color: #38bdf8;">${summary.percentages.ai}%</div><div class="stat-lbl">AI Copilot (${summary.ai} L)</div></div>
      ${aiNativeStatHtml}
      <div class="stat-item"><div class="stat-val" style="color: #f5f5f4;">${summary.totalLines}</div><div class="stat-lbl">Total Lines</div></div>
    </div>
    <div class="bar">
      <div class="bar-typed" title="Typed: ${summary.percentages.typed}%"></div>
      <div class="bar-pasted" title="Pasted: ${summary.percentages.pasted}%"></div>
      <div class="bar-ai" title="AI: ${summary.percentages.ai}%"></div>
      ${aiNativeBarHtml}
      <div class="bar-unknown" title="Unmodified: ${summary.percentages.unknown}%"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">File Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th style="text-align: center;">Total Lines</th>
          <th style="text-align: center;">Typed</th>
          <th style="text-align: center;">Pasted</th>
          <th style="text-align: center;">AI</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" style="text-align: center; color: #a8a29e;">No tracked files in current session</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="notice">
    Privacy Guarantee: Provenance Tracker records line counts, origins, and SHA-256 hashes only. No source code or clipboard contents are ever collected, transmitted, or exported.
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  generateReportData,
  generateMarkdownReport,
  generateHtmlReport
};
