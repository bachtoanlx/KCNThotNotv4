import { initMenu } from "./menu.js";
    import { db, onAuth, getRole, showSwal, fetchAllUsers } from "./script.js";
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
    import { saveToLocalDB, getAllFromLocalDB, setLastSyncTime, getLastSyncTime, deleteFromLocalDB } from "./localDB.js";

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

  // Từ điển chuyển đổi action -> tiếng Việt (Sử dụng toàn cục)
  const actionTooltips = {
      // Đăng nhập & Xác thực
      "login_success": "Đăng nhập",
      "login_failure": "Lỗi đăng nhập",
      "logout": "Đăng xuất",
      "logout_success": "Đăng xuất",
      "auto_logout_inactivity": "Đăng xuất tự động",
      "force_logout_requested": "Ép đăng xuất",
      "forced_logout_executed": "Bị ép đăng xuất",
      "reAuth_dismissed": "Hủy xác nhận lại mật khẩu",
      "reAuth_success": "Xác thực lại thành công",
      "reAuth_failure": "Lỗi xác thực lại",

      // Quản lý quy tắc công việc
      "admin_create_work_rule": "Thêm công việc",
      "admin_update_work_rule": "Sửa công việc",
      "admin_delete_work_rule": "Xóa công việc",
      "admin_create_manual_job": "Thêm việc thủ công",
      "admin_update_manual_job": "Sửa việc thủ công",
      "admin_delete_manual_job": "Xóa việc thủ công",
      "admin_create_work_pattern": "Thêm lịch phân ca",
      "admin_update_work_pattern": "Sửa lịch phân ca",
      "admin_delete_work_pattern": "Xóa lịch phân ca",
      "apps_script_add_user_success": "Thêm User (GAS)",

      // Báo cáo ca trực - Thao tác chính
      "report_create_success": "Gửi báo cáo ca",
      "report_update_success": "Sửa báo cáo ca",
      "report_save_failure": "Lỗi lưu BC ca",
      "report_view_existing": "Xem báo cáo ca",
      "report_edit_initiated": "Mở sửa BC ca",
      "report_skipped_exact_match": "Bỏ qua BC trùng",
      "form_submit_canceled": "Hủy gửi báo cáo",
      "form_submit_fatal_error": "Lỗi nghiêm trọng (BC)",
      "form_unknown_id": "Lỗi form không hợp lệ",
      "form2_validation_error": "Lỗi xác thực (Nghỉ/Làm ĐB)",

      // Ghi đè / Thêm mới
      "add_sameday_error": "Lỗi thêm BC (cùng ngày)",
      "overwrite_sameday_error": "Lỗi ghi đè BC (cùng ngày)",
      "overwrite_error": "Lỗi ghi đè BC",
      "overwrite_skipped": "Bỏ qua ghi đè BC",
      "overwrite_success": "Ghi đè BC thành công",
      "updateFile": "Cập nhật file đính kèm",
      "updateReport": "Cập nhật báo cáo",

      // Báo cáo ca trực - Quản lý file
      "report_upload_success": "Tải lên file (BC)",
      "report_upload_failure": "Lỗi tải file (BC)",
      "report_delete_success": "Xóa file (BC)",
      "report_delete_failure": "Lỗi xóa file (BC)",
      "file_creation_success": "Tạo HTML lưu trữ",
      "file_creation_failure": "Lỗi tạo HTML",
      "file_creation_connection_error": "Lỗi kết nối GAS",
      "file_size_error": "Lỗi dung lượng file",
      "drive_upload_success": "Tải lên Drive thành công",
      "drive_upload_failure": "Lỗi tải lên Drive",
      "drive_delete_failure": "Lỗi xóa file Drive",
      "drive_delete_success": "Xóa file Drive",
      "drive_delete_unauthorized": "Lỗi xóa Drive (Không quyền)",
      "drive_cleanup_success": "Dọn dẹp Drive",
      "drive_cleanup_fail": "Lỗi dọn Drive",

      // Thao tác Database cấp thấp
      "addDoc_failure": "Lỗi ghi Database",
      "addDoc_success": "Ghi Database thành công",
      "addDoc_unauthorized": "Lỗi DB (Không quyền)",
      "getReportsByDate_failure": "Lỗi tải dữ liệu ngày",

      // Quản lý ca làm việc
      "admin_create_shift_success": "Thêm ca trực",
      "admin_create_shift_failure": "Lỗi thêm ca",
      "admin_delete_shift_success": "Xóa ca trực",
      "admin_delete_shift_failure": "Lỗi xóa ca",

      // Quản lý hoán đổi ca
      "admin_create_shift_swap": "Thêm đổi ca",
      "admin_update_shift_swap": "Sửa đổi ca",
      "admin_delete_shift_swap": "Xóa đổi ca",
      "admin_delete_work_rules": "Xóa công việc",
      "admin_delete_work_patterns": "Xóa lịch phân ca",
      "admin_delete_shift_swaps": "Xóa đổi ca",

      // Quản lý dữ liệu chỉ số
      "indicator_entry": "Nhập mốc chỉ số",
      "indicator_edit": "Sửa chỉ số",
      "indicator_delete": "Xóa chỉ số",
      "deleteReport": "Xóa BC chỉ số",
      "deleteReport_failure": "Lỗi xóa BC số",
      "deleteReport_not_found": "Không thấy BC số",
      "deleteReport_file_skipped": "Bỏ qua xóa file (số)",

      // Đồng hồ nước
      "meter_reset_confirmed": "Xác nhận đổi ĐH",
      "meter_reset_canceled": "Hủy báo cáo đổi ĐH",
      "meter_reset_canceled_sameday": "Hủy báo cáo ĐH (Cùng ngày)",
      "duplicate_date_accepted": "Xác nhận gửi đè",

      // Thông báo nghỉ & Đặc biệt
      "form2_submit_success": "Gửi báo cáo nghỉ",
      "form2_submit_partial_error": "Lỗi 1 phần gửi nghỉ",
      "form2_submit_no_dates": "Lỗi gửi nghỉ (Thiếu ngày)",
      "form2_submit_skipped_only": "Bỏ qua gửi nghỉ",
      "form2_special_workday_meaningless": "Bản ghi nghỉ dư",
      "overwrite_manual_holiday_success": "Ghi đè báo cáo nghỉ",
      "overwrite_manual_holiday_error": "Lỗi ghi đè báo cáo nghỉ",
      "overwrite_manual_holiday_skipped": "Bỏ qua ghi đè BC nghỉ",
      "add_holiday_error": "Lỗi thêm ngày nghỉ",

      // Cấu hình hệ thống
      "system_config_update": "Sửa cấu hình HT",
      "backup_created": "Sao lưu dữ liệu",
      "restore_completed": "Khôi phục dữ liệu",

      // Quản lý người dùng & GAS
      "user_role_update": "Phân quyền",
      "add_user_email": "Gửi email User",
      "upload": "Tải lên file (GAS)",
      "delete": "Xóa file (GAS)",
      "create_report_file": "Tạo file lưu trữ (GAS)",
      "hourly_schedule_sent": "Gửi lịch tự động",
      "daily_schedule_failed": "Lỗi gửi lịch tự động"
  };

  let rawLogs = []; // Dữ liệu thô từ Firestore (theo ngày)
  let allLogs = []; 
  let unsubscribeLogs = null; // store current onSnapshot unsubscribe fn
  
  let lastDoc = null; // Lưu vị trí bản ghi cuối cùng để phân trang
  const LIMIT_PER_PAGE = 15; // Số lượng tải mỗi lần cuộn
  let isFetching = false; // Khóa để tránh tải trùng lặp
  let autoLoadCount = 0; // Bộ đếm số lần tự động cuộn
  let globalLoadCount = 0; // MỚI: Đếm tổng số lần cuộn để hiển thị tiến trình liên tục
  const MAX_AUTO_LOADS = 5; // Cuộn tự động tối đa 5 lần (75 dòng) trước khi yêu cầu click thủ công

  // MỚI: State cho Deep Search
  let isDeepSearchMode = false;
  let deepSearchQuery = "";
  let deepSearchCursor = null;
  let deepSearchResults = [];
  
  let searchDebounceTimer = null; // MỚI: Biến hẹn giờ cho chức năng tìm kiếm tự động
  let savedStartDate = ""; // MỚI: Lưu lại ngày bắt đầu trước khi tìm kiếm
  let savedEndDate = ""; // MỚI: Lưu lại ngày kết thúc trước khi tìm kiếm
  let allKnownUsers = new Set(); // MỚI: Lưu tất cả user trong hệ thống
  let patternUsers = new Set(); // MỚI: Lưu user từ lịch làm việc
  let adminUsers = new Set(); // MỚI: Lưu user admin
  let userActionsMap = new Map(); // MỚI: Bản đồ lưu các hành động của từng user
  let allKnownActions = new Set(); // MỚI: Lưu tất cả hành động đã từng xảy ra

  // HÀM MỚI: Chuẩn hóa tiếng Việt không dấu để tìm kiếm thông minh hơn
  function normalizeForSearch(str) {
      if (!str) return "";
      return str.toString().toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/\s*([/-])\s*/g, "$1");
  }

  // Hàm hỗ trợ tạo chuỗi tìm kiếm chuẩn xác cho mỗi log
  function buildLogSearchString(log) {
      const actionLabel = actionTooltips[log.action] || log.action || "";
      const fields = [
          log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString('vi-VN') : "",
          log.email, log.action, actionLabel, log.company, log.chi_so, log.ngay_ghi, log.ghi_chu,
          log.fileId, log.error_code, log.userAgent, log.job, log.note,
          log.displayName, log.user, log.deletedRule?.job, log.deletedJob?.job,
          log.deletedPattern?.displayName, log.updateData?.job, log.updateData?.displayName,
          log.targetName, log.changes ? Object.values(log.changes).map(c => `${c.label} ${c.old} ${c.new}`).join(" ") : "",
          // Bổ sung các trường dữ liệu còn thiếu
          log.date, log.patternStartDate, log.patternEndDate, log.reason, log.details, 
          log.shiftName, log.time, log.user1, log.user2, log.reportId, log.error, log.targetUser,
          log.receivingStaff ? log.receivingStaff.join(', ') : "", log.deletedConfig?.effectiveDate, log.newRole, log.fileUrl, log.file
      ];
            return fields.map(field => {
          if (!field) return "";
          const str = field.toString();
          let variants = "";
          
          // Tìm TẤT CẢ các chuỗi YYYY-MM-DD nằm xen kẽ trong mọi câu văn dài
          const dateMatches = str.match(/(\d{4})-(\d{2})-(\d{2})/g);
          if (dateMatches) {
              dateMatches.forEach(match => {
                  const parts = match.match(/(\d{4})-(\d{2})-(\d{2})/);
                  if (parts) {
                      const y = parts[1], m = parts[2], d = parts[3];
                      const ms = parseInt(m, 10).toString(), ds = parseInt(d, 10).toString();
                      const y2 = y.slice(-2);
                      variants += ` ${d}/${m}/${y} ${d}/${m} ${d}-${m}-${y} ${d}-${m} ${ds}/${ms}/${y} ${ds}/${ms} ${ds}-${ms}-${y} ${ds}-${ms} ${ds}/${m} ${d}/${ms} ${ds}-${m} ${d}-${ms} ${y}/${m}/${d} ${y}/${ms}/${ds} ${y}-${ms}-${ds} ${m}/${y} ${ms}/${y} ${m}-${y} ${ms}-${y} ${m}/${y2} ${ms}/${y2} ${m}-${y2} ${ms}-${y2}`;
                  }
              });
          }
          return normalizeForSearch(str + variants);
      }).join(" ");
  }


  // MỚI: Hàm thực hiện Deep Search
  async function performDeepSearch(queryText, isLoadMore = false) {
      if (isFetching) return;
      isFetching = true;
      
      isDeepSearchMode = true;
      deepSearchQuery = queryText;
      
      try {
          // 1. Đồng bộ Tombstone (Dữ liệu bị xóa)
          const lastSync = await getLastSyncTime("logs");
          if (lastSync > 0) {
              const qDel = query(collection(db, "sync_deletes"), 
                  where("deletedAt", ">", new Date(lastSync))
              );
              const snapDel = await getDocs(qDel);
              if (!snapDel.empty) {
                  const idsToDelete = snapDel.docs
                      .map(d => d.data())
                      .filter(data => data.collectionName === "logs")
                      .map(data => data.docId);
                  if (idsToDelete.length > 0) {
                      await deleteFromLocalDB("logs", idsToDelete);
                  }
              }
          }
          let q;
          if (lastSync === 0) { // Lần đầu tải toàn bộ
              // TỐI ƯU FIREBASE: Chỉ tải tối đa 60 ngày gần nhất cho bộ nhớ đệm (Tránh đốt Quota khi logs phình to)
              const sixtyDaysAgo = new Date();
              sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
              q = query(collection(db, "logs"), where("createdAt", ">=", sixtyDaysAgo), orderBy("createdAt", "desc"));
          } else {
              q = query(collection(db, "logs"), where("createdAt", ">", new Date(lastSync)), orderBy("createdAt", "desc"));
          }
          
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const newLogs = snapshot.docs.map(doc => {
                  const data = doc.data();
                  return {
                      id: doc.id,
                      ...data,
                      // Giữ lại số mili-giây để Serialize xuống IndexedDB
                      _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now()
                  };
              });
              await saveToLocalDB("logs", newLogs);
              await setLastSyncTime("logs", Date.now());
          }

          // 2. Nạp dữ liệu lên RAM và tìm kiếm
          const allLocalLogs = await getAllFromLocalDB("logs");
          allLocalLogs.sort((a, b) => b._createdAtMillis - a._createdAtMillis);
          const parsedLogs = allLocalLogs.map(log => ({
              ...log,
              createdAt: { toDate: () => new Date(log._createdAtMillis) }
          }));

          // 3. Tìm kiếm toàn bộ trên RAM cực nhanh
          const lowerCaseQuery = normalizeForSearch(deepSearchQuery).trim();
          const actionVal = actionFilter ? actionFilter.value : '';
          const userVal = userFilter ? userFilter.value : '';

          deepSearchResults = parsedLogs.filter(log => {
              if (actionVal && log.action !== actionVal) return false;
              if (userVal && log.email !== userVal) return false;
              
              // Chỉ tìm text nếu ô tìm kiếm không trống
              if (lowerCaseQuery !== "") {
                  if (!buildLogSearchString(log).includes(lowerCaseQuery)) return false;
              }
              return true;
          });
          
          // 4. MỚI: Cập nhật và khóa 2 ô thời gian theo khoảng dữ liệu tìm thấy
          if (deepSearchResults.length > 0) {
              const newestDate = deepSearchResults[0].createdAt.toDate();
              const oldestDate = deepSearchResults[deepSearchResults.length - 1].createdAt.toDate();
              
              const formatYMD = (date) => {
                  const y = date.getFullYear();
                  const m = String(date.getMonth() + 1).padStart(2, '0');
                  const d = String(date.getDate()).padStart(2, '0');
                  return `${y}-${m}-${d}`;
              };
              
              if (startDateInput) {
                  startDateInput.value = formatYMD(oldestDate);
                  startDateInput.disabled = true;
                  startDateInput.style.opacity = "0.5";
                  startDateInput.style.cursor = "not-allowed";
              }
              if (endDateInput) {
                  endDateInput.value = formatYMD(newestDate);
                  endDateInput.disabled = true;
                  endDateInput.style.opacity = "0.5";
                  endDateInput.style.cursor = "not-allowed";
              }
          } else {
              // Nếu không có kết quả, vẫn khóa
              if (startDateInput) { startDateInput.disabled = true; startDateInput.style.opacity = "0.5"; startDateInput.style.cursor = "not-allowed"; }
              if (endDateInput) { endDateInput.disabled = true; endDateInput.style.opacity = "0.5"; endDateInput.style.cursor = "not-allowed"; }
          }

          allLogs = deepSearchResults;
          if (loadMoreBtn) loadMoreBtn.style.display = 'none'; // Không cần phân trang thủ công khi đã nạp hết vào RAM
          filterAndRenderLogs(allLogs, deepSearchQuery, true);
          
      } catch (err) {
          console.error("Lỗi tìm kiếm sâu:", err);
          showSwal('error', 'Lỗi tìm kiếm', 'Không thể tìm kiếm dữ liệu lúc này.');
          isDeepSearchMode = false;
      } finally {
          isFetching = false;
      }
  }

    const filterAndRenderLogs = (logs, query, isDeepSearchContext = false) => {
        const lowerCaseQuery = normalizeForSearch(query).trim();
        const filteredLogs = logs.filter(log => {
            return buildLogSearchString(log).includes(lowerCaseQuery);
        });
        
        let finalData = filteredLogs;

          tbody.innerHTML = "";

          if (finalData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="4" style="text-align: center; color: #888; font-style: italic; padding: 20px;">
                Không tìm thấy dữ liệu nào khớp với từ khóa của bạn.
            </td>`;
            tbody.appendChild(tr);
            
            return;
          } else {
            finalData.forEach(log => {
            const time = log.createdAt?.toDate
                ? log.createdAt.toDate().toLocaleString('vi-VN')
                : "";
            
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
                case "reAuth_success":
                    details = `Xác thực lại mật khẩu thành công.`;
                    break;
                case "reAuth_failure":
                    details = `<b style="color:red;">Lỗi xác thực lại:</b> ${log.error || "Sai mật khẩu"}`;
                    break;
                case "reAuth_dismissed":
                    details = `Đã hủy hộp thoại yêu cầu xác thực lại.`;
                    break;
                case "system_config_update":
                    if (log.action_detail === "delete_company_config") {
                        details = `Xóa cấu hình của công ty <b>${log.company || "N/A"}</b> (Ngày áp dụng: ${log.deletedConfig?.effectiveDate || "N/A"})`;
                    } else if (log.action_detail === "save_company_config") {
                        details = `Lưu cấu hình cho công ty <b>${log.company || "N/A"}</b> (Ngày áp dụng: ${log.date || "N/A"})`;
                    } else if (log.action_detail === "delete_master_company") {
                        details = `Xóa công ty <b>${log.company || "N/A"}</b> khỏi hệ thống (Kèm ${log.deletedConfigsCount || 0} cấu hình)`;
                    } else {
                        details = `Cập nhật cấu hình hệ thống: ${log.config ? JSON.stringify(log.config) : ""}`;
                    }
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
                case "admin_delete_work_rules":
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
                case "admin_delete_work_patterns":
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
                case "admin_delete_shift_swaps":
                    details = `
                        <b>Xóa hoán đổi ngày:</b> ${log.date ? log.date.split('-').reverse().join('/') : "N/A"}<br>
                        <b>Người xin nghỉ (A):</b> ${log.user1 || "N/A"}<br>
                        <b>Người làm thay (B):</b> ${log.user2 || "N/A"}
                    `;
                    break;
                case "indicator_entry":
                    details = `
                        <b>Công ty:</b> ${log.company || "N/A"}<br>
                        <b>Ngày:</b> ${log.ngay_ghi || "N/A"}<br>
                        <b>Chỉ số:</b> ${log.chi_so || "N/A"}<br>
                        ${log.action_detail === 'save_baseline' ? '<b>Loại:</b> Cập nhật mốc khởi tạo' : ''}
                    `;
                    break;
                case "deleteReport":
                    details = `
                        <b>Xóa báo cáo ID:</b> ${log.id || "N/A"}<br>
                        <b>Công ty:</b> ${log.company || "N/A"}<br>
                        <b>Ngày:</b> ${log.ngay_ghi || "N/A"}<br>
                        <b>Chỉ số:</b> ${log.chi_so || "N/A"}
                    `;
                    break;
                
                case "user_role_update":
                    details = `<b>Phân quyền:</b> ${log.targetUser || "N/A"} &rarr; <b style="color:#273668;">${log.newRole || "N/A"}</b>`;
                    break;
                case "force_logout_requested":
                    details = `Ép đăng xuất tài khoản: <b>${log.targetUser || "N/A"}</b>`;
                    break;
                case "add_user_email":
                    details = `Gửi email cấp quyền cho: <b>${log.email || "N/A"}</b><br>Chi tiết: ${log.details || ""}`;
                    break;
                case "hourly_schedule_sent":
                    details = `Hệ thống tự động gửi lịch trực.<br>Chi tiết: ${log.details || ""}`;
                    break;
                case "daily_schedule_failed":
                    details = `<b style="color:red;">Lỗi gửi lịch tự động:</b> ${log.error || ""}<br>Chi tiết: ${log.details || ""}`;
                    break;
                case "upload":
                case "delete":
                case "create_report_file":
                    details = `Thao tác Google Drive (GAS).<br>Chi tiết: ${log.details || "N/A"}`;
                    break;

                default:
                    details = `
                        ${log.details ? "<b>Chi tiết:</b> " + log.details + "<br>" : ""}
                        ${log.reason ? "<b>Lý do:</b> " + log.reason + "<br>" : ""}
                        ${log.company ? "<b>Cty:</b> " + log.company + "<br>" : ""}
                        ${log.chi_so ? "<b>Chỉ số:</b> " + log.chi_so + "<br>" : ""}
                        ${log.ngay_ghi ? "<b>Ngày ghi:</b> " + log.ngay_ghi + "<br>" : ""}
                        ${log.ghi_chu ? "<b>Nội dung:</b> " + log.ghi_chu + "<br>" : ""}
                        ${log.fileId ? "<b>FileId:</b> " + log.fileId + "<br>" : ""}
                        ${log.fileUrl ? `<a href="${log.fileUrl}" target="_blank">Xem file</a>` : ""}
                        ${log.error ? `<b style="color:red;">Lỗi:</b> ${log.error}<br>` : ""}
                    `;
                    break;
            }

            // Tạo bản xem trước cho bảng (loại bỏ thẻ <br> để hiển thị 1 dòng)
            const previewDetails = details.replace(/<br\s*\/?>/gi, " | ");
            const displayPreview = previewDetails.trim() ? previewDetails : 'Không có chi tiết';
            const displayFull = details.trim() ? details : 'Không có chi tiết';

            const tr = document.createElement("tr");
            const actionLabel = actionTooltips[log.action] || log.action || "";
            tr.innerHTML = `
                <td>${time}</td>
                <td title="${log.email || ""}">${log.email || ""}</td>
                <td title="${log.action || ""}">${actionLabel}</td>
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
          }
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
                autoLoadCount = 1; // Reset lại bộ đếm cuộn
                globalLoadCount = 1;
            }

            try {
                const q = buildLogsQuery(isLoadMore);
                const snapshot = await getDocs(q);
                
                if (snapshot.empty) {
                    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
                    if (!isLoadMore) {
                        rawLogs = [];
                    if (isDeepSearchMode) return; // Nếu đang deep search thì không ghi đè
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
                    if (snapshot.docs.length < LIMIT_PER_PAGE) {
                        loadMoreBtn.style.display = 'none'; // Hết dữ liệu thì ẩn nút
                    } else {
                        loadMoreBtn.style.display = 'inline-block';
                        if (autoLoadCount >= MAX_AUTO_LOADS) {
                            loadMoreBtn.style.background = "#d35400"; // Màu cam cảnh báo
                            loadMoreBtn.textContent = "⚠️ Bạn đã xem khá nhiều. Bấm để tải tiếp...";
                        } else {
                            loadMoreBtn.style.background = "var(--primary-color)";
                            loadMoreBtn.textContent = `⬇️ Cuộn để tải thêm... (${globalLoadCount * LIMIT_PER_PAGE})`;
                        }
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
            // Lấy danh sách toàn bộ user trong hệ thống trước khi tải log
            try {
                // 1. Lấy danh sách Admin
                const rolesSnap = await getDocs(collection(db, "roles"));
                rolesSnap.docs.forEach(doc => {
                    if (doc.data().role === "admin") {
                        adminUsers.add(doc.id);
                        allKnownUsers.add(doc.id);
                    }
                });

                // 2. Lấy thêm từ lịch sử Phân ca (Bao gồm cả những người đã kết thúc quy tắc)
                const patternsSnap = await getDocs(collection(db, "work_patterns"));
                patternsSnap.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.user) {
                        patternUsers.add(data.user);
                        allKnownUsers.add(data.user);
                    }
                });

                // 3. Lấy từ danh sách User hiện tại
                const users = await fetchAllUsers();
                users.forEach(u => {
                    if (u.email) allKnownUsers.add(u.email);
                });
                
                // 4. Quét vét cạn từ lịch sử Log đã lưu Offline (IndexedDB)
                try {
                    const localLogs = await getAllFromLocalDB("logs");
                    if (localLogs && localLogs.length > 0) {
                        localLogs.forEach(l => {
                            if (l.action) allKnownActions.add(l.action);
                            if (l.email) {
                                allKnownUsers.add(l.email);
                                if (!userActionsMap.has(l.email)) userActionsMap.set(l.email, new Set());
                                if (l.action) {
                                    userActionsMap.get(l.email).add(l.action);
                                }
                            }
                        });
                    }
                } catch (err) { }
                
                allKnownUsers.add("system-auto"); // Bổ sung bot hệ thống
            } catch (e) {
                console.error("Lỗi lấy danh sách user:", e);
            }
            await fetchLogsByDate(false);
          })();

          function renderActionFilter(selectedUser) {
              if (!actionFilter) return;
              
              const prev = actionFilter.value;
              let allowedActions = null;
              
              if (selectedUser && userActionsMap.has(selectedUser)) {
                  allowedActions = userActionsMap.get(selectedUser);
              }
              
              const actionGroups = {
                  "Đăng nhập & Xác thực": ["login_success", "login_failure", "logout", "logout_success", "auto_logout_inactivity", "force_logout_requested", "forced_logout_executed", "reAuth_dismissed", "reAuth_success", "reAuth_failure"],
                  "Lên lịch & Phân ca": ["admin_create_work_rule", "admin_update_work_rule", "admin_delete_work_rule", "admin_delete_work_rules", "admin_create_manual_job", "admin_update_manual_job", "admin_delete_manual_job", "admin_create_work_pattern", "admin_update_work_pattern", "admin_delete_work_pattern", "admin_delete_work_patterns", "admin_create_shift_success", "admin_create_shift_failure", "admin_delete_shift_success", "admin_delete_shift_failure", "admin_create_shift_swap", "admin_update_shift_swap", "admin_delete_shift_swap", "admin_delete_shift_swaps"],
                  "Báo cáo ca trực": ["report_create_success", "report_update_success", "report_save_failure", "report_view_existing", "report_edit_initiated", "report_skipped_exact_match", "form_submit_canceled", "form_submit_fatal_error", "form_unknown_id", "form2_validation_error", "add_sameday_error", "overwrite_sameday_error", "overwrite_error", "overwrite_skipped", "overwrite_success", "updateReport"],
                  "Báo cáo Chỉ số": ["indicator_entry", "indicator_edit", "indicator_delete", "deleteReport", "deleteReport_failure", "deleteReport_not_found", "deleteReport_file_skipped", "meter_reset_confirmed", "meter_reset_canceled", "meter_reset_canceled_sameday", "duplicate_date_accepted"],
                  "Thông báo Nghỉ & ĐB": ["form2_submit_success", "form2_submit_partial_error", "form2_submit_no_dates", "form2_submit_skipped_only", "form2_special_workday_meaningless", "overwrite_manual_holiday_success", "overwrite_manual_holiday_error", "overwrite_manual_holiday_skipped", "add_holiday_error"],
                  "Quản lý File & Drive": ["updateFile", "report_upload_success", "report_upload_failure", "report_delete_success", "report_delete_failure", "file_creation_success", "file_creation_failure", "file_creation_connection_error", "file_size_error", "drive_upload_success", "drive_upload_failure", "drive_delete_failure", "drive_delete_success", "drive_delete_unauthorized", "drive_cleanup_success", "drive_cleanup_fail", "upload", "delete", "create_report_file"],
                  "Hệ thống & Cài đặt": ["system_config_update", "backup_created", "restore_completed", "user_role_update", "apps_script_add_user_success", "add_user_email", "hourly_schedule_sent", "daily_schedule_failed", "addDoc_failure", "addDoc_success", "addDoc_unauthorized", "getReportsByDate_failure"]
              };

              let optionsHtml = '';
              const processedCodes = new Set();

              for (const [groupName, codes] of Object.entries(actionGroups)) {
                  const groupActions = codes.filter(code => {
                      if (allowedActions) {
                          if (!allowedActions.has(code)) return false;
                      } else {
                          if (!allKnownActions.has(code)) return false;
                      }
                      return actionTooltips[code];
                  }).map(code => {
                      processedCodes.add(code);
                      return { code, label: actionTooltips[code] };
                  }).sort((a, b) => a.label.localeCompare(b.label));

                  if (groupActions.length > 0) {
                      optionsHtml += `<optgroup label="${groupName}">`;
                      optionsHtml += groupActions.map(a => `<option value="${a.code}">${a.label}</option>`).join('');
                      optionsHtml += `</optgroup>`;
                  }
              }

              const otherActions = Object.keys(actionTooltips)
                  .filter(code => !processedCodes.has(code))
                  .filter(code => {
                      if (allowedActions && !allowedActions.has(code)) return false;
                      return true;
                  })
                  .map(code => ({ code, label: actionTooltips[code] }))
                  .sort((a, b) => a.label.localeCompare(b.label));

              if (otherActions.length > 0) {
                  const groupLabel = allowedActions ? "Khác" : "Hành động khác";
                  optionsHtml += `<optgroup label="${groupLabel}">`;
                  optionsHtml += otherActions.map(a => `<option value="${a.code}">${a.label}</option>`).join('');
                  optionsHtml += `</optgroup>`;
              }
              
              actionFilter.innerHTML = '<option value="">-- Hành động --</option>' + optionsHtml;
              
              const currentOptions = Array.from(actionFilter.options).map(o => o.value);
              if (currentOptions.includes(prev)) {
                  actionFilter.value = prev;
              } else {
                  actionFilter.value = '';
              }
          }

          // Populate selects helper (unique actions and emails)
          function populateFilterOptions(logs) {
            if (!Array.isArray(logs)) return;
            
            let newUsersAdded = false;
            let newActionsAddedForSelectedUser = false;
            let newActionsAddedOverall = false;
            const selectedUser = userFilter ? userFilter.value : '';

            logs.forEach(l => {
                if (l.action) {
                    if (!allKnownActions.has(l.action)) {
                        allKnownActions.add(l.action);
                        newActionsAddedOverall = true;
                    }
                }
                
                if (l.email) {
                    if (!allKnownUsers.has(l.email)) {
                        allKnownUsers.add(l.email);
                        newUsersAdded = true;
                    }
                    if (!userActionsMap.has(l.email)) userActionsMap.set(l.email, new Set());
                    
                    if (l.action && !userActionsMap.get(l.email).has(l.action)) {
                        userActionsMap.get(l.email).add(l.action);
                        if (selectedUser === l.email) {
                            newActionsAddedForSelectedUser = true;
                        }
                    }
                }
            });

            // Nạp danh sách hành động
            if (actionFilter) {
                const shouldRender = actionFilter.options.length <= 1 || newActionsAddedForSelectedUser || (!selectedUser && newActionsAddedOverall);
                if (shouldRender) {
                    renderActionFilter(selectedUser);
                }
            }

            // Chỉ cập nhật dropdown user nếu có user mới hoặc dropdown chưa được khởi tạo
            if (userFilter && (newUsersAdded || userFilter.options.length <= 1)) {
              const prevU = userFilter.value;
              
              const priorityUsers = new Set([...patternUsers, ...adminUsers]);
              const otherUsers = new Set([...allKnownUsers].filter(u => !priorityUsers.has(u)));

              let optionsHtml = '<option value="">-- Người dùng --</option>';
              
              if (priorityUsers.size > 0) {
                  optionsHtml += '<optgroup label="Nhân viên & Quản trị viên">';
                  optionsHtml += Array.from(priorityUsers).sort().map(u => `<option value="${u}">${u}</option>`).join('');
                  optionsHtml += '</optgroup>';
              }
              
              if (otherUsers.size > 0) {
                  optionsHtml += '<optgroup label="Tài khoản khác">';
                  optionsHtml += Array.from(otherUsers).sort().map(u => `<option value="${u}">${u}</option>`).join('');
                  optionsHtml += '</optgroup>';
              }

              userFilter.innerHTML = optionsHtml;
              if (Array.from(allKnownUsers).includes(prevU)) userFilter.value = prevU;
            }
          }
          
          // Sự kiện thay đổi ngày -> Fetch lại dữ liệu Firestore
          startDateInput.addEventListener('change', () => { isDeepSearchMode = false; fetchLogsByDate(false); });
          endDateInput.addEventListener('change', () => { isDeepSearchMode = false; fetchLogsByDate(false); });

          // Sự kiện thay đổi bộ lọc -> Lọc local ngay lập tức HOẶC lọc chéo trên RAM nếu đang tìm kiếm
          const handleSelectFilterChange = () => {
              // 1. Cập nhật giao diện nút Bỏ lọc / Áp dụng
              const actionVal = actionFilter ? actionFilter.value : '';
              const userVal = userFilter ? userFilter.value : '';
              const isManualFilter = actionVal !== '' || userVal !== '' || startDateInput.value !== '' || endDateInput.value !== '';
              
              if (toggleFilterBtn) {
                  if (isManualFilter) {
                      toggleFilterBtn.textContent = 'Bỏ lọc';
                      toggleFilterBtn.style.background = '#6c757d';
                  } else {
                      toggleFilterBtn.textContent = 'Áp dụng';
                      toggleFilterBtn.style.background = '#3498db';
                  }
              }

              // 2. Lọc dữ liệu
              const q = searchInput.value.trim();
              if (q !== "" || isManualFilter) {
                  // Có từ khóa HOẶC Có chọn bộ lọc -> Quét toàn bộ DB lịch sử không cần phân trang
                  tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #3498db; font-style: italic; padding: 20px;">⏳ Đang lọc dữ liệu...</td></tr>`;
                  performDeepSearch(q);
              } else {
                  // Xóa sạch bộ lọc -> Khôi phục mẻ 15 dòng mặc định
                  isDeepSearchMode = false;
                  applyLocalFilters();
                  if (loadMoreBtn && lastDoc) loadMoreBtn.style.display = 'inline-block';
              }
          };

          actionFilter.addEventListener('change', handleSelectFilterChange);
          userFilter.addEventListener('change', (e) => {
              renderActionFilter(e.target.value);
              handleSelectFilterChange();
          });
          
          // Sự kiện nút Áp dụng / Bỏ lọc
          if (toggleFilterBtn) {
              toggleFilterBtn.addEventListener('click', () => {
                  isDeepSearchMode = false;
                  searchInput.value = ""; // MỚI: Xóa text tìm kiếm khi thao tác với nút bộ lọc
                  
                  // Khôi phục khóa UI
                  if (startDateInput) { startDateInput.disabled = false; startDateInput.style.opacity = "1"; startDateInput.style.cursor = ""; }
                  if (endDateInput) { endDateInput.disabled = false; endDateInput.style.opacity = "1"; endDateInput.style.cursor = ""; }

                  if (toggleFilterBtn.textContent === 'Bỏ lọc') {
                      userFilter.value = '';
                      renderActionFilter(''); // Reset action filter to show all
                      actionFilter.value = '';
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
            const q = searchInput.value.trim();
            const actionVal = actionFilter ? actionFilter.value : '';
            const userVal = userFilter ? userFilter.value : '';
            const isManualFilter = actionVal !== '' || userVal !== '';
            
            // Hủy bộ đếm giờ cũ nếu người dùng vẫn đang gõ liên tục
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            
            if (q === "" && !isManualFilter) {
                const wasDeepSearch = isDeepSearchMode;
                isDeepSearchMode = false;
                
                // Khôi phục UI bộ lọc thời gian
                if (startDateInput) { startDateInput.disabled = false; startDateInput.style.opacity = "1"; startDateInput.style.cursor = ""; }
                if (endDateInput) { endDateInput.disabled = false; endDateInput.style.opacity = "1"; endDateInput.style.cursor = ""; }

                if (wasDeepSearch) {
                    // Trả lại ngày đã lưu trước khi tìm kiếm
                    if (startDateInput) startDateInput.value = savedStartDate;
                    if (endDateInput) endDateInput.value = savedEndDate;
                    fetchLogsByDate(false); // Gọi tải lại dữ liệu ban đầu
                } else {
                    if (loadMoreBtn && lastDoc) {
                        loadMoreBtn.style.display = 'inline-block';
                        loadMoreBtn.textContent = "⬇️ Cuộn để tải thêm...";
                        loadMoreBtn.style.background = "var(--primary-color)";
                    }
                    applyLocalFilters();
                }
            } else {
                // Lưu lại ngày trước khi bắt đầu deep search
                if (!isDeepSearchMode) {
                    savedStartDate = startDateInput ? startDateInput.value : "";
                    savedEndDate = endDateInput ? endDateInput.value : "";
                }

                // Hiện thông báo đang tìm kiếm lập tức
                tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #3498db; font-style: italic; padding: 20px;">⏳ Đang tìm kiếm toàn bộ dữ liệu...</td></tr>`;
                if (loadMoreBtn) loadMoreBtn.style.display = 'none';
                
                // Hẹn giờ 500ms sau khi ngừng gõ mới thực hiện quét DB
                searchDebounceTimer = setTimeout(() => {
                    performDeepSearch(q);
                }, 500);
            }
          });

          // MỚI: Xử lý click nút tải thêm (phòng khi Intersection Observer không nhạy)
          if (loadMoreBtn) {
              loadMoreBtn.addEventListener('click', () => {
                  if (autoLoadCount >= MAX_AUTO_LOADS) {
                      autoLoadCount = 1; // Khởi động mẻ quét mới
                  } else {
                      autoLoadCount++; // Tính luôn click thủ công vào quota
                  }
                  globalLoadCount++;
                  loadMoreBtn.textContent = `⏳ Đang tải... (${globalLoadCount * LIMIT_PER_PAGE})`;
                  loadMoreBtn.style.background = "var(--primary-color)";
                  if (!isDeepSearchMode) fetchLogsByDate(true);
              });
          }

          // MỚI: Intersection Observer cho Infinite Scroll (Cuộn tới đâu tải tới đó)
          if (loadMoreBtn) {
              const handleIntersection = (entries) => {
                  // Nếu nút xuất hiện trên màn hình và không phải đang tải dở
                  if (entries[0].isIntersecting && !isFetching && loadMoreBtn.style.display !== 'none') {
                      if (autoLoadCount < MAX_AUTO_LOADS) {
                          autoLoadCount++;
                          globalLoadCount++;
                          loadMoreBtn.textContent = `⏳ Đang tải... (${globalLoadCount * LIMIT_PER_PAGE})`;
                          loadMoreBtn.style.background = "var(--primary-color)";
                          if (!isDeepSearchMode) fetchLogsByDate(true);
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