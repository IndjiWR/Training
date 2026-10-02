import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { parseBackup } from '../../lib/backup'
import { dataSyncActive, importBackup } from '../../state/dataSync'
import { getState, useAppData } from '../../state/store'
import type { AppData } from '../../state/types'
import { stopRest, toast } from '../../state/ui'
import { IconDownload, IconUpload } from '../icons'
import { exportBackup, errorText } from './backupActions'
import { ConfirmSheet } from './ConfirmSheet'
import { formatDateTime } from './datetime'
import { splitEndpointToken } from './endpoint'

interface PendingImport {
  data: AppData
  exportedAt: string | null
  fileName: string
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function readExportedAt(json: unknown): string | null {
  if (json && typeof json === 'object' && 'exportedAt' in json) {
    const v = (json as { exportedAt: unknown }).exportedAt
    if (typeof v === 'string' && v) return v
  }
  return null
}

/**
 * "Esporta backup" / "Importa backup" (sessions, day logs, plan, pinned media, preferences; never
 * the endpoint or the token).
 * Import asks for confirmation before replacing everything on this device.
 */
export function BackupControls() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const syncOn = useAppData((s) => dataSyncActive(s))

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = '' // allow picking the same file again
    if (!file) return
    setReading(true)
    try {
      let text: string
      try {
        text = await file.text()
      } catch {
        toast(`Impossibile leggere il file "${file.name}".`, { tone: 'error' })
        return
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        toast(`"${file.name}" non è un file JSON valido.`, { tone: 'error' })
        return
      }
      const result = parseBackup(json, getState().settings.token)
      if (!result.ok) {
        toast(`Backup non valido.\n${result.error}`, { tone: 'error' })
        return
      }
      setPending({ data: result.data, exportedAt: readExportedAt(json), fileName: file.name })
    } catch (err) {
      toast(`Importazione non riuscita.\n${errorText(err)}`, { tone: 'error' })
    } finally {
      setReading(false)
    }
  }

  const cancel = useCallback(() => setPending(null), [])

  const confirm = async () => {
    if (!pending || importing) return
    const current = getState().settings
    const { data } = pending
    // The device keeps its own connection when the backup carries none (new backups never do;
    // an older one may hold the URL, even with "?token=…" inside: never store that in the endpoint).
    const imported = splitEndpointToken(data.settings.endpoint)
    setImporting(true)
    try {
      await importBackup({
        ...data,
        settings: {
          ...data.settings,
          endpoint: imported.endpoint || current.endpoint,
          token: data.settings.token || current.token || imported.token || '',
        },
      })
    } finally {
      setImporting(false)
    }
    stopRest()
    setPending(null)
    toast(syncOn ? 'Backup importato: dati sostituiti, anche su Google Drive.' : 'Backup importato: dati sostituiti.', {
      tone: 'success',
    })
  }

  const when = pending?.exportedAt ? formatDateTime(pending.exportedAt) : null
  const counts = pending
    ? [
        plural(Object.keys(pending.data.sessions).length, 'sessione', 'sessioni'),
        plural(Object.keys(pending.data.days).length, 'giorno di diario', 'giorni di diario'),
        plural(Object.keys(pending.data.pins).length, 'media fissato', 'media fissati'),
      ].join(' · ')
    : ''

  return (
    <div className="stack-sm sh-backup">
      <p className="small muted">
        Il backup è un file JSON con sessioni, diario (peso, sonno, gomito), scheda attuale, media fissati e
        preferenze (tema, suoni, vibrazione). Non contiene mai l&apos;URL di Drive né il token.
      </p>
      <div className="sh-backup__buttons">
        <button type="button" className="btn btn--outline" onClick={() => exportBackup()}>
          <IconDownload />
          Esporta backup
        </button>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => inputRef.current?.click()}
          disabled={reading}
          aria-busy={reading || undefined}
        >
          <IconUpload />
          {reading ? 'Lettura…' : 'Importa backup'}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
      />

      <ConfirmSheet
        open={pending !== null}
        title="Importare il backup?"
        confirmLabel={importing ? 'Importo…' : 'Sostituisci i dati'}
        tone="danger"
        busy={importing}
        onConfirm={() => void confirm()}
        onCancel={cancel}
      >
        <p>
          Sostituire tutti i dati {syncOn ? '' : 'di questo dispositivo '}con il backup{when ? ` del ${when}` : ''}?
          (sessioni, diario, scheda, media fissati)
        </p>
        {syncOn && (
          <p className="small">
            Il salvataggio su Google Drive è attivo: il backup sostituisce i dati anche su Drive e sugli altri
            dispositivi collegati. Le modifiche non ancora salvate su un altro dispositivo restano lì.
          </p>
        )}
        {pending && (
          <div className="card sh-backup__summary">
            <p className="small">
              <strong>Nel backup:</strong> {counts}
            </p>
            <p className="small">
              <strong>Scheda:</strong> {pending.data.plan?.title ?? pending.data.plan?.id ?? 'nessuna'}
            </p>
            <p className="tiny muted">File: {pending.fileName}</p>
          </div>
        )}
        <p className="banner banner--warn small">
          I dati attuali {syncOn ? '' : 'di questo dispositivo '}andranno persi. Se ti servono, esporta prima un
          backup.
        </p>
        <button type="button" className="btn btn--ghost btn--block" disabled={importing} onClick={() => exportBackup()}>
          <IconDownload />
          Esporta prima i dati attuali
        </button>
      </ConfirmSheet>
    </div>
  )
}
