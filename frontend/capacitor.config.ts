import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'work.frauchesgabriel.protocolo',
  appName: 'Protocolo',
  webDir: 'dist',
  server: {
    // The WebView origin is https://localhost (the API allows it through CORS).
    androidScheme: 'https',
  },
}

export default config
