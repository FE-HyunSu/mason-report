'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { redactText, redactDeep, isDotEnvPath, isSensitiveKey } = require('../plugins/mason-report/scripts/redact')

test('masks an Anthropic API key', () => {
  const { text, count } = redactText('key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')
  assert.equal(count, 1)
  assert.ok(!text.includes('abcdefghijklmnop'))
  assert.ok(text.includes('[REDACTED]'))
})

test('masks an OpenAI-style API key', () => {
  const { text, count } = redactText('OPENAI_API_KEY is sk-abcdefghijklmnopqrstuvwxyz0123456789')
  assert.ok(count >= 1)
  assert.ok(!text.includes('sk-abcdefghijklmnopqrstuvwxyz0123456789'))
})

test('masks a GitHub token', () => {
  const { text, count } = redactText('token: ghp_1234567890abcdefghijklmnopqrstuvwx')
  assert.equal(count, 1)
  assert.ok(!text.includes('1234567890abcdefghijklmnopqrstuvwx'))
})

test('masks an Authorization header', () => {
  const { text, count } = redactText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')
  assert.ok(count >= 1)
  assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz'))
  assert.ok(text.startsWith('Authorization: '))
})

test('masks a bare Bearer token', () => {
  const { text } = redactText('curl -H "X: Bearer sometoken.value-123"')
  assert.ok(!text.includes('sometoken.value-123'))
})

test('masks a Cookie header', () => {
  const { text, count } = redactText('Cookie: session=abc123; other=xyz')
  assert.equal(count, 1)
  assert.ok(!text.includes('session=abc123'))
})

test('masks PEM private key blocks', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----'
  const { text, count } = redactText(`config:\n${pem}\nend`)
  assert.equal(count, 1)
  assert.ok(!text.includes('MIIBOgIBAAJBAK'))
})

test('masks AWS access key id', () => {
  const { text, count } = redactText('AKIAABCDEFGHIJKLMNOP is my key id')
  assert.equal(count, 1)
  assert.ok(!text.includes('AKIAABCDEFGHIJKLMNOP'))
})

test('masks a JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_abc123XYZ'
  const { text, count } = redactText(`auth=${jwt}`)
  assert.equal(count, 1)
  assert.ok(!text.includes(jwt))
})

test('masks Bash-style env var assignment for secrets', () => {
  const { text, count } = redactText('export DB_PASSWORD=hunter2 && node app.js')
  assert.ok(count >= 1)
  assert.ok(!text.includes('hunter2'))
  assert.ok(text.includes('DB_PASSWORD='))
})

test('masks JSON-shaped secret fields', () => {
  const { text, count } = redactText('{"password": "hunter2", "note": "hello"}')
  assert.ok(count >= 1)
  assert.ok(!text.includes('hunter2'))
  assert.ok(text.includes('"note": "hello"'))
})

test('does not mask ordinary text', () => {
  const { text, count } = redactText('run npm install and then npm test')
  assert.equal(count, 0)
  assert.equal(text, 'run npm install and then npm test')
})

test('redactText handles non-string / empty input without throwing', () => {
  assert.deepEqual(redactText(''), { text: '', count: 0 })
  assert.deepEqual(redactText(null), { text: '', count: 0 })
  assert.deepEqual(redactText(undefined), { text: '', count: 0 })
})

test('redactDeep masks values whose key name looks sensitive, regardless of value shape', () => {
  const { value, count } = redactDeep({ token: 'plainlookingvalue', nested: { apiKey: 'anothervalue' }, safe: 'ok' })
  assert.equal(value.token, '[REDACTED]')
  assert.equal(value.nested.apiKey, '[REDACTED]')
  assert.equal(value.safe, 'ok')
  assert.ok(count >= 2)
})

test('redactDeep recurses through arrays', () => {
  const { value } = redactDeep({ items: ['sk-ant-abcdefghijklmnopqrstuvwxyz012345', 'plain text'] })
  assert.ok(!value.items[0].includes('abcdefghijklmnop'))
  assert.equal(value.items[1], 'plain text')
})

test('isDotEnvPath recognizes .env and its variants', () => {
  assert.equal(isDotEnvPath('.env'), true)
  assert.equal(isDotEnvPath('.env.local'), true)
  assert.equal(isDotEnvPath('/repo/project/.env'), true)
  assert.equal(isDotEnvPath('C:\\repo\\project\\.env'), true)
  assert.equal(isDotEnvPath('environment.js'), false)
  assert.equal(isDotEnvPath(''), false)
  assert.equal(isDotEnvPath(undefined), false)
})

test('isSensitiveKey flags common secret-ish key names', () => {
  assert.equal(isSensitiveKey('password'), true)
  assert.equal(isSensitiveKey('API_KEY'), true)
  assert.equal(isSensitiveKey('authToken'), true)
  assert.equal(isSensitiveKey('path'), false)
  assert.equal(isSensitiveKey('description'), false)
})
