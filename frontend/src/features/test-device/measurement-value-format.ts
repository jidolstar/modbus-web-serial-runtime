const MAXIMUM_DISPLAY_FRACTION_DIGITS = 12 // Intl.NumberFormat가 허용하는 범위 안에서 비정상적으로 긴 표시를 막는 상한이다.
interface LegacyNumericPrecision { readonly scale?: number; readonly offset?: number }

/** Catalog의 scale·offset 정밀도를 계산해 IEEE 754 연산 찌꺼기를 화면에서만 제거한다. */
function decimalPlaces(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || Number.isInteger(value)) return 0
  const [coefficient, exponentText] = value.toString().toLowerCase().split('e')
  const coefficientDigits = coefficient.split('.')[1]?.length ?? 0
  const exponent = exponentText === undefined ? 0 : Number(exponentText)
  return Math.max(0, coefficientDigits - exponent)
}

/** Test Device 측정 카드가 원본 numeric value를 보존하면서 사람이 읽을 문자열로 변환할 때 사용한다. */
export function formatMeasurementValue(value: number, output: LegacyNumericPrecision | undefined): string {
  const fractionDigits = Math.min(
    MAXIMUM_DISPLAY_FRACTION_DIGITS,
    Math.max(decimalPlaces(output?.scale), decimalPlaces(output?.offset)),
  )
  return new Intl.NumberFormat('ko-KR', {
    // Catalog가 선언한 측정 정밀도를 사용자가 확인할 수 있도록 정수 결과에도 후행 0을 유지한다.
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: false,
  }).format(value)
}
