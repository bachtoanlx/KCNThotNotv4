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

// Lắng nghe thông báo khi trang web đang bị ĐÓNG hoặc CHẠY NGẦM
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Nhận được thông báo ngầm: ', payload);
  
  // 🚀 Firebase đã TỰ ĐỘNG hiển thị thông báo nếu payload có chứa object "notification".
  // Chúng ta không cần gọi self.registration.showNotification ở đây nữa để tránh bị đúp 2 thông báo.
});
