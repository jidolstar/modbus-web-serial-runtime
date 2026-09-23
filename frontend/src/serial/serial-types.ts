export {
  SerialFlowControl,
  SerialParity,
  type SerialConfig,
} from '@modbus-manager/device-catalog-domain'

/** 수신 byte chunk를 전달받는 callback이다. */
export type SerialDataListener = (receivedBytes: Uint8Array) => void

/** 등록했던 event listener를 제거하는 함수다. */
export type Unsubscribe = () => void
