// menu.js
import { auth, db, onAuth, logout, addLog, showSwal, getRole, initAutoLogout, requestNotificationPermission } from "./script.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// Hàm khóa cuộn trang, chống giật UI
function toggleBodyScroll(disable) {
  if (disable) {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.paddingRight = scrollbarWidth + "px";
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.paddingRight = "";
    document.body.style.overflow = "";
  }
}

export function initMenu() {
  const userEmailEl = document.getElementById("userEmail");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const adminOnly = document.querySelectorAll(".admin-only");

  const modal = document.getElementById("loginModal");
  const closeBtn = modal?.querySelector(".close");
  const form = document.getElementById("loginForm");
  const hamburger = document.querySelector(".hamburger");
  const navLinks = document.querySelector(".nav-links");

  // Xử lý đóng/mở menu chính khi nhấn nút hamburger
  hamburger.addEventListener("click", () => {
    navLinks.classList.toggle("active");
  });

  // Tự động đóng menu trên mobile khi chạm/click ra ngoài khu vực menu
  document.addEventListener("click", (event) => {
    if (hamburger && navLinks && !hamburger.contains(event.target) && !navLinks.contains(event.target)) {
      navLinks.classList.remove("active");
      document.querySelectorAll('.dropdown.active').forEach(d => d.classList.remove('active'));
    }
  });

  // Tự động đóng menu khi cuộn trang (lướt màn hình)
  window.addEventListener("scroll", () => {
    if (window.innerWidth <= 820 && navLinks && navLinks.classList.contains("active")) {
      navLinks.classList.remove("active");
      document.querySelectorAll('.dropdown.active').forEach(d => d.classList.remove('active'));
    }
  }, { passive: true });

  // Xử lý click cho tất cả dropdown trên mobile (ví dụ: Tác vụ, Thống kê BC)
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(drop => {
    const btn = drop.querySelector('.dropbtn');
    if (!btn) return;
    btn.addEventListener('click', function (event) {
      if (window.innerWidth <= 820) {
        event.preventDefault();
        // Đóng tất cả các dropdown khác
        dropdowns.forEach(otherDrop => {
          if (otherDrop !== drop) {
            otherDrop.classList.remove('active');
          }
        });
        // toggle dropdown này
        drop.classList.toggle('active');
      }
    });
  });

  /*
   * =========================================================================
   * == BỔ SUNG ĐOẠN CODE NÀY ĐỂ RESET TRẠNG THÁI MENU KHI RESIZE CỬA SỔ ==
   * =========================================================================
   */
  window.addEventListener('resize', () => {
    // Nếu chiều rộng cửa sổ lớn hơn 820px (chuyển sang desktop)
    if (window.innerWidth > 820) {
      // Xóa class 'active' khỏi menu chính
      navLinks.classList.remove('active');
      // Xóa class 'active' khỏi tất cả dropdown nếu có
      document.querySelectorAll('.dropdown.active').forEach(d => d.classList.remove('active'));
    }
  });


  // 🔥 Theo dõi trạng thái đăng nhập
  onAuth(async (user) => {
    const authRequiredItems = document.querySelectorAll('.auth-required');
    
    if (user) {
      userEmailEl.textContent = user.email;
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";

      // Áp dụng viền cam nếu là máy lạ tạm thời
      const isTrusted = window.isCurrentDeviceTrusted !== false;
      if (!isTrusted) {
        logoutBtn.style.border = "2px solid #e67e22";
        logoutBtn.title = "Tự động đăng xuất sau 1 giờ)";
      } else {
        logoutBtn.style.border = "";
        logoutBtn.title = "";
      }

      // Kích hoạt tự động đăng xuất nếu không hoạt động
      // Truyền vào số ngày, ví dụ: 7 ngày (hoặc có thể truyền số thập phân như 0.5 cho nửa ngày)
      initAutoLogout(7);

      // Hiển thị các menu cần đăng nhập (trừ admin-only)
      authRequiredItems.forEach(el => {
        if (!el.classList.contains('admin-only')) {
          el.style.display = ""; // Phục hồi display mặc định của CSS
        }
      });

      const role = await getRole(user.email);
      if (role === "admin") {
        adminOnly.forEach((el) => {
          if (el.closest('.dropdown-content')) {
            el.style.display = "block";
          } else {
            el.style.display = "inline-block"; // Hiển thị cả mục Quản trị
          }
        });
      } else {
        adminOnly.forEach((el) => (el.style.display = "none"));
      }
    } else {
      userEmailEl.textContent = "";
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      // Ẩn toàn bộ menu auth-required và admin-only
      authRequiredItems.forEach((el) => (el.style.display = "none"));
      adminOnly.forEach((el) => (el.style.display = "none"));
    }
  });

  // 🔥 Nút đăng xuất
  logoutBtn.addEventListener("click", async () => {
    try {
      await logout();
      showSwal("info", "Đăng xuất thành công!");
    } catch (err) {
      console.error("Lỗi khi đăng xuất:", err);
      showSwal("error", "Lỗi khi đăng xuất");
    }
  });

  // 🔥 Nút đăng nhập (mở modal)
  loginBtn.addEventListener("click", () => {
    modal.style.display = "block";
    toggleBodyScroll(true);
  });

  // 🔥 Đóng modal
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = "none";
      toggleBodyScroll(false);
    };
  }
  window.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      toggleBodyScroll(false);
    }
  };

  // 🔥 Form đăng nhập
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.email.value;
      const password = form.password.value;
      modal.style.display = "none";
      toggleBodyScroll(false);

      try {
        await signInWithEmailAndPassword(auth, email, password);

        // ⭐️ Log đăng nhập thành công
        await addLog("login_success", {
          email,
          status: "success",
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
        });

        form.reset();
        showSwal("success", "Đăng nhập thành công!");

        // Đợi 6 giây sau khi đăng nhập mới hiện popup hỏi quyền thông báo (Soft Ask)
        setTimeout(() => {
          if (Notification.permission === 'default') {
            requestNotificationPermission();
          }
        }, 6000);
      } catch (err) {
        console.error("🔥 LOGIN FAIL:", {
          email,
          error_code: err.code,
          message: err.message,
        });

        // ⭐️ Log đăng nhập thất bại
        await addLog("login_failure", {
          email,
          status: "error",
          error_code: err.code,
          error_message: err.message,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
        });

        // 🚀 BỔ SUNG: Bắn tín hiệu cảnh báo bảo mật về Google Apps Script
        try {
          const formData = new URLSearchParams();
          formData.append("action", "securityAlert");
          formData.append("data", JSON.stringify({ email: email }));
          // Gọi ngầm, không dùng await để tránh làm chậm giao diện người dùng
          fetch("https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec", {
            method: "POST",
            body: formData
          }).catch(e => console.warn("Lỗi gửi cảnh báo bảo mật:", e));
        } catch (e) { }

        showSwal("error", "Vui lòng kiểm tra lại tài khoản!");
      }
    });
  }

  // Xử lý sự kiện click trên các mục của menu cài đặt nhanh
  document.addEventListener("click", (e) => {
    const menuItem = e.target.closest(".quick-menu-item");
    if (menuItem) {
      const isSettingsPage = window.location.pathname.toLowerCase().includes("settings.html");
      if (isSettingsPage) {
        e.preventDefault();
        const tabName = menuItem.getAttribute("data-tab");
        const tabBtn = document.querySelector(`.settings-tab-btn[data-target="${tabName}"]`);
        if (tabBtn) {
          tabBtn.click();
          // Cập nhật đường dẫn URL mà không tải lại trang
          const newUrl = window.location.pathname + "?tab=" + tabName.replace("tab-", "");
          window.history.pushState({ path: newUrl }, "", newUrl);
        }
      }
    }
  });

  // Tải trước (Prefetch) các trang khi người dùng di chuột qua các liên kết menu
  const prefetchLinks = () => {
    const links = document.querySelectorAll("a[href$='.html'], .quick-menu-item[href]");
    links.forEach(link => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || href.includes("logout")) return;
      
      link.addEventListener("mouseenter", () => {
        // Loại bỏ phần query params khi đặt ID để tránh trùng lặp
        const cleanHref = href.split('?')[0];
        const id = `prefetch-${cleanHref.replace(/[^a-zA-Z0-9]/g, "_")}`;
        if (document.getElementById(id)) return; // Đã prefetch rồi
        
        const linkElem = document.createElement("link");
        linkElem.id = id;
        linkElem.rel = "prefetch";
        linkElem.href = href;
        document.head.appendChild(linkElem);
      }, { once: true });
    });
  };
  
  prefetchLinks();
}

