---
name: junior-code-comments
description: Write or revise this repository's TypeScript, Vue, API, database, and configuration code with Korean comments and readable structure that let junior developers follow dependencies, call flows, state lifecycles, constraints, failure behavior, and representative values. Use whenever implementation or review adds or changes application code, contracts, DTOs, constants, schemas, or migrations.
---

# Junior-Friendly Code Comments

코드를 처음 보는 주니어 개발자가 파일의 책임, 호출 흐름, 상태 변화와 값의 의미를 코드만 읽고 따라갈 수 있게 한다. 주석은 현재 동작과 함께 유지되는 설명이어야 하며 코드를 한국어로 그대로 번역하지 않는다.

이 skill은 주석만 추가하는 작업이 아니다. 여러 상태 변경이나 외부 호출을 한 줄에 압축한 코드는 먼저 읽기 쉬운 문장과 작은 함수로 풀고, 이름만으로 표현할 수 없는 정책과 수명주기를 주석으로 보완한다.

## 작성 순서

1. 수정할 파일의 호출자, 피호출자와 외부 자원(DB, 파일, Serial port, API)을 먼저 확인한다.
2. 변경 파일만 보지 말고 같은 workflow의 상태를 만들고 소비하는 인접 파일까지 읽어 수명주기를 파악한다.
3. class/module/component 위에는 책임과 의존 관계를 짧게 설명한다.
4. public 함수와 비직관적인 private 함수 위에는 호출 위치, 사용 목적, 성공 시 상태 변화와 주요 실패 조건을 설명한다.
5. domain 속성, DTO 속성, 환경설정, enum과 이름 있는 상수에는 목적과 대표값을 붙인다.
6. 보안, 원자성, 호환성, 비동기 정리 또는 장비 안전 때문에 필요한 분기에는 “왜”를 설명한다.
7. 구현을 마친 뒤 아래 완료 전 감사를 수행하고 누락된 설명, 오래된 주석, 코드와 모순되는 예시와 비밀정보를 정리한다.

## 변경 범위 감사

애플리케이션 코드를 추가하거나 수정한 작업에서는 다음 범위를 반드시 확인한다.

- 새 파일: 파일의 주 책임, 진입점, 외부 의존성과 종료·정리 경계를 설명한다.
- 수정한 public API: 호출자, 입력 제약, 성공 결과와 공개 실패를 설명한다.
- 수정한 workflow: 상태를 선언한 곳뿐 아니라 상태를 전환·소비·폐기하는 곳도 확인한다.
- 기존 코드: 이번 변경으로 의미가 달라진 주석을 고치고, 새 동작을 이해하는 데 직접 필요한 누락 주석은 같은 작업에서 보완한다.

요청 범위와 무관한 파일 전체에 주석을 대량 추가하지 않는다. 그러나 새 기능의 호출 흐름을 이해하는 데 필요한 인접 코드는 “수정 범위 밖”이라는 이유로 설명을 생략하지 않는다.

## 클래스, 모듈과 컴포넌트

class 위 JSDoc에는 다음을 2~4문장으로 적는다.

- 이 클래스가 담당하는 한 가지 책임
- 어떤 controller/service/repository가 호출하거나 주입하는지
- 주요 의존 대상과 데이터 흐름

```ts
/**
 * CatalogController가 전달한 등록 요청을 검증하고 DB 변경을 조정한다.
 * CatalogValidator와 CatalogRepository에 의존하며, 검증이 끝난 Bundle만 repository로 넘긴다.
 */
export class CatalogService {}
```

NestJS module에는 어떤 controller/provider를 조립하고 외부에 무엇을 제공하는지 설명한다. 단순 DTO나 이름만으로 책임이 완전히 드러나는 작은 type에는 억지로 클래스형 설명을 붙이지 않는다.

Vue component의 `<script setup>`에는 별도 class가 없으므로, 복잡한 화면이면 상태 소유권과 자원 정리 시점을 상태 선언부 또는 핵심 함수 위에서 설명한다. 단순 presentational component에는 억지로 파일 머리말 주석을 붙이지 않는다.

## 함수와 메서드

함수 위 JSDoc은 “어디에서, 왜 호출하는가”로 시작한다. 입력·반환값을 이름만 반복하지 말고 다음 중 해당하는 내용을 적는다.

- 실제 호출자 또는 실행 시점
- 성공 시 만들어지는 상태 변화
- validation, transaction, timeout 같은 중요한 제약
- 호출자가 처리해야 하는 공개 오류

```ts
/**
 * CatalogController의 PUT 요청에서 호출해 기존 revision과 일치할 때만 정의를 교체한다.
 * 동시 수정이 감지되면 CATALOG_REVISION_CONFLICT를 발생시켜 덮어쓰기를 막는다.
 */
async updateCatalog(...) {}
```

테스트 함수, 단순 getter, 한 줄 변환처럼 사용처와 동작이 자명한 함수는 주석을 생략할 수 있다. 대신 이름을 더 명확하게 고친다.

다음 함수는 이름이 명확해도 주석을 생략하지 않는다.

- API 요청, DB transaction, 파일 이동·삭제 또는 Serial 연결을 시작하는 함수
- job, timer, AbortSignal, polling, modal, route 이탈처럼 비동기 수명주기를 바꾸는 함수
- 성공 전에 일부 상태가 변경되거나 실패 시 원복·유지가 필요한 함수
- 인증·소유권·revision·digest·allowlist를 검사하는 함수

주석에는 정상 경로만 적지 않는다. 예를 들어 재검토 실패 시 이전 proposal을 유지하거나, provider 파일 삭제 실패가 local 정리를 막지 않는다면 그 정책과 이유를 함께 적는다.

## 비동기 상태와 자원 수명주기

Frontend와 Backend에 걸친 비동기 workflow는 다음 질문에 코드와 주석이 답할 수 있어야 한다.

- 상태를 누가 생성하고 어떤 식별자로 소유하는가?
- 성공, 실패, 사용자 취소, timeout과 화면 이탈 때 무엇이 유지되거나 폐기되는가?
- DB 감사 기록, local 임시 파일, provider 파일처럼 수명이 다른 자원은 각각 누가 정리하는가?
- best-effort 정리와 반드시 성공해야 하는 정리의 차이는 무엇인가?
- 재시도나 polling이 중복 실행 또는 중복 쓰기를 만들지 않는 근거는 무엇인가?

이 설명은 한 파일에 장문으로 몰지 않는다. 각 책임을 실제로 수행하는 함수와 상태 선언 가까이에 배치한다.

## 속성, 상수와 enum

공개 계약, DTO, DB row type, 설정 객체, domain object와 중요한 상수는 가능한 한 선언 오른쪽에 한 줄 주석을 둔다. 주석에는 목적과 대표값을 함께 적는다.

```ts
readonly catalogKey: string // URL과 참조에 쓰는 안정 ID. 예: "example-temperature-sensor"
readonly revision: number   // 낙관적 잠금에 쓰는 증가 번호. 예: 3
const MAX_TITLE_LENGTH = 160 // DB/API가 허용하는 제목 최대 길이. 예: 160자
```

- 예시값은 공개 가능한 합성값이나 `example.com`만 사용한다.
- secret, token, 실제 이메일·도메인·장비 식별자·내부 경로는 예시에 넣지 않는다.
- boolean에는 `true`가 뜻하는 상태를, timestamp에는 형식과 기준 timezone을 명시한다.
- enum member에는 이름만으로 업무 의미가 충분하지 않을 때 상태가 선택되는 조건을 적는다.
- 짧은 inline 주석이 지나치게 길어지면 해당 선언 바로 위 JSDoc으로 옮긴다.

## 반드시 이유를 설명할 경계

- Browser Web Serial과 Backend 영속화의 책임 분리
- 입력 길이/range/allowlist 및 JSON Schema 제한
- 인증, Origin 검사, 비밀값 비노출과 공개 오류 변환
- transaction, revision, soft-disable과 원자적 교체
- 장비 write, 재연결, 취소와 자동 재실행 금지
- DB JSON이나 adapter ID를 코드로 실행하지 않는 이유
- AI job, 임시 session, provider file과 감사 DB처럼 서로 다른 수명의 자원 정리
- 화면 이탈, 새로고침, timeout과 AbortSignal에서 보장되는 동작과 best-effort 동작의 차이
- 실패 시 이전 사용자 입력·검토 결과를 유지하거나 폐기하는 정책

## 읽기 쉬운 코드 형태

- 상태 전환, 외부 호출, 오류 처리를 세미콜론으로 연결한 한 줄에 함께 쓰지 않는다.
- 서로 다른 책임의 선언을 한 줄에 몰아넣지 않는다. 관련 상태는 가까이 두되 각 선언의 목적이 보이게 줄을 나눈다.
- `if` 한 줄 반환은 조건과 결과가 자명할 때만 허용한다. 소유권, 정리, 보상 처리와 상태 변경 분기는 블록으로 작성한다.
- 주석이 없으면 이해하기 어려운 긴 함수는 먼저 단계별 private 함수나 의미 있는 지역 함수로 나눈다.
- 추출한 함수가 단순 위임만 늘린다면 추상화하지 말고 현재 함수 안에서 단계와 정책을 명확히 표현한다.

## 피해야 할 주석

- `값을 증가시킨다`, `목록을 반환한다`처럼 코드를 그대로 읽는 설명
- 아직 구현하지 않은 동작을 현재 동작처럼 서술하는 주석
- 변경 이력, 대화 내용, 임시 디버깅 메모와 TODO만 남기는 주석
- 타입 오류를 감추거나 복잡한 코드를 정당화하기 위한 장문 설명
- 실제 credential, 운영 주소, 사용자 개인정보가 포함된 예시

주석이 길어야만 이해되는 구현은 먼저 함수·이름·책임을 단순화한다. 주석은 단순한 구조가 표현하지 못하는 목적과 제약을 보완한다.

## 완료 전 체크리스트

애플리케이션 코드 변경을 완료했다고 보고하기 전에 다음을 확인한다.

- [ ] 새 class/module/component의 책임과 호출 시작점이 드러난다.
- [ ] 새 public 함수와 중요한 비동기 함수에 호출자, 상태 변화와 실패 정책이 설명돼 있다.
- [ ] 공개 타입, DTO, 설정, 상수의 목적과 제약 또는 대표값이 드러난다.
- [ ] 취소·timeout·화면 이탈·부분 실패 때 자원과 사용자 상태가 어떻게 되는지 설명돼 있다.
- [ ] 보안·소유권·검증·원자성 분기에 “왜 필요한지”가 적혀 있다.
- [ ] 여러 문장을 한 줄에 압축한 비직관적인 코드가 남아 있지 않다.
- [ ] 코드와 모순되는 오래된 주석, 임시 메모와 민감한 예시가 없다.
- [ ] typecheck와 관련 테스트가 주석 보강 과정의 구조 변경에도 통과한다.
