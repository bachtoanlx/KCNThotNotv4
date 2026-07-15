// sodo.js — Sơ Đồ SCADA Quy Trình Công Nghệ Realtime
import {
  db, onAuth, getRole, showSwal, showLoading, hideLoading, loadTemplate
} from "./script.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy
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
const COLLECTION_DEVICES   = "devices";
const COLLECTION_INCIDENTS = "maintenance_tickets";

let allDevices   = []; // Cache toàn bộ thiết bị từ DB
let allIncidents = []; // Cache sự cố từ DB

// Mapping Nhóm thiết bị tương tự thietbi.js
const GROUP_MAP = {
  bom:             { label: "Bơm",                   icon: "🌊" },
  bom_dinh_luong:  { label: "Bơm định lượng",        icon: "🧪" },
  khi:             { label: "Máy thổi khí",           icon: "💨" },
  dien:            { label: "Điện - Tủ điều khiển",  icon: "⚡" },
  cobien:          { label: "Cảm biến",               icon: "📡" },
  co_khi:          { label: "Cơ khí",                icon: "🔩" },
  dien_co:         { label: "Điện - Cơ",              icon: "⚙️" },
  khac:            { label: "Khác",                   icon: "📦" },
};

const STATUS_MAP = {
  good:     { label: "Hoạt động tốt",    icon: "✅" },
  warning:  { label: "Cần theo dõi",     icon: "⚠️" },
  broken:   { label: "Đang hỏng",        icon: "🔴" },
  inactive: { label: "Ngừng hoạt động",  icon: "⬛" },
};

// DOM REFS
const notLogged    = document.getElementById("notLogged");
const pageContent  = document.getElementById("pageContent");
const scadaSvg     = document.getElementById("scadaSvg");
const scadaContent = document.getElementById("scadaContent");
const wrapper      = document.getElementById("scadaSvgWrapper");
const highlight    = document.getElementById("scadaHighlight");
const tooltip      = document.getElementById("scadaTooltip");

// Sidebar Stats
const countTotal   = document.getElementById("count-total");
const countGood    = document.getElementById("count-good");
const countWarning = document.getElementById("count-warning");
const countBroken  = document.getElementById("count-broken");
const alertsList   = document.getElementById("alertsList");
const lastUpdated  = document.getElementById("scadaLastUpdated");

// Tooltip Elements
const ttName       = document.getElementById("tt-name");
const ttCode       = document.getElementById("tt-code");
const ttGroup      = document.getElementById("tt-group");
const ttLocation   = document.getElementById("tt-location");
const ttStatus     = document.getElementById("tt-status");
const ttSpec       = document.getElementById("tt-spec");
const ttSpecRow    = document.getElementById("tt-spec-row");
const ttDetailLink = document.getElementById("tt-detail-link");
const ttReportLink = document.getElementById("tt-report-link");

// Zoom/Pan State
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;

// ============================================================
// KHỞI TẠO XÁC THỰC
// ============================================================
onAuth(async (user) => {
  if (!user) {
    notLogged.style.display = "block";
    pageContent.style.display = "none";
    return;
  }

  notLogged.style.display = "none";
  pageContent.style.display = "block";

  showLoading("Đang kết nối SCADA...");
  try {
    startRealtimeListeners();
    setupZoomPan();
    setupTooltipClose();
  } catch (err) {
    console.error("Lỗi khởi chạy SCADA:", err);
    showSwal("error", "Lỗi khởi tạo", err.message);
  } finally {
    hideLoading();
  }
});

// ============================================================
// KHỞI TẠO BỘ LẮNG NGHE REALTIME
// ============================================================
function startRealtimeListeners() {
  // Lắng nghe sự cố
  const qIncidents = query(collection(db, COLLECTION_INCIDENTS), orderBy("reportedAt", "desc"));
  onSnapshot(qIncidents, (snap) => {
    allIncidents = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateSCADANodes();
  });

  // Lắng nghe thiết bị
  const qDevices = query(collection(db, COLLECTION_DEVICES), orderBy("createdAt", "desc"));
  onSnapshot(qDevices, (snap) => {
    allDevices = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateSCADANodes();
  });
}

// Chuẩn hóa tên/mã thiết bị để so khớp không phân biệt hoa thường và ký tự đặc biệt
function normalizeCode(code) {
  return (code || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ============================================================
// CẬP NHẬT TRẠNG THÁI SCADA NODES & SIDEBAR
// ============================================================
function updateSCADANodes() {
  const nodes = document.querySelectorAll(".device-node");
  
  let stats = { total: 0, good: 0, warning: 0, broken: 0, inactive: 0 };
  let errorDevices = [];

  // Mảng lưu ID đã khớp để tránh xử lý trùng
  const matchedDeviceIds = new Set();

  nodes.forEach(node => {
    stats.total++;
    const nodeCodeRaw = node.dataset.code;
    const nodeCodeNorm = normalizeCode(nodeCodeRaw);

    // Tìm thiết bị trong Firestore khớp mã thiết bị hoặc khớp tên thiết bị
    const dev = allDevices.find(d => {
      const dCode = normalizeCode(d.code);
      const dName = normalizeCode(d.name);
      return (dCode && dCode === nodeCodeNorm) || (dName && dName === nodeCodeNorm);
    });

    if (dev) {
      matchedDeviceIds.add(dev.id);

      // Tính trạng thái động dựa trên sự cố đang mở
      const openIncidents = allIncidents.filter(i => {
        const nameMatch = i.deviceName === dev.name;
        if (dev.code && i.deviceCode) {
          return nameMatch && i.deviceCode === dev.code && i.status !== "resolved";
        }
        return nameMatch && i.status !== "resolved";
      });

      let status = dev.status || "good";
      let errorDesc = "";

      if (status !== "inactive" && openIncidents.length > 0) {
        const hasCritical = openIncidents.some(i => i.severity === "critical");
        status = hasCritical ? "broken" : "warning";
        errorDesc = openIncidents[0].issueDescription || "Ghi nhận sự cố vận hành.";
      }

      stats[status]++;

      // Cập nhật giao diện SVG node
      node.classList.remove("status-good", "status-warning", "status-broken", "status-inactive");
      node.classList.add("status-" + status);

      // Lưu trữ thông tin động trực tiếp trên phần tử DOM
      node.devData = dev;
      node.computedStatus = status;
      node.errorDesc = errorDesc;

      // Đưa vào danh sách cảnh báo bên phải
      if (status === "warning" || status === "broken") {
        errorDevices.push({
          id: dev.id,
          name: dev.name,
          code: dev.code || nodeCodeRaw,
          status: status,
          desc: errorDesc
        });
      }
    } else {
      // Nếu thiết bị không tồn tại trong DB, mặc định để Inactive
      stats.inactive++;
      node.classList.remove("status-good", "status-warning", "status-broken", "status-inactive");
      node.classList.add("status-inactive");
      node.devData = {
        name: "Thiết bị chưa cấu hình",
        code: nodeCodeRaw,
        group: "khac",
        location: "—",
        status: "inactive",
        specs: {}
      };
      node.computedStatus = "inactive";
      node.errorDesc = "";
    }
  });

  // Cập nhật số liệu thống kê ở Sidebar
  countTotal.textContent   = stats.total;
  countGood.textContent    = stats.good;
  countWarning.textContent = stats.warning;
  countBroken.textContent  = stats.broken;

  // Cập nhật thời gian
  const now = new Date();
  lastUpdated.textContent = `Cập nhật: ${now.toLocaleTimeString("vi-VN")}`;

  // Render danh sách lỗi bên phải
  renderSidebarAlerts(errorDevices);
}

// Hiển thị danh sách cảnh báo ở thanh bên
function renderSidebarAlerts(list) {
  if (list.length === 0) {
    alertsList.innerHTML = `
      <div style="text-align:center; padding:30px 10px; color:#64748b; font-size:0.85rem;">
        ✅ Nhà máy hoạt động bình thường, không có lỗi.
      </div>`;
    return;
  }

  alertsList.innerHTML = list.map(item => {
    const statusLabel = item.status === "broken" ? "ĐANG HỎNG" : "THEO DÕI";
    return `
      <div class="alert-item ${item.status}" data-id="${item.id}" data-code="${item.code}">
        <div class="alert-header">
          <span class="alert-name">${item.name}</span>
          <span class="alert-code">${item.code}</span>
        </div>
        <div class="alert-desc" style="font-weight:700; margin-bottom:2px; color: ${item.status === 'broken' ? '#ef4444' : '#f59e0b'};">
          ⚠️ Trạng thái: ${statusLabel}
        </div>
        <div class="alert-desc">${item.desc}</div>
      </div>`;
  }).join("");

  // Sự kiện khi click vào item cảnh báo ở Sidebar
  alertsList.querySelectorAll(".alert-item").forEach(item => {
    item.addEventListener("click", () => {
      const code = item.dataset.code;
      locateDeviceOnSCADA(code);
    });
  });
}

// ============================================================
// ĐỊNH VỊ THIẾT BỊ TRÊN BẢN VẼ (ZOOM & FLASH)
// ============================================================
function locateDeviceOnSCADA(code) {
  const nodeNorm = normalizeCode(code);
  const node = Array.from(document.querySelectorAll(".device-node")).find(el => {
    return normalizeCode(el.dataset.code) === nodeNorm;
  });

  if (!node) {
    showSwal("warning", "Không tìm thấy", `Không tìm thấy node "${code}" trên sơ đồ công nghệ.`);
    return;
  }

  // Lấy tọa độ từ transform="translate(x, y)"
  const transform = node.getAttribute("transform");
  const match = /translate\(\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*\)/.exec(transform);

  if (match) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);

    // Di chuyển vòng highlight
    highlight.setAttribute("cx", x);
    highlight.setAttribute("cy", y);
    highlight.style.display = "block";

    // Phóng to & căn giữa màn hình SVG (kích thước 1600x950)
    scale = 1.8;
    translateX = 800 - x * scale;
    translateY = 475 - y * scale;

    updateTransform();

    // Hiện Tooltip của thiết bị đó
    showTooltipForNode(node, x, y);
  }
}

function hideHighlight() {
  highlight.style.display = "none";
}

// ============================================================
// HỘP TOOLTIP THÔNG TIN CHI TIẾT
// ============================================================
function showTooltipForNode(node, svgX, svgY) {
  const d = node.devData;
  const status = node.computedStatus;
  const errorDesc = node.errorDesc;

  const g = GROUP_MAP[d.group] || GROUP_MAP.khac;
  const s = STATUS_MAP[status] || STATUS_MAP.good;

  ttName.textContent = d.name || "Thiết bị chưa đặt tên";
  ttCode.textContent = d.code || node.dataset.code;
  ttGroup.textContent = `${g.icon} ${g.label}`;
  ttLocation.textContent = d.location || "Chưa xác định";
  ttStatus.innerHTML = `<span style="color:${status === 'broken' ? '#ef4444' : (status === 'warning' ? '#eab308' : '#10b981')}; font-weight:700;">${s.icon} ${s.label}</span>`;

  // Trình bày thông số chính
  const sp = d.specs || {};
  let specText = "";
  if (sp.power) specText += `${sp.power} kW; `;
  if (sp.flowRate) specText += `${sp.flowRate} m³/h; `;
  if (sp.head) specText += `${sp.head} m; `;
  if (sp.voltage) specText += `${sp.voltage} V; `;
  
  if (specText) {
    ttSpecRow.style.display = "flex";
    ttSpec.textContent = specText.replace(/;\s*$/, "");
  } else {
    ttSpecRow.style.display = "none";
  }

  // Cấu hình link
  if (d.id) {
    ttDetailLink.style.display = "block";
    ttDetailLink.href = `thietbi.html?id=${d.id}`;
    // Hỗ trợ nhảy sang tab hồ sơ chi tiết khi click
    ttDetailLink.onclick = (e) => {
      e.preventDefault();
      window.location.href = `thietbi.html?id=${d.id}`;
    };
  } else {
    ttDetailLink.style.display = "none";
  }

  // Pre-fill mã lỗi sang trang suco.html
  ttReportLink.href = `suco.html?deviceCode=${encodeURIComponent(d.code || node.dataset.code)}&deviceName=${encodeURIComponent(d.name)}`;

  // Chuyển đổi tọa độ SVG sang tọa độ client thực tế để hiển thị tooltip nổi
  const clientPos = getClientCoordsFromSVG(svgX, svgY);
  
  tooltip.style.left = `${clientPos.x - 125}px`; // Căn giữa tooltip rộng 250px
  tooltip.style.top = `${clientPos.y - 170}px`; // Đặt tooltip phía trên node
  tooltip.classList.add("show");
}

function hideTooltip() {
  tooltip.classList.remove("show");
}

// Chuyển đổi tọa độ SVG sang tọa độ màn hình
function getClientCoordsFromSVG(svgX, svgY) {
  const svgPoint = scadaSvg.createSVGPoint();
  svgPoint.x = svgX;
  svgPoint.y = svgY;

  // Sử dụng ma trận biến đổi của SVG Content để lấy tọa độ thực tế của phần tử bên trong group transform
  const contentMatrix = scadaContent.getCTM();
  const transformedPoint = svgPoint.matrixTransform(contentMatrix);

  // Sau đó chuyển đổi sang hệ tọa độ màn hình client
  const svgMatrix = scadaSvg.getScreenCTM();
  const screenPoint = transformedPoint.matrixTransform(svgMatrix);

  // Cộng thêm tọa độ scroll trang nếu có
  return {
    x: screenPoint.x + window.scrollX,
    y: screenPoint.y + window.scrollY
  };
}

// Gắn click listener cho từng node thiết bị trên sơ đồ
document.querySelectorAll(".device-node").forEach(node => {
  node.addEventListener("click", (e) => {
    e.stopPropagation();
    
    const transform = node.getAttribute("transform");
    const match = /translate\(\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*\)/.exec(transform);
    if (match) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      
      // Đồng thời di chuyển vòng highlight
      highlight.setAttribute("cx", x);
      highlight.setAttribute("cy", y);
      highlight.style.display = "block";

      showTooltipForNode(node, x, y);
    }
  });
});

// Đóng tooltip khi bấm ra ngoài bản vẽ
function setupTooltipClose() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".device-node") && !e.target.closest("#scadaTooltip")) {
      hideTooltip();
      hideHighlight();
    }
  });
}

// ============================================================
// ZOOM & DRAG PAN CHO SCADA VIEWPORT
// ============================================================
function setupZoomPan() {
  // Nút điều khiển Zoom
  document.getElementById("zoomInBtn").addEventListener("click", () => {
    scale = Math.min(scale * 1.25, 6);
    updateTransform();
  });

  document.getElementById("zoomOutBtn").addEventListener("click", () => {
    scale = Math.max(scale / 1.25, 0.5);
    updateTransform();
  });

  document.getElementById("zoomResetBtn").addEventListener("click", () => {
    scale = 1;
    translateX = 0;
    translateY = 0;
    updateTransform();
    hideHighlight();
    hideTooltip();
  });

  // Kéo thả chuột
  wrapper.addEventListener("mousedown", (e) => {
    if (e.target.closest(".device-node")) return; // Ưu tiên sự kiện click chọn node
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    hideTooltip();
  });

  wrapper.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateTransform();
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Kéo thả chạm trên thiết bị di động
  wrapper.addEventListener("touchstart", (e) => {
    if (e.target.closest(".device-node")) return;
    isDragging = true;
    const touch = e.touches[0];
    startX = touch.clientX - translateX;
    startY = touch.clientY - translateY;
    hideTooltip();
  });

  wrapper.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    translateX = touch.clientX - startX;
    translateY = touch.clientY - startY;
    updateTransform();
  });

  wrapper.addEventListener("touchend", () => {
    isDragging = false;
  });
}

function updateTransform() {
  scadaContent.setAttribute("transform", `translate(${translateX}, ${translateY}) scale(${scale})`);
  // Đóng tooltip khi đang pan để tránh lệch tọa độ
  if (isDragging) {
    hideTooltip();
  }
}
