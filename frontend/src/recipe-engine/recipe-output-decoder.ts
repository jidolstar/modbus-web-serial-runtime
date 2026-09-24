import {
  RecipeDecoderType, RecipeRegisterByteOrder, RecipeRegisterOrder, RecipeStringTrim,
  type RecipeOutput, type RecipeOutputV2,
} from '../device-catalog/recipe.types'
import { RecipeExecutionError } from './recipe-execution-errors'
import type { RecipeContextValue, RecipeNamedOutput } from './recipe-execution.types'
import { RecipeOutputFormatterRegistry, recipeOutputFormatterRegistry, type RecipeDecodedValue } from './recipe-output-formatter'
import { normalizeRecipeOutput } from './recipe-output-normalizer'

const UINT16_MAX = 0xffff
const MAX_TEXT_BYTES = 256

function expectedRegisterCount(type: RecipeDecoderType): number | null {
  if ([RecipeDecoderType.Unsigned16, RecipeDecoderType.Signed16, RecipeDecoderType.Bit].includes(type)) return 1
  if ([RecipeDecoderType.Unsigned32, RecipeDecoderType.Signed32, RecipeDecoderType.Float32].includes(type)) return 2
  if (type === RecipeDecoderType.Float64) return 4
  return null
}

function toBytes(registers: ReadonlyArray<number>, output: RecipeOutputV2, recipeId: string): Uint8Array {
  const lowWordFirst = 'registerOrder' in output.decode && output.decode.registerOrder === RecipeRegisterOrder.LowWordFirst
  const ordered = lowWordFirst ? [...registers].reverse() : [...registers]
  const bytes = new Uint8Array(ordered.length * 2)
  ordered.forEach((register, index) => {
    if (!Number.isInteger(register) || register < 0 || register > UINT16_MAX) throw new RecipeExecutionError(`16-bit register 값이 아닙니다: ${register}`, recipeId)
    const high = register >>> 8
    const low = register & 0xff
    const lowByteFirst = 'byteOrder' in output.decode && output.decode.byteOrder === RecipeRegisterByteOrder.LowByteFirst
    bytes[index * 2] = lowByteFirst ? low : high
    bytes[(index * 2) + 1] = lowByteFirst ? high : low
  })
  return bytes
}

function decodeAscii(bytes: Uint8Array, trim: RecipeStringTrim | undefined, recipeId: string): string {
  if (bytes.length > MAX_TEXT_BYTES) throw new RecipeExecutionError(`ASCII output은 ${MAX_TEXT_BYTES} bytes를 넘을 수 없습니다.`, recipeId)
  let text = String.fromCharCode(...bytes)
  if (trim === RecipeStringTrim.Null) text = text.replace(/\0+$/u, '')
  if (trim === RecipeStringTrim.NullAndSpace) text = text.replace(/[\0 ]+$/u, '')
  if ([...text].some((character) => character !== '\0' && (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) > 0x7e))) {
    throw new RecipeExecutionError('ASCII output에 표시할 수 없는 문자가 있습니다.', recipeId)
  }
  return text
}

function decodeValue(output: RecipeOutputV2, registers: ReadonlyArray<number>, recipeId: string): RecipeDecodedValue {
  const expected = expectedRegisterCount(output.decode.type)
  if (expected !== null && registers.length !== expected) throw new RecipeExecutionError(`${output.decode.type} decoder에는 register ${expected}개가 필요합니다.`, recipeId)
  if (output.decode.type === RecipeDecoderType.Bit) return (registers[0] & (1 << output.decode.bitIndex)) !== 0
  const bytes = toBytes(registers, output, recipeId)
  if (output.decode.type === RecipeDecoderType.Ascii) return decodeAscii(bytes, output.decode.trim, recipeId)
  if (output.decode.type === RecipeDecoderType.Hex) return [...bytes].map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join(' ')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (output.decode.type) {
    case RecipeDecoderType.Unsigned16: return view.getUint16(0, false)
    case RecipeDecoderType.Signed16: return view.getInt16(0, false)
    case RecipeDecoderType.Unsigned32: return view.getUint32(0, false)
    case RecipeDecoderType.Signed32: return view.getInt32(0, false)
    case RecipeDecoderType.Float32: return view.getFloat32(0, false)
    case RecipeDecoderType.Float64: return view.getFloat64(0, false)
    default: throw new RecipeExecutionError('지원하지 않는 decoder입니다.', recipeId)
  }
}

/** register slice를 decode하고 숫자에만 transform을 적용한 뒤 안전한 formatter로 표시 값을 만든다. */
export class RecipeOutputDecoder {
  public constructor(private readonly formatter = recipeOutputFormatterRegistry) {}

  public decode(outputContract: RecipeOutput, context: ReadonlyMap<string, RecipeContextValue>, recipeId: string): RecipeNamedOutput {
    const output = normalizeRecipeOutput(outputContract, recipeId)
    const source = context.get(output.source.variable)
    const registers = Array.isArray(source) ? source.slice(output.source.start, output.source.start + output.source.count) : []
    if (registers.length !== output.source.count) throw new RecipeExecutionError(`Output source를 찾을 수 없습니다: ${output.source.variable}[${output.source.start}]`, recipeId)
    let value = decodeValue(output, registers, recipeId)
    if (output.transform) {
      if (typeof value !== 'number') throw new RecipeExecutionError('scale/offset은 숫자 decoder에만 사용할 수 있습니다.', recipeId)
      value = (value * (output.transform.scale ?? 1)) + (output.transform.offset ?? 0)
      if (!Number.isFinite(value)) throw new RecipeExecutionError('scale/offset 적용 결과가 유한한 숫자가 아닙니다.', recipeId)
    }
    const fractionHint = RecipeOutputFormatterRegistry.fractionHint(output.transform?.scale, output.transform?.offset)
    return Object.freeze({ value, display: this.formatter.format(value, output.format, recipeId, fractionHint) })
  }
}
