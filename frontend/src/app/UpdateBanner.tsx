import { useEffect, useState } from 'react'
import { APP_VERSION, checkForUpdate, downloadApk, type LatestRelease } from '../data/updateCheck'
import { onResume } from '../platform/lifecycle'

/** "Nova versão disponível" for the installed app: checked on open and whenever the app returns to the foreground. */
export function UpdateBanner() {
  const [release, setRelease] = useState<LatestRelease | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      void checkForUpdate(APP_VERSION).then((found) => {
        if (!cancelled && found) setRelease(found)
      })
    }
    check()
    const stop = onResume(check)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  if (!release) return null

  async function download(target: LatestRelease) {
    setFailed(false)
    setDownloading(true)
    try {
      await downloadApk(target)
    } catch (error) {
      console.error('could not download the update', error)
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div role="status" className="border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>
          <strong className="font-semibold">Nova versão disponível</strong> ({release.version})
        </span>
        <button
          type="button"
          onClick={() => void download(release)}
          disabled={downloading}
          className="rounded-control px-2 py-1 font-medium text-accent underline disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {downloading ? 'Baixando…' : 'Baixar atualização'}
        </button>
      </div>
      {failed && (
        <p role="alert" className="mx-auto mt-1 max-w-2xl text-danger">
          Não foi possível baixar. Tente de novo.
        </p>
      )}
    </div>
  )
}
