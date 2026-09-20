#!/usr/bin/env node
'use strict'

/**
 * Read-only query helper over the .mason-report/events JSONL logs. Invoked
 * directly (not as a hook) by the plugin's slash commands via Bash, e.g.:
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" status
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" sessions
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" session <sessionId>
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" last-turns [n]
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" list-prompts [n]
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" turn <sessionId> <timestamp>
 *
 * Unlike capture-event.js, this script is allowed to print to stdout (it is
 * not a hook, so there is no risk of its output being silently injected
 * into Claude's context) and prints results as JSON for the calling command
 * to read and reason over.
 */

const fs = require('fs')
const path = require('path')

const { debugLog, safeJSONParse, logPaths } = require('./utils')

const SUPPORTED_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'InstructionsLoaded',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
]

function resolveProjectRootForQuery() {
  const candidate = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  try {
    const resolved = path.resolve(candidate)
    if (fs.statSync(resolved).isDirectory()) return resolved
  } catch {
    // fall through
  }
  return null
}

/** Read and parse every *.jsonl file in the events directory, skipping any corrupted lines. */
function readAllEvents(eventsDir) {
  let entries
  try {
    entries = fs.readdirSync(eventsDir)
  } catch {
    return []
  }

  const events = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const full = path.join(eventsDir, name)
    let content
    try {
      content = fs.readFileSync(full, 'utf8')
    } catch (err) {
      debugLog(`could not read ${name}: ${err && err.message}`)
      continue
    }
    const lines = content.split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      const parsed = safeJSONParse(line)
      if (!parsed.ok) {
        debugLog(`skipping corrupted JSONL line in ${name}`)
        continue
      }
      events.push(parsed.value)
    }
  }
  return events
}

function byTimestampAsc(a, b) {
  const ta = typeof a.timestamp === 'string' ? a.timestamp : ''
  const tb = typeof b.timestamp === 'string' ? b.timestamp : ''
  return ta < tb ? -1 : ta > tb ? 1 : 0
}

// A UserPromptSubmit whose prompt text is itself an invocation of one of this
// plugin's own slash commands (e.g. "/mason-report:latest 2") is a request to
// *produce* a report, not a turn to report on — it should never show up as
// one of the "last N turns" being analyzed.
const MASON_REPORT_INVOCATION_PATTERN = /^\s*\/mason-report:/i

function isMasonReportInvocation(promptEvent) {
  const text = promptEvent && promptEvent.data && typeof promptEvent.data.prompt === 'string' ? promptEvent.data.prompt : ''
  return MASON_REPORT_INVOCATION_PATTERN.test(text)
}

// Claude Code delivers a background Agent's completion as a synthetic
// <task-notification>...</task-notification> block, routed through the same
// UserPromptSubmit hook as text a human actually typed. It is not a turn to
// analyze or a candidate the user should be asked to pick from — filter it
// out the same way self-invocations are filtered out above.
const TASK_NOTIFICATION_PATTERN = /^\s*<task-notification>/i

function isTaskNotification(promptEvent) {
  const text = promptEvent && promptEvent.data && typeof promptEvent.data.prompt === 'string' ? promptEvent.data.prompt : ''
  return TASK_NOTIFICATION_PATTERN.test(text)
}

function listSessions(events) {
  const bySession = new Map()
  for (const ev of events) {
    const id = ev.sessionId || 'unknown-session'
    if (!bySession.has(id)) {
      bySession.set(id, { sessionId: id, count: 0, firstTimestamp: null, lastTimestamp: null, eventTypes: {} })
    }
    const entry = bySession.get(id)
    entry.count += 1
    entry.eventTypes[ev.event] = (entry.eventTypes[ev.event] || 0) + 1
    if (typeof ev.timestamp === 'string') {
      if (!entry.firstTimestamp || ev.timestamp < entry.firstTimestamp) entry.firstTimestamp = ev.timestamp
      if (!entry.lastTimestamp || ev.timestamp > entry.lastTimestamp) entry.lastTimestamp = ev.timestamp
    }
  }
  return Array.from(bySession.values()).sort((a, b) => (a.lastTimestamp < b.lastTimestamp ? 1 : -1))
}

function eventsForSession(events, sessionId) {
  return events.filter((ev) => (ev.sessionId || 'unknown-session') === sessionId).sort(byTimestampAsc)
}

/**
 * The last `n` observed UserPromptSubmit events across all sessions, oldest
 * first (so the most recent is always last in the returned array). `n` is
 * coerced to a positive integer, defaulting to 1 for anything invalid
 * (missing, zero, negative, non-numeric) — a bad count should degrade to
 * "just the most recent turn" rather than error out.
 */
function findLastPrompts(events, n) {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
  const prompts = events
    .filter((ev) => ev.event === 'UserPromptSubmit')
    .filter((ev) => !isMasonReportInvocation(ev))
    .filter((ev) => !isTaskNotification(ev))
    .sort(byTimestampAsc)
  return prompts.slice(-count)
}

/** Most recently observed UserPromptSubmit event across all sessions. */
function findLastPrompt(events) {
  const prompts = findLastPrompts(events, 1)
  return prompts.length ? prompts[0] : null
}

/**
 * Newest-first list of observed UserPromptSubmit events across all sessions,
 * for turn *browsing* (e.g. `/mason-report:select` letting the user pick one
 * to analyze) — as opposed to `findLastPrompts`, which returns turns already
 * chosen for direct analysis, oldest-first. Excludes this plugin's own
 * `/mason-report:*` invocations, same as `findLastPrompts`. `n` defaults to 20
 * and is coerced to a positive integer, same fallback rule as elsewhere.
 */
function listPrompts(events, n) {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 20
  const prompts = events
    .filter((ev) => ev.event === 'UserPromptSubmit')
    .filter((ev) => !isMasonReportInvocation(ev))
    .filter((ev) => !isTaskNotification(ev))
    .sort(byTimestampAsc)
  return prompts.slice(-count).reverse()
}

/**
 * Find the exact UserPromptSubmit event identified by (sessionId, timestamp)
 * — the pair a caller gets back from `listPrompts`/`list-prompts` and uses to
 * request the full turn for one specifically chosen prompt.
 */
function findPromptBySessionAndTimestamp(events, sessionId, timestamp) {
  return (
    events.find(
      (ev) => ev.event === 'UserPromptSubmit' && (ev.sessionId || 'unknown-session') === sessionId && ev.timestamp === timestamp
    ) || null
  )
}

/**
 * Build the bundle of events belonging to the same turn as `promptEvent`.
 *
 * Primary correlation is by matching `promptId` (an observed fact when
 * present). When an event lacks a promptId (older Claude Code versions may
 * omit it on some events), it is included only if its timestamp falls
 * between this prompt and the next UserPromptSubmit/Stop in the same
 * session — a weaker, inferred correlation, and callers should treat that
 * distinction as part of the observed-vs-inferred boundary.
 */
function eventsForTurn(events, promptEvent) {
  if (!promptEvent) return { promptIdCorrelated: [], timeWindowCorrelated: [] }

  const sessionEvents = eventsForSession(events, promptEvent.sessionId || 'unknown-session')
  const startTs = promptEvent.timestamp
  const startIdx = sessionEvents.findIndex((ev) => ev === promptEvent || (ev.timestamp === startTs && ev.event === 'UserPromptSubmit'))

  let endTs = null
  for (let i = (startIdx === -1 ? 0 : startIdx + 1); i < sessionEvents.length; i++) {
    const ev = sessionEvents[i]
    if (ev.event === 'Stop') {
      endTs = ev.timestamp
      break
    }
    if (ev.event === 'UserPromptSubmit') {
      endTs = ev.timestamp
      break
    }
  }

  const promptIdCorrelated = []
  const timeWindowCorrelated = []

  for (const ev of sessionEvents) {
    if (ev === promptEvent) continue
    const hasPromptId = typeof ev.promptId === 'string' && ev.promptId.length > 0
    if (hasPromptId && promptEvent.promptId && ev.promptId === promptEvent.promptId) {
      promptIdCorrelated.push(ev)
      continue
    }
    if (!hasPromptId) {
      const ts = ev.timestamp
      if (typeof ts === 'string' && ts >= startTs && (endTs === null || ts <= endTs)) {
        timeWindowCorrelated.push(ev)
      }
    }
  }

  return { promptIdCorrelated, timeWindowCorrelated }
}

/**
 * Token usage for a completed turn, computed from Claude Code's own session
 * transcript (never from Hook events, which carry no usage data at all).
 *
 * Deliberately restricted to turns that have already completed (a `Stop`
 * event observed) because the transcript file is written asynchronously —
 * reading it for a turn still in progress risks an undercount from lines not
 * yet flushed to disk (see docs/limitations.md). For an already-completed
 * turn this risk does not apply: by the time a report command runs, the
 * transcript has long since caught up.
 */
function emptyUsageBucket() {
  return { messageCount: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
}

function addUsageToBucket(bucket, usage) {
  bucket.messageCount += 1
  bucket.inputTokens += Number(usage.input_tokens) || 0
  bucket.outputTokens += Number(usage.output_tokens) || 0
  bucket.cacheCreationInputTokens += Number(usage.cache_creation_input_tokens) || 0
  bucket.cacheReadInputTokens += Number(usage.cache_read_input_tokens) || 0
}

/** First observed `transcriptPath` among the turn's own events (older logs captured before this field existed will have none). */
function findTranscriptPath(promptEvent, promptIdCorrelated, timeWindowCorrelated) {
  const candidates = [promptEvent, ...promptIdCorrelated, ...timeWindowCorrelated]
  for (const ev of candidates) {
    if (ev && typeof ev.transcriptPath === 'string' && ev.transcriptPath) return ev.transcriptPath
  }
  return null
}

/** The turn's own `Stop` event timestamp, i.e. observed proof the turn actually finished. */
function findTurnEndTimestamp(promptIdCorrelated, timeWindowCorrelated) {
  const stopEvent = [...promptIdCorrelated, ...timeWindowCorrelated].find((ev) => ev.event === 'Stop')
  return stopEvent ? stopEvent.timestamp : null
}

/**
 * Sums the Claude API `usage` block (input/output/cache tokens) off every
 * assistant transcript line whose timestamp falls inside [promptEvent.timestamp,
 * turnEndTimestamp]. Main-chain and Subagent (`isSidechain: true`) messages are
 * summed into separate buckets — a Subagent's tokens are real API calls too,
 * but attributing them to "this turn" vs. "a sub-task" is a scoping choice a
 * report should make explicit, not silently merge.
 *
 * Returns `{ available: false, reason }` — never a guessed number — when any
 * precondition for a trustworthy read is not met.
 */
function computeTokenUsageForTurn(promptEvent, promptIdCorrelated, timeWindowCorrelated) {
  if (!promptEvent) return { available: false, reason: 'no_prompt_event' }

  const transcriptPath = findTranscriptPath(promptEvent, promptIdCorrelated, timeWindowCorrelated)
  if (!transcriptPath) return { available: false, reason: 'transcript_path_not_captured' }

  const endTimestamp = findTurnEndTimestamp(promptIdCorrelated, timeWindowCorrelated)
  if (!endTimestamp) return { available: false, reason: 'turn_not_completed' }

  let content
  try {
    content = fs.readFileSync(transcriptPath, 'utf8')
  } catch (err) {
    debugLog(`could not read transcript at ${transcriptPath}: ${err && err.message}`)
    return { available: false, reason: 'transcript_unreadable' }
  }

  const startTimestamp = promptEvent.timestamp
  const main = emptyUsageBucket()
  const subagent = emptyUsageBucket()

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parsed = safeJSONParse(line)
    if (!parsed.ok) continue
    const entry = parsed.value
    if (!entry || entry.type !== 'assistant') continue
    const ts = entry.timestamp
    if (typeof ts !== 'string' || ts < startTimestamp || ts > endTimestamp) continue
    const usage = entry.message && entry.message.usage
    if (!usage || typeof usage !== 'object') continue
    if (entry.isSidechain) addUsageToBucket(subagent, usage)
    else addUsageToBucket(main, usage)
  }

  return { available: true, transcriptPath, startTimestamp, endTimestamp, main, subagent }
}

function dirSizeBytes(dir) {
  let total = 0
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of entries) {
    try {
      total += fs.statSync(path.join(dir, name)).size
    } catch {
      // ignore
    }
  }
  return total
}

function buildStatus(projectRoot) {
  const paths = logPaths(projectRoot)
  const eventsDirExists = fs.existsSync(paths.events)
  const events = eventsDirExists ? readAllEvents(paths.events) : []
  const sessions = listSessions(events)
  const sorted = [...events].sort(byTimestampAsc)
  const last = sorted.length ? sorted[sorted.length - 1] : null

  let redactionEventsCount = 0
  let redactionTotalMasks = 0
  for (const ev of events) {
    if (ev.redaction && ev.redaction.applied) {
      redactionEventsCount += 1
      redactionTotalMasks += typeof ev.redaction.count === 'number' ? ev.redaction.count : 0
    }
  }

  return {
    logRoot: paths.root,
    eventsDirExists,
    supportedHookEvents: SUPPORTED_HOOK_EVENTS,
    sessionCount: sessions.length,
    totalEvents: events.length,
    lastEventTimestamp: last ? last.timestamp : null,
    lastEventType: last ? last.event : null,
    maskingAppliedToEventCount: redactionEventsCount,
    maskingTotalSubstitutions: redactionTotalMasks,
    eventsDirSizeBytes: dirSizeBytes(paths.events),
    warnings: eventsDirExists ? [] : ['no events captured yet in this project (hooks may not have fired, or this is a new project)'],
  }
}

function printJSON(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

function main() {
  const [, , subcommand, arg, arg2] = process.argv
  const projectRoot = resolveProjectRootForQuery()

  if (!projectRoot) {
    printJSON({ error: 'could not resolve project root' })
    process.exitCode = 1
    return
  }

  const paths = logPaths(projectRoot)

  switch (subcommand) {
    case 'status':
      printJSON(buildStatus(projectRoot))
      return
    case 'sessions': {
      const events = readAllEvents(paths.events)
      printJSON(listSessions(events))
      return
    }
    case 'session': {
      if (!arg) {
        printJSON({ error: 'usage: read-events.js session <sessionId>' })
        process.exitCode = 1
        return
      }
      const events = readAllEvents(paths.events)
      printJSON(eventsForSession(events, arg))
      return
    }
    case 'last-turns': {
      // arg is the requested turn count as a string; anything that doesn't
      // parse to a positive integer falls back to 1 inside findLastPrompts.
      const requestedCount = arg ? parseInt(arg, 10) : 1
      const events = readAllEvents(paths.events)
      const prompts = findLastPrompts(events, requestedCount)
      const turns = prompts.map((promptEvent) => {
        const { promptIdCorrelated, timeWindowCorrelated } = eventsForTurn(events, promptEvent)
        const tokenUsage = computeTokenUsageForTurn(promptEvent, promptIdCorrelated, timeWindowCorrelated)
        return { prompt: promptEvent, promptIdCorrelated, timeWindowCorrelated, tokenUsage }
      })
      printJSON({ requestedCount: Number.isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : 1, returnedCount: turns.length, turns })
      return
    }
    case 'list-prompts': {
      // arg is the requested pool size as a string; anything that doesn't
      // parse to a positive integer falls back to 20 inside listPrompts.
      const requestedCount = arg ? parseInt(arg, 10) : 20
      const events = readAllEvents(paths.events)
      const totalAvailable = events.filter(
        (ev) => ev.event === 'UserPromptSubmit' && !isMasonReportInvocation(ev) && !isTaskNotification(ev)
      ).length
      const prompts = listPrompts(events, requestedCount)
      printJSON({
        requestedCount: Number.isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : 20,
        returnedCount: prompts.length,
        totalAvailable,
        prompts,
      })
      return
    }
    case 'turn': {
      if (!arg || !arg2) {
        printJSON({ error: 'usage: read-events.js turn <sessionId> <timestamp>' })
        process.exitCode = 1
        return
      }
      const events = readAllEvents(paths.events)
      const promptEvent = findPromptBySessionAndTimestamp(events, arg, arg2)
      if (!promptEvent) {
        printJSON({ error: 'no UserPromptSubmit event found for that sessionId/timestamp pair' })
        process.exitCode = 1
        return
      }
      const { promptIdCorrelated, timeWindowCorrelated } = eventsForTurn(events, promptEvent)
      const tokenUsage = computeTokenUsageForTurn(promptEvent, promptIdCorrelated, timeWindowCorrelated)
      printJSON({ prompt: promptEvent, promptIdCorrelated, timeWindowCorrelated, tokenUsage })
      return
    }
    default:
      printJSON({
        error: `unknown subcommand: ${subcommand || '(none)'}`,
        usage: ['status', 'sessions', 'session <sessionId>', 'last-turns [n]', 'list-prompts [n]', 'turn <sessionId> <timestamp>'],
      })
      process.exitCode = 1
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  readAllEvents,
  listSessions,
  eventsForSession,
  findLastPrompt,
  findLastPrompts,
  listPrompts,
  findPromptBySessionAndTimestamp,
  eventsForTurn,
  computeTokenUsageForTurn,
  buildStatus,
  isMasonReportInvocation,
  isTaskNotification,
  SUPPORTED_HOOK_EVENTS,
}
