# Modbus Web Serial Runtime

브라우저의 Web Serial API로 Modbus RTU 장비를 연결하고, Profile과 Recipe를 이용해 장비별 동작을 정의하는 웹 애플리케이션입니다.

표준적인 Modbus 장비는 실행 엔진이 지원하는 Step과 decoder 범위 안에서 JSON Profile/Recipe 등록만으로 추가하는 것을 목표로 합니다. 새로운 프로토콜 기능이 실제로 필요할 때만 실행 엔진을 확장합니다.

현재 CWT-TH04S 온습도 센서의 측정, 장치 탐색 기반, Slave ID 및 baudrate 변경 workflow를 구현했습니다. Backend는 Google 인증과 서버 세션, MySQL migration, DB 기반 장비 Catalog 검증·관리 API, 썸네일·참고 파일·HTTPS 링크 관리를 제공합니다. Catalog 관리 UI와 API 기반 실행 전환은 후속 단계입니다.

## 설계 원칙

```text
Browser / Frontend
  ├─ Web Serial 연결과 연결 상태 관리
  ├─ Modbus RTU frame 및 transaction
  ├─ Profile/Recipe 검증과 실행
  └─ 측정, Scan, 장비 설정 workflow

Backend
  ├─ Google 인증과 서버 관리형 세션
  ├─ Catalog JSON 검증과 관리 API
  ├─ 300×300 JPEG 썸네일과 참고 자료 API
  └─ MySQL 영속화와 migration

MySQL
  └─ 사용자, 세션, Catalog와 참고 자료 metadata
```

USB Serial 통신은 사용자의 브라우저에서 실행됩니다. Docker container나 Backend에 USB 장치를 전달하지 않습니다.

## 저장소 구조

```text
.
├─ frontend/
│  ├─ src/serial/           Web Serial transport와 연결 생명주기
│  ├─ src/modbus/           RTU codec, client와 transaction queue
│  ├─ src/device-catalog/   Profile/Recipe contract와 검증
│  ├─ src/recipe-engine/    제한된 Recipe 실행기
│  ├─ src/application/      측정, Scan과 장비 설정 workflow
│  └─ public/device-catalog 장비별 Profile/Recipe JSON
├─ backend/                 NestJS/Fastify API 기반
├─ common/                  양쪽에서 사용하는 공개 Catalog 계약과 Schema
├─ docker/                  개발용 Docker Compose
├─ .agents/skills/          저장소 전용 Codex/agent 작업 지침
├─ AGENTS.md                공통 개발 원칙
└─ .env.sample              공개 가능한 환경변수 예제
```

## 시작

```powershell
Copy-Item .env.sample .env
docker compose -f docker/docker-compose.yml up --build -d
```

`.env`의 예제 도메인을 실제 HTTPS 도메인으로 변경합니다. 이 파일 하나가 Docker Compose를 통해 frontend와 backend에 전달되며 Git에는 포함되지 않습니다.

- Frontend container: `http://modbus-frontend:5173`
- Backend health: `http://modbus-backend:3000/api/health`
- 외부 주소는 Cloudflare Tunnel 등 reverse proxy에서 위 컨테이너 주소로 연결합니다.

## 개발 명령

```powershell
docker compose -f docker/docker-compose.yml logs -f frontend backend
docker compose -f docker/docker-compose.yml down
```

Frontend와 Backend 소스는 컨테이너에 bind mount되어 변경 시 자동으로 다시 빌드됩니다.
현재 Compose에는 데이터베이스 서비스를 포함하지 않습니다. Backend DB 연동 시 동일한 `shared-net`의 MySQL을 사용합니다.

Catalog 첨부 파일은 `catalog_uploads` named volume에 저장됩니다. volume은 Backend에만 mount되며 Frontend web root에서는 직접 접근할 수 없습니다.

두 서비스는 호스트 포트를 공개하지 않고 외부 Docker 네트워크 `shared-net`에만 연결됩니다.
Cloudflare Tunnel의 서비스 대상은 `http://modbus-frontend:5173`과
`http://modbus-backend:3000`입니다.

## 장비 등록

Profile과 Recipe 작성 방법은 [Device Catalog 등록 안내](frontend/public/device-catalog/README.md)를 참고합니다.

지원 중인 Step과 decoder로 표현할 수 있는 장비는 `CatalogBundle v1` JSON으로 서버 검증 후 DB에 등록할 수 있습니다. Frontend 실행은 관리 UI가 완성될 때까지 기존 정적 Catalog도 함께 사용합니다.

## 개발 원칙

기여하거나 자동화 도구로 코드를 변경할 때는 [AGENTS.md](AGENTS.md)를 먼저 확인합니다. 구현은 현재 요구사항을 해결하는 범위에서 짧고 명확하게 유지하며, 프로젝트 목적과 무관한 기능이나 추상화를 추가하지 않습니다.

실제 환경변수, 인증정보, 회사 내부 문서와 임시 파일은 공개 저장소에 포함하지 않습니다.

## 라이선스

Apache License 2.0을 적용합니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
