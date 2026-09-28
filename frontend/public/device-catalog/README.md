# Device Catalog 등록 안내

이 디렉터리는 프런트엔드 실행 엔진이 런타임에 읽는 Modbus 장비 정의를 보관한다. 실행 엔진이 이미 지원하는 Function Code, Step, decoder만 사용하는 표준 장비는 TypeScript 코드를 수정하거나 다시 컴파일하지 않고 Profile/Recipe JSON과 `index.json`만 배포해 추가할 수 있다.

## 파일 구성

장비마다 소문자 ID 디렉터리를 하나 만든다.

```text
device-catalog/
├── index.json
└── example-device/
    ├── profile.json
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
- 측정, 설정 변경과 선택적 action Recipe ID
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
    "measurements": ["example-device.read-measurement"]
  }
}
```

## Recipe v1 지원 범위

지원 Step은 다음 다섯 개로 제한된다.

| Step | 목적 |
|---|---|
| `readHoldingRegisters` | FC03 register 읽기 |
| `writeSingleRegister` | FC06 register 쓰기. signed 입력은 선택적 `encode: { "type": "int16" }`로 2의 보수 변환 |
| `delay` | 설정 적용 대기 |
| `reopenSerial` | 변경된 baudrate로 port 다시 열기 |
| `assertEquals` | 읽은 값 검증 |

지원 decoder는 `uint16`, `int16`, `scale`, `offset`이다. 임의 JavaScript, 함수 이름, 조건문, 반복문과 일반 객체 property 접근은 허용되지 않는다.

측정 Recipe는 현재 Slave ID를 받는 `deviceId` parameter를 사용한다.

설정 변경 서비스가 Recipe를 장비와 무관하게 호출할 수 있도록 parameter 이름은 다음 계약을 사용한다.

- Slave ID 변경: `currentId`, `targetId`
- Baudrate 변경: `deviceId`, `targetBaud`

Slave ID와 baudrate 변경 Recipe는 장비에 설정값을 기록하는 단계까지만 정의한다. 변경 뒤에는 현재 Serial 연결을 종료하고 새 설정으로 다시 연결하며, 응답이 없으면 장비 전원을 완전히 차단했다가 다시 공급하도록 안내한다. 따라서 표준 설정 변경 Recipe에는 `reopenSerial`, 적용 확인용 `readHoldingRegisters`, `assertEquals`를 넣지 않는다. 설정 잠금 해제, 여러 register 쓰기, 저장 명령과 제조사 문서상 필수인 쓰기 사이 `delay`는 사용할 수 있다.

쓰기 응답만으로 장비에 새 설정이 적용되었다고 단정하지 않는다. 장비에 따라 즉시 적용되거나 재연결 또는 전원 재인가가 필요할 수 있으며, Test Device는 새 Slave ID와 baudrate에서 첫 측정 응답을 받은 뒤에만 화면의 현재 설정을 갱신한다.

## 장비 연결 action

`profile.recipes.actions`는 장비 연결 화면에서 사용자가 한 번씩 실행할 기존 Recipe ID 목록이다. 새 Recipe 종류나 action 전용 설정 객체를 만들지 않는다.

- 진단 조회는 `measurement` Recipe로 정의하고 `readHoldingRegisters`, 최소 1개 output을 포함하며 쓰기 Step을 넣지 않는다.
- 설정 작업은 `configuration` Recipe로 정의하고 최소 1개 `writeSingleRegister`를 포함한다.
- 설정값은 주소, 자료형, 배율, 단위, 허용 범위와 적용 조건이 문서로 확인되어 안전한 읽기·쓰기를 함께 제공할 수 있을 때만 공개한다.
- 전극 전압처럼 본질적으로 조회만 하는 진단값은 읽기 전용 action으로 공개할 수 있다.
- action에는 `reopenSerial`을 넣지 않는다. Slave ID와 baudrate 변경은 전용 참조와 재연결 workflow를 사용한다.
- 공장 초기화, 제조사 전용 교정, 불명확한 보정값과 숨은 register 추측은 action으로 등록하지 않는다.

action이 없는 장비는 `actions`를 생략한다. 유효한 action을 등록하면 Test Device가 Recipe parameter와 output을 이용해 입력, 실행과 결과 UI를 자동으로 만든다.

Step ID는 Recipe 안에서만 고유하면 되며 특정 문자열로 고정하지 않는다. 설정 서비스는 실패한 Step의 ID가 아니라 Step type으로 write 실패 여부를 판정한다.

```json
{
  "schemaVersion": "1.0",
  "id": "example-device.read-measurement",
  "name": "Example 장비 측정",
  "kind": "measurement",
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

## 등록 절차

1. 장비 매뉴얼에서 Serial 설정, Slave 범위, register 주소와 값 변환 규칙을 확인한다.
2. Profile과 필요한 Recipe를 새 장비 디렉터리에 작성한다.
3. 모든 파일 ID가 Catalog 전체에서 고유한지 확인한다.
4. `index.json`에 Profile과 Recipe 상대 경로를 추가한다.
5. `npm test`로 Schema, 참조, enum 일치 테스트를 실행한다.
6. `npm run typecheck`와 `npm run build`를 실행한다.
7. 실제 장비에서 측정값을 먼저 검증한 뒤 설정 변경을 검증한다.

JSON 오류에는 파일 URL과 오류 경로가 함께 표시된다. 일부 파일만 유효한 경우에도 기존 Catalog는 부분 교체되지 않는다.

## 프런트엔드 코드 확장이 필요한 경우

다음 요구사항은 JSON 등록만으로 처리하지 말고 실행 엔진을 backward-compatible하게 확장한 뒤 프런트엔드를 배포한다.

- FC04, FC10 등 현재 `ModbusClient`가 지원하지 않는 Function Code
- float32, word swap, string, bit field decoder
- 현재 다섯 Step으로 표현할 수 없는 장비 절차
- 제조사 전용 checksum이나 Modbus RTU가 아닌 framing

Backend Catalog가 추가되더라도 Profile/Recipe 계약과 `DeviceCatalog` 인터페이스는 그대로 유지한다.
