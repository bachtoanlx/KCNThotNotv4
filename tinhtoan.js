// tinhtoan.js
import { onAuth, loadTemplate } from "./script.js";
import { initMenu } from "./menu.js";

// --- TẢI GIAO DIỆN CHUNG ---
loadTemplate("menu-placeholder", "menu.html", () => {
  initMenu();
});
loadTemplate("loading-placeholder", "modal.html");
loadTemplate("footer-placeholder", "footer.html");


// --- KIỂM TRA ĐĂNG NHẬP ---
const notLogged = document.getElementById("notLogged");
const content = document.getElementById("pageContent");

onAuth((user) => {
  if (user) {
    notLogged.style.display = "none";
    content.style.display = "block";
    restoreInputs(); // Khôi phục dữ liệu đã lưu
  } else {
    notLogged.style.display = "flex";
    content.style.display = "none";
  }
});

// --- THAM CHIẾU DOM ---
// Bơm chính
const flowRateMain = document.getElementById("flowRateMain");
const hoursMain = document.getElementById("hoursMain");

// Chlorine
const weightCl = document.getElementById("weightCl");
const purityCl = document.getElementById("purityCl");
const tankVolCl = document.getElementById("tankVolCl");
const pumpFlowCl = document.getElementById("pumpFlowCl");
const clConversionText = document.getElementById("clConversionText");
const pumpMinCl = document.getElementById("pumpMinCl");
const pumpMaxCl = document.getElementById("pumpMaxCl");

// PAC
const weightPac = document.getElementById("weightPac");
const tankVolPac = document.getElementById("tankVolPac");
const pumpFlowPac = document.getElementById("pumpFlowPac");
const pacConversionText = document.getElementById("pacConversionText");
const pumpMinPac = document.getElementById("pumpMinPac");
const pumpMaxPac = document.getElementById("pumpMaxPac");

// Polymer A
const weightPoly = document.getElementById("weightPoly");
const tankVolPoly = document.getElementById("tankVolPoly");
const pumpFlowPoly = document.getElementById("pumpFlowPoly");
const polyConversionText = document.getElementById("polyConversionText");
const pumpMinPoly = document.getElementById("pumpMinPoly");
const pumpMaxPoly = document.getElementById("pumpMaxPoly");

// Nút bấm & Kết quả
const btnCalculate = document.getElementById("btnCalculate");
const resFlowRate = document.getElementById("resFlowRate");
const resChlorine = document.getElementById("resChlorine");
const resPac = document.getElementById("resPac");
const resPoly = document.getElementById("resPoly");
const resClVol = document.getElementById("resClVol");
const resPacVol = document.getElementById("resPacVol");
const resPolyVol = document.getElementById("resPolyVol");
const resTotalWater = document.getElementById("resTotalWater");
const analysisCard = document.getElementById("analysisCard");
const analysisDetails = document.getElementById("analysisDetails");

// --- CẤU HÌNH HÓA CHẤT MẶC ĐỊNH & ĐỘNG ---
const DEFAULT_CONFIGS = {
  cl: { targetDose: 3.0, recommendMin: 3.0, recommendMax: 10.0, cMin: 1.0, cMax: 5.0 },
  pac: { targetDose: 15.0, recommendMin: 15.0, recommendMax: 30.0, cMin: 5.0, cMax: 10.0 },
  poly: { targetDose: 1.0, recommendMin: 1.0, recommendMax: 3.0, cMin: 0.1, cMax: 0.2 }
};

let customConfigs = {};
try {
  const saved = localStorage.getItem("tinhtoan_custom_configs");
  if (saved) {
    customConfigs = JSON.parse(saved);
  }
} catch (e) {
  console.warn("Lỗi đọc custom configs:", e);
}

function getChemConfigVal(chemId, key) {
  if (customConfigs[chemId] && customConfigs[chemId][key] !== undefined) {
    return customConfigs[chemId][key];
  }
  return DEFAULT_CONFIGS[chemId][key];
}

const CHEM_CONFIG = {
  cl: {
    name: "Chlorine",
    get targetDose() { return getChemConfigVal("cl", "targetDose"); },
    get recommendMin() { return getChemConfigVal("cl", "recommendMin"); },
    get recommendMax() { return getChemConfigVal("cl", "recommendMax"); },
    get cMin() { return getChemConfigVal("cl", "cMin"); },
    get cMax() { return getChemConfigVal("cl", "cMax"); },
    getPurity: () => parseFloat(purityCl.value) || 70,
    volInput: tankVolCl,
    pumpInput: pumpFlowCl,
    weightInput: weightCl,
    convText: clConversionText,
    getMinPump: () => parseFloat(pumpMinCl.value) || 0,
    getMaxPump: () => parseFloat(pumpMaxCl.value) || Infinity,
  },
  pac: {
    name: "PAC",
    get targetDose() { return getChemConfigVal("pac", "targetDose"); },
    get recommendMin() { return getChemConfigVal("pac", "recommendMin"); },
    get recommendMax() { return getChemConfigVal("pac", "recommendMax"); },
    get cMin() { return getChemConfigVal("pac", "cMin"); },
    get cMax() { return getChemConfigVal("pac", "cMax"); },
    getPurity: () => 100,
    volInput: tankVolPac,
    pumpInput: pumpFlowPac,
    weightInput: weightPac,
    convText: pacConversionText,
    getMinPump: () => parseFloat(pumpMinPac.value) || 0,
    getMaxPump: () => parseFloat(pumpMaxPac.value) || Infinity,
  },
  poly: {
    name: "Polymer A",
    get targetDose() { return getChemConfigVal("poly", "targetDose"); },
    get recommendMin() { return getChemConfigVal("poly", "recommendMin"); },
    get recommendMax() { return getChemConfigVal("poly", "recommendMax"); },
    get cMin() { return getChemConfigVal("poly", "cMin"); },
    get cMax() { return getChemConfigVal("poly", "cMax"); },
    getPurity: () => 100,
    volInput: tankVolPoly,
    pumpInput: pumpFlowPoly,
    weightInput: weightPoly,
    convText: polyConversionText,
    getMinPump: () => parseFloat(pumpMinPoly.value) || 0,
    getMaxPump: () => parseFloat(pumpMaxPoly.value) || Infinity,
  }
};

// --- HÀM TÍNH TOÁN REAL-TIME THEO KHỐI LƯỢNG VÀ GIỚI HẠN BƠM (DÙNG HẾT BỒN) ---
function handleWeightChange(chemId, silent = false) {
  const config = CHEM_CONFIG[chemId];
  if (!config) return;

  const Q_dh = parseFloat(flowRateMain.value) || 0;
  const H = parseFloat(hoursMain.value) || 0;

  // Đọc khối lượng hiện tại
  let M = parseFloat(config.weightInput.value) || 0;
  const purity = config.getPurity();

  if (M <= 0) {
    config.volInput.value = "";
    config.pumpInput.value = "";
    config.convText.innerHTML = `<span style="color: var(--danger-color);">⚠️ Vui lòng nhập khối lượng > 0 kg</span>`;
    return;
  }

  // 1. Ràng buộc nồng độ dung dịch từ giới hạn lưu lượng bơm.
  // Nhằm châm hết bồn pha sẵn trong ca, lưu lượng bơm định lượng mặc định là Q = V / H.
  // Từ Q_min <= V / H <= Q_max => Q_min * H <= V <= Q_max * H.
  // Đồng thời, C_min <= (M * purity) / V <= C_max => (M * purity) / C_max <= V <= (M * purity) / C_min.
  const Q_min = config.getMinPump();
  const Q_max = config.getMaxPump();

  let V_allowed_min = (M * purity) / config.cMax;
  if (H > 0) {
    V_allowed_min = Math.max(V_allowed_min, Q_min * H);
  }

  let V_allowed_max = (M * purity) / config.cMin;
  if (H > 0 && Q_max > 0) {
    V_allowed_max = Math.min(V_allowed_max, Q_max * H);
  }
  V_allowed_max = Math.min(V_allowed_max, 2000);

  let hardwareConflict = false;
  if (V_allowed_min > V_allowed_max) {
    // Mâu thuẫn phần cứng (ví dụ: bơm quá nhỏ so với yêu cầu hòa tan lượng bột đã nhập)
    // Ưu tiên nồng độ an toàn tối đa và giới hạn bơm tối đa
    V_allowed_min = V_allowed_max;
    hardwareConflict = true;
  }

  // Chọn thể tích tối ưu để nồng độ là thấp nhất (tức là V lớn nhất trong khoảng cho phép)
  let V = V_allowed_max;
  let C = (M * purity) / V;

  // Nếu nồng độ thực tế vượt giới hạn an toàn tối đa (hoặc thể tích nhỏ hơn V_allowed_min), điều chỉnh lại
  if (C > config.cMax || V < V_allowed_min) {
    C = config.cMax;
    // Kiểm tra giới hạn nồng độ từ Q_min nếu cần
    if (H > 0 && Q_min > 0 && Q_dh > 0) {
      const c_pump_max = (config.targetDose * Q_dh) / (10 * Q_min);
      C = Math.min(C, c_pump_max);
    }

    V = (M * purity) / C;

    let V_max_cap = 2000;
    if (H > 0 && Q_max > 0) {
      V_max_cap = Math.min(V_max_cap, Q_max * H);
    }

    if (V > V_max_cap) {
      V = V_max_cap;
      const M_limit = (V * C) / purity;
      M = M_limit;
      config.weightInput.value = M.toFixed(2);

      if (!silent) {
        let title = "Vượt giới hạn bồn chứa";
        let message = `Khối lượng hóa chất châm quá lớn (<b>${M.toFixed(2)} kg</b>) vượt quá khả năng hòa tan an toàn trong bồn tối đa hoặc giới hạn bơm.<br><br>` +
                      `<b>💡 Hướng xử lý đề xuất:</b><br>` +
                      `1. Hệ thống đã tự động điều chỉnh thể tích bồn về <b>${V.toFixed(1)} lít</b> và giảm khối lượng bột xuống mức tối đa <b>${M_limit.toFixed(2)} kg</b>.<br>` +
                      `2. Vui lòng chia nhỏ lượng hóa chất hoặc nâng cấp công suất thiết bị.`;

        if (hardwareConflict) {
          title = "Giới hạn bơm không đáp ứng";
          message = `Bơm định lượng có dải hoạt động quá nhỏ so với yêu cầu châm.<br><br>` +
                    `<b>💡 Hướng xử lý đề xuất:</b><br>` +
                    `1. Hệ thống đã tự động đưa bồn về giới hạn lớn nhất <b>${V.toFixed(1)} lít</b> và điều chỉnh khối lượng pha về mức <b>${M_limit.toFixed(2)} kg</b>.<br>` +
                    `2. Vui lòng cân nhắc nâng cấp bơm định lượng có công suất lớn hơn.`;
        }

        Swal.fire({
          title: title,
          html: `<div style="text-align: left; font-size: 13px; line-height: 1.5;">${message}</div>`,
          icon: "warning",
          confirmButtonText: "Đồng ý",
          confirmButtonColor: "#273668",
        });
      }
    }
  }

  // Cập nhật thể tích
  config.volInput.value = V.toFixed(1);

  // 5. Tính lưu lượng bơm định lượng thực tế Q = V / H
  let Q = 0;
  if (H > 0) {
    Q = V / H;
    
    // Đảm bảo Q nằm trong giới hạn cứng của bơm
    if (Q < Q_min && Q_min > 0) Q = Q_min;
    if (Q > Q_max && Q_max > 0) Q = Q_max;

    config.pumpInput.value = Q.toFixed(1);
  } else {
    config.pumpInput.value = "";
  }

  // Hiển thị dòng quy đổi trực quan
  C = (M * purity) / V;
  if (chemId === "cl") {
    if (purity === 100) {
      config.convText.innerHTML = `Quy đổi: Nồng độ = <strong>${C.toFixed(3)}%</strong> (tương ứng ${M.toFixed(2)} kg trong ${V.toFixed(1)} lít)`;
    } else {
      config.convText.innerHTML = `Quy đổi: Nồng độ Clo hoạt tính = <strong>${C.toFixed(3)}%</strong> (tương ứng ${M.toFixed(2)} kg Clo bột ${purity}% trong ${V.toFixed(1)} lít)`;
    }
  } else {
    config.convText.innerHTML = `Quy đổi: Nồng độ = <strong>${C.toFixed(3)}%</strong> (tương ứng ${M.toFixed(2)} kg trong ${V.toFixed(1)} lít)`;
  }
}

// --- HÀM TÍNH TOÁN VÀ ĐÁNH GIÁ CHUNG ---
function calculate(silent = false) {
  const Q_dh = parseFloat(flowRateMain.value) || 0;
  const H = parseFloat(hoursMain.value) || 0;

  // Kiểm tra thông số chính
  if (Q_dh <= 0 || H <= 0) {
    if (!silent) {
      Swal.fire({
        title: "Thiếu thông số",
        text: "Vui lòng nhập Lưu lượng bơm điều hòa và Số giờ chạy bơm lớn hơn 0.",
        icon: "warning",
        confirmButtonText: "Đồng ý",
        confirmButtonColor: "#273668",
      });
    }
    return;
  }
  if (H > 24) {
    if (!silent) {
      Swal.fire({
        title: "Sai số giờ",
        text: "Số giờ chạy bơm trong ca không thể vượt quá 24 giờ.",
        icon: "error",
        confirmButtonText: "Đồng ý",
        confirmButtonColor: "#273668",
      });
    }
    return;
  }

  // 1. Tính Lưu lượng xử lý (m3/ca)
  const Q_xl = Q_dh * H;
  resFlowRate.textContent = new Intl.NumberFormat("vi-VN").format(Math.round(Q_xl));

  let totalWaterToMix = 0;
  let analysisHtml = "";

  // Tính toán và hiển thị cho từng hóa chất
  Object.keys(CHEM_CONFIG).forEach((chemId) => {
    const config = CHEM_CONFIG[chemId];
    const M_prepared = parseFloat(config.weightInput.value) || 0;
    const V_tank = parseFloat(config.volInput.value) || 0;
    const Q_pump = parseFloat(config.pumpInput.value) || 0;
    const purity = config.getPurity();
    const Q_min = config.getMinPump();
    const Q_max = config.getMaxPump();

    if (M_prepared <= 0 || V_tank <= 0 || Q_pump <= 0) {
      if (chemId === "cl") {
        resChlorine.textContent = "0";
        resClVol.textContent = "0.0 lít/ca dung dịch";
      } else if (chemId === "pac") {
        resPac.textContent = "0";
        resPacVol.textContent = "0.0 lít/ca dung dịch";
      } else if (chemId === "poly") {
        resPoly.textContent = "0";
        resPolyVol.textContent = "0.0 lít/ca dung dịch";
      }
      return;
    }

    // Dung dịch tiêu thụ trong ca (lít)
    const V_dosed = Q_pump * H;
    
    // Lượng hóa chất bột tiêu thụ tương ứng (kg)
    const M_day = V_dosed * (M_prepared / V_tank);

    // Cập nhật kết quả hiển thị
    if (chemId === "cl") {
      resChlorine.textContent = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(M_day);
      resClVol.textContent = V_dosed.toFixed(1) + " lít/ca dung dịch";
    } else if (chemId === "pac") {
      resPac.textContent = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(M_day);
      resPacVol.textContent = V_dosed.toFixed(1) + " lít/ca dung dịch";
    } else if (chemId === "poly") {
      resPoly.textContent = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(M_day);
      resPolyVol.textContent = V_dosed.toFixed(1) + " lít/ca dung dịch";
    }

    totalWaterToMix += V_tank;

    // Nồng độ thực tế
    const percent = (M_prepared * purity) / V_tank;

    // Định mức châm thực tế đạt được
    const achievedDose = (M_day * (purity / 100) * 1000) / Q_xl;

    // --- SINH NỘI DUNG ĐÁNH GIÁ ĐƠN GIẢN HÓA ---
    const targetDose = config.targetDose;
    const deviationPercent = (achievedDose - targetDose) / targetDose;

    let statusBadge = "";
    const recommendMin = config.recommendMin;
    const recommendMax = config.recommendMax;

    if (achievedDose < recommendMin * 0.90) {
      statusBadge = `<span class="status-pill pill-danger">Thiếu liều châm</span>`;
    } else if (achievedDose > recommendMax * 1.05) {
      statusBadge = `<span class="status-pill pill-danger">Thừa liều châm</span>`;
    } else {
      // Nằm trong dải khuyến cáo kỹ thuật
      if (Math.abs(deviationPercent) <= 0.10) {
        statusBadge = `<span class="status-pill pill-success">Đạt yêu cầu</span>`;
      } else {
        statusBadge = `<span class="status-pill pill-warning">Chưa tối ưu</span>`;
      }
    }

    // Kiểm tra quá tải bồn châm (dung sai 2% tránh sai số làm tròn số)
    const isOverloaded = V_dosed > V_tank * 1.02;
    let overloadAlert = "";
    if (isOverloaded) {
      overloadAlert = `<div class="alert-calc" style="margin-top: 8px;">` +
                      `⚠️ <strong>Quá tải bồn chứa:</strong> Lượng dung dịch châm (${V_dosed.toFixed(1)}L) lớn hơn thể tích bồn (${V_tank.toFixed(1)}L).<br>` +
                      `👉 <strong>Cách xử lý:</strong> Hãy tăng khối lượng hóa chất pha bột ($M$) để tăng nồng độ bồn, giúp giảm lưu lượng bơm và thể tích bồn cần pha.` +
                      `</div>`;
    }

    // Chu kỳ hoạt động
    let scheduleInfo = "";
    if (V_dosed > 0) {
      const days = V_tank / V_dosed;
      if (Math.abs(days - 1.0) <= 0.05) {
        scheduleInfo = `Dùng vừa hết bồn trong ca chạy máy (${H} giờ)`;
      } else {
        scheduleInfo = `Dung dịch trong bồn dùng được khoảng <strong>${days.toFixed(2)} ca</strong> (tiêu thụ ${V_dosed.toFixed(1)} lít/ca)`;
      }
    }

    // Gợi ý kỹ thuật khi bị lệch liều châm đáng kể
    let adviceHtml = "";
    const M_target = (config.targetDose * Q_dh * H) / (10 * purity);

    if (achievedDose < recommendMin * 0.90) {
      if (Math.abs(Q_pump - Q_max) <= 0.05) {
        adviceHtml = `<div style="font-size: 11px; color:#c0392b; margin-top:3px; font-weight:600;">💡 Gợi ý: Bơm châm hết công suất Max (${Q_max} L/h) nhưng vẫn thiếu liều châm. Cần nâng cấp bơm công suất lớn hơn.</div>`;
      } else {
        adviceHtml = `<div style="font-size: 11px; color:#c0392b; margin-top:3px; font-weight:500;">💡 Gợi ý: Lượng hóa chất pha nhỏ hơn nhu cầu. Hãy tăng khối lượng bột pha lên khoảng <strong>${M_target.toFixed(2)} kg</strong> để châm đạt chuẩn tối ưu ${targetDose.toFixed(1)} ppm.</div>`;
      }
    } else if (achievedDose > recommendMax * 1.05) {
      if (Math.abs(Q_pump - Q_min) <= 0.05) {
        adviceHtml = `<div style="font-size: 11px; color:#c0392b; margin-top:3px; font-weight:600;">💡 Gợi ý: Bơm chạy ở mức Min (${Q_min} L/h) nhưng vẫn thừa liều châm. Cần thay bơm có công suất nhỏ hơn hoặc pha loãng bồn thêm.</div>`;
      } else {
        adviceHtml = `<div style="font-size: 11px; color:#c0392b; margin-top:3px; font-weight:500;">💡 Gợi ý: Liều châm vượt quá giới hạn khuyến cáo kỹ thuật. Cần giảm lượng bột pha xuống khoảng <strong>${M_target.toFixed(2)} kg</strong> để châm đạt chuẩn tối ưu ${targetDose.toFixed(1)} ppm.</div>`;
      }
    } else if (achievedDose > config.targetDose * 1.10) {
      // Dải nằm trong khuyến cáo kỹ thuật nhưng vượt quá tối ưu kinh tế
      adviceHtml = `<div style="font-size: 11px; color:#b45309; margin-top:3px; font-weight:500;">💡 Gợi ý: Lượng hóa chất pha lớn hơn mức tối ưu. Hãy giảm khối lượng bột pha xuống khoảng <strong>${M_target.toFixed(2)} kg</strong> để châm đạt chuẩn tối ưu ${targetDose.toFixed(1)} ppm nếu cần tối ưu chi phí.</div>`;
    }

    // Cảnh báo nếu nồng độ bồn nằm ngoài khuyến cáo tối ưu của hóa chất
    let mixWarning = "";
    const roundedPercent = Math.round(percent * 1000) / 1000;
    if (roundedPercent > 0 && (roundedPercent < config.cMin || roundedPercent > config.cMax)) {
      mixWarning = `<div style="font-size: 11px; color:#e67e22; margin-top:3px; font-weight:500;">⚠️ Lưu ý pha bồn: Nồng độ thực tế (${percent.toFixed(2)}%) nằm ngoài dải khuyến cáo tối ưu (${config.cMin}% - ${config.cMax}%).</div>`;
    }

    analysisHtml += `
      <div class="chem-analysis-item" style="padding: 10px 0; border-bottom: 1px solid var(--border-color);">
        <div class="d-flex justify-between align-center" style="margin-bottom: 6px;">
          <span style="font-weight: 700; color: var(--primary-color); font-size: 13px;">${config.name}</span>
          ${statusBadge}
        </div>
        <ul style="list-style: none; padding-left: 0; margin: 0; font-size: 11.5px; color: #475569; line-height: 1.5;">
          <li>• Pha bồn: <strong>${M_prepared.toFixed(2)} kg</strong> trong bồn <strong>${V_tank.toFixed(0)} lít</strong> (nồng độ ${percent.toFixed(2)}%)</li>
          <li>• Chạy bơm: <strong>${Q_pump.toFixed(1)} lít/giờ</strong></li>
          <li>• Nồng độ châm vào nước thải: <strong>${achievedDose.toFixed(2)} ppm</strong> (Khuyến cáo: ${recommendMin.toFixed(1)} - ${recommendMax.toFixed(1)} ppm)</li>
          <li>• Chu kỳ: ${scheduleInfo}</li>
        </ul>
        ${overloadAlert}
        ${mixWarning}
        ${adviceHtml}
      </div>
    `;
  });

  // Tổng nước cần pha
  resTotalWater.textContent = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(totalWaterToMix / 1000);

  // Hiển thị Card đánh giá
  analysisDetails.innerHTML = analysisHtml;
  analysisCard.style.display = "block";

  // Cuộn đến kết quả
  if (!silent) {
    const resultsCard = document.getElementById("resultsCard");
    if (resultsCard) {
      resultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    Swal.fire({
      title: "Thành công",
      text: "Tính toán nhanh hoàn tất. Kết quả chi tiết đã được cập nhật ở cột bên phải.",
      icon: "success",
      timer: 2000,
      showConfirmButton: false,
    });
  }

  saveInputs();
}

// --- HÀM TỰ ĐỘNG TỐI ƯU HÓA BAN ĐẦU (TỐI ƯU ĐỂ ĐẠT TARGET DOSE VÀ DÙNG HẾT BỒN) ---
function optimize(silent = false) {
  const Q_dh = parseFloat(flowRateMain.value) || 0;
  const H = parseFloat(hoursMain.value) || 0;

  if (Q_dh <= 0 || H <= 0) return;
  if (H > 24) return;

  Object.keys(CHEM_CONFIG).forEach((chemId) => {
    const config = CHEM_CONFIG[chemId];
    const purity = config.getPurity();

    const Q_min = config.getMinPump();
    const Q_max = config.getMaxPump();

    // Khối lượng bột cần để châm đạt TargetDose trong H giờ chạy máy
    let M_opt = (config.targetDose * Q_dh * H) / (10 * purity);

    // Giới hạn khối lượng bột dựa trên bồn chứa tối đa và lưu lượng Max của bơm
    const V_max = Math.min(2000, Q_max * H);
    const M_limit = (V_max * config.cMax) / purity;

    // Khối lượng bột tối thiểu tương ứng giới hạn Min của bơm
    const V_min = Q_min * H;
    const M_min = (V_min * config.cMin) / purity;

    // Ép khối lượng bột tối ưu vào khoảng phần cứng cho phép
    M_opt = Math.min(Math.max(M_opt, M_min), M_limit);

    config.weightInput.value = M_opt.toFixed(2);
    handleWeightChange(chemId, true);
  });

  calculate(true);

  if (!silent) {
    Swal.fire({
      title: "Khởi tạo tối ưu hoàn tất",
      text: "Đã thiết lập khối lượng hóa chất tối ưu đạt liều châm chuẩn và dùng hết bồn pha.",
      icon: "success",
      timer: 2000,
      showConfirmButton: false,
    });
  }
}

// --- LẮNG NGHE SỰ KIỆN PHÍM ENTER ---
window.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const loginModal = document.getElementById("loginModal");
    if (loginModal && loginModal.style.display === "block") return;
    if (typeof Swal !== "undefined" && Swal.isVisible()) return;
    if (e.target && e.target.tagName === "BUTTON") return;

    e.preventDefault();
    calculate();
  }
});

// --- ĐĂNG KÝ SỰ KIỆN LẮNG NGHE ---
// Khối lượng thay đổi -> Tính toán lại thể tích và bơm định lượng của chính chất đó
[weightCl, purityCl].forEach((el) => {
  if (el) el.addEventListener("input", () => handleWeightChange("cl"));
});
weightPac.addEventListener("input", () => handleWeightChange("pac"));
weightPoly.addEventListener("input", () => handleWeightChange("poly"));

// Giới hạn bơm (Min/Max) thay đổi -> Tính toán lại nồng độ và thể tích bồn mẹ tương ứng
[
  "pumpMinCl", "pumpMaxCl",
  "pumpMinPac", "pumpMaxPac",
  "pumpMinPoly", "pumpMaxPoly"
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", () => {
      let chemId = "cl";
      if (id.includes("Pac")) chemId = "pac";
      else if (id.includes("Poly")) chemId = "poly";

      handleWeightChange(chemId, true);
    });
  }
});

// Thông số vận hành chính thay đổi -> Tính toán lại tất cả bơm định lượng
[flowRateMain, hoursMain].forEach((el) => {
  if (el) {
    el.addEventListener("input", () => {
      Object.keys(CHEM_CONFIG).forEach((chemId) => {
        handleWeightChange(chemId, true);
      });
    });
  }
});

// Nhấn nút tính toán
btnCalculate.addEventListener("click", () => calculate(false));

// --- LƯU VÀ KHÔI PHỤC DỮ LIỆU ĐÃ NHẬP ---
function saveInputs() {
  const inputsData = {
    flowRateMain: flowRateMain.value,
    hoursMain: hoursMain.value,
    weightCl: weightCl.value,
    purityCl: purityCl ? purityCl.value : "70",
    weightPac: weightPac.value,
    weightPoly: weightPoly.value,
    pumpMinCl: pumpMinCl ? pumpMinCl.value : "1.0",
    pumpMaxCl: pumpMaxCl ? pumpMaxCl.value : "30.0",
    pumpMinPac: pumpMinPac ? pumpMinPac.value : "5.0",
    pumpMaxPac: pumpMaxPac ? pumpMaxPac.value : "100.0",
    pumpMinPoly: pumpMinPoly ? pumpMinPoly.value : "10.0",
    pumpMaxPoly: pumpMaxPoly ? pumpMaxPoly.value : "200.0",
  };
  localStorage.setItem("tinhtoan_inputs", JSON.stringify(inputsData));
}

function restoreInputs() {
  try {
    const raw = localStorage.getItem("tinhtoan_inputs");
    if (!raw) return;
    const data = JSON.parse(raw);

    flowRateMain.value = data.flowRateMain || "";
    hoursMain.value = data.hoursMain || "";
    weightCl.value = data.weightCl || "";
    if (purityCl) purityCl.value = data.purityCl || "70";
    weightPac.value = data.weightPac || "";
    weightPoly.value = data.weightPoly || "";

    if (pumpMinCl && data.pumpMinCl !== undefined) pumpMinCl.value = data.pumpMinCl;
    if (pumpMaxCl && data.pumpMaxCl !== undefined) pumpMaxCl.value = data.pumpMaxCl;
    if (pumpMinPac && data.pumpMinPac !== undefined) pumpMinPac.value = data.pumpMinPac;
    if (pumpMaxPac && data.pumpMaxPac !== undefined) pumpMaxPac.value = data.pumpMaxPac;
    if (pumpMinPoly && data.pumpMinPoly !== undefined) pumpMinPoly.value = data.pumpMinPoly;
    if (pumpMaxPoly && data.pumpMaxPoly !== undefined) pumpMaxPoly.value = data.pumpMaxPoly;

    // Tính toán lại thực tế cho từng chất
    Object.keys(CHEM_CONFIG).forEach((chemId) => {
      handleWeightChange(chemId, true);
    });

    const Q_dh = parseFloat(flowRateMain.value) || 0;
    const H = parseFloat(hoursMain.value) || 0;
    if (Q_dh > 0 && H > 0) {
      if (!weightCl.value || !weightPac.value || !weightPoly.value) {
        optimize(true);
      } else {
        calculate(true);
      }
    }
  } catch (err) {
    console.warn("Lỗi khôi phục localStorage:", err);
  }
}

// --- QUẢN LÝ KỊCH BẢN TÍNH TOÁN ---
const scenLabels = [
  document.getElementById("scenLabel1"),
  document.getElementById("scenLabel2"),
  document.getElementById("scenLabel3")
];
const btnLoadScens = [
  document.getElementById("btnLoadScen1"),
  document.getElementById("btnLoadScen2"),
  document.getElementById("btnLoadScen3")
];
const btnSaveScens = [
  document.getElementById("btnSaveScen1"),
  document.getElementById("btnSaveScen2"),
  document.getElementById("btnSaveScen3")
];

function updateScenarioLabels() {
  for (let i = 0; i < 3; i++) {
    const raw = localStorage.getItem(`tinhtoan_scenario_${i + 1}`);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        scenLabels[i].innerHTML = `Q = <strong>${data.flowRateMain || 0} m³/h</strong>, T = <strong>${data.hoursMain || 0}h</strong><br><span style="font-size:11px; color:#475569;">Khối lượng: Clo ${data.weightCl || 0} kg, PAC ${data.weightPac || 0} kg, Poly ${data.weightPoly || 0} kg</span>`;
        btnLoadScens[i].removeAttribute("disabled");
      } catch (e) {
        scenLabels[i].textContent = "(Kịch bản lỗi)";
        btnLoadScens[i].setAttribute("disabled", "true");
      }
    } else {
      scenLabels[i].textContent = "(Chưa lưu)";
      btnLoadScens[i].setAttribute("disabled", "true");
    }
  }
}

function saveScenario(index) {
  const inputsData = {
    flowRateMain: flowRateMain.value,
    hoursMain: hoursMain.value,
    weightCl: weightCl.value,
    purityCl: purityCl ? purityCl.value : "70",
    weightPac: weightPac.value,
    weightPoly: weightPoly.value,
    pumpMinCl: pumpMinCl ? pumpMinCl.value : "1.0",
    pumpMaxCl: pumpMaxCl ? pumpMaxCl.value : "30.0",
    pumpMinPac: pumpMinPac ? pumpMinPac.value : "5.0",
    pumpMaxPac: pumpMaxPac ? pumpMaxPac.value : "100.0",
    pumpMinPoly: pumpMinPoly ? pumpMinPoly.value : "10.0",
    pumpMaxPoly: pumpMaxPoly ? pumpMaxPoly.value : "200.0",
  };
  localStorage.setItem(`tinhtoan_scenario_${index}`, JSON.stringify(inputsData));
  updateScenarioLabels();
  
  Swal.fire({
    title: "Đã lưu kịch bản",
    text: `Thông số hiện tại đã được ghi vào Kịch bản ${index}.`,
    icon: "success",
    timer: 1500,
    showConfirmButton: false
  });
}

function loadScenario(index) {
  const raw = localStorage.getItem(`tinhtoan_scenario_${index}`);
  if (!raw) return;
  
  try {
    const data = JSON.parse(raw);
    
    flowRateMain.value = data.flowRateMain || "";
    hoursMain.value = data.hoursMain || "";
    weightCl.value = data.weightCl || "";
    if (purityCl) purityCl.value = data.purityCl || "70";
    weightPac.value = data.weightPac || "";
    weightPoly.value = data.weightPoly || "";

    if (pumpMinCl && data.pumpMinCl !== undefined) pumpMinCl.value = data.pumpMinCl;
    if (pumpMaxCl && data.pumpMaxCl !== undefined) pumpMaxCl.value = data.pumpMaxCl;
    if (pumpMinPac && data.pumpMinPac !== undefined) pumpMinPac.value = data.pumpMinPac;
    if (pumpMaxPac && data.pumpMaxPac !== undefined) pumpMaxPac.value = data.pumpMaxPac;
    if (pumpMinPoly && data.pumpMinPoly !== undefined) pumpMinPoly.value = data.pumpMinPoly;
    if (pumpMaxPoly && data.pumpMaxPoly !== undefined) pumpMaxPoly.value = data.pumpMaxPoly;

    Object.keys(CHEM_CONFIG).forEach((chemId) => {
      handleWeightChange(chemId, true);
    });

    calculate(true);

    Swal.fire({
      title: "Đã tải kịch bản",
      text: `Thông số của Kịch bản ${index} đã được nạp và tính toán.`,
      icon: "info",
      timer: 1500,
      showConfirmButton: false
    });

  } catch (err) {
    Swal.fire("Lỗi", "Không thể nạp dữ liệu kịch bản: " + err.message, "error");
  }
}

// Đăng ký sự kiện kịch bản
for (let i = 0; i < 3; i++) {
  btnSaveScens[i].addEventListener("click", () => saveScenario(i + 1));
  btnLoadScens[i].addEventListener("click", () => loadScenario(i + 1));
}

// Khởi chạy nhãn kịch bản ban đầu
updateScenarioLabels();

// --- ĐĂNG KÝ SỰ KIỆN CHO MODAL CẤU HÌNH ĐỊNH MỨC ---
const configDinhMucModal = document.getElementById("configDinhMucModal");
const btnOpenConfig = document.getElementById("btnOpenConfig");
const btnCloseConfigModal = document.getElementById("btnCloseConfigModal");
const btnResetConfig = document.getElementById("btnResetConfig");
const btnSaveConfig = document.getElementById("btnSaveConfig");

function populateConfigModalInputs() {
  if (!configDinhMucModal) return;
  // Chlorine
  document.getElementById("cfgTargetDoseCl").value = getChemConfigVal("cl", "targetDose");
  document.getElementById("cfgRecommendMinCl").value = getChemConfigVal("cl", "recommendMin");
  document.getElementById("cfgRecommendMaxCl").value = getChemConfigVal("cl", "recommendMax");
  document.getElementById("cfgCMinCl").value = getChemConfigVal("cl", "cMin");
  document.getElementById("cfgCMaxCl").value = getChemConfigVal("cl", "cMax");

  // PAC
  document.getElementById("cfgTargetDosePac").value = getChemConfigVal("pac", "targetDose");
  document.getElementById("cfgRecommendMinPac").value = getChemConfigVal("pac", "recommendMin");
  document.getElementById("cfgRecommendMaxPac").value = getChemConfigVal("pac", "recommendMax");
  document.getElementById("cfgCMinPac").value = getChemConfigVal("pac", "cMin");
  document.getElementById("cfgCMaxPac").value = getChemConfigVal("pac", "cMax");

  // Polymer A
  document.getElementById("cfgTargetDosePoly").value = getChemConfigVal("poly", "targetDose");
  document.getElementById("cfgRecommendMinPoly").value = getChemConfigVal("poly", "recommendMin");
  document.getElementById("cfgRecommendMaxPoly").value = getChemConfigVal("poly", "recommendMax");
  document.getElementById("cfgCMinPoly").value = getChemConfigVal("poly", "cMin");
  document.getElementById("cfgCMaxPoly").value = getChemConfigVal("poly", "cMax");
}

if (btnOpenConfig) {
  btnOpenConfig.addEventListener("click", () => {
    populateConfigModalInputs();
    configDinhMucModal.style.display = "block";
  });
}

if (btnCloseConfigModal) {
  btnCloseConfigModal.addEventListener("click", () => {
    configDinhMucModal.style.display = "none";
  });
}

window.addEventListener("click", (e) => {
  if (configDinhMucModal && e.target === configDinhMucModal) {
    configDinhMucModal.style.display = "none";
  }
});

if (btnResetConfig) {
  btnResetConfig.addEventListener("click", () => {
    Swal.fire({
      title: "Xác nhận",
      text: "Khôi phục toàn bộ định mức và nồng độ khuyến cáo về giá trị mặc định ban đầu?",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Đồng ý",
      cancelButtonText: "Hủy",
      confirmButtonColor: "#e74c3c",
      cancelButtonColor: "#95a5a6",
    }).then((result) => {
      if (result.isConfirmed) {
        customConfigs = {};
        localStorage.removeItem("tinhtoan_custom_configs");
        populateConfigModalInputs();
        
        // Tính toán lại thực tế cho từng chất
        Object.keys(CHEM_CONFIG).forEach((chemId) => {
          handleWeightChange(chemId, true);
        });
        calculate(true);

        Swal.fire({
          title: "Đã khôi phục",
          text: "Thông số cấu hình đã trở lại mặc định.",
          icon: "success",
          timer: 1500,
          showConfirmButton: false
        });
      }
    });
  });
}

if (btnSaveConfig) {
  btnSaveConfig.addEventListener("click", () => {
    // Thu thập dữ liệu từ các input của modal
    const clTarget = parseFloat(document.getElementById("cfgTargetDoseCl").value);
    const clRecMin = parseFloat(document.getElementById("cfgRecommendMinCl").value);
    const clRecMax = parseFloat(document.getElementById("cfgRecommendMaxCl").value);
    const clCMin = parseFloat(document.getElementById("cfgCMinCl").value);
    const clCMax = parseFloat(document.getElementById("cfgCMaxCl").value);

    const pacTarget = parseFloat(document.getElementById("cfgTargetDosePac").value);
    const pacRecMin = parseFloat(document.getElementById("cfgRecommendMinPac").value);
    const pacRecMax = parseFloat(document.getElementById("cfgRecommendMaxPac").value);
    const pacCMin = parseFloat(document.getElementById("cfgCMinPac").value);
    const pacCMax = parseFloat(document.getElementById("cfgCMaxPac").value);

    const polyTarget = parseFloat(document.getElementById("cfgTargetDosePoly").value);
    const polyRecMin = parseFloat(document.getElementById("cfgRecommendMinPoly").value);
    const polyRecMax = parseFloat(document.getElementById("cfgRecommendMaxPoly").value);
    const polyCMin = parseFloat(document.getElementById("cfgCMinPoly").value);
    const polyCMax = parseFloat(document.getElementById("cfgCMaxPoly").value);

    // Xác thực cơ bản (không để trống hoặc nhỏ hơn/bằng 0)
    if (
      isNaN(clTarget) || clTarget <= 0 || isNaN(clRecMin) || clRecMin <= 0 || isNaN(clRecMax) || clRecMax <= 0 || isNaN(clCMin) || clCMin <= 0 || isNaN(clCMax) || clCMax <= 0 ||
      isNaN(pacTarget) || pacTarget <= 0 || isNaN(pacRecMin) || pacRecMin <= 0 || isNaN(pacRecMax) || pacRecMax <= 0 || isNaN(pacCMin) || pacCMin <= 0 || isNaN(pacCMax) || pacCMax <= 0 ||
      isNaN(polyTarget) || polyTarget <= 0 || isNaN(polyRecMin) || polyRecMin <= 0 || isNaN(polyRecMax) || polyRecMax <= 0 || isNaN(polyCMin) || polyCMin <= 0 || isNaN(polyCMax) || polyCMax <= 0
    ) {
      Swal.fire({
        title: "Lỗi nhập liệu",
        text: "Vui lòng nhập đầy đủ các thông số cấu hình lớn hơn 0.",
        icon: "error",
        confirmButtonText: "Đồng ý",
        confirmButtonColor: "#273668",
      });
      return;
    }

    customConfigs = {
      cl: { targetDose: clTarget, recommendMin: clRecMin, recommendMax: clRecMax, cMin: clCMin, cMax: clCMax },
      pac: { targetDose: pacTarget, recommendMin: pacRecMin, recommendMax: pacRecMax, cMin: pacCMin, cMax: pacCMax },
      poly: { targetDose: polyTarget, recommendMin: polyRecMin, recommendMax: polyRecMax, cMin: polyCMin, cMax: polyCMax }
    };

    localStorage.setItem("tinhtoan_custom_configs", JSON.stringify(customConfigs));
    
    // Tính toán lại thực tế cho từng chất dựa trên dải cấu hình mới
    Object.keys(CHEM_CONFIG).forEach((chemId) => {
      handleWeightChange(chemId, true);
    });
    calculate(true);
    
    configDinhMucModal.style.display = "none";
    
    Swal.fire({
      title: "Đã lưu",
      text: "Định mức cấu hình mới đã được ghi nhận và áp dụng vào tính toán.",
      icon: "success",
      timer: 1500,
      showConfirmButton: false
    });
  });
}
