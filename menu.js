// menu.js
import { auth, db, onAuth, logout, addLog, showSwal, getRole } from "./script.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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

  // Xử lý click cho tất cả dropdown trên mobile (ví dụ: Tác vụ, Thống kê BC)
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(drop => {
    const btn = drop.querySelector('.dropbtn');
    if (!btn) return;
    btn.addEventListener('click', function(event) {
      if (window.innerWidth <= 820) {
        event.preventDefault();
        // chỉ toggle dropdown này (không ảnh hưởng dropdown khác)
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
    if (user) {
      userEmailEl.textContent = user.email;
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";

      const role = await getRole(user.email);
      if (role === "admin") {
        adminOnly.forEach((el) => (el.style.display = "inline-block"));
      } else {
        adminOnly.forEach((el) => (el.style.display = "none"));
      }
    } else {
      userEmailEl.textContent = "";
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      adminOnly.forEach((el) => (el.style.display = "none"));
    }
  });

  // 🔥 Nút đăng xuất
  logoutBtn.addEventListener("click", async () => {
    try {
      const currentEmail = auth.currentUser?.email || "unknown";
      await logout();
      await addLog("logout_success", {
        email: currentEmail,
        status: "success",
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
      });
      showSwal("info", "Đăng xuất thành công!");
    } catch (err) {
      console.error("Lỗi khi đăng xuất:", err);
      showSwal("error", "Lỗi khi đăng xuất");
    }
  });

  // 🔥 Nút đăng nhập (mở modal)
  loginBtn.addEventListener("click", () => {
    modal.style.display = "block";
  });

  // 🔥 Đóng modal
  if (closeBtn) {
    closeBtn.onclick = () => (modal.style.display = "none");
  }
  window.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
  };

  // 🔥 Form đăng nhập
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.email.value;
      const password = form.password.value;
      modal.style.display = "none";

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

        showSwal("error", "Vui lòng kiểm tra lại tài khoản!");
      }
    });
  }
}
