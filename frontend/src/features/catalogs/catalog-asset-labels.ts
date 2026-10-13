const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  communication_protocol: '통신 프로토콜',
  manual: '매뉴얼',
  datasheet: '데이터시트',
  reference_image: '참고 이미지',
  other: '기타',
}

const LINK_TYPE_LABELS: Readonly<Record<string, string>> = {
  official_website: '공식 홈페이지',
  manufacturer_page: '제조사 페이지',
  documentation: '문서',
  reference: '참고 자료',
  retailer: '판매처',
}

/** 저장된 코드값을 목록에서 한국어 유형명으로 표시하고, 알 수 없는 값은 원문을 보존한다. */
export function documentTypeLabel(value: string): string {
  return DOCUMENT_TYPE_LABELS[value] ?? value
}

export function linkTypeLabel(value: string): string {
  return LINK_TYPE_LABELS[value] ?? value
}
