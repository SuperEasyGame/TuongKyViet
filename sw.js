// sw.js
const CACHE_NAME = '0.3.0';

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
    './js/chart.js',
    './manifest.json',
    './vschess/jquery.js',
    './vschess/vschess.function.js',

    './sql/sql-wasm.js',
    './sql/sql-wasm.wasm',

    './js/localbook.js',
    './js/localbook.worker.js',
    
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
    './style/shadow.webp', './style/dot.webp', './style/from.webp', './style/selection.webp', './style/to.webp',

    './style/1-mac_dinh/br.webp', './style/1-mac_dinh/bn.webp', './style/1-mac_dinh/bb.webp', './style/1-mac_dinh/ba.webp', './style/1-mac_dinh/bk.webp', 
    './style/1-mac_dinh/bc.webp', './style/1-mac_dinh/bp.webp','./style/1-mac_dinh/wr.webp', './style/1-mac_dinh/wn.webp', './style/1-mac_dinh/wb.webp', 
    './style/1-mac_dinh/wa.webp', './style/1-mac_dinh/wk.webp', './style/1-mac_dinh/wc.webp', './style/1-mac_dinh/wp.webp',
    './style/1-mac_dinh/blind_b.webp', './style/1-mac_dinh/blind_w.webp',

    './style/2-phi_thuy/br.webp', './style/2-phi_thuy/bn.webp', './style/2-phi_thuy/bb.webp', './style/2-phi_thuy/ba.webp', './style/2-phi_thuy/bk.webp', 
    './style/2-phi_thuy/bc.webp', './style/2-phi_thuy/bp.webp','./style/2-phi_thuy/wr.webp', './style/2-phi_thuy/wn.webp', './style/2-phi_thuy/wb.webp', 
    './style/2-phi_thuy/wa.webp', './style/2-phi_thuy/wk.webp', './style/2-phi_thuy/wc.webp', './style/2-phi_thuy/wp.webp',
    './style/2-phi_thuy/blind_b.webp', './style/2-phi_thuy/blind_w.webp',

    './style/3-giay_nham/br.webp', './style/3-giay_nham/bn.webp', './style/3-giay_nham/bb.webp', './style/3-giay_nham/ba.webp', './style/3-giay_nham/bk.webp', 
    './style/3-giay_nham/bc.webp', './style/3-giay_nham/bp.webp','./style/3-giay_nham/wr.webp', './style/3-giay_nham/wn.webp', './style/3-giay_nham/wb.webp', 
    './style/3-giay_nham/wa.webp', './style/3-giay_nham/wk.webp', './style/3-giay_nham/wc.webp', './style/3-giay_nham/wp.webp',
    './style/3-giay_nham/blind_b.webp', './style/3-giay_nham/blind_w.webp',

    './style/4-go_mun/br.webp', './style/4-go_mun/bn.webp', './style/4-go_mun/bb.webp', './style/4-go_mun/ba.webp', './style/4-go_mun/bk.webp', 
    './style/4-go_mun/bc.webp', './style/4-go_mun/bp.webp','./style/4-go_mun/wr.webp', './style/4-go_mun/wn.webp', './style/4-go_mun/wb.webp', 
    './style/4-go_mun/wa.webp', './style/4-go_mun/wk.webp', './style/4-go_mun/wc.webp', './style/4-go_mun/wp.webp',
    './style/4-go_mun/blind_b.webp', './style/4-go_mun/blind_w.webp',

    './style/5-van_go/br.webp', './style/5-van_go/bn.webp', './style/5-van_go/bb.webp', './style/5-van_go/ba.webp', './style/5-van_go/bk.webp', 
    './style/5-van_go/bc.webp', './style/5-van_go/bp.webp','./style/5-van_go/wr.webp', './style/5-van_go/wn.webp', './style/5-van_go/wb.webp', 
    './style/5-van_go/wa.webp', './style/5-van_go/wk.webp', './style/5-van_go/wc.webp', './style/5-van_go/wp.webp',
    './style/5-van_go/blind_b.webp', './style/5-van_go/blind_w.webp',

    './style/6-galaxy/br.webp', './style/6-galaxy/bn.webp', './style/6-galaxy/bb.webp', './style/6-galaxy/ba.webp', './style/6-galaxy/bk.webp', 
    './style/6-galaxy/bc.webp', './style/6-galaxy/bp.webp','./style/6-galaxy/wr.webp', './style/6-galaxy/wn.webp', './style/6-galaxy/wb.webp', 
    './style/6-galaxy/wa.webp', './style/6-galaxy/wk.webp', './style/6-galaxy/wc.webp', './style/6-galaxy/wp.webp',
    './style/6-galaxy/blind_b.webp', './style/6-galaxy/blind_w.webp',

    './style/7-da_co/br.webp', './style/7-da_co/bn.webp', './style/7-da_co/bb.webp', './style/7-da_co/ba.webp', './style/7-da_co/bk.webp', 
    './style/7-da_co/bc.webp', './style/7-da_co/bp.webp','./style/7-da_co/wr.webp', './style/7-da_co/wn.webp', './style/7-da_co/wb.webp', 
    './style/7-da_co/wa.webp', './style/7-da_co/wk.webp', './style/7-da_co/wc.webp', './style/7-da_co/wp.webp',
    './style/7-da_co/blind_b.webp', './style/7-da_co/blind_w.webp',

    './style/8-hoang_kim/br.webp', './style/8-hoang_kim/bn.webp', './style/8-hoang_kim/bb.webp', './style/8-hoang_kim/ba.webp', './style/8-hoang_kim/bk.webp', 
    './style/8-hoang_kim/bc.webp', './style/8-hoang_kim/bp.webp','./style/8-hoang_kim/wr.webp', './style/8-hoang_kim/wn.webp', './style/8-hoang_kim/wb.webp', 
    './style/8-hoang_kim/wa.webp', './style/8-hoang_kim/wk.webp', './style/8-hoang_kim/wc.webp', './style/8-hoang_kim/wp.webp',
    './style/8-hoang_kim/blind_b.webp', './style/8-hoang_kim/blind_w.webp',

    './style/9-kim_loai/br.webp', './style/9-kim_loai/bn.webp', './style/9-kim_loai/bb.webp', './style/9-kim_loai/ba.webp', './style/9-kim_loai/bk.webp', 
    './style/9-kim_loai/bc.webp', './style/9-kim_loai/bp.webp','./style/9-kim_loai/wr.webp', './style/9-kim_loai/wn.webp', './style/9-kim_loai/wb.webp', 
    './style/9-kim_loai/wa.webp', './style/9-kim_loai/wk.webp', './style/9-kim_loai/wc.webp', './style/9-kim_loai/wp.webp',
    './style/9-kim_loai/blind_b.webp', './style/9-kim_loai/blind_w.webp',

    './style/10-thuy_mac/br.webp', './style/10-thuy_mac/bn.webp', './style/10-thuy_mac/bb.webp', './style/10-thuy_mac/ba.webp', './style/10-thuy_mac/bk.webp', 
    './style/10-thuy_mac/bc.webp', './style/10-thuy_mac/bp.webp','./style/10-thuy_mac/wr.webp', './style/10-thuy_mac/wn.webp', './style/10-thuy_mac/wb.webp', 
    './style/10-thuy_mac/wa.webp', './style/10-thuy_mac/wk.webp', './style/10-thuy_mac/wc.webp', './style/10-thuy_mac/wp.webp',
    './style/10-thuy_mac/blind_b.webp', './style/10-thuy_mac/blind_w.webp',

    './style/11-hoa_sen/br.webp', './style/11-hoa_sen/bn.webp', './style/11-hoa_sen/bb.webp', './style/11-hoa_sen/ba.webp', './style/11-hoa_sen/bk.webp', 
    './style/11-hoa_sen/bc.webp', './style/11-hoa_sen/bp.webp','./style/11-hoa_sen/wr.webp', './style/11-hoa_sen/wn.webp', './style/11-hoa_sen/wb.webp', 
    './style/11-hoa_sen/wa.webp', './style/11-hoa_sen/wk.webp', './style/11-hoa_sen/wc.webp', './style/11-hoa_sen/wp.webp',
    './style/11-hoa_sen/blind_b.webp', './style/11-hoa_sen/blind_w.webp',

    './style/12-go_do/br.webp', './style/12-go_do/bn.webp', './style/12-go_do/bb.webp', './style/12-go_do/ba.webp', './style/12-go_do/bk.webp', 
    './style/12-go_do/bc.webp', './style/12-go_do/bp.webp','./style/12-go_do/wr.webp', './style/12-go_do/wn.webp', './style/12-go_do/wb.webp', 
    './style/12-go_do/wa.webp', './style/12-go_do/wk.webp', './style/12-go_do/wc.webp', './style/12-go_do/wp.webp',
    './style/12-go_do/blind_b.webp', './style/12-go_do/blind_w.webp',

    './sound/check.mp3', './sound/eat.mp3', './sound/lose.mp3', './sound/move.mp3',

    // DỮ LIỆU CÁC BÀI TẬP 
    './data/challenge.json',
    './data/manifest.json',

    './data/chien_thuat/001-chieu-tuong-bat-quan.json',
    './data/chien_thuat/002-don-bat-doi.json',
    './data/chien_thuat/003-don-xien-tao.json',
    './data/chien_thuat/004-don-khong-che.json',
    './data/chien_thuat/005-don-vay-khon.json',
    './data/chien_thuat/006-don-ngan-chan.json',
    './data/chien_thuat/007-don-thao-can.json',
    './data/chien_thuat/008-loi-keo-ra-xa.json',
    './data/chien_thuat/009-loi-keo-lai-gan.json',
    './data/chien_thuat/010-Don-don-du.json',
    './data/chien_thuat/011-Don-chuyen-doi.json',
    './data/chien_thuat/012-Don-tac-duong.json',
    './data/chien_thuat/013-Don-pha-hoai.json',
    './data/chien_thuat/014-Don-chuyen-quan.json',
    './data/chien_thuat/015-Don-thi-quan.json',
    './data/chien_thuat/016-Don-bat-quan.json',
    './data/chien_thuat/manifest.json',

    './data/co_the/001-Thich-tinh-nha-thu-p1.json',
    './data/co_the/002-Thich-tinh-nha-thu-p2.json',
    './data/co_the/003-Thich-tinh-nha-thu-p3.json',
    './data/co_the/004-The-co-thu-vi.json',
    './data/co_the/manifest.json',

    './data/sat_phap/001-nuoc-sat-xe-phao-ma-tot.json',
    './data/sat_phap/002-sat-phap-co-ban-27-kieu.json',
    './data/sat_phap/003-Tuong-ky-sat-phap-can-ban.json',
    './data/sat_phap/004-Thuc-chien-sat-cuc.json',
    './data/sat_phap/005-Tuong-ky-sat-the.json',
    './data/sat_phap/006-Sat-cuc-bao-dien.json',
    './data/sat_phap/007-kiem-tra-suc-co.json',
    './data/sat_phap/manifest.json',

    './data/sat_phap/1_den_20_nuoc_lien_sat/001-1-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/002-2-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/003-3-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/004-4-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/005-5-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/006-6-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/007-7-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/008-8-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/009-9-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/010-10-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/011-11-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/012-12-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/013-13-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/014-14-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/015-15-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/016-16-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/017-17-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/018-18-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/019-19-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/020-20-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/manifest.json',

    './data/sat_phap/3712_bai_sat_phap_co_ban/001-3712-bai-sat-phap-co-ban-(phan-1).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/002-3712-bai-sat-phap-co-ban-(phan-2).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/003-3712-bai-sat-phap-co-ban-(phan-3).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/004-3712-bai-sat-phap-co-ban-(phan-4).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/005-3712-bai-sat-phap-co-ban-(phan-5).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/006-3712-bai-sat-phap-co-ban-(phan-6).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/007-3712-bai-sat-phap-co-ban-(phan-7).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/008-3712-bai-sat-phap-co-ban-(phan-8).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/manifest.json',

    './data/tan_cuc/001-co_tan_tot.json',
    './data/tan_cuc/002-co_tan_ma.json',
    './data/tan_cuc/003-co_tan_hai_ma.json',
    './data/tan_cuc/004-co_tan_ma_tot.json',
    './data/tan_cuc/005-co_tan_phao.json',
    './data/tan_cuc/006-co_tan_phao_tot.json',
    './data/tan_cuc/007-co_tan_hai_phao.json',
    './data/tan_cuc/008-co_tan_phao_ma.json',
    './data/tan_cuc/009-co_tan_xe.json',
    './data/tan_cuc/010-co_tan_xe_tot.json',
    './data/tan_cuc/011-xe_phao_si_tuong_thang_xe_2_tuong.json',
    './data/tan_cuc/012-Tan-cuc-bao-dien.json',
    './data/tan_cuc/013-Tan-cuc-thuc-chien.json',
    './data/tan_cuc/016-tan_cuc_phi_tieu.json',
    './data/tan_cuc/017-tuong_ky_tan_cuc_sat_the.json',
    './data/tan_cuc/018-ki_xao_cong_sat_co_tan.json',
    './data/tan_cuc/019-sat-chuoc-dai-toan-p1.json',
    './data/tan_cuc/020-sat-chuoc-dai-toan-p2.json',
    './data/tan_cuc/021-sat-chuoc-dai-toan-p3.json',
    './data/tan_cuc/022-co_tan_cong_sat_p1.json',
    './data/tan_cuc/023-co_tan_cong_sat_p2.json',
    './data/tan_cuc/manifest.json',

    './data/tan_cuc/chuyen_tap/001-xe_ma_chuyen_tap.json',
    './data/tan_cuc/chuyen_tap/002-phao_tot_chuyen_tap.json',
    './data/tan_cuc/chuyen_tap/003-ma_tot_chuyen_tap.json',
    './data/tan_cuc/chuyen_tap/manifest.json',

    './data/tan_cuc/co_tan_thuc_dung/001-co_tan_thuc_dung.json',
    './data/tan_cuc/co_tan_thuc_dung/002-co_tan_thuc_dung.json',
    './data/tan_cuc/co_tan_thuc_dung/003-co_tan_thuc_dung.json',
    './data/tan_cuc/co_tan_thuc_dung/manifest.json',
    
    './data/trung_cuc/001-Chien-thuat-trung-cuc-co-ban.json',
    './data/trung_cuc/002-Trung-cuc-sat-phap.json',
    './data/trung_cuc/003-Trung-cuc-dieu-thu.json',
    './data/trung_cuc/004-Trung-cuc-tinh-dieu-chien-phap.json',
    './data/trung_cuc/005-Trung-cuc-thuc-chien.json',
    './data/trung_cuc/006-Trung-tan-kinh-dien.json',
    './data/trung_cuc/007-Trung-tan-thuc-chien-p1.json',
    './data/trung_cuc/008-Trung-tan-thuc-chien-p2.json',
    './data/trung_cuc/manifest.json'
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