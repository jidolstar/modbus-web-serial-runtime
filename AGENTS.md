# Repository Instructions

작업을 시작하기 전에 [README.md](README.md)를 읽고 프로젝트의 목적, 책임 경계, 현재 구현 범위를 확인한다. 하위 디렉터리에 별도 `AGENTS.md`가 있으면 해당 범위에서는 더 가까운 지침을 함께 적용한다.

## 개발 원칙

- 이 프로젝트는 Web Serial 기반 Modbus 장비 실행과 장비 관리 기반을 제공한다. 요청받지 않은 범용 플랫폼, 프레임워크, 추상화로 범위를 넓히지 않는다.
- 현재 문제를 해결하는 가장 짧고 명확한 구현을 우선한다. 미래 가능성만을 위한 계층, 옵션, dependency, 설정값은 추가하지 않는다.
- 짧다는 이유로 책임 경계나 입력 검증을 생략하지 않는다. 같은 규칙이 반복될 때만 작은 함수나 객체로 추출한다.
- 기존 Profile/Recipe 구조로 해결할 수 있는 장비 차이는 데이터로 표현한다. 실행 엔진에 없는 프로토콜 능력이 실제로 필요할 때만 TypeScript 엔진을 확장한다.
- Frontend는 Web Serial/Modbus 실행을 담당하고 Backend는 인증, 권한, 영속화와 관리 API를 담당한다. Backend가 브라우저의 USB 장치를 직접 제어하지 않는다.
- 수정 범위 밖의 사용자 코드와 설정을 건드리지 않는다. 기존 동작을 유지하는 최소 변경을 선호한다.

## 코드 작성

- 함수와 클래스는 한 가지 책임을 갖게 하고 public API를 작게 유지한다.
- 상태와 외부 자원은 캡슐화하되, 단순 변환을 불필요한 클래스로 감싸지 않는다.
- protocol 고정값은 이름 있는 상수, 유한 상태는 enum 또는 명시적 상수 집합, 배포별 공개 설정은 검증된 환경변수, 장비별 값은 Profile/Recipe에 둔다.
- 변수와 상수 이름으로 목적이 드러나게 한다. public contract, 중요한 상수·상태, 비직관적인 제약에는 주니어 개발자가 이유를 이해할 수 있는 짧은 주석을 작성한다. 코드를 그대로 읽는 장황한 주석은 피한다.
- `any`, unchecked type assertion, raw SQL, 임의 JSON 실행, `eval`을 사용하지 않는다.
- 새 dependency는 표준 API나 현재 dependency로 명확히 해결할 수 없을 때만 추가한다.

## 검증

- 변경한 영역의 typecheck, test, build를 실행한다. 실제 장비가 필요한 검증은 자동화 가능한 부분과 사용자 확인이 필요한 부분을 구분해 알린다.
- 비동기 Serial 코드는 사용자 해제, 물리 분리, timeout, 재연결과 이전 작업의 취소를 함께 검토한다.
- 인증, API, DB, 환경설정 작업에는 `.agents/skills/app-security-policy`를 적용한다.
- commit 메시지는 `.agents/skills/commit-message-writer`를 적용해 변경 내용과 이유를 간결하고 안전하게 기록한다.
- commit 또는 push 전에는 `.agents/skills/secure-git-push`를 적용하고 제공된 검사 스크립트를 실행한다.

## 저장소와 보안

- 실제 `.env`, credential, token, key, 회사 도메인, 내부 문서와 장비 원문을 커밋하지 않는다.
- `_doc`, `_plan`, `_temp`, `temp`, `tmp`, `.codex`는 로컬 전용이다.
- 공개 예제에는 `example.com`과 명백한 placeholder만 사용한다.
- 비밀정보가 Git history에 들어갔다면 파일 삭제만으로 해결됐다고 판단하지 않는다. 값을 노출하지 말고 즉시 작업을 멈춰 폐기·교체와 history 처리 여부를 알린다.

## 작업 완료 보고

완료 결과, 핵심 변경 파일, 수행한 검증, 남은 실제 장비 또는 운영 확인만 간결하게 보고한다. 요청하지 않은 후속 기능을 구현하지 않는다.
