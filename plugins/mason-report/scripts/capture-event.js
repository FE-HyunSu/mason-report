#!/usr/bin/env node
'use strict'

/**
 * mason-report hook entrypoint.
 *
 * Receives one Claude Code hook event JSON on stdin, extracts an allowlisted
 * subset of fields (never the raw payload), masks sensitive substrings, and
 * appends the result as one JSONL line under <project>/.mason-report/events/.
 *
 * Hard rules this file must uphold (see docs/privacy.md and README):
 *  - Never throw in a way that stops Claude Code's own turn. Any failure
 *    here is swallowed and logged to stderr only; the process still exits 0.
 *  - Never write to stdout. For SessionStart/UserPromptSubmit/... Claude
 *    Code injects plain-text stdout into the model's context on exit 0, so
 *    printing anything there would leak into Claude's context as a side
 *    effect this plugin must not have.
 *  - Never block: this script never emits a hookSpecificOutput / exit-2
 *    decision. It only observes.
 *  - Never store full file contents or full tool-result bodies. Only paths,
 *    operation types, and small masked/truncated summaries.
 */

const fs = require('fs')
const path = require('path')

const {
  MAX_STDIN_BYTES,
  MAX_FIELD_CHARS,
  MAX_EVENT_FILE_BYTES,
  MAX_EVENT_FILES,
  debugLog,
  safeJSONParse,
  resolveProjectRoot,
  logPaths,
  ensureDirSafe,
  truncate,
  appendJSONLSafe,
  writeJSONSafe,
  ensureGitignoreEntry,
  sessionEventFile,
} = require('./utils')

const { redactText, isDotEnvPath, isSensitiveKey } = require('./redact')
const { rotateIfNeeded } = require('./rotate-logs')

const SCHEMA_VERSION = 1

// Tools whose *result* content is file-shaped: never store their output,
// only that the operation happened (path + operation type already come
// from the PreToolUse side; here we only note completion).
const FILE_CONTENT_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit'])

// Tools whose result is operational text worth a short masked snippet
// (command output, fetch/search results, search matches) rather than file
// content.
const OPERATIONAL_TEXT_TOOLS = new Set(['Bash', 'WebFetch', 'WebSearch', 'Grep'])

function relativizeMaybe(p, projectRoot) {
  if (typeof p !== 'string' || !p) return p
  if (!projectRoot) return p
  try {
    const abs = path.resolve(p)
    const rel = path.relative(projectRoot, abs)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel
  } catch {
    // fall through
  }
  return p
}

/**
 * Mask + truncate one field's text. When `counter` is passed (an object with
 * a numeric `count`), the number of substitutions redactText made is added
 * to it — this is how buildEnvelope accumulates an accurate total instead of
 * losing the count once the secret has already been replaced with the mask
 * placeholder (a later blanket pass over already-masked text would find
 * nothing left to count).
 */
function maskedTruncate(text, maxChars, counter) {
  const { text: masked, count } = redactText(typeof text === 'string' ? text : '')
  if (counter) counter.count += count
  return truncate(masked, maxChars)
}

/** Shape-only summary: preserves structure and lengths, never leaf string content. */
function shapeSummary(value, depth) {
  const d = depth || 0
  if (value == null) return value
  if (typeof value === 'string') return `string(len=${value.length})`
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return `array(len=${value.length})`
  if (typeof value === 'object') {
    if (d >= 2) return 'object'
    const keys = Object.keys(value).slice(0, 20)
    const out = {}
    for (const key of keys) {
      out[key] = isSensitiveKey(key) ? '[REDACTED]' : shapeSummary(value[key], d + 1)
    }
    return out
  }
  return typeof value
}

function extractTextFromResponse(response) {
  if (typeof response === 'string') return response
  if (response && typeof response === 'object') {
    const parts = []
    for (const key of ['stdout', 'stderr', 'output', 'result', 'message', 'error']) {
      if (typeof response[key] === 'string') parts.push(response[key])
    }
    return parts.join('\n')
  }
  return ''
}

function extractToolInputSummary(toolName, toolInput, projectRoot, counter) {
  if (!toolInput || typeof toolInput !== 'object') return {}

  switch (toolName) {
    case 'Bash':
      return {
        command: maskedTruncate(toolInput.command, 2000, counter),
        description:
          typeof toolInput.description === 'string' ? maskedTruncate(toolInput.description, 300, counter) : undefined,
        runInBackground: !!toolInput.run_in_background,
      }
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const p = toolInput.file_path || toolInput.notebook_path
      return {
        path: relativizeMaybe(p, projectRoot),
        operation: toolName.toLowerCase(),
        isDotEnv: isDotEnvPath(p || ''),
      }
    }
    case 'Glob':
      return { pattern: toolInput.pattern, path: relativizeMaybe(toolInput.path, projectRoot) }
    case 'Grep':
      return { pattern: toolInput.pattern, path: relativizeMaybe(toolInput.path, projectRoot) }
    case 'WebFetch':
      return { url: maskedTruncate(toolInput.url, 300, counter) }
    case 'WebSearch':
      return { query: maskedTruncate(toolInput.query, 300, counter) }
    case 'Task':
    case 'Agent':
      return {
        subagentType: toolInput.subagent_type,
        description:
          typeof toolInput.description === 'string' ? maskedTruncate(toolInput.description, 300, counter) : undefined,
      }
    default:
      // Unknown tool: record only which keys were present, never their values.
      return { inputKeys: Object.keys(toolInput).slice(0, 30) }
  }
}

function extractToolResultSummary(toolName, response, isFailure, counter) {
  if (FILE_CONTENT_TOOLS.has(toolName)) {
    return { note: 'content-not-stored' }
  }
  if (OPERATIONAL_TEXT_TOOLS.has(toolName)) {
    const text = extractTextFromResponse(response)
    return { summary: maskedTruncate(text, isFailure ? 800 : 500, counter) }
  }
  return shapeSummary(response, 0)
}

/**
 * Build the storable envelope for a hook event. Pure function (no I/O) so
 * it can be unit tested directly.
 * @param {object} input - parsed hook input JSON (already validated as an object)
 * @param {string|null} projectRoot
 */
function buildEnvelope(input, projectRoot) {
  const eventName = typeof input.hook_event_name === 'string' ? input.hook_event_name : 'Unknown'
  const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined
  const promptId = typeof input.prompt_id === 'string' ? input.prompt_id : undefined
  const cwd = typeof input.cwd === 'string' ? input.cwd : undefined

  // Accumulates the true number of masking substitutions made while building
  // `data` below (field-level masking already replaces secrets with the mask
  // placeholder, so a later blanket re-scan of the finished object would find
  // nothing left to count — this counter is what keeps the total accurate).
  const counter = { count: 0 }

  let data = {}

  switch (eventName) {
    case 'SessionStart':
      data = { source: typeof input.source === 'string' ? input.source : 'unknown' }
      break
    case 'SessionEnd':
      data = { reason: typeof input.reason === 'string' ? input.reason : 'unknown' }
      break
    case 'UserPromptSubmit': {
      // Field name for the literal prompt text is not fully confirmed against
      // the current official docs excerpt (see docs/event-schema.md); try the
      // documented-style key first and fall back defensively.
      const promptText = input.prompt ?? input.user_prompt ?? input.message ?? ''
      const masked = maskedTruncate(typeof promptText === 'string' ? promptText : '', MAX_FIELD_CHARS, counter)
      data = { prompt: masked }
      break
    }
    case 'InstructionsLoaded': {
      const filePath = input.file_path || input.path
      const loadReason = input.load_reason || input.reason || input.source
      data = {
        path: relativizeMaybe(filePath, projectRoot),
        loadReason: typeof loadReason === 'string' ? loadReason : 'unknown',
      }
      break
    }
    case 'PreToolUse':
      data = {
        toolName: input.tool_name,
        toolUseId: input.tool_use_id,
        input: extractToolInputSummary(input.tool_name, input.tool_input, projectRoot, counter),
      }
      break
    case 'PostToolUse':
      data = {
        toolName: input.tool_name,
        toolUseId: input.tool_use_id,
        status: 'success',
        result: extractToolResultSummary(input.tool_name, input.tool_response, false, counter),
      }
      break
    case 'PostToolUseFailure':
      data = {
        toolName: input.tool_name,
        toolUseId: input.tool_use_id,
        status: 'failure',
        error: extractToolResultSummary(
          input.tool_name,
          input.tool_response ?? input.tool_error ?? input.error,
          true,
          counter
        ),
      }
      break
    case 'SubagentStart':
      data = {
        agentId: input.agent_id,
        agentType: input.agent_type,
        description: typeof input.description === 'string' ? maskedTruncate(input.description, 300, counter) : undefined,
      }
      break
    case 'SubagentStop':
      data = {
        agentId: input.agent_id,
        agentType: input.agent_type,
        lastAssistantMessage: maskedTruncate(input.last_assistant_message, 2000, counter),
      }
      break
    case 'Stop':
      data = {
        lastAssistantMessage: maskedTruncate(input.last_assistant_message, 2000, counter),
      }
      break
    default:
      // Unrecognized event (older/newer Claude Code version, or a manual
      // test invocation): keep only common fields, no event-specific data.
      data = {}
  }

  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    event: eventName,
    sessionId,
    promptId,
    cwd,
    source: 'claude-code-hook',
    data,
    redaction: { applied: true, count: counter.count },
  }

  return envelope
}

function readStdinSafe() {
  try {
    if (process.stdin.isTTY) return '' // nothing piped in
    const raw = fs.readFileSync(0, 'utf8')
    return raw
  } catch (err) {
    debugLog(`could not read stdin: ${err && err.message}`)
    return ''
  }
}

function main() {
  const raw = readStdinSafe()

  if (!raw || raw.trim().length === 0) {
    debugLog('empty stdin; nothing to capture')
    return
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) {
    debugLog(`stdin exceeds ${MAX_STDIN_BYTES} bytes; skipping capture for this event`)
    return
  }

  const parsed = safeJSONParse(raw)
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
    debugLog(`invalid hook input JSON: ${parsed.error || 'not an object'}`)
    return
  }

  const input = parsed.value
  const projectRoot = resolveProjectRoot(input)
  if (!projectRoot) {
    debugLog('could not safely resolve a project root (no CLAUDE_PROJECT_DIR / cwd); skipping capture')
    return
  }

  const paths = logPaths(projectRoot)
  if (!ensureDirSafe(paths.root, projectRoot)) return
  if (!ensureDirSafe(paths.events, projectRoot)) return
  if (!ensureDirSafe(paths.state, projectRoot)) return
  if (!ensureDirSafe(paths.reports, projectRoot)) return

  maybeEnsureGitignore(paths, projectRoot)

  let envelope
  try {
    envelope = buildEnvelope(input, projectRoot)
  } catch (err) {
    debugLog(`failed to build event envelope: ${err && err.message}`)
    return
  }

  // Redact the fully-built data payload as a defense-in-depth pass on top of
  // the field-level masking buildEnvelope already applied (field extraction
  // avoids storing raw content, but this catches anything unexpected such as
  // a secret leaking into a path or tool name). Its count is ADDED to
  // envelope.redaction.count, not used to replace it — by this point the
  // fields buildEnvelope already masked contain the mask placeholder rather
  // than the original secret, so this pass legitimately finds (and should
  // report) zero additional matches for those; overwriting the count here
  // would silently erase the real count from field-level masking.
  const priorCount = envelope.redaction && typeof envelope.redaction.count === 'number' ? envelope.redaction.count : 0
  let extraRedactionCount = 0
  try {
    const beforeJson = JSON.stringify(envelope.data)
    const { text: afterJson, count } = redactText(beforeJson)
    envelope.data = JSON.parse(afterJson)
    extraRedactionCount = count
  } catch (err) {
    debugLog(`redaction pass failed, keeping pre-redaction data structure: ${err && err.message}`)
  }
  envelope.redaction = { applied: true, count: priorCount + extraRedactionCount }

  const targetFile = sessionEventFile(paths.events, envelope.sessionId)
  const appended = appendJSONLSafe(targetFile, envelope)
  if (!appended) return

  try {
    rotateIfNeeded(paths.events, targetFile, { maxFileBytes: MAX_EVENT_FILE_BYTES, maxFiles: MAX_EVENT_FILES })
  } catch (err) {
    debugLog(`log rotation check failed (non-fatal): ${err && err.message}`)
  }
}

function maybeEnsureGitignore(paths, projectRoot) {
  const markerFile = path.join(paths.state, 'gitignore-checked')
  try {
    if (fs.existsSync(markerFile)) return
  } catch {
    // fall through and try anyway
  }
  ensureGitignoreEntry(projectRoot)
  writeJSONSafe(markerFile, { checkedAt: new Date().toISOString() })
}

if (require.main === module) {
  try {
    main()
  } catch (err) {
    // Absolute last resort: never let an uncaught error propagate a
    // non-zero exit code or crash output that could interfere with Claude
    // Code's own turn.
    try {
      debugLog(`unexpected error (ignored): ${err && err.stack ? err.stack : err}`)
    } catch {
      // give up silently
    }
  }
  process.exit(0)
}

module.exports = {
  buildEnvelope,
  extractToolInputSummary,
  extractToolResultSummary,
  shapeSummary,
  relativizeMaybe,
}
