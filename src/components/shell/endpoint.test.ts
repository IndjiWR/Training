import { describe, expect, it } from 'vitest'
import { splitEndpointToken } from './endpoint'

const EXEC = 'https://script.google.com/macros/s/X/exec'

describe('splitEndpointToken', () => {
  it('returns a clean URL unchanged (trimmed)', () => {
    expect(splitEndpointToken(`  ${EXEC} `)).toEqual({ endpoint: EXEC, token: null })
    expect(splitEndpointToken(`${EXEC}?v=2`)).toEqual({ endpoint: `${EXEC}?v=2`, token: null })
  })

  it('moves a pasted ?token= out of the URL', () => {
    expect(splitEndpointToken(`${EXEC}?token=s3cr%C3%A8t`)).toEqual({ endpoint: EXEC, token: 's3crèt' })
  })

  it('keeps the other query parameters and drops every token parameter', () => {
    const r = splitEndpointToken(`${EXEC}?a=1&token=one&b=2&token=two`)
    expect(r).toEqual({ endpoint: `${EXEC}?a=1&b=2`, token: 'one' })
    expect(r.endpoint).not.toContain('token')
  })

  it('drops an empty or bare token parameter without inventing a token', () => {
    expect(splitEndpointToken(`${EXEC}?token=`)).toEqual({ endpoint: EXEC, token: null })
    expect(splitEndpointToken(`${EXEC}?token&x=1`)).toEqual({ endpoint: `${EXEC}?x=1`, token: null })
  })

  it('does not touch look-alike parameters', () => {
    expect(splitEndpointToken(`${EXEC}?tokens=1`)).toEqual({ endpoint: `${EXEC}?tokens=1`, token: null })
  })

  it('leaves empty and unparsable values alone', () => {
    expect(splitEndpointToken('')).toEqual({ endpoint: '', token: null })
    expect(splitEndpointToken('script.google.com/x?token=a')).toEqual({
      endpoint: 'script.google.com/x?token=a',
      token: null,
    })
  })
})
