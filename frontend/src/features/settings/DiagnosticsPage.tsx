import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getAppVersion } from '../../platform/appInfo'
import { camera } from '../../platform/camera'
import { notifications } from '../../platform/notifications'

const BUTTON =
  'min-h-11 rounded-control border border-line px-4 py-2 text-sm font-medium hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent'

/** Configurações → Diagnóstico: checks that the native pieces (notifications, camera) work on this device. */
export function DiagnosticsPage() {
  const [version, setVersion] = useState('…')
  const [notificationResult, setNotificationResult] = useState<string | null>(null)
  const [cameraResult, setCameraResult] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAppVersion()
      .then((v) => active && setVersion(v))
      .catch(() => active && setVersion('desconhecida'))
    return () => {
      active = false
    }
  }, [])

  async function testNotification() {
    try {
      if ((await notifications.ensurePermission()) === 'denied') {
        setNotificationResult('Permissão de notificações negada. Ative nas configurações do Android.')
        return
      }
      await notifications.sendTest()
      setNotificationResult('Notificação enviada. Ela deve aparecer em instantes.')
    } catch {
      setNotificationResult('Não foi possível enviar a notificação.')
    }
  }

  async function checkCamera() {
    try {
      const result = await camera.ensurePermission()
      setCameraResult(
        result === 'granted' ? 'Permissão da câmera concedida.' : 'Permissão da câmera negada. Ative nas configurações do Android.',
      )
    } catch {
      setCameraResult('Não foi possível verificar a câmera.')
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-muted hover:text-ink">
          ← Voltar
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Diagnóstico</h1>
      </div>

      <p className="text-sm">
        Versão do app: <strong>{version}</strong>
      </p>

      <div className="space-y-2">
        <button type="button" className={BUTTON} onClick={() => void testNotification()}>
          Testar notificação
        </button>
        {notificationResult && (
          <p role="status" className="text-sm text-muted">
            {notificationResult}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <button type="button" className={BUTTON} onClick={() => void checkCamera()}>
          Permissão da câmera
        </button>
        {cameraResult && (
          <p role="status" className="text-sm text-muted">
            {cameraResult}
          </p>
        )}
      </div>
    </section>
  )
}
