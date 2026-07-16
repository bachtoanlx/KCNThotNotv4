// script.js
// Firebase core
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";


// Firebase Auth
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// Firebase Firestore
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  where,
  limit,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// Khởi tạo biến lưu thời điểm load trang làm mốc an toàn
window.appSessionStartTime = Date.now();

// Firebase Cloud Messaging
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js";



// 🚀 Firebase config (public - được bảo vệ bởi Firebase Security Rules)
const firebaseConfig = {
  apiKey: "AIzaSyB_OQlcgAsq7-W3fX1nv5nQQmpHl0pIzg0",
  authDomain: "kcnthotnot25.firebaseapp.com",
  projectId: "kcnthotnot25",
  storageBucket: "kcnthotnot25.firebasestorage.app",
  messagingSenderId: "456384727251",
  appId: "1:456384727251:web:ac452826d113ca1902ac26",
  measurementId: "G-GJDQ0R29EC"
};

export let config = { defaultHolidays: {} };
// ====== Firebase khởi tạo ======
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// 🚀 Bật Cache ngoại tuyến (Offline Persistence) giảm chi phí đọc
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const messaging = getMessaging(app);

// ====== AUTH ======
export function onAuth(callback) {
  let currentUserState = "pending"; // Trạng thái: "pending", "logged_in", "logged_out"
  
  // 1. Optimistic Authentication: Trả về user ngay từ localStorage (nếu có) để vượt qua độ trễ mạng
  const cachedUserStr = localStorage.getItem("optimistic_auth_user");
  if (cachedUserStr) {
    try {
      const cachedUser = JSON.parse(cachedUserStr);
      currentUserState = "logged_in";
      callback(cachedUser);
    } catch (e) {
      console.warn("Lỗi đọc cache user:", e);
    }
  }

  // 2. Chạy ngầm onAuthStateChanged để xác minh thực tế
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Cập nhật lại cache với thông tin an toàn
      const userToCache = { 
        uid: user.uid, 
        email: user.email, 
        displayName: user.displayName,
        photoURL: user.photoURL
      };
      localStorage.setItem("optimistic_auth_user", JSON.stringify(userToCache));
      
      // Nếu trạng thái trước đó không phải "logged_in" (ví dụ: họ vừa mới bấm đăng nhập), ta kích hoạt callback
      if (currentUserState !== "logged_in") {
        currentUserState = "logged_in";
        callback(user);
      }
    } else {
      // User đã đăng xuất hoặc token hết hạn/bị xóa
      localStorage.removeItem("optimistic_auth_user");
      
      // Nếu trạng thái trước đó không phải "logged_out", ta gọi callback(null) để UI xử lý đăng xuất
      if (currentUserState !== "logged_out") {
        currentUserState = "logged_out";
        callback(null);
      }
    }
  });
}

// ====== CLOUD MESSAGING (FCM) ======
export async function initFCM(email) {
  try {
    let permission = Notification.permission;
    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }
    if (permission === 'granted') {
      // 🚀 Đăng ký Service Worker thủ công với đường dẫn tương đối cho Github Pages
      let swRegistration = null;
      if ('serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
        swRegistration = await navigator.serviceWorker.ready;
      }

      const currentToken = await getToken(messaging, {
        vapidKey: "BKpLjAuAte8ay_adRyliXxgFTAH_Wh3ID9tMVU6d8nSGbDRH3scSoT1FgGUm0GVaujVnZ7nnwtZYZv5g2AOX7CY",
        serviceWorkerRegistration: swRegistration
      });

      if (currentToken) {
        await setDoc(doc(db, "users", email), {
          fcmToken: currentToken,
          email: email,
          updatedAt: serverTimestamp()
        }, { merge: true });
        console.log("✅ Đã lưu FCM Token thành công!");
      }
    } else if (permission === 'denied') {
      // 🚀 Cảnh báo ngay lập tức nếu người dùng VỪA bấm "Chặn" trên popup của trình duyệt
      window.Swal.fire({
        title: 'Bạn đã chặn thông báo!',
        html: 'Hệ thống sẽ không thể gửi các Cảnh báo đến thiết bị này.<br><br>Nếu muốn, bạn hãy bấm vào biểu tượng <b>ổ khóa 🔒</b> trên thanh địa chỉ, chuyển phần <b>Thông báo (Notifications)</b> sang <b>Cho phép (Allow)</b> và tải lại trang.',
        icon: 'error',
        confirmButtonText: 'Đã hiểu',
        confirmButtonColor: '#273668'
      });
    }

    // Lắng nghe thông báo khi web ĐANG MỞ
    onMessage(messaging, (payload) => {
      console.log("[FCM] Nhận tin nhắn Foreground:", payload);
      const title = payload.notification?.title || "Thông báo";
      const body = payload.notification?.body || "";

      // 🚀 Luôn bắn thông báo Hệ điều hành (Góc màn hình) thay vì dùng SweetAlert để tránh bị ghi đè
      if (Notification.permission === "granted") {
        const notif = new Notification(title, { body: body });
        // Khi click vào thông báo ở góc, tự động focus lại tab web này
        notif.onclick = function () { window.focus(); this.close(); };

        // (Tùy chọn) Hiện thêm popup nhỏ trên web để chắc chắn admin không bỏ lỡ nếu Windows bị lỗi
        showSwal("info", title, { html: body, timer: 5000 });
      }
    });
  } catch (error) {
    console.warn("Lỗi khởi tạo FCM (Có thể do chạy HTTP localhost thay vì HTTPS):", error);
  }
}
// Tạo mã định danh bằng vân tay trình duyệt (Browser Fingerprint)
export function getBrowserFingerprint() {
  const traits = [
    navigator.userAgent,
    screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.hardwareConcurrency || 'unknown'
  ];

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 200;
    canvas.height = 30;
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("KCN_DeviceFingerprint", 2, 2);
    traits.push(canvas.toDataURL());
  } catch (e) {
    // Không hỗ trợ canvas hoặc bị chặn
  }

  const rawString = traits.join('|');

  // Thuật toán băm cyrb53
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0, ch; i < rawString.length; i++) {
    ch = rawString.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');

  return 'fp_' + hash;
}

// Thiết lập Device ID để kiểm tra phiên đăng nhập trên thiết bị khác
let deviceId = localStorage.getItem('deviceId');
if (!deviceId) {
  // Sử dụng Dấu vân tay thiết bị làm Device ID để đảm bảo tính ổn định kể cả khi xóa lịch sử web
  deviceId = getBrowserFingerprint();
  localStorage.setItem('deviceId', deviceId);
}
// Nhãn thân thiện của thiết bị hiện tại
export async function getDeviceLabel() {
  const ua = navigator.userAgent;
  let os = "Thiết bị khác";
  let browser = "Trình duyệt khác";

  // 1. Lấy thông tin model từ User-Agent Client Hints nếu có hỗ trợ (cho kết quả chính xác nhất trên Chrome/Edge Android)
  let hintsModel = "";
  if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function') {
    try {
      const entropy = await navigator.userAgentData.getHighEntropyValues(['model']);
      hintsModel = entropy.model || "";
    } catch (e) {
      console.warn("Lỗi đọc userAgentData hints:", e);
    }
  }

  // 2. Phân tích Trình duyệt và phiên bản của nó
  let browserVer = "";
  if (/Edg\/(\d+)/i.test(ua)) {
    browser = "Edge";
    browserVer = ua.match(/Edg\/(\d+)/i)[1];
  } else if (/Chrome\/(\d+)/i.test(ua) && !/Chromium/i.test(ua)) {
    browser = "Chrome";
    browserVer = ua.match(/Chrome\/(\d+)/i)[1];
  } else if (/Safari\/(\d+)/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = "Safari";
    const verMatch = ua.match(/Version\/(\d+)/i);
    browserVer = verMatch ? verMatch[1] : "";
  } else if (/Firefox\/(\d+)/i.test(ua)) {
    browser = "Firefox";
    browserVer = ua.match(/Firefox\/(\d+)/i)[1];
  }
  const browserDisplay = browserVer ? `${browser} ${browserVer}` : browser;

  // 3. Phân tích Hệ điều hành và Model cụ thể
  if (/Windows NT/i.test(ua)) {
    os = "Windows PC";
  } else if (/Macintosh/i.test(ua)) {
    os = "Mac";
    const macVerMatch = ua.match(/Mac OS X (\d+[._]\d+)/i);
    if (macVerMatch) {
      os = `Mac (OS X ${macVerMatch[1].replace('_', '.')})`;
    }
  } else if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    os = "Linux PC";
  } else if (/iPhone/i.test(ua)) {
    // Dự đoán dòng iPhone dựa trên kích thước màn hình và DPR
    const width = screen.width;
    const height = screen.height;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(width, height);
    const h = Math.max(width, height);

    let iphoneModel = "iPhone";
    if (w === 430 && h === 932 && dpr === 3) iphoneModel = "iPhone 14/15 Pro Max";
    else if (w === 393 && h === 852 && dpr === 3) iphoneModel = "iPhone 14/15 Pro";
    else if (w === 428 && h === 926 && dpr === 3) iphoneModel = "iPhone 12/13/14 Plus/Pro Max";
    else if (w === 390 && h === 844 && dpr === 3) iphoneModel = "iPhone 12/13/14/Pro";
    else if (w === 414 && h === 896 && dpr === 3) iphoneModel = "iPhone XS Max/11 Pro Max";
    else if (w === 414 && h === 896 && dpr === 2) iphoneModel = "iPhone XR/11";
    else if (w === 375 && h === 812 && dpr === 3) iphoneModel = "iPhone X/XS/11 Pro/Mini";
    else if (w === 414 && h === 736 && dpr === 3) iphoneModel = "iPhone 6+/7+/8+";
    else if (w === 375 && h === 667 && dpr === 2) iphoneModel = "iPhone 6/7/8/SE";
    else if (w === 320 && h === 568 && dpr === 2) iphoneModel = "iPhone 5/SE(1st)";

    os = iphoneModel;
  } else if (/iPad/i.test(ua)) {
    os = "iPad";
  } else if (/Android/i.test(ua)) {
    let androidModel = hintsModel;

    if (!androidModel) {
      // Dự phòng phân tích User Agent nếu Client Hints trống hoặc không được hỗ trợ
      const match = ua.match(/\(([^)]+)\)/);
      if (match) {
        const parts = match[1].split(';').map(p => p.trim());
        const androidIdx = parts.findIndex(p => p.toLowerCase().includes('android'));
        if (androidIdx !== -1) {
          for (let i = androidIdx + 1; i < parts.length; i++) {
            const part = parts[i];
            // Bỏ qua mã ngôn ngữ
            if (/^[a-z]{2}-[a-z]{2}$/i.test(part)) continue;
            // Bỏ qua các từ khóa hệ thống
            if (part === 'U' || part === 'wv' || part === 'Mobi') continue;

            androidModel = part.split('Build/')[0].trim();
            break;
          }
        }
      }
    }

    if (!androidModel) {
      androidModel = "Android";
    }

    // Chuẩn hóa một số hãng điện thoại phổ biến
    if (androidModel.toUpperCase().startsWith("SAMSUNG ")) {
      androidModel = "Samsung " + androidModel.substring(8);
    } else if (/^SM-/i.test(androidModel)) {
      androidModel = "Samsung " + androidModel;
    } else if (androidModel.toLowerCase().startsWith("redmi") || androidModel.toLowerCase().startsWith("mi ") || androidModel.toLowerCase().startsWith("poco")) {
      androidModel = "Xiaomi " + androidModel;
    } else if (androidModel.toLowerCase().startsWith("cph") || androidModel.toLowerCase().startsWith("oppo")) {
      androidModel = "OPPO " + androidModel;
    } else if (androidModel.toLowerCase().startsWith("v2") || androidModel.toLowerCase().startsWith("vivo")) {
      androidModel = "Vivo " + androidModel;
    }

    os = androidModel;
  }

  const res = `${screen.width}x${screen.height}`;
  return `${os} (${browserDisplay}) - ${res}`;
}

// Nhận diện loại thiết bị
export function getDeviceType() {
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return 'mobile';
  }
  return 'pc';
}

// Tải trạng thái tin cậy đã biết từ lần trước để tránh độ trễ
window.isCurrentDeviceTrusted = localStorage.getItem('isCurrentDeviceTrusted') !== 'false';

export async function checkAndUpdateUserDevice(userEmailSafe) {
  const deviceType = getDeviceType();
  const docRef = doc(db, "users", userEmailSafe);

  try {
    const docSnap = await getDoc(docRef);
    let isTrusted = true;
    const isSessionCounted = sessionStorage.getItem('deviceSessionCounted') === 'true';

    let updateData = {
      email: userEmailSafe,
      lastActiveAt: serverTimestamp(),
      deviceLabels: {
        [deviceId]: await getDeviceLabel()
      }
    };

    if (deviceType === 'pc') {
      updateData.lastPCDeviceId = deviceId;
    } else {
      updateData.lastMobileDeviceId = deviceId;
    }
    if (docSnap.exists()) {
      const data = docSnap.data();

      if (deviceType === 'pc') {
        let trustedPCs = Array.isArray(data.trustedPCs) ? data.trustedPCs : [];
        if (data.trustedPC && !trustedPCs.includes(data.trustedPC)) {
          trustedPCs.push(data.trustedPC);
        }

        const candidatePC = data.candidatePC;
        const candidatePCCount = data.candidatePCCount || 0;

        if (trustedPCs.length === 0) {
          trustedPCs.push(deviceId);
          updateData.trustedPCs = trustedPCs;
          isTrusted = true;
        } else if (trustedPCs.includes(deviceId)) {
          isTrusted = true;
          if (candidatePC || candidatePCCount > 0) {
            updateData.candidatePC = null;
            updateData.candidatePCCount = 0;
          }
        } else {
          if (candidatePC === deviceId) {
            if (!isSessionCounted) {
              const newCount = candidatePCCount + 1;
              if (newCount >= 2) {
                trustedPCs.push(deviceId);
                if (trustedPCs.length > 2) {
                  trustedPCs.shift();
                }
                updateData.trustedPCs = trustedPCs;
                updateData.candidatePC = null;
                updateData.candidatePCCount = 0;
                isTrusted = true;
                console.log("[Bảo mật] PC này đã được chấp nhận vào danh sách thiết bị tin cậy.");
              } else {
                updateData.candidatePCCount = newCount;
                isTrusted = false;
              }
              sessionStorage.setItem('deviceSessionCounted', 'true');
            } else {
              isTrusted = false;
            }
          } else {
            if (!isSessionCounted) {
              updateData.candidatePC = deviceId;
              updateData.candidatePCCount = 1;
              sessionStorage.setItem('deviceSessionCounted', 'true');
            }
            isTrusted = false;
          }
        }

      } else { // mobile
        let trustedMobiles = Array.isArray(data.trustedMobiles) ? data.trustedMobiles : [];
        if (data.trustedMobile && !trustedMobiles.includes(data.trustedMobile)) {
          trustedMobiles.push(data.trustedMobile);
        }

        const candidateMobile = data.candidateMobile;
        const candidateMobileCount = data.candidateMobileCount || 0;

        if (trustedMobiles.length === 0) {
          trustedMobiles.push(deviceId);
          updateData.trustedMobiles = trustedMobiles;
          isTrusted = true;
        } else if (trustedMobiles.includes(deviceId)) {
          isTrusted = true;
          if (candidateMobile || candidateMobileCount > 0) {
            updateData.candidateMobile = null;
            updateData.candidateMobileCount = 0;
          }
        } else {
          if (candidateMobile === deviceId) {
            if (!isSessionCounted) {
              const newCount = candidateMobileCount + 1;
              if (newCount >= 2) {
                trustedMobiles.push(deviceId);
                if (trustedMobiles.length > 2) {
                  trustedMobiles.shift();
                }
                updateData.trustedMobiles = trustedMobiles;
                updateData.candidateMobile = null;
                updateData.candidateMobileCount = 0;
                isTrusted = true;
                console.log("[Bảo mật] Mobile này đã được chấp nhận vào danh sách thiết bị tin cậy.");
              } else {
                updateData.candidateMobileCount = newCount;
                isTrusted = false;
              }
              sessionStorage.setItem('deviceSessionCounted', 'true');
            } else {
              isTrusted = false;
            }
          } else {
            if (!isSessionCounted) {
              updateData.candidateMobile = deviceId;
              updateData.candidateMobileCount = 1;
              sessionStorage.setItem('deviceSessionCounted', 'true');
            }
            isTrusted = false;
          }
        }
      }
    } else {
      if (deviceType === 'pc') {
        updateData.trustedPCs = [deviceId];
      } else {
        updateData.trustedMobiles = [deviceId];
      }
      isTrusted = true;
    }

    await setDoc(docRef, updateData, { merge: true });
    window.isCurrentDeviceTrusted = isTrusted;
    localStorage.setItem('isCurrentDeviceTrusted', isTrusted ? 'true' : 'false');

    // Cập nhật viền cam cho nút Đăng xuất trên thiết bị lạ
    try {
      const logoutBtn = document.getElementById("logoutBtn");
      if (logoutBtn) {
        if (!isTrusted) {
          logoutBtn.style.border = "2px solid #e67e22";
          logoutBtn.title = "Thiết bị này tạm thời được coi là máy lạ (tự động đăng xuất sau 1 giờ)";
        } else {
          logoutBtn.style.border = "";
          logoutBtn.title = "";
        }
      }
    } catch (e) {
      console.warn("Lỗi cập nhật viền nút đăng xuất:", e);
    }

    return isTrusted;
  } catch (err) {
    console.error("Lỗi khi kiểm tra thiết bị:", err);
    window.isCurrentDeviceTrusted = true;
    localStorage.setItem('isCurrentDeviceTrusted', 'true');
    return true;
  }
}

// Khởi tạo FCM ngầm cho tất cả các trang khi user đăng nhập thành công
let currentUserSnapshotUnsubscribe = null;

onAuthStateChanged(auth, async (user) => {
  if (currentUserSnapshotUnsubscribe) {
    currentUserSnapshotUnsubscribe();
    currentUserSnapshotUnsubscribe = null;
  }

  if (user) {
    const userEmailSafe = user.email ? user.email.toLowerCase() : "unknown";

    try {
      await checkAndUpdateUserDevice(userEmailSafe);
    } catch (e) {
      console.warn("Không thể lưu thông tin đăng nhập ban đầu:", e);
    }

    // Sửa lỗi: Chỉ khởi tạo FCM ngầm nếu quyền thông báo ĐÃ ĐƯỢC CẤP TỪ TRƯỚC.
    if (Notification.permission === 'granted') {
      initFCM(user.email);
    } else {
      console.log("[FCM] Đang đợi người dùng cấp quyền thông báo qua thao tác nhấp chuột.");
    }

    // Lắng nghe yêu cầu ép đăng xuất từ Admin
    currentUserSnapshotUnsubscribe = onSnapshot(doc(db, "users", userEmailSafe), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // Cập nhật trạng thái tin cậy hiện tại từ Firestore theo thời gian thực
        const deviceType = getDeviceType();
        let isTrusted = false;
        if (deviceType === 'pc') {
          const trustedPCs = Array.isArray(data.trustedPCs) ? data.trustedPCs : [];
          isTrusted = trustedPCs.includes(deviceId);
        } else {
          const trustedMobiles = Array.isArray(data.trustedMobiles) ? data.trustedMobiles : [];
          isTrusted = trustedMobiles.includes(deviceId);
        }
        window.isCurrentDeviceTrusted = isTrusted;
        localStorage.setItem('isCurrentDeviceTrusted', isTrusted ? 'true' : 'false');

        // Cập nhật viền cam thời gian thực cho nút Đăng xuất
        try {
          const logoutBtn = document.getElementById("logoutBtn");
          if (logoutBtn) {
            if (!isTrusted) {
              logoutBtn.style.border = "2px solid #e67e22";
              logoutBtn.title = "Thiết bị này tạm thời được coi là máy lạ (tự động đăng xuất sau 1 giờ)";
            } else {
              logoutBtn.style.border = "";
              logoutBtn.title = "";
            }
          }
        } catch (e) {
          console.warn("Lỗi cập nhật viền nút đăng xuất trong onSnapshot:", e);
        }

        // Kiểm tra nếu tài khoản được đăng nhập ở thiết bị khác của cùng loại
        if (deviceType === 'pc') {
          if (data.lastPCDeviceId && data.lastPCDeviceId !== deviceId) {
            console.log("[Bảo mật] Tài khoản đã được đăng nhập ở PC khác. Đăng xuất...");
            if (currentUserSnapshotUnsubscribe) {
              currentUserSnapshotUnsubscribe();
              currentUserSnapshotUnsubscribe = null;
            }
            const shouldClear = !window.isCurrentDeviceTrusted;
            if (shouldClear) {
              clearLocalDB().then(() => {
                signOut(auth);
              });
            } else {
              signOut(auth);
            }
            return;
          }
        } else {
          if (data.lastMobileDeviceId && data.lastMobileDeviceId !== deviceId) {
            console.log("[Bảo mật] Tài khoản đã được đăng nhập ở Điện thoại khác. Đăng xuất...");
            if (currentUserSnapshotUnsubscribe) {
              currentUserSnapshotUnsubscribe();
              currentUserSnapshotUnsubscribe = null;
            }
            const shouldClear = !window.isCurrentDeviceTrusted;
            if (shouldClear) {
              clearLocalDB().then(() => {
                signOut(auth);
              });
            } else {
              signOut(auth);
            }
            return;
          }
        }
        if (data.forceLogoutAt) {
          // Đọc thời gian chính xác kể cả khi bị vỡ do Cache Offline
          let forceTime = 0;
          if (data.forceLogoutAt && typeof data.forceLogoutAt.toMillis === 'function') {
            forceTime = data.forceLogoutAt.toMillis();
          } else if (data.forceLogoutAt && data.forceLogoutAt.seconds) {
            forceTime = data.forceLogoutAt.seconds * 1000;
          }

          // Phương pháp lấy giờ đăng nhập chính xác nhất đa nền tảng
          let loginTime = 0;
          if (user.metadata.lastLoginAt) {
            loginTime = parseInt(user.metadata.lastLoginAt, 10);
          } else if (user.metadata.lastSignInTime) {
            loginTime = new Date(user.metadata.lastSignInTime).getTime();
          }

          // Nếu có sự cố đọc giờ, dùng giờ khởi tạo app trừ 5 giây làm mốc an toàn
          if (!loginTime || isNaN(loginTime)) {
            loginTime = window.appSessionStartTime - 5000;
          }

          // BÙ TRỪ ĐỘ TRỄ: Thêm 2000ms để tránh việc giờ login và giờ ép đăng xuất bị trùng/lệch do server
          if (forceTime > 0 && forceTime > (loginTime + 2000)) {
            console.log("Đăng xuất bởi Admin.", { forceTime, loginTime });
            addLog("forced_logout_executed", { email: userEmailSafe, status: "success", reason: "Đăng xuất bởi Admin." });

            if (currentUserSnapshotUnsubscribe) {
              currentUserSnapshotUnsubscribe();
              currentUserSnapshotUnsubscribe = null;
            }

            logout(true).then(() => {
              window.Swal.fire({
                title: 'Đăng xuất',
                text: 'Tài khoản của bạn đã bị quản trị viên đăng xuất.',
                icon: 'warning',
                confirmButtonText: 'Đã hiểu',
                allowOutsideClick: false,
                allowEscapeKey: false
              }).then(() => {
                window.location.reload(); // Tự động làm mới trang web về trạng thái khách
              });
            }).catch((e) => {
              console.error("Lỗi đăng xuất", e);
              window.location.reload();
            });
          }
        }
      }
    }, (error) => {
      console.error("Lỗi lắng nghe users collection:", error);
    });
  } else {
    // Đăng xuất hoặc chưa đăng nhập
    try {
      sessionStorage.removeItem('deviceSessionCounted');
    } catch (e) {
      console.warn("Lỗi xóa sessionStorage khi auth state thay đổi:", e);
    }
  }
});

// ====== HÀM YÊU CẦU QUYỀN THÔNG BÁO (SOFT ASK / DOUBLE OPT-IN) ======
export async function requestNotificationPermission() {
  if (Notification.permission === 'granted') {
    showSwal("info", "Đã bật", { html: "Thông báo hệ thống đã được bật từ trước." });
    return;
  }

  // 🚀 Kiểm tra nếu thiết bị đang trong trạng thái chặn
  if (Notification.permission === 'denied') {
    window.Swal.fire({
      title: 'Thông báo đang bị chặn',
      html: 'Trình duyệt của bạn hiện đang <b>chặn</b> thông báo từ trang web này.<br><br><b>Cách mở lại:</b><br>1. Bấm vào biểu tượng <b>ổ khóa 🔒</b> (hoặc biểu tượng tùy chỉnh) trên thanh địa chỉ.<br>2. Tìm mục <i>Thông báo (Notifications)</i> và chuyển sang <b>Cho phép (Allow)</b>.<br>3. Tải lại trang web (F5).',
      icon: 'warning',
      confirmButtonText: 'Đã hiểu',
      confirmButtonColor: '#273668'
    });
    return;
  }

  // Hỏi khéo bằng SweetAlert2 trước khi gọi requestPermission của trình duyệt
  const isConfirmed = await showConfirmSwal(
    "Bật thông báo hệ thống",
    "Để không bỏ lỡ các cảnh báo quan trọng (ví dụ: cảnh báo chỉ số nước giảm, cập nhật lịch trực), bạn có muốn bật thông báo trên thiết bị này không?",
    "Đồng ý",
    "Lúc khác",
    "info"
  );

  if (isConfirmed) {
    const user = auth.currentUser;
    if (user) {
      await initFCM(user.email);
    }
  }
}

// ====== HÀM TỰ ĐỘNG TÌM ADMIN VÀ GỬI THÔNG BÁO PUSH ======
export async function notifyAdmins(title, body) {
  const user = auth.currentUser;
  if (!user) return;
  console.log(`[FCM] Bắt đầu tiến trình gửi thông báo: "${title}"`);
  try {
    const idToken = await user.getIdToken();

    // 1. Tìm tất cả tài khoản Admin
    const rolesSnap = await getDocs(collection(db, "roles"));
    const adminEmails = rolesSnap.docs.filter(d => d.data().role === "admin").map(d => d.id);
    console.log("[FCM] Danh sách tài khoản Admin:", adminEmails);
    if (adminEmails.length === 0) {
      console.warn("[FCM] Không tìm thấy tài khoản admin nào trong collection 'roles'!");
      return;
    }

    // 2. Lấy FCM Token của các Admin đó
    const usersSnap = await getDocs(collection(db, "users"));
    const adminTokens = usersSnap.docs
      .filter(d => adminEmails.includes(d.id) && d.data().fcmToken)
      .map(d => d.data().fcmToken);

    console.log(`[FCM] Tìm thấy ${adminTokens.length} thiết bị Admin hợp lệ để gửi thông báo.`);
    if (adminTokens.length === 0) {
      console.warn("[FCM] Các tài khoản admin hiện chưa có FCM Token (Chưa cấp quyền nhận thông báo).");
      return;
    }

    const apiUrl = "https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec";

    // 3. Gửi 1 lệnh duy nhất chứa toàn bộ mảng Token qua Apps Script
    const formData = new URLSearchParams();
    formData.append("idToken", idToken);
    formData.append("action", "sendPushNotification");
    formData.append("data", JSON.stringify({ fcmTokens: adminTokens, title: title, body: body, link: window.location.origin }));

    fetch(apiUrl, { method: "POST", body: formData })
      .then(res => res.json())
      .then(data => {
        console.log("[FCM] Phản hồi từ Apps Script (Batch):", data);
        if (data.success) {
          console.log(`✅ Đã yêu cầu GAS gửi push đến ${adminTokens.length} thiết bị!`);
        }
      })
      .catch(e => console.warn("[FCM] Lỗi gọi API Apps Script:", e));

  } catch (err) {
    console.error("[FCM] Lỗi hàm notifyAdmins:", err);
  }
}

export async function clearLocalDB() {
  // Xóa KCN_LocalDB (logs, reports, sync_info)
  await new Promise((resolve) => {
    const req = indexedDB.open('KCN_LocalDB');
    req.onsuccess = (e) => {
      const dbLocal = e.target.result;
      try {
        const tx = dbLocal.transaction(['logs', 'reports_1', 'reports_2', 'shift_reports', 'sync_info'], 'readwrite');
        tx.objectStore('logs').clear();
        tx.objectStore('reports_1').clear();
        tx.objectStore('reports_2').clear();
        tx.objectStore('shift_reports').clear();
        tx.objectStore('sync_info').clear();
        tx.oncomplete = () => {
          localStorage.removeItem('lastBgSync_logs');
          localStorage.removeItem('lastBgSync_reports_1');
          localStorage.removeItem('lastBgSync_reports_2');
          localStorage.removeItem('synced_years_shift_reports');
          resolve();
        };
        tx.onerror = () => { resolve(); };
      } catch (err) {
        console.warn("Lỗi dọn dẹp cache IndexedDB:", err);
        resolve();
      }
    };
    req.onerror = () => { resolve(); };
  });

  // Xóa toàn bộ cache tài liệu tri thức (tailieu_cache_v1) để tránh rò rỉ dữ liệu giữa các user trên máy chung
  await new Promise((resolve) => {
    try {
      const deleteReq = indexedDB.deleteDatabase('tailieu_cache_v1');
      deleteReq.onsuccess = () => resolve();
      deleteReq.onerror = () => resolve();
      deleteReq.onblocked = () => resolve();
    } catch (e) {
      console.warn("Lỗi xóa cache tài liệu:", e);
      resolve();
    }
  });
}

export async function logout(force = false) {
  const userEmail = auth.currentUser?.email || "unknown";
  // ⭐️ BỔ SUNG LOG ⭐️
  addLog("logout", { email: userEmail, status: "success", userAgent: navigator.userAgent });

  try {
    sessionStorage.removeItem('deviceSessionCounted');
  } catch (e) {
    console.warn("Lỗi xóa sessionStorage khi đăng xuất:", e);
  }

  if (!window.isCurrentDeviceTrusted) {
    await clearLocalDB();
  }
  return signOut(auth);
}

// ====== TỰ ĐỘNG ĐĂNG XUẤT NẾU KHÔNG HOẠT ĐỘNG ======
let isAutoLogoutInitialized = false;

export function initAutoLogout(timeoutInDays = 7) {
  if (isAutoLogoutInitialized) return; // Tránh chạy nhiều lần nếu onAuth kích hoạt lại
  isAutoLogoutInitialized = true;

  const getLimitMs = () => {
    const isTrusted = window.isCurrentDeviceTrusted;
    return isTrusted ? (timeoutInDays * 24 * 60 * 60 * 1000) : (1 * 60 * 60 * 1000);
  };

  let isThrottled = false;
  let checkInterval;

  // 1. KIỂM TRA NGAY LẬP TỨC KHI VỪA TẢI TRANG
  const lastActivityStr = localStorage.getItem('lastActivityTime');
  if (lastActivityStr) {
    const lastActivity = parseInt(lastActivityStr, 10);
    const limitMs = getLimitMs();
    if (Date.now() - lastActivity > limitMs) {
      console.log("Đã quá thời gian không hoạt động từ lần truy cập trước. Đang tự động đăng xuất...");
      const currentUser = auth.currentUser;
      const executeLogout = async () => {
        if (currentUser) {
          await addLog("auto_logout_inactivity", {
            email: currentUser.email,
            status: "success",
            reason: `Inactive limit reached (${window.isCurrentDeviceTrusted ? '7 days' : '1 hour'})`,
            details: `Hệ thống tự động đăng xuất do tài khoản quá thời gian không thao tác (${window.isCurrentDeviceTrusted ? '7 ngày' : '1 giờ'}).`,
            userAgent: navigator.userAgent
          });
        }
        localStorage.removeItem('lastActivityTime');
        if (!window.isCurrentDeviceTrusted) {
          await clearLocalDB();
        }
        await signOut(auth);
      };
      executeLogout();
      return; // Dừng khởi tạo nếu đã quá hạn
    }
  }

  // Hàm cập nhật thời gian thao tác cuối cùng vào localStorage
  function updateLastActivity() {
    if (isThrottled) return; // Tối ưu hiệu suất (chỉ cập nhật 5s/lần dù chuột di chuyển liên tục)
    isThrottled = true;
    localStorage.setItem('lastActivityTime', Date.now().toString());
    setTimeout(() => { isThrottled = false; }, 5000);
  }

  // Lắng nghe các thao tác của người dùng
  window.addEventListener('mousemove', updateLastActivity);
  window.addEventListener('keydown', updateLastActivity);
  window.addEventListener('click', updateLastActivity);
  window.addEventListener('scroll', updateLastActivity, { passive: true });

  // 2. Khởi tạo mốc thời gian lần đầu nếu chưa có
  if (!localStorage.getItem('lastActivityTime')) {
    localStorage.setItem('lastActivityTime', Date.now().toString());
  }

  // 3. Hàm kiểm tra định kỳ (mỗi phút 1 lần)
  checkInterval = setInterval(async () => {
    const lastActivity = parseInt(localStorage.getItem('lastActivityTime') || "0", 10);
    const currentUser = auth.currentUser;
    const limitMs = getLimitMs();

    if (currentUser && lastActivity > 0 && (Date.now() - lastActivity > limitMs)) {
      console.log("Đã quá thời gian không hoạt động. Đang tự động đăng xuất...");
      clearInterval(checkInterval); // Dừng kiểm tra
      // Ghi log trước khi ép đăng xuất
      await addLog("auto_logout_inactivity", {
        email: currentUser.email,
        status: "success",
        reason: `Inactive limit reached (${window.isCurrentDeviceTrusted ? '7 days' : '1 hour'})`,
        details: `Hệ thống tự động đăng xuất do tài khoản không có thao tác vượt quá ${window.isCurrentDeviceTrusted ? '7 ngày' : '1 giờ'}.`,
        userAgent: navigator.userAgent
      });
      localStorage.removeItem('lastActivityTime'); // Xóa mốc thời gian
      if (!window.isCurrentDeviceTrusted) {
        await clearLocalDB();
      }
      await signOut(auth); // Ép văng ra khỏi hệ thống
    }
  }, 60000); // 60000 ms = 1 phút
}

// ====== ROLE ======
export async function getRole(email) {
  if (!email) return "user";
  const cacheKey = `role_${email}`;

  // 1. Kiểm tra bộ nhớ đệm (cache) trong sessionStorage trước
  try {
    const cachedRole = sessionStorage.getItem(cacheKey);
    if (cachedRole) return cachedRole;
  } catch (e) {
    console.warn("Lỗi đọc sessionStorage:", e);
  }

  // 2. Nếu chưa có cache, gọi lên server (Firestore)
  try {
    const snap = await getDoc(doc(db, "roles", email));
    const role = snap.exists() ? snap.data().role : "user";
    const finalRole = role || "user";

    // 3. Lưu kết quả vào cache để dùng cho các lần sau (trong phiên làm việc này)
    try {
      sessionStorage.setItem(cacheKey, finalRole);
    } catch (e) {
      console.warn("Lỗi ghi sessionStorage:", e);
    }

    return finalRole;
  } catch (err) {
    console.error("Lỗi getRole:", err);
    return "user";
  }
}

// ================== AUTH - HÀM XÁC THỰC LẠI (RE-AUTHENTICATION) ==================

/**
 * Hiển thị hộp thoại SweetAlert2 để yêu cầu nhập mật khẩu xác thực lại.
 * @returns {Promise<boolean>} Trả về true nếu xác thực thành công.
 */
export async function promptForReAuth() {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  if (!user || !user.email) {
    showSwal("error", "Vui lòng đăng nhập lại trước.");
    return false;
  }

  const { value: password } = await Swal.fire({
    title: "Xác thực Bảo mật",
    html: `
      <div style="text-align: center; margin-bottom: 15px;">
        <div style="font-size: 48px; margin-bottom: 10px;">🛡️</div>
        <p style="font-size: 14px; color: #555; line-height: 1.5;">Vui lòng nhập mật khẩu của tài khoản<br><b style="color: #273668;">${userEmail}</b><br>để tiếp tục thao tác quan trọng này.</p>
      </div>
      <!-- Các trường ẩn để "bẫy" trình duyệt tự động điền -->
      <input type="text" name="username" style="position:absolute; top:-9999px; left:-9999px;">
      <input type="password" name="password" style="position:absolute; top:-9999px; left:-9999px;">
      
      <!-- Ô mật khẩu thật với cơ chế chống Autofill mạnh nhất -->
      <div style="position: relative; max-width: 260px; margin: 10px auto 0 auto;">
          <input type="text" id="reAuthPassword" name="secure_pwd_${Date.now()}" class="swal2-input" placeholder="Mật khẩu..." autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" data-disguised="true" style="width: 100%; box-sizing: border-box; margin: 0; text-align: center; font-size: 16px; letter-spacing: 2px; padding-left: 35px; padding-right: 35px; -webkit-text-security: disc; text-security: disc;">
          <span id="toggleReAuthPassword" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; user-select: none; opacity: 0.6; font-size: 20px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; z-index: 2;">👁️</span>
      </div> 
    `,
    showCancelButton: true,
    confirmButtonText: 'Xác nhận',
    cancelButtonText: 'Hủy',
    confirmButtonColor: '#273668',
    cancelButtonColor: '#95a5a6',
    allowOutsideClick: false,
    allowEscapeKey: true,
    didOpen: () => {
      const input = document.getElementById('reAuthPassword');
      const toggle = document.getElementById('toggleReAuthPassword');

      if (input) {
        input.focus();

        // Chuyển sang type="password" khi người dùng bắt đầu gõ
        const switchToPassword = () => {
          if (input.dataset.disguised === 'true') {
            input.dataset.disguised = 'false';
            input.setAttribute('type', 'password');
            // Bỏ style CSS đi để nút con mắt hoạt động đúng
            input.style.webkitTextSecurity = 'none';
            input.style.textSecurity = 'none';
            input.style.removeProperty('-webkit-text-security');
            input.style.removeProperty('text-security');
            input.removeEventListener('input', switchToPassword);
          }
        };

        input.addEventListener('input', switchToPassword);

        input.addEventListener("keyup", (e) => {
          if (e.key === "Enter") {
            Swal.clickConfirm();
          }
        });
      }

      if (toggle && input) {
        toggle.addEventListener('click', () => {
          if (input.dataset.disguised === 'true') {
            switchToPassword(); // Chạy hàm chuyển đổi
          }
          const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
          input.setAttribute('type', type);
          toggle.textContent = type === 'password' ? '👁️' : '👀';
        });
      }
    },
    preConfirm: () => {
      const input = document.getElementById('reAuthPassword');
      if (!input || !input.value) {
        Swal.showValidationMessage('Vui lòng nhập mật khẩu');
        return false;
      }
      return input.value;
    }
  });

  if (!password) {
    console.log("[ReAuth] Người dùng đã thoát hoặc không nhập mật khẩu.");
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("reAuth_dismissed", { email: userEmail, status: "canceled" });
    return false;
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("reAuth_success", { email: userEmail, status: "success" });
    return true;
  } catch (err) {
    console.error("[ReAuth] Lỗi xác thực:", err);
    showSwal("error", "Mật khẩu không chính xác.");
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("reAuth_failure", { email: userEmail, status: "error", error: err.code });
    return false;
  }
}

//
// Thêm hàm load config (thường được gọi trong onAuth hoặc khi trang load)
export async function loadConfig() {
  try {
    const ref = doc(db, "settings", "reportConfig");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      config = snap.data();
      console.log("Config loaded:", config);
    } else {
      console.log("Config document not found. Using default.");
    }
  } catch (e) {
    console.error("Error loading config:", e);
  }
}


// ====== LOG ======
export async function addLog(action, data = {}) {
  try {
    await addDoc(collection(db, "logs"), {
      action,
      ...data,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Lỗi addLog:", err);
  }
}

// ====== Google Drive API ======
const DRIVE_API_URL = "https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec"; // 🔗 thay link Apps Script

// Sửa đổi: Thêm tham số folderId, formId, và data
async function uploadFileToDrive(file, company, folderId, formId, data) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  if (!user) throw new Error("Chưa đăng nhập");

  const idToken = await user.getIdToken();
  const base64 = await toBase64(file);

  const body = new URLSearchParams();
  body.append("idToken", idToken);
  body.append("action", "upload");
  body.append("file", base64);
  body.append("name", file.name);
  body.append("type", file.type);
  body.append("company", company);
  body.append("folderId", folderId); // Thêm ID thư mục
  body.append("formId", formId);     // Thêm ID form
  body.append("data", JSON.stringify(data)); // Gửi toàn bộ dữ liệu form

  const res = await fetch(DRIVE_API_URL, { method: "POST", body });
  const result = await res.json();
  if (result.error) {
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("drive_upload_failure", { email: userEmail, file: file.name, error: result.error });
    throw new Error(result.error);
  }

  // ⭐️ BỔ SUNG LOG ⭐️
  addLog("drive_upload_success", { email: userEmail, file: file.name, fileId: result.id, url: result.link });
  return { url: result.link, id: result.id };
}

async function deleteFileFromDrive(fileId) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  if (!user) {
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("drive_delete_unauthorized", { fileId, status: "error" });
    throw new Error("Chưa đăng nhập");
  }

  const idToken = await user.getIdToken();

  const body = new URLSearchParams();
  body.append("idToken", idToken);
  body.append("action", "delete");
  body.append("fileId", fileId);

  const res = await fetch(DRIVE_API_URL, { method: "POST", body });
  const data = await res.json();
  if (data.error) {
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("drive_delete_failure", { email: userEmail, fileId, error: data.error });
    throw new Error(data.error);
  }

  // ⭐️ BỔ SUNG LOG ⭐️
  addLog("drive_delete_success", { email: userEmail, fileId, status: "success" });
  return data;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (error) => reject(error);
  });
}

// ================== HÀM NÉN ẢNH (CANVAS API) ==================
/**
 * Nén hình ảnh trực tiếp trên trình duyệt
 * @param {File} file - File ảnh gốc
 * @param {number} thresholdMB - Ngưỡng dung lượng (MB) để bắt đầu nén (VD: 4)
 * @param {number} quality - Chất lượng nén từ 0.0 đến 1.0 (VD: 0.9)
 * @returns {Promise<File>} Trả về file đã nén hoặc file gốc
 */
export async function compressImage(file, thresholdMB = 4, quality = 0.9) {
  const thresholdBytes = thresholdMB * 1024 * 1024;

  // Nếu không phải ảnh hoặc dung lượng <= 4MB thì giữ nguyên file gốc
  if (!file.type.startsWith('image/') || file.size <= thresholdBytes) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Tối ưu kích thước: Thu nhỏ kích thước ảnh nếu quá lớn (Max cạnh 2560px - Mức 2K để giữ độ nét cao)
      const MAX_DIM = 2560;
      let { width, height } = img;
      if (width > height && width > MAX_DIM) {
        height = Math.round(height * (MAX_DIM / width));
        width = MAX_DIM;
      } else if (height > MAX_DIM) {
        width = Math.round(width * (MAX_DIM / height));
        height = MAX_DIM;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Chuyển Canvas thành File JPEG để ép dung lượng xuống mức thấp
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error("Lỗi khi chuyển đổi Canvas sang Blob"));
        const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
          type: "image/jpeg",
          lastModified: Date.now()
        });
        resolve(compressedFile);
      }, 'image/jpeg', quality);
    };
    img.onerror = (err) => reject(new Error("Lỗi khi load ảnh để nén: " + err));
  });
}

// ====== REPORTS ======

// ⭐️ BỔ SUNG: HÀM LƯU FIRESTORE ĐƠN LẺ ⭐️
/**
 * Thêm một bản ghi duy nhất vào Firestore.
 */
async function addReportDoc(data = {}, collectionName) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  if (!user) {
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("addDoc_unauthorized", { collection: collectionName });
    throw new Error("Chưa đăng nhập");
  }

  const record = {
    ...data,
    createdBy: userEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp() // MỚI: Thêm updatedAt để đồng bộ IndexedDB khi có dữ liệu mới
  };

  try {
    const docRef = await addDoc(collection(db, collectionName), record);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("addDoc_success", { collection: collectionName, docId: docRef.id, email: userEmail, ...data });
    return docRef;
  } catch (err) {
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("addDoc_failure", { collection: collectionName, email: userEmail, error: err.message, data: data });
    throw err; // Ném lỗi để luồng chính có thể bắt được
  }
}

// ================== HÀM XỬ LÝ FORM CHUNG ==================
// Sửa đổi: Thêm tham số folderId
export async function submitForm(e, formId, collectionName, folderId) {
  e.preventDefault();
  const form = document.getElementById(formId);
  showLoading("Đang kiểm tra dữ liệu..."); // Di chuyển showLoading lên đầu
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  try {
    // --- KIỂM TRA KÍCH THƯỚC FILE ---
    // SỬA: Lấy file input bằng querySelector để đảm bảo tìm thấy dù không có name
    const fileInputElement = form.querySelector('input[type="file"]');
    let fileInput = fileInputElement?.files?.[0];

    const HARD_LIMIT_BYTES = 15728640; // 15MB: Cho phép user chọn file từ đt thoải mái
    const FINAL_LIMIT_BYTES = 5242880; // 5MB: Giới hạn an toàn trước khi gửi payload lên Google Apps Script

    if (fileInput) {
      // Chặn tức thì nếu file khổng lồ (> 15MB) để tránh treo trình duyệt khi vẽ Canvas
      if (fileInput.size > HARD_LIMIT_BYTES) {
        hideLoading();
        showSwal("error", "Kích thước file quá lớn (Vượt quá 15MB). Vui lòng chọn file khác.");
        addLog("file_size_error", { email: userEmail, formId, fileName: fileInput.name, sizeBytes: fileInput.size });
        return; // Ngăn chặn việc gửi form
      }

      // Tiến hành nén ngầm nếu dung lượng > 4MB
      try {
        fileInput = await compressImage(fileInput, 4, 0.9);
      } catch (err) {
        console.warn("Nén ảnh thất bại, sử dụng file gốc:", err);
      }

      // Kiểm tra lại lần cuối sau khi nén
      if (fileInput.size > FINAL_LIMIT_BYTES) {
        hideLoading();
        showSwal("error", "Kích thước file sau khi tự động nén vẫn vượt quá 5MB. Vui lòng chọn file nhỏ hơn.");
        addLog("file_size_error", { email: userEmail, formId, fileName: fileInput.name, sizeBytes: fileInput.size });
        return;
      }
    }
    // ------------------------------------------
    let data = {};
    let file = null;

    // 1. Tùy theo formId mà build object data và lấy file
    switch (formId) {
      case "registrationForm_1":
        let chiSoStr = form.chi_so.value.trim();

        // Bỏ dấu chấm phân cách nghìn
        chiSoStr = chiSoStr.replace(/\./g, "");

        // Chuyển thành số
        let chiSoNum = parseFloat(chiSoStr);

        data = {
          company: form.c_ty.value.trim(),
          chi_so: chiSoNum,   // ✅ luôn là Number
          ngay_ghi: form.ngay_ghi.value.trim(),
          ghi_chu: form.ghi_chu.value.trim(),
        };
        file = fileInput;
        break;

      case "registrationForm_2":  // Form kiểu khác
        data = {
          company: form.c_ty.value.trim(),
          ngay_nghi: form.ngay_nghi.value.trim(),
          ngay_lam_db: form.ngay_lam_db.value.trim(),
          ghi_chu: form.ghi_chu.value.trim(),
        };
        file = fileInput;

        // ✅ KIỂM TRA DỮ LIỆU BẮT BUỘC CHO FORM 2
        if (!data.ngay_nghi && !data.ngay_lam_db) {
          hideLoading();
          showSwal("error", "Vui lòng nhập Ngày nghỉ HOẶC Ngày làm đặc biệt.");
          // ⭐️ BỔ SUNG LOG ⭐️
          addLog("form2_validation_error", { email: userEmail, error: "Missing both ngay_nghi and ngay_lam_db" });
          return;
        }
        if (data.ngay_nghi && data.ngay_lam_db) {
          hideLoading();
          showSwal("error", "Vui lòng chỉ chọn Ngày nghỉ HOẶC Ngày làm đặc biệt.");
          // ⭐️ BỔ SUNG LOG ⭐️
          addLog("form2_validation_error", { email: userEmail, error: "Both ngay_nghi and ngay_lam_db submitted" });
          return;
        }
        break;
      // sau này thêm form khác thì thêm case mới
      default:
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("form_unknown_id", { email: userEmail, formId });
        break;
    }

    // --- LOGIC MỚI: KIỂM TRA FILE ĐÍNH KÈM VÀ YÊU CẦU XÁC NHẬN ---
    // Đã kiểm tra kích thước file, bây giờ kiểm tra việc đính kèm.
    hideLoading(); // Ẩn loading kiểm tra dữ liệu trước khi hiện confirm
    // BƯỚC 1: Lấy đúng input file cho form hiện tại
    const currentForm = document.getElementById(formId);
    // Tìm input file có id="file" HOẶC id="file_2" bên trong form
    const filesInput = currentForm.querySelector('#file, #file_2');

    // BƯỚC 2: Kiểm tra thiếu file (ĐÃ BỎ ĐIỀU KIỆN LOẠI TRỪ TRƯỚC ĐÓ)
    if (filesInput && filesInput.files.length === 0) {
      const isConfirmed = await showConfirmSwal(
        "Thiếu File Đính Kèm",
        "Bạn chưa đính kèm thông báo. Bạn có chắc chắn muốn gửi báo cáo này không?",
        "Có, tôi chắc chắn gửi",
        "Không, tôi sẽ đính kèm"
      );

      if (isConfirmed) {
        // Tiếp tục gửi báo cáo
        showLoading("Đang xử lý báo cáo..."); // Hiện loading lại khi bắt đầu xử lý
        await handleSubmit(form, data, file, collectionName, folderId, formId);
      } else {
        showSwal("info", "Đã hủy gửi báo cáo.", "Vui lòng kiểm tra lại thông báo.");
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("form_submit_canceled", { email: userEmail, formId, reason: "No file confirmation" });
      }
    } else {
      // Nếu CÓ file đính kèm, tiến hành gửi ngay lập tức
      showLoading("Đang xử lý báo cáo..."); // Hiện loading lại khi bắt đầu xử lý
      await handleSubmit(form, data, file, collectionName, folderId, formId);
    }
  } catch (err) {
    console.error(`❌ Lỗi hệ thống khi gửi form ${formId}:`, err);
    showSwal("error", "Lỗi gửi báo cáo", err.message || "Lỗi hệ thống");
    hideLoading();
  }
}
window.submitForm = submitForm;

// ================== HÀM LƯU FIRESTORE/DRIVE (Bỏ qua vì đã dùng addReportDoc) ==================
export async function addReport(data = {}, file = null, collectionName, folderId, formId) {
  // Hàm này bị bỏ qua trong logic mới của handleSubmit
  // Giữ lại vì có thể có code khác dùng đến nó.
  const user = auth.currentUser;
  if (!user) throw new Error("Bạn phải đăng nhập để gửi báo cáo");

  let fileUrl = "";
  let fileId = "";

  if (file) {
    const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
    fileUrl = uploaded.url;
    fileId = uploaded.id;
  }

  const record = {
    ...data,
    createdBy: user.email,
    createdAt: serverTimestamp(),
    fileUrl,
    fileId,
  };

  await addLog("addReport", { ...data, email: user.email, fileUrl, fileId });
  await addDoc(collection(db, collectionName), record);
}

// ================== HÀM XỬ LÝ LƯU TRỮ VÀ GHI ĐÈ CHUNG (ĐÃ SỬA LỖI TRY/CATCH VÀ UNDEFINED) ==================
export async function handleSubmit(form, data, file = null, collectionName, folderId, formId) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  try {
    if (!user) throw new Error("Bạn phải đăng nhập để gửi báo cáo");

    let fileUrl = "";
    let fileId = "";

    // --- BƯỚC 1: Xử lý Form 2 (Ngày nghỉ/Ngày làm đặc biệt) ---
    // --- BƯỚC 1: Xử lý Form 2 (Ngày nghỉ/Ngày làm đặc biệt) ---
    if (formId === "registrationForm_2" && (data.ngay_nghi || data.ngay_lam_db)) {

      const dateStr = data.ngay_nghi || data.ngay_lam_db;
      const isSpecialWorkdaySubmission = !!data.ngay_lam_db;
      const submissionType = isSpecialWorkdaySubmission ? "Ngày làm Đặc biệt" : "Ngày nghỉ";

      // Tách chuỗi ngày thành mảng các ngày (YYYY-MM-DD)
      // ⭐️ QUAN TRỌNG: Sắp xếp ngày tăng dần để minDate/maxDate luôn đúng cho query
      const dates = dateStr.split(',').map(d => d.trim()).filter(d => d.length > 0).sort();

      const baseData = { ...data };
      delete baseData.ngay_nghi;
      delete baseData.ngay_lam_db;

      // 1) Tải File Lên Drive (Chỉ 1 lần) - nếu có file
      if (file) {
        const uploaded = await uploadFileToDrive(file, baseData.company || "NoCompany", folderId, formId, data);
        fileUrl = uploaded.url;
        fileId = uploaded.id;
      }

      // 2) Thêm/Ghi đè từng ngày (TUẦN TỰ)
      let addedCount = 0;
      let skipped = 0;
      let errorList = []; // Khởi tạo danh sách lỗi

      if (dates.length === 0) {
        hideLoading();
        showSwal("error", "Lỗi dữ liệu", "Không tìm thấy ngày hợp lệ nào.");
        return;
      }

      // ⭐️ TỐI ƯU HÓA: ĐỌC TẤT CẢ DỮ LIỆU 1 LẦN (Thay vì N lần)
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      const [allHolidaysSnap, allSpecialSnap] = await Promise.all([
        getDocs(query(
          collection(db, collectionName),
          where("company", "==", baseData.company),
          where("ngay_nghi", ">=", minDate),
          where("ngay_nghi", "<=", maxDate)
        )),
        getDocs(query(
          collection(db, collectionName),
          where("company", "==", baseData.company),
          where("ngay_lam_db", ">=", minDate),
          where("ngay_lam_db", "<=", maxDate)
        ))
      ]);

      // Tạo Map để tra cứu nhanh O(1)
      const holidayMap = new Map(
        allHolidaysSnap.docs.map(doc => [doc.data().ngay_nghi, doc])
      );
      const specialMap = new Map(
        allSpecialSnap.docs.map(doc => [doc.data().ngay_lam_db, doc])
      );

      for (const singleDate of dates) {
        // 2a) TÌM BẢN GHI TRÙNG - ⭐️ TRA CỨU TRONG MAP (Không đọc Firebase)
        const existingHoliday = holidayMap.get(singleDate);
        const existingSpecial = specialMap.get(singleDate);

        let existingDoc = existingHoliday || existingSpecial || null;
        let existingData = existingDoc?.data() || null;

        // 2b) CHUẨN BỊ DỮ LIỆU MỚI
        const newRecordData = {
          ...baseData,
          isSpecialWorkday: isSpecialWorkdaySubmission,
          ghi_chu: baseData.ghi_chu || (isSpecialWorkdaySubmission ? "Ngày làm đặc biệt" : "N/A"),
          fileUrl,
          fileId,
        };

        if (isSpecialWorkdaySubmission) {
          newRecordData.ngay_lam_db = singleDate;
          // Đảm bảo không có trường 'ngay_nghi' khi là NLĐB
          delete newRecordData.ngay_nghi;
        } else {
          newRecordData.ngay_nghi = singleDate;
          // Đảm bảo không có trường 'ngay_lam_db' khi là Ngày nghỉ
          delete newRecordData.ngay_lam_db;
        }

        // 2c) XỬ LÝ XUNG ĐỘT HOẶC THÊM MỚI

        // --- LOGIC ĐẶC BIỆT CHO NGÀY LÀM VIỆC ĐẶC BIỆT (Kiểm tra các trường hợp cần BỎ QUA hoặc GHI ĐÈ ĐẶC BIỆT) ---
        if (isSpecialWorkdaySubmission) {
          const isDefaultHoliday = isDateADefaultHoliday(singleDate, baseData.company, config);

          if (!isDefaultHoliday) {
            // 1. Trường hợp T2-T6 (Không phải Ngày nghỉ Mặc định)

            if (!existingDoc) {
              // 1.1. T2-T6 KHÔNG TRÙNG & KHÔNG PHẢI NGÀY NGHỈ MẶC ĐỊNH: Bản ghi vô nghĩa
              hideLoading();

              // ⭐️ SỬA LỖI: Dùng await Swal.fire() để chặn luồng và chờ người dùng nhấn OK ⭐️
              // (Giả định bạn sử dụng SweetAlert2, thư viện được đề cập trong file HTML)
              await Swal.fire({
                icon: "info",
                title: "Bản ghi dư!",
                html: `Ngày (${singleDate}) là ngày làm việc bình thường nên KHÔNG cần bản ghi này.`,
                confirmButtonText: "Đã hiểu",
                allowOutsideClick: false,
                allowEscapeKey: false,
              });

              addLog("form2_special_workday_meaningless", { email: userEmail, company: baseData.company, date: singleDate, ngay_ghi: singleDate, ghi_chu: baseData.ghi_chu });
              skipped++;
              continue; // 🛑 BỎ QUA NGÀY VÀ CHUYỂN SANG NGÀY TIẾP THEO

            } else if (!existingData.isSpecialWorkday) {
              // 1.2. T2-T6 TRÙNG VỚI TB NGHỈ THỦ CÔNG: Yêu cầu ghi đè (Thay thế TB nghỉ)
              hideLoading();
              let isConfirmed = await showConfirmSwal(
                "Xác nhận Ghi Đè Bản Ghi", // Tiêu đề (Bạn nên đặt)
                `[THÔNG BÁO NGHỈ THỦ CÔNG] Ngày ${singleDate} của ${baseData.company} hiện đang là **Thông báo nghỉ** thủ công. Bạn có muốn GHI ĐÈ bằng **Thông báo hủy bỏ** không?`, // Nội dung động
                "Có, Ghi đè", // Text nút Yes
                "Không, Bỏ qua" // Text nút No
              );

              if (isConfirmed) {
                showLoading("Đang ghi đè dữ liệu...");
                try {
                  // Ghi chú mới: Thay thế TB nghỉ
                  newRecordData.ghi_chu = "Thay thế TB nghỉ.";

                  // Xóa và dọn dẹp file cũ 
                  const fileIdToDelete = existingData.fileId;
                  if (fileIdToDelete) {
                    const qRemaining = query(collection(db, collectionName), where("fileId", "==", fileIdToDelete), where("__name__", "!=", existingDoc.id));
                    const snapRemaining = await getDocs(qRemaining);
                    if (snapRemaining.empty) {
                      await deleteFileFromDrive(fileIdToDelete).catch(e => console.warn(`[CleanUp Error] Lỗi xóa File ID: ${fileIdToDelete} khỏi Drive:`, e));
                      addLog("drive_cleanup_success", { email: userEmail, fileId: fileIdToDelete, reason: "overwrite_manual_no_ref" });
                    } else {
                      console.log(`[CleanUp] File ID: ${fileIdToDelete} vẫn còn ${snapRemaining.size} bản ghi tham chiếu.`);
                    }
                  }

                  // Thực thi ghi đè
                  await deleteDoc(doc(db, collectionName, existingDoc.id));
                  await addReportDoc(newRecordData, collectionName);

                  addLog("overwrite_manual_holiday_success", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, oldId: existingDoc.id, newType: submissionType, ghi_chu: newRecordData.ghi_chu });
                  addedCount++;
                } catch (e) {
                  showSwal("error", `Lỗi ghi đè ngày ${singleDate}: ${e.message}`);
                  errorList.push(`Ngày ${singleDate} (Ghi đè T2-T6) - ${e.message}`);
                  addLog("overwrite_manual_holiday_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, error: e.message, ghi_chu: newRecordData.ghi_chu });
                }
              } else {
                skipped++;
                addLog("overwrite_manual_holiday_skipped", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, type: submissionType, ghi_chu: newRecordData.ghi_chu });
              }
              continue; // 🛑 CHUYỂN SANG NGÀY TIẾP THEO

            }
            // 1.3. T2-T6 TRÙNG VỚI NLĐB cũ: FALL THROUGH để xử lý ghi đè chung

          } else {
            // 2. Trường hợp T7/CN (Ngày nghỉ Mặc định)
            if (!existingDoc) {
              // 2.1. T7/CN KHÔNG TRÙNG & KHÔNG CÓ BẢN GHI: Thêm mới (Ghi chú: Ngày làm đặc biệt)
              newRecordData.ghi_chu = baseData.ghi_chu || "Ngày làm đặc biệt";
              try {
                await addReportDoc(newRecordData, collectionName);
                addedCount++;
              } catch (e) {
                console.error(`Lỗi thêm mới ngày ${singleDate}:`, e);
                errorList.push(`Ngày ${singleDate} (Thêm mới T7/CN) - ${e.message}`);
                addLog("add_holiday_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, error: e.message, ghi_chu: newRecordData.ghi_chu });
              }
              continue; // 🛑 CHUYỂN SANG NGÀY TIẾP THEO
            }
            // 2.2. T7/CN TRÙNG VỚI TB NGHỈ/NLĐB: FALL THROUGH để xử lý ghi đè chung
          }
        }
        // --- HẾT LOGIC ĐẶC BIỆT CHO NGÀY LÀM VIỆC ĐẶC BIỆT ---


        // --- LOGIC GHI ĐÈ CHUNG HOẶC THÊM MỚI NGÀY NGHỈ THƯỜNG ---

        if (existingDoc) {
          // PHÁT HIỆN TRÙNG -> Yêu cầu xác nhận ghi đè (Dùng cho các trường hợp NLĐB fall-through và Ngày nghỉ thường)

          // ⭐️ CẬP NHẬT GHI CHÚ THÔNG MINH CHO GHI ĐÈ NLĐB ⭐️
          if (isSpecialWorkdaySubmission) {
            // Nếu là NLĐB (và đã fall-through)
            const existingType = existingData.isSpecialWorkday ? "Ngày làm ĐB cũ" : (isDateADefaultHoliday(singleDate, baseData.company, config) ? "Ngày nghỉ Mặc định" : "Ngày nghỉ Thủ công");
            const originalGhiChu = existingData.ghi_chu || 'Không có ghi chú cũ';
            const userGhiChu = baseData.ghi_chu || "Ngày làm đặc biệt";

            newRecordData.ghi_chu = `${userGhiChu}. Ghi đè lên: ${existingType}. (Ghi chú cũ: ${originalGhiChu})`;
            // Thuộc tính ngay_nghi đã được xóa ở 2b
          }

          hideLoading();
          let confirmationMessage;
          // Sử dụng hàm kiểm tra ngày nghỉ mặc định cho việc hiển thị loại cũ chính xác
          const existingTypeDisplay = existingData.isSpecialWorkday
            ? "Ngày làm Đặc biệt"
            : (isDateADefaultHoliday(singleDate, baseData.company, config)
              ? "Ngày nghỉ Mặc định"
              : "Ngày nghỉ Thủ công");

          const submissionTypeDisplay = isSpecialWorkdaySubmission ? "Ngày làm Đặc biệt" : "Ngày nghỉ";

          confirmationMessage = `Ngày ${singleDate} của ${baseData.company} đã tồn tại (loại: ${existingTypeDisplay}). Bạn có muốn GHI ĐÈ bằng **${submissionTypeDisplay}** không?`;


          let isConfirmed = await showConfirmSwal(
            "Xác nhận Ghi Đè Bản Ghi",
            confirmationMessage, // Sử dụng biến message động của bạn
            "Có, Ghi đè",
            "Không, Bỏ qua"
          );

          if (isConfirmed) {
            showLoading("Đang ghi đè dữ liệu...");
            // Ghi đè
            try {
              const fileIdToDelete = existingData.fileId;

              // ⭐️ BƯỚC 1: KIỂM TRA VÀ DỌN DẸP FILE ĐÍNH KÈM CŨ ⭐️
              if (fileIdToDelete) {

                const qRemaining = query(
                  collection(db, collectionName),
                  where("fileId", "==", fileIdToDelete),
                  where("__name__", "!=", existingDoc.id)
                );
                const snapRemaining = await getDocs(qRemaining);

                if (snapRemaining.empty) {
                  try {
                    await deleteFileFromDrive(fileIdToDelete);
                    addLog("drive_cleanup_success", { email: userEmail, fileId: fileIdToDelete, reason: "overwrite_no_ref" });
                  } catch (e) {
                    console.warn(`[CleanUp Error] Lỗi xóa File ID: ${fileIdToDelete} khỏi Drive:`, e);
                    addLog("drive_cleanup_fail", { email: userEmail, fileId: fileIdToDelete, error: e.message, reason: "overwrite" });
                  }
                } else {
                  console.log(`[CleanUp] File ID: ${fileIdToDelete} vẫn còn ${snapRemaining.size} bản ghi tham chiếu.`);
                }
              }

              // ⭐️ BƯỚC 2: THỰC THI GIAO DỊCH GHI ĐÈ BẢN GHI TRÊN FIRESTORE ⭐️
              await deleteDoc(doc(db, collectionName, existingDoc.id));
              await addReportDoc(newRecordData, collectionName);

              addLog("overwrite_success", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, oldId: existingDoc.id, newType: submissionTypeDisplay, ghi_chu: newRecordData.ghi_chu });

              addedCount++;
            } catch (e) {
              showSwal("error", `Lỗi ghi đè ngày ${singleDate}: ${e.message}`);
              errorList.push(`Ngày ${singleDate} (Ghi đè) - ${e.message}`);
              addLog("overwrite_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, error: e.message, ghi_chu: newRecordData.ghi_chu });
            }
          } else {
            // Bỏ qua bản ghi này
            skipped++;
            addLog("overwrite_skipped", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, type: submissionTypeDisplay, ghi_chu: newRecordData.ghi_chu });
          }
        }

        // --- LOGIC THÊM MỚI NGÀY NGHỈ THƯỜNG ---
        else if (!isSpecialWorkdaySubmission) {
          // KHÔNG TRÙNG VÀ LÀ NGÀY NGHỈ THƯỜNG -> Thêm mới
          try {
            await addReportDoc(newRecordData, collectionName);
            addedCount++;
          } catch (e) {
            console.error(`Lỗi thêm mới ngày ${singleDate}:`, e);
            errorList.push(`Ngày ${singleDate} (Thêm mới) - ${e.message}`);
            addLog("add_holiday_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, ngay_ghi: singleDate, error: e.message, ghi_chu: newRecordData.ghi_chu });
          }
        }
        // --- HẾT LOGIC THÊM MỚI NGÀY NGHỈ THƯỜNG ---
      } // KẾT THÚC VÒNG LẶP


      // Thông báo kết quả TỔNG HỢP VÀ CHÍNH XÁC
      hideLoading();
      if (errorList.length > 0) {
        let errorMsg = `THẤT BẠI một phần: Đã gửi thành công ${addedCount} bản ghi, bỏ qua ${skipped} ngày (do trùng lặp hoặc vô nghĩa).`;
        errorMsg += "\n\n**Các lỗi xảy ra:**\n";
        errorList.forEach(err => errorMsg += `- ${err}\n`);

        showSwal("warning", "Gửi báo cáo hoàn tất (Có lỗi)", errorMsg);
        addLog("form2_submit_partial_error", { email: userEmail, company: baseData.company, added: addedCount, skipped: skipped, errors: errorList.length });

      } else if (addedCount > 0) {
        const successMsg = `HOÀN TẤT: Đã thêm/ghi đè thành công ${addedCount} ngày, bỏ qua ${skipped} ngày.`;
        showSwal("success", "Gửi báo cáo thành công!", successMsg);
        addLog("form2_submit_success", { email: userEmail, company: baseData.company, added: addedCount, skipped: skipped });

        // 🚀 Thông báo nộp Form 2 (Ngày nghỉ/Làm việc đặc biệt)
        notifyAdmins(
          "📅 Thông báo nghỉ/làm đặc biệt",
          `Thông báo ${submissionType.toLowerCase()} Công ty ${baseData.company} - User: ${userEmail}`
        );

      } else if (skipped > 0) {
        showSwal("info", "Gửi báo cáo hoàn tất (Bị bỏ qua)", `Không có ngày nào được thêm mới. Đã bỏ qua ${skipped} ngày (do trùng lặp hoặc vô nghĩa).`);
        addLog("form2_submit_skipped_only", { email: userEmail, company: baseData.company, skipped: skipped });
      } else {
        showSwal("error", "Lỗi dữ liệu", "Không có ngày hợp lệ nào được tìm thấy để xử lý.");
        addLog("form2_submit_no_dates", { email: userEmail, company: baseData.company });
      }



      // reset form và thoát
      form.reset();

      form.ngay_nghi.value = "";
      form.ngay_lam_db.value = "";
      return;
    }


    // --- BƯỚC 2: Xử lý Single-Date hoặc form khác (Chỉ áp dụng cho registrationForm_1) ---

    if (formId === "registrationForm_1") {

      showLoading("Đang kiểm tra dữ liệu và trùng lặp...");

      // Lấy dữ liệu cần kiểm tra
      const { company, ngay_ghi, chi_so } = data;
      const newChiSo = parseFloat(chi_so);

      // --- ⭐️ TỐI ƯU HƠN NỮA: CHẠY SONG SONG CÁC TRUY VẤN FIRESTORE ---
      const qSameDay = query(
        collection(db, collectionName),
        where("company", "==", company),
        where("ngay_ghi", "==", ngay_ghi)
      );

      let qLatest = null;
      if (!isNaN(newChiSo)) {
        qLatest = query(
          collection(db, collectionName),
          where("company", "==", company),
          where("ngay_ghi", "<=", ngay_ghi),
          orderBy("ngay_ghi", "desc"),
          orderBy("createdAt", "desc"),
          limit(1)
        );
      }

      const [snapSameDay, snapLatest] = await Promise.all([
        getDocs(qSameDay),
        qLatest ? getDocs(qLatest) : Promise.resolve({ empty: true, docs: [] })
      ]);

      // ⭐️ TÌM EXACT MATCH TRONG MEMORY (Không query thêm)
      const exactMatchDoc = snapSameDay.docs.find(
        doc => parseFloat(doc.data().chi_so) === newChiSo
      );

      if (!snapSameDay.empty) {
        let existingDoc = snapSameDay.docs[0];
        if (snapSameDay.size > 1) {
          existingDoc = snapSameDay.docs.reduce((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || 0;
            const bTime = b.data().createdAt?.toMillis?.() || 0;
            return bTime > aTime ? b : a;
          });
        }
        const existingData = existingDoc.data();
        const existingChi = parseFloat(existingData.chi_so);

        if (!isNaN(existingChi) && !isNaN(newChiSo) && newChiSo < existingChi) {
          const alreadyReset = snapSameDay.docs.some(d => d.data().isMeterReset === true);
          hideLoading();

          const swalResult = await Swal.fire({
            icon: 'warning',
            title: 'Chỉ số mới nhỏ hơn bản ghi cùng ngày',
            html: `
        <p>Chỉ số cũ: <b>${existingChi.toLocaleString('vi-VN')}</b>&emsp;&emsp;Chỉ số mới: <b>${newChiSo.toLocaleString('vi-VN')}</b></p>
        <label style="display:flex;align-items:center;margin-top:10px;">
          <input id="swal-checkbox-reset" type="checkbox" style="margin-right:8px;">
          Tôi xác nhận đây là trường hợp Reset (thay đồng hồ)
        </label>
        <input id="swal-input-reason" class="swal2-input" placeholder="Lý do (bắt buộc)">
      `,
            showCancelButton: true,
            showDenyButton: !alreadyReset,
            confirmButtonText: alreadyReset
              ? 'Cập nhật bản reset hiện có'
              : 'Ghi đè bản ghi cùng ngày',
            denyButtonText: 'Thêm bản ghi mới',
            cancelButtonText: 'Hủy',
            preConfirm: () => {
              const cb = document.getElementById('swal-checkbox-reset').checked;
              const reason = document.getElementById('swal-input-reason').value.trim();
              if (!cb) { Swal.showValidationMessage('Bạn phải tích xác nhận.'); return false; }
              if (!reason) { Swal.showValidationMessage('Bạn phải nhập lý do.'); return false; }
              return { reason, action: 'overwrite' };
            },
            preDeny: () => {
              const cb = document.getElementById('swal-checkbox-reset').checked;
              const reason = document.getElementById('swal-input-reason').value.trim();
              if (!cb) { Swal.showValidationMessage('Bạn phải tích xác nhận.'); return false; }
              if (!reason) { Swal.showValidationMessage('Bạn phải nhập lý do.'); return false; }
              return { reason, action: 'append' };
            }
          });

          if (swalResult.isDismissed) {
            hideLoading();
            showSwal("info", "Đã hủy gửi báo cáo.");
            // ⭐️ BỔ SUNG LOG ⭐️
            addLog("meter_reset_canceled_sameday", { email: userEmail, company, ngay_ghi, newChiSo, reason: "dismissed", ghi_chu: data.ghi_chu });
            return;
          }

          const reason = swalResult.value?.reason || "";

          // --- Người dùng chọn GHI ĐÈ ---
          if (swalResult.isConfirmed) {
            showLoading("Đang ghi đè bản ghi reset...");
            try {
              let fileUrl = existingData.fileUrl || "";
              let fileId = existingData.fileId || "";

              if (file) {
                const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
                // xóa file cũ nếu không còn tham chiếu
                if (existingData.fileId && existingData.fileId !== uploaded.id) {
                  const qRemaining = query(
                    collection(db, collectionName),
                    where("fileId", "==", existingData.fileId),
                    where("__name__", "!=", existingDoc.id)
                  );
                  const snapRemaining = await getDocs(qRemaining);
                  if (snapRemaining.empty) {
                    await deleteFileFromDrive(existingData.fileId).catch(err => {
                      console.warn("Không thể xóa file cũ:", err);
                      // ⭐️ BỔ SUNG LOG ⭐️
                      addLog("drive_cleanup_fail", { email: userEmail, fileId: existingData.fileId, error: err.message, reason: "sameday_overwrite" });
                    });
                  }
                }
                fileUrl = uploaded.url;
                fileId = uploaded.id;
              }

              const updatedRecord = {
                ...existingData,
                ...data,
                chi_so: newChiSo,
                fileUrl,
                fileId,
                isMeterReset: true,
                ghi_chu: (existingData.ghi_chu ? existingData.ghi_chu + " | " : "") + `[CS GIẢM ĐẶC BIỆT CÙNG NGÀY: ${reason}]`,
                updatedAt: serverTimestamp(),
                adminEdited: false
              };

              await setDoc(doc(db, collectionName, existingDoc.id), updatedRecord, { merge: true });
              addLog("updateReport", { email: userEmail, id: existingDoc.id, collection: collectionName, reason: reason, company: company, ngay_ghi: ngay_ghi, chi_so: newChiSo, ghi_chu: updatedRecord.ghi_chu });

              // 🚀 Gửi Push Notification Cảnh báo
              notifyAdmins(
                "🚨 CẢNH BÁO: CHỈ SỐ GIẢM",
                `Công ty ${company} báo cáo giảm (Ghi đè). Lý do: ${reason} - User: ${userEmail}`
              );
              hideLoading();
              showSwal("success", "Đã ghi đè bản ghi reset.");
              form.reset();
              if (form.ngay_ghi) form.ngay_ghi.value = new Date().toLocaleDateString('en-CA');
              return;
            } catch (e) {
              console.error("Lỗi khi ghi đè cùng ngày:", e);
              hideLoading();
              showSwal("error", "Lỗi ghi đè: " + e.message);
              // ⭐️ BỔ SUNG LOG ⭐️
              addLog("overwrite_sameday_error", { email: userEmail, collection: collectionName, company, ngay_ghi, error: e.message, ghi_chu: data.ghi_chu });
              return;
            }
          }

          // --- Người dùng chọn THÊM MỚI ---
          if (swalResult.isDenied) {
            showLoading("Đang thêm bản ghi reset mới...");
            try {
              if (file) {
                const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
                data.fileUrl = uploaded.url;
                data.fileId = uploaded.id;
              } else {
                data.fileUrl = "";
                data.fileId = "";
              }

              data.isMeterReset = true;
              data.ghi_chu = (data.ghi_chu ? data.ghi_chu + " | " : "") + `[CS GIẢM ĐẶC BIỆT CÙNG NGÀY (THÊM MỚI): ${reason}]`;

              // Sẽ gọi addDoc_success trong addReportDoc
              await addReportDoc(data, collectionName);
              // Log cũ đã có: addLog("addReport (special)", { collection: collectionName, reason, newChiSo });

              // 🚀 Gửi Push Notification Cảnh báo
              notifyAdmins(
                "🚨 CẢNH BÁO: CHỈ SỐ GIẢM",
                `Công ty ${company} báo cáo giảm (Thêm mới). Lý do: ${reason} - User: ${userEmail}`
              );
              hideLoading();
              showSwal("success", "Đã thêm bản ghi reset mới.");
              form.reset();
              if (form.ngay_ghi) form.ngay_ghi.value = new Date().toLocaleDateString('en-CA');
              return;
            } catch (e) {
              console.error("Lỗi khi thêm mới cùng ngày:", e);
              hideLoading();
              showSwal("error", "Lỗi thêm báo cáo: " + e.message);
              // ⭐️ BỔ SUNG LOG ⭐️
              addLog("add_sameday_error", { email: userEmail, collection: collectionName, company, ngay_ghi, error: e.message, ghi_chu: data.ghi_chu });
              return;
            }
          }
        } // end if new<existing
      } // end if same-day exists


      // ===============================================
      // 1. ⭐️ KIỂM TRA TRÙNG LẶP (SỬ DỤNG KẾT QUẢ ĐÃ TÌM TRƯỚC ĐÓ)
      // ===============================================
      if (exactMatchDoc) {
        const exactDoc = exactMatchDoc;
        const exactData = exactDoc.data();  // Trường hợp 1: Cũ KHÔNG có file
        if (!exactData.fileUrl) {
          if (!file) {
            // Bản mới cũng không có file → coi là trùng, bỏ qua
            hideLoading();
            showSwal("info", "Bản ghi đã tồn tại, không cần gửi lại.");
            // ⭐️ BỔ SUNG LOG ⭐️
            addLog("report_skipped_exact_match", { email: userEmail, collection: collectionName, company, ngay_ghi, chi_so: newChiSo, reason: "No file & exact match", ghi_chu: data.ghi_chu });
            return;
          } else {
            // Bản mới có file → cập nhật (ghi đè)
            const uploaded = await uploadFileToDrive(file, company, folderId, formId, data);
            const updatedRecord = {
              ...exactData,
              ...data,
              chi_so: newChiSo,
              fileUrl: uploaded.url,
              fileId: uploaded.id,
              updatedAt: serverTimestamp()
            };
            await setDoc(doc(db, collectionName, exactDoc.id), updatedRecord, { merge: true });
            await addLog("updateFile", { email: userEmail, id: exactDoc.id, collection: collectionName, newFile: uploaded.id, company: company, ngay_ghi: ngay_ghi, chi_so: newChiSo, ghi_chu: updatedRecord.ghi_chu });
            hideLoading();
            showSwal("success", "Đã cập nhật file cho bản ghi.");
            form.reset();
            if (form.ngay_ghi) form.ngay_ghi.value = new Date().toLocaleDateString('en-CA');
            return;
          }
        }

        // Trường hợp 2: Cũ CÓ file
        else {
          if (!file) {
            // Bản mới không có file → trùng hoàn toàn, bỏ qua
            hideLoading();
            showSwal("info", "Bản ghi đã tồn tại, không cần gửi lại.");
            // ⭐️ BỔ SUNG LOG ⭐️
            addLog("report_skipped_exact_match", { email: userEmail, collection: collectionName, company, ngay_ghi, chi_so: newChiSo, reason: "File exists & exact match", ghi_chu: data.ghi_chu });
            return;
          } else {
            // Bản mới có file → hỏi xác nhận
            hideLoading(); // Ẩn loading trước khi hỏi
            const result = await Swal.fire({
              icon: "question",
              title: "Bản ghi đã tồn tại kèm file",
              text: "Bạn có muốn thay thế file cũ bằng file mới không?",
              showCancelButton: true,
              confirmButtonText: "Có, thay thế",
              cancelButtonText: "Không"
            });
            showLoading("Đang xử lý báo cáo..."); // Hiện loading lại

            if (result.isConfirmed) {
              const uploaded = await uploadFileToDrive(file, company, folderId, formId, data);

              // Nếu file cũ còn → xóa nếu không ai dùng
              if (exactData.fileId) {
                const qRemaining = query(
                  collection(db, collectionName),
                  where("fileId", "==", exactData.fileId),
                  where("__name__", "!=", exactDoc.id)
                );
                const snapRemaining = await getDocs(qRemaining);
                if (snapRemaining.empty) {
                  await deleteFileFromDrive(exactData.fileId).catch(err => {
                    console.warn("Không thể xóa file cũ:", err);
                    // ⭐️ BỔ SUNG LOG ⭐️
                    addLog("drive_cleanup_fail", { email: userEmail, fileId: exactData.fileId, error: err.message, reason: "exact_match_replace" });
                  });
                }
              }

              const updatedRecord = {
                ...exactData,
                ...data,
                chi_so: newChiSo,
                fileUrl: uploaded.url,
                fileId: uploaded.id,
                updatedAt: serverTimestamp()
              };
              await setDoc(doc(db, collectionName, exactDoc.id), updatedRecord, { merge: true });
              await addLog("updateFile", { email: userEmail, id: exactDoc.id, collection: collectionName, newFile: uploaded.id, oldFile: exactData.fileId, action: "replace", company: company, ngay_ghi: ngay_ghi, chi_so: newChiSo, ghi_chu: updatedRecord.ghi_chu });

              // 🚀 Gửi Push Notification Cập nhật ảnh
              notifyAdmins("🔄 Cập nhật báo cáo", `Cập nhật hình ảnh chỉ số Công ty ${company} - User: ${userEmail}`);
              hideLoading();
              showSwal("success", "Đã thay thế file cho bản ghi.");
              form.reset();
              if (form.ngay_ghi) form.ngay_ghi.value = new Date().toLocaleDateString('en-CA');
              return;
            } else {
              hideLoading();
              showSwal("info", "Đã hủy gửi báo cáo.");
              // ⭐️ BỔ SUNG LOG ⭐️
              addLog("form_submit_canceled", { email: userEmail, formId, reason: "File replace confirmation" });
              return;
            }
          }
        }
      }


      // ===============================================
      // 2. KIỂM TRA CHỈ SỐ GIẢM (VÀ XÁC NHẬN BẮT BUỘC) - VỚI BẢN GHI TRƯỚC ĐÓ
      // ===============================================

      // Chỉ kiểm tra nếu chi_so là số hợp lệ
      if (!isNaN(newChiSo)) {
        const latestDoc = snapLatest.docs[0];

        if (!snapLatest.empty && (latestDoc.data().ngay_ghi !== ngay_ghi)) { // Loại trừ trường hợp trùng ngày (đã xử lý ở trên)
          const latestData = latestDoc.data();
          const latestChiSo = parseFloat(latestData.chi_so);

          if (!isNaN(latestChiSo) && newChiSo < latestChiSo) {
            hideLoading();

            const result = await Swal.fire({
              icon: 'error',
              title: '❌ DỮ LIỆU ĐẶC BIỆT: Chỉ Số Đang Giảm!',
              html: `
                        <p style="text-align: center; color: #cc0000; font-weight: bold; font-size: 1.1em; margin-bottom: 10px;">
                            Chỉ số mới (${newChiSo}) < Chỉ số trước đó (${latestChiSo} ngày ${latestData.ngay_ghi}).
                        </p>
                        <p style="text-align: left; margin-bottom: 15px;">
                            Điều này chỉ xảy ra khi **đồng hồ bị thay thế/reset**. Vui lòng **xác nhận** và **ghi rõ lý do** để hệ thống thống kê chính xác.
                        </p>
                        <div style="border: 2px solid #ff4d4d; padding: 12px; margin-top: 15px; background-color: #ffe6e6; border-radius: 8px;">
                            <label for="swal-checkbox-reset" style="font-weight: bold; color: #a30000; display: flex; align-items: center; cursor: pointer;">
                                <input type="checkbox" id="swal-checkbox-reset" style="margin-right: 10px; width: 20px; height: 20px; min-width: 20px;">
                                <span>TÔI XÁC NHẬN đây là trường hợp đặc biệt và đồng ý lưu.</span>
                            </label>
                        </div>
                        <input id="swal-input-reason" class="swal2-input" placeholder="Lý do chi tiết (BẮT BUỘC)" style="margin-top: 20px;">
                    `,
              focusConfirm: false,
              showCancelButton: true,
              confirmButtonText: '✅ Gửi Dữ Liệu Đặc Biệt',
              cancelButtonText: '❌ Hủy & Quay Lại Sửa',
              allowOutsideClick: false,
              allowEscapeKey: false,

              preConfirm: () => {
                const checkbox = document.getElementById('swal-checkbox-reset');
                const reason = document.getElementById('swal-input-reason').value.trim();

                if (!checkbox.checked) {
                  Swal.showValidationMessage('Bạn PHẢI xác nhận bằng cách chọn hộp kiểm.');
                  return false;
                }
                if (!reason) {
                  Swal.showValidationMessage('Lý do là BẮT BUỘC để gửi dữ liệu đặc biệt này.');
                  return false;
                }
                return { reason: reason };
              }
            });

            if (result.isConfirmed) {
              // Người dùng đã xác nhận
              data.isMeterReset = true; // Thêm cờ đặc biệt

              // Cập nhật trường ghi chú
              data.ghi_chu = (data.ghi_chu ? data.ghi_chu + " | " : "") + `[CS GIẢM ĐẶC BIỆT: ${result.value.reason}]`;

              showSwal("warning", "Đã xác nhận gửi chỉ số thấp kèm lý do. Đang xử lý...");
              showLoading("Đang xử lý báo cáo đặc biệt...");
              // ⭐️ BỔ SUNG LOG ⭐️
              addLog("meter_reset_confirmed", { email: userEmail, company, ngay_ghi, newChiSo, oldChiSo: latestChiSo, reason: result.value.reason, ghi_chu: data.ghi_chu });

            } else {
              // Người dùng nhấn Hủy Bỏ
              showSwal("info", "Đã hủy gửi báo cáo. Vui lòng kiểm tra lại chỉ số.");
              form.reset();
              if (form.ngay_ghi) form.ngay_ghi.value = new Date().toLocaleDateString('en-CA');
              // ⭐️ BỔ SUNG LOG ⭐️
              addLog("meter_reset_canceled", { email: userEmail, company, ngay_ghi, newChiSo, oldChiSo: latestChiSo, ghi_chu: data.ghi_chu });
              return;
            }
          }
        }
      }

      // ===============================================
      // 3. ⭐️ KIỂM TRA TRÙNG 2 TRƯỜNG (SỬ DỤNG snapSameDay ĐÃ CÓ)
      // ===============================================
      if (snapSameDay.docs.length > 0) {
        hideLoading();
        // Trùng 2 thông tin -> Hiện Confirm Ghi thêm
        let isConfirmed = await showConfirmSwal(
          "Dữ liệu đã tồn tại", // Tiêu đề Swal.fire (nên có)
          `Ngày ${ngay_ghi} của ${company} đã có báo cáo. Bạn muốn GHI THÊM DỮ LIỆU MỚI (${chi_so}) cùng ngày không?`,
          "OK",           // Thay thế 'Có' bằng 'OK'
          "Hủy bỏ",       // Thay thế 'Không' bằng 'Hủy bỏ'
          "info"          // Sử dụng icon info vì đây là hành động ghi thêm, không phải lỗi
        );

        if (!isConfirmed) {
          showSwal("info", "Đã hủy gửi báo cáo.");
          form.reset();
          if (form.ngay_ghi) form.ngay_ghi.value = new Date().toLocaleDateString('en-CA');
          // ⭐️ BỔ SUNG LOG ⭐️
          addLog("form_submit_canceled", { email: userEmail, formId, reason: "Duplicate date confirmation" });
          return;
        }
        showLoading("Đang xử lý báo cáo...");
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("duplicate_date_accepted", { email: userEmail, company, ngay_ghi, newChiSo, ghi_chu: data.ghi_chu });
      }



      // ===============================================
      // 4. LƯU TRỮ DỮ LIỆU SAU KHI VƯỢT QUA CÁC BƯỚC KIỂM TRA
      // ===============================================

      let fileUrl = "";
      let fileId = "";

      if (file) {
        const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
        fileUrl = uploaded.url;
        fileId = uploaded.id;
      }

      // Cập nhật lại data với thông tin file trước khi lưu
      data.fileUrl = fileUrl;
      data.fileId = fileId;

      // LƯU VÀO FIRESTORE (data đã có isMeterReset: true nếu chỉ số giảm)
      // Sẽ gọi addDoc_success trong addReportDoc
      const docRef = await addReportDoc(data, collectionName);

      // 🚀 Gửi Push Notification Form 1 (Chỉ số)
      if (data.isMeterReset) {
        notifyAdmins("🚨 CẢNH BÁO: CHỈ SỐ GIẢM", `Công ty ${data.company} báo cáo giảm chỉ số. User: ${userEmail}`);
      } else {
        notifyAdmins("💧 Có chỉ số mới", `Công ty ${data.company} - User: ${userEmail}`);
      }

      showSwal("success", "Thành công", "Báo cáo đã được gửi!");
      form.reset();
      if (form.ngay_ghi) form.ngay_ghi.value = new Date().toLocaleDateString('en-CA');

      // Đợi một chút rồi hỏi bật thông báo nếu họ chưa bật
      setTimeout(() => {
        if (Notification.permission === 'default') {
          requestNotificationPermission();
        }
      }, 2500);
    }

    // ... (các khối xử lý form khác và khối finally) ...
  } catch (err) {
    // Bắt các lỗi cấp cao (lỗi đăng nhập, lỗi upload file Drive, lỗi Form 1)
    console.error(`❌ Lỗi khi submit ${formId}:`, err);
    showSwal("error", "Thất bại", err.message);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("form_submit_fatal_error", { email: userEmail, formId, error: err.message, collection: collectionName });
    hideLoading();
  } finally {
    hideLoading();
  }

}

//
export function listenReports(collectionName, callback) {
  // ⭐️ GIỚI HẠN BẢN GHI ĐỂ TRÁNH ĐỐT CHI PHÍ (Mặc định 50 cho các luồng listen)
  const q = query(
    collection(db, collectionName),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  return onSnapshot(q, (snapshot) => {
    const reports = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(reports);
  }, (error) => {
    console.error(`[listenReports] Lỗi lắng nghe ${collectionName}:`, error);
  });
}
//
/**
 * (HÀM MỚI) Tải báo cáo trong một khoảng ngày cụ thể.
 * Hàm này không lắng nghe real-time, chỉ tải 1 lần (getDocs).
 * @param {string} collectionName - Tên collection (vd: "reports_1")
 * @param {string} dateField - Tên trường chứa ngày (vd: "ngay_ghi")
 * @param {string} startDate - Ngày bắt đầu (YYYY-MM-DD)
 * @param {string} endDate - Ngày kết thúc (YYYY-MM-DD)
 * @returns {Promise<Array>} Mảng các báo cáo
 */
export async function getReportsByDate(collectionName, dateField, startDate, endDate, limitCount = null) {
  // Validate đầu vào
  if (!collectionName || !dateField || !startDate || !endDate) {
    showSwal("error", "Lỗi truy vấn", "Thiếu thông tin để tải dữ liệu.");
    return [];
  }

  showLoading("Đang tải dữ liệu theo ngày...");
  try {
    // ⭐️ Thêm limit nếu có
    let q = query(
      collection(db, collectionName),
      where(dateField, ">=", startDate),
      where(dateField, "<=", endDate),
      orderBy(dateField, "desc") // Sắp xếp theo ngày (mới nhất trước)
    );

    if (limitCount && limitCount !== "all") {
      q = query(q, limit(parseInt(limitCount)));
    }

    const snapshot = await getDocs(q);
    const reports = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    hideLoading();
    return reports; // Trả về mảng dữ liệu đã lọc

  } catch (err) {
    console.error("Lỗi getReportsByDate:", err);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("getReportsByDate_failure", {
      collection: collectionName,
      error: err.message,
      startDate,
      endDate,
      limit: limitCount
    });
    hideLoading();
    showSwal("error", "Lỗi tải dữ liệu", err.message);
    return []; // Trả về mảng rỗng nếu lỗi
  }
}
//
// Dùng riêng cho Master List (không orderBy createdAt) - ⭐️ GIỚI HẠN 50
export function listenCollection(collectionName, callback) {
  const q = query(collection(db, collectionName), limit(50));
  return onSnapshot(q, (snapshot) => {
    const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(docs);
  }, (error) => {
    console.error(`[listenCollection] Lỗi lắng nghe ${collectionName}:`, error);
  });
}

// Sửa đổi hàm deleteReport để xóa cả file và bản ghi
export async function deleteReport(collectionName, id) {
  const docRef = doc(db, collectionName, id);
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  try {
    // Bước 1: Lấy bản ghi từ Firestore trước khi xóa
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("deleteReport_not_found", { id, collection: collectionName, email: userEmail });
      throw new Error("Không tìm thấy bản ghi để xóa.");
    }
    const reportData = docSnap.data();

    // Bước 2: Ghi log chi tiết bản ghi trước khi xóa (Log cũ đã có)
    await addLog("deleteReport", {
      ...reportData,
      id,
      collection: collectionName,
      email: userEmail
    });

    // Bước 3: Nếu có file đính kèm, gọi hàm xóa file từ Google Drive
    const fileId = reportData.fileId;
    if (fileId) {
      // Cần kiểm tra xem còn bản ghi nào khác tham chiếu đến file này không
      const qRemaining = query(
        collection(db, collectionName),
        where("fileId", "==", fileId),
        where("__name__", "!=", id),
        limit(1)
      );
      const snapRemaining = await getDocs(qRemaining);

      if (snapRemaining.empty) {
        // Chỉ xóa file nếu không còn bản ghi nào khác tham chiếu
        try {
          await deleteFileFromDrive(fileId);
          // log drive_delete_success sẽ được gọi bên trong deleteFileFromDrive
        } catch (e) {
          // log drive_delete_failure sẽ được gọi bên trong deleteFileFromDrive
          console.warn(`[Drive Delete Error] Không thể xóa file ${fileId} khi xóa báo cáo ${id}:`, e);
        }
      } else {
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("deleteReport_file_skipped", { id, collection: collectionName, fileId, remainingRefs: snapRemaining.size });
      }
    }

    // Bước 4: Xóa bản ghi + Lập Bia mộ (Tombstone) để đồng bộ IndexedDB
    const batch = writeBatch(db);
    batch.delete(docRef); // Xóa báo cáo thật
    batch.set(doc(collection(db, "sync_deletes")), { // Ghi sổ xóa
      docId: id, collectionName: collectionName, deletedAt: serverTimestamp()
    });
    await batch.commit();

  } catch (err) {
    console.error("Lỗi khi xóa báo cáo:", err);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("deleteReport_failure", { id, collection: collectionName, email: userEmail, error: err.message });
    throw err;
  }
}

// Thêm vào cuối file, trước các hàm showSwal/showConfirm
/**
 * Kiểm tra xem một ngày (YYYY-MM-DD) có phải là ngày nghỉ mặc định (T7, CN) hay không.
 * @param {string} isoDate - Ngày theo định dạng ISO (YYYY-MM-DD).
 * @param {string} company - Tên công ty (chưa dùng nhưng giữ lại để mở rộng).
 * @param {object} config - Cấu hình hệ thống (chứa quy tắc nghỉ cuối tuần).
 * @returns {boolean} True nếu là ngày nghỉ mặc định.
 */
export function isDateADefaultHoliday(isoDate, company, config) {
  if (!isoDate) return false;

  // Lấy ngày trong tuần: 0=CN, 1=T2, ..., 6=T7
  const date = new Date(isoDate);
  const dayOfWeek = date.getDay();

  // Kiểm tra cấu hình nghỉ T7/CN của công ty
  const defaultHolidaySetting = config?.defaultHolidays?.[company];

  if (defaultHolidaySetting === 'sat_sun' || defaultHolidaySetting === undefined) {
    // Mặc định: nghỉ T7 & CN
    return dayOfWeek === 0 || dayOfWeek === 6;
  } else if (defaultHolidaySetting === 'sun_only') {
    // Chỉ nghỉ CN
    return dayOfWeek === 0;
  }
  // Nếu là 'none' hoặc các trường hợp khác (T2-T6)
  return false;
}
let loadingTimer = null;
let isShowingLoading = false;

// Hiện modal loading (có độ trễ để tránh chớp giật)
export function showLoading(msg = "Đang xử lý, vui lòng chờ...") {
  const modal = document.getElementById("loadingModal");
  if (modal) {
    modal.querySelector("p").textContent = msg;
    
    // Nếu chưa hiện và chưa có lịch hẹn hiện, ta chờ 300ms
    // Nếu dữ liệu load từ cache siêu nhanh (<300ms), hideLoading sẽ hủy lệnh này!
    if (!loadingTimer && !isShowingLoading) {
      loadingTimer = setTimeout(() => {
        modal.style.display = "flex";
        isShowingLoading = true;
        loadingTimer = null; // Đặt về null khi timer đã chạy xong
      }, 300);
    } else if (isShowingLoading) {
      // Nếu đã hiện rồi thì chỉ cập nhật text
      modal.style.display = "flex";
    }
  }

  // Vô hiệu hóa nút gửi để tránh click đúp hoặc spam
  document.querySelectorAll('button[type="submit"], .submit-btn').forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.style.cursor = 'not-allowed';
  });
}

// Ẩn modal loading
export function hideLoading() {
  const modal = document.getElementById("loadingModal");
  if (modal) {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }
    modal.style.display = "none";
    isShowingLoading = false;
  }

  // Kích hoạt lại nút gửi
  document.querySelectorAll('button[type="submit"], .submit-btn').forEach(btn => {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  });
}

// Alert thông báo (Giữ nguyên)
let alertTimeout;

export function showAlert(type, title, message) {
  const modal = document.getElementById("alertModal");
  const alertTitle = document.getElementById("alertTitle");
  const alertMessage = document.getElementById("alertMessage");
  const okBtn = document.getElementById("alertOkBtn");

  if (!modal) return;

  alertTitle.textContent = title;
  alertMessage.textContent = message;

  modal.querySelector(".alert-box").classList.remove("alert-success", "alert-error");
  modal.querySelector(".alert-box").classList.add(type === "success" ? "alert-success" : "alert-error");

  modal.style.display = "flex";

  okBtn.onclick = () => hideAlert();

  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    hideAlert();
  }, 5000);
}

// Ẩn alert
export function hideAlert() {
  const modal = document.getElementById("alertModal");
  if (modal) {
    modal.style.display = "none";
  }
}

//SweetAlert2 (Giữ nguyên)

export function showSwal(type, title, options = {}) { // Đổi 'message' thành 'title'
  window.Swal.fire({
    toast: true,
    position: options.position || 'top-end',
    icon: type,
    title: title, // Dùng title (Tiêu đề)

    html: options.html || null,
    // heightAuto: false, // Chống giật trang (Thuộc tính này không dùng chung với toasts)

    width: options.width || '400px',
    showConfirmButton: options.showConfirmButton || false,
    timer: options.timer || 1500, // Giảm từ 2.5s xuống 1.5s
    timerProgressBar: true,
    showClass: { popup: '' }
  });
}
//Confirm SweetAlert2.
/**
 * Hiển thị hộp thoại xác nhận (Có/Không) bằng SweetAlert2.
 * @param {string} title - Tiêu đề của hộp thoại (nên đặt).
 * @param {string} htmlMessage - Nội dung thông báo (có thể chứa HTML).
 * @param {string} confirmText - Văn bản cho nút Đồng ý/Xác nhận (mặc định là 'Có').
 * @param {string} cancelText - Văn bản cho nút Hủy (mặc định là 'Không').
 * @param {string} [icon='warning'] - Icon hiển thị (warning, info, question, error, success).
 * @returns {Promise<boolean>} Trả về true nếu người dùng nhấn nút xác nhận (confirm).
 */
export async function showConfirmSwal(
  title,
  htmlMessage,
  confirmText = 'Có',
  cancelText = 'Không',
  icon = 'warning'
) {
  const result = await Swal.fire({
    title: title,
    html: htmlMessage,
    icon: icon,
    showCancelButton: true, // Hiển thị nút Hủy
    confirmButtonColor: '#3085d6',
    cancelButtonColor: '#d33',
    confirmButtonText: confirmText, // Tên nút Đồng ý tùy chỉnh
    cancelButtonText: cancelText,   // Tên nút Hủy tùy chỉnh
    allowOutsideClick: false,
    allowEscapeKey: false,
    heightAuto: false, // Chống giật trang
  });

  return result.isConfirmed; // Trả về true nếu nút confirm (OK/Có) được nhấn
}


//
// ===================================================================
// 🔹 Các hàm hỗ trợ riêng cho trang sắp lịch.html (có thể thêm ở cuối file)
// ===================================================================

/**
 * Đọc cấu hình tuần từ Firestore tại đường dẫn "config/reportConfig"
 * Trả về dữ liệu gốc (object chứa weekDayStart, yearDayStart, v.v.)
 */
export async function fetchWeekConfig() {
  try {
    console.log("📡 Đang đọc config/reportConfig ...");
    const docRef = doc(db, "config", "reportConfig");
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log("✅ Cấu hình reportConfig đã đọc:", data);
      return data;
    } else {
      console.warn("⚠️ Không tìm thấy document config/reportConfig, dùng mặc định.");
      return { weekDayStart: 1 }; // Thứ 2 mặc định
    }
  } catch (error) {
    console.error("❌ Lỗi khi đọc reportConfig:", error);
    return { weekDayStart: 1 }; // fallback an toàn
  }
}

/**
 * Đọc giá trị weekDayStart và trả về số (0=CN, 1=T2, ..., 6=T7)
 */
export async function getWeekDayStart() {
  const config = await fetchWeekConfig();
  const value = parseInt(config?.weekDayStart);

  if (!isNaN(value) && value >= 0 && value <= 6) {
    console.log(`🗓️ weekDayStart = ${value} (0=CN, 1=T2...)`);
    return value;
  } else {
    console.warn("⚠️ Giá trị weekDayStart không hợp lệ, dùng mặc định (1)");
    return 1;
  }
}

/**
 * Xuất: Lưu quy tắc công việc mới vào Firestore.
 * @param {object} ruleData - Dữ liệu quy tắc (ruleType, value, jobName).
 * @param {string} userEmail - Email người dùng thực hiện hành động.
 */
export async function saveRule(ruleData) {
  const user = auth.currentUser;
  if (!user || !user.email) { showSwal("error", "Vui lòng đăng nhập."); return; }

  const { content, dayOfWeek, dayOfMonth } = ruleData;

  const safeDayOfWeek = (dayOfWeek !== "" && !Number.isNaN(parseInt(dayOfWeek, 10)))
    ? parseInt(dayOfWeek, 10) : null;
  const safeDayOfMonth = (dayOfMonth !== "" && !Number.isNaN(parseInt(dayOfMonth, 10)))
    ? parseInt(dayOfMonth, 10) : null;

  await addDoc(collection(db, "job"), {
    content,
    dayOfWeek: safeDayOfWeek,
    dayOfMonth: safeDayOfMonth,
    createdBy: user.email,
    createdAt: serverTimestamp()
  });
  addLog("admin_create_manual_job", { email: user.email, job: content });
}

/**
 * Xuất: Lấy danh sách tất cả người dùng từ collection 'users'.
 */
export async function fetchAllUsers() { // <<< Bắt buộc phải có 'export'
  try {
    const usersCol = collection(db, "users");
    const userSnapshot = await getDocs(usersCol);
    const userList = userSnapshot.docs.map(doc => ({
      id: doc.id,
      email: doc.id, // Giả định email là document ID
      ...doc.data()
    }));
    console.log("✅ Đã tải danh sách người dùng:", userList);
    return userList;
  } catch (error) {
    console.error("❌ Lỗi khi tải danh sách người dùng:", error);
    // Trả về mảng rỗng thay vì ném lỗi để không làm sập giao diện
    return [];
  }
}

/**
 * Xuất: Thiết lập Listener thời gian thực (onSnapshot) cho một collection.
 * * @param {string} collectionName - Tên collection (ví dụ: "job").
 * @param {function} callback - Hàm sẽ được gọi mỗi khi dữ liệu thay đổi.
 * @returns {function} Hàm unsubscribe để ngừng lắng nghe.
 */
export function listenJobData(collectionName, callback) {
  // Bắt buộc phải có 'export'

  // Lấy tham chiếu đến collection
  const colRef = collection(db, collectionName);

  // Tạo query: Lấy tất cả document, sắp xếp theo thời gian tạo (giả định có trường 'createdAt')
  // Nếu bạn không cần sắp xếp, bạn có thể chỉ dùng: const q = colRef;
  const q = query(colRef, orderBy("createdAt", "desc"));

  // Thiết lập listener thời gian thực
  const unsubscribe = onSnapshot(q, (snapshot) => {
    // Ánh xạ (map) các document thành một mảng đối tượng JavaScript
    const documents = snapshot.docs.map(doc => ({
      id: doc.id, // Giữ lại ID của document
      ...doc.data()
    }));

    console.log(`✅ ${documents.length} document đã tải từ ${collectionName} (Real-time).`);

    // Gọi lại (callback) hàm trong h.html với dữ liệu đã tải
    callback(documents);

  }, (error) => {
    console.error(`❌ Lỗi khi lắng nghe collection ${collectionName}:`, error);
    // Có thể thêm logic xử lý lỗi khác ở đây
  });

  return unsubscribe; // Rất quan trọng, cho phép ngắt kết nối khi cần
}

//
// 🟠 Xóa quy tắc công việc
export async function deleteRule(id) {
  const docRef = doc(db, "job", id);
  const snap = await getDoc(docRef);
  const deletedData = snap.exists() ? snap.data() : {};
  await deleteDoc(docRef);
  addLog("admin_delete_manual_job", { email: auth.currentUser?.email || "unknown", deletedJobId: id, deletedJob: deletedData });
  console.log("Đã xóa rule:", id);
}

//
// 🟠 Ẩn/Hiện quy tắc công việc
export async function toggleHideRule(id, currentStatus) {
  const docRef = doc(db, "job", id);
  const snap = await getDoc(docRef);
  const data = snap.exists() ? snap.data() : {};
  await setDoc(docRef, { isHidden: !currentStatus }, { merge: true });
  addLog("admin_update_manual_job", { email: auth.currentUser?.email || "unknown", jobId: id, updateData: { job: data.content, isHidden: !currentStatus } });
}

//
export async function getAllRules() {
  const rules = [];
  try {
    const snapshot = await getDocs(collection(db, "job"));
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      rules.push({
        id: docSnap.id,
        content: data.content || "",
        dayOfWeek: data.dayOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        createdBy: data.createdBy || "",
        createdAt: data.createdAt || null,
        isHidden: data.isHidden || false
      });
    });
    return rules;
  } catch (err) {
    console.error("Lỗi getAllRules:", err);
    return [];
  }
}

//
export function listenRulesRealtime(callback) {
  const q = query(collection(db, "job"), orderBy("createdAt", "desc"));
  let firstSnapshotLoaded = false;

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const rules = snapshot.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        content: data.content || "",
        dayOfWeek: data.dayOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        createdBy: data.createdBy || "",
        createdAt: data.createdAt || null,
        isHidden: data.isHidden || false
      };
    });

    // tránh ghi đè khi snapshot đầu tiên rỗng
    if (!firstSnapshotLoaded && rules.length === 0) {
      console.log("[listenRulesRealtime] Bỏ qua snapshot trống đầu tiên");
      firstSnapshotLoaded = true;
      return;
    }

    firstSnapshotLoaded = true;
    console.log("[listenRulesRealtime] cập nhật", rules.length, "quy tắc");
    callback(rules);
  }, (error) => {
    console.error("[listenRulesRealtime] Lỗi lắng nghe:", error);
  });

  // Hàm này trả về một hàm để hủy lắng nghe khi cần
  return unsubscribe;
}

// Trong file script.js
export function getCurrentUserEmail() {
  return auth.currentUser?.email || "unknown_user";
}

// ===================================================================
// 🟠 TÍNH NĂNG CACHING (LƯU KẾT QUẢ TÍNH TOÁN)
// ===================================================================

/**
 * Hành động: Lưu kết quả lịch trực cụ thể của một ngày vào Firestore.
 * Dùng hàm này khi Admin chốt lịch hoặc khi hệ thống Autoplan tính toán xong.
 * Collection: 'daily_schedules' (ID document sẽ là chuỗi ngày YYYY-MM-DD)
 */
export async function saveDailyScheduleCache(dateStr, content) {
  // dateStr: "2024-12-12", content: "Nguyễn Văn A"
  try {
    const docRef = doc(db, "daily_schedules", dateStr);
    await setDoc(docRef, {
      content: content,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || "system"
    });
    console.log(`✅ Đã lưu cache lịch trực cho ngày ${dateStr}`);
  } catch (error) {
    console.error("❌ Lỗi lưu cache lịch trực:", error);
  }
}

// ===================================================================
// 🔹 CÁC HÀM QUẢN LÝ DANH SÁCH CÔNG TY
// ===================================================================

// Helper để render các option của dropdown công ty bảo toàn giá trị cũ
function renderCompanyOptions(selectElement, companies) {
  const currentVal = selectElement.value;
  selectElement.innerHTML = '<option value="" disabled selected>- Chọn công ty -</option>';
  companies.forEach(comp => {
    const option = document.createElement("option");
    option.value = comp;
    option.textContent = comp;
    selectElement.appendChild(option);
  });
  if (currentVal && companies.includes(currentVal)) {
    selectElement.value = currentVal;
  }
}

/**
 * Tải danh sách công ty từ Firestore và tự động render vào thẻ select.
 * Tận dụng bảng companies_master và company_configs để xác định nhóm.
 * @param {string} selectId ID của thẻ select HTML
 * @param {string} filterGroup Lọc theo nhóm: 'group1' (Đồng hồ), 'group2' (Hóa đơn), 'group3' (Khoán), 'all' (Tất cả)
 */
export async function loadCompanyDropdown(selectId, filterGroup = 'all') {
  const selectElement = document.getElementById(selectId);
  if (!selectElement) return;

  const cacheKey = `company_dropdown_${filterGroup}`;
  
  // 1. Render nhanh từ cache sessionStorage nếu có
  try {
    const cachedData = sessionStorage.getItem(cacheKey);
    if (cachedData) {
      renderCompanyOptions(selectElement, JSON.parse(cachedData));
    }
  } catch (e) {
    console.warn("Lỗi đọc cache dropdown từ sessionStorage:", e);
  }

  try {
    // 2. Lấy dữ liệu mới nhất từ Firestore chạy ngầm
    const [masterSnap, configSnap] = await Promise.all([
      getDocs(collection(db, "companies_master")),
      getDocs(collection(db, "company_configs"))
    ]);

    const masterCompanies = masterSnap.docs.map(doc => doc.data().company).filter(Boolean);
    const configs = configSnap.docs.map(d => d.data());
    const configCompanies = configs.map(c => c.company).filter(Boolean);

    // Gộp danh sách và loại bỏ trùng lặp
    let allCompanies = [...new Set([...masterCompanies, ...configCompanies])];

    // Tìm config mới nhất cho mỗi công ty để phân loại nhóm
    const latestConfigs = {};
    configs.sort((a, b) => (a.effectiveDate || "").localeCompare(b.effectiveDate || ""));
    configs.forEach(c => {
      if (c.company) latestConfigs[c.company] = c;
    });

    // Lọc danh sách theo yêu cầu
    if (filterGroup !== 'all') {
      allCompanies = allCompanies.filter(comp => {
        const c = latestConfigs[comp];
        const group = (c && c.group) ? c.group : (['NTSF', 'Ấn Độ Dương', 'Đại Tây Dương', 'Amicogen', 'Cá Việt Nam'].includes(comp) ? 'group1' : 'group3');
        return group === filterGroup;
      });
    }

    // Sắp xếp Alphabet
    allCompanies.sort((a, b) => a.localeCompare(b));

    // 3. Cập nhật cache sessionStorage
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(allCompanies));
    } catch (e) {
      console.warn("Lỗi ghi cache dropdown vào sessionStorage:", e);
    }

    // 4. Render lại dropdown với dữ liệu mới nhất
    renderCompanyOptions(selectElement, allCompanies);
  } catch (error) {
    console.error("Lỗi tải danh sách công ty:", error);
    // Nếu không có cả cache lẫn dữ liệu mới, báo lỗi
    if (!selectElement.value || selectElement.options.length <= 1) {
      selectElement.innerHTML = '<option value="" disabled selected>- Lỗi tải dữ liệu -</option>';
    }
  }
}

/**
 * Tải động HTML template từ cache sessionStorage hoặc fetch qua mạng
 * @param {string} placeholderId ID của phần tử chứa trên DOM
 * @param {string} url Đường dẫn tới file HTML template
 * @param {Function} callback Hàm chạy sau khi chèn HTML xong
 */
export function loadTemplate(placeholderId, url, callback) {
  const container = document.getElementById(placeholderId);
  if (!container) return;

  // Đổi thành v6 để phá bộ nhớ đệm (Cache busting) do vừa thay đổi code html
  const cacheKey = `cached_html_v6_${url}`;
  
  try {
    const cachedHTML = localStorage.getItem(cacheKey);
    if (cachedHTML) {
      container.innerHTML = cachedHTML;
      if (typeof callback === "function") callback();
      return;
    }
  } catch (e) {
    console.warn("Lỗi đọc cache template từ localStorage:", e);
  }

  // Bổ sung tham số thời gian để tránh cache HTTP trình duyệt
  fetch(`${url}?t=${Date.now()}`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
      return r.text();
    })
    .then(html => {
      try {
        localStorage.setItem(cacheKey, html);
      } catch (e) {
        console.warn("Lỗi ghi cache template vào localStorage:", e);
      }
      container.innerHTML = html;
      if (typeof callback === "function") callback();
    })
    .catch(err => {
      console.error(`Lỗi khi load template ${url}:`, err);
    });
}

// Export thêm các hàm Firestore cần thiết cho chatbot
export { query, orderBy, limit, where, getDocs, collection, doc, getDoc, addDoc, setDoc, deleteDoc, uploadFileToDrive, deleteFileFromDrive };

