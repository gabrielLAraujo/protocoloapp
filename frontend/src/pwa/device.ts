/** True on iPhone, iPod and iPad (iPadOS 13+ reports itself as a Mac, but has a touch screen). */
export function isIos(): boolean {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** Running as the installed app (Home Screen on iOS, installed PWA elsewhere), not in a browser tab. */
export function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return standalone || (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
}
