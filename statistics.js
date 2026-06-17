import { doc, getDoc, deleteDoc, addDoc, setDoc, updateDoc, collection, query, where, getDocs, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {listenReports, listenCollection, onAuth, getRole, db, showLoading, hideLoading, showSwal, showConfirmSwal, getReportsByDate, auth, addLog} from "./script.js";
import { initMenu } from "./menu.js";
import { formatISODate, formatVNDate, safeFixed, getCompanyConfigAtDate, getPeriodsInFilter, getBillingPeriodsInFilter } from "./core-calculator.js";



// load menu
    fetch("menu.html").then(r => r.text()).then(h => {
      document.getElementById("menu-placeholder").innerHTML = h;
      if (typeof initMenu === "function") initMenu();
    });    

// load modal loading
    fetch("modal.html").then(r => r.text()).then(h => {
      document.getElementById("loading-placeholder").innerHTML = h;
    });
// TẢI FOOTER (thêm đoạn này vào)
    fetch("footer.html").then(r => r.text()).then(h => {
        document.getElementById("footer-placeholder").innerHTML = h;
    });
    const notLogged = document.getElementById("notLogged");
    const content   = document.getElementById("pageContent");
    const tbody     = document.querySelector("#reportTable tbody");
    
    // MỚI: DOM ref cho bảng chi tiết ngày nghỉ
    const holidayDetailReportDiv = document.getElementById('holidayDetailReport');
    const holidayDetailTableBody = document.querySelector('#holidayDetailTable tbody');
    const holidayDetailTableHead = document.querySelector('#holidayDetailTable thead');

    let userRole = null;

    // DOM refs
    const theadRow = document.querySelector("#reportTable thead tr");

    // DOM refs cho bộ lọc
    const fromInput = document.getElementById("fromDate");
    const toInput = document.getElementById("toDate");
    const yearSelect = document.getElementById("yearSelect");
    const applyFilterBtn = document.getElementById("applyFilter");
    const companyGroupFilter = document.getElementById('companyGroupFilter'); 
    
    // DOM ref cho công tắc 3 nấc
    const reportModeToggle = document.getElementById('reportModeToggle');


    // data & config
    let allReports = []; 
    let allHolidayRecords = []; 
    let allProcessedHolidays = {}; 
    let currentFilter = { from: null, to: null };
    let config = { weekDayStart: 0, monthDayStart: 1, yearDayStart: 1, quotaMultipliers: {} }; 
    let isInitialLoad = true;
    
    // MỚI: Biến lưu trữ dữ liệu chi tiết ngày nghỉ (khi Mode 2 bật)
    let allHolidayDetails = { week: [], month: [], billing: [], year: [] }; 

    
    // === MASTER LIST NEW VARIABLES ===
    let allMasterCompanies = [];
    // === END MASTER LIST NEW VARIABLES ===
    
    let allCompanyConfigs = []; // MỚI: Lưu trữ lịch sử cấu hình công ty

    // MỚI: Hàm lấy nhóm công ty tự động dựa trên thời điểm hiện tại của bộ lọc
    function getCompanyGroup(company) {
        const targetDate = currentFilter.to || formatISODate(new Date());
        const c = getCompanyConfigAtDate(company, targetDate, allCompanyConfigs);
        if (c && c.group) return c.group;
        if (['NTSF', 'Ấn Độ Dương', 'Đại Tây Dương', 'Amicogen', 'Cá Việt Nam'].includes(company)) return 'group1';
        return 'group3';
    }
    
    // === START: LOGIC LỌC THEO NHÓM CÔNG TY (Lọc theo CỘT) ===
    
    /**
     * Lọc các cột của bảng chi tiết ngày nghỉ #holidayDetailTable
     */
    function filterHolidayDetailTableByCompanyGroup(companies) {
        const filterSelect = document.getElementById('companyGroupFilter');
        const detailTable = document.getElementById('holidayDetailTable') 
                        || document.getElementById('holidayDetailReport');
        
        // ✅ Nếu không có filterSelect hoặc bảng chi tiết → thoát ngay
        if (!filterSelect || !detailTable) {
            return;
        }

        const selectedGroup = filterSelect.value;

        const theadRow = detailTable.querySelector("thead tr");
        if (!theadRow) return; // thêm check an toàn

        const tbodyRows = detailTable.querySelectorAll("tbody tr");
        const companyHeaders = Array.from(theadRow.querySelectorAll('th'));
        const columnVisibility = [true]; // Cột đầu tiên (Kỳ) luôn hiện

        companyHeaders.slice(1).map(th => th.textContent.trim())
            .forEach(name => {
                const isAllowed = selectedGroup === 'all' || getCompanyGroup(name) === selectedGroup;
                columnVisibility.push(isAllowed);
            });

        // Ẩn/Hiện cột trong THEAD
        companyHeaders.forEach((th, index) => {
            if (index > 0) { 
                th.style.display = columnVisibility[index] ? '' : 'none';
            }
        });

        // Ẩn/Hiện cột trong TBODY
        tbodyRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length === 1) return; 
            cells.forEach((td, index) => {
                if (index > 0) { 
                    td.style.display = columnVisibility[index] ? '' : 'none';
                }
            });
        });
    }



    /**
     * Lọc các cột của bảng #reportTable dựa trên nhóm công ty đã chọn.
     */
    function filterReportByCompanyGroup() {
        const filterSelect = document.getElementById('companyGroupFilter');
        const reportTable = document.getElementById('reportTable');
        
        if (!filterSelect || !reportTable) return;
        
        const selectedGroup = filterSelect.value;

        const theadRow = document.querySelector("#reportTable thead tr");
        const tbodyRows = document.querySelectorAll("#reportTable tbody tr");

        // 1. Lấy tên công ty từ TH và xác định khả năng hiển thị của từng cột
        const companyHeaders = Array.from(theadRow.querySelectorAll('th'));
        const columnVisibility = [true]; // Cột đầu tiên (Lưu lượng) luôn hiện

        const companies = companyHeaders.slice(1).map(th => th.textContent.trim());
        companies.forEach(name => {
            const isAllowed = selectedGroup === 'all' || getCompanyGroup(name) === selectedGroup;
            columnVisibility.push(isAllowed);
        });

        // 2. Ẩn/Hiện cột trong THEAD
        companyHeaders.forEach((th, index) => {
            if (index > 0) { 
                th.style.display = columnVisibility[index] ? '' : 'none';
            }
        });

        // 3. Ẩn/Hiện cột trong TBODY
        tbodyRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            cells.forEach((td, index) => {
                if (index > 0) { 
                    td.style.display = columnVisibility[index] ? '' : 'none';
                }
            });
        });
        
        // 4. Lọc bảng chi tiết ngày nghỉ (nếu có)
        filterHolidayDetailTableByCompanyGroup(companies);


        console.log(`LOG: Đã áp dụng bộ lọc nhóm công ty: ${selectedGroup}.`);
    }
    // === END: LOGIC LỌC THEO NHÓM CÔNG TY ===
    if (getReportMode() === 2) {
        filterHolidayDetailTableByCompanyGroup();
    }


    // ** FIX LỖI TOGGLE: EVENT DELEGATION **
    tbody.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest(".toggle-btn");
        if (!toggleBtn) return;
        
        e.stopPropagation();

        const mainRow = toggleBtn.closest("tr.main-row");
        if (!mainRow) return;

        const target = mainRow.dataset.target;
        const childRows = document.querySelectorAll(`tr[data-parent="${target}"]`);
        
        const isCurrentlyOpen = childRows[0] && childRows[0].style.display === "table-row"; 
        const isNowOpen = !isCurrentlyOpen; 

        childRows.forEach(row => {
            row.style.display = isNowOpen ? "table-row" : "none";
        });

        toggleBtn.textContent = isNowOpen ? "▼" : "▶";
    });
    // ** KẾT THÚC FIX LỖI TOGGLE **
    
    // LOGIC TOGGLE CHO BẢNG CHI TIẾT NGÀY NGHỈ (ĐỒNG BỘ VỚI VISIBLE COUNTS)
    const HOLIDAY_DEFAULT_VISIBLE = { week: 5, month: 2, billing: 2, year: 0 };

    holidayDetailTableBody.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest(".toggle-btn");
    if (!toggleBtn) return;
    e.stopPropagation();

    const targetId = toggleBtn.dataset.targetId;
    if (!targetId) return;

    const childRows = document.querySelectorAll(`tr[data-parent-id="${targetId}"]`);
    if (!childRows || childRows.length === 0) return;

    const isCurrentlyClosed = (toggleBtn.textContent.trim() === '▶'); // ▶ nghĩa là đang gọn, bấm để mở

    if (isCurrentlyClosed) {
        // Mở: hiện tất cả các hàng
        childRows.forEach(row => row.style.display = "table-row");
        toggleBtn.textContent = "▼";
        return;
    }

    // Đóng: hiển thị lại theo quy tắc mặc định cho từng loại
    const typeKey = targetId.replace("toggle-detail-", ""); // => 'week' | 'month' | 'billing' | 'year'
    const visibleCount = HOLIDAY_DEFAULT_VISIBLE[typeKey] !== undefined ? HOLIDAY_DEFAULT_VISIBLE[typeKey] : childRows.length;

    childRows.forEach((row, index) => {
        if (index < visibleCount) {
        row.style.display = "table-row";
        } else {
        row.style.display = "none";
        }
    });

    toggleBtn.textContent = "▶";
    });

    // ** KẾT THÚC LOGIC TOGGLE CHI TIẾT NGÀY NGHỈ **

    // ========== UTILS ==========
    
    // HÀM 1: FORMAT NGÀY NGHỈ CHO TOOLTIP (sử dụng &#10;)
    function formatHolidayDates(dateStrings) {
        if (!dateStrings || dateStrings.length === 0) return '';
        
        dateStrings.sort((a, b) => new Date(a) - new Date(b));

        return "Các ngày nghỉ:\n" + dateStrings.map(isoDate => {
            const parts = isoDate.split('-');
            const day = parts[2];
            const month = parts[1];
            const year = parts[0];
            return `${day}/${month}/${year}`; 
        }).join('&#10;');
    }
    
    // HÀM 2: FORMAT NGÀY NGHỈ CHO CELL (sử dụng <br>)
    function formatHolidayDatesInline(dateStrings) {
        if (!dateStrings || dateStrings.length === 0) return 'Không nghỉ';
        
        dateStrings.sort((a, b) => new Date(a) - new Date(b));

        return dateStrings.map(isoDate => {
            const parts = isoDate.split('-');
            const day = parts[2];
            const month = parts[1];
            const year = parts[0];
            return `${day}/${month}/${year}`; 
        }).join('<br>');
    }
    
    // MỚI: HÀM GET REPORT MODE
    function getReportMode() {
        const checkedRadio = document.querySelector('input[name="report-mode"]:checked');
        return checkedRadio ? Number(checkedRadio.value) : 0; // Default: 0 (Normal)
    }

    // ========== BỔ SUNG: LOGIC HIỂN THỊ GHI CHÚ CUỐI BẢNG ==========
    function toggleFooterNoteDisplay() {
        const reportFooterNote = document.getElementById('reportFooterNote');
        const mode = getReportMode(); // Lấy giá trị mode (0, 1, 2)
        
        if (reportFooterNote) {
            // Hiển thị nếu mode là 1 (Ngày nghỉ) hoặc 2 (Chi tiết)
            if (mode === 1 || mode === 2) {
                reportFooterNote.style.display = 'block';
            } else {
                reportFooterNote.style.display = 'none';
            }
        }
    }
    //
    // HÀM MỚI: CẬP NHẬT VỊ TRÍ SLIDER CHO TOGGLE SWITCH
    function updateToggleSlider() {
        const toggle = document.getElementById('reportModeToggle');
        const slider = toggle.querySelector('a');
        const checked = toggle.querySelector('input:checked');
        if (!checked) return;

        const index = Number(checked.value); // 0,1,2
        const styles = getComputedStyle(document.documentElement);
        const labelWidth = parseFloat(styles.getPropertyValue('--label-width'));
        const gap = parseFloat(styles.getPropertyValue('--gap')) || 0;

        // vị trí = index * (labelWidth + gap)
        const offset = index * (labelWidth + gap);
        slider.style.transform = `translateX(${offset}px)`;
        }
    // ========== RENDER ==========
    function reRenderReport() {
        let finalFrom = currentFilter.from;
        let finalTo = currentFilter.to;
        const now = new Date();
        const currentYearStart = formatISODate(new Date(now.getFullYear(), 0, 1)); 
        const todayISO = formatISODate(now);

        if (!finalFrom) finalFrom = currentYearStart;
        if (!finalTo) finalTo = todayISO;
        
        currentFilter.from = finalFrom;
        currentFilter.to = finalTo;

        renderReport(allReports);
        updateToggleSlider();
        // BỔ SUNG: Điều khiển ghi chú cuối bảng sau khi render xong
        toggleFooterNoteDisplay(); 
        }
    //
    // enhance accessibility & keyboard navigation for 3-way toggle
(function enhanceReportModeToggle() {
  const container = document.getElementById('reportModeToggle');
  if (!container) return;

  const inputs = Array.from(container.querySelectorAll('input[type="radio"]'));
  const labels = inputs.map(i => document.querySelector(`label[for="${i.id}"]`));
  const slider = container.querySelector('a');

  // init aria roles
  container.setAttribute('role', 'tablist');
  labels.forEach((lbl, idx) => {
    if (!lbl) return;
    lbl.setAttribute('role', 'tab');
    lbl.setAttribute('tabindex', '0'); // make label focusable
    lbl.dataset.index = String(idx);
  });

  // ensure slider position is correct on load
  setTimeout(() => { updateToggleSlider(); }, 10);

  // when radios change, move slider and re-render (keeps existing behavior)
  inputs.forEach((inp, idx) => {
    inp.addEventListener('change', () => {
      // mark aria-selected on labels
      labels.forEach(l => l && l.setAttribute('aria-selected', 'false'));
      const lbl = labels[idx];
      if (lbl) lbl.setAttribute('aria-selected', 'true');

      // move slider (fallback to existing function)
      try { updateToggleSlider(); } catch(e){ /* ignore */ }
      // re-render
      try { reRenderReport(); } catch(e){ console.warn(e); }
    });
  });

  // keyboard navigation: Left/Right arrows to change selection
    container.addEventListener('keydown', (ev) => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(ev.key)) return;
        ev.preventDefault();
        const curIndex = inputs.findIndex(i => i.checked);
        let nextIndex = curIndex;
        if (ev.key === 'ArrowLeft') nextIndex = Math.max(0, curIndex - 1);
        if (ev.key === 'ArrowRight') nextIndex = Math.min(inputs.length - 1, curIndex + 1);
        if (ev.key === 'Home') nextIndex = 0;
        if (ev.key === 'End') nextIndex = inputs.length - 1;
        if (nextIndex !== curIndex && inputs[nextIndex]) {
        inputs[nextIndex].checked = true;
        inputs[nextIndex].dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    // also allow Enter/Space on labels to toggle (for screen readers)
    labels.forEach(lbl => {
        if (!lbl) return;
        lbl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const idx = Number(lbl.dataset.index || 0);
            if (inputs[idx]) {
            inputs[idx].checked = true;
            inputs[idx].dispatchEvent(new Event('change', { bubbles: true }));
            inputs[idx].focus();
            }
        }
        });
    });
    })();

    // MỚI: HÀM RENDER BẢNG CHI TIẾT NGÀY NGHỈ
    function renderHolidayDetailTable(allData, companies) {
        
        holidayDetailTableBody.innerHTML = ''; // Clear previous content
        
        // 1. Render Headers
        const tableHeaders = companies.map(c => `<th>${c}</th>`).join('');
        holidayDetailTableHead.innerHTML = `<tr><th>Kỳ</th>${tableHeaders}</tr>`;
        
        // 2. Render Body
        let bodyHtml = "";
        
        // Thứ tự hiển thị
        const periodTypes = [
            { key: 'week', label: 'TUẦN' }, 
            { key: 'month', label: 'THÁNG' }, 
            { key: 'billing', label: 'KỲ THU PHÍ' }, 
            { key: 'year', label: 'NĂM' }
        ];

        periodTypes.forEach(type => {
            const allPeriods = allData[type.key];
            if (!allPeriods || allPeriods.length === 0) return;

        // Xác định số lượng hàng hiển thị mặc định (đồng bộ với handler toggle)
            let visibleCount;
            if (type.key === 'month' || type.key === 'billing') {
                visibleCount = 2; // Kỳ hiện tại + 1 quá khứ
            } else if (type.key === 'year') {
                visibleCount = 0; // ẩn hết
            } else if (type.key === 'week') {
                visibleCount = 5; // 1 kỳ hiện tại + 4 kỳ quá khứ (yêu cầu của bạn)
            } else {
                visibleCount = allPeriods.length;
            }

            let toggleId = `toggle-detail-${type.key}`;
            let headerLabel;

            // Hàng tiêu đề loại kỳ
            bodyHtml += `<tr style="height: 5px;"><td colspan="${companies.length + 1}" style="border: none; padding: 0;"></td></tr>`;

            headerLabel = `# CHI TIẾT NGÀY NGHỈ THEO ${type.label} `;

            // Thêm nút toggle nếu có hàng cần ẩn
            if (allPeriods.length > visibleCount) {
                // Nếu có hàng bị ẩn mặc định -> icon là '▶' (đóng/gọn)
                const iconText = (allPeriods.length > visibleCount) ? '▶' : '▼';
                headerLabel = `# CHI TIẾT NGÀY NGHỈ THEO ${type.label} (${visibleCount}/${allPeriods.length}) <span class="toggle-btn" data-target-id="${toggleId}">${iconText}</span> `;
            }

            bodyHtml += `<tr style="background: #f0f0f0; font-weight: bold;" class="detail-period-header"><td colspan="${companies.length + 1}" style="text-align: left; background: #e0e0e0; font-size: 1.1em;">${headerLabel}</td></tr>`;

            // Render tất cả các kỳ, nhưng set display dựa trên visibleCount
            allPeriods.forEach((period, index) => {
                // Xác định trạng thái hiển thị mặc định dựa trên visibleCount
                const displayStyle = (index < visibleCount) ? "table-row" : "none";

                let rowHtml = `<tr class="child-row-detail" data-parent-id="${toggleId}" style="display: ${displayStyle};"><td style="text-align: left;">${period.label}</td>`;
                companies.forEach(company => {
                    const detail = period.companyData[company] || 'Không có ngày nghỉ';
                    rowHtml += `<td>${detail}</td>`;
                });
                rowHtml += '</tr>';
                bodyHtml += rowHtml;
            });

        });

        holidayDetailTableBody.innerHTML = bodyHtml;
        holidayDetailReportDiv.style.display = 'block';

        // Ẩn/hiện cột theo bộ lọc nhóm công ty
        filterHolidayDetailTableByCompanyGroup(companies);
    }


    function renderReport(reports) {
        const byCompany = {};
        reports.forEach(r => {
            if (!r.company || !r.ngay_ghi || r.chi_so == null) return;
            const valStr = r.chi_so.toString().replace(/,/g, '.'); 
            let finalVal = Number(valStr);
            
            if (valStr.includes('.') && valStr.split('.').length > 2) {
                finalVal = Number(valStr.replace(/\./g, ''));
            } else if (valStr.includes('.') && valStr.split('.')[1].length === 3) {
                 finalVal = Number(valStr.replace(/\./g, ''));
            } else {
                 finalVal = Number(valStr);
            }

            const d = new Date(r.ngay_ghi);
            if (isNaN(d) || isNaN(finalVal)) return;

            if (!byCompany[r.company]) byCompany[r.company] = []; 
            byCompany[r.company].push({ date: d, value: finalVal });
        });

        Object.keys(byCompany).forEach(c => {
            byCompany[c].sort((a, b) => a.date - b.date);
        });

        const companiesFromReports = Object.keys(byCompany);
        const companiesFromMaster = allMasterCompanies.map(c => c.company).filter(Boolean);
        const companiesFromConfigs = allCompanyConfigs.map(c => c.company).filter(Boolean);
        
        const allUniqueCompanies = new Set([
            ...companiesFromReports, 
            ...companiesFromMaster,
            ...companiesFromConfigs
        ]);

        const companies = Array.from(allUniqueCompanies).sort((a, b) => a.localeCompare(b));

        const tableHeaders = companies.map(c => `<th>${c}</th>`).join('');
        theadRow.innerHTML = `<th>Lưu lượng</th>${tableHeaders}`;
        tbody.innerHTML = "";

        const from = currentFilter.from ? new Date(currentFilter.from) : new Date(new Date().getFullYear(), 0, 1);
        const to = currentFilter.to ? new Date(currentFilter.to) : new Date();
        to.setHours(23, 59, 59, 999);
        
        // LẤY TRẠNG THÁI MỚI (0: Normal, 1: Count, 2: List)
        const reportMode = getReportMode(); 
        
        // BƯỚC MỚI: Reset holiday details và ẩn bảng chi tiết ngày nghỉ
        allHolidayDetails = { week: [], month: [], billing: [], year: [] };
        holidayDetailReportDiv.style.display = 'none';

        function renderPeriod(name, periodDataByCompany, prefix, reportMode) {
          let html = "";
          const latestDates = periodDataByCompany
            .map(d => d?.data?.current?.latestDataDate)
            .filter(date => date != null);

          const uniqueDates = [...new Set(latestDates.map(d => d instanceof Date ? formatVNDate(d) : d))];

          let endLabel;
          if (uniqueDates.length === 1) {
            endLabel = uniqueDates[0];   
          } else if (uniqueDates.length > 1) {
            endLabel = ">";       
          } else {
            endLabel = formatVNDate(new Date()); 
          }

          
        const rawStartDate = periodDataByCompany[0]?.data?.current?.start;

        let startLabel;
        if (rawStartDate) {
            startLabel = formatVNDate(rawStartDate);
        } else {
            startLabel = "N/A";
        }

        let currentLabel = `${name} hiện tại (${startLabel} - ${endLabel})`;
        if (prefix === "billing") {
            currentLabel = "Kỳ thu phí hiện tại";
        }
        const toggleHtml = `<span class="toggle-btn">▶</span>`;


        // Logic để xác định nội dung ô (Total)
        function getDisplayContent(dataItem, isPast = false, idx = 0) {
            const currentData = isPast ? dataItem?.data?.past[idx] : dataItem?.data?.current;
            const totalFixed = currentData ? safeFixed(currentData.total, 1) : 'N/A';
            const dayOffs = currentData?.dayOffsCount || 0;
            const holidayDates = currentData?.holidayDates || [];
            
            let displayContent;
            let tooltips = [];
            
            if (prefix === "billing" && currentData && currentData.start) {
                const startStr = formatVNDate(currentData.start);
                let endStr = '';
                if (!isPast) {
                    endStr = "Hôm nay";
                } else {
                    const endMark = new Date(currentData.end.getTime() - 86400000);
                    endStr = formatVNDate(endMark);
                }
                tooltips.push(`Dữ liệu tính từ: ${startStr} đến ${endStr}`);
            }
            
            // Thêm tooltip giải thích phép tính (áp dụng cho cả khi có số và khi N/A)
            if (currentData) {
                let sVal = currentData.startValue != null ? currentData.startValue.toLocaleString('vi-VN') : "N/A";
                let eVal = currentData.endValue != null ? currentData.endValue.toLocaleString('vi-VN') : "N/A";
                tooltips.push(`Phép tính: ${eVal} - ${sVal}`);
            } else {
                tooltips.push(`Phép tính: N/A - N/A`);
            }
            
            // Mode 0 (Bình thường): Hiển thị Tổng lưu lượng
            if (reportMode === 0) { 
                displayContent = totalFixed;
            } 
            // Mode 1 (Ngày nghỉ) và Mode 2 (Chi tiết) hiển thị Tổng lưu lượng (Số ngày nghỉ)
            else { 
                displayContent = `${totalFixed} (${dayOffs})`;
                const tooltipDates = formatHolidayDates(holidayDates);
                if (tooltipDates) tooltips.push(tooltipDates);
            }
            
            let tooltipAttr = '';
            if (tooltips.length > 0) {
                tooltipAttr = `title="${tooltips.join('&#10;---&#10;')}"`;
            }

            // Thu thập dữ liệu chi tiết ngày nghỉ nếu đang ở Mode 2
            let holidayDetail = null;
            if (reportMode === 2) {
                 let detailLabel = isPast ? currentData.label : currentLabel;
                 if (prefix === "billing") {
                     detailLabel = isPast ? `Kỳ trước ${idx + 1}` : currentLabel;
                 }
                 holidayDetail = {
                    label: detailLabel,
                    company: dataItem.company,
                    datesHtml: formatHolidayDatesInline(holidayDates)
                };
            }
            
            return { displayContent, tooltipAttr, holidayDetail };
        }


          // ===== render phần Tổng (total-current-row - Xanh Nhạt) =====
          html += `<tr class="main-row current-row total-current-row" data-target="toggle-${prefix}-total">
            <td>Tổng ${currentLabel} (m³)${toggleHtml}</td>
            ${periodDataByCompany.map(d => {
                const { displayContent, tooltipAttr } = getDisplayContent(d, false);
                return `<td ${tooltipAttr}>${displayContent}</td>`;
            }).join('')}
          </tr>`;

          // --- DATA COLLECTION CHO MODE 2 (Kỳ hiện tại) ---
          if (reportMode === 2) {
            const currentDataRow = { label: currentLabel, companyData: {} };
            periodDataByCompany.forEach(d => {
                const result = getDisplayContent(d, false);
                currentDataRow.companyData[d.company] = result.holidayDetail.datesHtml;
            });
            allHolidayDetails[prefix].push(currentDataRow);
          }


          // child rows (past)
          let pastItems = periodDataByCompany[0]?.data?.past || [];
          if (prefix === "week" && isInitialLoad) {
            pastItems = pastItems.slice(0, 4);
          }
          pastItems.forEach((p, idx) => {
            let rowLabel = p.label;
            if (prefix === "billing") {
                rowLabel = `Kỳ trước ${idx + 1}`;
            }
            html += `<tr class="child-row past-row" data-parent="toggle-${prefix}-total">
                <td>${rowLabel}</td>
                ${periodDataByCompany.map(d => {
                    const { displayContent, tooltipAttr } = getDisplayContent(d, true, idx);
                    return `<td ${tooltipAttr}>${displayContent}</td>`;
                }).join('')}
            </tr>`;
            
            // --- DATA COLLECTION CHO MODE 2 (Các kỳ quá khứ) ---
            if (reportMode === 2) {
                let detailLabel = p.label;
                if (prefix === "billing") detailLabel = `Kỳ trước ${idx + 1}`;
                const pastDataRow = { label: detailLabel, companyData: {} };
                periodDataByCompany.forEach(d => {
                    const result = getDisplayContent(d, true, idx);
                    pastDataRow.companyData[d.company] = result.holidayDetail.datesHtml;
                });
                allHolidayDetails[prefix].push(pastDataRow);
            }
          });

        
          // ===== render phần Trung bình (detail-current-row - Trắng) =====
          
              html += `<tr class="main-row current-row detail-current-row" data-target="toggle-${prefix}-avg">
                <td>Trung bình ${currentLabel} (m³/ngày)${toggleHtml}</td>
                ${periodDataByCompany.map(d => {
                    const currentData = d?.data?.current;
                    let tooltips = [];
                    if (prefix === "billing" && currentData && currentData.start) {
                        const startStr = formatVNDate(currentData.start);
                        tooltips.push(`Dữ liệu tính từ: ${startStr} đến Hôm nay`);
                    }
                    if (currentData) {
                        let sVal = currentData.startValue != null ? currentData.startValue.toLocaleString('vi-VN') : "N/A";
                        let eVal = currentData.endValue != null ? currentData.endValue.toLocaleString('vi-VN') : "N/A";
                        let wDays = currentData.workingDaysForAvg != null ? currentData.workingDaysForAvg : "N/A";
                        tooltips.push(`Phép tính: (${eVal} - ${sVal}) / ${wDays} ngày`);
                    } else {
                        tooltips.push(`Phép tính: (N/A - N/A) / N/A`);
                    }
                    let titleAttr = tooltips.length > 0 ? `title="${tooltips.join('&#10;---&#10;')}"` : '';
                    const avgDisplay = currentData ? safeFixed(currentData.avg, 1, true) : 'N/A';
                    return `<td ${titleAttr}>${avgDisplay}</td>`;
                }).join('')}
              </tr>`;

              pastItems.forEach((p, idx) => {
                let rowLabel = p.label;
                if (prefix === "billing") {
                    rowLabel = `Kỳ trước ${idx + 1}`;
                } else {
                    rowLabel = p.label.replace(/Tuần: |Tháng: |Năm: /, '');
                }
                html += `<tr class="child-row past-row" data-parent="toggle-${prefix}-avg">
                    <td>Trung bình: ${rowLabel}</td>
                    ${periodDataByCompany.map(d => {
                        const currentData = d?.data?.past[idx];
                        let tooltips = [];
                        if (prefix === "billing" && currentData && currentData.start) {
                            const startStr = formatVNDate(currentData.start);
                            const endMark = new Date(currentData.end.getTime() - 86400000);
                            tooltips.push(`Dữ liệu tính từ: ${startStr} đến ${formatVNDate(endMark)}`);
                        }
                        if (currentData) {
                            let sVal = currentData.startValue != null ? currentData.startValue.toLocaleString('vi-VN') : "N/A";
                            let eVal = currentData.endValue != null ? currentData.endValue.toLocaleString('vi-VN') : "N/A";
                            let wDays = currentData.workingDaysForAvg != null ? currentData.workingDaysForAvg : "N/A";
                            tooltips.push(`Phép tính: (${eVal} - ${sVal}) / ${wDays} ngày`);
                        } else {
                            tooltips.push(`Phép tính: (N/A - N/A) / N/A`);
                        }
                        let titleAttr = tooltips.length > 0 ? `title="${tooltips.join('&#10;---&#10;')}"` : '';
                        const avgDisplay = currentData ? safeFixed(currentData.avg, 1, true) : 'N/A';
                        return `<td ${titleAttr}>${avgDisplay}</td>`;
                    }).join('')}
                </tr>`;
              });

               // ===== render phần Khoán (chỉ cho billing) (detail-current-row - Trắng) =====
              if (prefix === "billing") {
                html += `<tr class="main-row current-row detail-current-row" data-target="toggle-${prefix}-quota">
                    <td>Khối lượng khoán ${currentLabel} (m³)${toggleHtml}</td>
                    ${periodDataByCompany.map(d => {
                        const currentData = d?.data?.current;
                        let tooltips = [];
                        if (currentData && currentData.start) {
                            const startStr = formatVNDate(currentData.start);
                            tooltips.push(`Dữ liệu tính từ: ${startStr} đến Hôm nay`);
                        }
                        if (currentData) {
                            let wDays = currentData.workingDaysForAvg != null ? currentData.workingDaysForAvg : "N/A";
                            let qMult = currentData.quotaMultiplier != null ? currentData.quotaMultiplier : "N/A";
                            tooltips.push(`Phép tính: ${wDays} ngày * ${qMult}`);
                        } else {
                            tooltips.push(`Phép tính: N/A * N/A`);
                        }
                        let titleAttr = tooltips.length > 0 ? `title="${tooltips.join('&#10;---&#10;')}"` : '';
                        const quotaDisplay = currentData ? safeFixed(currentData.quota, 0) : 'N/A';
                        return `<td ${titleAttr}>${quotaDisplay}</td>`;
                    }).join('')}
                </tr>`;

                pastItems.forEach((p, idx) => {
                  let rowLabel = `Kỳ trước ${idx + 1}`;
                  html += `<tr class="child-row past-row" data-parent="toggle-${prefix}-quota">
                      <td>Khối lượng khoán: ${rowLabel}</td>
                      ${periodDataByCompany.map(d => {
                          const currentData = d?.data?.past[idx];
                          let tooltips = [];
                          if (currentData && currentData.start) {
                              const startStr = formatVNDate(currentData.start);
                              const endMark = new Date(currentData.end.getTime() - 86400000);
                              tooltips.push(`Dữ liệu tính từ: ${startStr} đến ${formatVNDate(endMark)}`);
                          }
                          if (currentData) {
                              let wDays = currentData.workingDaysForAvg != null ? currentData.workingDaysForAvg : "N/A";
                              let qMult = currentData.quotaMultiplier != null ? currentData.quotaMultiplier : "N/A";
                              tooltips.push(`Phép tính: ${wDays} ngày * ${qMult}`);
                          } else {
                              tooltips.push(`Phép tính: N/A * N/A`);
                          }
                          let titleAttr = tooltips.length > 0 ? `title="${tooltips.join('&#10;---&#10;')}"` : '';
                          const quotaDisplay = currentData ? safeFixed(currentData.quota, 0) : 'N/A';
                          return `<td ${titleAttr}>${quotaDisplay}</td>`;
                      }).join('')}
                  </tr>`;
                });
              }
            // <--- (HẾT KHỐI XÓA ĐIỀU KIỆN)

            // TẠO KHOẢNG TRẮNG CÁCH GIỮA CÁC LOẠI KỲ
            html += `<tr style="height: 10px; background: white !important;"><td colspan="${companies.length + 1}" style="border: none; padding: 0;"></td></tr>`;

            return html;
        }


        let reportHTML = '';
        
        // Truyền reportMode vào tất cả các hàm renderPeriod
        const weekData = companies.map(c => ({ company: c, data: getPeriodsInFilter(byCompany[c] || [], from, to, "week", config, allProcessedHolidays, c, allCompanyConfigs) }));
        reportHTML += renderPeriod("Tuần", weekData, "week", reportMode);

        const monthData = companies.map(c => ({ company: c, data: getPeriodsInFilter(byCompany[c] || [], from, to, "month", config, allProcessedHolidays, c, allCompanyConfigs) }));
        reportHTML += renderPeriod("Tháng", monthData, "month", reportMode);
        
        const billingData = companies.map(c => ({ company: c, data: getBillingPeriodsInFilter(byCompany[c] || [], from, to, config, allProcessedHolidays, c, allCompanyConfigs) }));
        reportHTML += renderPeriod("Kỳ thu phí", billingData, "billing", reportMode);

        const yearData = companies.map(c => ({ company: c, data: getPeriodsInFilter(byCompany[c] || [], from, to, "year", config, allProcessedHolidays, c, allCompanyConfigs) }));
        reportHTML += renderPeriod("Năm", yearData, "year", reportMode);

        tbody.innerHTML = reportHTML;
        
        // BƯỚC CUỐI: Nếu là Mode 2, render bảng chi tiết ngày nghỉ
        if (reportMode === 2) {
            renderHolidayDetailTable(allHolidayDetails, companies);
        }

        // Gọi filterReportByCompanyGroup() sau khi render
        filterReportByCompanyGroup();
    }


    // === CÁC HÀM XỬ LÝ LỌC ===
    function resetYearSelectIfEditingDates() {
      if (yearSelect && yearSelect.value !== "") yearSelect.value = "";
    }
    [fromInput, toInput].forEach(el => {
      if (!el) return;
      el.addEventListener("focus", resetYearSelectIfEditingDates);
      el.addEventListener("input", resetYearSelectIfEditingDates);
      el.addEventListener("change", resetYearSelectIfEditingDates);
    });

    // HÀM TẢI DỮ LIỆU ĐỒNG BỘ THEO NHU CẦU (THAY THẾ REALTIME)
    async function loadStatisticsData(fromDate, toDate) {
        showLoading("Đang tải dữ liệu báo cáo...");
        try {
            // 1. Tải dữ liệu Chỉ số (reports_1) - Bỏ qua limit
            allReports = await getReportsByDate("reports_1", "ngay_ghi", fromDate, toDate, "all");
            
            // 2. Tải dữ liệu Ngày nghỉ (reports_2)
            // Do reports_2 lưu ở 2 field khác nhau nên query 2 lần rồi gộp lại
            const q1 = query(collection(db, "reports_2"), where("ngay_nghi", ">=", fromDate), where("ngay_nghi", "<=", toDate));
            const q2 = query(collection(db, "reports_2"), where("ngay_lam_db", ">=", fromDate), where("ngay_lam_db", "<=", toDate));
            
            let snap1Docs = [];
            let snap2Docs = [];
            try {
                const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
                snap1Docs = snap1.docs;
                snap2Docs = snap2.docs;
            } catch (e) {
                console.warn("⚠️ Lỗi tải reports_2 (có thể do offline, dùng cache rỗng):", e);
            }

            const holidayMap = new Map();
            snap1Docs.forEach(doc => holidayMap.set(doc.id, { id: doc.id, ...doc.data() }));
            snap2Docs.forEach(doc => holidayMap.set(doc.id, { id: doc.id, ...doc.data() }));
            allHolidayRecords = Array.from(holidayMap.values());
            
            // 3. Khởi tạo danh sách dropdown Năm (2024 -> Năm nay)
            const ys = document.getElementById("yearSelect");
            if (ys && ys.options.length <= 1) {
                const currentYear = new Date().getFullYear();
                for(let y = currentYear; y >= 2024; y--) {
                    ys.innerHTML += `<option value="${y}">${y}</option>`;
                }
            }
            
            // 4. Lấy Config (Xử lý Ngày nghỉ, Ngày chốt) và Render bảng
            await getReportConfig();
            reRenderReport();
            filterReportByCompanyGroup();
            
        } catch (e) {
            console.error("Lỗi tải dữ liệu thống kê:", e);
            showSwal("error", "Lỗi tải dữ liệu", e.message);
        } finally {
            hideLoading();
        }
    }

    const applyDateFilter = async () => {
      const fromVal = fromInput.value;
      const toVal = toInput.value;
      const yearVal = yearSelect.value;
      const todayISO = formatISODate(new Date());
      const currentYear = new Date().getFullYear();
      const currentYearStart = currentYear + '-01-01';

      if (yearVal) {
        currentFilter.from = `${yearVal}-01-01`;
        currentFilter.to = parseInt(yearVal) === currentYear ? todayISO : `${yearVal}-12-31`;
        fromInput.value = currentFilter.from;
        toInput.value = currentFilter.to;
      } else if (fromVal && toVal) {
        currentFilter.from = fromVal;
        currentFilter.to = toVal;
      } else if (toVal) {
        currentFilter.from = currentYearStart;
        currentFilter.to = toVal;
      } else if (fromVal) {
        currentFilter.from = fromVal;
        currentFilter.to = todayISO;
      } else {
        currentFilter.from = currentYearStart;
        currentFilter.to = todayISO;
      }

      // Gọi hàm tải dữ liệu mới
      await loadStatisticsData(currentFilter.from, currentFilter.to);
    };

    if(applyFilterBtn) {
        applyFilterBtn.addEventListener("click", (e) => {
            e.preventDefault();
            applyDateFilter();
        });
    }

    if(yearSelect) {
        yearSelect.addEventListener("change", async (e) => {
            // Gọi hàm applyDateFilter để xử lý logic tải dữ liệu lịch sử
            // Hàm này đã bao gồm việc xóa input ngày tháng và thiết lập filter
            await applyDateFilter();
        });
    }
    
    if (companyGroupFilter) {
        companyGroupFilter.addEventListener('change', () => {
             filterReportByCompanyGroup();
        });
    }
    
    // GÁN LISTENER CHO CÔNG TẮC 3 NẤC
if (reportModeToggle) {
        // Cập nhật vị trí slider ngay lập tức khi click (trước khi reRenderReport cập nhật dữ liệu)
        reportModeToggle.addEventListener('click', (e) => {
            // Dùng setTimeout 0ms để đảm bảo input radio kịp nhận giá trị checked mới
            // trước khi ta gọi updateToggleSlider() và reRenderReport().
            setTimeout(() => {
                updateToggleSlider();
                reRenderReport();
            }, 0);
        });
    }
    
    // GÁN LISTENER CHO SELECT MOBILE
    const mobileSelect = document.getElementById('mobileReportModeSelect');
    if (mobileSelect) {
        mobileSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            // Đồng bộ với radio buttons
            const radio = document.querySelector(`input[name="report-mode"][value="${value}"]`);
            if (radio) {
                radio.checked = true;
                updateToggleSlider();
                reRenderReport();
            }
        });
        
        // Đồng bộ ngược lại: khi radio thay đổi, cập nhật select
        const radios = document.querySelectorAll('input[name="report-mode"]');
        radios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                mobileSelect.value = e.target.value;
            });
        });
    }
    


// ==== THAY THẾ: handler nút Xuất báo cáo ====
document.getElementById("exportPDF").addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    // đảm bảo render mới nhất trước khi xuất
    reRenderReport();

    const fromDate = currentFilter.from || formatISODate(new Date(new Date().getFullYear(), 0, 1));
    const toDate = currentFilter.to || formatISODate(new Date());

    // clone container chứa nội dung PDF
    const pdfReportEl = document.getElementById('pdfReport');
    if (!pdfReportEl) {
      console.error("EXPORT ERROR: #pdfReport element not found in DOM.");
      showSwal("error", "Lỗi xuất PDF", "Không tìm thấy vùng báo cáo để xuất (pdfReport).");
      return;
    }

    const combinedContent = document.createElement('div');
    combinedContent.appendChild(pdfReportEl.cloneNode(true));

    const currentMode = getReportMode();

    // nếu mode = 2, thêm bảng chi tiết ngày nghỉ vào bản sao
    if (currentMode === 2) {
      if (holidayDetailReportDiv) {
        const detailClone = holidayDetailReportDiv.cloneNode(true);
        detailClone.style.display = 'block';
        detailClone.querySelectorAll('.toggle-btn').forEach(btn => btn.textContent = '▼');
        detailClone.querySelectorAll('.child-row-detail').forEach(row => row.style.display = 'table-row');
        const target = combinedContent.querySelector('#pdfReport');
        if (target) target.appendChild(detailClone);
      }
    }

    const elToExport = combinedContent.querySelector('#pdfReport');
    if (!elToExport) {
      console.error("EXPORT ERROR: cloned #pdfReport not found inside combinedContent.");
      showSwal("error", "Lỗi xuất PDF", "Không thể chuẩn bị nội dung để xuất.");
      return;
    }

    // gọi hàm xuất (await để bắt lỗi)
    await exportTableToPDF(elToExport, `bao_cao_thong_ke_${fromDate}_${toDate}.pdf`);

  } catch (err) {
    console.error("EXPORT ERROR (click handler):", err);
    showSwal("error", "Lỗi xuất PDF", err && err.message ? err.message : String(err));
  }
});


// ==== THAY THẾ: exportTableToPDF (an toàn, restore UI, logs) ====
async function exportTableToPDF(element, filename) {
  if (!element) {
    console.error("exportTableToPDF: element is null");
    throw new Error("No element provided to exportTableToPDF");
  }

  if (typeof window.html2pdf !== 'function' && typeof window.html2pdf === 'undefined') {
    console.warn("html2pdf not detected on window. Attempting to continue, but export may fail.");
  }

  // Lưu trạng thái ban đầu để restore sau khi xuất
  const childRows = Array.from(document.querySelectorAll('.child-row'));
  const prevChildDisplay = childRows.map(r => r.style.display || '');
  const pdfOnlyEls = Array.from(document.querySelectorAll('.pdf-only'));
  const prevPdfOnlyDisplay = pdfOnlyEls.map(el => el.style.display || '');
  const toggleEl = document.getElementById('reportModeToggle');
  const prevToggleDisplay = toggleEl ? toggleEl.style.display : null;

  try {
    // 1) Hiện tất cả child-row & pdf-only trong UI (để clone lấy trạng thái hiển thị)
    childRows.forEach(r => r.style.display = 'table-row');
    pdfOnlyEls.forEach(el => el.style.display = 'block');

    // 2) Ẩn control toggle gốc (nếu có)
    if (toggleEl) toggleEl.style.display = 'none';

    // 4) đảm bảo hiển thị tất cả cột (muốn dùng chế độ export all companies)
    if (companyGroupFilter) {
      companyGroupFilter.value = 'all';
      filterReportByCompanyGroup();
    }

    // 5) chuẩn bị options html2pdf
    const options = {
      margin: 10,
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    // 6) Lấy bản sao element (an toàn) để truyền cho html2pdf
    const content = element.cloneNode(true);

    // 7) Loại bỏ các control không mong muốn trên bản sao
    content.querySelectorAll('.toggle-btn').forEach(btn => btn.remove());
    content.querySelector('#reportModeToggle')?.remove();

    // Gỡ bỏ thanh cuộn và giới hạn chiều cao để PDF in đầy đủ toàn bộ bảng
    content.querySelectorAll('.table-container').forEach(c => {
      c.style.maxHeight = 'none';
      c.style.overflow = 'visible';
    });

    // 8) Mở tất cả hàng con trên bản sao (đảm bảo xuất đầy đủ)
    content.querySelectorAll('.child-row').forEach(r => r.style.display = 'table-row');
    content.querySelectorAll('.child-row-detail').forEach(r => r.style.display = 'table-row');

    // 9) Kiểm tra html2pdf tồn tại trước khi chạy
    if (typeof window.html2pdf !== 'function' && typeof window.html2pdf === 'undefined') {
      // Thư viện không có theo tên window.html2pdf (một số build expose theo khác), thử fallback
      if (typeof window.html2pdf !== 'function') {
        console.error("exportTableToPDF: html2pdf is not available on window.");
        throw new Error("Thư viện html2pdf chưa được tải. Vui lòng đảm bảo script html2pdf.js được nạp.");
      }
    }

    // 10) Thực hiện xuất và chờ hoàn tất
    await window.html2pdf(content, options);

  } catch (err) {
    console.error("exportTableToPDF error:", err);
    throw err;
  } finally {
    // RESTORE trạng thái giao diện ban đầu dù thành công hay lỗi
    // restore child rows
    const curChildRows = Array.from(document.querySelectorAll('.child-row'));
    curChildRows.forEach((r, i) => {
      r.style.display = prevChildDisplay[i] || 'none';
    });

    // restore pdf-only
    Array.from(document.querySelectorAll('.pdf-only')).forEach((el, i) => {
      el.style.display = prevPdfOnlyDisplay[i] || 'none';
    });

    // restore toggle display
    if (toggleEl) toggleEl.style.display = prevToggleDisplay || 'flex';

    // restore company group filter (bỏ về giá trị cũ nếu cần)
    // (lưu ý: filterReportByCompanyGroup() sẽ được gọi bởi reRenderReport nếu cần)
    if (companyGroupFilter) {
      // không ép restore giá trị vì user có thể muốn giữ filter,
      // nhưng nếu bạn muốn restore giá trị trước export, lưu value rồi set lại ở trên.
      filterReportByCompanyGroup();
    }
  }
}

    // === KẾT THÚC CÁC HÀM XỬ LÝ LỌC ===


    async function getReportConfig() {
    let snapData = {};
    try {
        const configRef = doc(db, "config", "reportConfig");
        const configSnap = await getDoc(configRef);
        snapData = configSnap.exists() ? configSnap.data() : {};
    } catch (e) {
        console.warn("⚠️ Lỗi tải config (có thể do offline, dùng mặc định):", e);
    }

    const snapQuota = (snapData.quotaMultipliers && typeof snapData.quotaMultipliers === 'object') ? snapData.quotaMultipliers : {};

    // ⭐️ MỚI: Tải cấu hình defaultHolidays từ settings
    let settingsData = {};
    try {
        const settingsRef = doc(db, "settings", "reportConfig");
        const settingsSnap = await getDoc(settingsRef);
        settingsData = settingsSnap.exists() ? settingsSnap.data() : {};
    } catch (e) {
        console.warn("⚠️ Lỗi tải settings (có thể do offline, dùng mặc định):", e);
    }
    const defaultHolidays = settingsData.defaultHolidays || {};

    config = {
        weekDayStart: (snapData.weekDayStart ?? config.weekDayStart),
        monthDayStart: (snapData.monthDayStart ?? config.monthDayStart),
        yearDayStart: (snapData.yearDayStart ?? config.yearDayStart),
        quotaMultipliers: { ...(config.quotaMultipliers || {}), ...snapQuota },
        defaultHolidays: defaultHolidays // ⭐️ Lưu vào biến toàn cục config để tự tính toán
    };

    console.log("🔥 merged config:", JSON.stringify(config));

    // --- XỬ LÝ DỮ LIỆU NGÀY NGHỈ TỪ reports_2 ---
    allProcessedHolidays = {};
    allHolidayRecords.forEach(r => {
        if (!r.company) return;
        const company = r.company;
        const ngayNghi = r.ngay_nghi;
        const ngayLamDB = r.ngay_lam_db;

        if (!allProcessedHolidays[company]) {
            allProcessedHolidays[company] = { dayOffs: new Set(), specialWorkdays: new Set() };
        }

        if (ngayNghi) {
            const dateStr = formatISODate(new Date(ngayNghi));
            if (dateStr) allProcessedHolidays[company].dayOffs.add(dateStr);
        }
        if (ngayLamDB) {
            const dateStr = formatISODate(new Date(ngayLamDB));
            if (dateStr) allProcessedHolidays[company].specialWorkdays.add(dateStr);
        }
    });
}



    // kiểm tra trạng thái đăng nhập
    onAuth(async (user) => {
        if (user) {
            console.log("LOG: Người dùng đã đăng nhập.");
            notLogged.style.display = "none";
            content.style.display = "block";

            userRole = await getRole(user.email);
            // BƯỚC MỚI: Hiển thị nút cấu hình và setup modal cho Admin
            if (userRole === 'admin') {
            }
            // === Listener MỚI: companies_master (Master List) ===
            listenCollection("companies_master", (masterDocs) => {
                allMasterCompanies = masterDocs.filter(d => d && d.company);
                if (!isInitialLoad) {
                    reRenderReport();
                }
            });

            // === KẾT THÚC Listener MỚI ===
            
            // === Listener MỚI: company_configs (Cấu hình Công ty Lịch sử) ===
            onSnapshot(collection(db, "company_configs"), (snapshot) => {
                allCompanyConfigs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (!isInitialLoad) {
                    reRenderReport(); // Render lại nếu có thay đổi trong cài đặt
                }
            }, (error) => {
                console.error("Lỗi lắng nghe company_configs (Permission Denied):", error);
            });
            // === KẾT THÚC Listener ===

            // TẢI DỮ LIỆU LẦN ĐẦU (Năm Hiện Tại) THAY VÌ LẮNG NGHE REAL-TIME
            if (isInitialLoad) {
                const currentYear = new Date().getFullYear();
                const currentYearStart = currentYear + '-01-01';
                const todayISO = formatISODate(new Date());
                
                currentFilter.from = currentYearStart;
                currentFilter.to = todayISO;
                fromInput.value = currentYearStart;
                toInput.value = todayISO;
                
                const ys = document.getElementById("yearSelect");
                if (ys) ys.value = currentYear;
                
                await loadStatisticsData(currentYearStart, todayISO);
                isInitialLoad = false;
            }

            
        } else {
            notLogged.style.display = "block";
            content.style.display = "none";
        }
    });