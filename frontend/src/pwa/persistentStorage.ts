/**
 * Asks the browser not to evict the local database (and the other site data) under storage pressure. Safari otherwise clears
 * the data of sites not used for a while; the answer does not matter, so every failure is ignored.
 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {
    // Unsupported or denied: nothing to do.
  }
}
