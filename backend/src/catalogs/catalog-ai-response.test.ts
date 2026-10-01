import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Ajv from 'ajv'
import type { CatalogAiProposalEnvelope } from '@modbus-manager/device-catalog-domain'
import catalogAiProposalSchema = require('@modbus-manager/device-catalog-domain/schemas/catalog-ai-proposal.schema.json')
import catalogBundleSchema = require('@modbus-manager/device-catalog-domain/schemas/catalog-bundle.schema.json')
import deviceProfileSchema = require('@modbus-manager/device-catalog-domain/schemas/device-profile.schema.json')
import recipeSchema = require('@modbus-manager/device-catalog-domain/schemas/recipe.schema.json')
import catalogBundle = require('@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json')
import { buildCatalogAiPrompt, hasUsableCatalogMeasurement, parseCatalogAiEnvelope, parseCatalogAiGenerationResult } from './catalog-ai.service'
import { CatalogError } from './catalog.error'
import { CATALOG_AI_INSTRUCTIONS, CATALOG_AI_OUTPUT_SCHEMA, CATALOG_AI_PROMPT_VERSION } from './catalog-ai-prompt'
import { CatalogValidationService } from './catalog-validation.service'

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
    const definitions = CATALOG_AI_OUTPUT_SCHEMA.$defs
    const proposal = isRecord(definitions) && isRecord(definitions.catalogAiProposal) ? definitions.catalogAiProposal : undefined
    const properties = proposal && isRecord(proposal.properties) ? proposal.properties : undefined
    assert.deepEqual(properties?.definition, { $ref: '#/$defs/catalogBundle' })
    assert.equal(properties && 'definitionJson' in properties, false)
    assert.equal(isRecord(definitions) && JSON.stringify(definitions.catalogBundle).includes('"additionalProperties":false'), true)
    const recipe = isRecord(definitions) && isRecord(definitions.recipe) ? definitions.recipe : undefined
    const recipeProperties = recipe && isRecord(recipe.properties) ? recipe.properties : undefined
    assert.deepEqual(recipeProperties?.schemaVersion, { enum: ['2.0'] })
    assert.deepEqual(recipeProperties?.outputs, { type: 'array', items: { $ref: '#/$defs/recipe-outputV2' } })
  })

  it('keeps the existing proposal shape and accepts a separate insufficient-evidence result', () => {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(CATALOG_AI_OUTPUT_SCHEMA)
    const proposal = {
      title: 'Example temperature sensor',
      definition: { ...catalogBundle, recipes: catalogBundle.recipes.map((recipe) => ({ ...recipe, schemaVersion: '2.0' })) },
      warnings: [], assumptions: [], sources: [],
    }
    const insufficient = {
      outcome: 'insufficientEvidence',
      missingEvidence: ['modbusProtocol', 'readableMeasurement'],
      reasons: ['제공된 자료에서 Modbus register 표를 찾지 못했습니다.'],
    }

    assert.equal(validate(proposal), true)
    assert.equal(validate(insufficient), true)
    assert.equal(validate({ ...insufficient, definition: {} }), false)
    assert.deepEqual(parseCatalogAiGenerationResult(JSON.stringify(proposal)), proposal)
    assert.deepEqual(parseCatalogAiGenerationResult(JSON.stringify(insufficient)), insufficient)
  })

  it('rejects malformed insufficient-evidence details at the server boundary', () => {
    assert.throws(
      () => parseCatalogAiGenerationResult(JSON.stringify({
        outcome: 'insufficientEvidence',
        missingEvidence: ['unknown'],
        reasons: ['자료가 부족합니다.'],
      })),
      CatalogError,
    )
    assert.throws(
      () => parseCatalogAiGenerationResult(JSON.stringify({
        outcome: 'proposal',
        title: 'Unexpected wrapper', definition: {}, warnings: [], assumptions: [], sources: [],
      })),
      CatalogError,
    )
  })

  it('requires at least one referenced measurement with a bounded read output', () => {
    const validator = new CatalogValidationService()
    const validBundle = validator.validate(catalogBundle)
    const withoutMeasurements = validator.validate({
      ...validBundle,
      profile: { ...validBundle.profile, recipes: { ...validBundle.profile.recipes, measurements: [] } },
    })
    assert.equal(hasUsableCatalogMeasurement(validBundle), true)
    assert.equal(hasUsableCatalogMeasurement(withoutMeasurements), false)
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
    assert.equal(CATALOG_AI_PROMPT_VERSION, '2026-09-30.2')
    assert.match(CATALOG_AI_INSTRUCTIONS, /Do not include generic transport or protocol terms/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /set profile\.manufacturer to exactly "Unknown"/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /do not use "Generic"/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /targetBaud enum values must exactly equal profile\.serial\.supportedBaudRates/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /serverValidationIssues are authoritative/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /Every Recipe schemaVersion must be exactly 2\.0/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /Never emit legacy decoder/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /If Modbus is not evidenced/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /Never treat validCatalogExamples as evidence/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /briefly in Korean/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /must match \^\[a-z0-9\]/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /never use uppercase or camelCase/)
    assert.match(CATALOG_AI_INSTRUCTIONS, /parameter name, saveAs, and output source\.variable follow their separate variable-name contract/)
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
    assert.match(JSON.stringify(prompt.mandatoryContract), /never use uppercase or camelCase/)
    assert.match(revision.acceptanceCriteria[2] ?? '', /identifier formats/)
  })
})
