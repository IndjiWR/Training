/**
 * Apps Script URL pasted with its token (`…/exec?token=…`, e.g. copied from the browser bar while
 * testing the deploy): returns the URL without any token parameter (same filter as buildPlanUrl)
 * and that token, so the secret is never stored in settings.endpoint. Anything else, including
 * an unparsable value, comes back unchanged with token null.
 */
export function splitEndpointToken(raw: string): { endpoint: string; token: string | null } {
  const value = raw.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { endpoint: value, token: null }
  }
  const parts = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part !== '')
  const kept = parts.filter((part) => part !== 'token' && !part.startsWith('token='))
  if (kept.length === parts.length) return { endpoint: value, token: null }
  const token = new URLSearchParams(url.search).get('token')?.trim() || null
  url.search = kept.length > 0 ? `?${kept.join('&')}` : ''
  return { endpoint: url.toString(), token }
}
