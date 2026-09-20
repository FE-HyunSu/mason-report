# Event Schema

mason-report는 Claude Code 공식 Hook 이벤트의 원본 페이로드를 그대로 저장하지 않는다.
`plugins/mason-report/scripts/capture-event.js`가 이벤트별 allowlist로 필요한 필드만
추출하고, 마스킹을 거친 뒤 JSONL 한 줄로 append한다.

## 공통 봉투(envelope)

```json
{
  "schemaVersion": 1,
  "timestamp": "ISO-8601",
  "event": "UserPromptSubmit",
  "sessionId": "session-id",
  "promptId": "prompt-id",
  "cwd": "/project/path",
  "transcriptPath": "/absolute/path/to/session-transcript.jsonl",
  "source": "claude-code-hook",
  "data": {},
  "redaction": { "applied": true, "count": 0 }
}
```

- `promptId`에 대해 공식 문서(`code.claude.com/docs/en/hooks.md`)는 "`prompt_id` common
  field... Absent until the first user input. Requires Claude Code v2.1.196 or later"라고
  적고 있다. 그러나 **이 문서 기재 내용은 실측으로 반증됐다**: 실제 v2.1.178 설치본(VS Code
  확장, Agent SDK 백엔드)에서 `SessionStart` 이후 발생한 모든 이벤트(`UserPromptSubmit`,
  `PreToolUse`, `PostToolUse` 등)에 `promptId`가 정상적으로 채워지는 것을 2026-09-06에
  직접 확인했다(mason-report 플러그인을 실제로 설치해 `.mason-report/events/`에 기록된
  로그를 직접 열어본 결과). 즉 이 필드는 문서에 적힌 것보다 더 이른 버전부터 채워지거나,
  최소한 클라이언트 표면(터미널 vs VS Code 확장 vs Agent SDK)에 따라 문서와 다르게 동작할
  수 있다. 정확한 최소 지원 버전은 여전히 불확실하므로, `promptId`가 채워지지 않는 경우를
  대비한 시간 구간 기반 폴백(아래)은 계속 유지한다 — 다만 "v2.1.196 미만에서는 항상 비어
  있다"는 이전 서술은 더 이상 신뢰할 수 없다.
- `promptId`가 비어 있는 경우(위 실측과 무관하게, 다른 클라이언트/버전 조합에서는 여전히
  발생할 수 있음) `read-events.js`는 `promptId` 대신 이벤트 발생 시간 구간으로 턴을 추정
  연결한다(약한 연결 — 리포트에서 `inferred`로 표시해야 함).
- `redaction.count`는 `capture-event.js`가 마스킹 규칙을 적용해 치환한 총 횟수다. 0이면
  "이 이벤트에서 마스킹 대상이 발견되지 않았다"는 뜻이지 "마스킹 로직이 비활성화됐다"는
  뜻이 아니다.
- `transcriptPath`는 Hook 공통 필드 `transcript_path`를 **경로 문자열 그대로** 저장한
  것이다 — `capture-event.js`는 이 파일을 절대 읽거나 파싱하지 않는다. `read-events.js`가
  나중에(리포트 생성 시점에) 이 경로를 열어 완료된 턴의 토큰 사용량(`usage`)을 계산하는
  용도로만 쓰인다. 이 필드는 이 기능이 추가되기 전에 기록된 기존 로그에는 없으므로,
  옛 로그를 대상으로 한 턴은 토큰 사용량이 "확인 불가"로 남는다.

## 이벤트별 `data` 필드

이 목록에 없는 필드가 실제 Hook 입력에 들어와도 `capture-event.js`는 실패하지 않고 무시한다
(알 수 없는 이벤트/필드에 대한 방어적 설계).

### SessionStart

```json
{ "source": "startup | resume | clear | compact | fork" }
```

`source`의 구체적인 값 집합은 공식 문서(`hooks.md`)에 문서화되어 있음을 확인했다.

### SessionEnd

```json
{ "reason": "clear | resume | logout | prompt_input_exit | other" }
```

### UserPromptSubmit

```json
{ "prompt": "masked, truncated prompt text" }
```

**버전 의존성 주의**: 사용자가 실제로 입력한 프롬프트 텍스트를 담는 필드의 정확한 이름을
공식 문서 원문에서 직접 인용해 확인하지는 못했다(문서 페이지의 해당 섹션이 조회 도구의
길이 제한으로 잘렸음). `capture-event.js`는 `prompt` 필드를 최우선으로 읽고, 없으면
`user_prompt`, `message` 순으로 방어적으로 시도한다. 실제 필드명이 다르면 이 값은 빈
문자열로 기록될 수 있다 — 이 경우 리포트에서는 반드시 "프롬프트 원문을 확인할 수 없음
(unknown)"으로 표시해야 한다.

### InstructionsLoaded

```json
{ "path": "relative/or/absolute/path", "loadReason": "session_start | nested_traversal | path_glob_match | include | compact" }
```

로드된 지침의 **내용은 저장하지 않는다**. 경로와 로드 사유만 기록한다.

### PreToolUse

```json
{
  "toolName": "Bash",
  "toolUseId": "toolu_...",
  "input": { "...": "도구별 allowlist, 아래 표 참고" }
}
```

Tool별 `input` 요약 규칙:

| Tool | 저장하는 필드 |
|---|---|
| `Bash` | `command`(마스킹+길이 제한), `description`, `runInBackground` |
| `Read`/`Edit`/`Write`/`NotebookEdit` | `path`(가능하면 프로젝트 상대경로), `operation`, `isDotEnv` — **내용/old_string/new_string은 저장하지 않음** |
| `Glob`/`Grep` | `pattern`, `path` |
| `WebFetch` | `url`(마스킹+길이 제한) |
| `WebSearch` | `query`(마스킹+길이 제한) |
| `Task`/`Agent` | `subagentType`, `description` |
| 그 외(알 수 없는 Tool, MCP Tool 포함) | `inputKeys`만(값은 저장하지 않음) |

### PostToolUse / PostToolUseFailure

```json
{
  "toolName": "Bash",
  "toolUseId": "toolu_...",
  "status": "success | failure",
  "result": { "...": "아래 규칙" },
  "error": { "...": "PostToolUseFailure에서는 result 대신 error 키 사용" }
}
```

Tool 결과 요약 규칙:

- `Read`/`Edit`/`Write`/`NotebookEdit`: `{ "note": "content-not-stored" }` — 파일 내용을
  포함할 수 있는 결과는 절대 저장하지 않는다.
- `Bash`/`WebFetch`/`WebSearch`/`Grep`: 마스킹 후 최대 500자(실패 시 800자)로 잘린
  `summary` 문자열.
- 그 외: "shape summary" — 실제 값 대신 타입/길이만 남긴다(예: 문자열은
  `"string(len=42)"`, 객체는 키만 유지하고 값은 재귀적으로 shape summary, 민감해 보이는
  키는 값과 무관하게 `[REDACTED]`). 이 방식은 원문을 전혀 저장하지 않으면서도 "무엇이
  반환됐는지"에 대한 최소한의 안전한 요약을 제공한다.

**주의**: `PostToolUseFailure`의 실패 원인을 담는 필드명(`tool_response` vs `tool_error`
vs `error`)은 공식 문서에서 명시적으로 확인하지 못했다. `capture-event.js`는
`tool_response` → `tool_error` → `error` 순으로 값을 찾는다.

### SubagentStart

```json
{ "agentId": "...", "agentType": "Explore | Plan | general-purpose | ...", "description": "..." }
```

### SubagentStop

```json
{ "agentId": "...", "agentType": "...", "lastAssistantMessage": "masked, truncated" }
```

### Stop

```json
{ "lastAssistantMessage": "masked, truncated" }
```

공식 문서는 `last_assistant_message`가 `Stop`과 `SubagentStop`에 공통으로 존재한다고
명시한다("Hooks that need the final assistant text of the current turn should use
`last_assistant_message` on Stop and SubagentStop"). `Stop` 이벤트 자체의 전체 입력 JSON
예시는 문서에서 직접 인용하지 못했으므로, 이 필드 외의 추가 필드가 있을 수 있다는 점을
`unknown`으로 남겨둔다.

## 토큰 사용량 계산 (transcript 기반)

Hook 이벤트에는 토큰/비용 데이터가 전혀 없다 — 위 이벤트별 `data` 필드 목록 어디에도
그런 값은 존재하지 않는다. 대신 `read-events.js`의 `computeTokenUsageForTurn`은 **완료된
턴에 한해**, `transcriptPath`가 가리키는 Claude Code 세션 transcript(JSONL) 파일을 직접
읽어 실제 API 사용량을 계산한다. transcript의 각 줄 중 `"type": "assistant"`인 항목은
다음과 같은 실측 `usage` 필드를 담고 있다(실제 세션 파일을 열어 확인한 스키마):

```json
{
  "type": "assistant",
  "timestamp": "ISO-8601",
  "isSidechain": false,
  "message": {
    "usage": {
      "input_tokens": 2,
      "output_tokens": 85,
      "cache_creation_input_tokens": 9354,
      "cache_read_input_tokens": 38990
    }
  }
}
```

- **집계 범위**: 턴의 시작(`UserPromptSubmit.timestamp`)부터 끝(`Stop.timestamp`)까지 시간
  구간에 속한 `assistant` 항목만 합산한다. `Stop` 이벤트가 관찰되지 않은(아직 진행 중인)
  턴은 계산하지 않는다 — transcript 파일은 비동기로 기록되므로, 막 끝난 턴을 그 즉시
  읽으면 마지막 몇 줄이 아직 반영되지 않아 과소집계될 위험이 있다(`docs/limitations.md`
  참고). 이미 완료되어 시간이 지난 턴을 조회할 때는 이 위험이 없다.
- **Main-chain vs Subagent**: `isSidechain: true`인 항목(Task tool로 실행된 Subagent의
  응답)은 별도 버킷으로 합산한다 — 메인 대화 토큰과 합쳐서 하나의 숫자로 뭉개지 않는다.
- **캐시 토큰은 별도 카테고리**: `cache_creation_input_tokens`/`cache_read_input_tokens`는
  `input_tokens`(새로 처리된 프롬프트 토큰)와 과금·의미가 다르므로 항상 별도 필드로
  유지하고, 리포트에서도 하나의 "총합"으로 뭉치지 않는다.
- 이 값은 실제 API 응답에 찍힌 실측치이므로 Skill 활성화 등급처럼 "참고용 %"로 표현하지
  않는다 — `observed` 등급의 정확한 숫자로 그대로 표기한다.

## 알 수 없는 이벤트

`hook_event_name`이 위 목록에 없으면 `data: {}`로 최소한의 공통 필드만 기록한다(수집기가
실패하지 않도록 하는 방어적 기본값). `hooks.json`은 10개 이벤트에만 연결되어 있으므로,
실제 운영 중에는 이 경로가 거의 발생하지 않지만 향후 Claude Code 버전에서 필드가 추가되거나
바뀌는 경우에도 수집기가 죽지 않도록 하기 위한 안전장치다.
