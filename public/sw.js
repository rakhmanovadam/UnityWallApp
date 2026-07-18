/* Kill switch.
 *
 * An earlier static build registered a cache-FIRST service worker here that
 * pinned styles.css / app.js under a fixed cache name and never revalidated —
 * so deployed CSS/JS changes never reached devices that had visited before.
 * This replacement takes over that same /sw.js scope, deletes every cache,
 * unregisters itself, and reloads open tabs so the site is served straight
 * from the network again. No fetch handler: nothing is intercepted or cached.
 *
 * Browsers re-fetch the SW script on navigation (bypassing HTTP cache when it's
 * older than 24h), so previously-poisoned devices pick this up and self-heal.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        try {
          client.navigate(client.url);
        } catch {
          // Some browsers disallow navigate(); the cache wipe + unregister
          // still frees the next manual reload.
        }
      }
    })(),
  );
});
