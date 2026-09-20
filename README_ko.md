# mason-report (한국어)

English version: [README.md](./README.md)

`mason-report`는 Claude Code의 실행 과정을 **공식 Hook**을 통해 관찰하고, 그 관찰
증거만으로 "Claude가 이번 요청을 어떻게 처리했는지"를 재구성하는 오픈소스 Claude Code
Plugin입니다. 별도 서버나 외부 LLM 호출 없이, 이미 설치된 Claude Code 자신이 로그를 읽고
분석 리포트를 작성합니다.

---

## 시작하기

### 요구 사항

- Claude Code (Plugin/Marketplace/Hooks 기능을 지원하는 버전 — [지원 Claude Code 버전](#지원-claude-code-버전) 참고)
- Node.js 18 이상 (Hook/조회 스크립트가 Node.js로 작성되어 있으며, 별도 설치 없이
  실행됩니다)
- macOS, Linux, 또는 Windows

다른 것을 시도하기 전에 먼저 `claude`가 실제로 실행되는지부터 확인해 주세요.

```bash
claude --version
```

`2.1.178 (Claude Code)`처럼 실제 버전 문자열이 출력되어야 합니다. `nvm`으로 여러 Node
버전을 쓰시는 경우, 버전마다 `@anthropic-ai/claude-code`의 전역 npm 설치가 따로
존재합니다 — 설치가 불완전하면 "claude native binary not installed" 에러를 내는
placeholder 스크립트만 남거나, 실행 권한이 없어 `permission denied`가 날 수 있습니다.
이런 경우 `nvm use <정상 설치된 버전>`으로 전환하고(`nvm alias default <그 버전>`으로
아예 기본값을 바꿔두면 매번 반복하지 않아도 됩니다), 그래도 안 되면 깨끗하게 재설치해
주세요.

```bash
npm install -g @anthropic-ai/claude-code
```

### 설치 방법

**어디서 Claude Code를 실행 중이냐에 따라 입력하는 명령이 달라집니다.** 여기서 가장
많이 헷갈리므로 아래 표를 먼저 읽어봐 주세요.

| Claude Code를 실행 중인 곳 | 입력할 명령 | 입력하는 위치 |
|---|---|---|
| 일반 터미널 셸, Claude Code가 아직 인터랙티브로 실행 중이 아님 | `claude plugin marketplace add fe-hyunsu/mason-report` 실행 후 `claude plugin install mason-report@mason` | 셸 프롬프트에 그대로 — **앞에 `/`를 붙이지 않습니다.** `claude` 바이너리의 일반 CLI 서브커맨드이지 슬래시 명령이 아니라서, 평범한 셸이 그대로 이해합니다. |
| 인터랙티브 터미널 REPL(이미 `claude`를 실행해서 그 자체 프롬프트 안에 들어가 있는 상태) | `/plugin marketplace add fe-hyunsu/mason-report` 실행 후 `/plugin install mason-report@mason` | 그 세션 자체의 입력창 안에서 입력합니다. |
| VS Code 확장 | `/plugins` (**복수형** — 단수형 `/plugin`은 이 환경에서 지원되지 않습니다) | 채팅 입력창에 — GUI 다이얼로그가 열리고 거기서 마켓플레이스 추가/설치를 진행합니다. |
| 인터랙티브 UI 자체가 없는 환경(클라우드 세션, headless/CI) | `.claude/settings.json`에 선언 (아래 참고) | 명령을 타이핑하는 게 아니라 설정 파일에 적어둡니다. |

#### 단계별 안내 (셸 명령 — 거의 모든 곳에서 동작, 권장)

1. Claude Code가 정상 동작하는지 먼저 확인해 주세요([요구 사항](#요구-사항) 참고): `claude --version`

2. 마켓플레이스를 추가하고 플러그인을 설치합니다.
   ```bash
   claude plugin marketplace add fe-hyunsu/mason-report
   claude plugin install mason-report@mason
   ```
   `@` 앞은 **플러그인 이름**(`mason-report`), `@` 뒤는 **마켓플레이스 이름**(`mason`)
   입니다. 이 저장소는 플러그인을 하나만 담고 있는 마켓플레이스지만, 두 이름은 서로
   별개의 식별자입니다 — 같은 문자열이 아닙니다.

3. **이미 열려 있는 세션에 반영합니다.** 셸 레벨 설치는 이미 실행 중이던 Claude Code
   세션(예: 명령 실행 전부터 열려 있던 VS Code 채팅창)에 자동으로 반영되지 않습니다.
   그 세션 안에서 아래를 실행해 주세요.
   ```
   /reload-plugins
   ```
   설치 **이후에** 새로 시작한 세션은 별도 조치 없이 자동으로 플러그인을 불러옵니다.

4. **실제로 활성화됐는지 확인합니다.**
   ```
   /mason-report:status
   ```
   "unknown command"가 아니라 실제 상태 리포트가 나오면 활성화된 것입니다.

#### 새 버전으로 업데이트하기

`plugin.json`의 `version` 필드가 플러그인을 고정시키기 때문에, 이 저장소에 `git push`가
되더라도 **이미 설치된 쪽에는 자동으로 반영되지 않습니다** — 그 버전 문자열이 실제로
바뀌었을 때만, 그리고 명시적으로 새로고침을 해야만 업데이트를 받습니다.

```bash
claude plugin marketplace update mason
claude plugin uninstall mason-report@mason
claude plugin install mason-report@mason
```

(단순 재설치는 "already installed"만 뜨고 끝날 수 있어서, uninstall 후 install로 깨끗하게
다시 설치하는 게 가장 확실합니다.) 그다음 이미 열려 있는 세션에서는 `/reload-plugins`.

#### 대안: `.claude/settings.json`에 직접 선언 (인터랙티브 단계 불필요)

팀 단위 설정이나, 인터랙티브 UI가 전혀 없는 환경에 유용합니다.

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

#### 아무 곳에도 배포하지 않고 로컬에서만 테스트하기

```bash
claude plugin marketplace add ./path/to/mason-report
claude plugin install mason-report@mason
```
(위 표의 셸 vs REPL vs VS Code 구분은 이 경우에도 동일하게 적용됩니다)

### 사용 방법

**`/mason-report:latest`** — 가장 최근에 완료된 사용자 턴(들)을 관찰 증거만으로
재구성한 리포트를 생성합니다. 숫자를 인자로 줄 수 있습니다 — 인자가 없으면 최근 1턴,
숫자를 주면 그 개수만큼의 최근 턴을 보여줍니다.

```text
/mason-report:latest
/mason-report:latest 3
```

각 턴의 리포트는 두 부분으로 구성됩니다: 실제로 일어난 일을 시간순 불릿으로 간결하게
서술한 부분(`observed`/`inferred`/`unknown` 태그 포함), 그리고 프롬프트의 어떤 문구가
어떤 Skill/지침(Rule)/Tool을 유발한 것으로 보이는지를 증거 등급
(확인됨/강한 추정/약한 추정/관찰 안 됨)과 참고용 수치(%)
와 함께 보여주는 별도의 **"프롬프트 문구 → 트리거 매핑" 표**입니다. 이 %는 항상 등급
이름과 함께 표시되며 — mason-report는 Claude의 내부 판단 확률에 접근하지 않으므로,
실측 확률이 아니라 4단계 등급을 시각화한 참고용 수치일 뿐입니다. `/mason-report:latest`(또는
`/mason-report:select`/`/mason-report:all`) 자신을 호출한 턴은 분석 대상 턴 개수에 절대
포함되지 않습니다.

출력 형식과 예시는 [examples/sample-report.md](./examples/sample-report.md)를 참고해 주세요.

**`/mason-report:select`** — 항상 가장 최근 턴만 보는 대신, 과거의 특정 프롬프트를
직접 골라 분석하고 싶을 때 사용합니다. 최근 입력한 프롬프트들을 Claude Code의
`AskUserQuestion` Tool로 선택지처럼 보여주고, 고른 프롬프트에 대해 동일한 단일 턴
리포트를 생성합니다. 숫자를 인자로 주면 후보로 보여줄 최근 프롬프트 개수를 조절할 수
있습니다(기본값 20). 후보가 4개를 넘으면 한 번에 3개씩 보여주고, "이전 프롬프트 더
보기" 선택지로 계속 넘겨볼 수 있습니다.

```text
/mason-report:select
/mason-report:select 50
```

**`/mason-report:all`** — 현재 세션 전체(턴 목록, Tool 사용 패턴, 실패,
로드된 지침, Skill 적용 추정 등)를 요약합니다.

```text
/mason-report:all
```

**`/mason-report:status`** — 로그 수집 상태(위치, 최근 이벤트, 세션 수, 마스킹 적용
여부, 로그 크기, 지원 Hook 목록, 진단 경고)를 표시합니다.

```text
/mason-report:status
```

### 로그

```text
<project-root>/.mason-report/
├── events/    # Hook 이벤트 JSONL
├── reports/   # (예약됨 — 향후 리포트 저장용)
├── state/     # 내부 상태(예: .gitignore 보강 여부 마커)
└── config.json  # (예약됨 — 향후 설정용)
```

플러그인 설치 디렉터리나 플러그인 캐시에는 어떤 로그도 저장하지 않습니다. 프로젝트
루트를 안전하게 확인할 수 없는 경우(`CLAUDE_PROJECT_DIR`도 없고 Hook의 `cwd`도 유효한
디렉터리가 아닌 경우) 아무 곳에도 기록하지 않습니다.

프로젝트의 모든 로그를 지우려면:

```bash
rm -rf .mason-report/
```

위 명령은 사용자가 자신의 프로젝트에서 직접 실행하는 일반적인 파일 삭제이며,
`mason-report`는 자체적으로 원격 삭제나 별도 삭제 API를 제공하지 않습니다.

---

## 프로젝트 상세

### 무엇을, 왜 만들었는지

`mason-report`는 Claude Code의 실행 과정을 **공식 Hook**을 통해 관찰하고, 그 관찰
증거만으로 "Claude가 이번 요청을 어떻게 처리했는지"를 재구성하는 오픈소스 Claude Code
Plugin입니다. 별도 서버나 외부 LLM 호출 없이, 이미 설치된 Claude Code 자신이 로그를 읽고
분석 리포트를 작성합니다.

Claude Code는 하나의 요청을 처리하면서 여러 Tool을 호출하고, 파일을 읽거나 수정하고,
때로는 Subagent를 실행합니다. 이 과정은 대화창에서 지나가듯 스쳐 사라지고, "왜 이런
선택을 했는지", "실제로 어떤 파일들을 건드렸는지", "어떤 지침이 적용됐는지"를 나중에
정확히 재구성하기 어렵습니다. `mason-report`는 이 실행 과정의 **관찰 가능한 부분**을
로컬에 기록하고, 나중에 그 기록만으로 사실과 추정을 구분해 설명해주는 도구입니다.

### 확인할 수 있는 정보

- 사용자가 입력한 프롬프트(마스킹·길이 제한 적용)
- 세션/프롬프트 식별자
- 로드된 `CLAUDE.md` 등 지침 파일의 **경로**
- 호출된 Tool 이름과 최소한의 입력 요약(예: Bash 명령, 파일 경로)
- Tool 실행 결과의 안전한 요약(성공/실패, 마스킹·길이 제한된 텍스트 또는 구조 요약)
- 읽거나 수정한 파일 **경로**
- 실행된 Bash 명령(마스킹 적용)
- Subagent 실행 흔적(유형, 식별자)
- Claude의 최종 답변(마스킹·길이 제한 적용)
- 위 사실들을 바탕으로 재구성한, "observed/inferred/unknown"으로 구분된 판단 근거
- 프롬프트 문구 → 트리거 매핑 표(증거 등급 + 등급별 참고용 수치(%) — 실측 확률 아님, 아래 참고)

### 확인할 수 없는 정보

- Claude의 비공개 chain-of-thought, 모델 내부 후보 비교 과정
- 로그에 기록되지 않은 판단 이유(추정은 가능하나 확정할 수 없음)
- 판단 뒤에 있는 실측 확신 확률 — Hook에는 그런 값 자체가 없습니다. 리포트에 보이는 %는
  4단계 증거 등급을 시각화한 참고용 수치일 뿐이며, 항상 등급 이름과 함께 표시됩니다
- 파일의 전체 내용, 원본 diff, Tool 결과 원문 전체(정책상 저장하지 않음)
- Skill 파일이 컨텍스트에 로드된 것과 실제로 그 Skill의 절차가 적용됐는지의 완전한 구분
  (증거 등급으로만 추정 가능)

자세한 한계는 [docs/limitations.md](./docs/limitations.md)를 참고해 주세요.

**mason-report는 Claude의 비공개 내부 추론을 추출하거나 우회 노출하는 도구가 아닙니다.**
모든 분석은 Hook과 transcript에서 공식적으로 노출되는 관찰 가능한 사실에만 근거하며,
리포트는 "Claude가 이렇게 생각했다"라고 단정하지 않고 "관찰된 행동을 보면 이렇게 판단한
것으로 추정된다"는 식으로만 서술하도록 설계되어 있습니다(`skills/decision-analysis/SKILL.md`
참고).

### 동작 구조

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

자세한 내용은 [docs/architecture.md](./docs/architecture.md)를 참고해 주세요.

### 수집되는 Hook 이벤트

공식 문서(`code.claude.com/docs/en/hooks.md`)에서 현재 지원을 확인한 아래 10개 이벤트만
사용합니다:

`SessionStart`, `UserPromptSubmit`, `InstructionsLoaded`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`

이벤트별로 저장되는 정확한 필드는 [docs/event-schema.md](./docs/event-schema.md)에
정의되어 있습니다. **Hook은 어떤 경우에도 Tool 호출을 차단하거나, Claude/Tool의 입력을
수정하거나, stdout으로 무언가를 출력하지 않습니다** — 순수 관찰자로만 동작합니다.

### 개인정보 및 보안 정책

- 기본적으로 **네트워크를 사용하지 않습니다.**
- 파일 내용은 저장하지 않고 경로와 작업 유형만 저장합니다(`.env` 포함).
- API Key, Access/Bearer Token, Authorization/Cookie 헤더, 비밀번호, PEM/Private Key,
  AWS/GitHub/Anthropic/OpenAI 토큰 등은 저장 전에 마스킹됩니다.
- Tool 결과는 원문 전체가 아닌 안전한 요약만, 크기 제한을 두어 저장합니다.
- 로그 크기와 보관 개수를 제한합니다(파일당 약 5MB, 프로젝트당 파일 개수 제한).
- `.mason-report/`가 프로젝트 외부를 가리키는 심볼릭 링크이면 쓰기를 거부합니다.
- `.gitignore`에 `.mason-report/`가 없으면 기존 내용을 보존한 채로만 안전하게 추가합니다.
- Hook 실패나 분석 실패가 Claude Code의 정상 작업을 절대 막지 않습니다.

자세한 내용은 [docs/privacy.md](./docs/privacy.md)를 참고해 주세요.

### 지원 Claude Code 버전

이 플러그인은 공식 문서(`code.claude.com/docs/en/`)에서 현재 확인 가능한 Plugin /
Marketplace / Hooks / Skill 규격을 기준으로 작성했습니다.

**2026-09-06에 실제 Claude Code(v2.1.178, VS Code 확장 + Agent SDK 백엔드)에 이 플러그인을
`claude plugin marketplace add` / `claude plugin install`로 설치하고, `/reload-plugins`
후 `/mason-report:status`를 실행해 end-to-end로 검증했습니다.** `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse` 이벤트가 실제로 `.mason-report/events/`에
정상 기록됐고, `sessionId`/`promptId` 상관관계, 마스킹 파이프라인, 프로젝트 상대경로 변환이
모두 실제 로그에서 확인됐습니다.

- Plugin/Marketplace/Hooks/Skill 기본 구조: 문서상으로도, 실제 설치·로드로도 확인됐습니다.
- `prompt_id`(턴 연결에 사용) — 공식 문서는 "v2.1.196 이상 필요"라고 적고 있으나, **실제
  v2.1.178에서 정상적으로 채워지는 것을 확인했습니다.** 즉 이 최소 버전 요구사항은 문서와
  실측이 어긋납니다 — 정확한 최소 버전은 unknown으로 남겨둡니다. `promptId`가 비어 있는
  경우를 대비한 시간 구간 기반 폴백은 계속 유지됩니다.
- `UserPromptSubmit`의 프롬프트 텍스트 필드명(`prompt`)은 실제 로그에서 정상적으로
  채워지는 것을 확인했습니다(자세한 내용은 [docs/event-schema.md](./docs/event-schema.md)).
- `/reload-plugins` 실행 시 처음엔 "1 error during load"가 원인 불명으로 보고됐습니다.
  **v0.1.2에서 원인을 찾아 수정했습니다**: `plugin.json`에 `"hooks": "./hooks/hooks.json"`을
  명시적으로 선언해뒀는데, 이 경로는 Claude Code가 기본적으로 자동 로드하는 표준 위치라서
  또 명시하면 "같은 파일이 중복 로드된다"고 판단해 플러그인 로드 자체를 실패시켰습니다
  (`Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file
  .../hooks/hooks.json`). 수정은 `plugin.json`에서 불필요한 `hooks` 필드를 제거하는
  것으로 충분했고, `tests/validate.js`에 이 실수를 다시 잡아내는 회귀 테스트를 추가했습니다.

`/mason-report:status`로 실제 환경에서 이벤트가 정상적으로 수집되는지 직접 확인해
보시길 권장합니다.

### 알려진 한계

[docs/limitations.md](./docs/limitations.md)에 전체 목록이 있습니다. 핵심 요약은
다음과 같습니다.

- chain-of-thought/모델 내부 후보 비교 과정은 원천적으로 접근할 수 없습니다.
- 파일 접근/지침 로드가 "실제 적용"을 의미하지는 않습니다.
- Observer(리포트 생성 과정)도 Claude의 해석이므로 오류가 있을 수 있습니다.
- 마스킹은 알려진 패턴 기반이라 완전하지 않습니다.
- 실제 Claude Code 프로세스를 통한 end-to-end 검증은 완료했습니다(위 [지원 Claude Code 버전](#지원-claude-code-버전) 참고).
  이 과정에서 처음 발견된 "1 error during load"는 `plugin.json`의 불필요한 `hooks` 필드
  중복 선언이 원인이었고, v0.1.2에서 수정했습니다.

### GitHub에 자신의 마켓플레이스 배포하기

이 플러그인을 fork하거나 직접 유지보수하시는 경우:

1. 이 저장소를 GitHub에 **public** 저장소로 push합니다(`.claude-plugin/marketplace.json`이
   저장소 루트에 있어야 합니다).
2. `.claude-plugin/marketplace.json`의 `name`, `owner.name`, 각 플러그인 항목의
   `author`/`homepage`/`repository`, 그리고 `plugins/mason-report/.claude-plugin/plugin.json`의
   해당 필드들을 자신의 값으로 교체합니다.
3. 태그를 눌러 버전을 명시적으로 관리합니다([릴리스 체크리스트](#릴리스-체크리스트-태그-기반-버전-관리) 참고).

### 개발 및 테스트 방법

```bash
git clone https://github.com/fe-hyunsu/mason-report.git
cd mason-report

npm test        # Node.js 내장 테스트 러너로 단위/통합 테스트 실행
npm run validate # 매니페스트/hooks.json/Command·Skill frontmatter/스크립트 문법 검사 + 테스트 실행
```

외부 의존성 없이 Node.js 표준 라이브러리와 `node:test`만 사용합니다.

### 기여 방법

1. 이슈를 먼저 열어 논의해 주세요(특히 Hook 이벤트 추가나 마스킹 규칙 변경처럼 개인정보에
   영향을 주는 변경).
2. 이 저장소를 fork하고 브랜치를 만들어 주세요.
3. `npm run validate`가 통과하는지 확인한 뒤 PR을 열어 주세요.
4. 마스킹 규칙을 추가/변경하는 PR은 반드시 대응하는 테스트(`tests/redact.test.js`)를
   포함해야 합니다.
5. 보안 취약점은 공개 이슈 대신 저장소 owner에게 비공개로 먼저 알려주시길 권장합니다
   (연락 방법은 `fe-hyunsu`의 GitHub 프로필을 참고해 주세요 — 저장소 공개 시 구체적인
   보안 연락처를 이 절에 채워 넣을 예정입니다).

#### 릴리스 체크리스트 (태그 기반 버전 관리)

- [ ] `npm test`, `npm run validate` 통과
- [ ] `CHANGELOG.md`에 변경 사항 기록
- [ ] `.claude-plugin/marketplace.json`과 `plugins/mason-report/.claude-plugin/plugin.json`의
      `version` 필드를 함께 올림
- [ ] `git tag vX.Y.Z` 후 push (Marketplace의 `github` source 타입은 `ref`로 특정
      태그/브랜치를 고정할 수 있습니다)

### 라이선스

[MIT License](./LICENSE)
