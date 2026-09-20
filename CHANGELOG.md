# Changelog

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/) 형식을 따르려 하며,
버전은 태그 기반([릴리스 체크리스트](./README.md#릴리스-체크리스트-태그-기반-버전-관리) 참고)으로 관리한다.

## [0.2.0] - 2026-09-20

### Changed

- **마켓플레이스 이름과 플러그인 이름을 분리했다.** 마켓플레이스는 `mason`, 플러그인은
  `mason-report`로, 설치 시 `mason-report@mason` 형태로 참조한다.

## [0.1.9] - 2026-09-18

### Added

- **`/mason-report:readme` 커맨드를 추가했다.** 로그를 조회하지 않는 정적 안내 커맨드로,
  플러그인 사용법(전체 커맨드 목록)과 리포트 표기 기준(observed/inferred/unknown,
  confirmed/strongly-inferred/weakly-inferred/not-observed 등급, 트리거 매핑 표 읽는
  법)을 설명한다. 지금 대화에서 사용자가 쓰고 있는 언어에 맞춰 출력하도록 했다 —
  OS 로케일이나 국가 정보는 조회하지 않는다.

### Changed

- **등급 표기에서 "근사"라는 표현을 "참고용"으로 바꿨다.** "근사"는 "실측에 가까운
  계산값"처럼 오해되기 쉽다는 피드백에 따라 `SKILL.md`와 모든 커맨드의 출력 형식에서
  일괄 교체했다.
- **`not-observed` 등급은 더 이상 "0%"라는 숫자를 쓰지 않고 "알수없음"으로만
  표기한다.** "0%"는 "관여하지 않았음을 측정해서 확인했다"로 오해되기 쉽지만, 실제
  의미는 "판단할 근거 자체가 로그에 없다"는 것이라 숫자보다 문구가 더 정확하다.
- **트리거 매핑 표에서 "종류" 열을 없애고, 트리거 이름 앞에 종류를 괄호로 붙이는
  방식으로 통일했다.** `(Skill: dataviz)`, `(Rule: CLAUDE.md)`, `(Tool: Bash)`처럼
  한 칸 안에서 바로 구분되게 해서 표의 열 수를 4개에서 3개로 줄였다.
- **표 가독성 규칙을 `SKILL.md`에 추가했다.** 근거 문구는 약 30자 내외로 축약하고,
  셀 안에서 줄을 바꿔야 하면 raw newline 대신 `<br>`을 쓰도록 명시해, 트리거 매핑
  표가 옆으로 길게 늘어지지 않게 했다.

## [0.1.8] - 2026-09-18

### Added

- **`/mason-report:select` 커맨드를 추가했다.** `/mason-report:latest`가 항상 가장 최근
  턴만 자동으로 고르는 것과 달리, 이 커맨드는 그동안 관찰된 프롬프트 목록을 Claude
  Code의 `AskUserQuestion` Tool로 선택지처럼 보여주고, 사용자가 직접 고른 프롬프트(턴)
  하나에 대해 동일한 단일 턴 리포트를 생성한다. 후보 프롬프트 개수는 숫자 인자로 조절할
  수 있고(기본값 20), 후보가 4개를 넘으면 한 번에 3개씩 보여주면서 "이전 프롬프트 더
  보기" 선택지로 이어서 넘겨볼 수 있다.
- `read-events.js`에 이를 뒷받침하는 `list-prompts [n]`(최신순 프롬프트 목록,
  `/mason-report:*` 자체 호출은 제외), `turn <sessionId> <timestamp>`(특정 프롬프트
  하나의 턴 전체를 조회) 서브커맨드를 추가했다.

### Changed

- **Command 이름을 `/mason-report:chat`에서 `/mason-report:latest`로 바꿨다.**
  `/mason-report:select`가 함께 생기면서, "가장 최근 턴을 본다"는 의미가 이름에 더
  분명히 드러나도록 했다. 동작(인자 처리, 출력 형식)은 그대로다.
- **`last-turns`(그리고 `/mason-report:all`의 턴 목록)가 이 플러그인 자신의
  `/mason-report:*` 호출은 더 이상 분석 대상 턴으로 세지 않는다.** 예를 들어
  `/mason-report:latest 2`를 실행하면, 그 호출 자체가 "최근 턴" 중 하나로 끼어들어
  실제로 보고 싶었던 이전 턴을 밀어내던 문제가 있었다 — 리포트 생성 요청은 분석
  대상이 아니라는 원칙에 따라 수정했다.
- README.md 상단에 한국어 문서 링크를 제목 바로 아래로 옮겼다. 두 문서 모두 위
  변경사항(새 리포트 포맷, `/mason-report:select`, 턴 제외 규칙)을 반영해 갱신했다.

## [0.1.7] - 2026-09-15

### Changed

- **리포트 가독성 개선 + "프롬프트 문구 → 트리거" 매핑 추가.** 기존 리포트는 실행 흐름과
  Skill/지침 판정 근거를 한 문단에 욱여넣어 읽기 어려웠다. `/mason-report:chat`,
  `/mason-report:all` 출력 형식을 시간순 불릿(실행 흐름)과 별도 표(트리거 매핑)로
  분리했다. 표는 프롬프트의 어떤 문구가 어떤 Skill/지침(Rule)/Tool을 유발했다고 보이는지,
  그리고 그 판정 등급(confirmed/strongly-inferred/weakly-inferred/not-observed)을
  근거 문구와 함께 보여준다.
- `decision-analysis` Skill에 등급 → 근사 확신도(%) 변환 규칙을 추가했다
  (confirmed=90–100%, strongly-inferred=60–89%, weakly-inferred=20–59%,
  not-observed=0%, 모두 "근사"). mason-report는 Claude의 내부 판단 확률에 접근할 수
  없으므로, 이 %는 실측값이 아니라 4단계 등급을 시각화한 근사 구간이라는 점을 리포트에
  항상 함께 명시하도록 강제했다 — % 단독 표기는 금지.

## [0.1.6] - 2026-09-15

### Changed

- **Command 이름을 `/mason-report:1`에서 `/mason-report:chat`으로 바꿨다.** 실제 설치본으로
  테스트해보니, 명령어 이름이 숫자 `1`이면서 동시에 "몇 턴을 볼지"도 숫자 인자로 받다
  보니 `/mason-report:2`처럼 개수를 명령어 이름으로 착각하기 쉽다는 문제가 드러났다
  (실제로 그렇게 시도했다가 "Unknown command"를 겪음). 명령어 이름을 인자와 겹치지 않는
  `chat`으로 바꿔 `/mason-report:chat`(최근 1턴), `/mason-report:chat 3`(최근 3턴)처럼
  쓰도록 했다. 동작(인자 처리, 기본값 등)은 그대로다.

## [0.1.5] - 2026-09-12

### Added

- **`/mason-report:chat`이 이제 선택적으로 숫자 인자를 받는다.** 인자 없이 `/mason-report:chat`은
  기존과 동일하게 최근 1턴만 보여주고, `/mason-report:chat 3`처럼 숫자를 주면 최근 N턴을
  시간순으로 보여준다. `read-events.js`에 `findLastPrompts(events, n)`과 새 CLI
  서브커맨드 `last-turns [n]`을 추가했다(기존 `last-turn` 서브커맨드는 `last-turns`로
  대체됨). 요청한 개수가 로그에 있는 턴 수보다 많으면 있는 만큼만 반환하고, 잘못된
  값(0, 음수, 숫자가 아닌 값)은 조용히 1로 대체된다.

## [0.1.4] - 2026-09-12

### Changed

- **Command 이름을 더 짧게 바꿨다**: `/mason-report:inspect-last` → `/mason-report:chat`,
  `/mason-report:inspect-session` → `/mason-report:all` (`/mason-report:status`는 그대로
  유지). 기존 이름이 타이핑하기엔 너무 길다는 피드백을 반영했다. 순수 숫자(`1`)로만
  이루어진 command 파일명이 실제로 유효한 slash command로 동작하는지는 문서로 확신할
  수 없어, 설치 후 실제 세션에서 직접 호출해 확인했다.

### Fixed

- **`npm test`/`npm run validate`가 Node v24.11.1에서 실패하던 문제를 고쳤다.**
  `node --test tests/`(바로 뒤에 디렉터리 경로를 붙이는 형태)가 이 환경에서는
  `--test` 플래그 자체가 인식되지 않은 것처럼 `Cannot find module '.../tests'`
  에러를 내며 완전히 실패했다 — 이전에 개발할 때 쓰던 Node 버전에서는 문제없이
  동작했던 것과 대조적이다. 임의의 디렉터리 하나만 비교해본 결과 같은 증상이
  재현되어 이 리포지토리 코드 문제가 아니라 Node 버전 차이임을 확인했다. 경로 인자
  없이 `node --test`만 실행하면(현재 디렉터리에서 재귀적으로 테스트 파일을 찾는
  기본 동작) 두 버전 모두에서 안정적으로 동작해, `package.json`과
  `tests/validate.js`를 이 형태로 변경했다.

## [0.1.2] - 2026-09-06

### Fixed

- **`plugin.json`이 자체 로드 실패를 유발하던 버그를 수정했다.** `"hooks": "./hooks/hooks.json"`을
  명시적으로 선언해뒀는데, 이 경로는 Claude Code가 기본적으로 자동 로드하는 표준 위치라서
  또 명시하면 중복으로 인식되어 플러그인 로드 자체가 실패했다
  (`Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file .../hooks/hooks.json`).
  실제 사용자가 v0.1.0 → v0.1.1로 업데이트를 시도하다가 이 에러로 완전히 막히는 것을
  터미널 로그로 확인하고 나서 발견했다. `plugin.json`에서 불필요한 `hooks` 필드를
  제거해 해결했다.
- 이 버그는 사실 v0.1.0/v0.1.1에서 `/reload-plugins`가 원인 불명으로 보고했던
  "1 error during load"의 실체였을 가능성이 높다(정확히 같은 증상). README/README_ko의
  §17, §18과 `docs/limitations.md`에 이 내용을 반영했다.
- `tests/validate.js`에 이 실수를 다시 잡아낼 수 있는 회귀 검사를 추가했다: `plugin.json`의
  `hooks` 필드가 자동 로드되는 기본 `hooks/hooks.json` 경로와 같은 파일을 가리키면
  검증에 실패한다.

## [0.1.1] - 2026-09-06

### Changed

- `/mason-report:chat`, `/mason-report:all`의 출력 포맷을
  고정된 8개 h2 섹션 방식에서, "사용자 프롬프트 한 줄 인용 → 그 턴에 대한 설명 → 다음
  프롬프트" 순서로 이어지는 내러티브 스타일로 변경했다(가독성 개선 피드백 반영).
  `observed`/`inferred`/`unknown` 태그와 Skill/Rule 적용 등급 구분은 그대로 유지된다.
- `examples/sample-report.md`를 새 포맷에 맞춰 갱신했다.

### Considered and rejected

- 리포트에 이번 요청의 토큰 사용량을 표시하는 기능을 검토했으나, Hook 이벤트 JSON에는
  토큰 필드가 전혀 없고, Claude Code의 공식 토큰/비용 데이터(`statusline`)는 세션
  누적치이거나 "가장 최근 API 호출 1건"의 스냅샷이라 "이번 턴에 정확히 사용된 토큰"을
  나타낼 수 없어 구현하지 않기로 했다. 또한 현재 우선순위(리포트 가독성)와도 무관해
  범위에서 제외했다.

## [0.1.0] - Unreleased

### Added

- 첫 MVP 릴리스.
- `mason-report` Claude Code Plugin (`plugins/mason-report/`)과 이를 배포하기 위한
  Plugin Marketplace 구조(`.claude-plugin/marketplace.json`).
- 10개 공식 Hook 이벤트(`SessionStart`, `UserPromptSubmit`, `InstructionsLoaded`,
  `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`,
  `Stop`, `SessionEnd`)를 프로젝트 로컬 `.mason-report/events/*.jsonl`로 수집하는 Hook
  수집기(`scripts/capture-event.js`).
- 정규식/키 이름 기반 민감정보 마스킹(`scripts/redact.js`): API Key, Access/Bearer
  Token, Authorization/Cookie 헤더, 비밀번호, `.env` 관련 경로, PEM/Private Key,
  AWS/GitHub/Anthropic/OpenAI 토큰 패턴 등.
- 로그 조회 CLI(`scripts/read-events.js`)와 로그 회전(`scripts/rotate-logs.js`).
- `/mason-report:chat`, `/mason-report:all`, `/mason-report:status`
  Slash Command.
- `decision-analysis` Skill: observed/inferred/unknown 구분과 Skill/Rule 적용 여부
  4단계 증거 등급(confirmed/strongly-inferred/weakly-inferred/not-observed)을 정의.
- Node.js 내장 테스트 러너 기반 테스트(`tests/*.test.js`)와 매니페스트/스크립트
  검증 스크립트(`tests/validate.js`, `npm run validate`).
- 문서: `docs/architecture.md`, `docs/event-schema.md`, `docs/privacy.md`,
  `docs/limitations.md`, `examples/sample-report.md`.

### Known limitations

- 2026-09-06에 실제 Claude Code(v2.1.178, VS Code 확장)에 설치해 end-to-end 검증을
  완료했다(Hook 발화, 이벤트 기록, 마스킹, `sessionId`/`promptId` 상관관계, `/mason-report:status`
  실행까지 확인). 다만 `/reload-plugins`가 보고한 "1 error during load"의 정확한 원인은
  아직 확인하지 못했다. 또한 이 실측 과정에서 `promptId`의 최소 지원 버전에 대한 공식
  문서 기재(v2.1.196 이상)가 실제와 다르다는 것을 발견해 문서를 정정했다. 자세한 내용은
  `docs/limitations.md` 참고.
