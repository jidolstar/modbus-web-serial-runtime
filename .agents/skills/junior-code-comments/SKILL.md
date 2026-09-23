---
name: junior-code-comments
description: Write or revise this repository's TypeScript, Vue, API, database, and configuration code with Korean comments that explain dependencies, call sites, domain purpose, constraints, and representative values for junior developers. Use whenever implementation or review adds or changes application code, contracts, DTOs, constants, schemas, or migrations.
---

# Junior-Friendly Code Comments

코드를 처음 보는 주니어 개발자가 파일의 책임, 호출 흐름과 값의 의미를 코드만 읽고 따라갈 수 있게 한다. 주석은 현재 동작과 함께 유지되는 설명이어야 하며 코드를 한국어로 그대로 번역하지 않는다.

## 작성 순서

1. 수정할 파일의 호출자와 의존 대상을 먼저 확인한다.
2. class/module 위에는 책임과 의존 관계를 짧게 설명한다.
3. public 함수와 비직관적인 private 함수 위에는 호출 위치, 사용 목적, 주요 실패 조건을 설명한다.
4. domain 속성, DTO 속성, 환경설정, enum과 이름 있는 상수에는 선언 오른쪽에 목적과 대표 예시값을 붙인다.
5. 보안, 원자성, 호환성 또는 장비 안전 때문에 필요한 분기에는 “왜”를 설명한다.
6. 구현을 마친 뒤 오래된 주석, 코드와 모순되는 예시, 비밀정보를 다시 확인한다.

## 클래스와 모듈

클래스 위 JSDoc에는 다음을 2~4문장으로 적는다.

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

## 속성, 상수와 enum

공개 계약, DTO, DB row type, 설정 객체, domain object와 중요한 상수는 가능한 한 선언 오른쪽에 한 줄 주석을 둔다. 주석에는 목적과 대표 예시값을 함께 적는다.

```ts
readonly catalogKey: string // URL과 참조에 쓰는 안정 ID. 예: "cwt-th04s"
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

## 피해야 할 주석

- `값을 증가시킨다`, `목록을 반환한다`처럼 코드를 그대로 읽는 설명
- 아직 구현하지 않은 동작을 현재 동작처럼 서술하는 주석
- 변경 이력, 대화 내용, 임시 디버깅 메모와 TODO만 남기는 주석
- 타입 오류를 감추거나 복잡한 코드를 정당화하기 위한 장문 설명
- 실제 credential, 운영 주소, 사용자 개인정보가 포함된 예시

주석이 길어야만 이해되는 구현은 먼저 함수·이름·책임을 단순화한다. 주석은 단순한 구조가 표현하지 못하는 목적과 제약을 보완한다.
