import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const readClientFile = (path: string) => readFileSync(resolve(root, 'src/client', path), 'utf8')

describe('generated API module boundaries', () => {
  it('keeps the type map free of the runtime descriptor aggregate', () => {
    const source = readClientFile('api-types-map.gen.ts')

    expect(source).toContain('export interface ApiEndpointDescriptor')
    expect(source).toContain('export type RootControllerPingApiType')
    expect(source).not.toContain('export const ApiTypesMap')
    expect(source).not.toContain('export const RootControllerPing =')
  })

  it('co-locates each service with its controller descriptor module', () => {
    const descriptors = readClientFile('api-descriptors/auth-controller.gen.ts')
    const service = readClientFile('services/auth-controller.gen.ts')

    expect(descriptors).toContain('export const AuthControllerLogin =')
    expect(service).toContain("from '../api-descriptors/auth-controller.gen'")
    expect(service).not.toContain("from '../api-types-map.gen'\n\nexport const")
  })
})
