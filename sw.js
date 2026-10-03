// 출타 장부 service worker — 앱 코드만 캐시한다. 개인 기록(localStorage)은 캐시에 넣지 않는다.
// 앱 파일을 바꾸면 `npm run stamp`로 CONTENT_HASH를 갱신한다 (npm test가 불일치를 잡는다).
// 해시가 바뀌면 sw.js 바이트가 달라져 설치된 기기가 새 버전을 감지한다. 캐시 이름에도 들어가 옛 캐시를 정리한다.
const VERSION = '1.2.2';
const CONTENT_HASH = 'd671826322b22de2';
const PREFIX = 'airforce-leave-calendar-';
const CACHE = `${PREFIX}${VERSION}-${CONTENT_HASH}`;
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/version.js',
  './src/feedback.js',
  './src/storage.js',
  './src/domain/dates.js',
  './src/domain/model.js',
  './src/domain/balances.js',
  './src/domain/validation.js',
  './src/domain/merit.js',
  './src/domain/service.js',
  './src/domain/migrate.js',
  './src/ui/dom.js',
  './src/ui/calendar.js',
  './src/ui/grants.js',
  './src/ui/trip-editor.js',
  './src/ui/settings.js',
  './src/ui/guide.js',
  './src/ui/service.js',
  './assets/camo.svg',
  './assets/livery-camo.svg',
  './assets/roundel.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // 새 버전은 대기 상태로 둔다. 사용자가 '적용'을 누를 때 SKIP_WAITING 메시지로 활성화한다.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 같은 origin의 다른 앱 캐시는 건드리지 않는다: 이 앱 prefix의 옛 버전만 지운다.
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(new URL('./index.html', scope).href);
      if (cached) return cached;
      return fetch(req);
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached ?? fetch(req);
  })());
});
