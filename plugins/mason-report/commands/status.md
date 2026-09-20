---
description: mason-report 플러그인의 로그 수집 상태(위치, 최근 이벤트, 마스킹 적용 여부, 로그 크기 등)를 표시합니다.
allowed-tools: Bash
---

# 목표

이 프로젝트에서 mason-report가 실제로 로그를 수집하고 있는지, 어디에 저장하는지, 마스킹이
적용되고 있는지를 진단한다.

# 절차

1. 아래 명령을 실행한다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/read-events.js" status
   ```

2. 결과 JSON을 아래 형식으로 사람이 읽기 쉽게 정리해 출력한다. JSON에 없는 값을 추측해서
   채우지 않는다.

# 출력 형식

```markdown
# Mason Report Status

- 플러그인 활성화 여부: (이 명령이 실행되었다는 사실 자체가 플러그인이 로드되어 있음을 의미함)
- 로그 저장 위치: <logRoot>
- 최근 이벤트 시간: <lastEventTimestamp> (없으면 "아직 없음")
- 수집된 세션 수: <sessionCount>
- 마지막 이벤트 유형: <lastEventType>
- 마스킹 적용 여부: <maskingAppliedToEventCount>개 이벤트에서 총 <maskingTotalSubstitutions>건 마스킹됨
- 로그 크기: <eventsDirSizeBytes> bytes
- 지원되는 Hook 목록: <supportedHookEvents 나열>
- 진단 경고: <warnings 나열, 없으면 "없음">
```

`eventsDirExists`가 `false`이면, 아직 어떤 Hook 이벤트도 기록되지 않았다는 점(플러그인
설치/활성화 문제일 수도 있고, 단순히 아직 트리거되지 않았을 수도 있음)을 함께 설명한다.
