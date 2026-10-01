import type { ThemeName } from '../../state/types'

/** Browser chrome color per theme (must match --bg in base.css). */
export const THEME_COLORS: Record<ThemeName, string> = {
  dark: '#0b0d10',
  light: '#ffffff',
}

/** Applies the theme to <html data-theme> and to <meta name="theme-color">. */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.dataset.theme !== theme) root.dataset.theme = theme
  const color = THEME_COLORS[theme] ?? THEME_COLORS.dark
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  if (metas.length === 0) {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = color
    document.head.appendChild(meta)
    return
  }
  metas.forEach((meta) => {
    if (meta.content !== color) meta.content = color
  })
}
