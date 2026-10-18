import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/** The installed app version ("0.1.12 (12)") on Android; "web" in the browser. */
export async function getAppVersion(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return 'web'
  const info = await App.getInfo()
  return `${info.version} (${info.build})`
}
