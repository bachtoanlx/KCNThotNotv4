// thietbi.js — Quản Lý Thiết Bị
import {
  db, onAuth, getRole, showSwal, showLoading, hideLoading, addLog, auth, loadTemplate, promptForReAuth
} from "./script.js";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  where,
  serverTimestamp,
  getDocs,
  limit
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initMenu } from "./menu.js";

// === Tải menu, modal, footer ===
loadTemplate("menu-placeholder", "menu.html", () => {
  if (typeof initMenu === "function") initMenu();
});
loadTemplate("loading-placeholder", "modal.html");
loadTemplate("footer-placeholder", "footer.html");

// ============================================================
// HẰNG SỐ & BIẾN TOÀN CỤC
// ============================================================
const COLLECTION_DEVICES            = "devices";
const COLLECTION_INCIDENTS          = "maintenance_tickets";
const COLLECTION_MAINT_RULES        = "device_maintenance_rules";  // Quy trình bảo trì lưu ở đây

let userRole        = "user";
let allDevices      = [];       // Cache toàn bộ thiết bị
let allIncidents    = [];       // Cache toàn bộ sự cố
let allMaintTasks   = [];       // Quy trình bảo trì tải về
let currentDetailId = null;     // ID thiết bị đang xem chi tiết

// ============================================================
// MAPPING NHÓM THIẾT BỊ
// ============================================================
const GROUP_MAP = {
  bom:             { label: "Bơm",                   icon: "🌊", color: "#3b82f6" },
  bom_dinh_luong:  { label: "Bơm định lượng",        icon: "🧪", color: "#d946ef" },
  khi:             { label: "Máy thổi khí",           icon: "💨", color: "#8b5cf6" },
  dien:            { label: "Điện - Tủ điều khiển",  icon: "⚡", color: "#f59e0b" },
  cobien:          { label: "Cảm biến",               icon: "📡", color: "#06b6d4" },
  co_khi:          { label: "Cơ khí",                icon: "🔩", color: "#64748b" },
  dien_co:         { label: "Điện - Cơ",              icon: "⚙️", color: "#10b981" }, // màu emerald lá cây
  khac:            { label: "Khác",                   icon: "📦", color: "#94a3b8" },
};

const STATUS_MAP = {
  good:     { label: "Hoạt động tốt",    class: "good",     icon: "✅" },
  warning:  { label: "Cần theo dõi",     class: "warning",  icon: "⚠️" },
  broken:   { label: "Đang hỏng",        class: "broken",   icon: "🔴" },
  inactive: { label: "Ngừng hoạt động",  class: "inactive", icon: "⬛" },
};

// ============================================================
// DOM REFS
// ============================================================
const notLogged  = document.getElementById("notLogged");
const notAdmin   = document.getElementById("notAdmin");
const pageContent = document.getElementById("pageContent");

// Tabs
const tabBtns   = document.querySelectorAll(".tb-tab-btn");
const tabPanels = document.querySelectorAll(".tb-tab-panel");

// Tab 1 – Thiết bị
const deviceGrid           = document.getElementById("deviceGrid");
const deviceSearchInput    = document.getElementById("deviceSearchInput");
const deviceGroupFilter    = document.getElementById("deviceGroupFilter");
const deviceLocationFilter = document.getElementById("deviceLocationFilter");
const deviceStatusFilter   = document.getElementById("deviceStatusFilter");
const addDeviceBtn         = document.getElementById("addDeviceBtn");

// Tab 2 – Bảo trì
const maintTableBody   = document.getElementById("maintTableBody");
const maintDeviceFilter = document.getElementById("maintDeviceFilter");
const maintStatusFilter = document.getElementById("maintStatusFilter");

// Tab 3 – Lịch sử sự cố
const historyTableBody   = document.getElementById("historyTableBody");
const historySearchInput = document.getElementById("historySearchInput");
const historyDeviceFilter = document.getElementById("historyDeviceFilter");
const historySevFilter    = document.getElementById("historySevFilter");

// Modal form
const deviceFormModal = document.getElementById("deviceFormModal");
const formModalTitle  = document.getElementById("formModalTitle");
const deviceForm      = document.getElementById("deviceForm");
const editDeviceId    = document.getElementById("editDeviceId");
const closeFormModal  = document.getElementById("closeFormModal");
const cancelFormBtn   = document.getElementById("cancelFormBtn");

// Modal chi tiết
const deviceDetailModal = document.getElementById("deviceDetailModal");
const closeDetailModal  = document.getElementById("closeDetailModal");
const closeDetailBtn    = document.getElementById("closeDetailBtn");
const editFromDetailBtn = document.getElementById("editFromDetailBtn");

// ============================================================
// KHỞI TẠO AUTH
// ============================================================
onAuth(async (user) => {
  if (!user) {
    notLogged.style.display = "block";
    notAdmin.style.display = "none";
    pageContent.style.display = "none";
    return;
  }

  showLoading("Đang tải dữ liệu...");
  try {
    userRole = await getRole(user.email);

    if (userRole !== "admin") {
      notLogged.style.display = "none";
      notAdmin.style.display = "block";
      pageContent.style.display = "none";
      hideLoading();
      return;
    }

    notLogged.style.display = "none";
    notAdmin.style.display = "none";
    pageContent.style.display = "block";

    // Khởi động lắng nghe realtime
    startDevicesListener();
    startIncidentsListener();
    loadMaintenanceTasks();

  } catch (err) {
    console.error("Lỗi khởi tạo thietbi:", err);
    showSwal("error", "Lỗi tải dữ liệu", err.message);
  } finally {
    hideLoading();
  }
});

// ============================================================
// REALTIME LISTENERS
// ============================================================
function startDevicesListener() {
  const q = query(collection(db, COLLECTION_DEVICES), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    allDevices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDeviceGrid();
    populateDeviceFilters(); // Cập nhật dropdown bộ lọc các tab
    updateFormSuggestions(); // Cập nhật danh sách gợi ý tự động cho form
    
    // Tải lịch bảo trì
    loadMaintenanceTasks();
  });
}

function startIncidentsListener() {
  const q = query(collection(db, COLLECTION_INCIDENTS), orderBy("reportedAt", "desc"));
  onSnapshot(q, (snap) => {
    allIncidents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistoryTable();
  });
}

// Tải quy trình bảo trì trực tiếp từ COLLECTION_MAINT_RULES
function loadMaintenanceTasks() {
  const q = query(collection(db, COLLECTION_MAINT_RULES));
  onSnapshot(q, (snap) => {
    allMaintTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMaintenanceTable();
  }, (err) => {
    console.warn("Không tải được quy trình bảo trì:", err);
    allMaintTasks = [];
    renderMaintenanceTable();
  });
}

// ============================================================
// RENDER: LƯỚI THIẾT BỊ (TAB 1)
// ============================================================
function renderDeviceGrid() {
  const keyword = (deviceSearchInput.value || "").toLowerCase().trim();
  const groupF  = deviceGroupFilter.value;
  const locF    = deviceLocationFilter.value;
  const statusF = deviceStatusFilter.value;

  let filtered = allDevices.filter(d => {
    const matchKw     = !keyword ||
      (d.name || "").toLowerCase().includes(keyword) ||
      (d.code || "").toLowerCase().includes(keyword);
    const matchGroup  = groupF === "all" || d.group === groupF;
    const matchLoc    = locF === "all" || (d.location || "").trim() === locF;

    // Tính toán trạng thái động tương tự như khi render để phục vụ bộ lọc
    const openIncidents = allIncidents.filter(i => {
      const nameMatch = i.deviceName === d.name;
      if (d.code && i.deviceCode) {
        return nameMatch && i.deviceCode === d.code && i.status !== "resolved";
      }
      return nameMatch && i.status !== "resolved";
    });

    let displayStatus = d.status || "good";
    if (displayStatus !== "inactive" && openIncidents.length > 0) {
      const hasCritical = openIncidents.some(i => i.severity === "critical");
      if (hasCritical) {
        displayStatus = "broken";
      } else {
        displayStatus = "warning";
      }
    }

    const matchStatus = statusF === "all" || displayStatus === statusF;
    return matchKw && matchGroup && matchLoc && matchStatus;
  });

  if (filtered.length === 0) {
    deviceGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-icon">🔍</div>
      <div>${allDevices.length === 0 ? "Chưa có thiết bị nào. Nhấn ➕ Thêm thiết bị để bắt đầu." : "Không tìm thấy thiết bị phù hợp."}</div>
    </div>`;
    return;
  }

  deviceGrid.innerHTML = filtered.map(d => createDeviceCardHTML(d)).join("");

  // Gắn sự kiện cho từng thẻ
  deviceGrid.querySelectorAll(".device-card").forEach(card => {
    const id = card.dataset.id;

    // Click card → mở chi tiết
    card.addEventListener("click", (e) => {
      if (e.target.closest(".device-card-actions")) return;
      openDetailModal(id);
    });

    // Nút sửa
    card.querySelector(".btn-edit-device")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openFormModal("edit", id);
    });

    // Nút xóa
    card.querySelector(".btn-delete-device")?.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteDevice(id);
    });
  });
}

function createDeviceCardHTML(d) {
  const g = GROUP_MAP[d.group] || GROUP_MAP.khac;

  // Lọc lấy các sự cố chưa xử lý của thiết bị
  const openIncidents = allIncidents.filter(i => {
    const nameMatch = i.deviceName === d.name;
    if (d.code && i.deviceCode) {
      return nameMatch && i.deviceCode === d.code && i.status !== "resolved";
    }
    return nameMatch && i.status !== "resolved";
  });
  const openCount = openIncidents.length;

  // Tự động tính toán trạng thái hiển thị động
  let displayStatus = d.status || "good";
  if (displayStatus !== "inactive" && openCount > 0) {
    const hasCritical = openIncidents.some(i => i.severity === "critical");
    if (hasCritical) {
      displayStatus = "broken"; // Có sự cố khẩn cấp -> 🔴 Đang hỏng
    } else {
      displayStatus = "warning"; // Có sự cố thường -> ⚠️ Cần theo dõi
    }
  }

  const s = STATUS_MAP[displayStatus] || STATUS_MAP.good;

  const openBadge = openCount > 0
    ? `<span style="background:#fee2e2; color:#991b1b; font-size:0.72rem; font-weight:700;
         padding:2px 7px; border-radius:20px; white-space:nowrap;">
         ⚠️ ${openCount} sự cố mở
       </span>`
    : "";

  const installText = d.installDate
    ? `<span>📅 Lắp: ${new Date(d.installDate).toLocaleDateString("vi-VN")}</span>`
    : "";

  return `
    <div class="device-card" data-id="${d.id}" style="--device-accent: ${g.color};">
      <div class="device-card-header">
        <div class="device-name">${g.icon} ${d.name || "—"}</div>
        ${d.code ? `<span class="device-code">${d.code}</span>` : ""}
      </div>
      <div class="device-info">
        <span>📂 ${g.label}</span>
        ${d.location ? `<span>📍 ${d.location}</span>` : ""}
        ${d.brand    ? `<span>🏭 ${d.brand}</span>` : ""}
        ${installText}
        ${d.note ? `<span title="${d.note}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:220px;">📝 ${d.note}</span>` : ""}
      </div>
      <div class="device-status-row">
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <span class="status-badge ${s.class}">${s.icon} ${s.label}</span>
          ${openBadge}
        </div>
        <div class="device-card-actions">
          <button class="btn-card-action btn-edit-device" title="Chỉnh sửa">✏️</button>
          <button class="btn-card-action danger btn-delete-device" title="Xóa thiết bị">🗑️</button>
        </div>
      </div>
    </div>`;
}

// RENDER: BẢNG LỊCH BẢO TRÌ (TAB 2)
function renderMaintenanceTable() {
  const deviceF = maintDeviceFilter.value;
  const statusF = maintStatusFilter.value; // Dùng để lọc định kỳ vs một lần

  let tasks = allMaintTasks;

  if (deviceF !== "all") {
    tasks = tasks.filter(t => t.deviceName === deviceF);
  }

  const rows = tasks.map(t => {
    const scheduleText = getScheduleDescription(t);
    const dateStr = t.exactDate ? new Date(t.exactDate).toLocaleDateString("vi-VN") : "—";
    
    // Lọc loại quy trình bảo trì
    const isPeriodic = !t.exactDate;
    if (statusF === "upcoming" && !isPeriodic) return null; // Lọc định kỳ
    if (statusF === "today" && isPeriodic) return null;    // Lọc một lần

    return `<tr>
      <td><strong>${t.deviceName || "—"}</strong></td>
      <td>${t.job || "—"}</td>
      <td>${dateStr}</td>
      <td>${scheduleText}</td>
      <td><span class="maint-badge ${t.exactDate ? 'today' : 'upcoming'}">${t.exactDate ? 'Một lần' : 'Định kỳ'}</span></td>
      <td>
        <div style="display:flex; gap:3px;">
          <button class="btn-card-action btn-edit-maint-tab-rule" data-id="${t.id}" style="padding:4px 8px; font-size:0.8rem;" title="Sửa quy trình">✏️</button>
          <button class="btn-card-action danger btn-delete-maint-tab-rule" data-id="${t.id}" style="padding:4px 8px; font-size:0.8rem;" title="Xóa quy trình">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).filter(Boolean);

  if (rows.length === 0) {
    maintTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">
      ${allMaintTasks.length === 0
        ? "Chưa thiết lập quy trình bảo trì nào. Nhấn ➕ Thêm quy trình để tạo."
        : "Không tìm thấy quy trình phù hợp với bộ lọc."}
    </td></tr>`;
    return;
  }

  maintTableBody.innerHTML = rows.join("");

  // Gắn sự kiện sửa
  maintTableBody.querySelectorAll(".btn-edit-maint-tab-rule").forEach(btn => {
    btn.addEventListener("click", () => handleEditMaintRule(btn.dataset.id));
  });

  // Gắn sự kiện xóa
  maintTableBody.querySelectorAll(".btn-delete-maint-tab-rule").forEach(btn => {
    btn.addEventListener("click", () => handleDeleteMaintRule(btn.dataset.id));
  });
}

// Helper mô tả lịch lặp
function getScheduleDescription(t) {
  if (t.exactDate) {
    return `Ngày cố định: ${new Date(t.exactDate).toLocaleDateString("vi-VN")}`;
  }
  let parts = [];
  if (t.day) {
    const days = { "2":"Thứ 2", "3":"Thứ 3", "4":"Thứ 4", "5":"Thứ 5", "6":"Thứ 6", "7":"Thứ 7", "8":"Chủ nhật", "all":"Hàng ngày" };
    parts.push(days[t.day] || t.day);
  }
  if (t.week && t.week !== "all") {
    parts.push(`Tuần thứ ${t.week}`);
  }
  if (t.dom && t.dom !== "") {
    parts.push(`Ngày ${t.dom} hàng tháng`);
  }
  if (t.month && t.month !== "all") {
    parts.push(`Tháng ${t.month}`);
  }
  if (parts.length === 0) return "Quy tắc không xác định";
  return parts.join(", ");
}

// ============================================================
// RENDER: BẢNG LỊCH SỬ SỰ CỐ (TAB 3)
// ============================================================
function renderHistoryTable() {
  const keyword  = (historySearchInput.value || "").toLowerCase().trim();
  const deviceF  = historyDeviceFilter.value;
  const sevF     = historySevFilter.value;

  let filtered = allIncidents.filter(i => {
    const matchKw  = !keyword || (i.deviceName || "").toLowerCase().includes(keyword);
    const matchDev = deviceF === "all" || i.deviceName === deviceF;
    const matchSev = sevF === "all" || i.severity === sevF;
    return matchKw && matchDev && matchSev;
  });

  if (filtered.length === 0) {
    historyTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">
      ${allIncidents.length === 0 ? "Chưa có sự cố nào được ghi nhận." : "Không có sự cố phù hợp với bộ lọc."}
    </td></tr>`;
    return;
  }

  const sevLabel = { critical: "Khẩn cấp", medium: "Trung bình", low: "Thấp" };
  const statusLabel = { pending: "Chờ xử lý", fixing: "Đang sửa", resolved: "Đã xong" };
  const statusColor = {
    pending:  "color:#92400e; background:#fef3c7;",
    fixing:   "color:#1e40af; background:#dbeafe;",
    resolved: "color:#166534; background:#dcfce7;",
  };

  historyTableBody.innerHTML = filtered.map(i => {
    const dateStr = i.reportedAt?.toDate
      ? i.reportedAt.toDate().toLocaleDateString("vi-VN")
      : "—";
    const sLabel = statusLabel[i.status] || i.status;
    const sStyle = statusColor[i.status] || "";
    const displayDev = i.deviceCode ? `${i.deviceName} [${i.deviceCode}]` : (i.deviceName || "—");

    return `<tr>
      <td><strong>${displayDev}</strong></td>
      <td style="max-width:220px; white-space:normal;">${i.issueDescription || "—"}</td>
      <td>
        <span class="sev-dot ${i.severity}"></span>
        ${sevLabel[i.severity] || i.severity}
      </td>
      <td>${dateStr}</td>
      <td>
        <span style="display:inline-block; padding:2px 9px; border-radius:20px; font-size:0.75rem; font-weight:600; ${sStyle}">
          ${sLabel}
        </span>
      </td>
      <td style="max-width:200px; font-size:0.8rem; color:#64748b; white-space:normal;">
        ${i.notes || "—"}
      </td>
    </tr>`;
  }).join("");
}

// ============================================================
// POPULATE DROPDOWNS BỘ LỌC
// ============================================================
function populateDeviceFilters() {
  // Dropdown bộ lọc thiết bị trong tab bảo trì & lịch sử
  [maintDeviceFilter, historyDeviceFilter].forEach(sel => {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="all">Tất cả thiết bị</option>` +
      allDevices.map(d => {
        const lbl = d.code ? `${d.name} [${d.code}]` : d.name;
        return `<option value="${d.name}">${lbl}</option>`;
      }).join("");
    sel.value = current;
  });

  // Nạp động danh sách vị trí lắp đặt
  if (deviceLocationFilter) {
    const currentLoc = deviceLocationFilter.value;
    const uniqueLocations = Array.from(new Set(
      allDevices.map(d => (d.location || "").trim()).filter(loc => loc !== "")
    )).sort((a, b) => a.localeCompare(b, "vi"));

    deviceLocationFilter.innerHTML = `<option value="all">Tất cả vị trí</option>` +
      uniqueLocations.map(loc => `<option value="${loc}">${loc}</option>`).join("");
    
    if (uniqueLocations.includes(currentLoc)) {
      deviceLocationFilter.value = currentLoc;
    } else {
      deviceLocationFilter.value = "all";
    }
  }
}

// Cập nhật danh sách gợi ý tự động trong modal Thêm/Sửa thiết bị
function updateFormSuggestions() {
  const getUniqueValues = (key) => {
    return Array.from(new Set(
      allDevices.map(d => (d[key] || "").trim()).filter(val => val !== "")
    )).sort((a, b) => a.localeCompare(b, "vi"));
  };

  // 1. Tên thiết bị
  const nameDl = document.getElementById("deviceNameSuggestions");
  if (nameDl) {
    nameDl.innerHTML = getUniqueValues("name").map(n => `<option value="${n}">`).join("");
  }

  // 2. Mã thiết bị
  const codeDl = document.getElementById("deviceCodeSuggestions");
  if (codeDl) {
    codeDl.innerHTML = getUniqueValues("code").map(c => `<option value="${c}">`).join("");
  }

  // 3. Vị trí lắp đặt
  const locDl = document.getElementById("deviceLocationSuggestions");
  if (locDl) {
    locDl.innerHTML = getUniqueValues("location").map(l => `<option value="${l}">`).join("");
  }

  // 4. Hãng sản xuất
  const brandDl = document.getElementById("deviceBrandSuggestions");
  if (brandDl) {
    brandDl.innerHTML = getUniqueValues("brand").map(b => `<option value="${b}">`).join("");
  }

  // 5. Số serial / Model
  const serialDl = document.getElementById("deviceSerialSuggestions");
  if (serialDl) {
    serialDl.innerHTML = getUniqueValues("serial").map(s => `<option value="${s}">`).join("");
  }
}

// ============================================================
// TAB NAVIGATION
// ============================================================
tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.remove("active"));
    tabPanels.forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(target)?.classList.add("active");
  });
});

// ============================================================
// BỘ LỌC
// ============================================================
deviceSearchInput.addEventListener("input",  renderDeviceGrid);
deviceGroupFilter.addEventListener("change", renderDeviceGrid);
deviceLocationFilter.addEventListener("change", renderDeviceGrid);
deviceStatusFilter.addEventListener("change", renderDeviceGrid);

maintDeviceFilter.addEventListener("change", renderMaintenanceTable);
maintStatusFilter.addEventListener("change", renderMaintenanceTable);

historySearchInput.addEventListener("input",  renderHistoryTable);
historyDeviceFilter.addEventListener("change", renderHistoryTable);
historySevFilter.addEventListener("change",   renderHistoryTable);

// ============================================================
// MODAL FORM: MỞ / ĐÓNG
// ============================================================
addDeviceBtn.addEventListener("click", () => openFormModal("add"));

[closeFormModal, cancelFormBtn].forEach(el => {
  el?.addEventListener("click", closeDeviceFormModal);
});

deviceFormModal.addEventListener("click", (e) => {
  if (e.target === deviceFormModal) closeDeviceFormModal();
});

// Tự động điền/đồng bộ thông tin Nhóm, Hãng sản xuất, Vị trí khi nhập Tên thiết bị trùng với thiết bị đã có
const deviceNameInput = document.getElementById("deviceName");
if (deviceNameInput) {
  deviceNameInput.addEventListener("input", (e) => {
    const inputVal = e.target.value.trim().toLowerCase();
    if (!inputVal) return;

    // Tìm thiết bị trùng khớp tên (không phân biệt hoa thường)
    const matched = allDevices.find(d => (d.name || "").trim().toLowerCase() === inputVal);
    if (matched) {
      // Đồng bộ Nhóm thiết bị
      const groupSel = document.getElementById("deviceGroup");
      if (groupSel && matched.group) {
        groupSel.value = matched.group;
      }

      // Tự động điền Vị trí lắp đặt nếu hiện tại đang trống
      const locationInput = document.getElementById("deviceLocation");
      if (locationInput && !locationInput.value.trim() && matched.location) {
        locationInput.value = matched.location;
      }

      // Tự động điền Hãng sản xuất nếu hiện tại đang trống
      const brandInput = document.getElementById("deviceBrand");
      if (brandInput && !brandInput.value.trim() && matched.brand) {
        brandInput.value = matched.brand;
      }
    }
  });
}

function openFormModal(mode, id = null) {
  deviceForm.reset();
  editDeviceId.value = "";
  formModalTitle.textContent = mode === "add" ? "➕ Thêm Thiết Bị Mới" : "✏️ Chỉnh Sửa Thiết Bị";

  if (mode === "edit" && id) {
    const d = allDevices.find(x => x.id === id);
    if (!d) return;
    editDeviceId.value = d.id;
    document.getElementById("deviceName").value        = d.name || "";
    document.getElementById("deviceCode").value        = d.code || "";
    document.getElementById("deviceGroup").value       = d.group || "";
    document.getElementById("deviceLocation").value    = d.location || "";
    document.getElementById("deviceBrand").value       = d.brand || "";
    document.getElementById("deviceSerial").value      = d.serial || "";
    document.getElementById("deviceInstallDate").value = d.installDate || "";
    document.getElementById("deviceStatus").value      = d.status || "good";
    document.getElementById("deviceNote").value        = d.note || "";
    // Thông số kỹ thuật
    const sp = d.specs || {};
    document.getElementById("specPower").value      = sp.power      || "";
    document.getElementById("specVoltage").value    = sp.voltage    || "";
    document.getElementById("specCurrent").value    = sp.current    || "";
    document.getElementById("specFlowRate").value   = sp.flowRate   || "";
    document.getElementById("specHead").value       = sp.head       || "";
    document.getElementById("specSpeed").value      = sp.speed      || "";
    document.getElementById("specWeight").value     = sp.weight     || "";
    document.getElementById("specFreq").value       = sp.freq       || "";
    document.getElementById("specInsulation").value = sp.insulation || "";
    document.getElementById("specOther").value      = sp.other      || "";
  }

  deviceFormModal.classList.add("open");
}

function closeDeviceFormModal() {
  deviceFormModal.classList.remove("open");
}

// ============================================================
// LƯU THIẾT BỊ (THÊM / SỬA)
// ============================================================
deviceForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name    = document.getElementById("deviceName").value.trim();
  const group   = document.getElementById("deviceGroup").value;
  const status  = document.getElementById("deviceStatus").value;

  if (!name || !group) {
    showSwal("warning", "Thiếu thông tin", "Vui lòng nhập Tên thiết bị và chọn Nhóm thiết bị.");
    return;
  }

  // Kiểm tra trùng lặp (trùng cả Tên thiết bị và Mã thiết bị)
  const id = editDeviceId.value;
  const code = document.getElementById("deviceCode").value.trim();
  const isDuplicate = allDevices.some(d => {
    // Nếu là chế độ chỉnh sửa, bỏ qua thiết bị đang chỉnh sửa
    if (id && d.id === id) return false;
    
    return (d.name || "").trim().toLowerCase() === name.toLowerCase() && 
           (d.code || "").trim().toLowerCase() === code.toLowerCase();
  });

  if (isDuplicate) {
    showSwal(
      "warning", 
      "Trùng lặp thiết bị", 
      `Thiết bị "${name}" với Mã thiết bị "${code || "(trống)"}" đã tồn tại trên hệ thống. Vui lòng nhập mã thiết bị khác để phân biệt.`
    );
    return;
  }

  const payload = {
    name,
    code:        document.getElementById("deviceCode").value.trim(),
    group,
    location:    document.getElementById("deviceLocation").value.trim(),
    brand:       document.getElementById("deviceBrand").value.trim(),
    serial:      document.getElementById("deviceSerial").value.trim(),
    installDate: document.getElementById("deviceInstallDate").value,
    status,
    note:        document.getElementById("deviceNote").value.trim(),
    // Thông số kỹ thuật
    specs: {
      power:      document.getElementById("specPower").value      || null,
      voltage:    document.getElementById("specVoltage").value    || null,
      current:    document.getElementById("specCurrent").value    || null,
      flowRate:   document.getElementById("specFlowRate").value   || null,
      head:       document.getElementById("specHead").value       || null,
      speed:      document.getElementById("specSpeed").value      || null,
      weight:     document.getElementById("specWeight").value     || null,
      freq:       document.getElementById("specFreq").value       || null,
      insulation: document.getElementById("specInsulation").value.trim() || null,
      other:      document.getElementById("specOther").value.trim()      || null,
    },
    updatedBy:   auth.currentUser.email,
    updatedAt:   serverTimestamp(),
  };

  // Xác thực mật khẩu khi CHỈNH SỬA thiết bị (không cần khi thêm mới)
  if (id) {
    const ok = await promptForReAuth();
    if (!ok) return;
  }

  showLoading(id ? "Đang cập nhật thiết bị..." : "Đang thêm thiết bị...");

  try {
    if (id) {
      await updateDoc(doc(db, COLLECTION_DEVICES, id), payload);
      await addLog("device_update", {
        deviceName: name,
        deviceCode: payload.code || "",
        group: payload.group,
        email: auth.currentUser.email
      });
      showSwal("success", "Đã cập nhật!", `Thiết bị "${name}" đã được cập nhật.`);
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = auth.currentUser.email;
      await addDoc(collection(db, COLLECTION_DEVICES), payload);
      await addLog("device_add", {
        deviceName: name,
        deviceCode: payload.code || "",
        group: payload.group,
        email: auth.currentUser.email
      });
      showSwal("success", "Đã thêm!", `Thiết bị "${name}" đã được thêm vào danh sách.`);
    }
    closeDeviceFormModal();
  } catch (err) {
    console.error("Lỗi lưu thiết bị:", err);
    await addLog("device_save_failure", {
      deviceName: name,
      deviceCode: payload.code || "",
      action: id ? "update" : "add",
      error: err.message,
      email: auth.currentUser.email
    });
    showSwal("error", "Lỗi lưu dữ liệu", err.message);
  } finally {
    hideLoading();
  }
});

// ============================================================
// XÓA THIẾT BỊ
// ============================================================
async function handleDeleteDevice(id) {
  const d = allDevices.find(x => x.id === id);
  if (!d) return;

  const result = await Swal.fire({
    title: `Xóa thiết bị "${d.name}"?`,
    text: "Hành động này không thể hoàn tác. Lịch sử sự cố gắn với thiết bị này vẫn được giữ lại.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e74c3c",
    cancelButtonColor: "#95a5a6",
    confirmButtonText: "Vẫn xóa",
    cancelButtonText: "Hủy"
  });

  if (!result.isConfirmed) return;

  // Xác thực mật khẩu trước khi xóa
  const ok = await promptForReAuth();
  if (!ok) return;

  showLoading("Đang xóa thiết bị...");
  try {
    await deleteDoc(doc(db, COLLECTION_DEVICES, id));
    await addLog("device_delete", {
      deviceName: d.name,
      deviceCode: d.code || "",
      group: d.group || "",
      email: auth.currentUser.email
    });
    showSwal("success", "Đã xóa!", `Thiết bị "${d.name}" đã được xóa.`);
  } catch (err) {
    await addLog("device_delete_failure", {
      deviceName: d.name,
      deviceCode: d.code || "",
      error: err.message,
      email: auth.currentUser.email
    });
    showSwal("error", "Lỗi xóa", err.message);
  } finally {
    hideLoading();
  }
}

// ============================================================
// MODAL CHI TIẾT THIẾT BỊ
// ============================================================
function openDetailModal(id) {
  const d = allDevices.find(x => x.id === id);
  if (!d) return;

  currentDetailId = id;

  const g = GROUP_MAP[d.group] || GROUP_MAP.khac;

  // Tính toán trạng thái hiển thị động dựa trên sự cố chưa xử lý
  const openIncidents = allIncidents.filter(i => {
    const nameMatch = i.deviceName === d.name;
    if (d.code && i.deviceCode) {
      return nameMatch && i.deviceCode === d.code && i.status !== "resolved";
    }
    return nameMatch && i.status !== "resolved";
  });
  let displayStatus = d.status || "good";
  if (displayStatus !== "inactive" && openIncidents.length > 0) {
    const hasCritical = openIncidents.some(i => i.severity === "critical");
    if (hasCritical) {
      displayStatus = "broken";
    } else {
      displayStatus = "warning";
    }
  }
  const s = STATUS_MAP[displayStatus] || STATUS_MAP.good;

  document.getElementById("detailModalTitle").textContent = `🔍 Hồ Sơ — ${d.name}`;
  document.getElementById("det-name").textContent     = d.name || "—";
  document.getElementById("det-code").textContent     = d.code || "—";
  document.getElementById("det-group").textContent    = `${g.icon} ${g.label}`;
  document.getElementById("det-location").textContent = d.location || "—";
  document.getElementById("det-brand").textContent    = d.brand || "—";
  document.getElementById("det-serial").textContent   = d.serial || "—";
  document.getElementById("det-install").textContent  = d.installDate
    ? new Date(d.installDate).toLocaleDateString("vi-VN") : "—";
  document.getElementById("det-note").textContent     = d.note || "—";

  // Trạng thái với badge
  document.getElementById("det-status").innerHTML =
    `<span class="status-badge ${s.class}">${s.icon} ${s.label}</span>`;

  // Thông số kỹ thuật
  const sp = d.specs || {};
  const specItems = [
    { label: "Công suất",      value: sp.power,      unit: "kW"    },
    { label: "Điện áp",        value: sp.voltage,    unit: "V"     },
    { label: "Dòng điện",      value: sp.current,    unit: "A"     },
    { label: "Lưu lượng",      value: sp.flowRate,   unit: "m³/h"  },
    { label: "Cột áp",         value: sp.head,       unit: "m"     },
    { label: "Tốc độ",         value: sp.speed,      unit: "rpm"   },
    { label: "Trọng lượng",   value: sp.weight,     unit: "kg"    },
    { label: "Tần số",         value: sp.freq,       unit: "Hz"    },
    { label: "Cấp cách điện", value: sp.insulation, unit: ""      },
  ].filter(x => x.value !== null && x.value !== undefined && x.value !== "");

  const specsGrid = document.getElementById("det-specs-grid");
  const specOtherEl = document.getElementById("det-spec-other");

  if (specItems.length === 0 && !sp.other) {
    specsGrid.innerHTML = `<div style="grid-column:1/-1; font-size:0.82rem; color:#94a3b8;">
      Chưa có thông số kỹ thuật nào. Chỉnh sửa thiết bị để bổ sung.
    </div>`;
  } else {
    specsGrid.innerHTML = specItems.map(x =>
      `<div class="detail-item">
        <label>${x.label}</label>
        <span>${x.value}${x.unit ? ` <small style="color:#94a3b8;">${x.unit}</small>` : ""}</span>
      </div>`
    ).join("");
  }

  specOtherEl.textContent = sp.other ? `Thông số khác: ${sp.other}` : "";

  // Sự cố gần nhất (5 cái)
  const relatedIncidents = allIncidents
    .filter(i => {
      const nameMatch = i.deviceName === d.name;
      if (d.code && i.deviceCode) {
        return nameMatch && i.deviceCode === d.code;
      }
      return nameMatch;
    })
    .slice(0, 5);

  const incEl = document.getElementById("det-recent-incidents");
  if (relatedIncidents.length === 0) {
    incEl.innerHTML = `<div class="empty-state" style="padding:12px; font-size:0.85rem;">
      ✅ Chưa có sự cố nào ghi nhận cho thiết bị này.
    </div>`;
  } else {
    const sevL = { critical: "🔴 Khẩn cấp", medium: "🟡 Trung bình", low: "🟢 Thấp" };
    const statL = { pending: "Chờ xử lý", fixing: "Đang sửa", resolved: "Đã xong" };
    incEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:6px;">` +
      relatedIncidents.map(i => {
        const dt = i.reportedAt?.toDate
          ? i.reportedAt.toDate().toLocaleDateString("vi-VN") : "—";
        return `<div style="padding:8px 10px; border:1px solid var(--border-color); border-radius:6px; font-size:0.82rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
            <strong>${sevL[i.severity] || i.severity}</strong>
            <span style="color:#64748b;">${dt}</span>
          </div>
          <div>${i.issueDescription || "—"}</div>
          <div style="color:#64748b; font-size:0.78rem; margin-top:3px;">Trạng thái: ${statL[i.status] || i.status}</div>
        </div>`;
      }).join("") + `</div>`;
  }

  deviceDetailModal.classList.add("open");
}

// Sự kiện click nút Thêm quy trình bảo trì ở Tab 2 (Lịch bảo trì)
document.getElementById("addMaintRuleTabBtn")?.addEventListener("click", () => {
  handleAddMaintRule(null);
});

// Xử lý mở hộp thoại thêm quy trình bảo trì (nếu deviceId = null thì cho phép chọn thiết bị)
async function handleAddMaintRule(deviceId = null) {
  let targetDevice = null;
  
  if (deviceId) {
    targetDevice = allDevices.find(x => x.id === deviceId);
    if (!targetDevice) return;
  }

  // Tạo phần tử HTML để chọn thiết bị nếu deviceId = null
  let deviceSelectHTML = "";
  if (!deviceId) {
    if (allDevices.length === 0) {
      showSwal("warning", "Chưa có thiết bị", "Bạn cần tạo ít nhất một thiết bị trước khi lập quy trình bảo trì.");
      return;
    }
    
    deviceSelectHTML = `
      <div style="margin-bottom:12px;">
        <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Chọn thiết bị liên quan *</label>
        <select id="swal-maint-device-id" class="swal2-select" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem; padding: 0 5px;">
          <option value="" disabled selected>-- Chọn thiết bị --</option>
          ${allDevices.map(d => `<option value="${d.id}">${d.code ? `[${d.code}] ` : ""}${d.name}</option>`).join("")}
        </select>
      </div>
    `;
  }

  const { value: formValues } = await Swal.fire({
    title: targetDevice 
      ? `Thêm quy trình bảo trì cho:<br><span style="color:var(--primary-color);">${targetDevice.name}</span>`
      : `Thiết lập quy trình bảo trì`,
    html: `
      <div style="text-align: left; font-family: 'Inter', sans-serif;">
        ${deviceSelectHTML}
        <div style="margin-bottom:12px;">
          <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Tên việc bảo trì *</label>
          <input id="swal-maint-job" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;" placeholder="Ví dụ: Thay nhớt động cơ, vệ sinh tấm lọc...">
        </div>
        <div style="margin-bottom:12px; display:flex; gap:10px;">
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Giờ thực hiện</label>
            <input id="swal-maint-time" type="time" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;">
          </div>
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Ngày một lần (nếu có)</label>
            <input id="swal-maint-exact" type="date" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;">
          </div>
        </div>
        <div style="border-top:1px dashed #ccc; padding-top:10px; margin-top:14px; font-weight:700; font-size:0.82rem; color:#64748b; margin-bottom:10px;">LỊCH LẶP ĐỊNH KỲ (Bỏ qua nếu chọn Ngày một lần ở trên)</div>
        <div style="margin-bottom:12px; display:flex; gap:10px;">
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Thứ trong tuần</label>
            <select id="swal-maint-day" class="swal2-select" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem; padding: 0 5px;">
              <option value="">-- Chọn thứ --</option>
              <option value="2">Thứ 2</option>
              <option value="3">Thứ 3</option>
              <option value="4">Thứ 4</option>
              <option value="5">Thứ 5</option>
              <option value="6">Thứ 6</option>
              <option value="7">Thứ 7</option>
              <option value="8">Chủ nhật</option>
              <option value="all">Hàng ngày</option>
            </select>
          </div>
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Tuần trong tháng</label>
            <select id="swal-maint-week" class="swal2-select" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem; padding: 0 5px;">
              <option value="all">Mọi tuần</option>
              <option value="1">Tuần 1</option>
              <option value="2">Tuần 2</option>
              <option value="3">Tuần 3</option>
              <option value="4">Tuần 4</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:12px; display:flex; gap:10px;">
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Ngày trong tháng (DOM)</label>
            <input id="swal-maint-dom" type="number" min="1" max="31" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;" placeholder="VD: 1 hoặc 15">
          </div>
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Tháng áp dụng</label>
            <select id="swal-maint-month" class="swal2-select" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem; padding: 0 5px;">
              <option value="all">Mọi tháng</option>
              <option value="1">Tháng 1</option>
              <option value="2">Tháng 2</option>
              <option value="3">Tháng 3</option>
              <option value="4">Tháng 4</option>
              <option value="5">Tháng 5</option>
              <option value="6">Tháng 6</option>
              <option value="7">Tháng 7</option>
              <option value="8">Tháng 8</option>
              <option value="9">Tháng 9</option>
              <option value="10">Tháng 10</option>
              <option value="11">Tháng 11</option>
              <option value="12">Tháng 12</option>
            </select>
          </div>
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "💾 Lưu quy trình",
    cancelButtonText: "Hủy",
    confirmButtonColor: "var(--primary-color)",
    preConfirm: () => {
      const job = document.getElementById('swal-maint-job').value.trim();
      const time = document.getElementById('swal-maint-time').value;
      const exactDate = document.getElementById('swal-maint-exact').value;
      const day = document.getElementById('swal-maint-day').value;
      const week = document.getElementById('swal-maint-week').value;
      const dom = document.getElementById('swal-maint-dom').value.trim();
      const month = document.getElementById('swal-maint-month').value;
      
      let selDeviceId = deviceId;
      if (!deviceId) {
        selDeviceId = document.getElementById('swal-maint-device-id').value;
        if (!selDeviceId) {
          Swal.showValidationMessage('Bạn phải chọn thiết bị liên quan!');
          return false;
        }
      }

      if (!job) {
        Swal.showValidationMessage('Bạn bắt buộc phải nhập Tên việc bảo trì!');
        return false;
      }

      return { job, time, exactDate, day, week, dom, month, selDeviceId };
    }
  });

  if (!formValues) return;

  const finalDeviceId = formValues.selDeviceId;
  const d = allDevices.find(x => x.id === finalDeviceId);
  if (!d) return;

  showLoading("Đang thêm quy trình bảo trì...");
  try {
    const payload = {
      deviceId: finalDeviceId,
      deviceName: d.name,
      deviceCode: d.code || "",
      job: formValues.job,
      time: formValues.time || "",
      exactDate: formValues.exactDate || null,
      day: formValues.exactDate ? "" : (formValues.day || ""),
      week: formValues.exactDate ? "" : (formValues.week || "all"),
      dom: formValues.exactDate ? "" : (formValues.dom || ""),
      month: formValues.exactDate ? "" : (formValues.month || "all"),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.email
    };

    await addDoc(collection(db, COLLECTION_MAINT_RULES), payload);
    await addLog("device_maintenance_rule_add", { deviceName: d.name, job: formValues.job, email: auth.currentUser.email });
    
    showSwal("success", "Đã thêm quy trình!", `Quy trình bảo trì "${formValues.job}" đã được thiết lập.`);
  } catch (err) {
    showSwal("error", "Lỗi lưu dữ liệu", err.message);
  } finally {
    hideLoading();
  }
}


// Sửa quy trình bảo trì đã có
async function handleEditMaintRule(ruleId) {
  const r = allMaintTasks.find(x => x.id === ruleId);
  if (!r) return;

  const { value: formValues } = await Swal.fire({
    title: `Sửa quy trình bảo trì cho:<br><span style="color:var(--primary-color);">${r.deviceName}</span>`,
    html: `
      <div style="text-align: left; font-family: 'Inter', sans-serif;">
        <div style="margin-bottom:12px;">
          <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Tên việc bảo trì *</label>
          <input id="swal-maint-job" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;" value="${r.job || ""}" placeholder="Ví dụ: Thay nhớt động cơ, vệ sinh tấm lọc...">
        </div>
        <div style="margin-bottom:12px; display:flex; gap:10px;">
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Giờ thực hiện</label>
            <input id="swal-maint-time" type="time" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;" value="${r.time || ""}">
          </div>
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Ngày một lần (nếu có)</label>
            <input id="swal-maint-exact" type="date" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;" value="${r.exactDate || ""}">
          </div>
        </div>
        <div style="border-top:1px dashed #ccc; padding-top:10px; margin-top:14px; font-weight:700; font-size:0.82rem; color:#64748b; margin-bottom:10px;">LỊCH LẶP ĐỊNH KỲ (Bỏ qua nếu chọn Ngày một lần ở trên)</div>
        <div style="margin-bottom:12px; display:flex; gap:10px;">
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Thứ trong tuần</label>
            <select id="swal-maint-day" class="swal2-select" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem; padding: 0 5px;">
              <option value="" ${r.day === "" ? "selected" : ""}>-- Chọn thứ --</option>
              <option value="2" ${r.day === "2" ? "selected" : ""}>Thứ 2</option>
              <option value="3" ${r.day === "3" ? "selected" : ""}>Thứ 3</option>
              <option value="4" ${r.day === "4" ? "selected" : ""}>Thứ 4</option>
              <option value="5" ${r.day === "5" ? "selected" : ""}>Thứ 5</option>
              <option value="6" ${r.day === "6" ? "selected" : ""}>Thứ 6</option>
              <option value="7" ${r.day === "7" ? "selected" : ""}>Thứ 7</option>
              <option value="8" ${r.day === "8" ? "selected" : ""}>Chủ nhật</option>
              <option value="all" ${r.day === "all" ? "selected" : ""}>Hàng ngày</option>
            </select>
          </div>
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Tuần trong tháng</label>
            <select id="swal-maint-week" class="swal2-select" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem; padding: 0 5px;">
              <option value="all" ${r.week === "all" ? "selected" : ""}>Mọi tuần</option>
              <option value="1" ${r.week === "1" ? "selected" : ""}>Tuần 1</option>
              <option value="2" ${r.week === "2" ? "selected" : ""}>Tuần 2</option>
              <option value="3" ${r.week === "3" ? "selected" : ""}>Tuần 3</option>
              <option value="4" ${r.week === "4" ? "selected" : ""}>Tuần 4</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:12px; display:flex; gap:10px;">
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Ngày trong tháng (DOM)</label>
            <input id="swal-maint-dom" type="number" min="1" max="31" class="swal2-input" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem;" value="${r.dom || ""}" placeholder="VD: 1 hoặc 15">
          </div>
          <div style="flex:1;">
            <label style="display:block; font-weight:600; font-size:0.82rem; color:#475569; margin-bottom:5px;">Tháng áp dụng</label>
            <select id="swal-maint-month" class="swal2-select" style="width:100%; margin:0; box-sizing:border-box; height:38px; font-size:0.88rem; padding: 0 5px;">
              <option value="all" ${r.month === "all" ? "selected" : ""}>Mọi tháng</option>
              <option value="1" ${r.month === "1" ? "selected" : ""}>Tháng 1</option>
              <option value="2" ${r.month === "2" ? "selected" : ""}>Tháng 2</option>
              <option value="3" ${r.month === "3" ? "selected" : ""}>Tháng 3</option>
              <option value="4" ${r.month === "4" ? "selected" : ""}>Tháng 4</option>
              <option value="5" ${r.month === "5" ? "selected" : ""}>Tháng 5</option>
              <option value="6" ${r.month === "6" ? "selected" : ""}>Tháng 6</option>
              <option value="7" ${r.month === "7" ? "selected" : ""}>Tháng 7</option>
              <option value="8" ${r.month === "8" ? "selected" : ""}>Tháng 8</option>
              <option value="9" ${r.month === "9" ? "selected" : ""}>Tháng 9</option>
              <option value="10" ${r.month === "10" ? "selected" : ""}>Tháng 10</option>
              <option value="11" ${r.month === "11" ? "selected" : ""}>Tháng 11</option>
              <option value="12" ${r.month === "12" ? "selected" : ""}>Tháng 12</option>
            </select>
          </div>
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "💾 Lưu thay đổi",
    cancelButtonText: "Hủy",
    confirmButtonColor: "var(--primary-color)",
    preConfirm: () => {
      const job = document.getElementById('swal-maint-job').value.trim();
      const time = document.getElementById('swal-maint-time').value;
      const exactDate = document.getElementById('swal-maint-exact').value;
      const day = document.getElementById('swal-maint-day').value;
      const week = document.getElementById('swal-maint-week').value;
      const dom = document.getElementById('swal-maint-dom').value.trim();
      const month = document.getElementById('swal-maint-month').value;

      if (!job) {
        Swal.showValidationMessage('Bạn bắt buộc phải nhập Tên việc bảo trì!');
        return false;
      }

      return { job, time, exactDate, day, week, dom, month };
    }
  });

  if (!formValues) return;

  showLoading("Đang cập nhật quy trình...");
  try {
    const payload = {
      job: formValues.job,
      time: formValues.time || "",
      exactDate: formValues.exactDate || null,
      day: formValues.exactDate ? "" : (formValues.day || ""),
      week: formValues.exactDate ? "" : (formValues.week || "all"),
      dom: formValues.exactDate ? "" : (formValues.dom || ""),
      month: formValues.exactDate ? "" : (formValues.month || "all"),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    };

    await updateDoc(doc(db, COLLECTION_MAINT_RULES, ruleId), payload);
    await addLog("device_maintenance_rule_update", { deviceName: r.deviceName, job: formValues.job, email: auth.currentUser.email });
    
    showSwal("success", "Đã cập nhật!", `Quy trình bảo trì "${formValues.job}" đã được chỉnh sửa.`);
  } catch (err) {
    showSwal("error", "Lỗi lưu dữ liệu", err.message);
  } finally {
    hideLoading();
  }
}

// Xóa quy trình bảo trì
async function handleDeleteMaintRule(ruleId) {
  const r = allMaintTasks.find(x => x.id === ruleId);
  if (!r) return;

  const result = await Swal.fire({
    title: "Xóa quy trình bảo trì?",
    text: `Bạn muốn xóa quy trình "${r.job}" của thiết bị ${r.deviceName}?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e74c3c",
    cancelButtonColor: "#95a5a6",
    confirmButtonText: "Xóa",
    cancelButtonText: "Hủy"
  });

  if (!result.isConfirmed) return;

  showLoading("Đang xóa quy trình...");
  try {
    await deleteDoc(doc(db, COLLECTION_MAINT_RULES, ruleId));
    await addLog("device_maintenance_rule_delete", { deviceName: r.deviceName, job: r.job, email: auth.currentUser.email });
    showSwal("success", "Đã xóa!", "Quy trình bảo trì đã được loại bỏ.");
  } catch (err) {
    showSwal("error", "Lỗi xóa", err.message);
  } finally {
    hideLoading();
  }
}

[closeDetailModal, closeDetailBtn].forEach(el => {
  el?.addEventListener("click", () => {
    deviceDetailModal.classList.remove("open");
    currentDetailId = null; // Reset
  });
});

deviceDetailModal.addEventListener("click", (e) => {
  if (e.target === deviceDetailModal) {
    deviceDetailModal.classList.remove("open");
    currentDetailId = null; // Reset
  }
});

editFromDetailBtn.addEventListener("click", () => {
  deviceDetailModal.classList.remove("open");
  if (currentDetailId) openFormModal("edit", currentDetailId);
});
