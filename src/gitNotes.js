const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const PROVENANCE_REF = 'refs/notes/provenance';

/**
 * Builds a privacy-compliant provenance payload from tracked documents.
 * Never includes code or file contents, only line indices, origins, and timestamps.
 *
 * @param {import('./lineStore').LineStore} store
 * @param {string[]} filePaths - Relative or absolute paths to tracked files
 * @returns {object} JSON-serializable payload
 */
function buildProvenancePayload(store, filePaths) {
  const files = [];

  for (const filePath of filePaths) {
    // Check if store has records for this file path or URI
    const lines = store.getLines(filePath);
    if (!lines || lines.length === 0) continue;

    const lineRecords = [];
    const summary = { typed: 0, pasted: 0, ai: 0, unknown: 0, total: lines.length };

    lines.forEach((entry, idx) => {
      const origin = entry.origin || 'unknown';
      if (summary[origin] !== undefined) summary[origin]++;
      else summary.unknown++;

      lineRecords.push({
        line: idx,
        origin,
        timestamp: entry.timestamp || Date.now()
      });
    });

    files.push({
      path: filePath,
      summary,
      lines: lineRecords
    });
  }

  return {
    version: 1,
    timestamp: Date.now(),
    files
  };
}

/**
 * Executes a git command safely using argument arrays to prevent shell injection.
 *
 * @param {string} repoPath
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function runGitCommand(repoPath, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout.trim();
}

/**
 * Writes a provenance record to a commit's git note under refs/notes/provenance.
 *
 * @param {string} repoPath - Workspace root path with a .git directory
 * @param {string} commitHash - Target commit SHA (e.g. 'HEAD' or full 40-char SHA)
 * @param {object} payload - Provenance data object
 * @returns {Promise<boolean>}
 */
async function writeProvenanceNote(repoPath, commitHash, payload) {
  const payloadJson = JSON.stringify(payload, null, 2);

  // git notes --ref=refs/notes/provenance add -f -m <json> <commitHash>
  // Argument array guarantees no shell interpolation or escaping vulnerabilities
  const args = [
    'notes',
    `--ref=${PROVENANCE_REF}`,
    'add',
    '-f',
    '-m',
    payloadJson,
    commitHash
  ];

  await runGitCommand(repoPath, args);
  return true;
}

/**
 * Reads the provenance record from a commit's git note.
 *
 * @param {string} repoPath
 * @param {string} commitHash
 * @returns {Promise<object|null>} Parsed JSON or null if no note exists
 */
async function readProvenanceNote(repoPath, commitHash) {
  try {
    const args = ['notes', `--ref=${PROVENANCE_REF}`, 'show', commitHash];
    const rawNote = await runGitCommand(repoPath, args);
    return JSON.parse(rawNote);
  } catch (err) {
    // Git exits with non-zero if note does not exist for commit
    return null;
  }
}

/**
 * Returns the current HEAD commit hash if inside a valid Git repository.
 *
 * @param {string} repoPath
 * @returns {Promise<string|null>}
 */
async function getHeadCommitHash(repoPath) {
  try {
    return await runGitCommand(repoPath, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

/**
 * Pushes both branch commits and hidden Git notes (refs/notes/provenance) to the remote repository.
 *
 * @param {string} repoPath - Workspace root path
 * @param {string} [remote='origin'] - Git remote name
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function pushProvenance(repoPath, remote = 'origin') {
  try {
    // 1. Push standard branch commits (pushing HEAD to ensure current branch is pushed)
    await runGitCommand(repoPath, ['push', remote, 'HEAD']);
    // 2. Push hidden provenance notes ref
    await runGitCommand(repoPath, ['push', remote, PROVENANCE_REF]);
    return {
      success: true,
      message: `Successfully pushed commits and ${PROVENANCE_REF} to ${remote}.`
    };
  } catch (err) {
    return {
      success: false,
      message: err.message || 'Failed to push to remote.'
    };
  }
}

module.exports = {
  PROVENANCE_REF,
  buildProvenancePayload,
  writeProvenanceNote,
  readProvenanceNote,
  getHeadCommitHash,
  pushProvenance,
  runGitCommand
};
