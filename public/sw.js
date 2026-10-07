// 离线缓存 + 版本失效：
// 缓存键携带 z{zone_epoch}-c{content_epoch}；任何限制区边界/区间变化都会 bump zone_epoch，
// 此时旧缓存（离线旧计划）整体作废，地图/文本/打印卡全部回到网络源。
const CORE = ['/', '/index.html', '/styles.css', '/app.js', '/i18n.js', '/print.html', '/print.js'];

async function currentVersion() {
  const res = await fetch('/api/version', { cache: 'no-store' });
  if (!res.ok) throw new Error('version fetch failed');
  return (await res.json()).version;
}

function versionCaches(version) {
  return `festival-${version}`;
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      let version = null;
      try { version = await currentVersion(); } catch { version = 'offline'; }
      const keep = versionCaches(version);
      const keys = await caches.keys();
      // 全渠道失效：删除所有版本不匹配的旧缓存
      await Promise.all(keys.map((k) => (k.startsWith('festival-') && k !== keep ? caches.delete(k) : null)));
      const cache = await caches.open(keep);
      try { await cache.addAll(CORE); } catch {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // API（含 /api/pack、/api/version、/api/print）：网络优先，
  // 拿不到网络时 pack 可回退到同版本缓存；print/export 不回退（宁可拒绝，也不发旧卡）。
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(e.request);
          if (res.ok && url.pathname === '/api/pack') {
            try {
              const v = await currentVersion();
              const cache = await caches.open(versionCaches(v));
              cache.put(e.request, res.clone());
            } catch {}
          }
          return res;
        } catch {
          if (url.pathname === '/api/pack') {
            const keys = await caches.keys();
            for (const k of keys) {
              const hit = await caches.match(e.request, { cacheName: k });
              if (hit) return hit;
            }
          }
          return new Response(JSON.stringify({ error: 'offline-unavailable' }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          });
        }
      })()
    );
    return;
  }

  // 静态资源：网络优先，失败回退缓存
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open('festival-static').then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// 收到客户端的新版本通知：清空旧缓存并强制刷新所有标签页
self.addEventListener('message', (e) => {
  if (e.data === 'purge') {
    e.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        const clients = await self.clients.matchAll();
        clients.forEach((c) => c.navigate(c.url));
      })()
    );
  }
});
