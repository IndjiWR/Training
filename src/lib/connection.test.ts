import { describe, expect, it } from 'vitest'
import { buildConnectionLink, DEFAULT_FOLDER_ID, extractFolderId, generateToken, parseConnection } from './connection'

const EXEC = 'https://script.google.com/macros/s/AKfycbx_abc123/exec'
const TOKEN = 'Zq3-xY_9kLmN0pQrStUvWxYz'

describe('parseConnection', () => {
  it('reads the …/exec?token=… link', () => {
    expect(parseConnection(`${EXEC}?token=${TOKEN}`)).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })

  it('finds the link inside a message and drops trailing punctuation', () => {
    const r = parseConnection(`Collegamento Training: ${EXEC}?token=${TOKEN}.\nNon condividerlo!`)
    expect(r).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })

  it('accepts URL and token on two lines', () => {
    expect(parseConnection(`${EXEC}\n${TOKEN}`)).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })

  it('keeps other query parameters but never the token in the endpoint', () => {
    const r = parseConnection(`${EXEC}?v=2&token=${TOKEN}`)
    expect(r).toEqual({ ok: true, endpoint: `${EXEC}?v=2`, token: TOKEN })
  })

  it('explains what is missing', () => {
    expect(parseConnection('   ')).toMatchObject({ ok: false, error: expect.stringContaining('vuoti') })
    expect(parseConnection('ciao')).toMatchObject({ ok: false, error: expect.stringContaining('https://') })
    expect(parseConnection(EXEC)).toMatchObject({ ok: false, error: expect.stringContaining('token') })
  })

  it('rejects the /dev test URL and non-https links', () => {
    const dev = parseConnection(`https://script.google.com/macros/s/X/dev?token=${TOKEN}`)
    expect(dev).toMatchObject({ ok: false, error: expect.stringContaining('/exec') })
    expect(parseConnection(`http://example.com/exec?token=${TOKEN}`)).toMatchObject({ ok: false })
  })

  it('round-trips with buildConnectionLink', () => {
    const link = buildConnectionLink(EXEC, TOKEN)
    expect(link).toBe(`${EXEC}?token=${TOKEN}`)
    expect(parseConnection(link)).toEqual({ ok: true, endpoint: EXEC, token: TOKEN })
  })
})

describe('extractFolderId', () => {
  it('reads ids from links and bare ids', () => {
    expect(extractFolderId(DEFAULT_FOLDER_ID)).toBe(DEFAULT_FOLDER_ID)
    expect(extractFolderId(`https://drive.google.com/drive/folders/${DEFAULT_FOLDER_ID}?usp=sharing`)).toBe(
      DEFAULT_FOLDER_ID,
    )
    expect(extractFolderId(`https://drive.google.com/drive/u/0/folders/${DEFAULT_FOLDER_ID}`)).toBe(DEFAULT_FOLDER_ID)
    expect(extractFolderId(`https://drive.google.com/open?id=${DEFAULT_FOLDER_ID}`)).toBe(DEFAULT_FOLDER_ID)
  })

  it('returns null for anything else', () => {
    expect(extractFolderId('')).toBeNull()
    expect(extractFolderId('cartella allenamento')).toBeNull()
    expect(extractFolderId('https://drive.google.com/drive/my-drive')).toBeNull()
  })
})

describe('generateToken', () => {
  it('is long, URL-safe and different every time', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })
})

