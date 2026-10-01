import { formatClock } from './format'

/**
 * Exercise media helpers. Never hardcode or invent video URLs: the only URLs the app opens
 * are YouTube *search* URLs built from library.video_query, or URLs the user pinned.
 */

export type ParsedMedia =
  | {
      type: 'youtube'
      id: string
      /** Start time in seconds, null if none. */
      start: number | null
      /** https://www.youtube-nocookie.com/embed/<id>?start=..&rel=0&playsinline=1 (start only if set). */
      embedUrl: string
      /** Canonical https://www.youtube.com/watch?v=<id>(&t=<start>s) */
      watchUrl: string
    }
  | { type: 'image'; url: string }
  | { type: 'invalid'; reason: string }

export type YouTubeMedia = Extract<ParsedMedia, { type: 'youtube' }>

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])
const YT_SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be'])
/** youtube.com/<prefix>/<id> */
const YT_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v', 'e'])
const IMAGE_EXT = /\.(gif|png|jpe?g|webp|avif|svg|bmp)$/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** "youtu.be/ID", "example.com/a.gif": a dotted host followed by a path, without scheme. */
const SCHEMELESS_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?\//i

export const MEDIA_REASONS = {
  empty: 'Incolla un link.',
  notUrl: 'Non è un link: incolla un indirizzo che inizia con https://',
  scheme: 'Sono ammessi solo link http:// o https://.',
  credentials: 'Link con nome utente o password non ammesso.',
  ytNoVideo: 'Questo link YouTube non porta a un video: apri il video e copia il suo link.',
  ytPlaylist: 'Le playlist non sono supportate: incolla il link di un singolo video.',
  ytBadId: 'ID del video YouTube non valido.',
} as const

const invalid = (reason: string): ParsedMedia => ({ type: 'invalid', reason })

const LEADING_WRAP = /^[(<[«“‘"']+/
const TRAILING_PUNCT = /[.,;:!?'"»”’)\]>]$/

function count(s: string, ch: string): number {
  return s.split(ch).length - 1
}

/**
 * "(https://youtu.be/ID)", "https://youtu.be/ID?t=30," -> the bare link. A closing ")" or "]"
 * that balances one inside the URL is kept ("https://example.com/File_(1)").
 */
function trimLinkPunctuation(s: string): string {
  let out = s.replace(LEADING_WRAP, '')
  while (TRAILING_PUNCT.test(out)) {
    const last = out[out.length - 1]
    if (last === ')' && count(out, '(') >= count(out, ')')) break
    if (last === ']' && count(out, '[') >= count(out, ']')) break
    out = out.slice(0, -1)
  }
  return out
}

/** Text pasted from a share sheet may contain a title before the link: keep the URL only. */
function extractCandidate(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const token = /\s/.test(text) ? (/https?:\/\/\S+/i.exec(text)?.[0] ?? null) : text
  if (!token) return null
  return trimLinkPunctuation(token) || null
}

function toUrl(candidate: string): URL | null {
  let href = candidate
  if (href.startsWith('//')) href = `https:${href}`
  else if (!HAS_SCHEME.test(href)) {
    if (!SCHEMELESS_HOST.test(href)) return null
    href = `https://${href}`
  }
  try {
    return new URL(href)
  } catch {
    return null
  }
}

/** Value of `name` in a "#t=1m30s"-style fragment. */
function hashParam(hash: string, name: string): string | null {
  if (!hash || hash.length < 2) return null
  return new URLSearchParams(hash.slice(1)).get(name)
}

function firstStart(...values: (string | null)[]): number | null {
  for (const v of values) {
    const s = parseStartTime(v)
    if (s != null) return s > 0 ? s : null
  }
  return null
}

function youtube(id: string, start: number | null): ParsedMedia {
  const params = new URLSearchParams()
  if (start) params.set('start', String(start))
  params.set('rel', '0')
  params.set('playsinline', '1')
  return {
    type: 'youtube',
    id,
    start,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`,
    watchUrl: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`,
  }
}

function parseYouTube(url: URL, short: boolean): ParsedMedia {
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | null = null
  if (short) {
    id = segments[0] ?? null
  } else if (segments[0] === 'watch') {
    // /watch?v=ID (and the rare /watch/ID)
    id = url.searchParams.get('v') ?? segments[1] ?? null
  } else if (segments.length === 0) {
    id = url.searchParams.get('v')
  } else if (YT_PATH_PREFIXES.has(segments[0])) {
    id = segments[1] ?? null
  }
  if (!id) {
    return invalid(url.searchParams.has('list') ? MEDIA_REASONS.ytPlaylist : MEDIA_REASONS.ytNoVideo)
  }
  if (id === 'videoseries') return invalid(MEDIA_REASONS.ytPlaylist)
  if (!YT_ID.test(id)) return invalid(MEDIA_REASONS.ytBadId)
  const q = url.searchParams
  const start = firstStart(q.get('t'), q.get('start'), q.get('time_continue'), hashParam(url.hash, 't'))
  return youtube(id, start)
}

/**
 * Parses a pinned URL.
 * YouTube (http/https, with or without www./m./music.): youtube.com/watch?v=ID, youtu.be/ID,
 * youtube.com/shorts/ID, /embed/ID, /live/ID, /v/ID, youtube-nocookie.com/embed/ID.
 * ID = 11 chars [A-Za-z0-9_-]. Start from t= or start= (also #t=) via parseStartTime.
 * Anything else with http(s) -> image (images/GIFs: .gif .png .jpg .jpeg .webp .avif .svg, or
 * any other http(s) URL, which is treated as an image). Non-http(s) or unparsable -> invalid
 * with an Italian reason.
 * Also accepted: a link without scheme ("youtu.be/ID" -> https) and share text that contains a link.
 */
export function parseMediaUrl(raw: string): ParsedMedia {
  if (typeof raw !== 'string' || !raw.trim()) return invalid(MEDIA_REASONS.empty)
  const candidate = extractCandidate(raw)
  if (!candidate) return invalid(MEDIA_REASONS.notUrl)
  const url = toUrl(candidate)
  if (!url) {
    return invalid(HAS_SCHEME.test(candidate) && !/^https?:/i.test(candidate) ? MEDIA_REASONS.scheme : MEDIA_REASONS.notUrl)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return invalid(MEDIA_REASONS.scheme)
  if (!url.hostname) return invalid(MEDIA_REASONS.notUrl)
  if (url.username || url.password) return invalid(MEDIA_REASONS.credentials)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (YT_SHORT_HOSTS.has(host)) return parseYouTube(url, true)
  if (YT_HOSTS.has(host)) return parseYouTube(url, false)
  return { type: 'image', url: url.href }
}

/** "90", "90s", "1m30s", "1h2m3s", "01:30", "1:02:03" -> seconds; invalid/empty -> null. */
export function parseStartTime(value: string | null | undefined): number | null {
  if (value == null) return null
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v)) return finite(Math.floor(Number(v)))
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v)
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return finite(Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0))
  }
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(v)
  if (clock) {
    const a = Number(clock[1])
    const b = Number(clock[2])
    if (clock[3] === undefined) return b < 60 ? finite(a * 60 + b) : null
    const c = Number(clock[3])
    return b < 60 && c < 60 ? finite(a * 3600 + b * 60 + c) : null
  }
  return null
}

function finite(n: number): number | null {
  return Number.isSafeInteger(n) ? n : null
}

/** https://www.youtube.com/results?search_query=<encoded query> */
export function youtubeSearchUrl(query: string): string {
  const q = query.trim().replace(/\s+/g, ' ')
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q).replace(/%20/g, '+')}`
}

/** URL to store for a valid pin: canonical watch URL (tracking params dropped) or the image URL. */
export function canonicalMediaUrl(media: ParsedMedia): string | null {
  if (media.type === 'youtube') return media.watchUrl
  if (media.type === 'image') return media.url
  return null
}

/** Must match the workbox runtimeCaching `cacheName` of pinned images in vite.config.ts. */
export const PINNED_IMAGES_CACHE = 'pinned-images'

/**
 * Drops a pinned image from the service-worker cache. Pinned images are cached CacheFirst as
 * opaque responses, so a 404/429/5xx (or a captive-portal page) cached once would be served
 * forever: call this when an image fails to load while online, before retrying.
 * Never rejects; a no-op where Cache Storage is unavailable.
 */
export function forgetCachedImage(url: string): Promise<void> {
  try {
    if (typeof caches === 'undefined') return Promise.resolve()
    return caches
      .open(PINNED_IMAGES_CACHE)
      .then((cache) => cache.delete(url, { ignoreVary: true }))
      .then(
        () => undefined,
        () => undefined,
      )
  } catch {
    // Accessing `caches` throws in sandboxed/opaque-origin contexts.
    return Promise.resolve()
  }
}

/** True when the URL path ends with a known image/GIF extension (query string ignored). */
export function hasImageExtension(url: string): boolean {
  try {
    return IMAGE_EXT.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export type MediaTone = 'ok' | 'warn' | 'error'

/** Italian one-line description of a parsed URL (live feedback of the pin editor). */
export function describeMedia(media: ParsedMedia): { tone: MediaTone; text: string } {
  switch (media.type) {
    case 'youtube':
      return {
        tone: 'ok',
        text: media.start ? `Video YouTube · inizio ${formatClock(media.start)}` : "Video YouTube · dall'inizio",
      }
    case 'image':
      return hasImageExtension(media.url)
        ? { tone: 'ok', text: 'Immagine/GIF' }
        : { tone: 'warn', text: "Link generico: sarà mostrato come immagine, controlla l'anteprima." }
    case 'invalid':
      return { tone: 'error', text: media.reason }
  }
}
