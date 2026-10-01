import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimWakeLock, isWakeLocked } from './wakeLock'

class FakeSentinel extends EventTarget {
  released = false
  readonly type = 'screen'
  release = vi.fn(async () => {
    if (this.released) return
    this.released = true
    this.dispatchEvent(new Event('release'))
  })
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

let sentinels: FakeSentinel[]
let request: ReturnType<typeof vi.fn>
let doc: FakeDocument

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  sentinels = []
  request = vi.fn(async () => {
    const s = new FakeSentinel()
    sentinels.push(s)
    return s
  })
  doc = new FakeDocument()
  vi.stubGlobal('navigator', { wakeLock: { request } })
  vi.stubGlobal('document', doc)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('claimWakeLock', () => {
  it('shares one lock between owners and releases it with the last one', async () => {
    const releaseShell = claimWakeLock()
    const releaseScreen = claimWakeLock()
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    expect(isWakeLocked()).toBe(true)

    // The Oggi screen unmounts (tab switch): the shell still holds the lock.
    releaseScreen()
    releaseScreen() // idempotent
    expect(sentinels[0].release).not.toHaveBeenCalled()
    expect(isWakeLocked()).toBe(true)

    releaseShell()
    await flush()
    expect(sentinels[0].release).toHaveBeenCalledTimes(1)
    expect(isWakeLocked()).toBe(false)
  })

  it('re-acquires when the page becomes visible after the browser released it', async () => {
    const release = claimWakeLock()
    await flush()
    await sentinels[0].release() // screen off / tab hidden
    expect(isWakeLocked()).toBe(false)

    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)

    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(isWakeLocked()).toBe(true)

    release()
    await flush()
    expect(isWakeLocked()).toBe(false)
    doc.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('a release while the request is pending drops the late sentinel; a quick re-claim keeps it', async () => {
    claimWakeLock()()
    await flush()
    expect(sentinels[0].released).toBe(true)
    expect(isWakeLocked()).toBe(false)

    // StrictMode-like release + claim in the same tick.
    claimWakeLock()()
    const release = claimWakeLock()
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(sentinels[1].released).toBe(false)
    expect(isWakeLocked()).toBe(true)
    release()
    await flush()
  })

  it('is a no-op without the API', () => {
    vi.stubGlobal('navigator', {})
    const release = claimWakeLock()
    expect(isWakeLocked()).toBe(false)
    release()
  })
})
