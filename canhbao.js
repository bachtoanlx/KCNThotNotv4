// canhbao.js
import {
  db, onAuth, getRole, showSwal, showLoading, hideLoading, addLog, auth, loadTemplate, promptForReAuth
} from "./script.js";
import {
  collection,
  onSnapshot,
  setDoc,
  getDoc,
  doc,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initMenu } from "./menu.js";

// === Load menu, modal và footer ===
loadTemplate("menu-placeholder", "menu.html", () => {
  if (typeof initMenu === "function") initMenu();
});
loadTemplate("loading-placeholder", "modal.html");
loadTemplate("footer-placeholder", "footer.html");

// ============================================================
// HẰNG SỐ & BIẾN TOÀN CỤC
// ============================================================
const notLogged = document.getElementById("notLogged");
const pageContent = document.getElementById("pageContent");
const qcvnModal = document.getElementById("qcvnModal");
const btnOpenConfig = document.getElementById("btn-open-config");
const closeQcvnModal = document.getElementById("closeQcvnModal");

// Giao diện widget chỉ số ca gần nhất
const valPh = document.getElementById("val-ph");
const badgePh = document.getElementById("badge-ph");
const limitPh = document.getElementById("limit-ph");

const valCod = document.getElementById("val-cod");
const badgeCod = document.getElementById("badge-cod");
const limitCod = document.getElementById("limit-cod");

const valN = document.getElementById("val-n");
const badgeN = document.getElementById("badge-n");
const limitN = document.getElementById("limit-n");

const valTss = document.getElementById("val-tss");
const badgeTss = document.getElementById("badge-tss");
const limitTss = document.getElementById("limit-tss");

const valClo = document.getElementById("val-clo");
const badgeClo = document.getElementById("badge-clo");
const limitClo = document.getElementById("limit-clo");

const latestTimeDisplay = document.getElementById("latest-time-display");

// Bộ lọc & Bảng lịch sử
const filterParam = document.getElementById("filter-param");
const filterSeverity = document.getElementById("filter-severity");
const btnResetFilters = document.getElementById("btn-reset-filters");
const historyTableBody = document.getElementById("history-table-body");
const btnExportHistory = document.getElementById("btn-export-history");

// Cấu hình QCVN Form
const qcvnForm = document.getElementById("qcvn-config-form");
const cfgPhMin = document.getElementById("cfg-ph-min");
const cfgPhMax = document.getElementById("cfg-ph-max");
const cfgCodMax = document.getElementById("cfg-cod-max");
const cfgNMax = document.getElementById("cfg-n-max");
const cfgTssMax = document.getElementById("cfg-tss-max");
const cfgCloMax = document.getElementById("cfg-clo-max");
const cfgYellowRatio = document.getElementById("cfg-yellow-ratio");

// Cấu hình QCVN mặc định (Cột A - QCVN 40:2011/BTNMT)
const DEFAULT_QCVN = {
  phMin: 6.0,
  phMax: 9.0,
  codMax: 75,
  nMax: 20,
  tssMax: 50,
  cloMax: 1.0,
  yellowRatio: 90 // Báo vàng khi đạt >= 90% giới hạn
};

let qcvnConfig = { ...DEFAULT_QCVN };
let allReports = [];
let allViolations = []; // Toàn bộ lịch sử vi phạm đã phân tích
let userRole = "user";

// ============================================================
// XỬ LÝ ĐĂNG NHẬP & PHÂN QUYỀN
// ============================================================
onAuth(async (user) => {
  if (!user) {
    notLogged.style.display = "block";
    pageContent.style.display = "none";
    return;
  }

  showLoading("Đang nạp cấu hình cảnh báo...");
  notLogged.style.display = "none";
  pageContent.style.display = "block";

  userRole = await getRole(user.email);

  // Chỉ hiển thị nút cấu hình QCVN nếu là admin
  if (userRole === "admin") {
    btnOpenConfig.style.display = "flex";
  } else {
    btnOpenConfig.style.display = "none";
  }

  // Tải cấu hình QCVN và lắng nghe dữ liệu báo cáo
  await loadQcvnConfig();
  startReportsListener();
});

// ============================================================
// TẢI & GHI CẤU HÌNH QCVN
// ============================================================
async function loadQcvnConfig() {
  try {
    const docRef = doc(db, "settings", "qcvn_config");
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      qcvnConfig = snap.data();
    } else {
      // Khởi tạo mặc định nếu chưa có cấu hình trên DB
      await setDoc(docRef, DEFAULT_QCVN);
      qcvnConfig = { ...DEFAULT_QCVN };
    }

    fillConfigForm();
    updateLimitsUI();
  } catch (err) {
    console.error("Lỗi nạp cấu hình QCVN:", err);
    showSwal("error", "Lỗi nạp cấu hình", err.message);
  } finally {
    hideLoading();
  }
}

function fillConfigForm() {
  if (cfgPhMin) cfgPhMin.value = qcvnConfig.phMin;
  if (cfgPhMax) cfgPhMax.value = qcvnConfig.phMax;
  if (cfgCodMax) cfgCodMax.value = qcvnConfig.codMax;
  if (cfgNMax) cfgNMax.value = qcvnConfig.nMax;
  if (cfgTssMax) cfgTssMax.value = qcvnConfig.tssMax;
  if (cfgCloMax) cfgCloMax.value = qcvnConfig.cloMax;
  if (cfgYellowRatio) cfgYellowRatio.value = qcvnConfig.yellowRatio || 90;
}

function updateLimitsUI() {
  if (limitPh) limitPh.textContent = `Chuẩn: ${qcvnConfig.phMin} – ${qcvnConfig.phMax}`;
  if (limitCod) limitCod.textContent = `Chuẩn: <= ${qcvnConfig.codMax} mg/l`;
  if (limitN) limitN.textContent = `Chuẩn: <= ${qcvnConfig.nMax} mg/l`;
  if (limitTss) limitTss.textContent = `Chuẩn: <= ${qcvnConfig.tssMax} mg/l`;
  if (limitClo) limitClo.textContent = `Chuẩn: <= ${qcvnConfig.cloMax} mg/l`;
}

// Admin lưu cấu hình QCVN mới
if (qcvnForm) {
  qcvnForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (userRole !== "admin") {
      showSwal("error", "Từ chối truy cập", "Bạn không có quyền thực hiện thao tác này.");
      return;
    }

    const nextConfig = {
      phMin: parseFloat(cfgPhMin.value),
      phMax: parseFloat(cfgPhMax.value),
      codMax: parseFloat(cfgCodMax.value),
      nMax: parseFloat(cfgNMax.value),
      tssMax: parseFloat(cfgTssMax.value),
      cloMax: parseFloat(cfgCloMax.value),
      yellowRatio: parseInt(cfgYellowRatio.value)
    };

    if (nextConfig.phMin >= nextConfig.phMax) {
      showSwal("warning", "Sai thông số", "pH tối thiểu phải nhỏ hơn pH tối đa.");
      return;
    }

    // Yêu cầu xác thực mật khẩu
    const ok = await promptForReAuth();
    if (!ok) return;

    showLoading("Đang lưu cấu hình QCVN...");
    try {
      await setDoc(doc(db, "settings", "qcvn_config"), nextConfig);
      qcvnConfig = nextConfig;
      updateLimitsUI();
      // Phân tích lại danh sách báo cáo với cấu hình mới
      analyzeReports();
      await addLog("qcvn_config_update", { email: auth.currentUser.email, config: nextConfig });
      if (qcvnModal) qcvnModal.style.display = "none";
      showSwal("success", "Đã lưu!", "Cấu hình tiêu chuẩn QCVN đã được cập nhật thành công.");
    } catch (err) {
      console.error("Lỗi lưu QCVN:", err);
      showSwal("error", "Lỗi lưu cấu hình", err.message);
    } finally {
      hideLoading();
    }
  });
}

// Xử lý sự kiện đóng/mở Modal Cấu hình QCVN
if (btnOpenConfig && qcvnModal) {
  btnOpenConfig.addEventListener("click", () => {
    qcvnModal.style.display = "block";
  });
}

if (closeQcvnModal && qcvnModal) {
  closeQcvnModal.addEventListener("click", () => {
    qcvnModal.style.display = "none";
  });
}

// Click ra ngoài để đóng modal
window.addEventListener("click", (e) => {
  if (e.target === qcvnModal) {
    qcvnModal.style.display = "none";
  }
});

// ============================================================
// LẮNG NGHE REAL-TIME DỮ LIỆU CA TRỰC & PHÂN TÍCH CẢNH BÁO
// ============================================================
function startReportsListener() {
  const qReports = query(
    collection(db, "shift_reports"),
    orderBy("reportDate", "desc"),
    orderBy("shiftStartTime", "desc"),
    limit(30)
  );

  onSnapshot(qReports, (snapshot) => {
    allReports = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    analyzeReports();
  }, (err) => {
    console.error("Lỗi lắng nghe dữ liệu ca trực:", err);
    showSwal("error", "Lỗi tải dữ liệu ca", err.message);
  });
}

// Hàm phân tích và gán nhãn trạng thái các chỉ tiêu
function analyzeReports() {
  if (allReports.length === 0) {
    latestTimeDisplay.textContent = "Không tìm thấy dữ liệu ca trực nào.";
    resetIndicatorsUI();
    historyTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 25px;">Chưa có dữ liệu báo cáo nào.</td></tr>`;
    return;
  }

  // --- 1. PHÂN TÍCH CA GẦN NHẤT (HIỂN THỊ WIDGET TRÊN CÙNG) ---
  const latest = allReports[0];
  const dateFormatted = latest.reportDate ? formatDateString(latest.reportDate) : "—";
  latestTimeDisplay.textContent = `Báo cáo ca gần nhất: Ngày ${dateFormatted} — ${latest.shiftName || "Không rõ ca"}`;

  const latestOutput = latest.outputWater || [];
  updateIndicatorCard("ph", latestOutput, "ph");
  updateIndicatorCard("cod", latestOutput, "cod");
  updateIndicatorCard("n", latestOutput, "n");
  updateIndicatorCard("tss", latestOutput, "tss");
  updateIndicatorCard("clo", latestOutput, "clo");

  // --- 2. TỔNG HỢP DANH SÁCH LỊCH SỬ VI PHẠM ---
  allViolations = [];
  allReports.forEach(rep => {
    const outputs = rep.outputWater || [];
    const repDate = rep.reportDate ? formatDateString(rep.reportDate) : "—";
    const shiftLabel = `${repDate} (${rep.shiftName || "Ca trực"})`;

    outputs.forEach(row => {
      // Kiểm tra từng chỉ tiêu trong dòng đo đạc
      checkAndAddViolation(shiftLabel, row.time, "ph", row.ph);
      checkAndAddViolation(shiftLabel, row.time, "cod", row.cod);
      checkAndAddViolation(shiftLabel, row.time, "n", row.n);
      checkAndAddViolation(shiftLabel, row.time, "tss", row.tss);
      checkAndAddViolation(shiftLabel, row.time, "clo", row.clo);
    });
  });

  renderHistoryTable();
}

function updateIndicatorCard(paramType, outputList, fieldName) {
  const cardValEl = document.getElementById(`val-${paramType}`);
  const cardBadgeEl = document.getElementById(`badge-${paramType}`);

  if (outputList.length === 0) {
    cardValEl.textContent = "—";
    cardBadgeEl.textContent = "Chưa đo";
    cardBadgeEl.className = "status-indicator-badge status-green";
    return;
  }

  // Thu thập các giá trị hợp lệ trong mảng đo đạc
  const vals = outputList.map(row => parseFloat(String(row[fieldName]).replace(",", "."))).filter(v => !isNaN(v));

  if (vals.length === 0) {
    cardValEl.textContent = "—";
    cardBadgeEl.textContent = "Chưa đo";
    cardBadgeEl.className = "status-indicator-badge status-green";
    return;
  }

  let status = "green";
  let displayValStr = "";

  if (paramType === "ph") {
    const minPh = Math.min(...vals);
    const maxPh = Math.max(...vals);
    displayValStr = `${minPh} – ${maxPh}`;

    const limitMin = qcvnConfig.phMin;
    const limitMax = qcvnConfig.phMax;

    if (minPh < limitMin || maxPh > limitMax) {
      status = "red";
    } else {
      const yellowOffset = 0.3; // Ngưỡng báo vàng cách giới hạn 0.3 pH
      if (minPh <= limitMin + yellowOffset || maxPh >= limitMax - yellowOffset) {
        status = "yellow";
      }
    }
  } else {
    const maxVal = Math.max(...vals);
    displayValStr = maxVal.toString();

    let limitMax = 0;
    if (paramType === "cod") limitMax = qcvnConfig.codMax;
    else if (paramType === "n") limitMax = qcvnConfig.nMax;
    else if (paramType === "tss") limitMax = qcvnConfig.tssMax;
    else if (paramType === "clo") limitMax = qcvnConfig.cloMax;

    const ratio = qcvnConfig.yellowRatio / 100;

    if (maxVal > limitMax) {
      status = "red";
    } else if (maxVal >= limitMax * ratio) {
      status = "yellow";
    }
  }

  cardValEl.textContent = displayValStr;

  if (status === "red") {
    cardBadgeEl.textContent = "🔴 Vượt ngưỡng";
    cardBadgeEl.className = "status-indicator-badge status-red";
  } else if (status === "yellow") {
    cardBadgeEl.textContent = "🟡 Cận ngưỡng";
    cardBadgeEl.className = "status-indicator-badge status-yellow";
  } else {
    cardBadgeEl.textContent = "🟢 Đạt";
    cardBadgeEl.className = "status-indicator-badge status-green";
  }
}

function checkAndAddViolation(shiftLabel, timeStr, paramType, rawValue) {
  const val = parseFloat(String(rawValue).replace(",", "."));
  if (isNaN(val)) return;

  let isViolated = false;
  let severity = "green"; // yellow hoặc red
  let limitText = "";

  if (paramType === "ph") {
    const limitMin = qcvnConfig.phMin;
    const limitMax = qcvnConfig.phMax;
    limitText = `${limitMin} – ${limitMax}`;

    if (val < limitMin || val > limitMax) {
      isViolated = true;
      severity = "red";
    } else {
      const yellowOffset = 0.3;
      if (val <= limitMin + yellowOffset || val >= limitMax - yellowOffset) {
        isViolated = true;
        severity = "yellow";
      }
    }
  } else {
    let limitMax = 0;
    if (paramType === "cod") limitMax = qcvnConfig.codMax;
    else if (paramType === "n") limitMax = qcvnConfig.nMax;
    else if (paramType === "tss") limitMax = qcvnConfig.tssMax;
    else if (paramType === "clo") limitMax = qcvnConfig.cloMax;

    limitText = `<= ${limitMax}`;
    const ratio = qcvnConfig.yellowRatio / 100;

    if (val > limitMax) {
      isViolated = true;
      severity = "red";
    } else if (val >= limitMax * ratio) {
      isViolated = true;
      severity = "yellow";
    }
  }

  if (isViolated) {
    const paramNames = { ph: "pH", cod: "COD", n: "Tổng Nitơ (N)", tss: "TSS", clo: "Clo dư" };
    allViolations.push({
      shift: shiftLabel,
      time: timeStr || "—",
      paramKey: paramType,
      paramName: paramNames[paramType],
      value: val,
      limit: limitText,
      severity: severity
    });
  }
}

function resetIndicatorsUI() {
  ["ph", "cod", "n", "tss", "clo"].forEach(p => {
    document.getElementById(`val-${p}`).textContent = "—";
    const badge = document.getElementById(`badge-${p}`);
    badge.textContent = "—";
    badge.className = "status-indicator-badge status-green";
  });
}

// ============================================================
// BỘ LỌC VÀ HIỂN THỊ BẢNG LỊCH SỬ
// ============================================================
function renderHistoryTable() {
  const pFilter = filterParam.value;
  const sFilter = filterSeverity.value;

  const filtered = allViolations.filter(v => {
    if (pFilter !== "all" && v.paramKey !== pFilter) return false;
    if (sFilter !== "all" && v.severity !== sFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    historyTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 25px;">Không phát hiện lần vượt ngưỡng nào phù hợp bộ lọc.</td></tr>`;
    return;
  }

  historyTableBody.innerHTML = filtered.map(v => {
    const badgeText = v.severity === "red" ? "🔴 Vượt ngưỡng" : "🟡 Cận ngưỡng";
    const badgeClass = v.severity === "red" ? "status-red" : "status-yellow";
    return `
      <tr>
        <td><strong>${v.shift}</strong></td>
        <td>${v.time}</td>
        <td>${v.paramName}</td>
        <td style="font-weight: bold; color: ${v.severity === "red" ? "#dc2626" : "#d97706"};">${v.value}</td>
        <td>${v.limit}</td>
        <td><span class="status-indicator-badge ${badgeClass}" style="font-size:0.7rem; padding: 2px 6px;">${badgeText}</span></td>
      </tr>
    `;
  }).join("");
}

// Đăng ký sự kiện thay đổi bộ lọc
filterParam.addEventListener("change", renderHistoryTable);
filterSeverity.addEventListener("change", renderHistoryTable);

btnResetFilters.addEventListener("click", () => {
  filterParam.value = "all";
  filterSeverity.value = "all";
  renderHistoryTable();
});

// ============================================================
// TIỆN ÍCH HÀM ĐỔI ĐỊNH DẠNG NGÀY & XUẤT CSV
// ============================================================
function formatDateString(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// Xuất file CSV báo cáo lịch sử vi phạm
btnExportHistory.addEventListener("click", () => {
  if (allViolations.length === 0) {
    showSwal("warning", "Không có dữ liệu", "Không có dữ liệu vi phạm nào để xuất file.");
    return;
  }

  const pFilter = filterParam.value;
  const sFilter = filterSeverity.value;

  const filtered = allViolations.filter(v => {
    if (pFilter !== "all" && v.paramKey !== pFilter) return false;
    if (sFilter !== "all" && v.severity !== sFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    showSwal("warning", "Bộ lọc trống", "Bộ lọc hiện tại không chứa dữ liệu nào để xuất.");
    return;
  }

  // Định dạng nội dung CSV (sử dụng Unicode BOM để Excel hiển thị đúng Tiếng Việt)
  let csvContent = "\uFEFF";
  csvContent += "Ca trực,Giờ đo,Chỉ tiêu,Giá trị đo,Ngưỡng chuẩn QCVN,Trạng thái\n";

  filtered.forEach(v => {
    const statusText = v.severity === "red" ? "Vượt ngưỡng" : "Cận ngưỡng";
    csvContent += `"${v.shift.replace(/"/g, '""')}","${v.time}","${v.paramName}",${v.value},"${v.limit}","${statusText}"\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Lich_su_vi_pham_QCVN_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});
