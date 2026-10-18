import { SecureStorage as NativeSecureStorage } from '@aparajita/capacitor-secure-storage'
import { Capacitor } from '@capacitor/core'

export interface SecureStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** Android Keystore / iOS Keychain through the Capacitor plugin. */
const nativeStorage: SecureStorage = {
  get: (key) => NativeSecureStorage.getItem(key),
  set: (key, value) => NativeSecureStorage.setItem(key, value),
  remove: (key) => NativeSecureStorage.removeItem(key),
}

/** The browser has no secure store: localStorage is the best the web build can do. */
const webStorage: SecureStorage = {
  get: async (key) => localStorage.getItem(key),
  set: async (key, value) => localStorage.setItem(key, value),
  remove: async (key) => localStorage.removeItem(key),
}

export const secureStorage: SecureStorage = Capacitor.isNativePlatform() ? nativeStorage : webStorage
