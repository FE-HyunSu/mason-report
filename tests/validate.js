#!/usr/bin/env node
'use strict'

/**
 * `npm run validate` entrypoint.
 *
 * Checks, without any external dependency, that the parts of this repo
 * Claude Code actually reads (marketplace manifest, plugin manifest,
 * hooks.json, command frontmatter, skill frontmatter, script syntax) are
 * well-formed, then runs the test suite. Exits non-zero if anything fails.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const PLUGIN_DIR = path.join(ROOT, 'plugins', 'mason-report')

const SUPPORTED_HOOK_EVENTS = new Set([
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
])

const results = []

function check(name, fn) {
  try {
    const message = fn()
    results.push({ name, ok: true, message: message || 'ok' })
  } catch (err) {
    results.push({ name, ok: false, message: err && err.message ? err.message : String(err) })
  }
}

function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw)
}

/** Extract a minimal frontmatter object (only top-level `key: value` string pairs). */
function extractFrontmatter(mdPath) {
  const raw = fs.readFileSync(mdPath, 'utf8')
  if (!raw.startsWith('---')) {
    throw new Error(`${mdPath}: missing frontmatter (must start with ---)`)
  }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) {
    throw new Error(`${mdPath}: frontmatter not terminated with a closing ---`)
  }
  const block = raw.slice(raw.indexOf('\n', 0) + 1, end)
  const fm = {}
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (m) fm[m[1]] = m[2]
  }
  return fm
}

check('marketplace.json is valid', () => {
  const p = path.join(ROOT, '.claude-plugin', 'marketplace.json')
  const data = readJSON(p)
  if (!data.name) throw new Error('missing "name"')
  if (!data.owner || !data.owner.name) throw new Error('missing "owner.name"')
  if (!Array.isArray(data.plugins) || data.plugins.length === 0) throw new Error('missing/empty "plugins" array')
  for (const plugin of data.plugins) {
    if (!plugin.name) throw new Error('a plugin entry is missing "name"')
    if (!plugin.source) throw new Error(`plugin "${plugin.name}" is missing "source"`)
  }
  return `${data.plugins.length} plugin(s) declared`
})

check('plugin.json is valid', () => {
  const p = path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json')
  const data = readJSON(p)
  if (!data.name) throw new Error('missing "name"')
  // Regression guard: `hooks/hooks.json` at the plugin root is auto-discovered by
  // Claude Code. Also declaring it via manifest.hooks makes Claude Code see the
  // same file twice and refuse to load the plugin ("Duplicate hooks file
  // detected") — this broke a real install (see CHANGELOG 0.1.2). So:
  //  - manifest.hooks must be absent, OR
  //  - if present, it must NOT resolve to the default hooks/hooks.json path.
  if (data.hooks) {
    const hooksPath = path.join(PLUGIN_DIR, data.hooks)
    const defaultHooksPath = path.join(PLUGIN_DIR, 'hooks', 'hooks.json')
    if (!fs.existsSync(hooksPath)) throw new Error(`hooks path "${data.hooks}" does not exist`)
    if (path.resolve(hooksPath) === path.resolve(defaultHooksPath)) {
      throw new Error(
        'manifest.hooks points at the default hooks/hooks.json path, which Claude Code already ' +
          'auto-discovers — this causes a "Duplicate hooks file detected" load failure. Remove the ' +
          '"hooks" field from plugin.json instead of declaring it explicitly.'
      )
    }
  }
  const defaultHooksPath = path.join(PLUGIN_DIR, 'hooks', 'hooks.json')
  if (!fs.existsSync(defaultHooksPath)) {
    throw new Error('expected hooks/hooks.json at the plugin root (auto-discovered) but it is missing')
  }
  return `name=${data.name}`
})

check('hooks.json only uses currently-supported hook events, all wired to capture-event.js', () => {
  const p = path.join(PLUGIN_DIR, 'hooks', 'hooks.json')
  const data = readJSON(p)
  if (!data.hooks || typeof data.hooks !== 'object') throw new Error('missing top-level "hooks" object')

  const eventNames = Object.keys(data.hooks)
  if (eventNames.length === 0) throw new Error('no hook events declared')

  for (const eventName of eventNames) {
    if (!SUPPORTED_HOOK_EVENTS.has(eventName)) {
      throw new Error(`event "${eventName}" is not in this plugin's documented-and-supported event list`)
    }
    const matchers = data.hooks[eventName]
    if (!Array.isArray(matchers) || matchers.length === 0) {
      throw new Error(`event "${eventName}" has no matcher entries`)
    }
    for (const matcher of matchers) {
      if (!Array.isArray(matcher.hooks) || matcher.hooks.length === 0) {
        throw new Error(`event "${eventName}" has a matcher entry with no hooks`)
      }
      for (const hook of matcher.hooks) {
        if (hook.type !== 'command') throw new Error(`event "${eventName}" hook has unexpected type "${hook.type}"`)
        if (typeof hook.command !== 'string' || !hook.command.includes('capture-event.js')) {
          throw new Error(`event "${eventName}" hook command does not reference capture-event.js`)
        }
      }
    }
  }
  return `${eventNames.length} event(s): ${eventNames.join(', ')}`
})

check('command files have valid frontmatter with a description', () => {
  const dir = path.join(PLUGIN_DIR, 'commands')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  if (files.length === 0) throw new Error('no command files found')
  for (const file of files) {
    const fm = extractFrontmatter(path.join(dir, file))
    if (!fm.description) throw new Error(`${file}: frontmatter missing "description"`)
  }
  return `${files.length} command file(s): ${files.join(', ')}`
})

check('decision-analysis skill has valid frontmatter with a description', () => {
  const skillPath = path.join(PLUGIN_DIR, 'skills', 'decision-analysis', 'SKILL.md')
  if (!fs.existsSync(skillPath)) throw new Error('SKILL.md not found')
  const fm = extractFrontmatter(skillPath)
  if (!fm.description) throw new Error('frontmatter missing "description"')
  return 'ok'
})

check('all plugin scripts have valid JavaScript syntax', () => {
  const dir = path.join(PLUGIN_DIR, 'scripts')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
  for (const file of files) {
    execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' })
  }
  return `${files.length} script(s) OK`
})

check('test suite passes', () => {
  // No explicit path: Node's test runner then recursively discovers test
  // files from `cwd` (ROOT) itself, which is more robust across Node
  // versions than passing a bare "tests/" directory — that form failed
  // outright ("Cannot find module '.../tests'") under Node v24.11.1 during
  // real testing, even though it worked fine on the Node version used
  // earlier in this project's development.
  const result = spawnSync(process.execPath, ['--test'], { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`node --test exited with code ${result.status}\n${result.stdout}\n${result.stderr}`)
  }
  return 'all tests passed'
})

let failed = false
for (const r of results) {
  const icon = r.ok ? 'PASS' : 'FAIL'
  console.log(`[${icon}] ${r.name} — ${r.message}`)
  if (!r.ok) failed = true
}

process.exit(failed ? 1 : 0)
