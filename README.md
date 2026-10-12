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
├─ docker/
│  ├─ dev/                  개발용 Compose, Dockerfile과 run.bat
│  └─ prod/                 운영용 Compose, Dockerfile, nginx 설정과 운영 스크립트
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
docker\dev\run.bat
```

`.env.sample`을 `.env`로 복사한 뒤 예제 값과 도메인을 실제 환경에 맞게 바꿉니다. `.env`는 Git에 포함하지 않습니다. `DATABASE_*`는 Compose 외부에서 운영하는 MySQL을 가리켜야 하며, Google OIDC callback URL은 Google 설정에 등록한 Backend 주소와 정확히 일치해야 합니다.

`CORS_ORIGIN`에는 Frontend의 공개 origin만 입력합니다(경로와 마지막 `/` 없이). 이 값은 인증 callback 검증, CORS, 그리고 HTTPS 배포의 canonical/Open Graph URL에 사용됩니다. `VITE_API_BASE_URL`은 브라우저가 접근하는 Backend API base URL이며 `/api`를 포함해야 합니다. `VITE_ALLOWED_HOSTS`에는 Vite 개발 서버에 접속할 호스트 이름을 지정합니다.

개발 Compose는 호스트 포트를 공개하지 않습니다. `run.bat`이 외부 Docker network `shared-net`을 준비합니다. Frontend와 Backend 컨테이너는 해당 네트워크에 연결된 MySQL 및 reverse proxy에서 다음 주소로 접근할 수 있습니다.

- Frontend container: `http://modbus-frontend:5173`
- Backend health: `http://modbus-backend:3000/api/health`
- 외부 주소는 Cloudflare Tunnel 등 reverse proxy에서 위 컨테이너 주소로 연결합니다.

## 개발 명령

```powershell
docker compose -f docker/dev/docker-compose.yml exec backend npm run db:migrate
docker compose -f docker/dev/docker-compose.yml logs -f frontend backend
docker compose -f docker/dev/docker-compose.yml down
```

### EC2 운영 배포

개발 및 운영 Docker 파일은 `docker/dev`와 `docker/prod` 아래에 각각 모았습니다. 이 절차는 Ubuntu 24.04 EC2에서 호스트 nginx가 TLS와 도메인 라우팅을 맡고, Docker Compose가 Frontend와 Backend를 실행하는 배포를 설명합니다.

#### 1. Docker와 Compose 설치

Ubuntu 패키지로 Docker와 Compose plugin을 설치하고 daemon을 활성화합니다. Ubuntu 제공 패키지를 사용하는 방법은 [Ubuntu Docker 안내](https://ubuntu.com/server/docs/how-to/containers/docker-for-system-admins/)를 참고하세요.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
docker --version
docker compose version
```

`docker`를 `sudo` 없이 실행하려면 EC2 로그인 계정을 Docker 그룹에 추가한 뒤 SSH에서 로그아웃하고 다시 접속합니다.

```bash
sudo usermod -aG docker "$USER"
```

#### 2. 저장소와 운영 환경 설정

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

`docker/prod/run.sh`는 Compose에 root `.env` 경로를 직접 전달하고 `shared-net`이 없으면 생성합니다. 따라서 외부 MySQL 컨테이너가 같은 네트워크를 사용하도록 연결되어 있어야 합니다. MySQL이 EC2 호스트에서 실행된다면 Docker bridge에서 접속 가능한 주소를 `DATABASE_HOST`에 설정해야 합니다.

```bash
./docker/prod/run.sh
```

이 명령은 production 이미지를 빌드하고 Frontend/Backend를 시작한 뒤 Backend의 컴파일된 DB migration을 실행합니다. Frontend와 Backend는 호스트의 `127.0.0.1:5173`, `127.0.0.1:3000`에만 바인딩됩니다. 호스트 nginx는 Docker network에 연결하지 않고 이 loopback 포트로 proxy합니다. `shared-net`은 컨테이너와 외부 DB 컨테이너 간 통신에 사용합니다.

#### 3. 호스트 nginx vhost

Ubuntu nginx 사이트 설정은 `/etc/nginx/sites-available/`에 저장하고 `/etc/nginx/sites-enabled/`에서 활성화합니다. 아래 예시의 두 도메인을 실제 도메인으로 바꿉니다. 한 vhost 파일을 `sites-enabled`에 한 번만 연결해야 하며, 같은 server block을 복사하거나 같은 설정을 다른 파일명으로 중복 활성화하면 `conflicting server name` 경고가 발생합니다.

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
        # Gemini 요청 timeout은 최대 5분이므로 proxy 기본 timeout보다 길게 설정한다.
        proxy_connect_timeout 10s;
        proxy_send_timeout 310s;
        proxy_read_timeout 310s;
    }
}
```

도메인의 A 레코드가 EC2 공인 IP를 가리키고, EC2 Security Group에서 TCP 80과 443 inbound가 허용되어야 합니다. 사이트 설정을 활성화하고 검사한 뒤 nginx를 reload합니다.

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

#### 4. HTTPS와 인증서 자동 갱신

인증서 발급 전 DNS와 HTTP proxy가 정상인지 확인하고, EC2에서 포트 80과 443이 외부에 열려 있는지 확인합니다. Certbot nginx plugin으로 두 도메인 인증서를 발급합니다.

```bash
sudo certbot --nginx -d modbus.example.com -d modbus-api.example.com
sudo nginx -t
sudo systemctl reload nginx
```

HTTP를 HTTPS로 redirect하도록 선택합니다. Ubuntu의 [Certbot 안내](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/)를 참고하세요. Ubuntu 패키지의 Certbot timer가 활성화되어 있는지 확인하고 갱신을 시험합니다.

```bash
systemctl list-timers --all | grep -i certbot
sudo certbot renew --dry-run
```

자동 갱신을 위해 포트 80과 두 도메인의 DNS가 계속 유지되어야 합니다. Certbot nginx plugin은 인증서 갱신이 성공하면 nginx를 자동 reload합니다.

#### 배포와 운영 명령

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

Backend는 Google 인증 설정이 없어도 구성 상태를 Frontend에 표시할 수 있지만 로그인하려면 OIDC 설정이 필요합니다. 개발 Compose는 소스를 bind mount해 변경을 감지합니다. 운영 Compose는 정적 Frontend와 빌드된 Backend를 사용합니다. 두 Compose 모두 MySQL을 생성하지 않으며 외부 MySQL을 `shared-net`에서 사용합니다.

Catalog 첨부 파일은 `catalog_uploads` named volume에 저장됩니다. 해당 volume은 Backend에만 연결되며 Frontend web root에서는 직접 접근할 수 없습니다. Compose의 `down` 명령은 named volume을 삭제하지 않습니다.

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
