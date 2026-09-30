---
description: 그동안 입력했던 프롬프트 목록을 보여주고, 사용자가 직접 고른 프롬프트(턴)에 대해 mason-report가 수집한 관찰 증거(observed)만으로 Mason Report를 생성합니다. 숫자 인자로 몇 개의 최근 프롬프트를 후보로 보여줄지 지정할 수 있습니다(기본값 20).
argument-hint: "[n]"
allowed-tools: Bash, Read, AskUserQuestion
---

# 목표

`/mason-report:latest`가 "가장 최근 턴"을 자동으로 고르는 것과 달리, 이 명령은 그동안
관찰된 프롬프트 중 **사용자가 직접 하나를 선택**하게 한 뒤, 그 턴만 분석한다.
`.mason-report/events/`에 기록된 로그만을 근거로 하며, Claude의 비공개 chain-of-thought는
조회하거나 요구하지 않는다.

# 절차

1. 선택 후보가 될 최근 프롬프트 목록을 가져온다. `$ARGUMENTS`가 비어 있으면 20으로
   취급된다(스크립트가 알아서 기본값 처리).

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" list-prompts "$ARGUMENTS"
   ```

   반환된 JSON은 `requestedCount`(요청한 후보 개수), `returnedCount`(실제로 반환된 개수),
   `totalAvailable`(이 프로젝트에 기록된, 선택 가능한 프롬프트 전체 개수 — `returnedCount`
   보다 클 수 있음), `prompts`(최신순, 즉 배열의 0번째가 가장 최근 프롬프트)로 구성된다.
   `prompts`의 각 항목은 원본 `UserPromptSubmit` 이벤트이며 `sessionId`, `timestamp`,
   `data.prompt`를 담고 있다. 이 목록은 이 플러그인 자신의 `/mason-report:*` 호출은 이미
   제외하고 반환된다.

   `returnedCount`가 0이면: "선택할 수 있는 과거 프롬프트가 없다"는 사실을 그대로
   보고하고 중단한다(추측으로 채우지 않는다).

2. **AskUserQuestion으로 프롬프트를 하나 선택하게 한다.** 이 Tool은 질문 하나당 선택지를
   2~4개까지만 담을 수 있으므로, 아래 규칙으로 나눠서 보여준다:

   - `returnedCount`가 1이면: 고를 필요가 없으므로 AskUserQuestion을 띄우지 않고 그
     프롬프트를 곧바로 3단계로 넘긴다.
   - `returnedCount`가 2~4이면: 남은 프롬프트 전부를 선택지로 하는 질문 하나를 띄운다.
   - `returnedCount`가 4보다 크면: 아직 보여주지 않은 프롬프트 중 앞에서부터 3개를
     선택지로 하고, 4번째 선택지로 "이전 프롬프트 더 보기"를 추가한 질문을 띄운다.
     사용자가 "이전 프롬프트 더 보기"를 고르면, 그다음 3개(+필요하면 다시 "이전 프롬프트
     더 보기")로 새 질문을 이어서 띄운다 — 실제 프롬프트를 선택할 때까지 반복한다. 이미
     가져온 `prompts` 배열 안에서만 페이지를 넘기며, 별도로 스크립트를 다시 호출하지
     않는다.
   - 각 선택지의 `label`은 해당 프롬프트 텍스트를 40자 내외로 축약한 짧은 문구로 쓰고
     (예: 끝을 "…"으로 자름), `description`에는 타임스탬프와 프롬프트 전문(이미
     마스킹·길이 제한된 값)을 함께 적어 사용자가 구분할 수 있게 한다.
   - `totalAvailable`이 `returnedCount`보다 크면(즉 이번에 가져온 목록보다 더 오래된
     프롬프트가 남아 있으면), 마지막 "이전 프롬프트 더 보기" 이후에도 목록이 끝나면 그
     사실을 사용자에게 안내한다("이 목록에는 최근 N개만 포함되어 있고, 더 오래된
     프롬프트가 있다 — 필요하면 `/mason-report:select <더 큰 숫자>`로 다시 실행해 달라").
     스스로 더 큰 숫자로 다시 호출하지 않는다.

3. 사용자가 실제 프롬프트를 하나 선택하면, 그 프롬프트 이벤트의 `sessionId`와
   `timestamp`로 해당 턴 전체를 가져온다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" turn "<sessionId>" "<timestamp>"
   ```

   반환된 JSON은 `/mason-report:latest`의 `last-turns` 턴 항목과 동일한 구조
   (`prompt`, `promptIdCorrelated`, `timeWindowCorrelated`, `tokenUsage` — 이 턴이 실제로
   소비한 토큰, `SKILL.md`의 "토큰 사용량" 절 참고)를 가진다. `error` 키가
   있으면(예: 사용자가 고른 항목과 실제 로그가 어긋난 경우) 그 사실을 그대로 보고하고
   중단한다.

4. `plugins/mason-report/skills/decision-analysis/SKILL.md`에 정의된 분석 절차, Skill 활성화
   증거 등급(확인됨 / 강한 추정 / 약한 추정 / 관찰 안 됨), 등급→참고용
   수치 변환, 프롬프트 문구→트리거 매핑 규칙, 토큰 사용량 표기 규칙을 이 턴에 그대로
   적용한다. 이 Skill의 절차를 skip하지 말고 각 단계를 실제로 수행한다.

5. 아래 출력 형식으로 보고서를 작성한다.
   `plugins/mason-report/skills/decision-analysis/SKILL.md`의 "리포트 구성" 절이 정의한
   세 섹션(1. 입력된 프롬프트 → 2. 로그 → 3. 분석) 순서를 그대로 따르고, 마지막에
   "## 한계"를 둔다 — 순서를 바꾸거나 섹션을 생략하지 않는다. **리포트 본문은 항상
   존댓말(-습니다/-입니다)로 작성한다.**

   "2. 로그" 표는 해석 없이 실제 기록된 이벤트를 **Pre/Post를 병합하지 않고** 시간순으로
   그대로 옮긴다 — `PostToolUse`/`PostToolUseFailure` 행에는 `status`나 결과 요약을
   적지 않는다(그건 "3. 분석 → 결과"의 몫이다). "근거" 칸에는 `promptId` 연결이면
   "promptId 일치 (observed)", 시간 구간 연결이면 "시간 구간 추정 (inferred)"만 적는다.

   "3. 분석"은 항상 **결과 → 트리거 매핑 → 최종 답변과 로그 비교** 순서로 구성한다.
   "결과"는 같은 `toolUseId`의 Pre/Post 쌍마다 한 줄씩(`observed`), 트리거 매핑 표는
   `SKILL.md`의 "트리거 표기 형식"과 "표 가독성 규칙"을 그대로 따르고(트리거 칸에
   `(Skill: 이름)` / `(Rule: 이름)` / `(Tool: tool_name)` 식으로 종류 표시, 근거 문구는
   약 30자 내외 축약, 셀 안 줄바꿈 금지, 참고용 %는 항상 등급 이름과 함께 표기, 관찰 안
   됨은 %를 쓰지 않고 "알수없음"만 표기), 표 아래에 각 행을 짧은 존댓말 문장으로 풀어
   설명한다("'<근거 문구>' 문구로 인해, 맥락상 <트리거 이름>이 실행된 것으로
   추정됩니다."). 이 서술 불릿에는 `(observed)` / `(inferred)` / `(unknown)` 태그를
   줄바꿈 후 다음 줄에 적되, 한국어 리포트에서는 `(observed, 로그로 확인된 것)` /
   `(inferred, 정황상 추정된 것)` / `(unknown, 로그만으로 확인 불가)`처럼 한글 표기를
   함께 붙인다(다른 언어로 작성하는 경우는 제외 — `SKILL.md` 참고).

# 출력 형식

```markdown
# Mason Report (선택한 턴)

## 1. 입력된 프롬프트

> "<선택된 프롬프트 원문 또는 핵심 요약>"

## 2. 로그

이 프롬프트가 입력된 이후 실제로 기록된 원본 이벤트입니다(시간순, 해석 없이 그대로).

<아래 표에 실제로 등장하는 이벤트명만 골라 범례를 먼저 적는다(등장하지 않는 이벤트명은
뺀다):
- `UserPromptSubmit`: 사용자가 프롬프트 입력 (사람이 채팅창에 메시지를 보낸 순간)
- `InstructionsLoaded`: 지침 파일 로드 (CLAUDE.md 등 규칙 파일을 컨텍스트에 불러온 순간)
- `PreToolUse`: 도구 호출 시작 (도구를 쓰기 직전)
- `PostToolUse`: 도구 호출 성공 (도구 사용이 끝난 직후)
- `PostToolUseFailure`: 도구 호출 실패 (도구 사용이 에러로 끝난 직후)
- `SubagentStart`: Subagent 시작 (하위 작업자를 띄운 순간)
- `SubagentStop`: Subagent 종료 (하위 작업자가 끝난 순간)
- `Stop`: 턴 종료 (최종 답변까지 끝난 순간)>

| 시각 | 이벤트 | 내용 | 근거 |
|---|---|---|---|
| `<HH:MM:SS>` | `UserPromptSubmit` | "<프롬프트 요약>" | - |
| `<HH:MM:SS>` | `PreToolUse` | \<ToolName>: <경로/명령/패턴> | promptId 일치 (observed) 또는 시간 구간 추정 (inferred) |
| `<HH:MM:SS>` | `PostToolUse` 또는 `PostToolUseFailure` | \<ToolName> | promptId 일치 (observed) 또는 시간 구간 추정 (inferred) |
| `<HH:MM:SS>` | `Stop` | 최종 답변: "<원문 또는 요약>" | promptId 일치 (observed) |

<표에 실을 이벤트가 하나도 없으면 표 대신 "이 턴에서 관찰된 이벤트가 없습니다"라고 적는다.
`InstructionsLoaded`/`SubagentStart`/`SubagentStop` 이벤트가 있으면 같은 형식으로 행을
추가한다.>

## 3. 분석

**결과**

<위 "2. 로그"에서 같은 toolUseId를 공유하는 PreToolUse/PostToolUse(Failure) 쌍마다 한 줄씩:
- \<ToolName>(<대상>) → 성공/실패 (+짧은 결과 요약이 있으면 덧붙임)
  (observed, 로그로 확인된 것)
결과로 보여줄 Tool 호출이 하나도 없으면 이 줄들을 생략한다.>

**토큰 사용량**

<`tokenUsage.available`이 true이면 아래처럼 실측치를 그대로 적는다(참고용 %가 아님):
- 메인 대화: input <inputTokens> · output <outputTokens> · cache 생성 <cacheCreationInputTokens> · cache 조회 <cacheReadInputTokens>
  (observed, 로그로 확인된 것)
- Subagent: <subagent 버킷이 전부 0이면 "없습니다", 아니면 메인과 같은 형식으로>

false이면 `reason`에 따라 다음 중 하나만 적고 숫자를 지어내지 않는다(모두 unknown, 로그만으로 확인 불가):
- transcript_path_not_captured → "이 로그는 토큰 사용량 계산 기능이 추가되기 전에 기록되어 확인이 어렵습니다"
- turn_not_completed → "이 턴이 아직 완료되지 않아 계산하지 않았습니다"
- transcript_unreadable → "transcript 파일을 읽을 수 없어 확인이 어렵습니다">

**프롬프트 문구 → 트리거 매핑**

| 근거 문구 | 트리거 | 등급 (참고용 수치) |
|---|---|---|
| "<프롬프트 중 해당 부분(약 30자 내외로 축약)>" 또는 "특정 문구 없음" | (Skill: \<이름>) 또는 (Rule: \<파일명>) 또는 (Tool: \<tool_name>) | <확인됨/강한 추정/약한 추정> (~<%>, 참고용) 또는 관찰 안 됨 (알수없음) |

<한 근거 문구가 여러 트리거에 걸치면 한 행에 몰아넣지 말고 행을 나눠 트리거 하나씩
적는다. 위 표에 후보가 전혀 없으면 표 대신 "이 턴에서 트리거로 판정할 후보 자체가
관찰되지 않았습니다(관찰 안 됨)"라고 적는다.>

- "<근거 문구>" 문구로 인해, 맥락상 <트리거 이름>이 실행된 것으로 추정됩니다.
  (확인됨은 observed / 강한·약한 추정은 inferred / 관찰 안 됨은 unknown — 한글 표기 함께)

※ %는 실측 확률이 아니라 등급을 참고용으로 시각화한 값이며, 관찰 안 됨은 판단 근거가
없다는 뜻이라 수치 대신 '알수없음'으로 표기합니다 — Claude의 내부 판단 확률에는
접근할 수 없습니다.

**최종 답변과 로그 비교**

- 최종 답변은 위 로그·결과와 <일치/불일치>하는 것으로 보입니다.
  (inferred, 정황상 추정된 것 / unknown, 로그만으로 확인 불가 중 하나)

## 한계

이 리포트는 실행 증거를 기반으로 재구성한 분석이며, Claude의 비공개 내부 사고 과정이
아닙니다. 표의 %는 등급을 참고용으로 표현한 것이며 실측값이 아닙니다(관찰 안 됨은
'알수없음'으로 표기합니다). 토큰 사용량은 등급이 아니라 transcript에 찍힌 실측치를
그대로 적은 것입니다.
```
