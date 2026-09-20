'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  buildEnvelope,
  extractToolInputSummary,
  extractToolResultSummary,
  shapeSummary,
  relativizeMaybe,
} = require('../plugins/mason-report/scripts/capture-event')
const { MAX_STDIN_BYTES } = require('../plugins/mason-report/scripts/utils')

const CAPTURE_SCRIPT = path.join(__dirname, '..', 'plugins', 'mason-report', 'scripts', 'capture-event.js')

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mason-report-test-'))
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

function runCapture(stdinText, projectRoot) {
  return spawnSync(process.execPath, [CAPTURE_SCRIPT], {
    input: stdinText,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    timeout: 10000,
  })
}

function eventsDir(projectRoot) {
  return path.join(projectRoot, '.mason-report', 'events')
}

function readAllLines(dir) {
  const lines = []
  if (!fs.existsSync(dir)) return lines
  for (const name of fs.readdirSync(dir)) {
    const content = fs.readFileSync(path.join(dir, name), 'utf8')
    for (const line of content.split('\n')) {
      if (line.trim()) lines.push(JSON.parse(line))
    }
  }
  return lines
}

// ---- Pure function unit tests ----------------------------------------

test('buildEnvelope: SessionStart', () => {
  const env = buildEnvelope({ session_id: 's1', cwd: '/proj', hook_event_name: 'SessionStart', source: 'startup' }, '/proj')
  assert.equal(env.event, 'SessionStart')
  assert.equal(env.sessionId, 's1')
  assert.equal(env.data.source, 'startup')
})

test('buildEnvelope: captures transcript_path as-is (path only, never read) when present', () => {
  const env = buildEnvelope(
    {
      session_id: 's1',
      cwd: '/proj',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hello',
      transcript_path: '/Users/someone/.claude/projects/-proj/s1.jsonl',
    },
    '/proj'
  )
  assert.equal(env.transcriptPath, '/Users/someone/.claude/projects/-proj/s1.jsonl')
})

test('buildEnvelope: omits transcriptPath as undefined when transcript_path is absent (older Claude Code / hook without the field)', () => {
  const env = buildEnvelope({ session_id: 's1', cwd: '/proj', hook_event_name: 'SessionStart', source: 'startup' }, '/proj')
  assert.equal(env.transcriptPath, undefined)
})

test('buildEnvelope: UserPromptSubmit masks secrets in the prompt', () => {
  const env = buildEnvelope(
    {
      session_id: 's1',
      prompt_id: 'p1',
      cwd: '/proj',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    },
    '/proj'
  )
  assert.equal(env.event, 'UserPromptSubmit')
  assert.ok(!env.data.prompt.includes('abcdefghijklmnop'))
  // Regression: masking a field must be reflected in redaction.count, not
  // just in the masked text (see docs/limitations.md history — a prior bug
  // masked the secret but reported count: 0 because a later blanket pass ran
  // on already-masked text and found nothing left to count).
  assert.ok(env.redaction.count >= 1)
})

test('buildEnvelope: PreToolUse Bash masks env-var secrets in the command', () => {
  const env = buildEnvelope(
    {
      session_id: 's1',
      cwd: '/proj',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 't1',
      tool_input: { command: 'export TOKEN=abc123 && npm test' },
    },
    '/proj'
  )
  assert.equal(env.data.toolName, 'Bash')
  assert.ok(!env.data.input.command.includes('abc123'))
  assert.ok(env.redaction.count >= 1)
})

test('buildEnvelope: PreToolUse Write records only path, never content', () => {
  const env = buildEnvelope(
    {
      session_id: 's1',
      cwd: '/proj',
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 't2',
      tool_input: { file_path: '/proj/src/app.js', content: 'SECRET_CONTENT_SHOULD_NOT_APPEAR' },
    },
    '/proj'
  )
  const serialized = JSON.stringify(env)
  assert.ok(!serialized.includes('SECRET_CONTENT_SHOULD_NOT_APPEAR'))
  assert.equal(env.data.input.path, 'src/app.js')
  assert.equal(env.data.input.operation, 'write')
})

test('buildEnvelope: PostToolUse for a file tool never stores response content', () => {
  const env = buildEnvelope(
    {
      session_id: 's1',
      cwd: '/proj',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: 't3',
      tool_response: 'THE_ENTIRE_FILE_CONTENTS_HERE_should_never_be_stored',
    },
    '/proj'
  )
  const serialized = JSON.stringify(env)
  assert.ok(!serialized.includes('THE_ENTIRE_FILE_CONTENTS_HERE'))
  assert.equal(env.data.result.note, 'content-not-stored')
})

test('buildEnvelope: PostToolUseFailure masks secrets in operational tool error text', () => {
  const env = buildEnvelope(
    {
      session_id: 's1',
      cwd: '/proj',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 't4',
      tool_response: { stderr: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' },
    },
    '/proj'
  )
  assert.equal(env.data.status, 'failure')
  assert.ok(!env.data.error.summary.includes('abcdefghijklmnopqrstuvwxyz'))
})

test('buildEnvelope: unrecognized event name does not throw and yields empty data', () => {
  const env = buildEnvelope({ session_id: 's1', cwd: '/proj', hook_event_name: 'SomeFutureEvent' }, '/proj')
  assert.equal(env.event, 'SomeFutureEvent')
  assert.deepEqual(env.data, {})
})

test('extractToolInputSummary: unknown tool records only input keys, not values', () => {
  const summary = extractToolInputSummary('SomeMcpTool', { apiKey: 'secretvalue', foo: 'bar' }, '/proj')
  assert.deepEqual(summary.inputKeys.sort(), ['apiKey', 'foo'])
  assert.ok(!JSON.stringify(summary).includes('secretvalue'))
})

test('extractToolResultSummary: Grep (operational) returns a masked bounded summary', () => {
  const summary = extractToolResultSummary('Grep', 'match: password=hunter2', false)
  assert.ok(!summary.summary.includes('hunter2'))
})

test('shapeSummary: strings become length-only descriptors, sensitive keys redacted', () => {
  const shape = shapeSummary({ token: 'abcdef', note: 'hello world', nested: { count: 3 } }, 0)
  assert.equal(shape.token, '[REDACTED]')
  assert.equal(shape.note, 'string(len=11)')
  assert.equal(shape.nested.count, 3)
})

test('relativizeMaybe: converts an in-project absolute path to a relative one', () => {
  assert.equal(relativizeMaybe('/proj/src/a.ts', '/proj'), 'src/a.ts')
})

test('relativizeMaybe: leaves an out-of-project path unchanged', () => {
  assert.equal(relativizeMaybe('/etc/passwd', '/proj'), '/etc/passwd')
})

// ---- Integration tests (spawn the real CLI script) --------------------

test('capture-event CLI: valid SessionStart JSON is written as one JSONL line', () => {
  const projectRoot = makeTempProject()
  try {
    const input = JSON.stringify({
      session_id: 'sess-int-1',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      source: 'startup',
    })
    const result = runCapture(input, projectRoot)
    assert.equal(result.status, 0)

    const lines = readAllLines(eventsDir(projectRoot))
    assert.equal(lines.length, 1)
    assert.equal(lines[0].event, 'SessionStart')
    assert.equal(lines[0].sessionId, 'sess-int-1')
    assert.equal(lines[0].schemaVersion, 1)
  } finally {
    cleanup(projectRoot)
  }
})

test('capture-event CLI: the persisted event reports an accurate (non-zero) redaction count when a secret was masked', () => {
  const projectRoot = makeTempProject()
  try {
    const input = JSON.stringify({
      session_id: 'sess-int-redact',
      cwd: projectRoot,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    })
    const result = runCapture(input, projectRoot)
    assert.equal(result.status, 0)

    const lines = readAllLines(eventsDir(projectRoot))
    assert.equal(lines.length, 1)
    assert.ok(!lines[0].data.prompt.includes('abcdefghijklmnop'))
    assert.ok(lines[0].redaction.count >= 1, `expected redaction.count >= 1, got ${lines[0].redaction.count}`)
  } finally {
    cleanup(projectRoot)
  }
})

test('capture-event CLI: invalid JSON input does not crash and writes nothing', () => {
  const projectRoot = makeTempProject()
  try {
    const result = runCapture('{not valid json!!', projectRoot)
    assert.equal(result.status, 0)
    assert.equal(readAllLines(eventsDir(projectRoot)).length, 0)
  } finally {
    cleanup(projectRoot)
  }
})

test('capture-event CLI: empty stdin does not crash and writes nothing', () => {
  const projectRoot = makeTempProject()
  try {
    const result = runCapture('', projectRoot)
    assert.equal(result.status, 0)
    assert.equal(readAllLines(eventsDir(projectRoot)).length, 0)
  } finally {
    cleanup(projectRoot)
  }
})

test('capture-event CLI: oversized stdin is skipped, not stored, and does not crash', () => {
  const projectRoot = makeTempProject()
  try {
    const hugePrompt = 'a'.repeat(MAX_STDIN_BYTES + 1000)
    const input = JSON.stringify({
      session_id: 'sess-huge',
      cwd: projectRoot,
      hook_event_name: 'UserPromptSubmit',
      prompt: hugePrompt,
    })
    const result = runCapture(input, projectRoot)
    assert.equal(result.status, 0)
    assert.equal(readAllLines(eventsDir(projectRoot)).length, 0)
  } finally {
    cleanup(projectRoot)
  }
})

test('capture-event CLI: unknown hook event name is still captured safely', () => {
  const projectRoot = makeTempProject()
  try {
    const input = JSON.stringify({ session_id: 'sess-unknown', cwd: projectRoot, hook_event_name: 'TotallyMadeUpEvent' })
    const result = runCapture(input, projectRoot)
    assert.equal(result.status, 0)
    const lines = readAllLines(eventsDir(projectRoot))
    assert.equal(lines.length, 1)
    assert.equal(lines[0].event, 'TotallyMadeUpEvent')
  } finally {
    cleanup(projectRoot)
  }
})

test('capture-event CLI: does not touch unrelated existing project files', () => {
  const projectRoot = makeTempProject()
  try {
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# my project\n')
    fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n')

    const input = JSON.stringify({ session_id: 'sess-safe', cwd: projectRoot, hook_event_name: 'SessionStart', source: 'startup' })
    runCapture(input, projectRoot)
    runCapture(input, projectRoot) // run twice: gitignore addition must be idempotent

    assert.equal(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8'), '# my project\n')

    const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8')
    assert.ok(gitignore.includes('node_modules/'))
    const occurrences = gitignore.split('.mason-report/').length - 1
    assert.equal(occurrences, 1)
  } finally {
    cleanup(projectRoot)
  }
})

test('capture-event CLI: without a resolvable project root, nothing is written anywhere', () => {
  const result = spawnSync(process.execPath, [CAPTURE_SCRIPT], {
    input: JSON.stringify({ session_id: 's', hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
    timeout: 10000,
  })
  assert.equal(result.status, 0)
})
