# Modbus Studio

![Modbus Studio 홈 화면](_images/modbus-studio-home.png)

Modbus Studio는 Modbus RTU 장비를 Catalog에 등록하고 브라우저에서 연결·실행하는 작업 공간입니다. 로그인한 사용자는 Profile과 Recipe로 장비 동작을 정의하고, Web Serial을 지원하는 브라우저에서 RS485 장비를 측정하거나 설정할 수 있습니다.

**개발자: Ji Yong ho** (jidolstar@gmail.com)

장비별 레지스터 주소, 데이터 해석 방식과 작업 순서는 JSON Profile/Recipe에 둡니다. 실행 엔진이 지원하지 않는 Modbus 동작은 Catalog JSON만으로 추가할 수 없습니다.

현재 구현에는 Catalog의 수동 등록·수정·검색과 활성 상태 관리, Modbus 응답 스캔, 등록된 Catalog의 측정 Recipe 실행, 정의된 경우의 설정 Recipe 실행, Test Group 저장·실행이 포함됩니다. Catalog에는 300×300 JPEG 썸네일, 참고 파일과 HTTPS 링크를 보관할 수 있습니다. 선택 기능인 Gemini 기반 AI 작성·수정은 검토용 초안을 만들며, 로그인한 사용자가 승인해야 저장됩니다. **새 DB에는 장비 Catalog가 자동 등록되지 않습니다.**

### Modbus 통신 지원 범위

현재 Modbus RTU 실행 엔진은 **FC03(holding register 읽기)**과 **FC06(단일 register 쓰기)**만 지원합니다. 측정에 FC04(input register 읽기)가 필요하거나 설정에 FC16(여러 register 쓰기) 또는 제조사 전용 Function Code가 필요하다면, 해당 작업은 Catalog를 등록해도 실행할 수 없습니다. FC03으로 측정하고 다른 Function Code로 설정하는 장비라면 지원되는 측정 작업만 정의해 사용할 수 있습니다. 다른 Function Code를 실행하려면 Profile/Recipe 계약과 실행 엔진을 확장해야 합니다.

## 주요 화면

아래 이미지는 화면 사용 예시이며 초기 DB에 장비가 등록되어 있다는 뜻은 아닙니다.

### 장비 카탈로그

Catalog 목록에서 등록된 장비를 검색하고, 장비 연결이나 상세 정보를 열 수 있습니다.

![장비 카탈로그 목록](_images/modbus-studio-01.png)

### 장비 스캔

Baudrate와 Slave ID 범위를 지정해 8N1 설정으로 주소 0의 holding register 1개를 읽는 FC03 요청에 응답하는 주소를 찾습니다. Modbus exception도 응답으로 인정하므로, 스캔에서 발견됐다는 사실만으로 측정·설정 호환성이 확인되지는 않습니다. FC03 요청에 응답하지 않는 장비는 찾지 못할 수 있습니다. 스캔 결과로 장비 모델을 판별하지 않으며, 연결할 때 사용할 Catalog는 사용자가 선택합니다.

![장비 스캔 결과](_images/modbus-studio-02.png)

### 카탈로그 상세와 Recipe

Catalog 상세에서 저장된 Profile/Recipe 정의, 썸네일과 참고 자료를 확인합니다.

![카탈로그 상세와 Profile](_images/modbus-studio-03.png)

![Recipe 및 참고 자료](_images/modbus-studio-06.png)

### AI 카탈로그 수정

기존 Catalog 정의와 읽을 수 있는 참고 자료를 바탕으로 AI 수정안을 만듭니다. 검증 결과와 JSON을 확인하고 승인하면 기존 정의에 적용됩니다.

![AI 카탈로그 수정](_images/modbus-studio-04.png)

### 테스트 그룹 실행

같은 Serial 설정을 사용하는 여러 장비의 측정 결과와 실행 상태를 브라우저 화면에서 확인합니다.

![테스트 그룹 실행](_images/modbus-studio-07.png)

## 설계 원칙

```text
Browser / Frontend
  ├─ Web Serial 연결과 연결 상태 관리
  ├─ Modbus RTU frame 및 transaction
  ├─ Profile/Recipe 검증과 실행
  ├─ Modbus 응답 Scan, Catalog 선택 후 측정·설정
  └─ Test Group 실행과 결과 표시

Backend
  ├─ Google 로그인과 서버 관리형 세션
  ├─ Catalog JSON 검증·관리 API와 runtime snapshot
  ├─ Test Group 저장과 실행용 snapshot API
  ├─ 썸네일·참고 파일·HTTPS 링크 관리
  └─ MySQL 영속화와 migration

MySQL
  └─ 사용자, 세션, Catalog, 참고 자료 metadata와 Test Group 정의
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
│  └─ src/test-fixtures/device-catalog/ 테스트 전용 Profile/Recipe JSON
├─ backend/                 NestJS/Fastify API 기반
├─ common/                  양쪽에서 사용하는 공개 Catalog 계약과 Schema
├─ docker/
│  ├─ dev/                  개발용 Compose, Dockerfile과 run.bat
│  └─ prod/                 운영용 Compose, Dockerfile, nginx 설정과 운영 스크립트
├─ .agents/skills/          저장소 전용 Codex/agent 작업 지침
├─ AGENTS.md                공통 개발 원칙
└─ .env.sample              공개 가능한 환경변수 예제
```

## 실행 환경

- Node.js 22와 npm(직접 실행할 때)
- Docker Compose(Docker 실행할 때). 스크립트가 외부 network `shared-net`을 준비합니다.
- 앱 데이터베이스로 사용할 MySQL 8.4 인스턴스. 데이터베이스는 이 Compose에서 생성하지 않습니다.
- Catalog 화면을 사용하려면 Google OpenID Connect 앱 설정과 로그인 허용 이메일 주소
- Web Serial 사용 시 HTTPS 배포 또는 localhost와 지원 브라우저(Chrome/Edge 계열)

## 시작

### DB와 `.env` 준비

먼저 공개 예제 설정을 루트 `.env`로 복사하고 실제 값으로 바꿉니다. `.env`에는 비밀번호와 secret이 있으므로 Git에 커밋하지 않습니다.

```powershell
Copy-Item .env.sample .env
```

MySQL 8.4 서버와 앱에서 사용할 데이터베이스는 먼저 준비해야 합니다. Compose는 MySQL을 만들지 않습니다. 빈 데이터베이스에서 Backend migration이 테이블과 이력을 생성합니다. Backend는 시작할 때 미적용 migration을 실행하며, 운영 스크립트도 기동 후 migration 명령을 호출합니다. Migration은 장비 Catalog를 자동 등록하지 않습니다.

MySQL 관리 계정으로 데이터베이스와 애플리케이션 계정을 준비하는 예시는 다음과 같습니다. 비밀번호는 임의의 강한 값으로 바꾸고, `'%'` 접속 host는 가능한 앱 서버의 실제 네트워크 범위로 제한합니다. MySQL 포트도 인터넷에 공개하지 말고 앱 서버에서만 접근 가능하게 설정합니다.

```sql
CREATE DATABASE IF NOT EXISTS modbus_studio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'modbus_app'@'%' IDENTIFIED BY 'replace_with_a_long_random_password';
GRANT ALL PRIVILEGES ON modbus_studio.* TO 'modbus_app'@'%';
```

계정은 해당 데이터베이스 범위에서 앱의 읽기·쓰기와 migration의 테이블·인덱스 생성 및 변경을 할 수 있어야 합니다. 앱 테이블을 수동으로 만들지 마세요. 테이블을 미리 만든 DB에는 migration이 자동으로 적용·인식되지 않아 `table already exists` 오류가 날 수 있습니다. 이미 운영 중인 데이터가 있으면 백업한 뒤 현재 schema와 migration 이력을 확인하고 적용해야 합니다. 실행된 migration은 `kysely_migration` 이력 테이블에 기록됩니다.

루트 `.env`에서 아래 예시의 필수 연결값을 실제 환경에 맞게 설정합니다. 개발 Compose는 `.env`를 두 컨테이너에 전달합니다. 운영 Compose는 Backend 실행 시 `.env`를 읽고, Frontend 빌드에는 `VITE_API_BASE_URL`, 두 통신 시간 설정과 `CORS_ORIGIN`을 전달합니다.

```dotenv
NODE_ENV=development
PORT=3000
CORS_ORIGIN=https://app.example.com
VITE_API_BASE_URL=https://api.example.com/api
VITE_ALLOWED_HOSTS=app.example.com

GOOGLE_OIDC_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OIDC_CLIENT_SECRET=replace_with_secret
GOOGLE_OIDC_CALLBACK_URL=https://api.example.com/api/auth/google/callback
AUTH_ALLOWED_EMAILS=user@example.com

JWT_SECRET=replace_with_at_least_32_random_bytes
AUTH_SESSION_TTL_SECONDS=28800
AUTH_COOKIE_NAME=modbus_session

DATABASE_HOST=mysql-8.4
DATABASE_PORT=3306
DATABASE_NAME=modbus_studio
DATABASE_USER=modbus_app
DATABASE_PASSWORD=replace_with_a_long_random_password
DATABASE_SSL=false
```

`DATABASE_HOST`는 Backend에서 접근 가능한 주소여야 합니다. MySQL이 다른 컨테이너에 있다면 `shared-net`에서 해석되는 이름을 사용합니다. Backend 컨테이너의 `localhost`는 MySQL이 아니라 그 컨테이너 자신입니다. Google callback URL은 Google 앱 설정과 정확히 일치해야 합니다. `.env.sample`의 secret과 비밀번호 예시를 운영에서 사용하지 마세요.

`.env.sample`은 복사해 수정하는 예시 파일입니다. 아래 표의 “기본”은 값을 생략했을 때 코드가 실제로 사용하는 값이고, “샘플”은 `.env.sample`에 적힌 예시값입니다. `VITE_*` 값은 공개 설정으로 취급하고 비밀값은 Backend 설정에만 둡니다.

#### `.env.sample` 변수 안내

| 변수 | 용도와 기본값·제한 |
| --- | --- |
| `VITE_API_BASE_URL` | 브라우저가 호출할 API base URL. `/api`를 포함한 공개 HTTPS URL을 사용합니다. 로컬 개발의 `localhost`와 `127.0.0.1`에는 HTTP도 허용됩니다. |
| `VITE_ALLOWED_HOSTS` | Vite 개발 서버가 허용할 host 목록. 쉼표로 구분하며, 생략 시 `localhost,modbus-frontend`입니다. |
| `VITE_SENSOR_POLL_INTERVAL_MS` | 단일 장비 화면의 자동 측정 간격(ms). 기본 `3000`, 허용 범위 `250~60000`. |
| `VITE_MODBUS_TRANSACTION_TIMEOUT_MS` | Modbus 응답 대기 제한(ms). 기본 `1200`, 허용 범위 `100~60000`. |
| `NODE_ENV` | Backend 실행 환경. `development`, `test`, `production` 중 하나이며 샘플은 `development`입니다. 운영 Compose는 `production`으로 설정합니다. |
| `PORT` | Backend 수신 포트. 기본 `3000`, 허용 범위 `1~65535`. |
| `CORS_ORIGIN` | Frontend의 정확한 HTTP(S) origin. 경로와 끝 `/` 없이 입력하며 Backend 필수값입니다. 운영에서는 HTTPS여야 합니다. |
| `GOOGLE_OIDC_CLIENT_ID` | Google OIDC 앱의 client ID. |
| `GOOGLE_OIDC_CLIENT_SECRET` | Google OIDC client secret. Backend 전용 비밀값입니다. |
| `GOOGLE_OIDC_CALLBACK_URL` | Google 로그인을 완료할 Backend callback URL. Google 앱에 등록한 URL과 일치해야 합니다. |
| `AUTH_ALLOWED_EMAILS` | 로그인 허용 이메일 목록. 쉼표로 구분합니다. 네 Google OIDC 값이 모두 설정되어야 로그인이 활성화됩니다. |
| `JWT_SECRET` | 세션 token 서명용 무작위 비밀값. 최소 32바이트이며 샘플 값을 운영에서 재사용하면 안 됩니다. |
| `AUTH_SESSION_TTL_SECONDS` | 로그인 세션 수명(초). 기본 `28800`, 허용 범위 `300~86400`. |
| `AUTH_COOKIE_NAME` | 필수 세션 cookie 이름. 샘플 값은 `modbus_session`이며 코드 기본값은 없습니다. |
| `DATABASE_HOST` | Backend 실행 위치에서 접근할 MySQL 주소. Docker에서 `localhost`는 Backend 컨테이너 자신을 가리킵니다. 필수값입니다. |
| `DATABASE_PORT` | MySQL 포트. 기본 `3306`, 허용 범위 `1~65535`. |
| `DATABASE_NAME` | Backend가 사용할 기존 MySQL database. 필수값이며 새 설치의 샘플 이름은 `modbus_studio`입니다. 앱이 DB/계정 자체를 만들지는 않습니다. |
| `DATABASE_USER` / `DATABASE_PASSWORD` | 앱 전용 MySQL 계정과 비밀번호. migration에 필요한 테이블·인덱스 권한이 필요합니다. |
| `DATABASE_SSL` | MySQL TLS 사용 여부. `true` 또는 `false`이며 기본값은 `false`입니다. |
| `CATALOG_UPLOAD_ROOT` | Catalog 파일 저장 경로. 생략 시 `/var/lib/modbus-studio/catalog-uploads`; Backend 전용 절대 경로를 사용합니다. |
| `CATALOG_FILE_MAX_BYTES` | 일반 참고 파일의 최대 크기(byte). 기본 `20971520`, 허용 범위 `1024~104857600`. |
| `CATALOG_THUMBNAIL_MAX_BYTES` | 썸네일 파일 최대 크기(byte). 기본 `10485760`, 허용 범위 `1024~26214400`. |
| `GEMINI_API_KEY` | AI Catalog 생성·수정용 Gemini key. 선택값이며 비어 있으면 AI 기능을 사용할 수 없습니다. Backend에만 둡니다. |
| `GEMINI_CATALOG_MODEL` | Gemini 모델 ID. 생략 시 `gemini-3.5-flash-lite`를 사용합니다. |
| `GEMINI_CATALOG_TIMEOUT_MS` | Gemini 응답 대기 시간(ms). 기본 `300000`, 허용 범위 `30000~600000`. |
| `GEMINI_AUDIT_RETENTION_DAYS` | Gemini 요청·응답 감사 기록 보존 일수. 기본 `90`, 허용 범위 `1~365`; 임시 업로드 파일 TTL과는 별도입니다. |

MySQL 주소·계정과 `DATABASE_NAME`은 실제로 준비한 DB에 맞춰야 합니다. Backend 필수값은 `CORS_ORIGIN`, `JWT_SECRET`, `AUTH_COOKIE_NAME`, `DATABASE_HOST`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`입니다. Google 설정 네 값이 없거나 일부만 있으면 Backend는 시작할 수 있어도 로그인을 완료할 수 없습니다. AI 기능은 `GEMINI_API_KEY`가 있을 때만 요청할 수 있습니다.

운영 Compose는 Backend의 `NODE_ENV`를 `production`으로 덮어씁니다. 숫자 설정은 허용 범위를 벗어나면 시작 또는 빌드 시 오류가 납니다. 전체 예시는 [`.env.sample`](.env.sample)에 있습니다.

### Docker 개발 환경 (Windows)

MySQL 서버와 앱 데이터베이스를 먼저 준비하고 Backend 컨테이너에서 접근할 수 있도록 `DATABASE_HOST`를 설정합니다. 이 프로젝트의 Compose는 MySQL을 생성하지 않습니다. `docker\dev\run.bat`은 Docker의 외부 `shared-net` 네트워크를 준비하고 Backend와 Frontend 개발 컨테이너를 시작합니다.

기존 설치를 업데이트할 때 개발 Compose는 `@modbus-studio/device-catalog-domain`이 설치된 새 의존성 volume을 사용합니다. 이전 패키지명으로 설치된 volume은 그대로 남지만 더는 연결하지 않습니다. `catalog_uploads` volume은 계속 사용하므로 Catalog 첨부 자료를 삭제하려고 `docker compose down -v`를 실행하지 마세요. 소스를 갱신한 뒤 아래 실행 명령으로 이미지를 다시 빌드하고 컨테이너를 재생성합니다.

개발 Compose는 호스트 포트를 공개하지 않습니다. 브라우저에서 사용하려면 `shared-net`에서 컨테이너에 접근하는 reverse proxy가 필요합니다. `VITE_API_BASE_URL`은 브라우저가 접근할 API 주소로, `CORS_ORIGIN`은 사용자가 접속할 Frontend의 정확한 origin으로 지정합니다.

```powershell
docker\dev\run.bat
```

컨테이너 네트워크 안에서 Frontend와 Backend는 다음 주소로 접근할 수 있습니다.

- Frontend container: `http://modbus-frontend:5173`
- Backend health: `http://modbus-backend:3000/api/health`
- 외부 주소는 Cloudflare Tunnel 등 reverse proxy에서 위 컨테이너 주소로 연결합니다.

### Node.js 직접 실행

Docker 대신 로컬에서 각 서버를 실행할 수도 있습니다. root `.env`에서 브라우저 기준 API 주소와 origin을 로컬 주소로 설정합니다. 예를 들어 Frontend는 `http://localhost:5173`, Backend API는 `http://localhost:3000/api`를 사용합니다.

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api
VITE_ALLOWED_HOSTS=localhost
CORS_ORIGIN=http://localhost:5173
```

Vite는 저장소 루트의 `.env`를 읽지만 Backend는 자동으로 읽지 않습니다. Backend 실행 명령에 Node.js의 `--env-file` 옵션을 사용합니다. 직접 실행할 때는 `DATABASE_HOST`를 호스트에서 접근할 수 있는 주소로 바꿉니다. Catalog 화면에 로그인하려면 Google OIDC 설정도 필요합니다. 로컬 callback URL은 `http://localhost:3000/api/auth/google/callback`으로 설정하고 Google 앱에도 동일하게 등록합니다. AI 기능을 사용하려면 Gemini 설정을 추가합니다.

Frontend 디렉터리에서 의존성을 설치하고 개발 서버를 시작합니다. 이 명령은 서버가 실행되는 동안 종료되지 않습니다.

```powershell
cd frontend
npm ci
npm run dev
```

Backend는 별도 터미널에서 실행합니다. Node.js가 저장소 루트 `.env`를 읽도록 지정합니다.

```powershell
cd backend
npm ci
node --env-file=../.env ./node_modules/@nestjs/cli/bin/nest.js start --watch
```

검증 명령은 실행 중인 개발 서버와 별도의 터미널에서 각 프로젝트 디렉터리별로 실행합니다.

```powershell
cd frontend
npm run typecheck
npm test
npm run build
```

```powershell
cd backend
npm run typecheck
npm test
npm run build
```

## 개발 명령

```powershell
docker compose -f docker/dev/docker-compose.yml exec backend npm run db:migrate
docker compose -f docker/dev/docker-compose.yml logs -f frontend backend
docker compose -f docker/dev/docker-compose.yml down
```

## EC2 운영 배포

개발 및 운영 Docker 파일은 `docker/dev`와 `docker/prod` 아래에 각각 모았습니다. 이 절차는 Ubuntu 24.04 EC2에서 호스트 nginx가 TLS와 도메인 라우팅을 맡고, Docker Compose가 Frontend와 Backend를 실행하는 배포를 설명합니다.

### 1. 서버 도구 설치

Ubuntu 패키지로 Docker, Compose plugin, 호스트 nginx와 Certbot nginx plugin을 설치하고 Docker daemon을 활성화합니다. Ubuntu 제공 패키지와 TLS 설정 방법은 [Ubuntu Docker 안내](https://ubuntu.com/server/docs/how-to/containers/docker-for-system-admins/)와 [Ubuntu Certbot 안내](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/)를 참고하세요.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker
docker --version
docker compose version
```

`docker`를 `sudo` 없이 실행하려면 EC2 로그인 계정을 Docker 그룹에 추가한 뒤 SSH에서 로그아웃하고 다시 접속합니다.

```bash
sudo usermod -aG docker "$USER"
```

### 2. 저장소와 운영 환경 설정

Public 저장소를 clone하고 root `.env`를 만듭니다. 인증 정보와 운영 도메인이 포함되는 `.env`는 Git에 커밋하지 않습니다.

```bash
sudo install -d -o "$USER" -g "$USER" /var/www/modbus
git clone https://github.com/jidolstar/modbus-web-serial-runtime.git /var/www/modbus
cd /var/www/modbus
cp .env.sample .env
nano .env
```

최소한 아래 공개 URL을 실제 도메인으로 설정합니다. API base URL에는 `/api`가 포함되어야 합니다. Google OIDC callback, DB 연결, allowlist와 secret 값도 실제 운영 설정으로 바꿉니다.

```dotenv
VITE_API_BASE_URL=https://modbus-api.example.com/api
CORS_ORIGIN=https://modbus.example.com
GOOGLE_OIDC_CALLBACK_URL=https://modbus-api.example.com/api/auth/google/callback
```

`docker/prod/run.sh`는 Compose에 root `.env` 경로를 전달하고 `shared-net`이 없으면 생성합니다. MySQL을 별도 컨테이너에서 실행한다면 그 컨테이너도 `shared-net`에 연결합니다. MySQL이 호스트나 다른 서버에 있다면 Backend 컨테이너에서 실제로 접근 가능한 주소를 `DATABASE_HOST`에 설정해야 합니다.

```bash
./docker/prod/run.sh
```

이 명령은 production 이미지를 빌드하고 Frontend/Backend를 시작한 뒤 Backend의 컴파일된 DB migration을 실행합니다. Frontend와 Backend는 호스트의 `127.0.0.1:5173`, `127.0.0.1:3000`에만 바인딩됩니다. 호스트 nginx는 Docker network에 연결하지 않고 이 loopback 포트로 proxy합니다. `shared-net`은 컨테이너와 외부 DB 컨테이너 간 통신에 사용합니다.

### 3. 호스트 nginx vhost

아래 설정에서 두 도메인을 실제 도메인으로 바꿔 `/etc/nginx/sites-available/modbus.example.com`에 저장합니다. 파일명도 실제 Frontend 도메인으로 바꿀 수 있습니다. 이후 해당 파일 하나만 `/etc/nginx/sites-enabled/`에 연결합니다. 같은 server block을 중복 활성화하면 `conflicting server name` 경고가 발생합니다.

```nginx
server {
    listen 80;
    server_name modbus.example.com;
    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name modbus-api.example.com;
    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # GEMINI_CATALOG_TIMEOUT_MS는 최대 10분이므로 proxy timeout을 그보다 길게 둔다.
        proxy_connect_timeout 10s;
        proxy_send_timeout 610s;
        proxy_read_timeout 610s;
    }
}
```

도메인의 A 레코드가 EC2 공인 IP를 가리키고, EC2 Security Group에서 TCP 80과 443 inbound가 허용되어야 합니다. 사이트 설정을 활성화하고 검사한 뒤 nginx를 reload합니다.

예시의 `client_max_body_size 60m`보다 `CATALOG_FILE_MAX_BYTES`를 크게 설정한다면 nginx 요청 크기 제한도 함께 조정해야 합니다.

```bash
sudo ln -s /etc/nginx/sites-available/modbus.example.com /etc/nginx/sites-enabled/modbus.example.com
sudo nginx -t
sudo systemctl reload nginx
```

`sites-enabled`에 잘못된 이름의 링크나 중복 링크가 있는지 확인합니다. 같은 설정이 두 경로에서 활성화되어 있으면 duplicate warning이 나며, 오타 링크만 제거하고 올바른 설정 하나를 남깁니다.

```bash
sudo ls -la /etc/nginx/sites-enabled/
sudo grep -RInE 'server_name.*(modbus\.example\.com|modbus-api\.example\.com)' /etc/nginx/sites-enabled /etc/nginx/conf.d
```

### 4. HTTPS와 인증서 자동 갱신

인증서 발급 전 DNS와 HTTP proxy가 정상인지 확인하고, EC2에서 포트 80과 443이 외부에 열려 있는지 확인합니다. Certbot nginx plugin으로 두 도메인 인증서를 발급합니다.

```bash
sudo certbot --nginx -d modbus.example.com -d modbus-api.example.com
sudo nginx -t
sudo systemctl reload nginx
```

HTTP를 HTTPS로 redirect하도록 선택합니다. Certbot timer가 활성화되어 있는지 확인하고 갱신을 시험합니다.

```bash
systemctl list-timers --all | grep -i certbot
sudo certbot renew --dry-run
```

자동 갱신을 위해 포트 80과 두 도메인의 DNS가 계속 유지되어야 합니다. Certbot nginx plugin은 인증서 갱신이 성공하면 nginx를 자동 reload합니다.

### 5. 배포와 운영 명령

코드 반영은 원하는 tag 또는 commit으로 직접 선택합니다. `run.sh`와 `restart.sh`는 Git pull을 실행하지 않습니다. 저장소 루트에서 pull한 다음 운영 재배포 스크립트를 실행합니다.

```bash
git pull --ff-only
./docker/prod/restart.sh
```

운영 로그 확인과 중지는 아래 스크립트를 사용합니다.

```bash
./docker/prod/logs.sh
./docker/prod/stop.sh
```

`stop.sh`는 컨테이너만 중지·제거하며 Catalog 업로드 named volume은 보존합니다. 업로드와 외부 MySQL은 서버 백업에 포함해야 합니다. EC2 Security Group에는 SSH와 nginx용 80/443만 공개하고 Docker 앱 포트 3000/5173은 공개하지 않습니다.

Backend는 Google 인증 설정이 없어도 구성 상태를 Frontend에 표시할 수 있지만 로그인하려면 OIDC 설정이 필요합니다. 개발 Compose는 소스를 bind mount해 변경을 감지합니다. 운영 Compose는 정적 Frontend와 빌드된 Backend를 사용합니다. 두 Compose 모두 MySQL을 생성하지 않으며 `DATABASE_HOST`에 지정한 DB에 연결합니다.

Catalog 첨부 파일은 `catalog_uploads` named volume에 저장됩니다. 해당 volume은 Backend에만 연결되며 Frontend web root에서는 직접 접근할 수 없습니다. Compose의 `down` 명령은 named volume을 삭제하지 않습니다.

기존 설치를 업그레이드할 때는 현재 `.env`의 `DATABASE_NAME`과 사용자 지정 `CATALOG_UPLOAD_ROOT`를 유지하세요. 샘플의 새 DB 이름으로 설정만 바꾸면 기존 데이터가 자동 이동하지 않습니다. 이름을 바꾸려면 먼저 MySQL 데이터를 이전해야 합니다. 같은 Compose 프로젝트를 계속 사용하면 기존 `catalog_uploads` volume을 새 컨테이너 경로에 다시 연결합니다. Compose 밖에서 기본 업로드 경로를 사용했다면 기존 경로를 `CATALOG_UPLOAD_ROOT`로 지정하거나 파일을 새 `/var/lib/modbus-studio/catalog-uploads`로 옮기세요. 세션 token의 발급자 값이 바뀌므로 재배포 뒤에는 다시 로그인해야 합니다.

## 장비 등록

장비 정의는 `CatalogBundle 1.0` JSON에 Profile과 Recipe를 함께 담습니다. Backend는 Schema와 참조를 검증해 DB에 저장합니다. 브라우저 실행 화면은 인증 후 활성 Catalog의 runtime snapshot을 읽습니다. 공유 계약과 Schema는 [device-catalog-domain](common/device-catalog-domain/)에 있습니다. Recipe에는 버전별 계약이 있으므로 새 정의를 작성할 때 해당 Schema를 확인하세요.

**CWT-TH04S는 초기 개발과 테스트에 사용한 예제 자료입니다.** JSON은 `common/device-catalog-domain/examples/`와 `frontend/src/test-fixtures/`에 있으며, 수동 등록 화면은 현재 공유 예제 JSON을 초기 입력으로 보여줍니다. 새 장비를 등록할 때는 이 JSON의 장비별 값을 실제 자료에 맞게 교체해야 합니다. 예제는 DB migration이나 서버 시작 과정에서 등록되지 않습니다. 별도의 `catalog:import:cwt-th04s` 명령을 명시적으로 실행하거나 사용자가 직접 저장할 때만 Catalog가 됩니다.

### AI로 장비 등록·수정하기

Backend에 `GEMINI_API_KEY`를 설정하면 AI 작성·수정을 요청할 수 있습니다. 실제 요청에는 해당 key의 모델 접근 권한도 필요합니다. 키는 Frontend에 전달하지 않습니다. Gemini 모델, timeout과 감사 기록 보존 기간은 `.env.sample`의 `GEMINI_*` 설정으로 조정합니다.

로그인이 허용된 사용자는 Catalog 화면의 **AI로 등록**에서 새 장비 초안을 요청할 수 있습니다. 기존 장비 상세 화면의 **AI로 수정**은 저장된 정의를 바탕으로 수정 초안을 만듭니다. 별도 관리자 역할 구분은 현재 구현되어 있지 않습니다. 새 장비에는 설명, 공개 HTTPS 참고 URL 또는 지원되는 문서·이미지 파일 중 하나 이상을 제공해야 합니다. 수정할 때는 무엇을 바꿀지 구체적으로 적어야 합니다. 제조사·모델명, Modbus 통신 설정, 레지스터 주소·자료형·배율이 확인되는 자료를 사용하세요.

Backend는 Gemini 응답의 JSON 구조, Profile/Recipe 참조와 실행 계약을 검증합니다. AI가 근거 부족을 반환하거나 읽기 가능한 측정 Recipe가 없으면 등록 가능한 제안을 내지 않습니다. AI가 작성한 Catalog도 현재 엔진의 FC03·FC06 지원 범위를 넓히지는 못합니다. **Schema 검증은 장비 매뉴얼과 레지스터 값의 사실 여부까지 확인하지 않습니다.** 검토 화면에서 경고·가정·출처와 전체 JSON을 읽고, 주소 표기 기준, byte/word 순서, signed 여부, 배율, 단위와 쓰기 조건을 원문 자료와 대조하세요. 검증 오류에는 추가 자료나 수정 지시를 넣어 재검토할 수 있습니다.

검증을 통과한 제안은 **승인 및 등록** 또는 **AI 수정안 적용**을 눌러야 저장됩니다. 수정은 일부 필드만 덧대는 방식이 아니라 Catalog의 제목과 Profile/Recipe 정의 전체를 현재 revision과 비교해 교체합니다. 다른 사용자가 먼저 수정했다면 충돌로 거부합니다.

AI 입력의 파일은 임시 session에서 처리합니다. 새 장비 등록에서는 검토 화면에서 선택한 파일과 링크만 Catalog 자료로 보관합니다. 수정 화면은 기존 정의와 최대 5개의 참고 파일·10개의 링크를 입력 근거로 사용하며, AI 수정에 첨부한 새 자료를 Catalog 자료로 추가하지는 않습니다. 취소 시 임시 session 폐기를 요청하고, 남은 자료는 TTL 정리 대상이 됩니다. AI를 사용하지 않아도 직접 JSON을 편집하고 서버 검증을 거쳐 등록할 수 있습니다.

## 검증

Frontend의 Serial·Modbus 테스트는 실제 USB 장비 대신 모의 transport로 실행합니다. 실제 연결·측정·설정은 Web Serial을 지원하는 브라우저, HTTPS 또는 localhost 환경과 RS485 장비가 있어야 확인할 수 있습니다. 현장에서는 포트 권한, Slave ID, baudrate, parity와 배선을 별도로 확인해야 합니다.

## 개발 원칙

기여하거나 자동화 도구로 코드를 변경할 때는 [AGENTS.md](AGENTS.md)를 먼저 확인합니다. 구현은 현재 요구사항을 해결하는 범위에서 짧고 명확하게 유지하며, 프로젝트 목적과 무관한 기능이나 추상화를 추가하지 않습니다.

실제 환경변수, 인증정보, 회사 내부 문서와 임시 파일은 공개 저장소에 포함하지 않습니다.

## 라이선스

Apache License 2.0을 적용합니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
