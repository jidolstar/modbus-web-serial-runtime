import { describe, expect, it } from 'vitest'
import { SerialFlowControl, SerialParity } from '../serial/serial-types'
import { CatalogSchemaVersion } from './catalog.types'
import { DeviceProfileSchemaVersion } from './device-profile.types'
import {
  RecipeDecoderType,
  RecipeErrorPolicy,
  RecipeKind,
  RecipeSchemaVersion,
  RecipeStepType,
} from './recipe.types'
import catalogIndexSchema from './schemas/catalog-index.schema.json'
import deviceProfileSchema from './schemas/device-profile.schema.json'
import recipeSchema from './schemas/recipe.schema.json'

/** enum과 JSON Schema 배열을 순서와 무관하게 비교하기 위해 정렬한다. */
function sorted(values: ReadonlyArray<string | number>): Array<string | number> {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)))
}

describe('TypeScript enum과 JSON Schema 일치', () => {
  it('Recipe kind, Step, decoder와 오류 정책 값이 Schema와 정확히 같다', () => {
    const schema = recipeSchema as unknown as {
      properties: {
        schemaVersion: { const: string }
        kind: { enum: string[] }
        steps: { items: { oneOf: Array<{ $ref: string }> } }
        onError: { const: string }
      }
      definitions: Record<string, unknown> & {
        output: { properties: { decoder: { enum: string[] } } }
      }
    }
    const schemaStepTypes = schema.properties.steps.items.oneOf.map(({ $ref }) => {
      const definitionName = $ref.split('/').at(-1)!
      const definition = schema.definitions[definitionName] as { properties: { type: { const: string } } }
      return definition.properties.type.const
    })

    expect(sorted(schema.properties.kind.enum)).toEqual(sorted(Object.values(RecipeKind)))
    expect(sorted(schemaStepTypes)).toEqual(sorted(Object.values(RecipeStepType)))
    expect(sorted(schema.definitions.output.properties.decoder.enum))
      .toEqual(sorted(Object.values(RecipeDecoderType)))
    expect(schema.properties.onError.const).toBe(RecipeErrorPolicy.Stop)
    expect(schema.properties.schemaVersion.const).toBe(RecipeSchemaVersion.Version1)
  })

  it('Profile Serial enum과 모든 Catalog schemaVersion 값이 TypeScript 계약과 같다', () => {
    const profileSchema = deviceProfileSchema as unknown as {
      properties: { schemaVersion: { const: string } }
      definitions: {
        serialConfig: { properties: { parity: { enum: string[] }; flowControl: { enum: string[] } } }
      }
    }
    const indexSchema = catalogIndexSchema as unknown as {
      properties: { schemaVersion: { const: string } }
    }

    expect(sorted(profileSchema.definitions.serialConfig.properties.parity.enum))
      .toEqual(sorted(Object.values(SerialParity)))
    expect(sorted(profileSchema.definitions.serialConfig.properties.flowControl.enum))
      .toEqual(sorted(Object.values(SerialFlowControl)))
    expect(profileSchema.properties.schemaVersion.const).toBe(DeviceProfileSchemaVersion.Version1)
    expect(indexSchema.properties.schemaVersion.const).toBe(CatalogSchemaVersion.Version1)
  })
})
