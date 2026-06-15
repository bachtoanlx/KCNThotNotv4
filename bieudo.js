import { onAuth, getRole, showLoading, hideLoading, showSwal, getReportsByDate, db } from "./script.js";
import { formatISODate, findLatestReadingBeforeOrOnMark } from "./core-calculator.js";
import { initMenu } from "./menu.js";
import { saveToLocalDB, getAllFromLocalDB, setLastSyncTime, getLastSyncTime, deleteFromLocalDB } from "./localDB.js";
import { collection, query, where, orderBy, getDocs, limit } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// Tải giao diện chung
fetch("menu.html").then(r => r.text()).then(h => document.getElementById("menu-placeholder").innerHTML = h).then(initMenu);
fetch("modal.html").then(r => r.text()).then(h => document.getElementById("loading-placeholder").innerHTML = h);
fetch("footer.html").then(r => r.text()).then(h => document.getElementById("footer-placeholder").innerHTML = h);

// DOM Elements
const notLogged = document.getElementById("notLogged");
const content = document.getElementById("pageContent");
const fromInput = document.getElementById("fromDate");
const toInput = document.getElementById("toDate");
const yearSelect = document.getElementById("yearSelect");
const applyFilterBtn = document.getElementById("applyFilter");

let allReports = [];
let myChart = null; // Biến lưu instance của Chart.js

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

async function loadChartData(fromDate, toDate) {
    showLoading("Đang đồng bộ và tải dữ liệu biểu đồ...");
    try {
        // 1. Sync `reports_1` data with IndexedDB
        const collectionName = "reports_1";
        const lastSync = await getLastSyncTime(collectionName);

        // 1a. Sync Deletes (Tombstone)
        if (lastSync > 0) {
            const qDel = query(collection(db, "sync_deletes"), 
                where("deletedAt", ">", new Date(lastSync))
            );
            const snapDel = await getDocs(qDel);
            if (!snapDel.empty) {
                const idsToDelete = snapDel.docs
                    .map(d => d.data())
                    .filter(data => data.collectionName === collectionName)
                    .map(data => data.docId);
                if (idsToDelete.length > 0) {
                    await deleteFromLocalDB(collectionName, idsToDelete);
                }
            }
        }

        // 1b. Sync Upserts (New/Modified)
        let newRecords = [];
        if (lastSync === 0) {
            const qAll = query(collection(db, collectionName));
            const snapAll = await getDocs(qAll);
            newRecords = snapAll.docs.map(doc => ({id: doc.id, ...doc.data()}));
        } else {
            const qCreated = query(collection(db, collectionName), where("createdAt", ">", new Date(lastSync)));
            const qUpdated = query(collection(db, collectionName), where("updatedAt", ">", new Date(lastSync)));
            const [snapC, snapU] = await Promise.all([getDocs(qCreated), getDocs(qUpdated)]);
            const map = new Map();
            snapC.docs.forEach(d => map.set(d.id, {id: d.id, ...d.data()}));
            snapU.docs.forEach(d => map.set(d.id, {id: d.id, ...d.data()}));
            newRecords = Array.from(map.values());
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

        // 2. Get all data from IndexedDB and filter in-memory
        const allLocalData = await getAllFromLocalDB(collectionName);
        allReports = allLocalData.filter(r => {
            const reportDate = r.ngay_ghi;
            return reportDate && reportDate >= fromDate && reportDate <= toDate;
        });
        
        // Khởi tạo năm cho dropdown nếu chưa có
        if (yearSelect && yearSelect.options.length <= 1) {
            const currentYear = new Date().getFullYear();
            for(let y = currentYear; y >= 2024; y--) {
                yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
            }
        }
        
        renderChart(fromDate, toDate);
    } catch (e) {
        console.error("Lỗi tải dữ liệu biểu đồ từ IndexedDB:", e);
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

    let startDate, endDate;

    if (yearVal) {
        startDate = `${yearVal}-01-01`;
        endDate = parseInt(yearVal) === currentYear ? todayISO : `${yearVal}-12-31`;
        fromInput.value = startDate;
        toInput.value = endDate;
    } else if (fromVal && toVal) {
        startDate = fromVal;
        endDate = toVal;
    } else if (toVal) {
        startDate = currentYearStart;
        endDate = toVal;
    } else if (fromVal) {
        startDate = fromVal;
        endDate = todayISO;
    } else {
        startDate = currentYearStart;
        endDate = todayISO;
    }

    await loadChartData(startDate, endDate);
};

if (applyFilterBtn) {
    applyFilterBtn.addEventListener("click", (e) => {
        e.preventDefault();
        applyDateFilter();
    });
}

if (yearSelect) {
    yearSelect.addEventListener("change", async (e) => {
        await applyDateFilter();
    });
}

// === HÀM XỬ LÝ VÀ VẼ BIỂU ĐỒ ===
function renderChart(fromDateStr, toDateStr) {
    const byCompany = {};
    
    // Tiền xử lý dữ liệu giống hệt statistics.js
    allReports.forEach(r => {
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

    const labels = [];
    const dataValues = [];
    
    const startDate = new Date(fromDateStr);
    const endDate = new Date(toDateStr);
    endDate.setHours(23, 59, 59, 999);

    const companies = Object.keys(byCompany).sort();

    // Sử dụng thuật toán giống core-calculator.js
    companies.forEach(company => {
        byCompany[company].sort((a, b) => a.date - b.date);
        const readings = byCompany[company];
        
        const startReading = findLatestReadingBeforeOrOnMark(readings, startDate);
        const endReading = findLatestReadingBeforeOrOnMark(readings, endDate);

        let total = 0;
        if (startReading !== null && endReading !== null) {
            let diff = endReading.value - startReading.value;
            if (diff < 0) diff = 0;
            total = diff;
        }
        
        labels.push(company);
        dataValues.push(total);
    });

    // Vẽ biểu đồ bằng Chart.js
    const ctx = document.getElementById('usageChart').getContext('2d');
    if (myChart) myChart.destroy(); // Hủy biểu đồ cũ nếu có

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `Lưu lượng xả thải (m³) từ ${fromDateStr.split('-').reverse().join('/')} đến ${toDateStr.split('-').reverse().join('/')}`,
                data: dataValues,
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                borderColor: 'rgba(39, 54, 104, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.raw.toLocaleString('vi-VN') + ' m³';
                        }
                    }
                }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: { callback: function(value) { return value.toLocaleString('vi-VN'); } }
                }
            }
        }
    });
}

// === KHỞI TẠO ===
onAuth(async (user) => {
    if (user) {
        notLogged.style.display = "none";
        content.style.display = "block";
        
        const currentYear = new Date().getFullYear();
        const currentYearStart = currentYear + '-01-01';
        const todayISO = formatISODate(new Date());
        
        fromInput.value = currentYearStart;
        toInput.value = todayISO;
        
        await loadChartData(currentYearStart, todayISO);
    } else {
        notLogged.style.display = "flex";
        content.style.display = "none";
    }
});