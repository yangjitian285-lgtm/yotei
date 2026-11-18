// オフラインでも開けるようにするための Service Worker
// アプリを更新したら VERSION の数字を上げてください
const VERSION = 'yotei-v2';
const SHELL = [
  './', './index.html', './style.css', './app.js', './backend-local.js', './backend-firebase.js',
  './firebase-config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firebase の SDK(バージョン固定URL)はキャッシュ優先
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }
  // 自分のファイルはネット優先(最新版を使う)、つながらなければキャッシュ
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
  }
  // それ以外(Firestore の通信など)は触らない
});

// 通知をタップしたらアプリを開く
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('./'))));
});
