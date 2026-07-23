// dashboard.js
import {
  db, onAuth, getRole, showSwal, showLoading, hideLoading, auth, loadTemplate
} from "./script.js";
import {
  collection,
  onSnapshot,
  getDocs,
  getDoc,
  doc,
  query,
  orderBy,
  limit,
  where
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { ruleMatchesDate } from "./autoplan-core.js";
import { initMenu } from "./menu.js";

// === Load menu, footer, và modal loading ===
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

// KPIs elements
const kpiShiftName = document.getElementById("kpi-shift-name");
const kpiShiftDesc = document.getElementById("kpi-shift-desc");
const kpiTicketsCount = document.getElementById("kpi-tickets-count");
const kpiTicketsDesc = document.getElementById("kpi-tickets-desc");
const kpiChemicalsCount = document.getElementById("kpi-chemicals-count");
const kpiChemicalsDesc = document.getElementById("kpi-chemicals-desc");
const kpiMaintCount = document.getElementById("kpi-maint-count");
const kpiMaintDesc = document.getElementById("kpi-maint-desc");

// Tables & Details
const lowStockTableBody = document.getElementById("low-stock-table-body");
const lowStockAlertText = document.getElementById("low-stock-alert-text");
const upcomingMaintTableBody = document.getElementById("upcoming-maint-table-body");
const upcomingMaintText = document.getElementById("upcoming-maint-text");
const chartTotalFlow = document.getElementById("chart-total-flow");

// Cấu hình QCVN mặc định
const DEFAULT_QCVN = {
  phMin: 6.0,
  phMax: 9.0,
  codMax: 75,
  nMax: 20,
  tssMax: 50,
  cloMax: 1.0,
  yellowRatio: 90
};

let qcvnConfig = { ...DEFAULT_QCVN };
let userRole = "user";
let flowChart = null;

// ============================================================
// XỬ LÝ ĐĂNG NHẬP & PHÂN QUYỀN
// ============================================================
onAuth(async (user) => {
  if (!user) {
    notLogged.style.display = "block";
    pageContent.style.display = "none";
    return;
  }

  showLoading("Đang nạp dữ liệu tổng quan...");
  notLogged.style.display = "none";
  pageContent.style.display = "block";

  userRole = await getRole(user.email);

  await loadQcvnConfig();
  await loadCompanyConfigs(); // Tải cấu hình ngày nghỉ mặc định của các doanh nghiệp
  setupDashboardListeners();
});

// ============================================================
// NẠP CẤU HÌNH NGƯỠNG TIÊU CHUẨN QCVN
// ============================================================
async function loadQcvnConfig() {
  try {
    const docRef = doc(db, "settings", "qcvn_config");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      qcvnConfig = snap.data();
    }
  } catch (err) {
    console.error("Lỗi nạp cấu hình QCVN:", err);
  }
}

// ============================================================
// THIẾT LẬP CÁC LẮNG NGHE REAL-TIME DỮ LIỆU
// ============================================================
function setupDashboardListeners() {
  try {
    // 1. Lắng nghe ca trực & chỉ số nước thải ca gần nhất
    const qShift = query(
      collection(db, "shift_reports"),
      orderBy("reportDate", "desc"),
      orderBy("shiftStartTime", "desc"),
      limit(1)
    );
    onSnapshot(qShift, (snapshot) => {
      if (!snapshot.empty) {
        const latestDoc = snapshot.docs[0].data();
        updateShiftKPI(latestDoc);
        updateWaterIndicators(latestDoc.outputWater || []);
      } else {
        kpiShiftName.textContent = "Chưa có dữ liệu";
        kpiShiftDesc.textContent = "👤 Chưa có nhân sự trực";
        resetWaterIndicatorsUI();
      }
    });

    // 2. Lắng nghe Sự cố chưa giải quyết
    onSnapshot(collection(db, "maintenance_tickets"), (snapshot) => {
      const tickets = snapshot.docs.map(d => d.data());
      const activeTickets = tickets.filter(t => t.status !== "resolved");
      
      kpiTicketsCount.textContent = activeTickets.length;
      
      const critical = activeTickets.filter(t => t.severity === "critical").length;
      const medium = activeTickets.filter(t => t.severity === "medium").length;
      const low = activeTickets.filter(t => t.severity === "low").length;
      
      kpiTicketsDesc.innerHTML = `🔴 <span style="color:#dc2626; font-weight:bold;">${critical}</span> Khẩn cấp | 🟡 <span style="color:#d97706; font-weight:bold;">${medium}</span> Trung bình | 🟢 <span style="color:#16a34a; font-weight:bold;">${low}</span> Thấp`;
    });

    // 3. Lắng nghe tồn kho hóa chất
    onSnapshot(collection(db, "chemical_inventory"), (snapshot) => {
      const items = snapshot.docs.map(d => d.data());
      const lowStockItems = items.filter(item => {
        const current = item.currentStock || 0;
        const min = item.minimumThreshold || 0;
        return current <= min;
      });

      kpiChemicalsCount.textContent = lowStockItems.length;
      kpiChemicalsDesc.textContent = `${lowStockItems.length} hóa chất ở mức báo động`;
      
      if (lowStockItems.length > 0) {
        lowStockAlertText.textContent = "⚠️ Cần nhập thêm kho!";
        lowStockTableBody.innerHTML = lowStockItems.map(item => `
          <tr>
            <td><strong>${item.chemicalName || "Hóa chất"}</strong></td>
            <td style="color: #dc2626; font-weight: bold;">${(item.currentStock || 0).toLocaleString("vi-VN")} ${item.unit || "kg"}</td>
            <td>${(item.minimumThreshold || 0).toLocaleString("vi-VN")} ${item.unit || "kg"}</td>
          </tr>
        `).join("");
      } else {
        lowStockAlertText.textContent = "🟢 Kho an toàn";
        lowStockAlertText.style.color = "#16a34a";
        lowStockTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #16a34a; padding: 20px; font-weight: bold;">🟢 Không có cảnh báo tồn kho.</td></tr>`;
      }
    });

    // 4. Lắng nghe các quy tắc bảo trì thiết bị
    onSnapshot(collection(db, "device_maintenance_rules"), (snapshot) => {
      const rules = snapshot.docs.map(d => d.data());
      calculateUpcomingMaintenance(rules);
    });

    // 4b. Lắng nghe báo cáo của tháng hiện tại để tính tổng tiêu thụ lũy kế
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const yyyy = startOfMonth.getFullYear();
    const mm = String(startOfMonth.getMonth() + 1).padStart(2, '0');
    const startOfMonthStr = `${yyyy}-${mm}-01`;

    document.getElementById("consumption-month-label").textContent = `Tháng ${startOfMonth.getMonth() + 1}/${yyyy}`;

    const qMonth = query(
      collection(db, "shift_reports"),
      where("reportDate", ">=", startOfMonthStr)
    );

    onSnapshot(qMonth, (snapshot) => {
      const monthReports = snapshot.docs.map(docSnap => docSnap.data());
      calculateMonthlyConsumption(monthReports);
    }, (err) => {
      console.error("Lỗi lắng nghe dữ liệu tháng hiện tại:", err);
    });

    // 5. Tải dữ liệu lưu lượng xả thải 7 ngày gần nhất để vẽ biểu đồ
    loadFlowDataAndRenderChart();

    // 6. Lắng nghe báo cáo chỉ số (Index - reports_1) gần nhất
    setupLatestIndexReportsListener();

    // 7. Lắng nghe báo cáo ngày nghỉ/làm việc đặc biệt (Index_2 - reports_2) gần nhất
    setupLatestIndex2ReportsListener();

  } catch (err) {
    console.error("Lỗi khởi tạo Dashboard:", err);
    showSwal("error", "Lỗi nạp Dashboard", err.message);
  } finally {
    hideLoading();
  }
}

// ============================================================
// HÀM TIỆN ÍCH CẬP NHẬT GIAO DIỆN
// ============================================================
function updateShiftKPI(shiftDoc) {
  const dateFormatted = shiftDoc.reportDate ? formatDateString(shiftDoc.reportDate) : "—";
  kpiShiftName.textContent = shiftDoc.shiftName || "Không rõ ca";
  
  const creator = shiftDoc.createdByName || shiftDoc.receivingStaff || "Chưa rõ nhân sự";
  kpiShiftDesc.textContent = `👤 Trực ca: ${creator} (${dateFormatted})`;
}

function updateWaterIndicators(outputList) {
  ["ph", "cod", "n", "tss", "clo"].forEach(paramType => {
    const valEl = document.getElementById(`water-val-${paramType}`);
    const badgeEl = document.getElementById(`water-badge-${paramType}`);
    
    if (outputList.length === 0) {
      valEl.textContent = "—";
      badgeEl.textContent = "Chưa đo";
      badgeEl.className = "water-kpi-status status-green";
      return;
    }

    const fieldName = paramType === "ph" ? "ph" : paramType;
    const vals = outputList.map(row => parseFloat(String(row[fieldName]).replace(",", "."))).filter(v => !isNaN(v));

    if (vals.length === 0) {
      valEl.textContent = "—";
      badgeEl.textContent = "Chưa đo";
      badgeEl.className = "water-kpi-status status-green";
      return;
    }

    let status = "green";
    let displayValStr = "";

    if (paramType === "ph") {
      const minPh = Math.min(...vals);
      const maxPh = Math.max(...vals);
      displayValStr = `${minPh} - ${maxPh}`;

      if (minPh < qcvnConfig.phMin || maxPh > qcvnConfig.phMax) {
        status = "red";
      } else {
        const yellowOffset = 0.3;
        if (minPh <= qcvnConfig.phMin + yellowOffset || maxPh >= qcvnConfig.phMax - yellowOffset) {
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

    valEl.textContent = displayValStr;

    if (status === "red") {
      badgeEl.textContent = "🔴 Vượt";
      badgeEl.className = "water-kpi-status status-red";
    } else if (status === "yellow") {
      badgeEl.textContent = "🟡 Cận";
      badgeEl.className = "water-kpi-status status-yellow";
    } else {
      badgeEl.textContent = "🟢 Đạt";
      badgeEl.className = "water-kpi-status status-green";
    }
  });
}

function resetWaterIndicatorsUI() {
  ["ph", "cod", "n", "tss", "clo"].forEach(p => {
    document.getElementById(`water-val-${p}`).textContent = "—";
    const badge = document.getElementById(`water-badge-${p}`);
    badge.textContent = "—";
    badge.className = "water-kpi-status status-green";
  });
}

// ============================================================
// TÍNH TOÁN LỊCH BẢO TRÌ TRONG 7 NGÀY TỚI
// ============================================================
function calculateUpcomingMaintenance(allRules) {
  const upcomingList = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Quét qua 7 ngày tiếp theo (từ hôm nay đến hôm nay + 6 ngày)
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() + i);

    const matches = allRules.filter(rule => ruleMatchesDate(rule, checkDate));
    matches.forEach(rule => {
      const checkDateFormatted = checkDate.toLocaleDateString("vi-VN", { day: '2-digit', month: '2-digit' });
      upcomingList.push({
        dateLabel: checkDateFormatted,
        dateObj: new Date(checkDate),
        deviceName: rule.deviceName || "Thiết bị",
        deviceCode: rule.deviceCode || "",
        job: rule.job || "Bảo dưỡng định kỳ",
        freq: rule.frequency || "—"
      });
    });
  }

  // Cập nhật số lượng KPI
  kpiMaintCount.textContent = upcomingList.length;
  kpiMaintDesc.textContent = `${upcomingList.length} đầu việc cần thực hiện`;

  if (upcomingList.length > 0) {
    upcomingMaintText.textContent = "⚠️ Vui lòng theo dõi lịch";
    upcomingMaintText.style.color = "var(--primary-color)";

    // Sắp xếp lịch theo thứ tự thời gian tăng dần
    upcomingList.sort((a, b) => a.dateObj - b.dateObj);

    upcomingMaintTableBody.innerHTML = upcomingList.map(task => `
      <tr>
        <td><strong>${task.dateLabel}</strong></td>
        <td>
          <span style="color:#16a085; font-weight:bold;">[${task.deviceCode || "Thiết bị"}]</span>
          ${task.deviceName}: ${task.job}
        </td>
        <td>${task.freq}</td>
      </tr>
    `).join("");
  } else {
    upcomingMaintText.textContent = "🟢 Không có lịch";
    upcomingMaintText.style.color = "#16a34a";
    upcomingMaintTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #16a34a; padding: 20px; font-weight: bold;">🟢 Tuần tới không có lịch bảo trì.</td></tr>`;
  }
}

// ============================================================
// TẢI DỮ LIỆU & VẼ BIỂU ĐỒ LƯU LƯỢNG NƯỚC THẢI 7 NGÀY GẦN NHẤT (ĐỐI SÁNH VÀO/RA)
// ============================================================
async function loadFlowDataAndRenderChart() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6); // Lấy chuẩn 7 ngày (gồm hôm nay)

    const yyyy = sevenDaysAgo.getFullYear();
    const mm = String(sevenDaysAgo.getMonth() + 1).padStart(2, '0');
    const dd = String(sevenDaysAgo.getDate()).padStart(2, '0');
    const sevenDaysAgoStr = `${yyyy}-${mm}-${dd}`;

    const qFlow = query(
      collection(db, "shift_reports"),
      where("reportDate", ">=", sevenDaysAgoStr)
    );

    const snap = await getDocs(qFlow);
    const reports = snap.docs.map(docSnap => docSnap.data());

    // Khởi tạo đối tượng gom nhóm theo ngày cho cả Đầu vào và Đầu ra
    const inflowMap = {};
    const outflowMap = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(sevenDaysAgo.getDate() + i);
      const isoKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      inflowMap[isoKey] = 0;
      outflowMap[isoKey] = 0;
    }

    // Gom dữ liệu lưu lượng đầu vào và đầu ra
    let grandTotalInflow = 0;
    let grandTotalOutflow = 0;

    reports.forEach(r => {
      if (r.reportDate && inflowMap[r.reportDate] !== undefined) {
        // Đầu vào (flow_in_total)
        const inValStr = String(r.meters?.flow_in_total || "0").replace(",", ".");
        const inVal = parseFloat(inValStr);
        if (!isNaN(inVal) && inVal > 0) {
          inflowMap[r.reportDate] += inVal;
          grandTotalInflow += inVal;
        }

        // Đầu ra (flow_out_total)
        const outValStr = String(r.meters?.flow_out_total || "0").replace(",", ".");
        const outVal = parseFloat(outValStr);
        if (!isNaN(outVal) && outVal > 0) {
          outflowMap[r.reportDate] += outVal;
          grandTotalOutflow += outVal;
        }
      }
    });

    chartTotalFlow.textContent = `Tổng vào: ${grandTotalInflow.toLocaleString("vi-VN")} m³ | Tổng ra: ${grandTotalOutflow.toLocaleString("vi-VN")} m³`;

    // Chuẩn bị nhãn ngày dạng DD/MM cho Chart
    const chartLabels = [];
    const chartInflowData = [];
    const chartOutflowData = [];

    Object.keys(inflowMap).sort().forEach(dateStr => {
      const parts = dateStr.split("-");
      chartLabels.push(`${parts[2]}/${parts[1]}`);
      chartInflowData.push(inflowMap[dateStr]);
      chartOutflowData.push(outflowMap[dateStr]);
    });

    renderChart(chartLabels, chartInflowData, chartOutflowData);

  } catch (err) {
    console.error("Lỗi tải lưu lượng vẽ biểu đồ:", err);
  }
}

function renderChart(labels, inflowData, outflowData) {
  const ctx = document.getElementById("flowChart").getContext("2d");
  
  if (flowChart) {
    flowChart.destroy();
  }

  // Sử dụng hai đường để đối sánh Lưu lượng đầu vào và đầu ra
  flowChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Lưu lượng đầu vào (Inflow)",
          data: inflowData,
          borderColor: "#10b981", // Màu xanh lá / Ngọc lục bảo
          backgroundColor: "rgba(16, 185, 129, 0.05)",
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointBackgroundColor: "#10b981",
          pointBorderColor: "#fff",
          pointHoverRadius: 6,
          pointRadius: 3
        },
        {
          label: "Lưu lượng đầu ra (Outflow)",
          data: outflowData,
          borderColor: "#2563eb", // Màu xanh dương chuyên nghiệp
          backgroundColor: "rgba(37, 99, 235, 0.05)",
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointBackgroundColor: "#2563eb",
          pointBorderColor: "#fff",
          pointHoverRadius: 6,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            boxWidth: 12,
            font: {
              size: 10,
              weight: "bold"
            }
          }
        },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.parsed.y.toLocaleString("vi-VN")} m³`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(0, 0, 0, 0.03)"
          },
          ticks: {
            callback: function(value) {
              return value.toLocaleString("vi-VN") + " m³";
            },
            font: {
              size: 9
            }
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            font: {
              size: 9
            }
          }
        }
      }
    }
  });
}

// ============================================================
// TIỆN ÍCH PHỤ TRỢ HÀM ĐỔI ĐỊNH DẠNG NGÀY
// ============================================================
function formatDateString(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// Tính toán tiêu hao lũy kế trong tháng hiện tại
function calculateMonthlyConsumption(reports) {
  const reportCountEl = document.getElementById("consumption-report-count");
  if (reportCountEl) {
    reportCountEl.textContent = `Dựa trên ${reports.length} báo cáo ca`;
  }

  let totalElectricity = 0;
  let totalWater = 0;
  let totalFlow = 0;
  const chemicalTotals = {};

  reports.forEach(r => {
    // 1. Điện năng (dien_sl)
    if (r.meters?.dien_sl) {
      const val = parseFloat(String(r.meters.dien_sl).replace(",", "."));
      if (!isNaN(val)) totalElectricity += val;
    }
    // 2. Nước cấp (nuoc_sl)
    if (r.meters?.nuoc_sl) {
      const val = parseFloat(String(r.meters.nuoc_sl).replace(",", "."));
      if (!isNaN(val)) totalWater += val;
    }
    // 3. Nước thải xả ra (flow_out_total)
    if (r.meters?.flow_out_total) {
      const val = parseFloat(String(r.meters.flow_out_total).replace(",", "."));
      if (!isNaN(val)) totalFlow += val;
    }
    // 4. Hóa chất tiêu hao
    if (Array.isArray(r.chemicals)) {
      r.chemicals.forEach(chem => {
        const name = chem.chemicalName ? chem.chemicalName.trim() : "";
        if (name) {
          const qty = parseFloat(String(chem.quantity).replace(",", "."));
          if (!isNaN(qty)) {
            chemicalTotals[name] = (chemicalTotals[name] || 0) + qty;
          }
        }
      });
    }
  });

  const electricityEl = document.getElementById("monthly-val-electricity");
  const waterEl = document.getElementById("monthly-val-water");
  const flowEl = document.getElementById("monthly-val-flow");
  const chemicalsEl = document.getElementById("monthly-val-chemicals");

  if (electricityEl) electricityEl.textContent = `${totalElectricity.toLocaleString("vi-VN")} kWh`;
  if (waterEl) waterEl.textContent = `${totalWater.toLocaleString("vi-VN")} m³`;
  if (flowEl) flowEl.textContent = `${totalFlow.toLocaleString("vi-VN")} m³`;

  if (chemicalsEl) {
    const chemKeys = Object.keys(chemicalTotals).sort();
    if (chemKeys.length > 0) {
      const chemListHtml = chemKeys.map(name => {
        return `<div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dashed rgba(0,0,0,0.05);">
          <span style="font-weight: 500; font-size: 0.75rem;">${name}</span>
          <span style="font-weight: bold; font-size: 0.75rem; color: #16a085;">${chemicalTotals[name].toLocaleString("vi-VN")} kg</span>
        </div>`;
      }).join("");
      chemicalsEl.innerHTML = chemListHtml;
    } else {
      chemicalsEl.innerHTML = `<div style="color: #64748b; font-style: italic; font-size: 0.75rem; text-align: center; margin-top: 10px;">Chưa tiêu thụ hóa chất</div>`;
    }
  }
}

// ============================================================
// LẮNG NGHE BÁO CÁO INDEX & INDEX_2 GẦN NHẤT
// ============================================================
function setupLatestIndexReportsListener() {
  const qIndex1 = query(
    collection(db, "reports_1"),
    orderBy("ngay_ghi", "desc"),
    limit(100)
  );

  onSnapshot(qIndex1, (snapshot) => {
    const tableBody = document.getElementById("latest-index-table-body");
    const dateLabel = document.getElementById("latest-index-date");

    if (!tableBody || !dateLabel) return;

    if (snapshot.empty) {
      dateLabel.textContent = "Chưa có dữ liệu";
      tableBody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: #64748b; padding: 15px;">🟢 Chưa có báo cáo chỉ số nào.</td></tr>`;
      return;
    }

    const records = snapshot.docs.map(doc => doc.data());
    const maxDate = records[0].ngay_ghi;

    if (!maxDate) {
      dateLabel.textContent = "Chưa có dữ liệu";
      tableBody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: #64748b; padding: 15px;">Không tìm thấy ngày hợp lệ.</td></tr>`;
      return;
    }

    // Lọc các bản ghi trùng với maxDate
    const latestRecords = records.filter(r => r.ngay_ghi === maxDate);

    // Loại bỏ bản ghi trùng lặp hoàn toàn (cùng công ty, chỉ số và ghi chú)
    const uniqueMap = new Map();
    latestRecords.forEach(r => {
      const compKey = `${r.company || "unknown"}_${r.chi_so || 0}_${r.ghi_chu || ""}`;
      if (!uniqueMap.has(compKey)) {
        uniqueMap.set(compKey, r);
      }
    });

    const uniqueRecords = Array.from(uniqueMap.values());
    uniqueRecords.sort((a, b) => (a.company || "").localeCompare(b.company || ""));

    dateLabel.textContent = formatDateString(maxDate);

    tableBody.innerHTML = uniqueRecords.map(r => {
      const formattedVal = (r.chi_so !== undefined && r.chi_so !== null)
        ? new Intl.NumberFormat("de-DE").format(r.chi_so)
        : "—";
      const noteHtml = r.ghi_chu ? ` <span style="font-weight: normal; font-size: 0.72rem; color: #64748b; font-style: italic;">(${r.ghi_chu})</span>` : "";
      return `
        <tr>
          <td><strong>${r.company || "Chưa rõ"}</strong>${noteHtml}</td>
          <td style="color: var(--primary-color); font-weight: bold; text-align: center;">${formattedVal}</td>
        </tr>
      `;
    }).join("");
  }, (err) => {
    console.error("Lỗi khi lắng nghe báo cáo chỉ số gần nhất:", err);
  });
}

let allMasterCompanies = [];
let allCompanyConfigs = [];
let oldDefaultHolidays = {};

async function loadCompanyConfigs() {
  try {
    const [masterSnap, configSnap, settingsSnap] = await Promise.all([
      getDocs(collection(db, "companies_master")),
      getDocs(collection(db, "company_configs")),
      getDoc(doc(db, "settings", "reportConfig"))
    ]);

    allMasterCompanies = masterSnap.docs.map(doc => doc.data().company).filter(Boolean);
    if (allMasterCompanies.length === 0) {
      allMasterCompanies = ['NTSF', 'Ấn Độ Dương', 'Đại Tây Dương', 'Amicogen', 'Cá Việt Nam', 'Honoroad', 'Petec', 'Trường Hải', 'Tân Cảng', 'VNPT'];
    }

    allCompanyConfigs = configSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    if (settingsSnap.exists()) {
      oldDefaultHolidays = settingsSnap.data().defaultHolidays || {};
    }
  } catch (err) {
    console.error("Lỗi khi tải cấu hình ngày nghỉ mặc định:", err);
  }
}

function isCompanyDefaultHoliday(company, dateStr) {
  const dateObj = new Date(dateStr + "T00:00:00");
  const dayOfWeek = dateObj.getDay();

  // 1. Kiểm tra cấu hình lịch sử từ company_configs
  const configs = allCompanyConfigs.filter(c => c.company === company);
  if (configs.length > 0) {
    configs.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const validConfig = configs.find(c => c.effectiveDate <= dateStr) || configs[configs.length - 1];
    if (validConfig && validConfig.defaultHolidays) {
      return validConfig.defaultHolidays.includes(dayOfWeek);
    }
  }

  // 2. Fallback sang settings/reportConfig cũ
  const defaultHolidaySetting = oldDefaultHolidays[company];
  if (defaultHolidaySetting === 'sat-sun' || defaultHolidaySetting === 'sat_sun') {
    return (dayOfWeek === 0 || dayOfWeek === 6);
  } else if (defaultHolidaySetting === 'sun' || defaultHolidaySetting === 'sun_only') {
    return (dayOfWeek === 0);
  } else if (defaultHolidaySetting === 'sat') {
    return (dayOfWeek === 6);
  }

  return false;
}

function setupLatestIndex2ReportsListener() {
  const qIndex2 = query(
    collection(db, "reports_2"),
    orderBy("createdAt", "desc"),
    limit(150)
  );

  onSnapshot(qIndex2, (snapshot) => {
    const tableBody = document.getElementById("latest-index2-table-body");

    if (!tableBody) return;

    if (snapshot.empty && allMasterCompanies.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: #64748b; padding: 15px;">🟢 Chưa có báo cáo ngày nghỉ nào.</td></tr>`;
      return;
    }

    const records = snapshot.docs.map(doc => doc.data());

    // 1. Thu thập tất cả các ngày nghỉ / ngày làm việc đặc biệt từ reports_2
    const manualDateSet = new Set();
    records.forEach(r => {
      if (r.ngay_nghi) {
        r.ngay_nghi.split(",").map(d => d.trim()).forEach(d => {
          if (d) manualDateSet.add(d);
        });
      }
      if (r.ngay_lam_db) {
        manualDateSet.add(r.ngay_lam_db.trim());
      }
    });

    // 2. Quét ngược từ hôm nay trở về trước (tối đa 30 ngày) để tìm các ngày có sự kiện (báo cáo thủ công hoặc ngày nghỉ mặc định)
    const top5Dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = formatISODate(d);

      // Kiểm tra xem ngày này có báo cáo thủ công không
      const hasManual = manualDateSet.has(dateStr);

      // Kiểm tra xem ngày này có là ngày nghỉ mặc định của công ty nào không
      let hasDefaultHoliday = false;
      for (const comp of allMasterCompanies) {
        if (isCompanyDefaultHoliday(comp, dateStr)) {
          hasDefaultHoliday = true;
          break;
        }
      }

      if (hasManual || hasDefaultHoliday) {
        top5Dates.push(dateStr);
        if (top5Dates.length === 5) {
          break;
        }
      }
    }

    if (top5Dates.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: #64748b; padding: 15px;">Không tìm thấy ngày nghỉ/làm ĐB nào.</td></tr>`;
      return;
    }

    const htmlRows = [];

    top5Dates.forEach(dateStr => {
      const dateObj = new Date(dateStr + "T00:00:00");
      const dayOfWeek = dateObj.getDay();

      // Gom tất cả các bản ghi thủ công cho ngày này
      const manualRecords = records.filter(r => {
        const dates = (r.ngay_nghi || r.ngay_lam_db || "").split(",").map(d => d.trim());
        return dates.includes(dateStr);
      });

      // Loại bỏ trùng lặp thủ công (cùng công ty, ngày nghỉ/làm việc, ghi chú)
      const manualMap = new Map();
      manualRecords.forEach(r => {
        const compKey = `${r.company || "unknown"}_${r.ngay_nghi || ""}_${r.ngay_lam_db || ""}_${r.ghi_chu || ""}`;
        if (!manualMap.has(compKey)) {
          manualMap.set(compKey, r);
        }
      });
      const uniqueManual = Array.from(manualMap.values());

      // Tạo map để tra cứu nhanh báo cáo thủ công
      const companyStatusMap = new Map();
      uniqueManual.forEach(r => {
        const comp = r.company;
        if (comp) {
          companyStatusMap.set(comp, r);
        }
      });

      const dayCompanies = [];

      // 1. Thêm các công ty có báo cáo thủ công cho ngày này
      uniqueManual.forEach(r => {
        const comp = r.company;
        let statusHtml = "";
        let desc = "";
        if (r.ngay_nghi) {
          statusHtml = `<span style="color: #dc2626; font-weight: bold;">Nghỉ</span>`;
        } else if (r.ngay_lam_db) {
          statusHtml = `<span style="color: #16a34a; font-weight: bold;">Làm ĐB</span>`;
        }
        if (r.ghi_chu) {
          desc = ` - Ghi chú: ${r.ghi_chu}`;
        }
        dayCompanies.push({ company: comp, statusHtml, desc, isDefault: false });
      });

      // 2. Duyệt qua tất cả các công ty cấu hình để tìm ngày nghỉ mặc định (nếu chưa có báo cáo thủ công)
      allMasterCompanies.forEach(comp => {
        if (!companyStatusMap.has(comp)) {
          if (isCompanyDefaultHoliday(comp, dateStr)) {
            const statusHtml = `<span style="color: #64748b; font-weight: 500;">Nghỉ</span>`;
            dayCompanies.push({ company: comp, statusHtml, desc: "", isDefault: true });
          }
        }
      });

      // Sắp xếp các công ty theo alphabet cho ngày này
      dayCompanies.sort((a, b) => a.company.localeCompare(b.company));

      dayCompanies.forEach(item => {
        const formattedDate = formatDateString(dateStr);
        let dayName = getDayOfWeekName(dateStr);
        if (item.isDefault) {
          dayName += " - mặc định";
        }
        htmlRows.push(`
          <tr>
            <td><strong>${item.company}</strong></td>
            <td>${item.statusHtml} 📅 ${formattedDate} (${dayName})${item.desc}</td>
          </tr>
        `);
      });
    });

    if (htmlRows.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: #64748b; padding: 15px;">Không có ngày nghỉ nào trong các ngày gần đây.</td></tr>`;
    } else {
      tableBody.innerHTML = htmlRows.join("");
    }
  }, (err) => {
    console.error("Lỗi khi lắng nghe báo cáo index_2 gần nhất:", err);
  });
}

function getLatestDateFromRecord(r) {
  const dateStr = r.ngay_nghi || r.ngay_lam_db || "";
  if (!dateStr) return null;
  const dates = dateStr.split(",").map(d => d.trim()).filter(d => d);
  if (dates.length === 0) return null;
  dates.sort();
  return dates[dates.length - 1]; // Trả về ngày lớn nhất dạng YYYY-MM-DD
}

function getDayOfWeekName(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const dayNames = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  return dayNames[day] || "";
}

function formatISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
