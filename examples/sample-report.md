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

> **요약:** `src/utils.js`의 off-by-one 버그를 수정하고 테스트 5개 통과까지 확인했습니다. 무엇을 어떻게 고쳤는지는 로그에 저장되지 않아 알 수 없습니다.

**표기:** ✅ 로그로 확인됨 · 🔶 정황상 추정 · ❔ 확인할 수 없음

## 1. 요청

> "utils.js에 있는 off-by-one 버그를 고쳐줘"

## 2. 실제로 한 일

| 단계 | 한 일 | 결과 |
|---|---|---|
| ① 조사 | `src/utils.js` 읽기 (Read 1회) | ✅ 성공 |
| ② 수정 | `src/utils.js` 수정 (Edit 1회) | ✅ 성공 |
| ③ 검증 | `npm test` 실행 (Bash 1회) | ✅ "5 passing" |

소요 시간: 17초 (14:02:00 ~ 14:02:17) · 도구 호출 3회, 실패 0회 · 토큰: 입력 2 · 출력 85 · 캐시 생성 9,354 · 캐시 조회 38,990

## 3. 요청 문구별 해석

| 요청 문구 | 실제 동작 | 판정 |
|---|---|---|
| "utils.js에 있는" | `src/utils.js`를 읽고 수정 | ✅ 실행됨 |
| "off-by-one 버그를 고쳐줘" | 수정 후 `npm test`로 확인 | ✅ 실행됨 / 🔶 테스트로 검증하려던 것으로 추정 |
| (문구 없음) | `CLAUDE.md` 지침을 따른 것으로 보임 | 🔶 약한 추정 |

로드된 지침: `CLAUDE.md` (path_glob_match) · 사용된 Skill은 로그에 없습니다.

## 4. 최종 답변 검증

- ✅ "테스트 5개가 모두 통과합니다"는 `npm test` 결과("5 passing")와 일치합니다.
- ❔ 수정한 부분이 이 테스트들이 검증하는 대상인지는 diff를 저장하지 않아 확인할 수 없습니다.

<details>
<summary>원본 로그 6건 펼치기</summary>

| 시각 | 이벤트 | 내용 |
|---|---|---|
| `14:02:00` | 프롬프트 입력 | "utils.js에 있는 off-by-one 버그를 고쳐줘" |
| `14:02:01` | 지침 로드 | `CLAUDE.md` (path_glob_match) |
| `14:02:03` | 도구 시작 → 성공 | Read: `src/utils.js` |
| `14:02:08` | 도구 시작 → 성공 | Edit: `src/utils.js` |
| `14:02:15` | 도구 시작 → 성공 | Bash: `npm test` |
| `14:02:17` | 턴 종료 | 최종 답변: "off-by-one 버그를 수정했고 테스트 5개가 모두 통과합니다" |

</details>

> ℹ️ 이 리포트는 로그를 바탕으로 재구성한 것이며, Claude의 내부 사고 과정이 아닙니다.
