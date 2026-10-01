/**
 * Generates the app icons from one vector description. Pure Node, no dependencies.
 *
 *   public/pwa-192.png            192×192  purpose "any" (rounded square, transparent corners)
 *   public/pwa-512.png            512×512  purpose "any"
 *   public/pwa-maskable-512.png   512×512  purpose "maskable" (full bleed, art inside the safe zone)
 *   public/apple-touch-icon.png   180×180  opaque (iOS applies its own rounded mask)
 *   public/favicon.svg            same artwork as SVG
 *
 * Usage: npm run icons   (or: node scripts/gen-icons.mjs)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'public')

/** App palette (src/styles/base.css, dark theme). */
export const COLORS = { bg: '#0b0d10', accent: '#4cc9ff', figure: '#f5f7fa' }

/** Subsamples per pixel side for anti-aliasing (4 → 16 samples per pixel). */
const SUPERSAMPLE = 4
/** Maskable safe zone: a centred circle with radius 40% of the icon size. */
const SAFE_RADIUS = 0.4

// ─────────────────────────────────────────────────────────────── PNG encoder

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/**
 * Encodes 8-bit RGBA pixels (row-major, non-premultiplied) as a PNG: colour type 6 (RGBA),
 * or colour type 2 (RGB, no alpha channel at all) when `opaque` is true. Filter 0 on every row.
 */
export function encodePng(width, height, rgba, { opaque = false } = {}) {
  const channels = opaque ? 3 : 4
  const stride = width * channels + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = y * stride + 1 + x * channels
      if (opaque && rgba[src + 3] !== 255) {
        throw new Error(`Pixel ${x},${y} is not opaque: an opaque icon needs a full-bleed background`)
      }
      raw[dst] = rgba[src]
      raw[dst + 1] = rgba[src + 1]
      raw[dst + 2] = rgba[src + 2]
      if (!opaque) raw[dst + 3] = rgba[src + 3]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = opaque ? 2 : 6 // colour type
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter method 0
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─────────────────────────────────────────────────────────────── Shapes
//
// A scene is a list of shapes painted in order (later shapes on top):
//   { type: 'rrect',   x, y, w, h, r, color }        rounded rectangle
//   { type: 'circle',  cx, cy, r, color }
//   { type: 'stroke',  points, width, color }         polyline with round caps and joins
//   { type: 'polygon', points, round, color }         filled polygon grown by `round` (rounded corners)

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function segmentDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = px - (ax + t * dx)
  const ey = py - (ay + t * dy)
  return ex * ex + ey * ey
}

function insidePolygon(px, py, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function nearPolyline(px, py, points, r2, closed) {
  const last = closed ? points.length : points.length - 1
  for (let i = 0; i < last; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[(i + 1) % points.length]
    if (segmentDist2(px, py, ax, ay, bx, by) <= r2) return true
  }
  return points.length === 1 && segmentDist2(px, py, ...points[0], ...points[0]) <= r2
}

function contains(shape, x, y) {
  switch (shape.type) {
    case 'rrect': {
      const { x: x0, y: y0, w, h, r } = shape
      if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false
      const qx = Math.max(x0 + r - x, 0, x - (x0 + w - r))
      const qy = Math.max(y0 + r - y, 0, y - (y0 + h - r))
      return qx * qx + qy * qy <= r * r
    }
    case 'circle': {
      const dx = x - shape.cx
      const dy = y - shape.cy
      return dx * dx + dy * dy <= shape.r * shape.r
    }
    case 'stroke': {
      const r = shape.width / 2
      return nearPolyline(x, y, shape.points, r * r, false)
    }
    case 'polygon':
      return (
        insidePolygon(x, y, shape.points) ||
        (shape.round > 0 && nearPolyline(x, y, shape.points, shape.round * shape.round, true))
      )
    default:
      throw new Error(`Unknown shape type: ${shape.type}`)
  }
}

/** Axis-aligned bounds of a shape (including stroke width / rounding). */
function shapeBounds(shape) {
  switch (shape.type) {
    case 'rrect':
      return { x0: shape.x, y0: shape.y, x1: shape.x + shape.w, y1: shape.y + shape.h }
    case 'circle':
      return { x0: shape.cx - shape.r, y0: shape.cy - shape.r, x1: shape.cx + shape.r, y1: shape.cy + shape.r }
    default: {
      const pad = shape.type === 'stroke' ? shape.width / 2 : shape.round
      const xs = shape.points.map((p) => p[0])
      const ys = shape.points.map((p) => p[1])
      return {
        x0: Math.min(...xs) - pad,
        y0: Math.min(...ys) - pad,
        x1: Math.max(...xs) + pad,
        y1: Math.max(...ys) + pad,
      }
    }
  }
}

function sceneBounds(shapes) {
  return shapes.map(shapeBounds).reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }))
}

/** Farthest painted point of a shape from (cx, cy) — exact for discs, capsules and rounded polygons. */
function shapeReach(shape, cx, cy) {
  const dist = (x, y) => Math.hypot(x - cx, y - cy)
  switch (shape.type) {
    case 'rrect': {
      const { x, y, w, h } = shape
      return Math.max(dist(x, y), dist(x + w, y), dist(x, y + h), dist(x + w, y + h))
    }
    case 'circle':
      return dist(shape.cx, shape.cy) + shape.r
    default: {
      const pad = shape.type === 'stroke' ? shape.width / 2 : shape.round
      return Math.max(...shape.points.map(([x, y]) => dist(x, y))) + pad
    }
  }
}

/** Maps a shape through x' = x·s + dx, y' = y·s + dy. */
function transformShape(shape, s, dx, dy) {
  const pt = ([x, y]) => [x * s + dx, y * s + dy]
  switch (shape.type) {
    case 'rrect':
      return { ...shape, x: shape.x * s + dx, y: shape.y * s + dy, w: shape.w * s, h: shape.h * s, r: shape.r * s }
    case 'circle':
      return { ...shape, cx: shape.cx * s + dx, cy: shape.cy * s + dy, r: shape.r * s }
    case 'stroke':
      return { ...shape, points: shape.points.map(pt), width: shape.width * s }
    case 'polygon':
      return { ...shape, points: shape.points.map(pt), round: shape.round * s }
    default:
      throw new Error(`Unknown shape type: ${shape.type}`)
  }
}

// ─────────────────────────────────────────────────────────────── Rasterizer

/**
 * Renders shapes (pixel space) into RGBA with SUPERSAMPLE² samples per pixel.
 * Each sample takes the colour of the topmost shape containing it; uncovered samples are
 * transparent. Coverage becomes alpha, colour is the average of the covered samples.
 */
export function rasterize(size, shapes) {
  const prepared = shapes.map((shape) => ({ shape, box: shapeBounds(shape), rgb: hexToRgb(shape.color) }))
  const top = prepared.reverse()
  const n = SUPERSAMPLE
  const samples = n * n
  const out = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let covered = 0
      for (let sy = 0; sy < n; sy++) {
        const py = y + (sy + 0.5) / n
        for (let sx = 0; sx < n; sx++) {
          const px = x + (sx + 0.5) / n
          for (const { shape, box, rgb } of top) {
            if (px < box.x0 || px > box.x1 || py < box.y0 || py > box.y1) continue
            if (!contains(shape, px, py)) continue
            r += rgb[0]
            g += rgb[1]
            b += rgb[2]
            covered++
            break
          }
        }
      }
      const i = (y * size + x) * 4
      if (covered === 0) continue
      out[i] = Math.round(r / covered)
      out[i + 1] = Math.round(g / covered)
      out[i + 2] = Math.round(b / covered)
      out[i + 3] = Math.round((covered / samples) * 255)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────── Artwork

/**
 * The artwork in a 512-unit design space: a park pull-up bar (accent) with an athlete hanging
 * from it at arm's length (white). Bold strokes so it still reads at 48 px.
 */
export function artwork() {
  const { accent, figure } = COLORS
  return [
    // Pull-up station: two uprights joined by the bar.
    { type: 'stroke', points: [[104, 446], [104, 112], [408, 112], [408, 446]], width: 36, color: accent },
    // Arms, wide grip, from the hands on the bar down to the shoulders.
    { type: 'stroke', points: [[166, 112], [214, 224]], width: 32, color: figure },
    { type: 'stroke', points: [[346, 112], [298, 224]], width: 32, color: figure },
    // Head between the arms, clear of arms, bar and torso.
    { type: 'circle', cx: 256, cy: 170, r: 29, color: figure },
    // Torso with a V-taper: broad shoulders, narrow waist.
    { type: 'polygon', points: [[208, 224], [304, 224], [279, 316], [233, 316]], round: 14, color: figure },
    // Legs, slightly apart.
    { type: 'stroke', points: [[243, 312], [234, 424]], width: 32, color: figure },
    { type: 'stroke', points: [[269, 312], [278, 424]], width: 32, color: figure },
  ]
}

/**
 * Builds the scene for an icon: background + artwork centred and scaled.
 * - background 'rounded': rounded square with transparent corners (purpose "any");
 * - background 'full': full-bleed square (maskable, apple-touch-icon).
 * - fit: the artwork's larger side as a fraction of the icon size;
 *   or safeZone: true → the artwork's farthest point stays within the maskable safe circle.
 */
export function buildScene({ size, background, fit, safeZone = false }) {
  const art = artwork()
  const b = sceneBounds(art)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2

  let scale
  if (safeZone) {
    const reach = Math.max(...art.map((shape) => shapeReach(shape, cx, cy)))
    // 92% of the safe radius: a small margin so no anti-aliased edge touches the mask.
    scale = (SAFE_RADIUS * 0.92 * size) / reach
  } else {
    scale = (fit * size) / Math.max(b.x1 - b.x0, b.y1 - b.y0)
  }

  const bg =
    background === 'rounded'
      ? { type: 'rrect', x: 0, y: 0, w: size, h: size, r: size * 0.225, color: COLORS.bg }
      : { type: 'rrect', x: 0, y: 0, w: size, h: size, r: 0, color: COLORS.bg }

  const placed = art.map((shape) => transformShape(shape, scale, size / 2 - cx * scale, size / 2 - cy * scale))
  return [bg, ...placed]
}

/** Farthest painted point of the artwork from the icon centre, as a fraction of the size. */
function artReach(scene, size) {
  return Math.max(...scene.slice(1).map((shape) => shapeReach(shape, size / 2, size / 2))) / size
}

// ─────────────────────────────────────────────────────────────── SVG

const num = (n) => String(Math.round(n * 100) / 100)

function shapeToSvg(shape) {
  switch (shape.type) {
    case 'rrect':
      return `<rect x="${num(shape.x)}" y="${num(shape.y)}" width="${num(shape.w)}" height="${num(shape.h)}" rx="${num(shape.r)}" fill="${shape.color}"/>`
    case 'circle':
      return `<circle cx="${num(shape.cx)}" cy="${num(shape.cy)}" r="${num(shape.r)}" fill="${shape.color}"/>`
    case 'stroke': {
      const d = shape.points.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join(' ')
      return `<path d="${d}" fill="none" stroke="${shape.color}" stroke-width="${num(shape.width)}" stroke-linecap="round" stroke-linejoin="round"/>`
    }
    case 'polygon': {
      const pts = shape.points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')
      const stroke =
        shape.round > 0 ? ` stroke="${shape.color}" stroke-width="${num(shape.round * 2)}" stroke-linejoin="round"` : ''
      return `<polygon points="${pts}" fill="${shape.color}"${stroke}/>`
    }
    default:
      throw new Error(`Unknown shape type: ${shape.type}`)
  }
}

export function sceneToSvg(size, scene) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    '<title>Training</title>',
    ...scene.map((shape) => `  ${shapeToSvg(shape)}`),
    '</svg>',
    '',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────── Outputs

export const ICONS = [
  { file: 'pwa-192.png', size: 192, background: 'rounded', fit: 0.72 },
  { file: 'pwa-512.png', size: 512, background: 'rounded', fit: 0.72 },
  { file: 'pwa-maskable-512.png', size: 512, background: 'full', safeZone: true, opaque: true },
  { file: 'apple-touch-icon.png', size: 180, background: 'full', fit: 0.68, opaque: true },
]

export const FAVICON = { file: 'favicon.svg', size: 512, background: 'rounded', fit: 0.72 }

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  for (const icon of ICONS) {
    const scene = buildScene(icon)
    const reach = artReach(scene, icon.size)
    if (icon.safeZone && reach > SAFE_RADIUS) {
      throw new Error(`${icon.file}: the artwork leaves the maskable safe zone`)
    }
    const png = encodePng(icon.size, icon.size, rasterize(icon.size, scene), { opaque: icon.opaque })
    writeFileSync(join(OUT_DIR, icon.file), png)
    const notes = [icon.opaque ? 'RGB opaque' : 'RGBA', `art within ${Math.round(reach * 100)}% radius`]
    console.log(`${icon.file.padEnd(24)} ${`${icon.size}×${icon.size}`.padEnd(8)} ${String(png.length).padStart(6)} B  ${notes.join(', ')}`)
  }

  const svg = sceneToSvg(FAVICON.size, buildScene(FAVICON))
  writeFileSync(join(OUT_DIR, FAVICON.file), svg)
  console.log(`${FAVICON.file.padEnd(24)} ${'SVG'.padEnd(8)} ${String(Buffer.byteLength(svg)).padStart(6)} B`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const isMain =
  process.platform === 'win32'
    ? invokedPath.toLowerCase() === import.meta.filename.toLowerCase()
    : invokedPath === import.meta.filename
if (isMain) main()
