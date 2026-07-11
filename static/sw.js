// GTech ERP — Service Worker v2.0
// يتيح: تثبيت الاختصار، التشغيل دون إنترنت (صفحة offline)، caching للأصول

const CACHE_NAME = 'gtech-erp-v2';
const OFFLINE_URL = '/offline';

// الملفات التي تُخزَّن فوراً عند التثبيت
const STATIC_ASSETS = [
  '/',
  '/login',
  '/offline',
  '/static/manifest.json',
  '/static/icons/icon-192x192.png',
  '/static/icons/icon-512x512.png',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css',
];

// ══════════════════════════════════════════════
// INSTALL — تخزين الأصول الأساسية
// ══════════════════════════════════════════════
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('GTech SW: بعض الملفات لم تُخزَّن:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ══════════════════════════════════════════════
// ACTIVATE — حذف الكاش القديم
// ══════════════════════════════════════════════
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ══════════════════════════════════════════════
// FETCH — استراتيجية: Network First → Cache Fallback
// ══════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل: طلبات غير GET، والـ API endpoints (دائماً live)
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  // الـ navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // خزِّن نسخة من الصفحة الرئيسية
          if (url.pathname === '/' || url.pathname === '/login') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // لا إنترنت → أظهر الكاش أو صفحة offline
          return caches.match(request)
            .then(cached => cached || caches.match(OFFLINE_URL));
        })
    );
    return;
  }

  // الملفات الثابتة: Cache First
  if (url.pathname.startsWith('/static/') ||
      url.hostname.includes('jsdelivr') ||
      url.hostname.includes('cdn')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }
});

// ══════════════════════════════════════════════
// PUSH NOTIFICATIONS (جاهز للمستقبل)
// ══════════════════════════════════════════════
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'GTech ERP', {
      body: data.body || '',
      icon: '/static/icons/icon-192x192.png',
      badge: '/static/icons/icon-72x72.png',
      dir: 'rtl',
      lang: 'ar',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
