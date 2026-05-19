/**
 * StudyCapital — Service Worker v1.0
 * Strategy: Cache-first for static assets, Network-first for pages
 * ─────────────────────────────────────────────────────────────────
 * Deploy this file to the web root: https://www.studycapital.in/sw.js
 */

const CACHE_NAME    = 'studycapital-v1';
const OFFLINE_PAGE  = '/offline.html';

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/emi-calculator/',
  '/resources/',
  '/manifest.json',
  '/favicon-192.png',
  '/favicon-512.png',
  '/apple-touch-icon.png',
  '/og-image.jpg',
];

// ── Install: pre-cache shell ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        // Non-fatal: some assets may not exist yet (e.g. screenshots)
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: strategy varies by request type ───────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Skip Cloudflare Worker API, analytics, and map calls
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('workers.dev') ||
    url.hostname.includes('google-analytics') ||
    url.hostname.includes('clarity.ms') ||
    url.hostname.includes('telegram.org') ||
    url.hostname.includes('emailjs.com') ||
    url.hostname.includes('challenges.cloudflare.com')
  ) return;

  // HTML pages → Network-first (fresh content), fallback to cache then offline page
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match(OFFLINE_PAGE))
        )
    );
    return;
  }

  // Static assets (images, fonts, CSS, JS) → Cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
