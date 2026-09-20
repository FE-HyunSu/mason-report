'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  readAllEvents,
  listSessions,
  eventsForSession,
  findLastPrompt,
  findLastPrompts,
  listPrompts,
  findPromptBySessionAndTimestamp,
  eventsForTurn,
  buildStatus,
  isMasonReportInvocation,
  isTaskNotification,
} = require('../plugins/mason-report/scripts/read-events')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mason-report-read-test-'))
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

function writeEventsFile(dir, name, lines) {
  const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

test('readAllEvents returns [] when the events directory does not exist', () => {
  const events = readAllEvents('/nonexistent/path/that/should/not/exist')
  assert.deepEqual(events, [])
})

test('readAllEvents skips corrupted JSONL lines and keeps valid ones', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'corrupted-events.jsonl')
  const dir = makeTempDir()
  try {
    fs.copyFileSync(fixturePath, path.join(dir, 'sess-corrupt.jsonl'))
    const events = readAllEvents(dir)
    assert.equal(events.length, 2)
    assert.equal(events[0].event, 'UserPromptSubmit')
    assert.equal(events[1].event, 'Stop')
  } finally {
    cleanup(dir)
  }
})

test('listSessions groups events by sessionId and tracks first/last timestamps', () => {
  const events = [
    { sessionId: 'a', event: 'SessionStart', timestamp: '2026-01-01T00:00:00.000Z' },
    { sessionId: 'a', event: 'Stop', timestamp: '2026-01-01T00:05:00.000Z' },
    { sessionId: 'b', event: 'SessionStart', timestamp: '2026-01-02T00:00:00.000Z' },
  ]
  const sessions = listSessions(events)
  const a = sessions.find((s) => s.sessionId === 'a')
  assert.equal(a.count, 2)
  assert.equal(a.firstTimestamp, '2026-01-01T00:00:00.000Z')
  assert.equal(a.lastTimestamp, '2026-01-01T00:05:00.000Z')
  assert.equal(a.eventTypes.SessionStart, 1)
  assert.equal(a.eventTypes.Stop, 1)
})

test('eventsForSession filters and sorts by timestamp ascending', () => {
  const events = [
    { sessionId: 'a', event: 'Stop', timestamp: '2026-01-01T00:05:00.000Z' },
    { sessionId: 'a', event: 'SessionStart', timestamp: '2026-01-01T00:00:00.000Z' },
    { sessionId: 'b', event: 'SessionStart', timestamp: '2026-01-01T00:00:00.000Z' },
  ]
  const result = eventsForSession(events, 'a')
  assert.equal(result.length, 2)
  assert.equal(result[0].event, 'SessionStart')
  assert.equal(result[1].event, 'Stop')
})

test('findLastPrompt returns the most recent UserPromptSubmit event', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:10:00.000Z', data: { prompt: 'second' } },
  ]
  const last = findLastPrompt(events)
  assert.equal(last.data.prompt, 'second')
})

test('findLastPrompt returns null when there is no UserPromptSubmit event', () => {
  assert.equal(findLastPrompt([{ event: 'SessionStart', timestamp: '2026-01-01T00:00:00.000Z' }]), null)
})

test('findLastPrompts returns the last n prompts, oldest first', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:10:00.000Z', data: { prompt: 'second' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:20:00.000Z', data: { prompt: 'third' } },
  ]
  const last2 = findLastPrompts(events, 2)
  assert.equal(last2.length, 2)
  assert.equal(last2[0].data.prompt, 'second')
  assert.equal(last2[1].data.prompt, 'third')
})

test('findLastPrompts falls back to 1 for an invalid count (zero, negative, non-numeric)', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:10:00.000Z', data: { prompt: 'second' } },
  ]
  for (const badCount of [0, -3, NaN, undefined]) {
    const result = findLastPrompts(events, badCount)
    assert.equal(result.length, 1)
    assert.equal(result[0].data.prompt, 'second')
  }
})

test('isMasonReportInvocation recognizes a /mason-report: slash command as the prompt text', () => {
  assert.equal(isMasonReportInvocation({ data: { prompt: '/mason-report:latest 2' } }), true)
  assert.equal(isMasonReportInvocation({ data: { prompt: '  /mason-report:all' } }), true)
  assert.equal(isMasonReportInvocation({ data: { prompt: 'fix the off-by-one bug in utils.js' } }), false)
  assert.equal(isMasonReportInvocation({ data: {} }), false)
  assert.equal(isMasonReportInvocation({}), false)
})

test('isTaskNotification recognizes a background Agent completion notification as the prompt text', () => {
  assert.equal(isTaskNotification({ data: { prompt: '<task-notification>\n<task-id>abc</task-id>\n</task-notification>' } }), true)
  assert.equal(isTaskNotification({ data: { prompt: '  <task-notification>...' } }), true)
  assert.equal(isTaskNotification({ data: { prompt: 'fix the off-by-one bug in utils.js' } }), false)
  assert.equal(isTaskNotification({ data: {} }), false)
  assert.equal(isTaskNotification({}), false)
})

test('findLastPrompts excludes the plugin\'s own /mason-report: invocations from the turn list', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first real turn' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:10:00.000Z', data: { prompt: 'second real turn' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:20:00.000Z', data: { prompt: '/mason-report:latest 2' } },
  ]
  const last2 = findLastPrompts(events, 2)
  assert.equal(last2.length, 2)
  assert.equal(last2[0].data.prompt, 'first real turn')
  assert.equal(last2[1].data.prompt, 'second real turn')
})

test('findLastPrompts excludes background-Agent <task-notification> deliveries from the turn list', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first real turn' } },
    {
      sessionId: 'a',
      event: 'UserPromptSubmit',
      timestamp: '2026-01-01T00:10:00.000Z',
      data: { prompt: '<task-notification>\n<summary>Agent "x" finished</summary>\n</task-notification>' },
    },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:20:00.000Z', data: { prompt: 'second real turn' } },
  ]
  const last2 = findLastPrompts(events, 2)
  assert.equal(last2.length, 2)
  assert.equal(last2[0].data.prompt, 'first real turn')
  assert.equal(last2[1].data.prompt, 'second real turn')
})

test('findLastPrompts returns fewer than requested when the log has fewer turns', () => {
  const events = [{ sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'only' } }]
  const result = findLastPrompts(events, 5)
  assert.equal(result.length, 1)
  assert.equal(result[0].data.prompt, 'only')
})

test('listPrompts returns prompts newest-first and excludes /mason-report: invocations', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:10:00.000Z', data: { prompt: '/mason-report:select' } },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:20:00.000Z', data: { prompt: 'second' } },
  ]
  const result = listPrompts(events, 20)
  assert.equal(result.length, 2)
  assert.equal(result[0].data.prompt, 'second')
  assert.equal(result[1].data.prompt, 'first')
})

test('listPrompts excludes background-Agent <task-notification> deliveries', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first' } },
    {
      sessionId: 'a',
      event: 'UserPromptSubmit',
      timestamp: '2026-01-01T00:10:00.000Z',
      data: { prompt: '<task-notification>\n<summary>Agent "x" finished</summary>\n</task-notification>' },
    },
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:20:00.000Z', data: { prompt: 'second' } },
  ]
  const result = listPrompts(events, 20)
  assert.equal(result.length, 2)
  assert.equal(result[0].data.prompt, 'second')
  assert.equal(result[1].data.prompt, 'first')
})

test('listPrompts defaults to a pool of 20 and falls back for an invalid count', () => {
  const events = Array.from({ length: 3 }, (_, i) => ({
    sessionId: 'a',
    event: 'UserPromptSubmit',
    timestamp: `2026-01-01T00:0${i}:00.000Z`,
    data: { prompt: `turn ${i}` },
  }))
  for (const badCount of [0, -3, NaN, undefined]) {
    const result = listPrompts(events, badCount)
    assert.equal(result.length, 3)
    assert.equal(result[0].data.prompt, 'turn 2')
  }
})

test('findPromptBySessionAndTimestamp finds the exact turn and returns null otherwise', () => {
  const events = [
    { sessionId: 'a', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'first' } },
    { sessionId: 'b', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z', data: { prompt: 'same timestamp, other session' } },
  ]
  const found = findPromptBySessionAndTimestamp(events, 'a', '2026-01-01T00:00:00.000Z')
  assert.equal(found.data.prompt, 'first')
  assert.equal(findPromptBySessionAndTimestamp(events, 'a', '2026-01-01T00:99:00.000Z'), null)
  assert.equal(findPromptBySessionAndTimestamp(events, 'nonexistent', '2026-01-01T00:00:00.000Z'), null)
})

test('CLI: last-turns [n] reports requestedCount/returnedCount and turns in chronological order', () => {
  const dir = makeTempDir()
  try {
    fs.mkdirSync(path.join(dir, '.mason-report', 'events'), { recursive: true })
    writeEventsFile(dir, path.join('.mason-report', 'events', 'sess-a.jsonl'), [
      { schemaVersion: 1, timestamp: '2026-01-01T00:00:00.000Z', event: 'UserPromptSubmit', sessionId: 'sess-a', promptId: 'p1', data: { prompt: 'first' } },
      { schemaVersion: 1, timestamp: '2026-01-01T00:00:01.000Z', event: 'Stop', sessionId: 'sess-a', promptId: 'p1', data: {} },
      { schemaVersion: 1, timestamp: '2026-01-01T00:01:00.000Z', event: 'UserPromptSubmit', sessionId: 'sess-a', promptId: 'p2', data: { prompt: 'second' } },
      { schemaVersion: 1, timestamp: '2026-01-01T00:01:01.000Z', event: 'Stop', sessionId: 'sess-a', promptId: 'p2', data: {} },
      // The invocation of /mason-report:latest itself must never be counted as a turn.
      { schemaVersion: 1, timestamp: '2026-01-01T00:02:00.000Z', event: 'UserPromptSubmit', sessionId: 'sess-a', promptId: 'p3', data: { prompt: '/mason-report:latest 2' } },
    ])

    const scriptPath = path.join(__dirname, '..', 'plugins', 'mason-report', 'scripts', 'read-events.js')

    // Requesting more turns than exist: falls back to however many are there.
    const result5 = spawnSync(process.execPath, [scriptPath, 'last-turns', '5'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    })
    const parsed5 = JSON.parse(result5.stdout)
    assert.equal(parsed5.requestedCount, 5)
    assert.equal(parsed5.returnedCount, 2)
    assert.equal(parsed5.turns[0].prompt.data.prompt, 'first')
    assert.equal(parsed5.turns[1].prompt.data.prompt, 'second')

    // No argument: defaults to 1, the most recent turn.
    const result1 = spawnSync(process.execPath, [scriptPath, 'last-turns'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    })
    const parsed1 = JSON.parse(result1.stdout)
    assert.equal(parsed1.requestedCount, 1)
    assert.equal(parsed1.returnedCount, 1)
    assert.equal(parsed1.turns[0].prompt.data.prompt, 'second')
  } finally {
    cleanup(dir)
  }
})

test('CLI: list-prompts [n] returns prompts newest-first with totalAvailable, excluding /mason-report: invocations', () => {
  const dir = makeTempDir()
  try {
    fs.mkdirSync(path.join(dir, '.mason-report', 'events'), { recursive: true })
    writeEventsFile(dir, path.join('.mason-report', 'events', 'sess-a.jsonl'), [
      { schemaVersion: 1, timestamp: '2026-01-01T00:00:00.000Z', event: 'UserPromptSubmit', sessionId: 'sess-a', promptId: 'p1', data: { prompt: 'first' } },
      { schemaVersion: 1, timestamp: '2026-01-01T00:01:00.000Z', event: 'UserPromptSubmit', sessionId: 'sess-a', promptId: 'p2', data: { prompt: 'second' } },
      { schemaVersion: 1, timestamp: '2026-01-01T00:02:00.000Z', event: 'UserPromptSubmit', sessionId: 'sess-a', promptId: 'p3', data: { prompt: '/mason-report:select' } },
    ])

    const scriptPath = path.join(__dirname, '..', 'plugins', 'mason-report', 'scripts', 'read-events.js')

    const result = spawnSync(process.execPath, [scriptPath, 'list-prompts', '10'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    })
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.requestedCount, 10)
    assert.equal(parsed.returnedCount, 2)
    assert.equal(parsed.totalAvailable, 2)
    assert.equal(parsed.prompts[0].data.prompt, 'second')
    assert.equal(parsed.prompts[1].data.prompt, 'first')
  } finally {
    cleanup(dir)
  }
})

test('CLI: turn <sessionId> <timestamp> returns the correlated bundle for that exact prompt, or an error if not found', () => {
  const dir = makeTempDir()
  try {
    fs.mkdirSync(path.join(dir, '.mason-report', 'events'), { recursive: true })
    writeEventsFile(dir, path.join('.mason-report', 'events', 'sess-a.jsonl'), [
      { schemaVersion: 1, timestamp: '2026-01-01T00:00:00.000Z', event: 'UserPromptSubmit', sessionId: 'sess-a', promptId: 'p1', data: { prompt: 'first' } },
      { schemaVersion: 1, timestamp: '2026-01-01T00:00:01.000Z', event: 'PreToolUse', sessionId: 'sess-a', promptId: 'p1', data: { toolName: 'Bash' } },
      { schemaVersion: 1, timestamp: '2026-01-01T00:00:02.000Z', event: 'Stop', sessionId: 'sess-a', promptId: 'p1', data: {} },
    ])

    const scriptPath = path.join(__dirname, '..', 'plugins', 'mason-report', 'scripts', 'read-events.js')

    const found = spawnSync(process.execPath, [scriptPath, 'turn', 'sess-a', '2026-01-01T00:00:00.000Z'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    })
    const parsedFound = JSON.parse(found.stdout)
    assert.equal(parsedFound.prompt.data.prompt, 'first')
    assert.equal(parsedFound.promptIdCorrelated.length, 2) // PreToolUse + Stop

    const notFound = spawnSync(process.execPath, [scriptPath, 'turn', 'sess-a', '2026-01-01T09:99:00.000Z'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    })
    const parsedNotFound = JSON.parse(notFound.stdout)
    assert.ok(parsedNotFound.error)
    assert.equal(notFound.status, 1)
  } finally {
    cleanup(dir)
  }
})

test('eventsForTurn correlates by promptId when present, and falls back to time window otherwise', () => {
  const prompt = { sessionId: 'a', promptId: 'p1', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:00:00.000Z' }
  const withPromptId = { sessionId: 'a', promptId: 'p1', event: 'PreToolUse', timestamp: '2026-01-01T00:00:01.000Z' }
  const withoutPromptId = { sessionId: 'a', event: 'PostToolUse', timestamp: '2026-01-01T00:00:02.000Z' }
  const stop = { sessionId: 'a', promptId: 'p1', event: 'Stop', timestamp: '2026-01-01T00:00:03.000Z' }
  const nextTurnPrompt = { sessionId: 'a', promptId: 'p2', event: 'UserPromptSubmit', timestamp: '2026-01-01T00:01:00.000Z' }
  const laterUnrelated = { sessionId: 'a', event: 'PostToolUse', timestamp: '2026-01-01T00:02:00.000Z' }

  const events = [prompt, withPromptId, withoutPromptId, stop, nextTurnPrompt, laterUnrelated]
  const { promptIdCorrelated, timeWindowCorrelated } = eventsForTurn(events, prompt)

  assert.equal(promptIdCorrelated.length, 2) // withPromptId + stop
  assert.ok(promptIdCorrelated.includes(withPromptId))
  assert.ok(promptIdCorrelated.includes(stop))

  assert.equal(timeWindowCorrelated.length, 1)
  assert.ok(timeWindowCorrelated.includes(withoutPromptId))
})

test('buildStatus reports a clear warning when no events have been captured yet', () => {
  const dir = makeTempDir()
  try {
    const status = buildStatus(dir)
    assert.equal(status.eventsDirExists, false)
    assert.equal(status.sessionCount, 0)
    assert.ok(status.warnings.length >= 1)
  } finally {
    cleanup(dir)
  }
})

test('buildStatus aggregates session count, last event, and masking stats', () => {
  const dir = makeTempDir()
  try {
    fs.mkdirSync(path.join(dir, '.mason-report', 'events'), { recursive: true })
    writeEventsFile(dir, path.join('.mason-report', 'events', 'sess-a.jsonl'), [
      {
        schemaVersion: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        event: 'SessionStart',
        sessionId: 'sess-a',
        data: {},
        redaction: { applied: true, count: 0 },
      },
      {
        schemaVersion: 1,
        timestamp: '2026-01-01T00:05:00.000Z',
        event: 'Stop',
        sessionId: 'sess-a',
        data: {},
        redaction: { applied: true, count: 2 },
      },
    ])

    const status = buildStatus(dir)
    assert.equal(status.eventsDirExists, true)
    assert.equal(status.sessionCount, 1)
    assert.equal(status.totalEvents, 2)
    assert.equal(status.lastEventType, 'Stop')
    assert.equal(status.maskingAppliedToEventCount, 2)
    assert.equal(status.maskingTotalSubstitutions, 2)
    assert.ok(status.supportedHookEvents.includes('PreToolUse'))
  } finally {
    cleanup(dir)
  }
})
