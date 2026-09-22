# Device Catalog 등록 안내

이 디렉터리는 프런트엔드 실행 엔진이 런타임에 읽는 Modbus 장비 정의를 보관한다. 실행 엔진이 이미 지원하는 Function Code, Step, decoder만 사용하는 표준 장비는 TypeScript 코드를 수정하거나 다시 컴파일하지 않고 Profile/Recipe JSON과 `index.json`만 배포해 추가할 수 있다.

## 파일 구성

장비마다 소문자 ID 디렉터리를 하나 만든다.

```text
device-catalog/
├── index.json
└── example-device/
    ├── profile.json
    ├── probe.recipe.json
    ├── read-measurement.recipe.json
    ├── change-slave-id.recipe.json       # 지원할 때만 작성
    └── change-baudrate.recipe.json       # 지원할 때만 작성
```

파일을 만든 뒤 `index.json`의 `profiles`와 `recipes`에 상대 경로를 등록한다. Catalog는 index와 모든 참조 파일이 전부 유효할 때만 새 정의를 공개한다.

## Profile 역할

`profile.json`에는 장비의 정적인 차이만 기록한다.

- 제조사와 모델
- 기본 Serial 설정과 지원 baudrate
- Slave ID 기본값과 범위
- Probe, 측정, 설정 변경 Recipe ID
- Baudrate register code처럼 장비별로 다른 named map

register 주소, scale 또는 장비별 delay를 TypeScript 상수나 `.env`로 옮기지 않는다. 각각 사용하는 Recipe에 기록한다.

```json
{
  "schemaVersion": "1.0",
  "id": "example-device",
  "manufacturer": "Example",
  "model": "TH-01",
  "serial": {
    "default": {
      "baudRate": 9600,
      "dataBits": 8,
      "stopBits": 1,
      "parity": "none",
      "flowControl": "none"
    },
    "supportedBaudRates": [4800, 9600]
  },
  "slave": { "defaultId": 1, "minId": 1, "maxId": 247 },
  "recipes": {
    "probe": "example-device.probe",
    "measurements": ["example-device.read-measurement"]
  }
}
```

## Recipe v1 지원 범위

지원 Step은 다음 여섯 개로 제한된다.

| Step | 목적 |
|---|---|
| `readHoldingRegisters` | FC03 register 읽기 |
| `writeSingleRegister` | FC06 register 쓰기 |
| `delay` | 설정 적용 대기 |
| `reopenSerial` | 변경된 baudrate로 port 다시 열기 |
| `probe` | Profile의 read-only Probe 실행 |
| `assertEquals` | 읽은 값 검증 |

지원 decoder는 `uint16`, `int16`, `scale`, `offset`이다. 임의 JavaScript, 함수 이름, 조건문, 반복문과 일반 객체 property 접근은 허용되지 않는다.

측정과 Probe Recipe는 현재 Slave ID를 받는 `deviceId` parameter를 사용한다.

설정 변경 서비스가 Recipe를 장비와 무관하게 호출할 수 있도록 parameter 이름은 다음 계약을 사용한다.

- Slave ID 변경: `currentId`, `targetId`
- Baudrate 변경: `deviceId`, `targetBaud`

Step ID는 Recipe 안에서만 고유하면 되며 특정 문자열로 고정하지 않는다. 설정 서비스는 실패한 Step의 ID가 아니라 Step type으로 write 실패 여부를 판정한다.

```json
{
  "schemaVersion": "1.0",
  "id": "example-device.probe",
  "name": "Example 장비 확인",
  "kind": "probe",
  "parameters": [
    { "name": "deviceId", "type": "integer", "minimum": 1, "maximum": 247 }
  ],
  "steps": [
    {
      "id": "read-status",
      "type": "readHoldingRegisters",
      "slaveId": "${deviceId}",
      "address": 0,
      "count": 1,
      "saveAs": "statusRegisters"
    }
  ],
  "onError": "stop"
}
```

Probe는 Scan과 설정 검증에 사용되므로 `kind`가 `probe`여야 하며 `readHoldingRegisters` Step만 포함할 수 있다. Probe에 Write를 넣으면 Catalog 로딩이 거부된다.

## 등록 절차

1. 장비 매뉴얼에서 Serial 설정, Slave 범위, register 주소와 값 변환 규칙을 확인한다.
2. Profile과 필요한 Recipe를 새 장비 디렉터리에 작성한다.
3. 모든 파일 ID가 Catalog 전체에서 고유한지 확인한다.
4. `index.json`에 Profile과 Recipe 상대 경로를 추가한다.
5. `npm test`로 Schema, 참조, enum 일치 테스트를 실행한다.
6. `npm run typecheck`와 `npm run build`를 실행한다.
7. 실제 장비에서 Probe와 측정값을 먼저 검증한 뒤 설정 변경을 검증한다.

JSON 오류에는 파일 URL과 오류 경로가 함께 표시된다. 일부 파일만 유효한 경우에도 기존 Catalog는 부분 교체되지 않는다.

## 프런트엔드 코드 확장이 필요한 경우

다음 요구사항은 JSON 등록만으로 처리하지 말고 실행 엔진을 backward-compatible하게 확장한 뒤 프런트엔드를 배포한다.

- FC04, FC10 등 현재 `ModbusClient`가 지원하지 않는 Function Code
- float32, word swap, string, bit field decoder
- 현재 여섯 Step으로 표현할 수 없는 장비 절차
- 제조사 전용 checksum이나 Modbus RTU가 아닌 framing

Backend Catalog가 추가되더라도 Profile/Recipe 계약과 `DeviceCatalog` 인터페이스는 그대로 유지한다.
