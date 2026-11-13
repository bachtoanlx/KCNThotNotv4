// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

const CACHE_NAME = 'kcn-app-cache-v3';

// 🚀 Ép Service Worker cài đặt và chiếm quyền điều khiển ngay lập tức
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(name) {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Cho phép trang chính gửi lệnh xóa cache hoặc kích hoạt SW mới ngay lập tức
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_ALL_CACHES') {
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) { return caches.delete(name); }));
    });
  }
});

// Cấu hình Firebase y hệt như trong script.js của bạn
const firebaseConfig = {
  apiKey: "AIzaSyB_OQlcgAsq7-W3fX1nv5nQQmpHl0pIzg0",
  authDomain: "kcnthotnot25.firebaseapp.com",
  projectId: "kcnthotnot25",
  storageBucket: "kcnthotnot25.firebasestorage.app",
  messagingSenderId: "456384727251",
  appId: "1:456384727251:web:ac452826d113ca1902ac26",
  measurementId: "G-GJDQ0R29EC"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ====== BỘ NHỚ ĐỆM TĨNH (Network-First: Luôn lấy Code mới nhất khi có mạng, dự phòng Cache khi Offline) ======
self.addEventListener('fetch', function(event) {
  const request = event.request;
  
  // Chỉ áp dụng cho các request GET cục bộ
  if (request.method !== 'GET') return;
  
  const url = new URL(request.url);
  // Bỏ qua các request tới domain khác (như Firebase Firestore, API ngoài)
  if (url.origin !== self.location.origin) return;

  // Bỏ qua cache đối với version.json hoặc các request có gắn tham số chống cache (?t=...)
  if (url.pathname.endsWith('/version.json') || url.searchParams.has('t')) {
    return;
  }

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(function() {
        console.warn('Offline mode: Using cache for', request.url);
        return caches.match(request);
      })
  );
});
