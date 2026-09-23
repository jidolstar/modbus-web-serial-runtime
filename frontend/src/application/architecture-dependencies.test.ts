import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 이 테스트 파일의 상위 디렉터리인 frontend/src 절대 경로다. */
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 상위 계층이 의존할 수 있는 동일/하위 계층 목록이다. */
const ALLOWED_LAYER_DEPENDENCIES: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  serial: ['serial'],
  http: ['http'],
  modbus: ['modbus', 'serial'],
  'device-catalog': ['device-catalog', 'serial', 'http'],
  'recipe-engine': ['recipe-engine', 'device-catalog', 'modbus', 'serial'],
  application: ['application', 'device-catalog', 'recipe-engine', 'modbus', 'serial'],
  features: ['features', 'application', 'device-catalog', 'recipe-engine', 'modbus', 'serial'],
})

/** 디렉터리를 재귀 순회해 production TypeScript 파일만 수집한다. */
function collectProductionTypeScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const absolutePath = resolve(directory, entry)
    if (statSync(absolutePath).isDirectory()) {
      files.push(...collectProductionTypeScriptFiles(absolutePath))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && entry !== 'env.d.ts') {
      files.push(absolutePath)
    }
  }
  return files
}

/** source의 상대 import를 실제 production TypeScript 파일 절대 경로로 변환한다. */
function resolveLocalImports(sourceFile: string): string[] {
  const source = readFileSync(sourceFile, 'utf8')
  const importSpecifiers = [...source.matchAll(/(?:from\s+|import\s+)['"](\.[^'"]+)['"]/g)]
    .map((match) => match[1])
  return importSpecifiers.flatMap((specifier) => {
    const candidateBase = resolve(dirname(sourceFile), specifier)
    const candidates = [`${candidateBase}.ts`, resolve(candidateBase, 'index.ts')]
    const resolvedFile = candidates.find((candidate) => existsSync(candidate))
    return resolvedFile ? [resolvedFile] : []
  })
}

/** src 바로 아래 디렉터리 이름을 architecture layer로 사용한다. */
function getLayer(file: string): string | null {
  const firstSegment = relative(SOURCE_ROOT, file).split(sep)[0]
  return firstSegment.endsWith('.ts') ? null : firstSegment
}

describe('프런트엔드 계층 의존성', () => {
  const productionFiles = collectProductionTypeScriptFiles(SOURCE_ROOT)
  const importGraph = new Map(productionFiles.map((file) => [file, resolveLocalImports(file)]))

  it('하위 통신 계층이 application이나 feature 계층을 역참조하지 않는다', () => {
    const violations: string[] = []
    for (const [sourceFile, targetFiles] of importGraph) {
      const sourceLayer = getLayer(sourceFile)
      if (!sourceLayer || !(sourceLayer in ALLOWED_LAYER_DEPENDENCIES)) continue
      for (const targetFile of targetFiles) {
        const targetLayer = getLayer(targetFile)
        if (targetLayer && !ALLOWED_LAYER_DEPENDENCIES[sourceLayer].includes(targetLayer)) {
          violations.push(
            `${relative(SOURCE_ROOT, sourceFile)} -> ${relative(SOURCE_ROOT, targetFile)}`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('production TypeScript import graph에 순환 의존성이 없다', () => {
    const visited = new Set<string>()
    const activePath = new Set<string>()
    const cycles: string[] = []

    const visit = (file: string, path: string[]): void => {
      if (activePath.has(file)) {
        cycles.push([...path, file].map((item) => relative(SOURCE_ROOT, item)).join(' -> '))
        return
      }
      if (visited.has(file)) return
      visited.add(file)
      activePath.add(file)
      for (const dependency of importGraph.get(file) ?? []) visit(dependency, [...path, file])
      activePath.delete(file)
    }

    for (const file of productionFiles) visit(file, [])
    expect(cycles).toEqual([])
  })
})
