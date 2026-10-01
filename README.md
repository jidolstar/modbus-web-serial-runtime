# Modbus Studio

Modbus Studio는 브라우저에서 Modbus RTU 장비를 정의하고 연결해 실행하는 작업 공간입니다. 관리자는 장비 Catalog의 Profile과 Recipe를 관리하고, 사용자는 지원되는 브라우저에서 Web Serial로 RS485 장비를 탐색·측정·설정합니다.

**개발자: Ji Yong ho**

장비별 동작 차이는 실행 엔진이 지원하는 Step과 decoder 범위에서 JSON Profile/Recipe로 표현합니다. 실제 장비에 필요한 프로토콜 능력이 현재 엔진에 없을 때만 엔진을 확장합니다.

현재 구현 범위는 CWT-TH04S 온습도 센서의 측정, Catalog 기반 장비 탐색, Slave ID/baudrate 변경, 관리용 Test Group 저장·실행입니다. Catalog 관리에는 JSON 검증, 활성/비활성 상태, 300×300 JPEG 썸네일, 참고 파일과 HTTPS 링크가 포함됩니다. 선택 기능인 AI Catalog 작성·수정은 Gemini API를 사용하며, 생성된 제안은 검토·승인 후 저장됩니다.

## 설계 원칙

```text
Browser / Frontend
  ├─ Web Serial 연결과 연결 상태 관리
  ├─ Modbus RTU frame 및 transaction
  ├─ Profile/Recipe 검증과 실행
  ├─ 측정, 장비 Scan, Slave ID/baudrate 설정
  └─ Test Group 실행과 결과 표시

Backend
  ├─ Google 인증과 서버 관리형 세션
  ├─ Catalog JSON 검증·관리 API와 runtime snapshot
  ├─ Test Group 저장·실행 snapshot API
  ├─ 썸네일·참고 파일·HTTPS 링크 관리
  └─ MySQL 영속화와 migration

MySQL
  └─ 사용자, 세션, Catalog, 참고 자료 metadata와 Test Group
```

USB Serial 통신은 사용자의 브라우저에서 실행됩니다. Docker container나 Backend에 USB 장치를 전달하지 않습니다.

## 저장소 구조

```text
.
├─ frontend/
│  ├─ src/serial/           Web Serial transport와 연결 생명주기
│  ├─ src/modbus/           RTU codec, client와 transaction queue
│  ├─ src/device-catalog/   API Catalog, Profile/Recipe contract와 검증
│  ├─ src/recipe-engine/    제한된 Recipe 실행기
│  ├─ src/application/      측정, Scan과 장비 설정 workflow
│  └─ src/test-fixtures/device-catalog 테스트 전용 Profile/Recipe JSON
├─ backend/                 NestJS/Fastify API 기반
├─ common/                  양쪽에서 사용하는 공개 Catalog 계약과 Schema
├─ docker-compose.yml       개발용 Frontend/Backend Compose
├─ .agents/skills/          저장소 전용 Codex/agent 작업 지침
├─ AGENTS.md                공통 개발 원칙
└─ .env.sample              공개 가능한 환경변수 예제
```

## 실행 환경

- Node.js 22와 npm
- Docker Compose 및 외부 Docker network `shared-net`
- 앱 데이터베이스로 사용할 MySQL 8.4 인스턴스. 데이터베이스는 이 Compose에서 생성하지 않습니다.
- Google OpenID Connect 앱 설정과 허용할 이메일 주소
- Web Serial 사용 시 HTTPS 배포 또는 localhost와 지원 브라우저(Chrome/Edge 계열)

USB Serial 포트는 사용자 브라우저에서만 접근합니다. Backend와 Docker에는 장비 USB를 연결하지 않습니다.

## 시작

```powershell
Copy-Item .env.sample .env
docker compose up --build -d
```

`.env.sample`을 `.env`로 복사한 뒤 예제 값과 도메인을 실제 환경에 맞게 바꿉니다. `.env`는 Git에 포함하지 않습니다. `DATABASE_*`는 Compose 외부에서 운영하는 MySQL을 가리켜야 하며, Google OIDC callback URL은 Google 설정에 등록한 Backend 주소와 정확히 일치해야 합니다.

`CORS_ORIGIN`에는 Frontend의 공개 origin만 입력합니다(경로와 마지막 `/` 없이). 이 값은 인증 callback 검증, CORS, 그리고 HTTPS 배포의 canonical/Open Graph URL에 사용됩니다. `VITE_API_BASE_URL`은 브라우저가 접근하는 Backend API base URL이며 `/api`를 포함해야 합니다. `VITE_ALLOWED_HOSTS`에는 Vite 개발 서버에 접속할 호스트 이름을 지정합니다.

Compose는 호스트 포트를 공개하지 않습니다. 먼저 외부 network `shared-net`과 MySQL을 준비하고, reverse proxy 또는 Cloudflare Tunnel을 다음 내부 주소에 연결합니다.

- Frontend container: `http://modbus-frontend:5173`
- Backend health: `http://modbus-backend:3000/api/health`
- 외부 주소는 Cloudflare Tunnel 등 reverse proxy에서 위 컨테이너 주소로 연결합니다.

## 개발 명령

```powershell
docker compose exec backend npm run db:migrate
docker compose logs -f frontend backend
docker compose down
```

첫 실행 및 Backend migration 변경 후 `db:migrate`를 실행합니다. Backend는 Google 인증 설정이 없어도 구성 상태를 Frontend에 표시할 수 있지만 로그인하려면 OIDC 설정이 필요합니다. Frontend와 Backend 소스는 컨테이너에 bind mount되어 개발 서버가 변경을 감지합니다. Compose에는 MySQL 서비스가 없으며 외부 MySQL을 `shared-net`에서 사용합니다.

Catalog 첨부 파일은 `catalog_uploads` named volume에 저장됩니다. 해당 volume은 Backend에만 연결되며 Frontend web root에서는 직접 접근할 수 없습니다. `docker compose down`은 named volume을 삭제하지 않습니다.

AI 작성·수정은 Backend의 `GEMINI_API_KEY`가 있을 때 사용할 수 있습니다. 키는 Backend에만 보관하며 Frontend로 전달하지 않습니다. 제안은 Catalog에 자동 반영되지 않고 관리자가 검토·승인해야 합니다. Gemini 모델·timeout·감사 기록 보존 기간은 `.env.sample`의 `GEMINI_*` 설정으로 조정할 수 있습니다.

로컬 개발에서 Docker 대신 Node.js를 사용할 때는 각 프로젝트 디렉터리에서 아래 명령을 실행합니다.

```powershell
cd frontend
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

Backend는 별도 터미널의 `backend` 디렉터리에서 실행합니다. 명령은 `npm ci`, `npm run start:dev`, `npm run typecheck`, `npm test`, `npm run build`이며, 먼저 유효한 `.env`와 접근 가능한 MySQL이 필요합니다.

## 장비 등록

장비는 `CatalogBundle v1` JSON으로 표현합니다. Backend가 Schema와 참조를 검증해 DB에 저장하고, Frontend는 인증된 runtime snapshot에서 활성 Catalog를 읽습니다. Profile/Recipe 범위와 공유 Schema는 [device-catalog-domain](common/device-catalog-domain/)에서 확인할 수 있습니다. `frontend/src/test-fixtures/`의 Catalog JSON은 테스트 전용 예시이며 실제 runtime source가 아닙니다.

## 검증

Frontend 테스트는 Web Serial과 장비를 모의해 실행합니다. 실제 통신은 HTTPS 또는 localhost의 지원 브라우저와 연결된 RS485 장비가 있어야 확인할 수 있습니다. 장비 연결·측정·설정 시 포트 권한, Slave ID, baudrate, parity와 배선을 확인합니다.

## 개발 원칙

기여하거나 자동화 도구로 코드를 변경할 때는 [AGENTS.md](AGENTS.md)를 먼저 확인합니다. 구현은 현재 요구사항을 해결하는 범위에서 짧고 명확하게 유지하며, 프로젝트 목적과 무관한 기능이나 추상화를 추가하지 않습니다.

실제 환경변수, 인증정보, 회사 내부 문서와 임시 파일은 공개 저장소에 포함하지 않습니다.

## 라이선스

Apache License 2.0을 적용합니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
