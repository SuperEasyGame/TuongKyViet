// sw.js
const CACHE_NAME = '0.0.9';

const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './main.js',
    './js/config.js',
    './js/state.js',
    './js/ui.js',
    './js/board.js',
    './js/game.js',
    './js/editor.js',
    './js/io.js',
    './js/events.js',
    './js/rules.js',
    './js/db.js',
    './manifest.json',
    './vschess/jquery.js',
    './vschess/vschess.function.js',
    
    // FILE DỮ LIỆU DÙNG CHUNG CỦA AI
    './engines/pikafish.data',
    
    // CÁC BẢN BUILD AI (Được load động bằng Blob Worker)
    './engines/single/pikafish.js', 
    './engines/single/pikafish.wasm',
    
    './engines/single_simd/pikafish.js', 
    './engines/single_simd/pikafish.wasm',
    
    './engines/multi/pikafish.js', 
    './engines/multi/pikafish.wasm', 
    './engines/multi/pikafish.worker.js',
    
    './engines/multi_simd/pikafish.js', 
    './engines/multi_simd/pikafish.wasm', 
    './engines/multi_simd/pikafish.worker.js',
    
    './engines/multi_simd_relaxed/pikafish.js', 
    './engines/multi_simd_relaxed/pikafish.wasm', 
    './engines/multi_simd_relaxed/pikafish.worker.js',
    
    // GIAO DIỆN VÀ ÂM THANH
    './style/board.webp', './style/shadow.webp', './style/dot.webp', './style/from.webp', './style/selection.webp', './style/to.webp',
    './style/br.webp', './style/bn.webp', './style/bb.webp', './style/ba.webp', './style/bk.webp', './style/bc.webp', './style/bp.webp',
    './style/wr.webp', './style/wn.webp', './style/wb.webp', './style/wa.webp', './style/wk.webp', './style/wc.webp', './style/wp.webp',
    './sound/check.mp3', './sound/eat.mp3', './sound/lose.mp3', './sound/move.mp3'
];

self.addEventListener('install', (event) => {
    console.log('[Service Worker] Đang cài đặt và lưu trữ Cache...');
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // SỬA LỖI TREO APP: Tải từng file, lỗi file nào bỏ qua file đó!
            return Promise.all(
                urlsToCache.map(url => {
                    return cache.add(url).catch(err => {
                        console.warn('[SW] Không thể cache file (Bỏ qua):', url);
                    });
                })
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) 
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/')) return;
    if (event.request.url.startsWith('chrome-extension://')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            }).catch(() => {
                console.log('[Service Worker] Lỗi mạng:', event.request.url);
            });
        })
    );
});