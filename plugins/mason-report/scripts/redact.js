'use strict'

/**
 * Sensitive-data masking for mason-report.
 *
 * Design constraint: this module must never throw. Any regex or logic
 * failure must fall back to returning the original text unmasked-but-safe
 * (never crash the caller, since a hook failure must not block Claude Code).
 */

const MASK = '[REDACTED]'

// Ordered list of {name, regex, replace}. Regexes run sequentially; once a
// span is replaced with MASK it will not match a later pattern (MASK itself
// does not look like a secret), so double-counting across overlapping
// patterns is not a practical concern here.
const RULES = [
  {
    name: 'pem-private-key',
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => MASK,
  },
  {
    name: 'anthropic-api-key',
    regex: /\bsk-ant-[A-Za-z0-9\-_]{10,}/g,
    replace: () => MASK,
  },
  {
    name: 'openai-api-key',
    regex: /\bsk-(?!ant-)[A-Za-z0-9]{20,}/g,
    replace: () => MASK,
  },
  {
    name: 'github-token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    replace: () => MASK,
  },
  {
    name: 'slack-token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    replace: () => MASK,
  },
  {
    name: 'google-api-key',
    regex: /\bAIza[0-9A-Za-z\-_]{30,}/g,
    replace: () => MASK,
  },
  {
    name: 'google-oauth-token',
    regex: /\bya29\.[A-Za-z0-9_-]{10,}/g,
    replace: () => MASK,
  },
  {
    name: 'aws-access-key-id',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replace: () => MASK,
  },
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replace: () => MASK,
  },
  {
    name: 'authorization-header',
    regex: /(authorization\s*:\s*)(\S.*)/gi,
    replace: (_m, p1) => p1 + MASK,
  },
  {
    name: 'bearer-token',
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replace: () => 'Bearer ' + MASK,
  },
  {
    name: 'cookie-header',
    regex: /(cookie\s*:\s*)(\S.*)/gi,
    replace: (_m, p1) => p1 + MASK,
  },
  {
    name: 'json-secret-field',
    // "password": "value"  /  'api_key': 'value'  /  token: value
    regex: /(["']?\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*)(["']?)([^"',\s}]+)(["']?)/gi,
    replace: (_m, p1, q1, _val, q2) => p1 + q1 + MASK + q2,
  },
  {
    name: 'shell-env-assignment',
    // TOKEN=abc123, export API_KEY=xyz, DB_PASSWORD=...
    // The lookahead allows the sensitive keyword to be the *entire* variable
    // name (e.g. bare `TOKEN=`), not just a suffix after some other prefix.
    regex: /\b((?:export\s+)?(?=[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL))[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(\S+)/gi,
    replace: (_m, p1) => p1 + MASK,
  },
  {
    name: 'aws-credentials-block',
    regex: /\b(aws_secret_access_key\s*=\s*)(\S+)/gi,
    replace: (_m, p1) => p1 + MASK,
  },
]

/**
 * Mask sensitive substrings in a string.
 * @param {string} input
 * @returns {{ text: string, count: number }}
 */
function redactText(input) {
  if (typeof input !== 'string' || input.length === 0) {
    return { text: input == null ? '' : String(input), count: 0 }
  }

  let text = input
  let count = 0

  for (const rule of RULES) {
    try {
      text = text.replace(rule.regex, (...args) => {
        count += 1
        return rule.replace(...args)
      })
    } catch {
      // A single bad rule must never break masking of the remaining rules.
    }
  }

  return { text, count }
}

/**
 * Recursively mask sensitive values inside a JSON-like structure (object,
 * array, or primitive). Keys are inspected too: if a key name looks
 * sensitive, its entire value is replaced regardless of content.
 * @param {*} value
 * @param {{ count: number }} counter
 * @returns {*}
 */
const SENSITIVE_KEY_RE =
  /password|passwd|pwd|secret|token|api[_-]?key|authorization|auth[_-]?header|cookie|private[_-]?key|credential/i

function redactValue(value, counter) {
  if (value == null) return value

  if (typeof value === 'string') {
    const { text, count } = redactText(value)
    counter.count += count
    return text
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, counter))
  }

  if (typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) {
      try {
        if (SENSITIVE_KEY_RE.test(key)) {
          out[key] = MASK
          counter.count += 1
        } else {
          out[key] = redactValue(value[key], counter)
        }
      } catch {
        out[key] = MASK
        counter.count += 1
      }
    }
    return out
  }

  return value
}

/**
 * Mask sensitive data anywhere in a JSON-serializable value.
 * @param {*} value
 * @returns {{ value: *, count: number }}
 */
function redactDeep(value) {
  const counter = { count: 0 }
  try {
    const masked = redactValue(value, counter)
    return { value: masked, count: counter.count }
  } catch {
    return { value: '[REDACTION_ERROR]', count: 0 }
  }
}

/** Does this path look like a dotenv file? Content from these must never be stored. */
function isDotEnvPath(p) {
  if (typeof p !== 'string') return false
  const base = p.split(/[\\/]/).pop() || ''
  return base === '.env' || /^\.env\./.test(base) || /^\.env$/.test(base)
}

function isSensitiveKey(key) {
  try {
    return SENSITIVE_KEY_RE.test(String(key))
  } catch {
    return false
  }
}

module.exports = { redactText, redactDeep, isDotEnvPath, isSensitiveKey, MASK }
