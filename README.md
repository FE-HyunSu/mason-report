# mason-report

한국어 문서는 [README_ko.md](./README_ko.md)를 참고하세요.

**mason-report** is an open-source Claude Code plugin that observes Claude Code's execution through official Hooks and reconstructs how a request was handled — using only observable evidence (prompts, tool calls, file paths, subagent activity, the final answer). It never extracts Claude's private chain-of-thought, makes no network calls, and stores everything locally under your project's `.mason-report/` directory.

---

## Quick Start

### Requirements

- Claude Code, a version that supports Plugins/Marketplaces/Hooks (see [Supported Claude Code versions](#supported-claude-code-versions))
- Node.js 18+ (the hook/query scripts are plain Node.js and run without any extra install step)
- macOS, Linux, or Windows

Before doing anything else, confirm your `claude` actually runs:

```bash
claude --version
```

This must print a real version string (e.g. `2.1.178 (Claude Code)`). If you use `nvm` with several Node versions, each version keeps its own separate global npm install of `@anthropic-ai/claude-code` — an incomplete install manifests as a tiny placeholder script that errors with "claude native binary not installed," or a `permission denied` error if it's not marked executable. If that happens, run `nvm use <a version with a working install>` (and `nvm alias default <that version>` to make it stick), or reinstall cleanly:

```bash
npm install -g @anthropic-ai/claude-code
```

### Install

**How you type the install commands depends on where you're running Claude Code.** This is the part that trips people up most, so read this table first:

| Where Claude Code is running | What to type | Where to type it |
|---|---|---|
| A normal terminal shell, Claude Code not already running interactively | `claude plugin marketplace add fe-hyunsu/mason-report`, then `claude plugin install mason-report@mason` | Directly at the shell prompt — **no leading `/`**. These are ordinary CLI subcommands of the `claude` binary, not slash commands, so a plain shell understands them. |
| Interactive terminal REPL (you already ran `claude` and are inside its own prompt) | `/plugin marketplace add fe-hyunsu/mason-report`, then `/plugin install mason-report@mason` | Inside that session's own input box. |
| VS Code extension | `/plugins` (**plural** — `/plugin` singular is not available on this surface) | In the chat box; it opens a GUI dialog where you add the marketplace and install from there. |
| A surface with no interactive UI at all (cloud sessions, headless/CI) | Declare it in `.claude/settings.json` (see below) | It's a config file, not something you type. |

#### Step by step (shell command — works almost everywhere, recommended)

1. Confirm Claude Code works (see [Requirements](#requirements)): `claude --version`.

2. Add the marketplace and install the plugin:
   ```bash
   claude plugin marketplace add fe-hyunsu/mason-report
   claude plugin install mason-report@mason
   ```
   The part before `@` is the **plugin name** (`mason-report`); the part after `@` is the **marketplace name** (`mason`) — this repo is a single-plugin marketplace, but the two names are independent identifiers, not the same thing.

3. **Activate it in a session that's already open.** A shell-level install does not automatically show up in a Claude Code session you already had running (for example, a VS Code chat panel open before you ran the command above). Inside that already-open session, run:
   ```
   /reload-plugins
   ```
   A brand-new session started *after* the install will load the plugin automatically — no reload needed there.

4. **Verify it's actually active:**
   ```
   /mason-report:status
   ```
   If this returns a real status report instead of "unknown command," it's active.

#### Updating to a newer version

Because `plugin.json`'s `version` field pins the plugin, a `git push` to this repo alone does **not** update anything you've already installed — you receive updates only when that version string changes, and only after you explicitly refresh:

```bash
claude plugin marketplace update mason
claude plugin uninstall mason-report@mason
claude plugin install mason-report@mason
```

(An uninstall-then-install is the most reliable way to pick up a new version cleanly; a plain re-`install` may just report "already installed.") Then `/reload-plugins` in any session that's already open.

#### Alternative: declare it in `.claude/settings.json` (no interactive step needed)

Useful for team setups, or any environment without an interactive UI:

```json
{
  "extraKnownMarketplaces": {
    "mason": {
      "source": { "source": "github", "repo": "fe-hyunsu/mason-report" }
    }
  },
  "enabledPlugins": {
    "mason-report@mason": true
  }
}
```

#### Testing locally without publishing anywhere

```bash
claude plugin marketplace add ./path/to/mason-report
claude plugin install mason-report@mason
```
(the same shell-vs-REPL-vs-VS-Code distinction from the table above still applies)

### Commands

**`/mason-report:latest`** — reconstructs a report of the most recently completed user turn(s), using observed evidence only. Takes an optional number: no argument means the last 1 turn, a number means that many recent turns.

```text
/mason-report:latest
/mason-report:latest 3
```

Each turn's report has two parts: a short chronological bullet list of what actually happened (tagged `observed`/`inferred`/`unknown`), and a separate **prompt-phrase → trigger mapping table** showing which part of your prompt appears to have caused which Skill/rule/tool to fire, together with an evidence grade and a reference confidence-% band. The grade is one of four levels — shown as Korean words in the report itself (확인됨 "confirmed", 강한 추정 "strongly-inferred", 약한 추정 "weakly-inferred", 관찰 안 됨 "not-observed") regardless of which language you're conversing in. That % is always shown paired with the grade name — it's a visualization of the grade, not a measured probability, since mason-report has no access to Claude's internal decision process. Invoking `/mason-report:latest` (or `/mason-report:select`/`/mason-report:all`) itself is never counted as one of the analyzed turns.

See [examples/sample-report.md](./examples/sample-report.md) for the output format and a worked example.

**`/mason-report:select`** — instead of always analyzing the most recent turn, lets you pick which past prompt to analyze. Shows your recent prompts as a multiple-choice question (via Claude Code's `AskUserQuestion` tool) and generates the same single-turn report for whichever one you pick. Takes an optional number for how large a pool of recent prompts to offer (default 20); if there are more than 4 candidates, they're paged 3-at-a-time with a "show older prompts" option.

```text
/mason-report:select
/mason-report:select 50
```

**`/mason-report:all`** — summarizes the entire current session: turn list, tool usage patterns, failures, loaded instructions, estimated Skill usage, and so on.

```text
/mason-report:all
```

**`/mason-report:status`** — shows log collection status: location, most recent event, session count, whether masking has been applied, log size, supported hook events, and diagnostic warnings.

```text
/mason-report:status
```

### Logs

```text
<project-root>/.mason-report/
├── events/    # Hook event JSONL
├── reports/   # (reserved — for future report storage)
├── state/     # internal state (e.g. a marker for whether .gitignore was already patched)
└── config.json  # (reserved — for future configuration)
```

No log is ever written to the plugin's install directory or plugin cache. If the project root can't be safely determined (no `CLAUDE_PROJECT_DIR` and no valid `cwd` in the hook input), nothing is written anywhere.

To delete all logs for a project:

```bash
rm -rf .mason-report/
```

This is an ordinary file deletion you run yourself in your own project; `mason-report` provides no remote-deletion feature or separate deletion API of its own.

---

## Project Details

### What it does and why

`mason-report` is an open-source Claude Code plugin that observes Claude Code's execution through **official Hooks**, and reconstructs — from that observed evidence alone — how Claude handled a given request. It makes no external LLM calls and runs no server: Claude Code itself reads the logs and writes the analysis report.

While handling one request, Claude Code calls multiple tools, reads or edits files, and sometimes spawns subagents. That process flashes by in the chat transcript and is hard to reconstruct precisely afterward — which files were actually touched, which instructions applied, why a particular approach was taken. `mason-report` records the **observable** part of that execution locally, then later explains it from that record alone, carefully separating fact from inference.

### What can be confirmed

- The user's submitted prompt (masked, length-limited)
- Session/prompt identifiers
- The **paths** of loaded instruction files such as `CLAUDE.md`
- Tool names called, and a minimal input summary (e.g. a Bash command, a file path)
- A safe summary of each tool's result (success/failure, masked and length-limited text or a structural summary)
- **Paths** of files read or modified
- Bash commands executed (masked)
- Subagent execution traces (type, identifier)
- Claude's final answer (masked, length-limited)
- Reconstructed reasoning built from the above, explicitly labeled `observed` / `inferred` / `unknown`
- A prompt-phrase → trigger mapping table, with an evidence grade and an approximate confidence-% band per grade (never a measured probability — see below)

### What cannot be confirmed

- Claude's private chain-of-thought, or the model's internal comparison of candidate approaches
- Any reasoning not reflected in the logs (can be inferred, never confirmed)
- A real, measured confidence probability behind any judgment — Hooks expose no such value; the %'s shown in reports are an approximate visualization of the four-tier evidence grade, always shown together with the grade name
- Full file contents, original diffs, or complete raw tool output (not stored, by policy)
- The full distinction between a Skill file being loaded into context and that Skill's procedure actually having been followed (only estimable via evidence tiers)

See [docs/limitations.md](./docs/limitations.md) for the complete list.

**mason-report is not a tool for extracting or bypassing Claude's private internal reasoning.** Every analysis is grounded only in facts officially exposed through Hooks and the transcript. Reports are designed to never assert "Claude thought this," and instead phrase things as "based on the observed behavior, it appears Claude judged X" (see `skills/decision-analysis/SKILL.md`).

### How it works

```text
User Prompt
  → UserPromptSubmit Hook
  → Claude Agent Loop
  → Tool/Subagent Hooks
  → Stop Hook
  → Local JSONL (.mason-report/events/)
  → inspect Command
  → decision-analysis Skill
  → Mason Report
```

See [docs/architecture.md](./docs/architecture.md) for details.

### Hook events collected

Only the following 10 events are used, each confirmed as currently supported in the official docs (`code.claude.com/docs/en/hooks.md`):

`SessionStart`, `UserPromptSubmit`, `InstructionsLoaded`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`

The exact fields stored per event are defined in [docs/event-schema.md](./docs/event-schema.md). **Under no circumstances does a hook block a tool call, modify Claude's or a tool's input, or print anything to stdout** — it is a pure observer.

### Privacy and security policy

- **No network access, by default.**
- File content is never stored — only paths and operation types (this includes `.env` files).
- API keys, access/bearer tokens, Authorization/Cookie headers, passwords, PEM/private keys, and AWS/GitHub/Anthropic/OpenAI-style tokens are masked before anything is written to disk.
- Tool results are stored as safe, size-limited summaries, never as raw full output.
- Log size and retention count are capped (roughly 5MB per file, with a cap on the number of files per project).
- If `.mason-report/` is a symlink pointing outside the project root, writes are refused.
- If `.mason-report/` is missing from `.gitignore`, it's added safely — existing content is preserved.
- A hook failure, or an analysis failure, never blocks Claude Code's normal operation.

See [docs/privacy.md](./docs/privacy.md) for details.

### Supported Claude Code versions

This plugin was built against the Plugin / Marketplace / Hooks / Skill specifications currently documented at `code.claude.com/docs/en/`.

**On 2026-09-06, this plugin was installed into a real Claude Code instance (v2.1.178, VS Code extension + Agent SDK backend) via `claude plugin marketplace add` / `claude plugin install`, and verified end-to-end** by running `/reload-plugins` followed by `/mason-report:status`. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, and `PostToolUse` events were confirmed to be recorded correctly in `.mason-report/events/`, and `sessionId`/`promptId` correlation, the masking pipeline, and project-relative path conversion were all confirmed against real, live logs.

- Plugin/Marketplace/Hooks/Skill core structure: confirmed both in the docs and via a real install and load.
- `prompt_id` (used for turn correlation) — the official docs state "requires Claude Code v2.1.196 or later," but **it was observed to be populated correctly on v2.1.178.** This documented minimum version requirement therefore does not match reality; the true minimum is left as unknown. The time-window-based fallback (for when `promptId` is absent) is still kept regardless.
- The `UserPromptSubmit` prompt-text field name (`prompt`) was confirmed populated correctly in real logs (see [docs/event-schema.md](./docs/event-schema.md) for details).
- `/reload-plugins` originally reported "1 error during load" with no visible cause in the VS Code extension. **Root cause found and fixed in v0.1.2**: `plugin.json` explicitly declared `"hooks": "./hooks/hooks.json"`, but that exact path is already auto-discovered by Claude Code by default — declaring it again made Claude Code treat it as a duplicate and (on a fresh install of a bumped version) fail to load the plugin entirely, reporting `Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file .../hooks/hooks.json`. The fix was simply removing the redundant `hooks` field from `plugin.json`; `tests/validate.js` now has a regression check for this specific mistake.

Running `/mason-report:status` after installing is the recommended way to directly confirm events are being collected correctly in your own environment.

### Known limitations

The full list is in [docs/limitations.md](./docs/limitations.md). Key points:

- Chain-of-thought and the model's internal comparison of candidates are fundamentally inaccessible.
- A file being accessed, or an instruction being loaded, does not mean it was actually applied.
- The Observer's own analysis (the report-generation step) is also Claude's interpretation, and can itself be wrong.
- Masking is pattern-based and therefore not exhaustive.
- End-to-end verification against a real Claude Code process has now been done (see [Supported Claude Code versions](#supported-claude-code-versions) above). The "1 error during load" it first surfaced was root-caused and fixed in v0.1.2 (a redundant `hooks` field in `plugin.json`).

### Publishing your own marketplace on GitHub

If you're maintaining a fork or your own copy of this plugin:

1. Push this repository to GitHub as a **public** repo (`.claude-plugin/marketplace.json` must sit at the repo root).
2. Replace the `name`/`owner.name` in `.claude-plugin/marketplace.json`, and the `author`/`homepage`/`repository` fields in each plugin entry and in `plugins/mason-report/.claude-plugin/plugin.json`, with your own values.
3. Tag releases explicitly (see the [release checklist](#release-checklist-tag-based-versioning) below).

### Development and testing

```bash
git clone https://github.com/fe-hyunsu/mason-report.git
cd mason-report

npm test         # run unit/integration tests via Node's built-in test runner
npm run validate # check the manifests/hooks.json/command & skill frontmatter/script syntax, then run tests
```

No external dependencies — only the Node.js standard library and `node:test`.

### Contributing

1. Open an issue first to discuss, especially for changes with privacy implications (adding a hook event, changing masking rules).
2. Fork the repo and create a branch.
3. Make sure `npm run validate` passes before opening a PR.
4. A PR that adds or changes masking rules must include a corresponding test in `tests/redact.test.js`.
5. Please report security vulnerabilities privately to the repo owner rather than as a public issue (see the GitHub profile for `fe-hyunsu` for contact — fill in a concrete security contact here once the repo is public).

#### Release checklist (tag-based versioning)

- [ ] `npm test` and `npm run validate` pass
- [ ] Changes recorded in `CHANGELOG.md`
- [ ] `version` bumped together in `.claude-plugin/marketplace.json` and `plugins/mason-report/.claude-plugin/plugin.json`
- [ ] `git tag vX.Y.Z` and push (a marketplace's `github` source type can pin a specific tag/branch via `ref`)

### License

[MIT License](./LICENSE)
