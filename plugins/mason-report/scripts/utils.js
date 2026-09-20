'use strict'

const fs = require('fs')
const path = require('path')

const MASON_REPORT_DIR_NAME = '.mason-report'
const MAX_STDIN_BYTES = 2 * 1024 * 1024 // 2 MiB hard cap on hook input we will even attempt to parse
const MAX_FIELD_CHARS = 4000 // per-field truncation cap for any stored summary/text
const MAX_EVENT_FILE_BYTES = 5 * 1024 * 1024 // rotate a per-session file past this size
const MAX_EVENT_FILES = 50 // keep at most this many rotated event files (project-wide)

/**
 * Write a one-line diagnostic to stderr only. Never stdout: for several hook
 * events (UserPromptSubmit, SessionStart, ...) Claude Code injects plain-text
 * stdout into the model's context on exit 0, so any stdout output from this
 * plugin's scripts would leak into Claude's context unexpectedly. Hooks must
 * stay observation-only, so capture scripts never print to stdout.
 */
function debugLog(message) {
  try {
    process.stderr.write(`[mason-report] ${message}\n`)
  } catch {
    // Never let logging itself throw.
  }
}

/**
 * Parse JSON safely. Returns { ok: true, value } or { ok: false, error }.
 * Never throws.
 */
function safeJSONParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) }
  }
}

/**
 * Resolve the project root to use for storage.
 *
 * Preference order:
 *  1. `CLAUDE_PROJECT_DIR` env var (officially documented, set by Claude Code)
 *  2. `cwd` field from the hook's own input JSON (documented common field)
 *
 * Returns null (never a guessed/arbitrary path) if neither is available or
 * the candidate does not exist / is not a directory, so callers can skip
 * storage safely instead of writing somewhere unexpected.
 */
function resolveProjectRoot(hookInput) {
  const candidates = []
  if (process.env.CLAUDE_PROJECT_DIR) candidates.push(process.env.CLAUDE_PROJECT_DIR)
  if (hookInput && typeof hookInput.cwd === 'string') candidates.push(hookInput.cwd)

  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate)
      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) return resolved
    } catch {
      // try next candidate
    }
  }
  return null
}

function masonReportRoot(projectRoot) {
  return path.join(projectRoot, MASON_REPORT_DIR_NAME)
}

function logPaths(projectRoot) {
  const root = masonReportRoot(projectRoot)
  return {
    root,
    events: path.join(root, 'events'),
    reports: path.join(root, 'reports'),
    state: path.join(root, 'state'),
    config: path.join(root, 'config.json'),
  }
}

/**
 * Ensure a directory exists. Refuses (returns false) instead of writing
 * through a symlink that escapes the project root, so a symlinked
 * `.mason-report` (or a subdirectory of it) can never redirect writes outside
 * the project.
 */
function ensureDirSafe(dir, projectRoot) {
  try {
    if (fs.existsSync(dir)) {
      const lst = fs.lstatSync(dir)
      if (lst.isSymbolicLink()) {
        const real = fs.realpathSync(dir)
        const realProjectRoot = fs.realpathSync(projectRoot)
        const relative = path.relative(realProjectRoot, real)
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          debugLog(`refusing to write through symlink escaping project root: ${dir}`)
          return false
        }
      }
    }
    fs.mkdirSync(dir, { recursive: true })
    return true
  } catch (err) {
    debugLog(`could not create directory ${dir}: ${err && err.message}`)
    return false
  }
}

/**
 * Truncate a string to a maximum character length, marking that truncation
 * happened so reports can be honest about it.
 */
function truncate(text, maxChars = MAX_FIELD_CHARS) {
  if (typeof text !== 'string') return text
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `... [truncated ${text.length - maxChars} chars]`
}

/**
 * Append one JSON object as a line to a JSONL file. Creates parent dirs as
 * needed. Uses an 'a' (append) file descriptor write, which on POSIX
 * filesystems is atomic for writes below PIPE_BUF for a single write(2)
 * call, keeping concurrent hook processes from interleaving mid-line.
 * Never throws — logs and returns false on failure instead.
 */
function appendJSONLSafe(filePath, obj) {
  try {
    const line = JSON.stringify(obj) + '\n'
    fs.appendFileSync(filePath, line, { encoding: 'utf8' })
    return true
  } catch (err) {
    debugLog(`failed to append event: ${err && err.message}`)
    return false
  }
}

/**
 * Read a small JSON config file safely, returning defaults on any failure.
 */
function readJSONSafe(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = safeJSONParse(raw)
    return parsed.ok ? parsed.value : fallback
  } catch {
    return fallback
  }
}

function writeJSONSafe(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
    return true
  } catch (err) {
    debugLog(`failed to write ${filePath}: ${err && err.message}`)
    return false
  }
}

/**
 * Ensure the project's .gitignore excludes .mason-report/, without clobbering
 * existing content. Reads the current file first; only appends when no
 * existing pattern already matches. No-ops safely if .gitignore can't be
 * read or written.
 */
function ensureGitignoreEntry(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const entry = '.mason-report/'

  let existing = ''
  try {
    if (fs.existsSync(gitignorePath)) {
      existing = fs.readFileSync(gitignorePath, 'utf8')
    }
  } catch (err) {
    debugLog(`could not read .gitignore: ${err && err.message}`)
    return false
  }

  const lines = existing.split(/\r?\n/).map((l) => l.trim())
  const alreadyCovered = lines.some(
    (l) => l === '.mason-report' || l === '.mason-report/' || l === '/.mason-report' || l === '/.mason-report/'
  )
  if (alreadyCovered) return true

  try {
    const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n')
    const addition = (needsLeadingNewline ? '\n' : '') + '\n# mason-report local logs (added by mason-report plugin)\n' + entry + '\n'
    fs.appendFileSync(gitignorePath, addition, 'utf8')
    debugLog(`added ${entry} to .gitignore`)
    return true
  } catch (err) {
    debugLog(`could not update .gitignore: ${err && err.message}`)
    return false
  }
}

function sessionEventFile(events, sessionId) {
  const safeId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'unknown-session'
  const safeName = safeId.replace(/[^A-Za-z0-9._-]/g, '_')
  return path.join(events, `${safeName}.jsonl`)
}

module.exports = {
  MASON_REPORT_DIR_NAME,
  MAX_STDIN_BYTES,
  MAX_FIELD_CHARS,
  MAX_EVENT_FILE_BYTES,
  MAX_EVENT_FILES,
  debugLog,
  safeJSONParse,
  resolveProjectRoot,
  masonReportRoot,
  logPaths,
  ensureDirSafe,
  truncate,
  appendJSONLSafe,
  readJSONSafe,
  writeJSONSafe,
  ensureGitignoreEntry,
  sessionEventFile,
}
