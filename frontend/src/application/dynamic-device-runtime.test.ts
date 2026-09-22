import { describe, expect, it } from 'vitest'
import profileJson from '../../public/device-catalog/cwt-th04s/profile.json'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { DeviceProfile, DeviceProfileSummary } from '../device-catalog/device-profile.types'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import type { Recipe } from '../device-catalog/recipe.types'
import { RecipeExecutionStatus, type RecipeExecutionResult } from '../recipe-engine/recipe-execution.types'
import { SerialConnectionState } from '../serial/serial-connection-state'
import { MockSerialTransport } from '../serial/testing/mock-serial-transport'
import { DynamicDeviceRuntime } from './dynamic-device-runtime'
import type {
  SensorMonitorControl,
  SensorMonitorObserver,
  SensorMonitorRequest,
} from './sensor-monitor'

/** Runtime orchestration만 검증할 수 있도록 Profile 하나를 제공하는 Catalog다. */
class RuntimeTestCatalog implements DeviceCatalog {
  public loadCount = 0

  public constructor(private readonly profile: DeviceProfile) {}

  public async load(): Promise<void> { this.loadCount += 1 }

  public getProfile(profileId: string): DeviceProfile {
    if (profileId !== this.profile.id) throw new Error('Profile not found')
    return this.profile
  }

  public getRecipe(_recipeId: string): Recipe {
    throw new Error('Runtime orchestration test에서는 Recipe 조회를 사용하지 않습니다.')
  }

  public listProfiles(): ReadonlyArray<DeviceProfileSummary> {
    return [{ id: this.profile.id, manufacturer: this.profile.manufacturer, model: this.profile.model }]
  }
}

/** start/stop 호출과 observer를 보관하는 SensorMonitor test double이다. */
class RecordingSensorMonitor implements SensorMonitorControl {
  public readonly starts: SensorMonitorRequest[] = []
  public stopCount = 0
  public observer: SensorMonitorObserver | null = null

  public start(request: SensorMonitorRequest, observer: SensorMonitorObserver): void {
    this.starts.push(request)
    this.observer = observer
  }

  public stop(): void { this.stopCount += 1 }
}

/** JSON fixture를 Runtime이 사용하는 검증된 Profile 타입으로 변환한다. */
function createProfile(): DeviceProfile {
  return new DeviceProfileValidator().validateDeviceProfile(profileJson, 'profile.json')
}

describe('DynamicDeviceRuntime', () => {
  it('Profile 연결 설정으로 port를 열고 첫 measurement Recipe session을 시작한다', async () => {
    const catalog = new RuntimeTestCatalog(createProfile())
    const transport = new MockSerialTransport()
    const monitor = new RecordingSensorMonitor()
    const runtime = new DynamicDeviceRuntime(catalog, transport, monitor)

    await runtime.connect({ profileId: 'cwt-th04s', slaveId: 100, baudRate: 9600 })

    expect(catalog.loadCount).toBe(1)
    expect(runtime.snapshot.connectionState).toBe(SerialConnectionState.Connected)
    expect(monitor.starts).toEqual([{
      profileId: 'cwt-th04s',
      recipeId: 'cwt-th04s.read-measurement',
      parameters: { deviceId: 100 },
    }])
  })

  it('측정 결과를 snapshot에 반영하고 물리 분리 시 polling session을 정리한다', async () => {
    const transport = new MockSerialTransport()
    const monitor = new RecordingSensorMonitor()
    const runtime = new DynamicDeviceRuntime(
      new RuntimeTestCatalog(createProfile()),
      transport,
      monitor,
    )
    await runtime.connect({ profileId: 'cwt-th04s', slaveId: 100, baudRate: 9600 })
    const measurement: RecipeExecutionResult = Object.freeze({
      recipeId: 'cwt-th04s.read-measurement',
      status: RecipeExecutionStatus.Succeeded,
      steps: Object.freeze([]),
      outputs: Object.freeze({ temperature: Object.freeze({ value: 32, unit: '°C' }) }),
      context: Object.freeze({}),
    })

    monitor.observer?.onMeasurement(measurement)
    expect(runtime.snapshot.outputs.temperature.value).toBe(32)

    const stopCountBeforeRemoval = monitor.stopCount
    transport.simulateDeviceRemoval()
    expect(runtime.snapshot.connectionState).toBe(SerialConnectionState.Disconnected)
    expect(monitor.stopCount).toBeGreaterThan(stopCountBeforeRemoval)
    expect(runtime.snapshot.error).toBeInstanceOf(Error)
  })

  it('재연결할 때 이전 session을 재사용하지 않고 monitor를 다시 시작한다', async () => {
    const transport = new MockSerialTransport()
    const monitor = new RecordingSensorMonitor()
    const runtime = new DynamicDeviceRuntime(
      new RuntimeTestCatalog(createProfile()),
      transport,
      monitor,
    )
    const request = { profileId: 'cwt-th04s', slaveId: 100, baudRate: 9600 }

    await runtime.connect(request)
    transport.simulateDeviceRemoval()
    await runtime.connect(request)

    expect(monitor.starts).toHaveLength(2)
    expect(runtime.snapshot.connectionState).toBe(SerialConnectionState.Connected)
  })

  it('Profile이 지원하지 않는 연결값은 port 선택 전에 거부한다', async () => {
    const transport = new MockSerialTransport()
    const monitor = new RecordingSensorMonitor()
    const runtime = new DynamicDeviceRuntime(
      new RuntimeTestCatalog(createProfile()),
      transport,
      monitor,
    )

    await expect(runtime.connect({
      profileId: 'cwt-th04s',
      slaveId: 100,
      baudRate: 19200,
    })).rejects.toThrowError(/지원하지 않는 baudrate/)
    expect(transport.connectionState).toBe(SerialConnectionState.Idle)
    expect(monitor.starts).toHaveLength(0)
  })
})
