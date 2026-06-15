// --- IMPORT ---
    import { db, onAuth, getRole, showLoading, hideLoading, showSwal } from "./script.js";
    import { collection, getDocs, query, orderBy, where, limit  } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
    import { initMenu } from "./menu.js";
    import { saveToLocalDB, getAllFromLocalDB, setLastSyncTime, getLastSyncTime } from "./localDB.js";

    // --- TẢI GIAO DIỆN CHUNG ---
    fetch("menu.html").then(r => r.text()).then(h => document.getElementById("menu-placeholder").innerHTML = h).then(initMenu);
    fetch("modal.html").then(r => r.text()).then(h => document.getElementById("loading-placeholder").innerHTML = h);
    fetch("footer.html").then(r => r.text()).then(h => document.getElementById("footer-placeholder").innerHTML = h);

    // --- THAM CHIẾU DOM ---
    const notLogged = document.getElementById("notLogged");
    const content = document.getElementById("pageContent");
    const fromInput = document.getElementById("fromDate");
    const toInput = document.getElementById("toDate");
    const yearSelect = document.getElementById("yearSelect");
    const applyFilterBtn = document.getElementById("applyFilter");
    const accuracyWarningDiv = document.getElementById("accuracyWarning");
    const otherChemicalsBody = document.getElementById("other-chemicals-body");
    const footerPlaceholder = document.getElementById("footer-placeholder");

    // 🔁 DÙNG let cho các phần tử có thể gán lại
    let viewDetailsCheckbox = document.getElementById('viewDetailsCheckbox');
    let detailsTableContainer = document.getElementById('detailsTableContainer');
    let detailsTableBody = document.getElementById('detailsTableBody');
    let openAnalysisModalBtn = document.getElementById('openAnalysisModal');
    let analysisModal = document.getElementById('analysisModal');
    let closeAnalysisModalBtn = document.getElementById('closeAnalysisModal');
    let closeAnalysisModalBottomBtn = document.getElementById('closeAnalysisModalBottom');
    let analysisModalContent = document.getElementById('analysisModalContent');
    let analysisTableBody = document.getElementById('analysisTableBody');

    
    // --- BIẾN TOÀN CỤC ---
    let allReportsData = []; // Lưu trữ tất cả báo cáo đã tải
    let currentFilter = { from: null, to: null }; // Lưu trạng thái bộ lọc ngày
    let initialLoad = true; // Cờ cho lần tải đầu tiên
    const standardChemicals = ['polymer anion', 'pac', 'chlorine', 'polymer cation']; // Chuẩn hóa tên
    let allRulesData = []; // Lưu trữ work_rules

// --- Hàm tiện ích: Khóa cuộn trang và bù đắp chiều rộng thanh cuộn ---
function toggleBodyScroll(disable) {
    if (disable) {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.paddingRight = scrollbarWidth + "px";
        document.body.style.overflow = "hidden";
    } else {
        document.body.style.paddingRight = "";
        document.body.style.overflow = "";
    }
}

    // --- HÀM HELPER ---
    function formatISODate(d) {
      if (!d || !(d instanceof Date)) return ""; // Thêm kiểm tra
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    // ⭐ DÁN HÀM MỚI VÀO ĐÂY
    function calculatePeriodData(periodType, allReportsData) {
        console.log(`Calculating data for: ${periodType}`);
        let startDate, endDate, startDateStr, endDateStr;
        const now = new Date();

        if (periodType === 'week') {
            startDate = getStartOfWeek(now);
            endDate = getEndOfWeek(now);
        } else if (periodType === 'month') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        } else { // 'year' or default
            startDate = new Date(now.getFullYear(), 0, 1);
            endDate = new Date(now.getFullYear(), 11, 31);
        }
        startDateStr = formatISODate(startDate);
        endDateStr = formatISODate(endDate);

        // Lọc dữ liệu báo cáo
        const periodReports = allReportsData.filter(r => {
            const reportDate = r.reportDate;
            return reportDate && reportDate >= startDateStr && reportDate <= endDateStr;
        });

        // Gọi hàm tính toán
        const summaryData = calculateSummary(periodReports, startDateStr, endDateStr);
        return summaryData;
    }
    // ⭐ KẾT THÚC HÀM MỚI
    // Copy từ baocao.html
    function formatNumberForDisplay(num, fractionDigits = 1, forceDecimals = false) {
        if (num == null || isNaN(num)) return '';
        // Sửa: Luôn hiển thị ít nhất 0 chữ số thập phân, tối đa 'fractionDigits'
        return new Intl.NumberFormat('vi-VN', {
            minimumFractionDigits: forceDecimals ? fractionDigits : 0,
            maximumFractionDigits: fractionDigits
        }).format(num);
    }
    // Copy từ baocao.html
    function parseDisplayValue(str) {
        if (!str) return NaN;
        str = String(str).replace(/\./g, '').replace(',', '.').trim();
        const num = parseFloat(str);
        return isNaN(num) ? NaN : num;
    }

    function normalizeChemicalName(name) { return name ? name.toLowerCase().trim() : ""; }

    // ⭐️ HÀM MỚI: Tính thời điểm kết thúc thực tế của ca
    function getShiftEndTime(report) {
        if (!report || !report.reportDate || !report.shiftEndTime) return null;
        try {
            const [endH, endM] = report.shiftEndTime.split(':').map(Number);
            const endDate = new Date(report.reportDate + "T00:00:00"); // Bắt đầu từ ngày báo cáo
            endDate.setHours(endH, endM, 0, 0);
            if (report.isShiftNextDay) { // Nếu ca kết thúc vào hôm sau
                endDate.setDate(endDate.getDate() + 1);
            }
            return endDate;
        } catch (e) {
            console.error("Lỗi tính shiftEndTime cho:", report, e);
            return null;
        }
    }

    // ⭐️ HÀM MỚI: Lấy ngày đầu tuần (Thứ 2)
    function getStartOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay(); // Chủ nhật = 0, Thứ 2 = 1,...
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Điều chỉnh về Thứ 2
        return new Date(d.setDate(diff));
    }

    // ⭐️ HÀM MỚI: Lấy ngày cuối tuần (Chủ nhật)
    function getEndOfWeek(date) {
        const d = new Date(date);
        const startOfWeek = getStartOfWeek(d); // Lấy ngày đầu tuần (Thứ 2)
        startOfWeek.setDate(startOfWeek.getDate() + 6); // Cộng thêm 6 ngày ra Chủ nhật
        return startOfWeek;
    }

    // --- HÀM TÍNH TOÁN CHI TIẾT THEO NGÀY ---
    function calculateDailyDetails(periodReports) {
        const dailyData = {}; // { 'YYYY-MM-DD': { date: '...', dien: 0, ..., chemicals: {}, notes: [] } }

        if (!periodReports || periodReports.length === 0) {
            return []; // Trả về mảng rỗng nếu không có báo cáo
        }

        // 1. Nhóm các báo cáo theo ngày (dựa vào reportDate)
        periodReports.forEach(report => {
            const dateStr = report.reportDate;
            if (!dateStr) return; // Bỏ qua nếu không có ngày

            // Nếu chưa có mục cho ngày này, tạo mới
            if (!dailyData[dateStr]) {
                dailyData[dateStr] = {
                    date: dateStr,
                    dien: 0, nuoc: 0, flow_in: 0, flow_out: 0,
                    chemicals: {}, // { normalizedName: quantity }
                    notes: new Set(), // Dùng Set để tránh ghi chú trùng lặp
                    reportsOnDay: [] // Lưu tạm các báo cáo của ngày này
                };
            }
            // Thêm báo cáo vào ngày tương ứng
            dailyData[dateStr].reportsOnDay.push(report);
        });

        // 2. Tính toán số liệu tổng hợp cho từng ngày
        Object.keys(dailyData).forEach(dateStr => {
            const dayInfo = dailyData[dateStr];
            // Sắp xếp các báo cáo trong ngày theo giờ bắt đầu ca
            const reports = dayInfo.reportsOnDay; // Dữ liệu đã được sort sẵn từ fetchReportsForPeriod

            if (reports.length > 0) {
                const firstMeters = reports[0].meters || {}; // Chỉ số đầu ca 1
                const lastMeters = reports[reports.length - 1].meters || {}; // Chỉ số cuối ca cuối cùng trong ngày

                // Hàm tính tổng trong ngày (từ đầu ca 1 đến cuối ca cuối)
                const calcDailyTotal = (startKey, endKey) => {
                    const startVal = parseFloat(firstMeters[startKey]);
                    const endVal = parseFloat(lastMeters[endKey]);
                    if (!isNaN(startVal) && !isNaN(endVal) && endVal >= startVal) {
                        return endVal - startVal;
                    }
                    // ⭐ Sửa: Trả về null thay vì 0 khi lỗi ⭐
                    console.warn(`calcDailyTotal failed for ${startKey}/${endKey} on date ${dayInfo.date}`);
                    return null;
                };

                // Tính tổng điện (cộng 3 pha)
                const dien_bt = calcDailyTotal('dien_bt_dau', 'dien_bt_cuoi');
                const dien_cd = calcDailyTotal('dien_cd_dau', 'dien_cd_cuoi');
                const dien_td = calcDailyTotal('dien_td_dau', 'dien_td_cuoi');
                dayInfo.dien = dien_bt + dien_cd + dien_td;

                dayInfo.nuoc = calcDailyTotal('nuoc_dau', 'nuoc_cuoi');
                dayInfo.flow_in = calcDailyTotal('flow_in_start', 'flow_in_end');
                dayInfo.flow_out = calcDailyTotal('flow_out_start', 'flow_out_end');

                
                // Tính tổng điện (chỉ cộng các giá trị không null)
                dayInfo.dien = [dien_bt, dien_cd, dien_td].reduce((sum, val) => sum + (val === null ? 0 : val), 0);
                // Nếu cả 3 pha đều null, tổng điện cũng là null
                if(dien_bt === null && dien_cd === null && dien_td === null) dayInfo.dien = null;

                // ⭐ Sửa: Kiểm tra giá trị null và thêm ghi chú ⭐
                if (dayInfo.dien === null) dayInfo.notes.add("Lỗi tính tiêu thụ Điện ngày!");
                if (dayInfo.nuoc === null) dayInfo.notes.add("Lỗi tính Khối lượng Nước cấp ngày!");
                if (dayInfo.flow_in === null) dayInfo.notes.add("Lỗi tính Khối lượng đồng hồ Vào ngày!");
                if (dayInfo.flow_out === null) dayInfo.notes.add("Lỗi tính Khối lượng đồng hồ Ra ngày!");

                // --- ⭐ THÊM KHỐI CẢNH BÁO MỚI TẠI ĐÂY ⭐ ---
                if (dayInfo.dien === 0) dayInfo.notes.add("Tổng Tiêu thụ Điện cả ngày bằng 0!");
                if (dayInfo.nuoc === 0) dayInfo.notes.add("Tổng Khối lượng Nước cấp cả ngày bằng 0!");
                if (dayInfo.flow_in === 0) dayInfo.notes.add("Tổng Khối lượng Đồng hồ đầu Vào cả ngày bằng 0!");
                if (dayInfo.flow_out === 0) dayInfo.notes.add("Tổng Khối lượng Đồng hồ đầu Ra cả ngày bằng 0!");
                // --- KẾT THÚC KHỐI CẢNH BÁO MỚI ---


                // Tổng hợp hóa chất và ghi chú trong ngày
                let totalChemDay = 0;
                reports.forEach(report => {
                    // Cộng dồn hóa chất
                    (report.chemicals || []).forEach(chem => {
                        const name = normalizeChemicalName(chem.chemicalName);
                        const qty = parseFloat(chem.quantity) || 0;
                        if (name && qty > 0) {
                            dayInfo.chemicals[name] = (dayInfo.chemicals[name] || 0) + qty;
                            totalChemDay += qty;
                        }
                    });
                    // Thêm ghi chú nếu có bất thường
                    if (report.isMeterReset) dayInfo.notes.add("Phát hiện báo cáo Chỉ số giảm!");
                    // Kiểm tra ví dụ chỉ số 0 (có thể thêm các kiểm tra khác)
                    if (parseFloat(report.meters?.flow_in_start) === 0 || parseFloat(report.meters?.flow_in_end) === 0) {
                        dayInfo.notes.add("Phát hiện báo cáo Chỉ số đồng hồ bằng 0!");
                    }
                    // --- ⭐ DÁN CODE MỚI VÀO ĐÂY (bên trong reports.forEach) ⭐ ---
                    const m = report.meters || {};
                    // Tính sản lượng cho riêng ca này
                    const r_flow_in = (parseFloat(m.flow_in_end) - parseFloat(m.flow_in_start));
                    const r_flow_out = (parseFloat(m.flow_out_end) - parseFloat(m.flow_out_start));
                    const r_nuoc = (parseFloat(m.nuoc_cuoi) - parseFloat(m.nuoc_dau));

                    // Chỉ cảnh báo nếu tính toán hợp lệ (không phải NaN) và bằng 0
                    if (!isNaN(r_flow_in) && r_flow_in === 0) dayInfo.notes.add("Tổng Khối lượng đầu Vào (ca) bằng 0!");
                    if (!isNaN(r_flow_out) && r_flow_out === 0) dayInfo.notes.add("Tổng Khối lượng đầu Ra (ca) bằng 0!");
                    if (!isNaN(r_nuoc) && r_nuoc === 0) dayInfo.notes.add("Tổng Khối lượng Nước cấp (ca) bằng 0!");

                    // Tính điện cho riêng ca này
                    const r_dien_bt = (parseFloat(m.dien_bt_cuoi) - parseFloat(m.dien_bt_dau));
                    const r_dien_cd = (parseFloat(m.dien_cd_cuoi) - parseFloat(m.dien_cd_dau));
                    const r_dien_td = (parseFloat(m.dien_td_cuoi) - parseFloat(m.dien_td_dau));

                    // Tính tổng, coi NaN là 0
                    const r_dien_total = (isNaN(r_dien_bt) ? 0 : r_dien_bt) + 
                                        (isNaN(r_dien_cd) ? 0 : r_dien_cd) + 
                                        (isNaN(r_dien_td) ? 0 : r_dien_td);

                    // Chỉ cảnh báo nếu cả 3 pha đều là số hợp lệ VÀ tổng bằng 0
                    if (!isNaN(r_dien_bt) && !isNaN(r_dien_cd) && !isNaN(r_dien_td) && r_dien_total === 0) {
                        dayInfo.notes.add("Tổng Tiêu thụ Điện (ca) bằng 0!");
                    }
                    // --- ⭐ KẾT THÚC CODE MỚI ⭐ ---
                });
                dayInfo.totalChemicals = totalChemDay; // Lưu tổng hóa chất của ngày
            }
            delete dayInfo.reportsOnDay; // Xóa mảng báo cáo thô sau khi tính xong
        });

        // 3. Chuyển đổi đối tượng thành mảng và sắp xếp (ngày mới nhất lên đầu)
        const sortedDetails = Object.values(dailyData).sort((a, b) => b.date.localeCompare(a.date));

        return sortedDetails;
    }
    // --- HÀM TÍNH TOÁN CHÍNH (Đã sửa để cộng dồn theo ngày) ---
    function calculateSummary(periodReports, periodStartDateStr, periodEndDateStr) {
        console.log("Calculating summary by summing daily details for:", periodStartDateStr, "to", periodEndDateStr);
        showLoading("Đang tổng hợp dữ liệu...");
        let summaryData = {
            dien: { total: 0, avg: null }, // Khởi tạo total = 0
            nuoc: { total: 0, avg: null },
            flow_in: { total: 0, avg: null },
            flow_out: { total: 0, avg: null },
            chemicals: {},
            notes: [],
            daysWithReports: 0,
            isInaccurate: false
        };
        let isInaccurate = false; // Vẫn dùng cờ này

        if (periodReports.length === 0) {
            hideLoading();
            // Reset totals về null nếu không có report
            summaryData.dien.total = null;
            summaryData.nuoc.total = null;
            summaryData.flow_in.total = null;
            summaryData.flow_out.total = null;
            return summaryData;
        }

        // --- 1. KIỂM TRA NGÀY ĐẦU/CUỐI KỲ CÓ BÁO CÁO KHÔNG (Để set isInaccurate) ---
        const hasReportOnStartDate = periodReports.some(r => r.reportDate === periodStartDateStr);
        const hasReportOnEndDate = periodReports.some(r => r.reportDate === periodEndDateStr);
        if (!hasReportOnStartDate || !hasReportOnEndDate) {
            isInaccurate = true;
            console.warn("Missing reports on start or end date of the period.");
        }
         summaryData.isInaccurate = isInaccurate; // Cập nhật cờ

        // --- 2. GỌI HÀM TÍNH CHI TIẾT THEO NGÀY ---
        // Hàm này trả về mảng các object, mỗi object là tổng của 1 ngày
        const dailyDetails = calculateDailyDetails(periodReports);
        summaryData.daysWithReports = dailyDetails.length; // Lấy số ngày thực tế có dữ liệu

        // --- 3. CỘNG DỒN KẾT QUẢ TỪNG NGÀY ---
        let hasDailyError = false; // Cờ kiểm tra lỗi từng ngày
            dailyDetails.forEach(dayInfo => {
                // ⭐ Sửa: Chỉ cộng nếu giá trị không phải null ⭐
                if (dayInfo.dien !== null) summaryData.dien.total += (dayInfo.dien || 0); else hasDailyError = true;
                if (dayInfo.nuoc !== null) summaryData.nuoc.total += (dayInfo.nuoc || 0); else hasDailyError = true;
                if (dayInfo.flow_in !== null) summaryData.flow_in.total += (dayInfo.flow_in || 0); else hasDailyError = true;
                if (dayInfo.flow_out !== null) summaryData.flow_out.total += (dayInfo.flow_out || 0); else hasDailyError = true;

             // Tổng hợp hóa chất (Lấy từ dailyDetails để nhất quán)
             for (const chemName in dayInfo.chemicals) {
                 const qty = dayInfo.chemicals[chemName] || 0;
                 if (qty > 0) {
                     if (!summaryData.chemicals[chemName]) {
                         summaryData.chemicals[chemName] = { total: 0, avg: null };
                     }
                     summaryData.chemicals[chemName].total += qty;
                 }
             }
             // Tổng hợp ghi chú từ từng ngày
             dayInfo.notes.forEach(note => summaryData.notes.push(note)); // Có thể bị trùng, dùng Set nếu muốn unique
        });
        // ⭐ Sửa: Nếu có lỗi ngày, đặt tổng kỳ = null ⭐
        if (hasDailyError) {
            if (summaryData.dien.total === 0 && dailyDetails.some(d => d.dien === null)) summaryData.dien.total = null;
            if (summaryData.nuoc.total === 0 && dailyDetails.some(d => d.nuoc === null)) summaryData.nuoc.total = null;
            if (summaryData.flow_in.total === 0 && dailyDetails.some(d => d.flow_in === null)) summaryData.flow_in.total = null;
            if (summaryData.flow_out.total === 0 && dailyDetails.some(d => d.flow_out === null)) summaryData.flow_out.total = null;
            summaryData.notes.push("Có ngày bị lỗi số liệu."); // Thêm ghi chú chung
        }

         // --- 4. TÍNH TRUNG BÌNH KỲ ---
         const calculateAvg = (total) => {
             // Sửa: Kiểm tra total > 0 thay vì !== null, và days > 0
             if (total > 0 && summaryData.daysWithReports > 0) {
                 return total / summaryData.daysWithReports;
             }
             // Nếu total là 0 thì trung bình cũng là 0
             if (total === 0 && summaryData.daysWithReports > 0) {
                 return 0;
             }
             return null; // Trả về null nếu không tính được
         };
         summaryData.dien.avg = calculateAvg(summaryData.dien.total);
         summaryData.nuoc.avg = calculateAvg(summaryData.nuoc.total);
         summaryData.flow_in.avg = calculateAvg(summaryData.flow_in.total);
         summaryData.flow_out.avg = calculateAvg(summaryData.flow_out.total);

         // Tính trung bình hóa chất
         let totalAllChemicals = 0;
         for (const name in summaryData.chemicals) {
             const total = summaryData.chemicals[name].total;
             summaryData.chemicals[name].avg = calculateAvg(total);
             totalAllChemicals += total;
         }
         summaryData.chemicals.totalAll = { total: totalAllChemicals, avg: calculateAvg(totalAllChemicals) };


        // --- 5. TỔNG HỢP GHI CHÚ (Lấy unique) ---
        summaryData.notes = [...new Set(summaryData.notes)]; // Lấy các ghi chú unique từ dailyDetails

        console.log("Calculation result (summed daily):", summaryData);
        hideLoading();
        return summaryData;
    }

    // --- HÀM HIỂN THỊ (Đã sửa lỗi ID tiếng Việt/Anh) ---
    function renderCustomPeriod(summaryData, isCustomPeriod) {
        console.log("Rendering summary:", summaryData, "Custom Period:", isCustomPeriod);
        showLoading("Đang cập nhật bảng...");

        // ⭐ SỬA LỖI: Hàm tạo ID dùng tiếng Việt (tong, tb) để khớp HTML
        const getCellId = (metric, typeVietnamese, period) => `${metric}-${typeVietnamese}-${period}`; // vd: dien-tong-tuan

        // Hàm cập nhật ô (Giữ nguyên)
        const updateCell = (id, value, fractionDigits = 1, forceDecimals = false) => {
            const cell = document.getElementById(id);
            console.log(`Updating cell: ID=${id}, Value=${value}`);
            if (cell) {
                cell.textContent = formatNumberForDisplay(value, fractionDigits, forceDecimals);
            } else {
                 console.warn("Không tìm thấy cell ID:", id);
            }
        };

        // --- 1. CẬP NHẬT ĐIỆN, NƯỚC, LƯU LƯỢNG (ĐÃ SỬA) ---
        const metrics = ['dien', 'nuoc', 'flow_in', 'flow_out'];
        const periods = ['tuan', 'thang', 'nam', 'ky'];
        // ⭐ SỬA LỖI: Map giữa tên HTML (Việt) và tên data (Anh)
        const typesMap = {
            tong: 'total', // ID HTML 'tong' tương ứng với data key 'total'
            tb: 'avg'      // ID HTML 'tb' tương ứng với data key 'avg'
        };

        metrics.forEach(metric => {
            periods.forEach(period => {
                // Lặp qua các key tiếng Việt (tong, tb)
                Object.keys(typesMap).forEach(typeVietnamese => {
                    // Lấy tên key tiếng Anh tương ứng để đọc data
                    const typeEnglish = typesMap[typeVietnamese];
                    // Đọc giá trị từ summaryData bằng key tiếng Anh
                    const value = summaryData[metric]?.[typeEnglish] ?? null;
                    // Gọi updateCell với ID tiếng Việt
                    const isAvg = typeEnglish === 'avg';
                    const fractionDigits = (metric === 'dien' && !isAvg) ? 0 : 1;
                    updateCell(getCellId(metric, typeVietnamese, period), value, fractionDigits, isAvg);
                });
            });
        });

        // --- 2. CẬP NHẬT HÓA CHẤT (ĐÃ SỬA) ---
        // Cập nhật dòng Tổng hóa chất
        periods.forEach(period => {
             Object.keys(typesMap).forEach(typeVietnamese => {
                 const typeEnglish = typesMap[typeVietnamese];
                 const value = summaryData.chemicals.totalAll?.[typeEnglish] ?? null;
                 updateCell(getCellId('chem', typeVietnamese, period), value, 1, typeEnglish === 'avg');
             });
        });

        // Cập nhật hóa chất chuẩn
        const standardChemicalHtmlNames = ['Polymer Anion', 'PAC', 'Chlorine', 'Polymer Cation'];
        standardChemicalHtmlNames.forEach(htmlName => {
            const normalizedDataName = normalizeChemicalName(htmlName);
             periods.forEach(period => {
                Object.keys(typesMap).forEach(typeVietnamese => {
                    const typeEnglish = typesMap[typeVietnamese];
                    const value = summaryData.chemicals[normalizedDataName]?.[typeEnglish] ?? null;
                    updateCell(getCellId(htmlName, typeVietnamese, period), value, 1, typeEnglish === 'avg');
                });
             });
        });

        // Tạo và cập nhật hóa chất khác
        otherChemicalsBody.innerHTML = '';
        let otherChemicalsHtml = '';
        const sortedChemNames = Object.keys(summaryData.chemicals).sort();

        sortedChemNames.forEach(name => {
            if (name !== 'totalAll' && !standardChemicals.includes(name)) {
                otherChemicalsHtml += `<tr class="chemical-sub-item"><td>+ ${name.charAt(0).toUpperCase() + name.slice(1)}</td>`;
                periods.forEach(period => {
                    Object.keys(typesMap).forEach(typeVietnamese => { // Lặp qua tong, tb
                        const typeEnglish = typesMap[typeVietnamese]; // Lấy total, avg
                        const value = summaryData.chemicals[name]?.[typeEnglish] ?? null; // Đọc data
                        const displayValue = formatNumberForDisplay(value, 1, typeEnglish === 'avg');
                        const isHidden = (period === 'ky' && !isCustomPeriod) || (period !== 'ky' && isCustomPeriod);
                        // Cell ID vẫn dùng tong/tb (nhưng không cần ID vì tạo động)
                        otherChemicalsHtml += `<td style="${isHidden ? 'display:none;' : ''}">${displayValue}</td>`;
                    });
                });
                otherChemicalsHtml += `<td></td></tr>`;
            }
        });
        otherChemicalsBody.innerHTML = otherChemicalsHtml;


        // --- 3. CẬP NHẬT GHI CHÚ (Giữ nguyên) ---
        const notesHtml = summaryData.notes.length > 0 ? summaryData.notes.join('<br>') : '';
        const dienGhichuCell = document.getElementById('dien-ghichu');
        if(dienGhichuCell) dienGhichuCell.innerHTML = notesHtml;
        const chemGhichuCell = document.getElementById('chem-ghichu');
        // if(chemGhichuCell) chemGhichuCell.innerHTML = ...;

        // --- 5. HIỂN THỊ/ẨN CẢNH BÁO (Giữ nguyên) ---
        accuracyWarningDiv.style.display = summaryData.isInaccurate ? 'block' : 'none';

        hideLoading();
    }

    // ⭐ DÁN HÀM MỚI HOÀN TOÀN NÀY VÀO
    function renderSummary(weekData, monthData, yearData) {
        console.log("Rendering summary for Week, Month, Year");
        showLoading("Đang cập nhật bảng...");

        const updateCell = (id, value, fractionDigits = 1, forceDecimals = false) => {
            const cell = document.getElementById(id);
            if (cell) {
                cell.textContent = formatNumberForDisplay(value, fractionDigits, forceDecimals);
            } else {
                 console.warn("Không tìm thấy cell ID:", id);
            }
        };
        
        const dataMap = {
            'tuan': weekData,
            'thang': monthData,
            'nam': yearData
        };
        const metrics = ['dien', 'nuoc', 'flow_in', 'flow_out'];
        const typesMap = { tong: 'total', tb: 'avg' };
        const periods = ['tuan', 'thang', 'nam']; // Chỉ 3 cột
        const standardChemicalHtmlNames = ['Polymer Anion', 'PAC', 'Chlorine', 'Polymer Cation'];
        
        // --- 1. CẬP NHẬT ĐIỆN, NƯỚC, LƯU LƯỢNG ---
        metrics.forEach(metric => {
            periods.forEach(period => { // lặp qua tuan, thang, nam
                const periodData = dataMap[period]; // Lấy đúng data (weekData, monthData...)
                if (!periodData) return; // SỬA "continue" THÀNH "return"
                Object.keys(typesMap).forEach(typeVietnamese => {
                    const typeEnglish = typesMap[typeVietnamese];
                    const value = periodData[metric]?.[typeEnglish] ?? null;
                    const isAvg = typeEnglish === 'avg';
                    const fractionDigits = (metric === 'dien' && !isAvg) ? 0 : 1;
                    updateCell(`${metric}-${typeVietnamese}-${period}`, value, fractionDigits, isAvg);
                });
            });
        });

        // --- 2. CẬP NHẬT HÓA CHẤT ---
        // Cập nhật dòng Tổng hóa chất
        periods.forEach(period => {
             const periodData = dataMap[period];
             if (!periodData) return; // SỬA "continue" THÀNH "return"
             Object.keys(typesMap).forEach(typeVietnamese => {
                 const typeEnglish = typesMap[typeVietnamese];
                 const value = periodData.chemicals.totalAll?.[typeEnglish] ?? null;
                 updateCell(`chem-${typeVietnamese}-${period}`, value, 1, typeEnglish === 'avg');
             });
        });

        // Cập nhật hóa chất chuẩn
        standardChemicalHtmlNames.forEach(htmlName => {
            const normalizedDataName = normalizeChemicalName(htmlName);
             periods.forEach(period => {
                const periodData = dataMap[period];
                if (!periodData) return; // SỬA "continue" THÀNH "return"
                Object.keys(typesMap).forEach(typeVietnamese => {
                    const typeEnglish = typesMap[typeVietnamese];
                    const value = periodData.chemicals[normalizedDataName]?.[typeEnglish] ?? null;
                    updateCell(`${htmlName}-${typeVietnamese}-${period}`, value, 1, typeEnglish === 'avg');
                });
             });
        });

        // Tạo và cập nhật hóa chất khác (Gộp data từ cả 3 kỳ)
        let allOtherChemNames = new Set();
        [weekData, monthData, yearData].forEach(data => {
            if (data && data.chemicals) {
                Object.keys(data.chemicals).forEach(name => {
                    if (name !== 'totalAll' && !standardChemicals.includes(name)) {
                        allOtherChemNames.add(name);
                    }
                });
            }
        });

        otherChemicalsBody.innerHTML = '';
        let otherChemicalsHtml = '';
        const sortedChemNames = [...allOtherChemNames].sort();

        sortedChemNames.forEach(name => {
            otherChemicalsHtml += `<tr class="chemical-sub-item"><td>+ ${name.charAt(0).toUpperCase() + name.slice(1)}</td>`;
            periods.forEach(period => { // lặp qua tuan, thang, nam
                const periodData = dataMap[period];
                Object.keys(typesMap).forEach(typeVietnamese => { // Lặp qua tong, tb
                    const typeEnglish = typesMap[typeVietnamese];
                    const value = periodData?.chemicals[name]?.[typeEnglish] ?? null;
                    const displayValue = formatNumberForDisplay(value, 1, typeEnglish === 'avg');
                    otherChemicalsHtml += `<td>${displayValue}</td>`;
                });
            });
            otherChemicalsHtml += `<td></td></tr>`;
        });
        otherChemicalsBody.innerHTML = otherChemicalsHtml;


        // --- 3. CẬP NHẬT GHI CHÚ (Lấy của năm) ---
        const notesHtml = yearData?.notes.length > 0 ? yearData.notes.join('<br>') : '';
        const dienGhichuCell = document.getElementById('dien-ghichu');
        if(dienGhichuCell) dienGhichuCell.innerHTML = notesHtml;

        // --- 4. HIỂN THỊ CỘT (Luôn hiện 3 cột, ẩn 1) ---
        document.querySelectorAll('[id^="col-week"], [id*="-tong-tuan"], [id*="-tb-tuan"]').forEach(el => el.style.display = '');
        document.querySelectorAll('[id^="col-month"], [id*="-tong-thang"], [id*="-tb-thang"]').forEach(el => el.style.display = '');
        document.querySelectorAll('[id^="col-year"], [id*="-tong-nam"], [id*="-tb-nam"]').forEach(el => el.style.display = '');
        document.querySelectorAll('[id^="col-period"], [id*="-tong-ky"], [id*="-tb-ky"]').forEach(el => el.style.display = 'none');

        // --- 5. HIỂN THỊ CẢNH BÁO (Hiện nếu 1 trong 3 bị) ---
        const isInaccurate = weekData?.isInaccurate || monthData?.isInaccurate || yearData?.isInaccurate;
        accuracyWarningDiv.style.display = isInaccurate ? 'block' : 'none';

        hideLoading();
    }
    // ⭐ KẾT THÚC HÀM MỚI
    // --- HÀM HIỂN THỊ BẢNG CHI TIẾT ---
    function renderDetailsTable(dailyDetails) {
        detailsTableBody.innerHTML = ''; // Xóa nội dung cũ

        if (!dailyDetails || dailyDetails.length === 0) {
            detailsTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Không có dữ liệu chi tiết cho kỳ này.</td></tr>';
            return;
        }

        let html = '';
        // Không giới hạn số dòng, CSS sẽ xử lý cuộn
        dailyDetails.forEach((dayInfo, index) => {
            const notesString = Array.from(dayInfo.notes).join(', '); // Nối các ghi chú lại
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${new Date(dayInfo.date + "T00:00:00").toLocaleDateString('vi-VN')}</td>
                    <td>${formatNumberForDisplay(dayInfo.dien, 0)}</td>
                    <td>${formatNumberForDisplay(dayInfo.nuoc, 1)}</td>
                    <td>${formatNumberForDisplay(dayInfo.flow_in, 1)}</td>
                    <td>${formatNumberForDisplay(dayInfo.flow_out, 1)}</td>
                    <td>${formatNumberForDisplay(dayInfo.totalChemicals, 1)}</td>
                    <td style="text-align: left;">${notesString}</td>
                </tr>
            `;
        });

        detailsTableBody.innerHTML = html;
        // Phần cuộn đã được xử lý bằng CSS (max-height và overflow-y: auto) trên div cha
    }

    // --- HÀM TỔNG HỢP (Đã hoàn thiện) ---
    function calculateAndRenderSummary(periodType = 'year', customStartDate = null, customEndDate = null) {
        console.log("Trigger calculateAndRenderSummary for:", periodType);
        showLoading("Đang xác định kỳ và lọc dữ liệu...");

        let startDate, endDate, startDateStr, endDateStr;
        const now = new Date();
        const isCustomPeriod = (periodType === 'custom');

        if (isCustomPeriod) {
        // Ưu tiên ngày được truyền vào từ applyDateFilter
        if (customStartDate && customEndDate) {
            startDateStr = customStartDate;
            endDateStr = customEndDate;
        } else {
            // Fallback (dùng cho lần tải đầu)
            startDateStr = currentFilter.from;
            endDateStr = currentFilter.to;
        }
        if (!startDateStr || !endDateStr) {
                 hideLoading();
                 return showSwal("info", "Vui lòng chọn Khoảng Thời Gian Lọc.");
            }
            startDate = new Date(startDateStr + "T00:00:00");
            endDate = new Date(endDateStr + "T00:00:00");
        } else {
            // Tính cho tuần/tháng/năm hiện tại
            if (periodType === 'week') {
                startDate = getStartOfWeek(now); // Thứ 2
                endDate = getEndOfWeek(now);     // Chủ nhật
            } else if (periodType === 'month') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1); // Ngày đầu tháng
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Ngày cuối tháng
            } else { // year or default
                startDate = new Date(now.getFullYear(), 0, 1); // Ngày đầu năm
                endDate = new Date(now.getFullYear(), 11, 31); // Ngày cuối năm
            }
            startDateStr = formatISODate(startDate);
            endDateStr = formatISODate(endDate);
        }

        if (!startDate || !endDate) {
            hideLoading();
            console.error("Không thể xác định khoảng thời gian.");
            return;
        }

        // Lọc dữ liệu báo cáo cho kỳ này (DÙNG reportDate)
        let periodReports;

        // CHỈ LỌC NẾU LÀ KỲ TÙY CHỈNH ('custom')
        // (Vì onAuth đã tự lọc cho 'week', 'month', 'year' rồi)
        if (isCustomPeriod) {
            console.log("calculateAndRenderSummary: Lọc client-side cho kỳ tùy chỉnh...");
            periodReports = allReportsData.filter(r => {
                const reportDate = r.reportDate;
                return reportDate && reportDate >= startDateStr && reportDate <= endDateStr;
            });
        } else {
            // Nếu không phải 'custom' (ví dụ 'week'/'month'/'year' gọi từ onAuth)
            // thì allReportsData đã được lọc sẵn bởi calculatePeriodData
            console.log("calculateAndRenderSummary: Sử dụng dữ liệu đã được lọc trước.");
            periodReports = allReportsData; // DÙNG LUÔN, KHÔNG LỌC LẠI
        }

        // DỮ LIỆU ĐÃ ĐƯỢC SẮP XẾP TỪ fetchReportsForPeriod


        const summaryData = calculateSummary(periodReports, startDateStr, endDateStr);
        // SỬA THÀNH 'renderCustomPeriod' KHI LÀ KỲ TÙY CHỈNH
        if (isCustomPeriod) {
            renderCustomPeriod(summaryData, isCustomPeriod); // <--- GỌI HÀM RENDER ĐÚNG
        } else {
            // (Phần này hiện không dùng tới, vì onAuth gọi renderSummary riêng,
            // nhưng để đây cho logic đầy đủ nếu bạn gọi 'week'/'month'/'year' sau này)
            console.warn("calculateAndRenderSummary được gọi với kỳ không phải 'custom'");
            // Để tránh lỗi, ta có thể render nó vào cột 'ky'
            renderCustomPeriod(summaryData, isCustomPeriod);
        }
        // ⭐ TÍNH TOÁN VÀ HIỂN THỊ BẢNG CHI TIẾT (MỚI) ⭐
        const dailyDetails = calculateDailyDetails(periodReports);
        renderDetailsTable(dailyDetails);
        // ⭐ KẾT THÚC PHẦN MỚI ⭐

        // ⭐ THÊM 4 DÒNG NÀY ĐỂ ẨN/HIỆN CỘT
        document.querySelectorAll('[id^="col-week"], [id*="-tong-tuan"], [id*="-tb-tuan"]').forEach(el => el.style.display = 'none');
        document.querySelectorAll('[id^="col-month"], [id*="-tong-thang"], [id*="-tb-thang"]').forEach(el => el.style.display = 'none');
        document.querySelectorAll('[id^="col-year"], [id*="-tong-nam"], [id*="-tb-nam"]').forEach(el => el.style.display = 'none');
        document.querySelectorAll('[id^="col-period"], [id*="-tong-ky"], [id*="-tb-ky"]').forEach(el => el.style.display = '');
        hideLoading(); // Đảm bảo loading tắt
    }


    // --- XỬ LÝ BỘ LỌC (ĐÃ SỬA) ---
    async function applyDateFilter() {
        const fromVal = fromInput.value;
        const toVal = toInput.value;
        const yearVal = yearSelect.value;
        initialLoad = false; // Đánh dấu là không còn load lần đầu

        let startDateStr, endDateStr;

        if (yearVal) {
            startDateStr = `${yearVal}-01-01`;
            const currentYear = new Date().getFullYear();
            if (parseInt(yearVal) === currentYear) {
                endDateStr = formatISODate(new Date());
            } else {
                endDateStr = `${yearVal}-12-31`;
            }
            fromInput.value = startDateStr; 
            toInput.value = endDateStr;
        } else if (fromVal && toVal) {
            startDateStr = fromVal;
            endDateStr = toVal;
        } else {
            return showSwal("info", "Vui lòng chọn Năm hoặc Cả Ngày bắt đầu và Ngày kết thúc.");
        }

        // --- TỐI ƯU CACHE ---
        let needsFetch = false;
        // currentFilter lưu phạm vi data đang có trong 'allReportsData'
        // Kiểm tra xem cache có tồn tại không, và ngày mới có nằm NGOÀI cache không
        if (!currentFilter.from || !currentFilter.to || startDateStr < currentFilter.from || endDateStr > currentFilter.to) {
            needsFetch = true;
        }

        try {
            if (needsFetch) {
                console.log("Cache Miss. Đang TẢI DỮ LIỆU MỚI từ Firebase...");
                // Tải dữ liệu mới và cập nhật cache
                allReportsData = await fetchReportsForPeriod(startDateStr, endDateStr);
                currentFilter.from = startDateStr; // Cập nhật phạm vi cache
                currentFilter.to = endDateStr;
            } else {
                console.log("Cache Hit. Dùng dữ liệu đã tải, chỉ lọc phía client.");
                // Dữ liệu đã có trong allReportsData, không cần làm gì
            }

            // Gọi hàm tính toán cho kỳ tùy chỉnh, truyền ngày vào
            // Hàm này bây giờ sẽ lọc từ 'allReportsData'
            calculateAndRenderSummary('custom', startDateStr, endDateStr);

        } catch (error) {
            console.error("Lỗi khi áp dụng bộ lọc:", error);
            showSwal("error", "Lỗi lọc dữ liệu", error.message);
            hideLoading();
        }
        // --- KẾT THÚC TỐI ƯU ---
    }
    applyFilterBtn.addEventListener("click", applyDateFilter);
    yearSelect.addEventListener("change", () => {
        if(yearSelect.value) { 
            applyDateFilter(); // Tự động tải lại dữ liệu khi chọn năm
        }
    });
    [fromInput, toInput].forEach(el => {
        el.addEventListener("change", () => { if(yearSelect.value) yearSelect.value = ""; });
    });

    // --- HÀM XỬ LÝ KHI MỞ MODAL PHÂN TÍCH (Đã sửa logic lấy 7 ngày) ---
    async function openAnalysisModalHandler() {
        analysisModal.style.display = "block";
        toggleBodyScroll(true);
        analysisModalContent.innerHTML = '<p>Đang tải và phân tích dữ liệu...</p>';
        showLoading("Đang tải dữ liệu 7 ngày gần nhất...");

        try {
            // 1. Xác định khoảng 7 ngày gần nhất
            const today = new Date();
            const endDate = new Date(today); // Ngày kết thúc là hôm nay
            const startDate = new Date(today);
            startDate.setDate(today.getDate() - 6); // Lùi lại 6 ngày -> Tổng cộng 7 ngày

            const startDateStr = formatISODate(startDate);
            const endDateStr = formatISODate(endDate);

            console.log(`Analyzing reports from ${startDateStr} to ${endDateStr}`);

            // 2. Lấy TẤT CẢ báo cáo trong khoảng 7 ngày đó
            const reportsQuery = query(
                collection(db, "shift_reports"),
                where("reportDate", ">=", startDateStr),
                where("reportDate", "<=", endDateStr),
                orderBy("reportDate", "desc"), // Sắp xếp sẵn để dễ xử lý
                orderBy("shiftStartTime", "desc")
            );
            const reportSnapshot = await getDocs(reportsQuery);
            // Lưu tất cả báo cáo tìm thấy trong 7 ngày
            const reportsInPeriod = reportSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 3. Lấy dữ liệu Autoplan ((Song song))
            const dataPromises = [];
            if (allRulesData.length === 0) {
                dataPromises.push(getDocs(collection(db, "work_rules")));
            } else {
                dataPromises.push(Promise.resolve(null)); // Đẩy 1 promise rỗng để giữ vị trí
            }

            const [rulesSnapshot] = await Promise.all(dataPromises);

            if (rulesSnapshot) { // Chỉ gán nếu chúng ta thực sự đã tải
                allRulesData = rulesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }

            // 4. Phân tích (Hàm analyzeReports cần được sửa đổi)
            // Truyền cả khoảng ngày để hàm phân tích biết ngày nào bị thiếu
            const analysisResults = analyzeReportsByDate(reportsInPeriod, startDate, endDate, allRulesData);

            // 5. Hiển thị (Hàm renderAnalysisModal cũng cần sửa)
            renderAnalysisModal(analysisResults);

        } catch (error) {
            console.error("Lỗi khi phân tích báo cáo:", error);
            analysisModalContent.innerHTML = `<p style="color:red;">Lỗi: ${error.message}</p>`;
            showSwal("error", "Lỗi phân tích", error.message);
        } finally {
            hideLoading();
        }
    }
    // --- HÀM HELPER: CHUẨN HÓA VĂN BẢN (Bỏ dấu, lowercase) ---
    function normalizeText(str) {
        if (!str) return "";
        return str
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/đ/g, "d"); // Xử lý chữ 'đ'
    }

    // --- HÀM HELPER: TRÍCH XUẤT TỪ KHÓA ĐƠN GIẢN (ĐÃ SỬA) ---
    function extractKeywords(jobName) {
        if (!jobName) return [];
        const normalized = normalizeText(jobName);
        // ⭐ BƯỚC MỚI: Loại bỏ các dấu câu phổ biến ⭐
        const cleanedText = normalized.replace(/[.,;()"']/g, ''); // Xóa .,;()"
        // Tách theo khoảng trắng từ chuỗi đã được làm sạch
        return cleanedText.split(/\s+/).filter(word => word.length > 0);
    }

    // --- HÀM HELPER: KIỂM TRA QUY TẮC AUTOPLAN (Cần copy từ autoplan.html nếu chưa có) ---
    // Giả sử hàm getWeekOfMonth(date) và ruleMatchesDate(rule, d) đã tồn tại
    // Thêm helper: kiểm tra 1 rule có phù hợp với ngày d không
    function ruleMatchesDate(rule, d) {
        // NẾU CÓ NGÀY CỤ THỂ -> Chỉ xét duy nhất ngày đó
        if (rule.exactDate && rule.exactDate !== "") {
            const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return rule.exactDate === isoDate;
        }

        const dayNum = d.getDate();                    // ngày trong tháng (1..31)
        const monthNum = d.getMonth() + 1;             // tháng (1..12)
        const weekOfMonth = getWeekOfMonth(d);         // hàm bạn đã có
        const weekDay = d.getDay() === 0 ? 8 : d.getDay() + 1; // mapping: CN -> 8, T2..T7 -> 2..7

        // Ngày cụ thể trong tháng (dom)
        if (rule.dom && rule.dom !== "" && rule.dom !== String(dayNum)) return false;

        // Thứ
        if (rule.day && rule.day !== "" && rule.day !== "all") {
            // rule.day có thể lưu là string '8' cho CN hoặc số khác
            if (Number(rule.day) !== Number(weekDay)) return false;
        }

        // Tuần trong tháng
        if (rule.week && rule.week !== "" && rule.week !== "all") {
            if (Number(rule.week) !== Number(weekOfMonth)) return false;
        }

        // Tháng
        if (rule.month && rule.month !== "" && rule.month !== "all") {
            if (Number(rule.month) !== Number(monthNum)) return false;
        }

        return true;
    }
    //
    function getWeekOfMonth(date) {
        const day = date.getDate();
        return Math.ceil(day / 7);
    }

    // --- HÀM PHÂN TÍCH THEO NGÀY (MỚI - Thay thế analyzeReports) ---
    function analyzeReportsByDate(reportsInPeriod, startDate, endDate, rules) {
        const results = [];
        // Nhóm các báo cáo đã tải về theo ngày để truy cập nhanh
        const reportsByDate = {};
        reportsInPeriod.forEach(r => {
            if (!reportsByDate[r.reportDate]) {
                reportsByDate[r.reportDate] = [];
            }
            reportsByDate[r.reportDate].push(r);
        });

        // Lặp qua 7 ngày gần nhất, từ mới đến cũ
        for (let i = 0; i <= 6; i++) {
            const currentDate = new Date(endDate);
            currentDate.setDate(endDate.getDate() - i);
            const currentDateStr = formatISODate(currentDate);

            // 1. Tìm công việc dự kiến cho ngày này
            let expectedJobsDetails = [];
            const matchedRules = rules.filter(rule => ruleMatchesDate(rule, currentDate));
            matchedRules.forEach(rule => expectedJobsDetails.push({ name: rule.job || "N/A", keywords: extractKeywords(rule.job) }));
            const expectedJobNames = expectedJobsDetails.map(j => j.name); // Lấy tên để hiển thị tooltip

            // 2. Tìm báo cáo thực tế cho ngày này
            const actualReports = reportsByDate[currentDateStr] || [];

            if (actualReports.length === 0) {
                // --- TRƯỜNG HỢP NGÀY BỊ THIẾU BÁO CÁO ---
                results.push({
                    date: currentDateStr,
                    report: null, // Đánh dấu là thiếu báo cáo
                    expectedJobs: expectedJobNames,
                    notes: "",
                    result: "❌ THIẾU BÁO CÁO",
                    containsNegation: false,
                    analysisNote: expectedJobNames.length > 0 ? `Dự kiến có ${expectedJobNames.length} CV.` : "Không có CV dự kiến."
                });
            } else {
                // --- TRƯỜNG HỢP NGÀY CÓ BÁO CÁO ---
                // Sắp xếp các báo cáo trong ngày theo ca
                actualReports.sort((a, b) => (a.shiftStartTime || "00:00").localeCompare(b.shiftStartTime || "00:00"));

                // Phân tích từng báo cáo trong ngày
                actualReports.forEach(report => {
                    const notes = report.notes || "";
                    const normalizedNotes = normalizeText(notes);
                    const containsNegation = normalizedNotes.includes(" khong ");
                    let score = 0;
                    let maxScore = expectedJobsDetails.length * 2;
                    let matchedKeywordsCount = 0;
                    let analysisNote = "";

                    // So sánh và tính điểm (Logic giữ nguyên từ analyzeReports)
                    if (expectedJobsDetails.length === 0) {
                         if(notes.trim()) analysisNote += "Có ghi chú CV ngoài lịch?";
                    } else {
                        expectedJobsDetails.forEach(jobDetail => {
                            let jobScore = 0;
                            if (jobDetail.keywords.length > 0) {
                                let keywordsFound = 0;
                                jobDetail.keywords.forEach(kw => {
                                    if (normalizedNotes.includes(kw)) keywordsFound++;
                                });
                                matchedKeywordsCount += keywordsFound;
                                if (keywordsFound === jobDetail.keywords.length) jobScore = 2;
                                else if (keywordsFound > 0) jobScore = 1;
                            } else {
                                if (normalizedNotes.includes(normalizeText(jobDetail.name))) jobScore = 1;
                            }
                            score += jobScore;
                        });
                    }

                    // Đánh giá kết quả (Logic giữ nguyên)
                    let resultText = "Không xác định";
                    if (expectedJobsDetails.length === 0) resultText = "-";
                    else if (maxScore === 0) resultText = score > 0 ? "Có đề cập?" : "Không đề cập";
                    else {
                        const percentage = (score / maxScore) * 100;
                        if (percentage >= 80) resultText = "✅ Đầy đủ";
                        else if (percentage >= 40) resultText = "⚠️ Có đề cập / Thiếu";
                        else resultText = "❌ Không đề cập";
                    }
                    if (containsNegation) {
                        resultText += " (Có 'không')";
                        analysisNote = "Nội dung có chứa từ 'không'. Cần xem xét kỹ.";
                    } else if (expectedJobsDetails.length > 0 && matchedKeywordsCount === 0 && score === 0) {
                         analysisNote = "Không tìm thấy từ khóa nào khớp.";
                    }

                    results.push({
                        date: currentDateStr, // Thêm ngày vào kết quả
                        report: report, // Giữ lại báo cáo gốc
                        expectedJobs: expectedJobNames,
                        notes: notes,
                        result: resultText,
                        containsNegation: containsNegation,
                        analysisNote: analysisNote
                    });
                });
            }
        } // Kết thúc vòng lặp 7 ngày

        return results; // Mảng này giờ chứa cả báo cáo thực tế và thông tin ngày thiếu
    }

    // --- HÀM HIỂN THỊ KẾT QUẢ PHÂN TÍCH LÊN MODAL (Đã xử lý ngày thiếu) ---
    function renderAnalysisModal(analysisResults) {
        // ... (Phần kiểm tra rỗng và tái tạo bảng giữ nguyên) ...
        analysisModalContent.innerHTML = `
            <table id="analysisTable" class="w-100 mt-10">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                         <th style="width: 12%; text-align: center;">Ngày</th>
                         <th style="width: 15%; text-align: center;">Ca</th>
                         <th style="width: 43%; text-align: left;">Nội dung Báo cáo</th>
                         <th style="width: 30%; text-align: left;">Kết quả phân tích</th>
                    </tr>
                </thead>
                <tbody id="analysisTableBody"></tbody>
            </table>`;
        const newTableBody = document.getElementById('analysisTableBody');

        let tableHtml = "";
        analysisResults.forEach(item => {
            const report = item.report;
            const expectedJobsTooltip = item.expectedJobs.length > 0
                ? `CV dự kiến:\n- ${item.expectedJobs.join('\n- ')}`
                : "Không có CV dự kiến";
            const negationClass = item.containsNegation ? "has-negation" : "";

            if (report === null) {
                // --- HIỂN THỊ HÀNG CHO NGÀY BỊ THIẾU (Sửa lại còn 4 cột) ---
                tableHtml += `
                    <tr style="background-color: #ffebee;">
                        <td style="text-align: center;">${new Date(item.date + "T00:00:00").toLocaleDateString('vi-VN')}</td>
                        <td style="text-align: center;">-</td>
                        <td style="text-align: left; font-style: italic;">(Không có báo cáo)</td>
                        <td style="text-align: left;">
                            <span style="font-weight: bold;" title="${expectedJobsTooltip}">${item.result}</span>
                            ${item.analysisNote ? `<br><i style="font-size: 0.9em;">${item.analysisNote}</i>` : ''}
                        </td>
                    </tr>
                `;
            } else {
                // --- HIỂN THỊ HÀNG CHO NGÀY CÓ BÁO CÁO (Sửa lại còn 4 cột) ---
                const shortNotes = item.notes.length > 150 ? item.notes.substring(0, 147) + "..." : item.notes;
                // Gộp Kết quả và Ghi chú (Logic cũ đã đúng)
                let resultAndNoteHtml = `<span class="${negationClass}" title="${expectedJobsTooltip}">${item.result}</span>`;
                if (item.analysisNote) {
                    resultAndNoteHtml += `<br><i style="font-size: 0.9em;">${item.analysisNote}</i>`;
                }

                tableHtml += `
                    <tr>
                        <td style="text-align: center;">${report.reportDate || "N/A"}</td>
                        <td style="text-align: center;">${report.shiftName || "N/A"}</td>
                        <td style="text-align: left; white-space: pre-wrap;" title="${item.notes}">${shortNotes}</td>
                        <td style="text-align: left; white-space: pre-wrap;">${resultAndNoteHtml}</td>
                    </tr>
                `;
            }
        });

        newTableBody.innerHTML = tableHtml;
    }
    // --- HÀM MỚI: Tải dữ liệu báo cáo cho một khoảng thời gian ---
    async function fetchReportsForPeriod(startDateStr, endDateStr, collectionName = "shift_reports") {
        showLoading("Đang đồng bộ và tải dữ liệu...");
        try {
            const lastSync = await getLastSyncTime(collectionName);

            // 1. Sync Deletes (Tombstone) - Bỏ qua vì chưa có cơ chế xóa shift_reports

            // 2. Sync Upserts (New/Modified)
            let newRecords = [];
            if (lastSync === 0) {
                const qAll = query(collection(db, collectionName));
                const snapAll = await getDocs(qAll);
                newRecords = snapAll.docs.map(doc => ({id: doc.id, ...doc.data()}));
            } else {
                // Dùng updatedAt (được đổi từ lastSaved) để bắt cả Sửa và Thêm mới
                const qUpdated = query(collection(db, collectionName), where("updatedAt", ">", new Date(lastSync)));
                const snapU = await getDocs(qUpdated);
                newRecords = snapU.docs.map(d => ({id: d.id, ...d.data()}));
            }

            if (newRecords.length > 0) {
                const parsedRecords = newRecords.map(data => ({
                    ...data,
                    _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
                    _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : null,
                }));
                await saveToLocalDB(collectionName, parsedRecords);
            }
            await setLastSyncTime(collectionName, Date.now());

            // 3. Get all data from IndexedDB
            const allLocalData = await getAllFromLocalDB(collectionName);
            
            // 4. Filter in-memory
            const periodReports = allLocalData.filter(r => {
                const reportDate = r.reportDate;
                return reportDate && reportDate >= startDateStr && reportDate <= endDateStr;
            });

            // 5. Sort in-memory
            periodReports.sort((a, b) => {
                if (a.reportDate !== b.reportDate) {
                    return a.reportDate.localeCompare(b.reportDate);
                }
                return (a.shiftStartTime || "").localeCompare(b.shiftStartTime || "");
            });

            console.log(`Đã tải ${periodReports.length} báo cáo từ IndexedDB cho kỳ ${startDateStr} - ${endDateStr}.`);
            return periodReports;

        } catch (error) {
            console.error("Lỗi khi tải dữ liệu từ IndexedDB:", error);
            showSwal("error", "Lỗi tải dữ liệu", error.message);
            throw error;
        } finally {
            // Tắt loading sẽ do hàm gọi nó thực hiện
        }
    }
    // --- HÀM CHÍNH KHI ĐĂNG NHẬP (ĐÃ SỬA LẠI VỊ TRÍ LISTENER) ---
  onAuth(async (user) => {
      if (user) {
          notLogged.style.display = "none";
          content.style.display = "block";
          if (footerPlaceholder) footerPlaceholder.style.display = "block";
          let userRole = null; // Khai báo userRole ở phạm vi hàm onAuth

          // ⭐ SỬA LỖI: Bỏ 'const' để cập nhật biến toàn cục ⭐
          openAnalysisModalBtn = document.getElementById('openAnalysisModal');
          analysisModal = document.getElementById('analysisModal'); // <-- Cập nhật biến toàn cục
          closeAnalysisModalBtn = document.getElementById('closeAnalysisModal');
          closeAnalysisModalBottomBtn = document.getElementById('closeAnalysisModalBottom');
          analysisModalContent = document.getElementById('analysisModalContent');
          analysisTableBody = document.getElementById('analysisTableBody');
          // Cũng bỏ const cho các biến checkbox chi tiết nếu bạn di chuyển chúng vào đây
          viewDetailsCheckbox = document.getElementById('viewDetailsCheckbox');
          detailsTableContainer = document.getElementById('detailsTableContainer');
          // ⭐ KẾT THÚC SỬA LỖI ⭐

          try {
              // Lấy vai trò người dùng TRƯỚC
              userRole = await getRole(user.email);

              // --- BẮT ĐẦU THAY THẾ TỪ ĐÂY ---
              showLoading("Đang tải danh sách năm...");
              
              // 1. Tạo 2 truy vấn (query) siêu nhẹ
              const newestReportQuery = query(
                  collection(db, "shift_reports"),
                  orderBy("reportDate", "desc"), // Sắp xếp giảm dần
                  limit(1) // Chỉ lấy 1
              );
              const oldestReportQuery = query(
                  collection(db, "shift_reports"),
                  orderBy("reportDate", "asc"), // Sắp xếp tăng dần
                  limit(1) // Chỉ lấy 1
              );

              // 2. Thực thi 2 truy vấn này song song
              const [newestSnapshot, oldestSnapshot] = await Promise.all([
                  getDocs(newestReportQuery),
                  getDocs(oldestReportQuery)
              ]);

              let years = []; // Khởi tạo mảng years rỗng

              // 3. Xử lý kết quả (chỉ khi cả 2 đều có dữ liệu)
              if (!newestSnapshot.empty && !oldestSnapshot.empty) {
                  const newestDateStr = newestSnapshot.docs[0].data().reportDate;
                  const oldestDateStr = oldestSnapshot.docs[0].data().reportDate;

                  const newestYear = parseInt(newestDateStr.substring(0, 4));
                  const oldestYear = parseInt(oldestDateStr.substring(0, 4));

                  // 4. Tạo mảng 'years' từ năm mới nhất -> cũ nhất
                  for (let y = newestYear; y >= oldestYear; y--) {
                      years.push(y.toString());
                  }
                  // 'years' bây giờ là ['2025', '2024', '2023', ...]
              } else {
                  console.log("Không tìm thấy báo cáo nào trong CSDL.");
              }
              // --- KẾT THÚC PHẦN THAY THẾ ---
              yearSelect.innerHTML = `<option value="">--Chọn năm--</option>`; // Xóa các option cũ trước khi thêm
              years.forEach(y => yearSelect.innerHTML += `<option value="${y}">${y}</option>`);

              let initialStartDateStr, initialEndDateStr;

              // Xử lý tải lần đầu (năm hiện tại)
              if (initialLoad) {
                  const currentYear = new Date().getFullYear().toString();
                  if (years.includes(currentYear)) {
                      initialStartDateStr = `${currentYear}-01-01`;
                      const now = new Date();
                      if (now.getFullYear().toString() === currentYear) {
                          initialEndDateStr = formatISODate(now);
                      } else {
                          initialEndDateStr = `${currentYear}-12-31`;
                      }
                      fromInput.value = initialStartDateStr;
                      toInput.value = initialEndDateStr;
                      yearSelect.value = currentYear;
                  } else if (years.length > 0) { // Nếu không có năm hiện tại, lấy năm mới nhất
                      const latestYear = years[0];
                      initialStartDateStr = `${latestYear}-01-01`;
                      initialEndDateStr = `${latestYear}-12-31`;
                      fromInput.value = initialStartDateStr;
                      toInput.value = initialEndDateStr;
                      yearSelect.value = latestYear;
                  } else {
                      hideLoading();
                      return; // Dừng nếu không có năm nào
                  }

                  // Tải dữ liệu chỉ cho năm hiện tại
                  allReportsData = await fetchReportsForPeriod(initialStartDateStr, initialEndDateStr);
                  currentFilter.from = initialStartDateStr;
                  currentFilter.to = initialEndDateStr;

                // === BẮT ĐẦU SỬA TỪ ĐÂY ===

                // Gọi hàm tính toán 3 LẦN
                const weekData = calculatePeriodData('week', allReportsData);
                const monthData = calculatePeriodData('month', allReportsData);
                const yearData = calculatePeriodData('year', allReportsData);

                // Gọi hàm render mới (render cả 3 cột)
                renderSummary(weekData, monthData, yearData);

                // Tính và render bảng chi tiết (cho NĂM)
                // (allReportsData đã được lọc cho cả năm)
                const dailyDetailsYear = calculateDailyDetails(allReportsData); 
                renderDetailsTable(dailyDetailsYear);

                initialLoad = false;
                // === KẾT THÚC SỬA ===
            } // Kết thúc if(initialLoad)

              // === DI CHUYỂN CÁC LISTENER VÀO ĐÂY ===

              // --- LISTENER CHO CHECKBOX XEM CHI TIẾT ---
              // Đảm bảo chỉ gắn listener MỘT LẦN
              if (viewDetailsCheckbox && !viewDetailsCheckbox.dataset.listenerAttached) {
                  viewDetailsCheckbox.addEventListener('change', () => {
                      detailsTableContainer.style.display = viewDetailsCheckbox.checked ? 'block' : 'none';
                  });
                  viewDetailsCheckbox.dataset.listenerAttached = 'true'; // Đánh dấu đã gắn
              }

              // --- GẮN SỰ KIỆN CHO MODAL PHÂN TÍCH ---
              // Đảm bảo chỉ gắn listener MỘT LẦN
              if (openAnalysisModalBtn && userRole === 'admin' && !openAnalysisModalBtn.dataset.listenerAttached) {
                  openAnalysisModalBtn.style.display = 'inline-block'; // Hiện nút
                  openAnalysisModalBtn.addEventListener('click', openAnalysisModalHandler);
                  openAnalysisModalBtn.dataset.listenerAttached = 'true'; // Đánh dấu đã gắn
              }
              // Gắn listener đóng modal (có thể gắn nhiều lần nhưng không sao)
              if (analysisModal && closeAnalysisModalBtn && closeAnalysisModalBottomBtn) {
                  const closeModal = () => { 
                      analysisModal.style.display = "none"; 
                      toggleBodyScroll(false);
                  };
                  // Kiểm tra trước khi gắn để tránh gắn lặp lại nếu onAuth chạy lại
                  if (!closeAnalysisModalBtn.dataset.listenerAttached) {
                     closeAnalysisModalBtn.addEventListener('click', closeModal);
                     closeAnalysisModalBtn.dataset.listenerAttached = 'true';
                  }
                   if (!closeAnalysisModalBottomBtn.dataset.listenerAttached) {
                     closeAnalysisModalBottomBtn.addEventListener('click', closeModal);
                     closeAnalysisModalBottomBtn.dataset.listenerAttached = 'true';
                   }
                  // Listener đóng khi click ngoài (an toàn khi gắn nhiều lần)
                  window.addEventListener('click', (event) => {
                      if (event.target == analysisModal) {
                          closeModal();
                      }
                  });
              }
              // === KẾT THÚC DI CHUYỂN LISTENER ===

          } catch (error) {
              console.error("Lỗi khi khởi tạo hoặc gắn listener:", error);
              showSwal("error", "Lỗi khởi tạo", error.message);
              hideLoading();
          }
           // hideLoading() nên được gọi cuối cùng trong calculateAndRenderSummary hoặc fetchReportsForPeriod

      } else {
          // Xử lý khi người dùng chưa đăng nhập
          notLogged.style.display = "flex";
          content.style.display = "none";
          if (footerPlaceholder) footerPlaceholder.style.display = "block";
          // Có thể thêm code reset các biến global ở đây nếu cần
          allReportsData = [];
          initialLoad = true;
          currentFilter = { from: null, to: null };
          // Xóa các option năm cũ
          if(yearSelect) yearSelect.innerHTML = '<option value="">--Chọn năm--</option>';
      }
  }); // <-- Đóng hàm onAuth