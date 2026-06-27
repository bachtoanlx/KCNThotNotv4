import { collection, getDocs, addDoc, deleteDoc, doc, query, where, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
    import { onAuth, addReport, showLoading, hideLoading, showSwal, promptForReAuth, db, getRole, showConfirmSwal, loadCompanyDropdown, loadTemplate } from "./script.js";
    import { initMenu } from "./menu.js";

    let fpNgayLamDB; 
    let userRole = null;
    let loggedInUserEmail = null; 

    // ================== MENU + MODAL ==================
    loadTemplate("menu-placeholder", "menu.html", () => {
      initMenu();
    });
    loadTemplate("loading-placeholder", "modal.html");
    // TẢI FOOTER (thêm đoạn này vào)
    loadTemplate("footer-placeholder", "footer.html");


    const notLogged = document.getElementById("notLogged");
    const content = document.getElementById("pageContent");

    // ================== CHECK LOGIN ==================
    onAuth(user => {
      // Logic check login
      if (user) {
        notLogged.style.display = "none";
        content.style.display = "flex"; /* Dùng flex để layout hoạt động tốt với CSS mới */
        // Tự động tải danh sách tất cả các công ty
        loadCompanyDropdown('c_ty', 'all');
      } else {
        notLogged.style.display = "flex";
        content.style.display = "none";
      }
    });

    // ================== FLATPICKR ==================
    function capitalizeFirstLetter(str) {
      if (!str) return "";
      return str.charAt(0).toUpperCase() + str.slice(1);
    }

    document.addEventListener('DOMContentLoaded', function() {
      // Logic khởi tạo flatpickr
      flatpickr("#ngay_nghi", {
        mode: "multiple",
        dateFormat: "Y-m-d",
      });

      const inputField = document.getElementById('ghi_chu');
      inputField.addEventListener('input', function() {
        inputField.value = capitalizeFirstLetter(inputField.value);
      });

      fpNgayLamDB = flatpickr("#ngay_lam_db", {
        dateFormat: "Y-m-d",
        maxDate: "today",
        allowInput: true,
        disableMobile: "true",
        clickOpens: false
      });

      const ngayLamDBInput = document.getElementById("ngay_lam_db");
      ngayLamDBInput.addEventListener("click", async function (e) {
        e.preventDefault();
        const isVerified = await promptForReAuth();
        if (isVerified) {
          fpNgayLamDB.open();
        } else {
          ngayLamDBInput.blur();
        }
      });
    });

    // Logic xem trước hình ảnh (Tương tự index.html)
    const fileInput = document.getElementById('file_2');
    const customFileBtn = document.getElementById('customFileBtn_2');
    const customFileName = document.getElementById('customFileName_2');
    let currentImageBase64 = null;

    if (fileInput && customFileBtn && customFileName) {
        // Kích hoạt input file khi nhấn nút Chọn tệp
        customFileBtn.addEventListener('click', function() {
            fileInput.click();
        });

        fileInput.addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    currentImageBase64 = e.target.result;
                    // Cập nhật giao diện khi có file
                    customFileName.textContent = file.name;
                    customFileName.style.color = "#007bff";
                    customFileName.style.fontStyle = "normal";
                    customFileName.style.fontWeight = "bold";
                    customFileName.style.textDecoration = "underline";
                    customFileName.style.cursor = "pointer";
                    customFileName.title = "Nhấn để xem ảnh lớn";
                }
                reader.readAsDataURL(file);
            } else {
                // Reset về trạng thái ban đầu
                currentImageBase64 = null;
                customFileName.textContent = "Không có tệp nào được chọn";
                customFileName.style.color = "#666";
                customFileName.style.fontStyle = "italic";
                customFileName.style.fontWeight = "normal";
                customFileName.style.textDecoration = "none";
                customFileName.style.cursor = "default";
                customFileName.title = "";
            }
        });

        // Sự kiện click vào tên file để xem ảnh
        customFileName.addEventListener('click', function() {
                if (currentImageBase64) {
                    Swal.fire({
                        imageUrl: currentImageBase64,
                        imageAlt: 'Xem trước hình ảnh',
                        showCloseButton: true,
                        showConfirmButton: false,
                        width: 'auto',
                        padding: '10px',
                        backdrop: `rgba(0,0,0,0.8)`
                    });
                }
        });
    }

    // Tự động xóa preview sau khi gửi thành công (khi form được reset)
    const originalSubmitForm = window.submitForm;
    if (originalSubmitForm) {
        window.submitForm = async function(e, formId, collectionName, folderId) {
            await originalSubmitForm(e, formId, collectionName, folderId);
            // Nếu form đã được reset (file input rỗng), xóa preview
            if (fileInput && fileInput.files.length === 0) {
                currentImageBase64 = null;
                if (customFileName) {
                    customFileName.textContent = "Không có tệp nào được chọn";
                    customFileName.style.color = "#666";
                    customFileName.style.fontStyle = "italic";
                    customFileName.style.fontWeight = "normal";
                    customFileName.style.textDecoration = "none";
                    customFileName.style.cursor = "default";
                    customFileName.title = "";
                }
            }
        };
    }
    // ================== CHECK ADMIN ==================
    onAuth(async (user) => {
      console.log("onAuth callback:", user);
      // Logic check admin
      if (!user) {
        userRole = null;
        loggedInUserEmail = null;   // <--- reset khi chưa login
        return;
      }
      try { userRole = await getRole(user.email); }
      catch(e){ userRole = null; }

      loggedInUserEmail = user.email;  // <--- lưu lại email user đang đăng nhập
    });