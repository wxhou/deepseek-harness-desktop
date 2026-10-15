import type { PlatformLoader } from '../types'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as zodModule from 'zod'
import { loadRuntimeZod } from './runtime-modules'

afterEach(() => vi.restoreAllMocks())

describe('official runtime Zod resolution', () => {
  it.each([
    ['ESM named exports', zodModule],
    ['CommonJS default exports', { default: zodModule }],
    ['transpiled nested default exports', { default: { __esModule: true, default: zodModule } }],
  ])('returns the host Zod instance from %s using the real official export normalizer', async (_, namespace) => {
    const loader: PlatformLoader = {
      import: vi.fn(async () => namespace),
      unwrapExports: value => Loader.prototype.unwrapExports(value),
    }
    expect(await loadRuntimeZod(loader)).toBe(zodModule.z)
    expect(loader.import).toHaveBeenCalledExactlyOnceWith('zod')
  })

  it('prefers the named Zod namespace rather than treating its default object as a plugin', async () => {
    const loader: PlatformLoader = {
      import: vi.fn(async () => ({ z: zodModule.z, default: {} })),
      unwrapExports: vi.fn(() => { throw new Error('named Zod should not be unwrapped') }),
    }
    expect(await loadRuntimeZod(loader)).toBe(zodModule.z)
    expect(loader.unwrapExports).not.toHaveBeenCalled()
  })

  it.each([undefined, null, {}, { z: {} }, { default: { z: { object: () => {} } } }])('rejects incomplete host exports without silently importing a local copy: %j', async (namespace) => {
    const loader: PlatformLoader = {
      import: vi.fn(async () => namespace),
      unwrapExports: value => Loader.prototype.unwrapExports(value),
    }
    await expect(loadRuntimeZod(loader)).rejects.toThrow('BRIDGE_RUNTIME_EXPORT_MISSING: zod.z')
    expect(loader.import).toHaveBeenCalledExactlyOnceWith('zod')
  })

  it('preserves a loader rejection without caching it or falling back to a bundled module', async () => {
    const failure = new Error('official Zod import refused')
    const loader: PlatformLoader = {
      import: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(zodModule),
      unwrapExports: value => Loader.prototype.unwrapExports(value),
    }
    await expect(loadRuntimeZod(loader)).rejects.toBe(failure)
    expect(await loadRuntimeZod(loader)).toBe(zodModule.z)
    expect(vi.mocked(loader.import).mock.calls).toEqual([['zod'], ['zod']])
  })
})
