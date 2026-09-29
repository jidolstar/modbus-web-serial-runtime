import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Ajv from 'ajv'
import type { CatalogAiProposalEnvelope } from '@modbus-manager/device-catalog-domain'
import catalogAiProposalSchema = require('@modbus-manager/device-catalog-domain/schemas/catalog-ai-proposal.schema.json')
import catalogBundleSchema = require('@modbus-manager/device-catalog-domain/schemas/catalog-bundle.schema.json')
import deviceProfileSchema = require('@modbus-manager/device-catalog-domain/schemas/device-profile.schema.json')
import recipeSchema = require('@modbus-manager/device-catalog-domain/schemas/recipe.schema.json')
import catalogBundle = require('@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json')
import { buildCatalogAiPrompt, parseCatalogAiEnvelope } from './catalog-ai.service'
import { CatalogError } from './catalog.error'
import { CATALOG_AI_INSTRUCTIONS, CATALOG_AI_OUTPUT_SCHEMA, CATALOG_AI_PROMPT_VERSION } from './catalog-ai-prompt'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('Catalog AI response parsing', () => {
  it('keeps valid HTTPS sources and warns instead of failing on a PDF pseudo URL', () => {
    const proposal = parseCatalogAiEnvelope(JSON.stringify({
      title: 'Example sensor', definition: {}, warnings: [], assumptions: [],
      sources: [
        { title: 'Uploaded manual.pdf', url: 'manual.pdf' },
        { title: 'Manufacturer', url: 'https://example.com/manual' },
      ],
    }))

    assert.deepEqual(proposal.sources, [{ title: 'Manufacturer', url: 'https://example.com/manual' }])
    assert.equal(proposal.warnings.length, 1)
    assert.match(proposal.warnings[0] ?? '', /Uploaded manual\.pdf/)
  })

  it('rejects the old free-form definitionJson envelope', () => {
    assert.throws(
      () => parseCatalogAiEnvelope(JSON.stringify({ title: 'Old', definitionJson: '{}', warnings: [], assumptions: [], sources: [] })),
      CatalogError,
    )
  })

  it('binds the structured output definition to the CatalogBundle schema', () => {
    const properties = CATALOG_AI_OUTPUT_SCHEMA.properties
    const definitions = CATALOG_AI_OUTPUT_SCHEMA.$defs
    assert.equal(isRecord(properties), true)
    assert.deepEqual(isRecord(properties) ? properties.definition : undefined, { $ref: '#/$defs/catalogBundle' })
    assert.equal(isRecord(properties) && 'definitionJson' in properties, false)
    assert.equal(isRecord(definitions) && JSON.stringify(definitions.catalogBundle).includes('"additionalProperties":false'), true)
    const recipe = isRecord(definitions) && isRecord(definitions.recipe) ? definitions.recipe : undefined
    const recipeProperties = recipe && isRecord(recipe.properties) ? recipe.properties : undefined
    assert.deepEqual(recipeProperties?.schemaVersion, { enum: ['2.0'] })
    assert.deepEqual(recipeProperties?.outputs, { type: 'array', items: { $ref: '#/$defs/recipe-outputV2' } })
  })

  it('accepts only Recipe 2.0 and v2 outputs in the Gemini response contract', () => {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(CATALOG_AI_OUTPUT_SCHEMA)
    const currentDefinition = {
      ...catalogBundle,
      recipes: catalogBundle.recipes.map((recipe) => ({ ...recipe, schemaVersion: '2.0' })),
    }
    const envelope = { title: 'Example temperature sensor', definition: currentDefinition, warnings: [], assumptions: [], sources: [] }
    const firstRecipe = currentDefinition.recipes[0]!
    const legacyDefinition = {
      ...currentDefinition,
      recipes: [{
        ...firstRecipe,
        outputs: [{ name: 'humidity', source: 'measurementRegisters[0]', decoder: 'uint16', scale: 0.1, unit: '%RH' }],
      }, ...currentDefinition.recipes.slice(1)],
    }

    assert.equal(validate(envelope), true)
    assert.equal(validate({ ...envelope, definition: legacyDefinition }), false)
  })

  it('validates the shared AI envelope contract and rejects extra fields', () => {
    const ajv = new Ajv({ allErrors: true, strict: true })
    ajv.addSchema(deviceProfileSchema)
    ajv.addSchema(recipeSchema)
    ajv.addSchema(catalogBundleSchema)
    const validate = ajv.compile<CatalogAiProposalEnvelope>(catalogAiProposalSchema)
    const envelope = { title: 'Example temperature sensor', definition: catalogBundle, warnings: [], assumptions: [], sources: [] }

    assert.equal(validate(envelope), true)
    assert.equal(validate({ ...envelope, unexpected: true }), false)
    assert.equal(validate({ ...envelope, sources: [{ title: 'Manual' }] }), false)
    assert.equal(validate({ ...envelope, definition: {} }), false)
  })

  it('keeps generic protocol names out of generated identity fields', () => {
    assert.equal(CATALOG_AI_PROMPT_VERSION, '2026-09-29.5')
    assert.match(CATALOG_AI_INSTRUCTIONS, /Do not include generic transport or protocol terms/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /set profile\.manufacturer to exactly "Unknown"/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /do not use "Generic"/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /targetBaud enum values must exactly equal profile\.serial\.supportedBaudRates/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /serverValidationIssues are authoritative/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /Every Recipe schemaVersion must be exactly 2\.0/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /Never emit legacy decoder/)
  })

  it('turns server validation issues into mandatory revision acceptance criteria', () => {
    const prompt = JSON.parse(buildCatalogAiPrompt({
      requirements: '공식 문서를 따릅니다.',
      referenceUrls: [],
      revisionInstruction: '검증 오류를 수정해 주세요.',
      previousProposal: {
        validation: {
          issues: [{ path: '/recipes/0/outputs/0/source', message: '값의 형식이 object이어야 합니다.' }],
        },
      },
    }, [])) as Record<string, unknown>
    const revision = prompt.revision as { serverValidationIssues: readonly unknown[]; acceptanceCriteria: readonly string[] }

    assert.equal(revision.serverValidationIssues.length, 1)
    assert.equal(revision.acceptanceCriteria.length, 3)
    assert.match(JSON.stringify(prompt.mandatoryContract), /Only v2 output is allowed/)
  })
})
