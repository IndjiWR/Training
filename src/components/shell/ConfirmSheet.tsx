import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Sheet } from '../ui'

export interface ConfirmSheetProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  /** Disables the buttons (e.g. while the confirmed action runs). */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Bottom-sheet confirmation with a big confirm button low on screen and a cancel button. */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Annulla',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  // Sheet re-runs its focus effect when onClose changes: keep a stable callback.
  const cancelRef = useRef(onCancel)
  useLayoutEffect(() => {
    cancelRef.current = onCancel
  }, [onCancel])
  const close = useCallback(() => {
    if (!busy) cancelRef.current()
  }, [busy])

  return (
    <Sheet open={open} title={title} onClose={close} dismissable={!busy}>
      <div className="stack">
        <div className="stack-sm sh-confirm__body">{children}</div>
        <div className="stack-sm">
          <button
            type="button"
            className={`btn btn--big btn--block btn--${tone}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
          <button type="button" className="btn btn--block btn--outline" onClick={close} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
