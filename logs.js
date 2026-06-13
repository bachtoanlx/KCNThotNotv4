import { initMenu } from "./menu.js";
    import { db, onAuth, getRole } from "./script.js";
    import {
      collection,
      query,
      orderBy,
      where,
      onSnapshot,
      getDocs,
      limit,
      startAfter
    } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

    // Load menu
    fetch("menu.html")
      .then(r => r.text())
      .then(h => {
        document.getElementById("menu-placeholder").innerHTML = h;
        initMenu();
      });

    // Load footer
    fetch("footer.html").then(r => r.text()).then(h => {
        document.getElementById("footer-placeholder").innerHTML = h;
    });

  const notLogged = document.getElementById("notLogged");
  const noPermission = document.getElementById("noPermission");
  const content = document.getElementById("pageContent");
  const tbody = document.querySelector("#logsTable tbody");
  const searchInput = document.getElementById("searchInput");
  const startDateInput = document.getElementById('startDateInput');
  const endDateInput = document.getElementById('endDateInput');
  const actionFilter = document.getElementById('actionFilter');
  const userFilter = document.getElementById('userFilter');
  const toggleFilterBtn = document.getElementById('toggleFilterBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  let rawLogs = []; // Dữ liệu thô từ Firestore (theo ngày)
  let allLogs = []; 
  let unsubscribeLogs = null; // store current onSnapshot unsubscribe fn
  let highlightTimeout = null; // Biến debounce cho highlight
  
  let lastDoc = null; // Lưu vị trí bản ghi cuối cùng để phân trang
  const LIMIT_PER_PAGE = 15; // Số lượng tải mỗi lần cuộn
  let isFetching = false; // Khóa để tránh tải trùng lặp
  let autoLoadCount = 0; // Bộ đếm số lần tự động cuộn
  const MAX_AUTO_LOADS = 5; // Cuộn tự động tối đa 5 lần (75 dòng) trước khi yêu cầu click thủ công

    const filterAndRenderLogs = (logs, query) => {
        const lowerCaseQuery = query.toLowerCase().trim();
        const filteredLogs = logs.filter(log => {
            const searchContent = [
                log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString() : "",
                log.email,
                log.action,
                log.company,
                log.chi_so,
                log.ngay_ghi,
                log.ghi_chu,
                log.fileId,
                log.error_code,
                log.userAgent,
                log.job,
                log.note,
                log.displayName,
                log.user, 
                log.deletedRule?.job,
                log.deletedJob?.job,
                log.deletedPattern?.displayName,
                log.updateData?.job,
                log.updateData?.displayName,
                log.targetName,
                log.changes ? Object.values(log.changes).map(c => `${c.label} ${c.old} ${c.new}`).join(" ") : ""
            ].map(field => field ? field.toString().toLowerCase() : "").join(" ");
            
            return searchContent.includes(lowerCaseQuery);
        });
        
        let finalData = filteredLogs;

          tbody.innerHTML = "";

          // Xóa timeout cũ nếu có (debounce)
          if (highlightTimeout) {
              clearTimeout(highlightTimeout);
              highlightTimeout = null;
          }
          // Xóa class highlight cũ nếu đang chạy dở
          document.querySelectorAll('.highlight-area').forEach(el => el.classList.remove('highlight-area'));
          
          if (finalData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="4" style="text-align: center; color: #cc0000; font-style: italic; padding: 20px;">
                Dữ liệu đang tìm không có hoặc nằm ngoài vùng hiển thị, hãy điều chỉnh để có kết quả tìm chính xác hơn.
            </td>`;
            tbody.appendChild(tr);
            
            // Hiệu ứng nhắc nhở người dùng
            highlightTimeout = setTimeout(() => {
                const filterBox = document.querySelector('.filter-box');
                if (filterBox) {
                    filterBox.classList.add('highlight-area');
                    setTimeout(() => {
                        filterBox.classList.remove('highlight-area');
                        if (loadMoreBtn) {
                            loadMoreBtn.classList.add('highlight-area');
                            setTimeout(() => loadMoreBtn.classList.remove('highlight-area'), 2000);
                        }
                    }, 2000);
                }
            }, 1500); // Đợi 1.5s sau khi dừng gõ mới nháy
            return;
          }

          finalData.forEach(log => {
            const time = log.createdAt?.toDate
                ? log.createdAt.toDate().toLocaleString('vi-VN')
                : "";
            
            // Từ điển chuyển đổi action -> tiếng Việt
            const actionTooltips = {
                // Đăng nhập & Xác thực
                "login_success": "Đăng nhập thành công",
                "login_failure": "Đăng nhập thất bại",
                "logout": "Đăng xuất khỏi hệ thống",
                "logout_success": "Đăng xuất thành công",
                "auto_logout_inactivity": "Tự động đăng xuất (Không hoạt động)",

                // Quản lý quy tắc công việc
                "admin_create_work_rule": "Admin tạo quy tắc công việc mới",
                "admin_update_work_rule": "Admin cập nhật quy tắc công việc",
                "admin_delete_work_rule": "Admin xóa quy tắc công việc",
                "admin_create_manual_job": "Admin tạo công việc thủ công",
                "admin_update_manual_job": "Admin cập nhật công việc thủ công",
                "admin_delete_manual_job": "Admin xóa công việc thủ công",
                "admin_create_work_pattern": "Admin tạo mẫu lịch làm việc",
                "admin_update_work_pattern": "Admin cập nhật mẫu lịch làm việc",
                "admin_delete_work_pattern": "Admin xóa mẫu lịch làm việc",
                "apps_script_add_user_success": "Thêm người dùng qua Apps Script thành công",

                // Báo cáo ca trực - Thao tác chính
                "report_create_success": "Tạo báo cáo ca trực mới thành công",
                "report_update_success": "Cập nhật báo cáo ca trực thành công",
                "report_save_failure": "Lỗi khi lưu báo cáo ca trực",
                "report_view_existing": "Xem báo cáo ca trực hiện có",
                "report_edit_initiated": "Bắt đầu chỉnh sửa báo cáo ca trực",

                // Báo cáo ca trực - Quản lý file
                "report_upload_success": "Tải lên file đính kèm thành công",
                "report_upload_failure": "Lỗi khi tải lên file đính kèm",
                "report_delete_success": "Xóa file đính kèm thành công",
                "report_delete_failure": "Lỗi khi xóa file đính kèm",
                "file_creation_success": "Tạo file HTML thành công",
                "file_creation_failure": "Lỗi khi tạo file HTML",
                "file_creation_connection_error": "Lỗi kết nối khi tạo file HTML",

                // Quản lý ca làm việc
                "admin_create_shift_success": "Admin tạo ca làm việc mới thành công",
                "admin_create_shift_failure": "Lỗi khi Admin tạo ca làm việc mới",
                "admin_delete_shift_success": "Admin xóa ca làm việc thành công",
                "admin_delete_shift_failure": "Lỗi khi Admin xóa ca làm việc",

                // Quản lý hoán đổi ca
                "admin_create_shift_swap": "Admin tạo hoán đổi ca",
                "admin_update_shift_swap": "Admin cập nhật hoán đổi ca",
                "admin_delete_shift_swap": "Admin xóa hoán đổi ca",

                // Quản lý dữ liệu chỉ số
                "indicator_entry": "Nhập liệu chỉ số mới",
                "indicator_edit": "Chỉnh sửa chỉ số",
                "indicator_delete": "Xóa chỉ số",

                // Quản lý file & tài liệu
                "file_upload": "Tải lên file mới",
                "file_download": "Tải xuống file",
                "file_delete": "Xóa file",
                "file_rename": "Đổi tên file",
                
                // Quản lý người dùng
                "user_role_update": "Cập nhật quyền người dùng",
                "user_profile_update": "Cập nhật thông tin cá nhân",
                "user_password_change": "Thay đổi mật khẩu",
                "user_disable": "Vô hiệu hóa tài khoản",
                "user_enable": "Kích hoạt tài khoản",

                // Cấu hình hệ thống
                "system_config_update": "Cập nhật cấu hình hệ thống",
                "backup_created": "Tạo bản sao lưu dữ liệu",
                "restore_completed": "Khôi phục dữ liệu từ bản sao lưu"
            };
            
            let details = "";            switch (log.action) {
                case "login_success":
                    details = `Đăng nhập thành công. Thiết bị: ${log.userAgent || "N/A"}`;
                    break;
                case "login_failure":
                    details = `Lỗi đăng nhập: ${log.error_code || "N/A"}. Thiết bị: ${log.userAgent || "N/A"}`;
                    break;
                case "logout":
                case "logout_success":
                    details = `
                        <b>Trạng thái:</b> Thành công<br>
                        <b>Thiết bị:</b> ${log.userAgent || "N/A"}
                    `;
                    break;
                case "auto_logout_inactivity":
                    details = `
                        <b>Lý do:</b> ${log.reason || "Không hoạt động"}<br>
                        <b>Chi tiết:</b> ${log.details || "Hệ thống tự động đăng xuất do quá thời gian quy định"}<br>
                        <b>Thiết bị:</b> ${log.userAgent || "N/A"}
                    `;
                    break;
                case "admin_create_work_rule":
                    details = `
                        <b>Công việc:</b> ${log.job || "N/A"}<br>
                        <b>Ngày cụ thể:</b> ${log.date || "-"}<br>
                        <b>Ghi chú:</b> ${log.note || "-"}
                    `;
                    break;
                case "admin_update_work_rule":
                case "admin_update_manual_job":
                case "admin_update_work_pattern":
                case "admin_update_shift_swap":
                    const changesObj = log.changes || {};
                    let changesHtml = Object.values(changesObj).map(c => {
                        let oldV = c.old;
                        let newV = c.new;
                        if(Array.isArray(oldV)) oldV = oldV.join(", ");
                        if(Array.isArray(newV)) newV = newV.join(", ");
                        return `<b>${c.label}:</b> <s>${oldV || "<i>Trống</i>"}</s> &rarr; <span style="color: green;">${newV || "<i>Trống</i>"}</span>`;
                    }).join("<br>");
                    
                    const targetName = log.targetName || log.updateData?.job || log.updateData?.displayName || "N/A";
                    details = `<b>Cập nhật:</b> ${targetName}<br>${changesHtml || "<i>Không có thay đổi nào</i>"}`;
                    break;
                case "admin_delete_work_rule":
                    details = `Đã xóa quy tắc: <b>${log.deletedRule?.job || "N/A"}</b>`;
                    break;
                case "admin_create_manual_job":
                    details = `
                        <b>Công việc:</b> ${log.job || "N/A"}<br>
                        <b>Ngày:</b> ${log.date || "N/A"}<br>
                        <b>Ghi chú:</b> ${log.note || "-"}
                    `;
                    break;
                case "admin_delete_manual_job":
                    details = `Đã xóa công việc thủ công: <b>${log.deletedJob?.job || "N/A"}</b>`;
                    break;
                case "admin_create_work_pattern":
                    details = `
                        <b>Tên hiển thị:</b> ${log.displayName || "N/A"}<br>
                        <b>Nhân viên:</b> ${log.user || "N/A"}<br>
                        <b>Loại:</b> ${log.type || "N/A"}<br>
                        <b>Ngày BĐ:</b> ${log.patternStartDate || "N/A"}
                    `;
                    break;
                case "admin_delete_work_pattern":
                    details = `Đã xóa quy tắc của: <b>${log.deletedPattern?.displayName || "N/A"}</b>`;
                    break;
                case "apps_script_add_user_success":
                    details = `Gửi yêu cầu Apps Script thành công cho: <b>${log.targetUser || "N/A"}</b>`;
                    break;
                // ⭐️⭐️⭐️ BẮT ĐẦU KHỐI CODE CẦN DÁN ⭐️⭐️⭐️

                // --- BÁO CÁO CA TRỰC (HÀNH ĐỘNG) ---
                case "report_create_success":
                case "report_update_success":
                    details = `
                        <b>ReportID:</b> ${log.reportId || "N/A"}<br>
                        <b>Ngày:</b> ${log.date || "N/A"}<br>
                        <b>Ca:</b> ${log.shift || "N/A"}<br>
                        <b>Người nhận ca:</b> ${log.receivingStaff ? log.receivingStaff.join(', ') : "N/A"}
                    `;
                    break;
                case "report_save_failure":
                    details = `
                        <b>ReportID:</b> ${log.reportId || "N/A"}<br>
                        <b style="color:red;">Lỗi:</b> ${log.error || "N/A"}<br>
                        <b>Có file mới:</b> ${log.hasNewFiles ? "Có" : "Không"}
                    `;
                    break;
                case "report_view_existing":
                case "report_edit_initiated":
                    details = `
                        <b>ReportID:</b> ${log.reportId || "N/A"}<br>
                        <b>Ngày:</b> ${log.date || "N/A"}<br>
                        <b>Ca:</b> ${log.shift || "N/A"}
                    `;
                    break;

                // --- BÁO CÁO CA TRỰC (QUẢN LÝ FILE) ---
                case "report_upload_success":
                    details = `
                        <b>File:</b> ${log.file || "N/A"}<br>
                        <b>FileID:</b> ${log.fileId || "N/A"}
                    `;
                    break;
                case "report_upload_failure":
                    details = `
                        <b>File:</b> ${log.file || "N/A"}<br>
                        <b style="color:red;">Lỗi:</b> ${log.error || "N/A"}
                    `;
                    break;
                case "report_delete_success":
                    details = `<b>Đã xóa FileID:</b> ${log.fileId || "N/A"}`;
                    break;
                case "report_delete_failure":
                    details = `
                        <b>FileID:</b> ${log.fileId || "N/A"}<br>
                        <b style="color:red;">Lỗi xóa:</b> ${log.error || "N/A"}
                    `;
                    break;
                case "file_creation_success":
                    details = `
                        <b>ReportID:</b> ${log.reportId || "N/A"}<br>
                        <b>FileID (HTML):</b> ${log.fileId || "N/A"}
                    `;
                    break;
                case "file_creation_failure":
                case "file_creation_connection_error":
                     details = `
                        <b>ReportID:</b> ${log.reportId || "N/A"}<br>
                        <b style="color:red;">Lỗi tạo file HTML:</b> ${log.error || "N/A"}
                    `;
                    break;

                // --- ADMIN QUẢN LÝ CA ---
                case "admin_create_shift_success":
                    details = `
                        <b>ShiftID:</b> ${log.shiftId || "N/A"}<br>
                        <b>Tên ca:</b> ${log.shiftName || "N/A"}<br>
                        <b>Thời gian:</b> ${log.time || "N/A"}
                    `;
                    break;
                case "admin_create_shift_failure":
                    details = `
                        <b>Tên ca:</b> ${log.shiftName || "N/A"}<br>
                        <b style="color:red;">Lỗi:</b> ${log.error || "N/A"}
                    `;
                    break;
                case "admin_delete_shift_success":
                    details = `
                    <b>ShiftID:</b> ${log.shiftId || "N/A"}<br>    
                    <b>Đã xóa ca:</b> ${log.shiftName || "N/A"}<br>  
                    <b>Thời gian:</b> ${log.time || "N/A"}    
                    `;
                    break;
                case "admin_delete_shift_failure":
                    details = `
                    <b>ShiftID:</b> ${log.shiftId || "N/A"}<br>    
                    <b>Tên ca:</b> ${log.shiftName || "N/A"}<br>   
                    <b style="color:red;">Lỗi:</b> ${log.error || "N/A"}
                    `;
                    break;

                case "admin_create_shift_swap":
                    details = `
                        <b>Ngày đổi:</b> ${log.date ? log.date.split('-').reverse().join('/') : "N/A"}<br>
                        <b>Người xin nghỉ (A):</b> ${log.user1 || "N/A"}<br>
                        <b>Người làm thay (B):</b> ${log.user2 || "N/A"}<br>
                        <b>Lý do:</b> ${log.reason || "-"}
                    `;
                    break;

                case "admin_delete_shift_swap":
                    details = `
                        <b>Xóa hoán đổi ngày:</b> ${log.date ? log.date.split('-').reverse().join('/') : "N/A"}<br>
                        <b>Người xin nghỉ (A):</b> ${log.user1 || "N/A"}<br>
                        <b>Người làm thay (B):</b> ${log.user2 || "N/A"}
                    `;
                    break;

                default:
                    details = `
                        ${log.details ? "<b>Chi tiết:</b> " + log.details + "<br>" : ""}
                        ${log.company ? "<b>Cty:</b> " + log.company + "<br>" : ""}
                        ${log.chi_so ? "<b>Chỉ số:</b> " + log.chi_so + "<br>" : ""}
                        ${log.ngay_ghi ? "<b>Ngày ghi:</b> " + log.ngay_ghi + "<br>" : ""}
                        ${log.ghi_chu ? "<b>Nội dung:</b> " + log.ghi_chu + "<br>" : ""}
                        ${log.fileId ? "<b>FileId:</b> " + log.fileId + "<br>" : ""}
                        ${log.fileUrl ? `<a href="${log.fileUrl}" target="_blank">Xem file</a>` : ""}
                    `;
                    break;
            }

            // Tạo bản xem trước cho bảng (loại bỏ thẻ <br> để hiển thị 1 dòng)
            const previewDetails = details.replace(/<br\s*\/?>/gi, " | ");
            const displayPreview = previewDetails.trim() ? previewDetails : 'Không có chi tiết';
            const displayFull = details.trim() ? details : 'Không có chi tiết';

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${time}</td>
                <td title="${log.email || ""}">${log.email || ""}</td>
                <td title="${actionTooltips[log.action] || log.action || ""}">${log.action || ""}</td>
                <td><div class="log-details-wrapper" title="Nhấn để xem chi tiết">${displayPreview}</div></td>
            `;
            
            // Gắn sự kiện click để xem chi tiết (Accordion style)
            const detailCell = tr.querySelector('.log-details-wrapper');
            if (detailCell) {
                detailCell._fullContent = displayFull;
                detailCell._previewContent = displayPreview;

                detailCell.addEventListener('click', function(e) {
                    const currentDiv = e.currentTarget;
                    const isExpanded = currentDiv.classList.contains('expanded');

                    // 1. Thu gọn tất cả các dòng khác đang mở
                    document.querySelectorAll('.log-details-wrapper.expanded').forEach(div => {
                        if (div !== currentDiv) {
                            div.classList.remove('expanded');
                            div.innerHTML = div._previewContent;
                            div.title = "Nhấn để xem chi tiết";
                        }
                    });

                    // 2. Toggle dòng hiện tại
                    if (isExpanded) {
                        currentDiv.classList.remove('expanded');
                        currentDiv.innerHTML = currentDiv._previewContent;
                        currentDiv.title = "Nhấn để xem chi tiết";
                    } else {
                        currentDiv.classList.add('expanded');
                        currentDiv.innerHTML = currentDiv._fullContent;
                        currentDiv.title = "Nhấn để thu gọn";
                    }
                });
            }
            
            tbody.appendChild(tr);
        });
    };

    onAuth(async user => {
      if (user) {
        const role = await getRole(user.email);
        if (role === "admin") {
            notLogged.style.display = "none";
            noPermission.style.display = "none";
            content.style.display = "flex"; /* Sử dụng flex để layout hoạt động đúng */
          
          // helper: build query based on date inputs
          function buildLogsQuery(isLoadMore = false) {
            const coll = collection(db, "logs");
            const startVal = startDateInput.value;
            const endVal = endDateInput.value;
            const clauses = [];
            
            // Ngày bắt đầu: nếu không có thì lấy 1/1 của năm hiện tại
            const currentYear = new Date().getFullYear();
            const startDate = startVal ? 
              new Date(startVal + 'T00:00:00') : 
              new Date(currentYear, 0, 1, 0, 0, 0); // 1/1 năm hiện tại
            clauses.push(where('createdAt', '>=', startDate));
            
            // Ngày kết thúc: nếu không có thì lấy ngày hiện tại
            const endDate = endVal ? 
              new Date(endVal + 'T23:59:59') : 
              new Date(new Date().setHours(23, 59, 59, 999)); // ngày hiện tại 23:59:59
            clauses.push(where('createdAt', '<=', endDate));
            
            let q = query(coll, ...clauses, orderBy('createdAt', 'desc'), limit(LIMIT_PER_PAGE));
            
            if (isLoadMore && lastDoc) {
                q = query(q, startAfter(lastDoc));
            }
            return q;
          }

          // Hàm lấy dữ liệu từ Firestore dựa trên khoảng thời gian
          async function fetchLogsByDate(isLoadMore = false) {
            if (isFetching) return;
            isFetching = true;
            
            // Tự động điền ngày mặc định nếu trống
            if (!startDateInput.value) {
                const currentYear = new Date().getFullYear();
                startDateInput.value = `${currentYear}-01-01`;
            }
            if (!endDateInput.value) {
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                endDateInput.value = `${y}-${m}-${d}`;
            }

            // validate date range
            if (startDateInput.value && endDateInput.value) {
              const s = new Date(startDateInput.value + 'T00:00:00');
              const e = new Date(endDateInput.value + 'T23:59:59');
              if (s > e) {
                Swal.fire('Lỗi', 'Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.', 'error');
                return;
              }
            }

            if (!isLoadMore) {
                lastDoc = null; // Reset con trỏ Firebase nếu đây là đợt tải (lọc) mới
                autoLoadCount = 0; // Reset lại bộ đếm cuộn tự động
            }

            if (loadMoreBtn && isLoadMore) {
                loadMoreBtn.textContent = "⏳ Đang tải...";
            }

            try {
                const q = buildLogsQuery(isLoadMore);
                const snapshot = await getDocs(q);
                
                if (snapshot.empty) {
                    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
                    if (!isLoadMore) {
                        rawLogs = [];
                        populateFilterOptions(rawLogs);
                        applyLocalFilters();
                    }
                    return;
                }

                // Lưu document cuối cùng làm mốc (cursor) cho lần tải sau
                lastDoc = snapshot.docs[snapshot.docs.length - 1];
                const newLogs = snapshot.docs.map(doc => ({...doc.data(), id: doc.id }));
                
                if (isLoadMore) {
                    rawLogs = [...rawLogs, ...newLogs]; // Nối mảng
                } else {
                    rawLogs = newLogs; // Tải mới
                }
                
                if (loadMoreBtn) {
                    loadMoreBtn.style.background = "var(--primary-color)"; // Reset màu gốc
                    if (snapshot.docs.length < LIMIT_PER_PAGE) {
                        loadMoreBtn.style.display = 'none'; // Hết dữ liệu thì ẩn nút
                    } else {
                        loadMoreBtn.style.display = 'inline-block';
                        loadMoreBtn.textContent = "⬇️ Cuộn để tải thêm...";
                    }
                }
                
                populateFilterOptions(rawLogs);
                applyLocalFilters();
            } catch (err) {
                console.error("Lỗi khi tải log:", err);
                Swal.fire('Lỗi', 'Không thể tải nhật ký.', 'error');
            } finally {
                isFetching = false; // Mở khóa
            }
          }

          // Hàm lọc client-side (Action, User) và render
          function applyLocalFilters() {
            let filteredLogs = rawLogs;
            const actionVal = actionFilter ? actionFilter.value : '';
            const userVal = userFilter ? userFilter.value : '';
            
            const isManualFilter = actionVal !== '' || userVal !== '' || startDateInput.value !== '' || endDateInput.value !== '';

            if (toggleFilterBtn) {
                if (isManualFilter) {
                    toggleFilterBtn.textContent = 'Bỏ lọc';
                    toggleFilterBtn.style.background = '#6c757d'; // Grey
                } else {
                    toggleFilterBtn.textContent = 'Áp dụng';
                    toggleFilterBtn.style.background = '#3498db'; // Blue
                }
            }

            if (actionVal) {
                filteredLogs = filteredLogs.filter(l => l.action === actionVal);
            }
            if (userVal) {
                filteredLogs = filteredLogs.filter(l => l.email === userVal);
            }
            
            allLogs = filteredLogs;
            filterAndRenderLogs(allLogs, searchInput.value);
          }

          // ⭐️ initial listener - Gọi async function đúng cách
          (async () => {
            await fetchLogsByDate(false);
          })();

          // Populate selects helper (unique actions and emails)
          function populateFilterOptions(logs) {
            if (!Array.isArray(logs)) return;
            const actions = new Set();
            const users = new Set();
            logs.forEach(l => {
              if (l.action) actions.add(l.action);
              if (l.email) users.add(l.email);
            });
            // clear existing but keep empty option
            if (actionFilter) {
              const prev = actionFilter.value;
              actionFilter.innerHTML = '<option value="">--Tất cả--</option>' + Array.from(actions).sort().map(a => `<option value="${a}">${a}</option>`).join('');
              if (Array.from(actions).includes(prev)) actionFilter.value = prev;
            }
            if (userFilter) {
              const prevU = userFilter.value;
              userFilter.innerHTML = '<option value="">--Tất cả--</option>' + Array.from(users).sort().map(u => `<option value="${u}">${u}</option>`).join('');
              if (Array.from(users).includes(prevU)) userFilter.value = prevU;
            }
          }
          
          // Sự kiện thay đổi ngày -> Fetch lại dữ liệu Firestore
          startDateInput.addEventListener('change', () => fetchLogsByDate(false));
          endDateInput.addEventListener('change', () => fetchLogsByDate(false));

          // Sự kiện thay đổi bộ lọc -> Lọc local ngay lập tức
          actionFilter.addEventListener('change', applyLocalFilters);
          userFilter.addEventListener('change', applyLocalFilters);
          
          // Sự kiện nút Áp dụng / Bỏ lọc
          if (toggleFilterBtn) {
              toggleFilterBtn.addEventListener('click', () => {
                  if (toggleFilterBtn.textContent === 'Bỏ lọc') {
                      actionFilter.value = '';
                      userFilter.value = '';
                      startDateInput.value = '';
                      endDateInput.value = '';
                      // Reset về tải ban đầu
                      fetchLogsByDate(false);
                  } else {
                      fetchLogsByDate(false);
                  }
              });
          }

          // Note: selects (action/user) do NOT auto-apply; user must click Áp dụng to activate filters.

          searchInput.addEventListener("input", () => {
            filterAndRenderLogs(allLogs, searchInput.value);
          });

          // MỚI: Xử lý click nút tải thêm (phòng khi Intersection Observer không nhạy)
          if (loadMoreBtn) {
              loadMoreBtn.addEventListener('click', () => {
                  autoLoadCount = 0; // Reset lại bộ đếm, cấp "quota" cho 5 lần cuộn tự động tiếp theo
                  loadMoreBtn.style.background = "var(--primary-color)";
                  fetchLogsByDate(true);
              });
          }

          // MỚI: Intersection Observer cho Infinite Scroll (Cuộn tới đâu tải tới đó)
          if (loadMoreBtn) {
              const handleIntersection = (entries) => {
                  // Nếu nút xuất hiện trên màn hình và không phải đang tải dở
                  if (entries[0].isIntersecting && !isFetching && loadMoreBtn.style.display !== 'none') {
                      if (autoLoadCount < MAX_AUTO_LOADS) {
                          autoLoadCount++;
                          fetchLogsByDate(true); // Gửi cờ 'true' để nối thêm data
                      } else {
                          loadMoreBtn.textContent = "⚠️ Bạn đã xem khá nhiều. Bấm để tải tiếp...";
                          loadMoreBtn.style.background = "#d35400"; // Đổi sang màu cam cảnh báo
                      }
                  }
              };
              
              // Theo dõi cuộn trong vùng chứa bảng (Desktop)
              const observer = new IntersectionObserver(handleIntersection, { root: document.querySelector('.table-container'), rootMargin: "100px", threshold: 0.1 });
              observer.observe(loadMoreBtn);
              
              // Theo dõi cuộn toàn trang (Mobile)
              const windowObserver = new IntersectionObserver(handleIntersection, { root: null, rootMargin: "100px", threshold: 0.1 });
              windowObserver.observe(loadMoreBtn);
          }

        } else {
            notLogged.style.display = "none";
            noPermission.style.display = "flex";
            content.style.display = "none";
        }
      } else {
          notLogged.style.display = "flex";
          noPermission.style.display = "none";
          content.style.display = "none";
      }
    });