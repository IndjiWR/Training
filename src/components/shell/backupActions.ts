import { backupFileName, createBackup, downloadText } from '../../lib/backup'
import { nowISO, todayISO } from '../../lib/date'
import { getState } from '../../state/store'
import { toast } from '../../state/ui'

export function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err)
}

/** Downloads the whole app data as a JSON backup. Toasts the outcome; returns false on failure. */
export function exportBackup(): boolean {
  try {
    const backup = createBackup(getState(), nowISO())
    const fileName = backupFileName(todayISO())
    downloadText(fileName, JSON.stringify(backup, null, 2))
    toast(`Backup esportato: ${fileName}`, { tone: 'success' })
    return true
  } catch (err) {
    toast(`Esportazione non riuscita.\n${errorText(err)}`, { tone: 'error' })
    return false
  }
}
