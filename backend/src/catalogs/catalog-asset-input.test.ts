import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCatalogFileFields, parseCatalogLinkInput } from './catalog-asset-input'
import { CatalogError } from './catalog.error'

describe('Catalog asset input', () => {
  it('accepts a public HTTPS reference link', () => {
    assert.deepEqual(parseCatalogLinkInput({ title: '제품 페이지', linkType: 'official_website', url: 'https://example.com/product' }), {
      title: '제품 페이지', linkType: 'official_website', url: 'https://example.com/product',
    })
    assert.equal(parseCatalogLinkInput({ title: '공식 판매처', linkType: 'retailer', url: 'https://shop.example.com/product' }).linkType, 'retailer')
  })

  it('rejects credential, HTTP, localhost and IP links', () => {
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://localhost/page', 'https://127.0.0.1/page', 'https://192.168.1.10/page', 'https://[::1]/page']) {
      assert.throws(() => parseCatalogLinkInput({ title: '참고', linkType: 'reference', url }), CatalogError)
    }
  })

  it('accepts only named document types and fields', () => {
    assert.deepEqual(parseCatalogFileFields({ title: '통신 규격', documentType: 'communication_protocol' }), {
      title: '통신 규격', documentType: 'communication_protocol',
    })
    assert.throws(() => parseCatalogFileFields({ title: '문서', documentType: 'executable' }), CatalogError)
  })

  it('rejects an unknown link type', () => {
    assert.throws(() => parseCatalogLinkInput({ title: '알 수 없는 유형', linkType: 'marketplace', url: 'https://example.com/product' }), CatalogError)
  })
})
