# Modbus Web Serial Runtime

Web Serial API에서 Profile/Recipe 기반으로 Modbus RTU 장비를 실행하는 프런트엔드 런타임입니다.

표준적인 Modbus 장비는 실행 엔진이 지원하는 Step과 decoder 범위 안에서 JSON Profile/Recipe 등록만으로 추가할 수 있습니다.

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
초기 단계에서는 통신 기반을 먼저 검증하기 위해 데이터베이스를 포함하지 않습니다.

두 서비스는 호스트 포트를 공개하지 않고 외부 Docker 네트워크 `shared-net`에만 연결됩니다.
Cloudflare Tunnel의 서비스 대상은 `http://modbus-frontend:5173`과
`http://modbus-backend:3000`입니다.

## 장비 등록

Profile과 Recipe 작성 방법은 [Device Catalog 등록 안내](frontend/public/device-catalog/README.md)를 참고합니다.

## 라이선스

Apache License 2.0을 적용합니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.
