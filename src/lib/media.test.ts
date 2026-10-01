import { describe, expect, it } from 'vitest'
import fixture from '../../scheda-corrente.json'
import { parsePlan } from '../plan/schema'
import {
  canonicalMediaUrl,
  describeMedia,
  hasImageExtension,
  MEDIA_REASONS,
  parseMediaUrl,
  parseStartTime,
  type ParsedMedia,
  youtubeSearchUrl,
} from './media'

const ID = 'dQw4w9WgXcQ'
const ID2 = 'a-B_c1D2e3F'

function yt(raw: string) {
  const m = parseMediaUrl(raw)
  if (m.type !== 'youtube') throw new Error(`expected youtube for ${raw}, got ${JSON.stringify(m)}`)
  return m
}

function reasonOf(m: ParsedMedia): string | null {
  return m.type === 'invalid' ? m.reason : null
}

describe('parseStartTime', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['0', 0],
    [' 45 ', 45],
    ['1m', 60],
    ['1m30s', 90],
    ['2m05s', 125],
    ['1h', 3600],
    ['1h2m3s', 3723],
    ['1h3s', 3603],
    ['1H2M3S', 3723],
    ['01:30', 90],
    ['1:30', 90],
    ['75:00', 4500],
    ['1:02:03', 3723],
    ['90.7', 90],
  ])('%s -> %i', (input, expected) => {
    expect(parseStartTime(input)).toBe(expected)
  })

  it.each([null, undefined, '', '   ', 'abc', '-5', '1:75', '1:02:75', '1:2:3:4', 'm', 's', '1x', '1m30', '90 s', '1e3'])(
    'rejects %j',
    (input) => {
      expect(parseStartTime(input)).toBeNull()
    },
  )

  it('rejects absurdly large values', () => {
    expect(parseStartTime('9'.repeat(30))).toBeNull()
  })
})

describe('parseMediaUrl — YouTube', () => {
  it('watch?v= without start', () => {
    const m = yt(`https://www.youtube.com/watch?v=${ID}`)
    expect(m).toEqual({
      type: 'youtube',
      id: ID,
      start: null,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1`,
      watchUrl: `https://www.youtube.com/watch?v=${ID}`,
    })
  })

  it('builds embed and watch URLs with the start time', () => {
    const m = yt(`https://www.youtube.com/watch?v=${ID}&t=90s`)
    expect(m.start).toBe(90)
    expect(m.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${ID}?start=90&rel=0&playsinline=1`)
    expect(m.watchUrl).toBe(`https://www.youtube.com/watch?v=${ID}&t=90s`)
  })

  it.each([
    [`https://www.youtube.com/watch?v=${ID}&t=90`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=90s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`, 3723],
    [`https://www.youtube.com/watch?v=${ID}#t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${ID}#t=45`, 45],
    [`https://www.youtube.com/watch?v=${ID}&start=30`, 30],
    [`https://www.youtube.com/watch?v=${ID}&time_continue=12`, 12],
    [`https://www.youtube.com/watch?v=${ID}&t=0`, null],
    [`https://www.youtube.com/watch?v=${ID}&t=abc`, null],
    [`https://www.youtube.com/watch?v=${ID}&t=abc&start=20`, 20],
    [`https://youtu.be/${ID}?t=90`, 90],
    [`https://youtu.be/${ID}?si=AbCdEf123&t=45`, 45],
    [`https://www.youtube.com/embed/${ID}?start=30`, 30],
    [`https://www.youtube-nocookie.com/embed/${ID}?start=75&rel=0`, 75],
  ])('%s -> start %s', (url, start) => {
    const m = yt(url)
    expect(m.id).toBe(ID)
    expect(m.start).toBe(start)
  })

  it.each([
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/shorts/${ID}/`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?si=xyz`,
    `https://www.youtube.com/v/${ID}`,
    `https://www.youtube.com/watch/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&feature=share`,
    `https://youtube.com/watch?v=${ID}`,
    `https://youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
    `https://www.youtube.com./watch?v=${ID}`,
    `https://www.youtube.com/?v=${ID}`,
  ])('recognises %s', (url) => {
    expect(yt(url).id).toBe(ID)
  })

  it('keeps ids with - and _', () => {
    expect(yt(`https://youtu.be/${ID2}`).id).toBe(ID2)
  })

  it('ignores extra params and the playlist of a watch URL', () => {
    const m = yt(`https://www.youtube.com/watch?app=desktop&v=${ID}&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&index=2&t=10s&ab_channel=X`)
    expect(m.id).toBe(ID)
    expect(m.start).toBe(10)
    expect(m.watchUrl).toBe(`https://www.youtube.com/watch?v=${ID}&t=10s`)
  })

  it('accepts links without scheme and share text containing a link', () => {
    expect(yt(`youtu.be/${ID}`).id).toBe(ID)
    expect(yt(`www.youtube.com/watch?v=${ID}&t=5`).start).toBe(5)
    expect(yt(`//www.youtube.com/watch?v=${ID}`).id).toBe(ID)
    const shared = yt(`Front lever tutorial\nhttps://youtu.be/${ID}?si=abc&t=1m`)
    expect(shared.start).toBe(60)
    expect(yt(`  https://youtu.be/${ID}  `).id).toBe(ID)
  })

  it.each([
    [`https://www.youtube.com/watch?v=short`, MEDIA_REASONS.ytBadId],
    [`https://www.youtube.com/watch?v=${ID}x`, MEDIA_REASONS.ytBadId],
    [`https://www.youtube.com/watch?v=dQw4w9WgXc!`, MEDIA_REASONS.ytBadId],
    [`https://youtu.be/abc`, MEDIA_REASONS.ytBadId],
    [`https://www.youtube.com/watch`, MEDIA_REASONS.ytNoVideo],
    [`https://www.youtube.com/`, MEDIA_REASONS.ytNoVideo],
    [`https://youtu.be/`, MEDIA_REASONS.ytNoVideo],
    [`https://www.youtube.com/shorts/`, MEDIA_REASONS.ytNoVideo],
    [`https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx`, MEDIA_REASONS.ytNoVideo],
    [`https://www.youtube.com/@calisthenics`, MEDIA_REASONS.ytNoVideo],
    [`https://www.youtube.com/results?search_query=front+lever`, MEDIA_REASONS.ytNoVideo],
    [`https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG`, MEDIA_REASONS.ytPlaylist],
    [`https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG`, MEDIA_REASONS.ytPlaylist],
  ])('rejects %s', (url, reason) => {
    expect(reasonOf(parseMediaUrl(url))).toBe(reason)
  })

  it('round-trips through the canonical URL', () => {
    for (const url of [
      `https://youtu.be/${ID}?si=tracking&t=1m30s`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID2}?start=12`,
    ]) {
      const first = parseMediaUrl(url)
      const canonical = canonicalMediaUrl(first)
      expect(canonical).not.toBeNull()
      expect(canonical).not.toContain('si=')
      expect(parseMediaUrl(canonical!)).toEqual(first)
    }
  })
})

describe('parseMediaUrl — images and invalid input', () => {
  it.each([
    'https://example.com/front-lever.gif',
    'https://example.com/anim.gif?raw=true&w=400',
    'https://cdn.example.org/path/to/IMAGE.PNG',
    'https://example.com/a.jpg#frag',
    'https://example.com/a.jpeg',
    'https://example.com/a.webp',
    'https://example.com/a.avif',
    'https://example.com/a.svg',
    'http://example.com/a.gif',
    'https://i.imgur.com/AbCdEf1.gifv',
    'https://example.com/image?id=12',
  ])('%s -> image', (url) => {
    const m = parseMediaUrl(url)
    expect(m.type).toBe('image')
    if (m.type === 'image') expect(m.url).toBe(new URL(url).href)
  })

  it('normalises the image URL', () => {
    expect(parseMediaUrl('  example.com/a%20b.gif ')).toEqual({ type: 'image', url: 'https://example.com/a%20b.gif' })
    expect(parseMediaUrl('Guarda: https://example.com/a.gif grazie')).toEqual({ type: 'image', url: 'https://example.com/a.gif' })
    expect(parseMediaUrl('HTTPS://Example.COM/x.GIF')).toEqual({ type: 'image', url: 'https://example.com/x.GIF' })
  })

  it.each([
    ['', MEDIA_REASONS.empty],
    ['   ', MEDIA_REASONS.empty],
    ['ciao', MEDIA_REASONS.notUrl],
    ['front lever tutorial', MEDIA_REASONS.notUrl],
    ['foo.bar', MEDIA_REASONS.notUrl],
    ['l-sit.gif', MEDIA_REASONS.notUrl],
    ['www.youtube', MEDIA_REASONS.notUrl],
    ['https://', MEDIA_REASONS.notUrl],
    ['http://', MEDIA_REASONS.notUrl],
    ['javascript:alert(1)', MEDIA_REASONS.scheme],
    ['JavaScript:alert(document.cookie)', MEDIA_REASONS.scheme],
    ['javascript:alert(1) //https', MEDIA_REASONS.notUrl],
    ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', MEDIA_REASONS.scheme],
    ['ftp://example.com/a.gif', MEDIA_REASONS.scheme],
    ['mailto:someone@example.com', MEDIA_REASONS.scheme],
    ['file:///C:/foto.gif', MEDIA_REASONS.scheme],
    ['https://user:secret@example.com/a.gif', MEDIA_REASONS.credentials],
  ])('%j -> invalid', (input, reason) => {
    expect(reasonOf(parseMediaUrl(input))).toBe(reason)
  })

  it('never returns a non-http(s) URL', () => {
    const inputs = ['javascript:void(0)', 'vbscript:msgbox', 'blob:https://x/1', 'about:blank', 'chrome://settings']
    for (const input of inputs) expect(parseMediaUrl(input).type).toBe('invalid')
  })
})

describe('describeMedia / hasImageExtension', () => {
  it('describes YouTube with and without start', () => {
    expect(describeMedia(parseMediaUrl(`https://youtu.be/${ID}?t=90`))).toEqual({
      tone: 'ok',
      text: 'Video YouTube · inizio 1:30',
    })
    expect(describeMedia(parseMediaUrl(`https://youtu.be/${ID}?t=1h2m3s`)).text).toBe('Video YouTube · inizio 1:02:03')
    expect(describeMedia(parseMediaUrl(`https://youtu.be/${ID}`)).text).toBe("Video YouTube · dall'inizio")
  })

  it('describes images: known extension ok, unknown warns', () => {
    expect(describeMedia(parseMediaUrl('https://example.com/a.gif?x=1'))).toEqual({ tone: 'ok', text: 'Immagine/GIF' })
    expect(describeMedia(parseMediaUrl('https://example.com/page')).tone).toBe('warn')
  })

  it('describes invalid input with its reason', () => {
    expect(describeMedia(parseMediaUrl('javascript:alert(1)'))).toEqual({ tone: 'error', text: MEDIA_REASONS.scheme })
  })

  it('checks the extension on the path only', () => {
    expect(hasImageExtension('https://example.com/a.gif?size=big')).toBe(true)
    expect(hasImageExtension('https://example.com/page?file=a.gif')).toBe(false)
    expect(hasImageExtension('not a url')).toBe(false)
  })

  it('canonicalMediaUrl is null for invalid input', () => {
    expect(canonicalMediaUrl(parseMediaUrl('ciao'))).toBeNull()
    expect(canonicalMediaUrl(parseMediaUrl('https://example.com/a.gif'))).toBe('https://example.com/a.gif')
  })
})

describe('youtubeSearchUrl', () => {
  const query = (url: string) => new URL(url).searchParams.get('search_query')

  it('builds a search URL with + for spaces', () => {
    expect(youtubeSearchUrl('front lever progression tutorial')).toBe(
      'https://www.youtube.com/results?search_query=front+lever+progression+tutorial',
    )
  })

  it('trims and collapses whitespace', () => {
    expect(youtubeSearchUrl('  l-sit   parallettes\nprogression ')).toBe(
      'https://www.youtube.com/results?search_query=l-sit+parallettes+progression',
    )
  })

  it('encodes special characters so the query round-trips', () => {
    for (const q of ['dip & push-up / 90°', 'a+b=c?#frag', 'mobilità dell’anca "pike"', 'C++ 100%']) {
      const url = youtubeSearchUrl(q)
      expect(url.startsWith('https://www.youtube.com/results?search_query=')).toBe(true)
      expect(url).not.toMatch(/[ #&"]/)
      expect(query(url)).toBe(q)
    }
  })

  it('works for every video_query of the real plan', () => {
    const parsed = parsePlan(fixture)
    if (!parsed.ok) throw new Error(parsed.error)
    for (const entry of Object.values(parsed.plan.library)) {
      if (!entry.video_query) continue
      expect(query(youtubeSearchUrl(entry.video_query))).toBe(entry.video_query)
    }
  })
})
