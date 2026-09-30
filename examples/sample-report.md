# Sample Mason Report (worked example)

이 문서는 실제 사용자 세션이 아니라, `plugins/mason-report/scripts/capture-event.js`와
`read-events.js`에 실제 샘플 Hook 이벤트를 흘려보내 얻은 결과를 근거로 손으로 작성한
예시다. `/mason-report:latest`가 실행되면 Claude가 이와 유사한 형태의 리포트를
생성한다.

입력으로 사용된 이벤트 시퀀스(요약): `SessionStart` → `UserPromptSubmit`
("utils.js에 있는 off-by-one 버그를 고쳐줘") → `InstructionsLoaded` (`CLAUDE.md`,
`path_glob_match`) → `PreToolUse`/`PostToolUse` (`Read src/utils.js`) →
`PreToolUse`/`PostToolUse` (`Edit src/utils.js`) → `PreToolUse`/`PostToolUse`
(`Bash: npm test`) → `Stop`.

---

# Mason Report

## 1. 입력된 프롬프트

> "utils.js에 있는 off-by-one 버그를 고쳐줘"

## 2. 로그

이 프롬프트가 입력된 이후 실제로 기록된 원본 이벤트입니다(시간순, 해석 없이 그대로).

- `UserPromptSubmit`: 사용자가 프롬프트 입력 (사람이 채팅창에 메시지를 보낸 순간)
- `InstructionsLoaded`: 지침 파일 로드 (CLAUDE.md 등 규칙 파일을 컨텍스트에 불러온 순간)
- `PreToolUse`: 도구 호출 시작 (도구를 쓰기 직전)
- `PostToolUse`: 도구 호출 성공 (도구 사용이 끝난 직후)
- `Stop`: 턴 종료 (최종 답변까지 끝난 순간)

| 시각 | 이벤트 | 내용 | 근거 |
|---|---|---|---|
| `14:02:00` | `UserPromptSubmit` | "utils.js에 있는 off-by-one 버그를 고쳐줘" | - |
| `14:02:01` | `InstructionsLoaded` | `CLAUDE.md` (path_glob_match) | promptId 일치 (observed) |
| `14:02:03` | `PreToolUse` | Read: `src/utils.js` | promptId 일치 (observed) |
| `14:02:03` | `PostToolUse` | Read | promptId 일치 (observed) |
| `14:02:08` | `PreToolUse` | Edit: `src/utils.js` | promptId 일치 (observed) |
| `14:02:08` | `PostToolUse` | Edit | promptId 일치 (observed) |
| `14:02:15` | `PreToolUse` | Bash: `npm test` | promptId 일치 (observed) |
| `14:02:15` | `PostToolUse` | Bash | promptId 일치 (observed) |
| `14:02:17` | `Stop` | 최종 답변: "off-by-one 버그를 수정했고 테스트 5개가 모두 통과합니다" | promptId 일치 (observed) |

## 3. 분석

**결과**

- Read(`src/utils.js`) → 성공
  (observed, 로그로 확인된 것)
- Edit(`src/utils.js`) → 성공
  (observed, 로그로 확인된 것)
- Bash(`npm test`) → 성공 ("5 passing")
  (observed, 로그로 확인된 것)

정확히 어떤 부분을 어떻게 바꿨는지는 diff 원문을 저장하지 않는 정책상 확인이
어렵습니다 — 위 "Edit → 성공"은 수정이 발생했다는 사실만 보여줍니다.
(unknown, 로그만으로 확인 불가)

**토큰 사용량**

- 메인 대화: input 2 · output 85 · cache 생성 9,354 · cache 조회 38,990
  (observed, 로그로 확인된 것)
- Subagent: 없습니다

**프롬프트 문구 → 트리거 매핑**

| 근거 문구 | 트리거 | 등급 (참고용 수치) |
|---|---|---|
| 특정 문구 없음 | (Skill: 없음) | 관찰 안 됨 (알수없음) |
| "utils.js에 있는 off-by-one 버그를 고쳐줘" | (Rule: CLAUDE.md) | 약한 추정 (~40%, 참고용) |

- 이 턴에서는 Skill 파일 접근이나 명시적 `/plugin:skill` 호출 문자열이 전혀 관찰되지
  않아 판정 근거 자체가 없습니다.
  (unknown, 로그만으로 확인 불가)
- "utils.js에 있는 off-by-one 버그를 고쳐줘" 문구로 인해, 맥락상 `CLAUDE.md`의 관련
  규칙이 실행된 것으로 추정됩니다 — 다만 `CLAUDE.md`가 로드된 사실은 확인되지만 지침
  내용 자체는 저장하지 않으므로, 이 문구가 실제로 어떤 규칙을 촉발했는지는 로그만으로
  확인할 수 없어 약한 추정에 그칩니다.
  (inferred, 정황상 추정된 것)

※ %는 실측 확률이 아니라 등급을 참고용으로 시각화한 값이며, Claude의 내부 판단 확률에는
접근할 수 없습니다.

**최종 답변과 로그 비교**

- 최종 답변("off-by-one 버그를 수정했고 테스트 5개가 모두 통과합니다")은 위 로그·결과
  (Edit 성공 + 테스트 통과)와 대체로 일치하는 것으로 보입니다 — 다만 수정한 내용이
  실제로 이 5개 테스트가 검증하는 대상인지는 로그만으로 확인할 수 없습니다.
  (inferred, 정황상 추정된 것 / unknown, 로그만으로 확인 불가)

## 한계

이 리포트는 실행 증거를 기반으로 재구성한 분석이며 Claude의 비공개 내부 사고 과정이
아닙니다. 표의 %는 등급을 참고용으로 표현한 것이며 실측값이 아닙니다(관찰 안 됨은
'알수없음'으로 표기합니다). 토큰 사용량은 등급이 아니라 transcript에 찍힌 실측치를
그대로 적은 것입니다.
