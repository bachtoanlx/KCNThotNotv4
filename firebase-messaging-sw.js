// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

// 🚀 Ép Service Worker cài đặt và chiếm quyền điều khiển ngay lập tức
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
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

// ====== BỘ NHỚ ĐỆM TĨNH (Stale-While-Revalidate) ======
const CACHE_NAME = 'kcn-app-cache-v2';

self.addEventListener('fetch', function(event) {
  const request = event.request;
  
  // Chỉ áp dụng cho các request GET cục bộ
  if (request.method !== 'GET') return;
  
  const url = new URL(request.url);
  // Bỏ qua các request tới domain khác (như Firebase Firestore, API ngoài)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(function(cachedResponse) {
      // Tải từ mạng để cập nhật cache ngầm (Revalidate)
      const fetchPromise = fetch(request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
        console.warn('Offline mode: Using cache for', request.url);
      });

      // Trả về bản cache ngay lập tức nếu có, nếu không thì chờ mạng
      return cachedResponse || fetchPromise;
    })
  );
});
