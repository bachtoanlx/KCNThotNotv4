import { onAuth, getRole, addReport, showLoading, hideLoading, showSwal, showConfirmSwal, db, loadCompanyDropdown, loadTemplate } from "./script.js";
    import { initMenu } from "./menu.js";
    import { collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

    // load menu
    loadTemplate("menu-placeholder", "menu.html", () => {
      initMenu();
    });
    // load modal 
    loadTemplate("loading-placeholder", "modal.html");
    // TẢI FOOTER (thêm đoạn này vào)
    loadTemplate("footer-placeholder", "footer.html");


    const notLogged = document.getElementById("notLogged");
    const content = document.getElementById("pageContent");

    // kiểm tra trạng thái đăng nhập
    onAuth(user => {
      if (user) {
        notLogged.style.display = "none";
        content.style.display = "flex";
        // Tự động tải danh sách công ty (Chỉ lấy nhóm Đồng hồ - group1)
        loadCompanyDropdown('c_ty', 'group1');
      } else {
        notLogged.style.display = "flex";
        content.style.display = "none";
      }
    });

    // HÀM LẤY NGÀY HIỆN TẠI DƯỚI DẠNG CHUỖI YYYY-MM-DD
    function getCurrentDate() {
        var today = new Date();
        var year = today.getFullYear();
        var month = ('0' + (today.getMonth() + 1)).slice(-2);
        var day = ('0' + today.getDate()).slice(-2);
        return year + '-' + month + '-' + day;
    }
    
    // HÀM ĐẶT NGÀY HIỆN TẠI LÀ NGÀY MẶC ĐỊNH
    function setDefaultDateForNgayGhi() {
        var ngayGhiInput = document.getElementById('ngay_ghi');
        ngayGhiInput.value = getCurrentDate();
    }
    
    function setMaxDateForNgayGhi() {
        var ngayGhiInput = document.getElementById('ngay_ghi');
        ngayGhiInput.setAttribute('max', getCurrentDate());
    }
    
    document.addEventListener('DOMContentLoaded', function() {
        setDefaultDateForNgayGhi();
        setMaxDateForNgayGhi();
    });

    // ĐỊNH NGHĨA HÀM ĐỂ VIẾT HOA CHỮ CÁI ĐẦU CỦA CHUỖI
    function capitalizeFirstLetter(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    document.addEventListener('DOMContentLoaded', function() {
        var inputField = document.getElementById('ghi_chu');
        inputField.addEventListener('input', function() {
            var inputValue = inputField.value;
            var capitalizedValue = capitalizeFirstLetter(inputValue);
            inputField.value = capitalizedValue;
        });
    });

    // Logic hiển thị chỉ số cũ khi chọn công ty
    const companySelect = document.getElementById('c_ty');
    const oldIndexInput = document.getElementById('chi_so_cu');

    if (companySelect && oldIndexInput) {
        companySelect.addEventListener('change', async function() {
            const companyName = this.value;
            if (!companyName) return;

            oldIndexInput.value = "Đang tải...";
            
            try {
                const q = query(
                    collection(db, "reports_1"),
                    where("company", "==", companyName),
                    where("ngay_ghi", "<=", getCurrentDate()),
                    orderBy("ngay_ghi", "desc"),
                    orderBy("createdAt", "desc"),
                    limit(1)
                );
                const snapshot = await getDocs(q);
                
                if (!snapshot.empty) {
                    const data = snapshot.docs[0].data();
                    const val = data.chi_so;
                    const dateStr = data.ngay_ghi;
                    let displayVal = (val !== undefined && val !== null) ? new Intl.NumberFormat("de-DE").format(val) : "0";
                    
                    if (dateStr) {
                        const [y, m, d] = dateStr.split('-');
                        if (y && m && d) displayVal += ` ngày ${d}/${m}/${y}`;
                    }
                    oldIndexInput.value = displayVal;
                } else {
                    oldIndexInput.value = "Chưa có dữ liệu";
                }
            } catch (error) {
                console.error("Lỗi lấy chỉ số cũ:", error);
                oldIndexInput.value = "Lỗi tải";
            }
        });
    }

    // Logic xem trước hình ảnh
    const fileInput = document.getElementById('file');
    const customFileBtn = document.getElementById('customFileBtn');
    const customFileName = document.getElementById('customFileName');
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

// Dấu phân cách phần ngàn và kiểm tra dữ liệu 
    document.getElementById("chi_so").addEventListener("input", function (event) {
        const input = event.target;
        
        // Loại bỏ tất cả ký tự không phải số và dấu chấm, dấu phẩy
        const rawValue = input.value.replace(/[^0-9.,]/g, '');
        
        // Dùng biểu thức chính quy để kiểm tra có phải chỉ là số và dấu chấm không
        if (!/^[0-9.]*$/.test(rawValue)) {
            input.setCustomValidity("Vui lòng chỉ nhập số.");
        } else {
            input.setCustomValidity("");
        }
        
        // Hiển thị thông báo lỗi ngay lập tức
        input.reportValidity();
        
        const onlyDigits = rawValue.replace(/[^0-9]/g, '');

        if (onlyDigits === "") {
            input.value = "";
        } else {
            const formattedValue = new Intl.NumberFormat("de-DE").format(onlyDigits);
            
            const oldLength = input.value.length;
            const cursorPosition = input.selectionStart;
            input.value = formattedValue;
            const newLength = formattedValue.length;
            input.setSelectionRange(cursorPosition + (newLength - oldLength), cursorPosition + (newLength - oldLength));
        }
    });