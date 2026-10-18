import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

export type PermissionResult = 'granted' | 'denied'

/** Local notifications. The web build has no scheduler, so there everything is a no-op that reports "granted". */
export const notifications = {
  async ensurePermission(): Promise<PermissionResult> {
    if (!Capacitor.isNativePlatform()) return 'granted'
    let { display } = await LocalNotifications.checkPermissions()
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      display = (await LocalNotifications.requestPermissions()).display
    }
    return display === 'granted' ? 'granted' : 'denied'
  },

  /** Shows a notification about a second from now (used by the diagnostics screen). */
  async sendTest(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 1,
          title: 'Protocolo',
          body: 'Notificação de teste: está tudo certo.',
          schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
        },
      ],
    })
  },
}
