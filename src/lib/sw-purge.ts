/**
 * Logout hygiene for the iOS PWA: our service worker caches navigation/RSC
 * payloads (dokan-pages-*, dokan-shell-*), so a signed-out device keeps the
 * previous merchant's dashboard content in Cache Storage until the next
 * CACHE_VERSION bump. On a shared tablet that means the next user can be
 * served stale (or worse, someone else's) pages while offline.
 *
 * Purge is best-effort: a failure here must never block sign-out itself.
 * The SW re-registers on the next visit via service-worker-register.tsx.
 */
export async function purgeServiceWorkerState(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('dokan-')).map((k) => caches.delete(k))
      );
    }
  } catch {
    // Silent: worst case we keep today's behavior (caches survive sign-out).
  }
}
