/**
 * Copies text to the clipboard: navigator.clipboard.writeText, falling back to a hidden
 * textarea + document.execCommand('copy'). Resolves true on success. Never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    // navigator.clipboard only exists in secure contexts (https, localhost).
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied / document not focused: try the legacy path below.
  }
  return legacyCopy(text)
}

/** execCommand('copy') on a temporary off-screen textarea (old browsers, http on the LAN). */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = document.getSelection()
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('aria-hidden', 'true')
  ta.tabIndex = -1
  // Off-screen but selectable; 1rem avoids the iOS zoom-on-focus.
  Object.assign(ta.style, {
    position: 'fixed',
    top: '0',
    left: '-200vw',
    width: '1em',
    height: '1em',
    opacity: '0',
    fontSize: '1rem',
    border: '0',
    padding: '0',
  })
  document.body.appendChild(ta)

  let ok = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length) // iOS ignores select()
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    ta.remove()
    if (selection && previousRange) {
      selection.removeAllRanges()
      selection.addRange(previousRange)
    }
    active?.focus({ preventScroll: true })
  }
  return ok
}
