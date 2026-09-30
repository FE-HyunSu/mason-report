---
description: 가장 최근에 완료된 사용자 턴(들)을 mason-report가 수집한 관찰 증거(observed)만으로 재구성하여 Mason Report를 생성합니다. 숫자 인자로 몇 턴을 볼지 지정할 수 있습니다(기본값 1).
argument-hint: "[n]"
allowed-tools: Bash, Read
---

# 목표

가장 최근에 완료된 사용자 턴(들)에 대해, `.mason-report/events/`에 기록된 로그만을 근거로
실행 과정을 재구성한다. 인자를 주지 않으면 가장 최근 턴 1개, 숫자를 주면(`/mason-report:latest 3`
처럼) 그 개수만큼의 최근 턴을 시간순으로 보여준다. 최근 턴이 아니라 과거의 특정 턴을
직접 골라 분석하고 싶으면 `/mason-report:select`를 대신 사용한다.

**이 명령은 Claude의 비공개 chain-of-thought를 조회하거나 요구하지 않는다.** 오직 Hook과
transcript에서 관찰 가능한 사실(호출된 Tool, 읽거나 수정한 파일, 실행한 명령, Subagent 활동,
최종 답변)만을 사용한다.

# 절차

1. 아래 명령으로 최근 턴(들)의 원본 이벤트를 가져온다. `$ARGUMENTS`가 비어 있으면 1로
   취급된다(스크립트가 알아서 기본값 처리).

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" last-turns "$ARGUMENTS"
   ```

   반환된 JSON은 `requestedCount`(요청한 개수), `returnedCount`(실제로 로그에 있던 턴
   개수 — 요청보다 적을 수 있음), `turns`(시간순, 오래된 것부터 최신 순으로 정렬된 배열)로
   구성된다. 각 턴 항목은 `prompt`(해당 턴의 `UserPromptSubmit` 이벤트),
   `promptIdCorrelated`(같은 `promptId`로 명시적으로 연결된 이벤트 — observed 근거로
   취급 가능), `timeWindowCorrelated`(`promptId`가 없어 시간 구간으로만 연결된 이벤트 —
   반드시 inferred/약한 근거로 취급), `tokenUsage`(해당 턴이 실제로 소비한 토큰 —
   `SKILL.md`의 "토큰 사용량" 절 참고)를 담는다. `last-turns`는 프롬프트 텍스트가
   `/mason-report:`로 시작하는 턴(이 플러그인 자신의 커맨드를 호출한 턴, 예: 지금 이
   커맨드를 실행시킨 `/mason-report:latest 2` 그 자체)을 이미 제외하고 반환한다 — 리포트
   생성 요청 자체는 분석 대상 턴이 아니기 때문이다.

   `turns`가 빈 배열이면, 아직 수집된 로그가 없다는 사실을 그대로 보고하고 중단한다.
   `returnedCount`가 `requestedCount`보다 작으면, 요청한 개수만큼의 턴이 아직 기록되어
   있지 않다는 점을 리포트에 명시한다(추측으로 채우지 않는다).

2. `plugins/mason-report/skills/decision-analysis/SKILL.md`에 정의된 분석 절차, Skill 활성화
   증거 등급(확인됨 / 강한 추정 / 약한 추정 / 관찰 안 됨), 등급→참고용
   수치 변환, 프롬프트 문구→트리거 매핑 규칙, 토큰 사용량 표기 규칙을 각 턴에 그대로
   적용한다. 이 Skill의 절차를 skip하지 말고 각 단계를 실제로 수행한다.

3. 아래 출력 형식을 그대로 사용하여 보고서를 작성한다. `returnedCount`가 1이면 "단일 턴
   형식"을, 2 이상이면 "다중 턴 형식"을 사용한다. 두 형식 모두
   `plugins/mason-report/skills/decision-analysis/SKILL.md`의 "리포트 구성" 절이 정의한
   세 섹션(1. 입력된 프롬프트 → 2. 로그 → 3. 분석) 순서를 그대로 따르고, 마지막에
   "## 한계"를 둔다 — 순서를 바꾸거나 섹션을 생략하지 않는다. **리포트 본문은 항상
   존댓말(-습니다/-입니다)로 작성한다.**

   "2. 로그" 표는 해석 없이 실제 기록된 이벤트를 **Pre/Post를 병합하지 않고** 시간순으로
   그대로 옮긴다 — `PostToolUse`/`PostToolUseFailure` 행에는 `status`나 결과 요약을
   적지 않는다(그건 "3. 분석 → 결과"의 몫이다). "근거" 칸에는 `promptId` 연결이면
   "promptId 일치 (observed)", 시간 구간 연결이면 "시간 구간 추정 (inferred)"만 적는다.
   표를 그리기 직전에 그 표에 실제로 등장하는 이벤트명만 골라 짧은 범례를 한 번
   둔다(단일 턴 형식의 출력 예시 참고) — 다중 턴 형식에서도 턴마다 그 턴의 표에 맞는
   범례를 각각 붙인다.

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

### 단일 턴 형식 (`returnedCount` == 1)

```markdown
# Mason Report

## 1. 입력된 프롬프트

> "<사용자 프롬프트 원문 또는 핵심 요약>"

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

### 다중 턴 형식 (`returnedCount` >= 2)

```markdown
# Mason Report (최근 <returnedCount>턴)

<requestedCount > returnedCount인 경우: "요청하신 <requestedCount>턴 중 <returnedCount>턴만
로그에 존재합니다"를 여기에 명시>

## 턴 1

### 1. 입력된 프롬프트

> "<프롬프트 1 원문 또는 핵심 요약>"

### 2. 로그

| 시각 | 이벤트 | 내용 | 근거 |
|---|---|---|---|
| ... | ... | ... | ... |

### 3. 분석

**결과**
- ...(단일 턴 형식과 동일한 형식)

**토큰 사용량**: <단일 턴 형식과 동일한 규칙 — available이면 메인/Subagent 실측치,
아니면 reason별 unknown 문구만 한 줄로 짧게>

**프롬프트 문구 → 트리거 매핑**

| 근거 문구 | 트리거 | 등급 (참고용 수치) |
|---|---|---|
| ... | ... | ... |

- <트리거 서술 불릿, 단일 턴 형식과 동일한 형식>

**최종 답변과 로그 비교**
- 최종 답변은 위 로그·결과와 <일치/불일치>하는 것으로 보입니다.
  (inferred, 정황상 추정된 것 / unknown, 로그만으로 확인 불가 중 하나)

## 턴 2

### 1. 입력된 프롬프트

> "<프롬프트 2>"

### 2. 로그

| 시각 | 이벤트 | 내용 | 근거 |
|---|---|---|---|
| ... | ... | ... | ... |

### 3. 분석

**결과**
- ...

**토큰 사용량**: ...

**프롬프트 문구 → 트리거 매핑**

| 근거 문구 | 트리거 | 등급 (참고용 수치) |
|---|---|---|
| ... | ... | ... |

- ...

**최종 답변과 로그 비교**
- ...

<!-- returnedCount 만큼 "## 턴 N" 블록을 반복한다 -->

## 한계

이 리포트는 실행 증거를 기반으로 재구성한 분석이며, Claude의 비공개 내부 사고 과정이
아닙니다. 표의 %는 등급을 참고용으로 표현한 것이며 실측값이 아닙니다(관찰 안 됨은
'알수없음'으로 표기합니다). 토큰 사용량은 등급이 아니라 transcript에 찍힌 실측치를
그대로 적은 것입니다.
```
