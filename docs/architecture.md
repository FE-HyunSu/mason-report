# Architecture

## 데이터 흐름

```text
User Prompt
  → UserPromptSubmit Hook
  → Claude Agent Loop
  → Tool/Subagent Hooks (PreToolUse, PostToolUse, PostToolUseFailure,
                          SubagentStart, SubagentStop, InstructionsLoaded)
  → Stop Hook
  → Local JSONL (<project>/.mason-report/events/*.jsonl)
  → inspect Command (/mason-report:latest, /mason-report:select, /mason-report:all)
  → decision-analysis Skill (분석 절차 · 증거 등급 정의)
  → Mason Report (observed / inferred / unknown 구분된 마크다운)
```

## 구성 요소

- **hooks/hooks.json**: `SessionStart`, `UserPromptSubmit`, `InstructionsLoaded`,
  `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`,
  `Stop`, `SessionEnd` 10개 이벤트를 `capture-event.js`에 연결한다. 모든 항목이 `type:
  "command"`이며, 정책을 강제하거나(`permissionDecision` 등) 입력을 수정하는 출력은 절대
  만들지 않는다 — 순수 관찰자다.
- **scripts/capture-event.js**: 각 Hook 이벤트를 stdin으로 받아, 이벤트별 allowlist로
  필드를 추출하고, `redact.js`로 마스킹한 뒤 `<project>/.mason-report/events/<sessionId>.jsonl`
  에 append한다. 프로젝트 루트를 안전하게 확인할 수 없으면 아무 곳에도 쓰지 않고 조용히
  종료한다.
- **scripts/redact.js**: 정규식 기반 마스킹 규칙과, 키 이름 기반 마스킹(민감해 보이는 키는
  값과 무관하게 마스킹)을 제공한다.
- **scripts/rotate-logs.js**: 이벤트 파일 크기와 개수를 제한한다.
- **scripts/read-events.js**: 저장된 JSONL을 읽어 세션/턴 단위로 조회하는 읽기 전용
  CLI. Slash Command가 Bash로 직접 호출한다.
- **commands/*.md**: 사용자가 실행하는 `/mason-report:latest`, `/mason-report:select`,
  `/mason-report:all`, `/mason-report:status`. `read-events.js`를 호출해 원본
  데이터를 가져온 뒤, Claude가 그 데이터를 해석해 리포트를 작성하도록 지시한다.
  `/mason-report:select`는 추가로 `AskUserQuestion` Tool을 사용해 분석 대상 턴을
  사용자가 직접 고르게 한다.
- **skills/decision-analysis/SKILL.md**: 분석 절차, observed/inferred/unknown 구분 원칙,
  Skill/Rule 적용 여부 판정 등급(확인됨/강한 추정/약한 추정/관찰 안 됨)을
  정의한다. 실제 리포트 형식은 강제하지 않고 각 Command가 정의한다.

## 왜 분석을 Command/Skill에서 수행하는가

MVP는 별도 LLM API를 호출하지 않는다. 로그 수집(Hook)과 로그 분석(Command + Skill)을
분리해, 분석은 **이미 설치되어 있는 Claude Code 자신**이 Skill의 절차를 따라 수행하게
한다. 이렇게 하면:

- 네트워크 호출이나 별도 API 키가 전혀 필요 없다.
- 분석 로직(observed/inferred/unknown 판단)이 Claude의 자연어 추론 능력을 그대로
  활용하면서도, Skill이 정의한 명시적 절차와 등급 기준으로 과도한 단정을 억제한다.
- 로그 수집기(`capture-event.js`)는 순수하게 결정적인 코드로 남아 테스트하기 쉽다.

## Hook이 절대 하지 않는 것

- Tool 호출을 차단하거나 승인/거부를 결정하지 않는다(`hookSpecificOutput.permissionDecision`
  류의 출력을 만들지 않는다).
- Claude의 입력이나 Tool 입력을 수정하지 않는다.
- stdout에 아무것도 출력하지 않는다 — `SessionStart`/`UserPromptSubmit` 등 일부 이벤트는
  exit 0 상태에서 stdout 평문이 Claude의 컨텍스트에 그대로 주입될 수 있다는 점을 확인했기
  때문에, 관찰자가 의도치 않게 Claude의 입력에 영향을 주는 것을 원천적으로 막기 위함이다.
- 실패 시 어떤 경우에도 0이 아닌 종료 코드나 예외를 밖으로 내보내지 않는다.
