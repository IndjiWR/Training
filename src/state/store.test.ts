import { afterEach, describe, expect, it, vi } from 'vitest'

/** Fresh copy of the store module (it reads localStorage at import time). */
async function freshStore() {
  vi.resetModules()
  return import('./store')
}

describe('lastPersistFailed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('is true from the start when the browser blocks localStorage (data lives in memory only)', async () => {
    vi.stubGlobal('window', { addEventListener: () => {} })
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      const store = await freshStore()
      expect(store.lastPersistFailed()).toBe(true)
      store.setState((s) => ({ ...s, days: {} }))
      expect(store.getState().days).toEqual({})
      expect(store.lastPersistFailed()).toBe(true)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })

  it('with a working localStorage reports only failed writes', async () => {
    const mem = new Map<string, string>()
    let full = false
    vi.stubGlobal('window', { addEventListener: () => {} })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new DOMException('Quota exceeded', 'QuotaExceededError')
        mem.set(k, v)
      },
      removeItem: (k: string) => void mem.delete(k),
    })
    const store = await freshStore()
    expect(store.lastPersistFailed()).toBe(false)
    full = true
    store.setState((s) => ({ ...s }))
    expect(store.lastPersistFailed()).toBe(true)
    full = false
    store.setState((s) => ({ ...s }))
    expect(store.lastPersistFailed()).toBe(false)
  })

  it('is false outside a browser (no window)', async () => {
    const store = await freshStore()
    expect(store.lastPersistFailed()).toBe(false)
  })
})
