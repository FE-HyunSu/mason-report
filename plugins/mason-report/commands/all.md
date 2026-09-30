---
description: 현재 세션 전체를 mason-report가 수집한 관찰 증거만으로 요약합니다 (턴 목록, Tool 사용, 실패, Skill 적용 추정 등).
allowed-tools: Bash, Read
---

# 목표

현재 세션(`${CLAUDE_SESSION_ID}`)에서 관찰된 전체 흐름을 요약한다. 개별 턴의 상세 재구성이
아니라 세션 단위의 패턴(반복된 Tool, 실패한 Tool, Subagent 사용 여부, 로드된 지침 등)에
초점을 맞춘다.

**비공개 chain-of-thought는 다루지 않는다.** 오직 로그에 기록된 관찰 사실만 사용한다.

# 절차

1. 현재 세션의 전체 이벤트를 가져온다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" session "${CLAUDE_SESSION_ID}"
   ```

   결과가 빈 배열이면, 이 세션에서 아직 수집된 이벤트가 없다는 사실을 그대로 보고한다
   (예: 세션이 막 시작됐거나, hooks가 아직 한 번도 트리거되지 않았을 수 있다).

2. 이벤트를 시간순으로 정렬해 `UserPromptSubmit` 기준으로 턴을 구분한다. **턴은 반드시
   프롬프트가 입력된 순서대로 하나씩 나열한다** — 먼저 그 턴의 사용자 프롬프트를 인용하고,
   바로 그 아래에 그 턴에 대한 설명을 붙인 다음, 다음 턴으로 넘어간다(아래 출력 형식 참고).
   **단, `UserPromptSubmit.data.prompt`가 `/mason-report:`로 시작하는 턴(이 플러그인
   자신의 커맨드를 호출한 턴, 예: `/mason-report:all`, `/mason-report:latest 2`)은 턴
   목록에서 제외한다** — 이는 분석 대상이 되는 사용자 요청이 아니라 리포트 생성 요청
   자체이기 때문이다.
   각 턴에서:
   - 해당 턴에 속한 `PreToolUse`/`PostToolUse`/`PostToolUseFailure` 이벤트 수
   - 수정된 파일 경로(`PreToolUse`의 `Write`/`Edit`/`NotebookEdit` 이벤트에서 추출)
   - `SubagentStart`/`SubagentStop` 존재 여부
   를 집계한다.

3. 세션 전체에서:
   - 가장 많이 호출된 Tool
   - 실패(`PostToolUseFailure`)가 발생한 Tool과 횟수
   - 로드된 지침(`InstructionsLoaded` 이벤트의 경로 목록)
   을 집계한다.

4. `plugins/mason-report/skills/decision-analysis/SKILL.md`의 근거 표기(✅/🔶/❔), Skill
   활성화 등급, 프롬프트 문구→트리거 매핑 규칙을 참고하여, 턴마다 요청 문구와 실제 행동의
   대응을 판정한다. % 수치는 쓰지 않는다.

5. 로그만으로 확인할 수 없는 부분(예: `promptId`가 없어 시간 구간으로만 연결된 이벤트, 아직
   transcript에 반영되지 않았을 수 있는 항목)은 ❔로 표시한다. `SKILL.md`의 "가독성 원칙"을
   따른다 — 문장마다 `(observed, …)` 태그를 붙이지 않고 아이콘만 쓰며, 같은 사실을 반복하지
   않는다. **리포트 본문은 항상 존댓말(-습니다/-입니다)로 작성한다.**

# 출력 형식

세션 요약이 목적이므로 턴마다 원본 로그 표나 단계 표를 펼치지 않는다. 턴은 **프롬프트
순서대로** 짧은 블록(불릿 3개)으로 나열하고, 세션 전체 요약을 맨 위에 둔다.

```markdown
# Mason Report (세션 요약)

> **요약:** <세션 전체에서 무엇을 했는지 한두 문장>

**표기:** ✅ 로그로 확인됨 · 🔶 정황상 추정 · ❔ 확인할 수 없음

- 세션 ID: `<sessionId>` · 관찰 기간: <첫 이벤트 시각> ~ <마지막 이벤트 시각>
- 턴 <N>개 · 도구 호출 <N>회 (많이 쓴 순: <Tool>×<N>, <Tool>×<N>) · 실패 <M>회
- 로드된 지침: <파일 (loadReason)> 또는 없음 · 사용된 Skill: <이름> 또는 없음

## 턴 1 — "<프롬프트 1 축약(약 30자)>"

- **한 일:** <Tool>×<N>, <Tool>×<N> · 수정 파일: <경로들 또는 없음> · Subagent: <agentType 또는 없음>
- **결과:** ✅ 모두 성공 또는 ❌ <Tool>: <에러 요약>
- **해석:** "<문구>" → <행동> ✅ · "<문구>" → <행동 없음> ❔

## 턴 2 — "<프롬프트 2 축약>"

- ...(턴 1과 같은 형식)

<!-- 관찰된 턴 수만큼 "## 턴 N" 블록을 반복한다 -->

> ℹ️ 이 리포트는 로그를 바탕으로 재구성한 것이며, Claude의 내부 사고 과정이 아닙니다.
```
