# Privacy

## 수집 대상

`.mason-report/events/`에 저장되는 것은 아래뿐이다(전체 필드 목록은
[event-schema.md](./event-schema.md) 참고):

- 사용자 프롬프트 텍스트(마스킹 + 길이 제한 적용)
- 세션/프롬프트 식별자, 타임스탬프, 작업 디렉터리
- 로드된 지침 파일의 **경로**(내용 아님)
- 호출된 Tool 이름과, Tool별 allowlist에 정의된 최소한의 입력 요약(예: Bash 명령어 —
  마스킹 적용, 파일 경로 — 내용 아님)
- Tool 실행 결과의 **안전한 요약**(파일 관련 Tool은 아예 저장하지 않음, 그 외에는
  마스킹 + 최대 500~800자로 제한된 텍스트, 또는 값 없이 구조만 남긴 shape summary)
- Subagent 식별자/유형
- `Stop`/`SubagentStop`의 최종 응답 텍스트(마스킹 + 길이 제한)

## 수집하지 않는 것

- 파일의 전체 내용(읽기·쓰기·수정 모두 경로와 작업 유형만 기록)
- `.env` 파일 내용(경로 자체는 `isDotEnv` 플래그로만 표시될 수 있음)
- Claude의 비공개 chain-of-thought, 모델 내부 후보 비교 과정
- Tool 실행 결과의 원문 전체
- 사용자의 다른 개인정보(이 플러그인이 별도로 요청하거나 조회하지 않음)

## 마스킹

`scripts/redact.js`가 저장 직전에 다음을 마스킹한다(정규식 + 키 이름 기반, 외부
라이브러리 없이 Node.js 표준 기능만 사용):

- Anthropic API Key(`sk-ant-...`), OpenAI 스타일 키(`sk-...`)
- GitHub Token(`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`)
- Slack Token(`xox[baprs]-...`), Google API Key(`AIza...`), Google OAuth Token(`ya29....`)
- AWS Access Key ID(`AKIA...`), AWS `aws_secret_access_key`
- JWT(`eyJ...eyJ...` 형태)
- `Authorization`/`Cookie` 헤더, `Bearer` 토큰
- PEM/Private Key 블록
- JSON 형태의 `password`/`secret`/`api_key`/`token` 등 필드
- Bash 스타일 환경변수 대입(`TOKEN=...`, `export API_KEY=...`, `DB_PASSWORD=...` 등)
- 키 이름 자체가 민감해 보이면(`password`, `token`, `secret`, `authorization`, `cookie`,
  `credential` 등을 포함) 값의 형태와 무관하게 통째로 마스킹

마스킹은 정규식 기반이므로 **완전하지 않다**. 알려지지 않은 형식의 시크릿, 일반 텍스트
안에 자연스럽게 섞인 값 등은 놓칠 수 있다. 이는 한계로 [limitations.md](./limitations.md)에
명시한다.

## 보관 위치

전부 `<project-root>/.mason-report/` 아래에만 저장된다. 플러그인 설치 디렉터리나 플러그인
캐시, 홈 디렉터리, 다른 프로젝트 등 어디에도 쓰지 않는다. 프로젝트 루트를 안전하게
확인할 수 없으면(`CLAUDE_PROJECT_DIR`도 없고 Hook 입력의 `cwd`도 유효한 디렉터리가
아니면) 아무 데도 쓰지 않고 조용히 건너뛴다(디버그 로그만 stderr에 남김).

`.mason-report/`가 심볼릭 링크이고 그 링크가 프로젝트 루트 밖을 가리키는 경우, 수집기는
쓰기를 거부한다(프로젝트 외부로 우회 기록되는 것을 방지).

## 삭제 방법

`.mason-report/` 디렉터리를 통째로 지우면 모든 로그가 삭제된다. 별도의 삭제 명령이나
API는 제공하지 않는다(로컬 파일 시스템 조작만으로 충분하기 때문).

## 외부 전송

이 플러그인은 **네트워크 호출을 하지 않는다.** Hook 스크립트와 조회 스크립트 모두
로컬 파일 시스템 I/O만 수행한다. 외부 서버, 원격 API, 업로드 기능은 MVP에 존재하지 않는다.

## 보관 개수/크기 제한

- 이벤트 파일 하나가 약 5MB를 넘으면 회전(rotate)되어 별도 파일로 보관된다.
- 프로젝트당 이벤트 파일 총 개수가 일정 개수를 넘으면 가장 오래된 파일부터 삭제된다.
- Hook 입력 자체가 비정상적으로 크면(2MB 초과) 그 이벤트는 아예 저장하지 않는다.

## 보안 한계

- 이 플러그인은 로그 파일 자체에 대한 암호화나 OS 수준 접근 제어를 제공하지 않는다.
  `.mason-report/`는 일반 파일 시스템 권한을 따른다.
- 마스킹은 알려진 패턴 기반이라 새로운 형태의 시크릿을 놓칠 수 있다.
- 여러 Hook이 동시에 실행되는 경우, JSONL append는 각 write 호출 단위로는 안전하지만
  파일 시스템/환경에 따라 완전한 무결성을 보장하지 않을 수 있다.
