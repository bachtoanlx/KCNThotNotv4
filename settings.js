import { auth, db, onAuth, getRole, showSwal, showLoading, hideLoading, showConfirmSwal, addLog, getCurrentUserEmail, fetchAllUsers, promptForReAuth } from "./script.js";
import { doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot, serverTimestamp, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initMenu } from "./menu.js";
import { formatISODate } from "./core-calculator.js";
import { getDaysDifference, isRuleActiveOnDate, sortShiftRules, getNormalizedFirstChar } from "./autoplan-core.js";

// === Load menu, modal và footer ===
fetch("menu.html").then(r => r.text()).then(h => {
    document.getElementById("menu-placeholder").innerHTML = h;
    if (typeof initMenu === "function") initMenu();
});
fetch("modal.html").then(r => r.text()).then(h => {
    document.getElementById("loading-placeholder").innerHTML = h;
});
fetch("footer.html").then(r => r.text()).then(h => {
    document.getElementById("footer-placeholder").innerHTML = h;
});

const notLogged = document.getElementById("notLogged");
const pageContent = document.getElementById("pageContent");

let activeEditingRuleData = null;
let activeEditingPatternData = null;

// === LOGIC TABS ===
function initTabs() {
    const tabBtns = document.querySelectorAll(".settings-tab-btn");
    const tabPanes = document.querySelectorAll(".settings-tab-pane");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            // Xóa active cũ
            tabBtns.forEach(b => b.classList.remove("active"));
            tabPanes.forEach(p => p.classList.remove("active"));

            // Thêm active mới
            btn.classList.add("active");
            const targetId = btn.getAttribute("data-target");
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.classList.add("active");
            }
        });
    });
}

// === BIẾN TOÀN CỤC CHO TAB 4 & TRUY VẤN EXPLORER ===
let triggerAdminExplore = null;

const copyDocIdToClipboard = (collectionName, docId) => {
    const textToCopy = `${collectionName}:${docId}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
        if (window.Swal) {
            window.Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `Đã sao chép định danh bản ghi (${collectionName}) vào Clipboard!`,
                showConfirmButton: false,
                timer: 2500,
                timerProgressBar: true
            });
        }
    }).catch(err => {
        console.error('Không thể sao chép:', err);
    });
};

// === BIẾN TOÀN CỤC CHO TAB 1 ===
let allMasterCompanies = [];
let allCompanyConfigs = [];
let currentCompanyConfigs = [];

const csCompanySelect = document.getElementById("csCompanySelect");
const csEffectiveDate = document.getElementById("csEffectiveDate");
const csGroupSelect = document.getElementById("csGroupSelect");
const csQuota = document.getElementById("csQuota");
const csBillingDay = document.getElementById("csBillingDay");
const csHistoryBody = document.getElementById("csHistoryBody");
const csNote = document.getElementById("csNote");
const csDeleteCompanyBtn = document.getElementById("csDeleteCompanyBtn");

// === KHỞI TẠO DỮ LIỆU SELECT (Ngày, Tháng) ===
const monthSel = document.getElementById("monthDayStart");
if(monthSel) for (let i=1; i<=28; i++) monthSel.innerHTML += `<option value="${i}">${i}</option>`;
const yearSel = document.getElementById("yearDayStart");
if(yearSel) for (let i=1; i<=31; i++) yearSel.innerHTML += `<option value="${i}">${i}</option>`;

// === LOGIC TAB 1: CẤU HÌNH NGÀY MỐC & DOANH NGHIỆP ===

async function loadSystemConfig() {
    const configRef = doc(db, "config", "reportConfig");
    const snap = await getDoc(configRef);
    if(snap.exists()) {
        const data = snap.data();
        document.getElementById("weekDayStart").value = data.weekDayStart ?? 1;
        if(monthSel) document.getElementById("monthDayStart").value = data.monthDayStart ?? 1;
        if(yearSel) document.getElementById("yearDayStart").value = data.yearDayStart ?? 1;
    }
}

document.getElementById("saveConfigBtn").addEventListener("click", async () => {
    const isConfirmed = await showConfirmSwal(
        "Xác nhận Lưu Cài Đặt",
        "Việc này sẽ thay đổi mốc tính toán của tất cả các báo cáo.<br>Bạn có muốn tiếp tục không?",
        "Có, Lưu Cài Đặt", "Không, Hủy Bỏ", "warning" 
    );
    if (!isConfirmed) return; 
    
    const isVerified = await promptForReAuth();
    if (!isVerified) return;
    
    const newConfig = {
        weekDayStart: Number(document.getElementById("weekDayStart").value),
        monthDayStart: Number(document.getElementById("monthDayStart").value),
        yearDayStart: Number(document.getElementById("yearDayStart").value),
    };
    
    showLoading("Đang lưu cài đặt..."); 
    try {
        await setDoc(doc(db, "config", "reportConfig"), newConfig, { merge: true });
        addLog("system_config_update", { email: auth.currentUser?.email || "admin", config: newConfig });
        showSwal("success", "Đã lưu cài đặt!", "Các báo cáo sẽ được cập nhật lại mốc.");
    } catch (e) {
        showSwal("error", "Lỗi khi lưu cài đặt", e.message);
    } finally {
        hideLoading(); 
    }
});

function populateCompanyDropdown() {
    const currentVal = csCompanySelect.value;
    const companiesFromMaster = allMasterCompanies.map(c => c.company).filter(Boolean);
    const companiesFromConfigs = allCompanyConfigs.map(c => c.company).filter(Boolean);
    
    const allUniqueCompanies = Array.from(new Set([...companiesFromMaster, ...companiesFromConfigs])).sort();
    
    const datalist = document.getElementById("csCompanyList");
    if (!datalist) return;
    datalist.innerHTML = '';
    allUniqueCompanies.forEach(c => {
        datalist.innerHTML += `<option value="${c}"></option>`;
    });
    if (currentVal) csCompanySelect.value = currentVal;
}

// HÀM TẢI MỐC KHỞI TẠO CỦA CÔNG TY
async function loadCompanyBaseline(company) {
    const qInit = query(collection(db, "reports_1"), where("company", "==", company), where("ghi_chu", "==", "Chi so khoi tao tu dong (Auto-Init)"));
    const snap = await getDocs(qInit);
    if (!snap.empty) {
        const docData = snap.docs[0].data();
        document.getElementById("csBaselineDate").value = docData.ngay_ghi || "";
        document.getElementById("csBaselineIndex").value = docData.chi_so || 0;
        document.getElementById("csBaselineDate").dataset.docId = snap.docs[0].id;
    } else {
        document.getElementById("csBaselineDate").value = "";
        document.getElementById("csBaselineIndex").value = "";
        document.getElementById("csBaselineDate").dataset.docId = "";
    }
}

let previousCsCompanyValue = "";
csCompanySelect.addEventListener("focus", function() {
    previousCsCompanyValue = this.value;
    this.value = ""; 
});
csCompanySelect.addEventListener("blur", function() {
    if (this.value.trim() === "") this.value = previousCsCompanyValue; 
});

csCompanySelect.addEventListener("change", async (e) => {
    csCompanySelect.blur();
    const company = e.target.value.trim();
    
    if (!company) {
        csHistoryBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 15px; color:#666;">Vui lòng chọn công ty để xem lịch sử.</td></tr>';
        csQuota.value = ""; csBillingDay.value = ""; csNote.value = "";
        csEffectiveDate.value = formatISODate(new Date());
        document.querySelectorAll('#csHolidays input').forEach(cb => cb.checked = false);
        document.getElementById("csBaselineDate").value = "";
        document.getElementById("csBaselineIndex").value = "";
        document.getElementById("csBaselineDate").dataset.docId = "";
        if (csDeleteCompanyBtn) csDeleteCompanyBtn.style.display = 'none';
        return;
    }

    const allUniqueCompanies = Array.from(new Set([
        ...allMasterCompanies.map(c => c.company).filter(Boolean), 
        ...allCompanyConfigs.map(c => c.company).filter(Boolean)
    ]));
    
    if (!allUniqueCompanies.includes(company)) {
        if (csDeleteCompanyBtn) csDeleteCompanyBtn.style.display = 'none';
        const isConfirmed = await showConfirmSwal(
            "Công ty mới",
            `Công ty "<b>${company}</b>" chưa có trong hệ thống. Bạn có muốn thêm mới không?`,
            "Thêm mới", "Hủy bỏ", "question"
        );
        
        if (isConfirmed) {
            showLoading("Đang thêm...");
            const dateInputVal = document.getElementById("csEffectiveDate").value || formatISODate(new Date());
            await manageMasterCompany(company, 'add', dateInputVal);
            hideLoading();
            showSwal("success", "Thành công", `Đã thêm công ty ${company}`);
            if (csDeleteCompanyBtn) csDeleteCompanyBtn.style.display = 'block';
        } else {
            csCompanySelect.value = "";
            csCompanySelect.dispatchEvent(new Event("change"));
            return;
        }
    } else {
        if (csDeleteCompanyBtn) csDeleteCompanyBtn.style.display = 'block';
    }
    await loadCompanyConfigHistory(company);
    await loadCompanyBaseline(company);
});

async function loadCompanyConfigHistory(company) {
    csHistoryBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Đang tải dữ liệu...</td></tr>';
    try {
        const q = query(collection(db, "company_configs"), where("company", "==", company));
        const snap = await getDocs(q);
        currentCompanyConfigs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        currentCompanyConfigs.sort((a, b) => (b.effectiveDate || "").localeCompare(a.effectiveDate || ""));

        if (currentCompanyConfigs.length === 0) {
            csHistoryBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Chưa có quy tắc nào được thiết lập.</td></tr>';
            csQuota.value = ""; csBillingDay.value = ""; csNote.value = "";
            csEffectiveDate.value = formatISODate(new Date());
            document.querySelectorAll('#csHolidays input').forEach(cb => cb.checked = false);
            return;
        }

        const latest = currentCompanyConfigs[0];
        csEffectiveDate.value = latest.effectiveDate || formatISODate(new Date());
        csGroupSelect.value = latest.group || "group1";
        csQuota.value = latest.quotaMultiplier || 0;
        csBillingDay.value = latest.billingDay || "";
        csNote.value = latest.note || "";
        document.querySelectorAll('#csHolidays input').forEach(cb => {
            cb.checked = (latest.defaultHolidays && latest.defaultHolidays.includes(Number(cb.value)));
        });

        const dayMap = {0:"CN", 1:"T2", 2:"T3", 3:"T4", 4:"T5", 5:"T6", 6:"T7"};
        csHistoryBody.innerHTML = currentCompanyConfigs.map(c => {
            const daysStr = (c.defaultHolidays || []).map(d => dayMap[d]).join(", ") || "Không nghỉ";
            let groupStr = c.group === "group2" ? "Nhóm 2" : (c.group === "group3" ? "Nhóm 3" : "Nhóm 1");
            const dateParts = (c.effectiveDate || formatISODate(new Date())).split('-');
            const displayDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            
            return `<tr>
                <td style="font-weight:bold; color:#034892;">${displayDate}</td>
                <td>${groupStr}</td>
                <td>${c.quotaMultiplier || 0}</td>
                <td>${c.billingDay ? `Ngày ${c.billingDay}` : '-'}</td>
                <td>${daysStr}</td>
                <td>${c.note || ""}</td>
                <td><button class="del-config-btn" data-id="${c.id}" style="background:#e74c3c; color:white; border:none; padding:2px 6px; border-radius:4px; cursor:pointer;">Xóa</button></td>
            </tr>`;
        }).join('');

        document.querySelectorAll('.del-config-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(await showConfirmSwal("Xác nhận", "Bạn có chắc chắn muốn xóa quy tắc này?", "Xóa", "Hủy")) {
                    const configId = e.target.dataset.id;
                    const configToDelete = currentCompanyConfigs.find(c => c.id === configId);
                    addLog("system_config_update", { email: auth.currentUser?.email || "admin", action_detail: "delete_company_config", configId: configId, company: company, deletedConfig: configToDelete });
                    await deleteDoc(doc(db, "company_configs", configId));
                    loadCompanyConfigHistory(company);
                }
            });
        });
    } catch (error) {
        csHistoryBody.innerHTML = `<tr><td colspan="7" style="color:red; text-align:center;">Lỗi: ${error.message}</td></tr>`;
    }
}

document.getElementById("csSaveBtn").addEventListener("click", async () => {
    const company = csCompanySelect.value.trim();
    const effectiveDate = csEffectiveDate.value;
    if (!company || !effectiveDate) return showSwal("error", "Lỗi", "Vui lòng chọn công ty và ngày áp dụng.");
    
    const billingDayVal = parseInt(csBillingDay.value);
    if (isNaN(billingDayVal) || billingDayVal < 1 || billingDayVal > 31) return showSwal("error", "Lỗi", "Vui lòng nhập Ngày cuối kỳ phí hợp lệ (1-31).");

    const payload = {
        company, effectiveDate,
        group: csGroupSelect.value,
        quotaMultiplier: parseFloat(csQuota.value) || 0,
        billingDay: billingDayVal,
        defaultHolidays: Array.from(document.querySelectorAll('#csHolidays input:checked')).map(cb => Number(cb.value)),
        note: csNote.value.trim(),
        updatedAt: new Date(),
        updatedBy: auth.currentUser?.email || "admin"
    };

    try {
        showLoading("Đang lưu...");
        const existingRule = currentCompanyConfigs.find(c => c.effectiveDate === effectiveDate);
        if (existingRule) await setDoc(doc(db, "company_configs", existingRule.id), payload, { merge: true });
        else await addDoc(collection(db, "company_configs"), payload);
        
        addLog("system_config_update", { email: auth.currentUser?.email || "admin", action_detail: "save_company_config", company: company, date: effectiveDate });
        hideLoading();
        showSwal("success", "Thành công", "Đã lưu quy tắc cấu hình.");
        loadCompanyConfigHistory(company);
    } catch (e) {
        hideLoading();
        showSwal("error", "Lỗi lưu", e.message);
    }
});

if (csDeleteCompanyBtn) {
    csDeleteCompanyBtn.addEventListener("click", async () => {
        const company = csCompanySelect.value.trim();
        if (!company) return;
        const isConfirmed = await showConfirmSwal("Xác nhận Xóa", `Bạn có chắc chắn muốn xóa "<b>${company}</b>" khỏi hệ thống không?`, "Có, Xóa", "Hủy bỏ", "error");
        if (isConfirmed) {
            const isVerified = await promptForReAuth();
            if (!isVerified) return;
            
            showLoading("Đang xóa...");
            try {
                await manageMasterCompany(company, 'remove');
                const configsToDelete = allCompanyConfigs.filter(c => c.company === company);
                for (const cfg of configsToDelete) await deleteDoc(doc(db, "company_configs", cfg.id));
                addLog("system_config_update", { email: auth.currentUser?.email || "admin", action_detail: "delete_master_company", company: company, deletedConfigsCount: configsToDelete.length });
                hideLoading();
                showSwal("success", "Thành công", `Đã xóa công ty ${company}`);
                csCompanySelect.value = "";
                csCompanySelect.dispatchEvent(new Event("change"));
            } catch (err) {
                hideLoading();
                showSwal("error", "Lỗi", err.message);
            }
        }
    });
}

document.getElementById("csSaveBaselineBtn").addEventListener("click", async () => {
    const company = csCompanySelect.value.trim();
    if (!company) return showSwal("error", "Lỗi", "Vui lòng chọn công ty.");
    
    const baselineDate = document.getElementById("csBaselineDate").value;
    const baselineIndex = parseFloat(document.getElementById("csBaselineIndex").value);
    
    if (!baselineDate || isNaN(baselineIndex)) return showSwal("error", "Lỗi", "Vui lòng nhập Ngày và Chỉ số hợp lệ.");
    
    // Đã bổ sung cảnh báo nếu chỉ số Mốc nhỏ hơn 0
    if (baselineIndex < 0) return showSwal("error", "Lỗi", "Chỉ số mốc không được nhỏ hơn 0.");
    
    const docId = document.getElementById("csBaselineDate").dataset.docId;
    
    const payload = {
        company: company,
        ngay_ghi: baselineDate,
        chi_so: baselineIndex,
        createdBy: "admin@system",
        ghi_chu: "Chi so khoi tao tu dong (Auto-Init)",
        updatedAt: new Date()
    };

    try {
        showLoading("Đang lưu mốc...");
        if (docId) {
            await updateDoc(doc(db, "reports_1", docId), { ngay_ghi: baselineDate, chi_so: baselineIndex, updatedAt: new Date() });
        } else {
            payload.createdAt = new Date();
            const newDoc = await addDoc(collection(db, "reports_1"), payload);
            document.getElementById("csBaselineDate").dataset.docId = newDoc.id;
        }
        addLog("indicator_entry", { email: auth.currentUser?.email || "admin", action_detail: "save_baseline", company: company, chi_so: baselineIndex, ngay_ghi: baselineDate });
        hideLoading();
        showSwal("success", "Thành công", "Đã cập nhật Mốc Khởi Tạo.");
    } catch(e) {
        hideLoading();
        showSwal("error", "Lỗi lưu mốc", e.message);
    }
});

async function manageMasterCompany(companyName, action, effectiveDateStr) {
    const safeName = companyName.trim();
    if (action === 'add') {
        await setDoc(doc(db, "companies_master", safeName), { company: safeName, isActive: true });
    } else if (action === 'remove') {
        await deleteDoc(doc(db, "companies_master", safeName));
        const qInit = query(collection(db, "reports_1"), where("company", "==", safeName), where("ghi_chu", "==", "Chi so khoi tao tu dong (Auto-Init)"));
        const snap = await getDocs(qInit);
        for (const d of snap.docs) await deleteDoc(doc(db, "reports_1", d.id));
    }
}

// === KIỂM TRA QUYỀN VÀ KHỞI TẠO ===
onAuth(async (user) => {
    if (!user) {
        window.location.replace("trangchu.html");
        return;
    }

    const role = await getRole(user.email);

    if (role !== "admin") {
        // Nếu không phải admin, đá về trang chủ ngay
        window.location.replace("trangchu.html");
        return;
    }

    showLoading("Đang tải cấu hình...");
    try {
        // Nếu là admin, hiển thị trang và khởi tạo
        notLogged.style.display = "none";
        pageContent.style.display = "block";
        
        initTabs();
        loadSystemConfig();
        setupConfigModal();
        loadAutoplanTimes();
        setupShiftManagement();
        setupScheduleManagement();
        setupSystemManagement();
        csEffectiveDate.value = formatISODate(new Date());
        
        fetchAllUsers().then(firestoreUsers => {
            firestoreUsers.forEach(u => { if (u.email) allKnownEmails.add(u.email); });
            renderUserDatalist();
        });

        // Lắng nghe dữ liệu Master
        onSnapshot(collection(db, "companies_master"), (snap) => {
            allMasterCompanies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            populateCompanyDropdown();
        });

        onSnapshot(collection(db, "company_configs"), (snap) => {
            allCompanyConfigs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            populateCompanyDropdown();
            if (csCompanySelect.value) loadCompanyConfigHistory(csCompanySelect.value);
        });
    } catch (err) {
        showSwal("error", "Lỗi khởi tạo trang", err.message);
    } finally {
        hideLoading();
    }
});

// ===============================================
// 🔥 LOGIC CHO MODAL THÔNG TIN CẤU HÌNH (Từ trang Thống kê chuyển sang)
// ===============================================
// --- Hàm tiện ích: Khóa cuộn trang và bù đắp chiều rộng thanh cuộn (Chống giật/nháy giao diện) ---
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

async function fetchReportConfigData() {
    try {
        // 1. Chỉ số Đặc biệt (reports_1) - Hợp nhất 3 tiêu chí OR
        const q1a = query(collection(db, "reports_1"), where("isMeterReset", "==", true));
        const snap1a = await getDocs(q1a);
        const q1b = query(collection(db, "reports_1"), where("chi_so", "==", 0));
        const snap1b = await getDocs(q1b);
        const q1c = query(collection(db, "reports_1"), where("ghi_chu", "==", "Chi so khoi tao tu dong (Auto-Init)"));
        const snap1c = await getDocs(q1c);
        
        const allSnapDocs = [...snap1a.docs, ...snap1b.docs, ...snap1c.docs];
        const uniqueDocs = [];
        const docIds = new Set();
        allSnapDocs.forEach(d => {
            if (!docIds.has(d.id)) {
                docIds.add(d.id);
                uniqueDocs.push(d);
            }
        });
        const specialIndexes = uniqueDocs.map(d => ({ 
            id: d.id, ...d.data(), 
            date: d.data().createdAt ? d.data().createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'
        }));

        // 2. Ngày làm việc Đặc biệt (reports_2: isSpecialWorkday=true)
        const q2 = query(collection(db, "reports_2"), where("isSpecialWorkday", "==", true));
        const snap2 = await getDocs(q2);
        const specialWorkdays = snap2.docs.map(d => ({ 
            id: d.id, ...d.data(),
            date: d.data().createdAt ? d.data().createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'
        }));

        // 3. Tải Cài đặt Cấu hình (settings & config)
        const settingsHolidayRef = doc(db, "settings", "reportConfig");
        const settingsHolidaySnap = await getDoc(settingsHolidayRef);
        const settingsConfig = settingsHolidaySnap.exists() ? settingsHolidaySnap.data() : {};
        const defaultHolidays = settingsConfig.defaultHolidays || {};

        const configRef = doc(db, "config", "reportConfig"); 
        const configSnap = await getDoc(configRef);
        const configData = configSnap.exists() ? configSnap.data() : {};
        const quotaMultipliers = configData.quotaMultipliers || {}; 
        const startDaySettings = {
            weekDayStart: configData.weekDayStart !== undefined ? configData.weekDayStart : 'Chưa cài đặt',
            monthDayStart: configData.monthDayStart !== undefined ? configData.monthDayStart : 'Chưa cài đặt',
            yearDayStart: configData.yearDayStart !== undefined ? configData.yearDayStart : 'Chưa cài đặt'
        };
        
        // 3c. Lấy dữ liệu cấu hình doanh nghiệp mới từ collection company_configs
        const qCompanyConfigs = query(collection(db, "company_configs"));
        const snapCompanyConfigs = await getDocs(qCompanyConfigs);
        const companyConfigs = snapCompanyConfigs.docs.map(d => d.data());

        return { specialIndexes, specialWorkdays, defaultHolidays, startDaySettings, quotaMultipliers, companyConfigs };
    } catch (error) {
        console.error("Lỗi khi tải dữ liệu cấu hình:", error);
        showSwal("error", "Lỗi khi tải dữ liệu cấu hình: " + error.message);
        return null;
    }
}

function renderConfigModal(data) {
    const contentDiv = document.getElementById('configModalContent');
    if (!data) {
        contentDiv.innerHTML = '<p style="color:red;">Không thể tải dữ liệu cấu hình. Vui lòng kiểm tra console.</p>';
        return;
    }

    let html = '';
    html += '<div class="modal-section">';
    html += '<h4>1. Chỉ số Đặc biệt (Reset Đồng hồ; Chỉ số =0)</h4>';
    if (data.specialIndexes.length > 0) {
        html += '<div class="table-container">';
        html += '<table style="width: 100%; min-width: auto;"><thead><tr><th style="text-align: center;">Tên Công ty</th><th style="text-align: center;">Chỉ số</th><th style="text-align: center;">Ngày ghi</th><th style="text-align: center;">Ngày tạo</th><th style="text-align: center;">Ghi chú</th></tr></thead><tbody>';
        data.specialIndexes.forEach(item => {
            html += `<tr>
                        <td style="text-align: center;">${item.company || item.c_ty || 'N/A'}</td>
                        <td style="text-align: center;">${item.chi_so !== undefined ? item.chi_so.toLocaleString('vi-VN') : 'N/A'}</td>
                        <td style="text-align: center;">${item.ngay_ghi || 'N/A'}</td>
                        <td style="text-align: center;">${item.date}</td>
                        <td style="text-align: center;">${item.ghi_chu || item.note || ''}</td>
                    </tr>`;
        });
        html += '</tbody></table></div>';
    } else {
        html += '<p>Không có chỉ số đặc biệt nào.</p>';
    }
    html += '</div>';

    html += '<div class="modal-section">';
    html += '<h4>2. Ngày làm việc Đặc biệt (Ngày nghỉ mặc định nhưng công ty vẫn làm)</h4>';
    if (data.specialWorkdays.length > 0) {
        html += '<div class="table-container">';
        html += '<table style="width: 100%; min-width: auto;"><thead><tr><th>Tên Công ty</th><th>Ngày làm việc đặc biệt (Báo cáo)</th><th>Ngày tạo (Hệ thống)</th><th>Ghi chú</th></tr></thead><tbody>';
        data.specialWorkdays.forEach(item => {
            html += `<tr>
                        <td>${item.company || item.c_ty || 'N/A'}</td>
                        <td>${item.ngay_lam_db || 'N/A'}</td> 
                        <td>${item.date}</td>
                        <td>${item.ghi_chu || item.note || ''}</td>
                    </tr>`;
        });
        html += '</tbody></table></div>';
    } else {
        html += '<p>Không có ngày làm việc đặc biệt nào.</p>';
    }
    html += '</div>';

    html += '<div class="modal-section">';
    html += '<h4>3. Các Cài đặt Ngày Đầu Kỳ</h4>';
    const dayNames = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    html += '<div class="table-container">';
    html += '<table style="width: 100%; min-width: auto;"><tbody>';
    html += `<tr><th>Ngày Đầu Tuần (weekDayStart)</th><td>${dayNames[data.startDaySettings.weekDayStart] || data.startDaySettings.weekDayStart}</td></tr>`;
    html += `<tr><th>Ngày Đầu Tháng (monthDayStart)</th><td>Ngày ${data.startDaySettings.monthDayStart}</td></tr>`;
    html += `<tr><th>Ngày Đầu Năm (yearDayStart)</th><td>Ngày ${data.startDaySettings.yearDayStart}</td></tr>`;
    html += '</tbody></table></div>';
    html += '</div>';
    
    html += '<div class="modal-section">';
    html += '<h4>4. Cấu hình Doanh nghiệp đang áp dụng</h4>';
    const dayMap = {0:"CN", 1:"T2", 2:"T3", 3:"T4", 4:"T5", 5:"T6", 6:"T7"};
    const latestConfigs = {};
    if (data.companyConfigs && data.companyConfigs.length > 0) {
        data.companyConfigs.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
        data.companyConfigs.forEach(c => latestConfigs[c.company] = c);
    }
    const sortedCompanies = Object.keys(latestConfigs).sort();
    const configList = sortedCompanies.map((company, index) => {
        const c = latestConfigs[company];
        const daysStr = (c.defaultHolidays || []).map(d => dayMap[d]).join(", ") || "-";
        let groupStr = c.group === "group2" ? "Nhóm Hóa đơn" : (c.group === "group3" ? "Nhóm Khoán" : "Nhóm Đồng hồ");
        return `<tr><td style="text-align: center;">${index + 1}</td><td style="text-align: center;">${company}</td><td style="text-align: center;">${groupStr}</td><td style="text-align: center;">${c.quotaMultiplier || 0}</td><td style="text-align: center;">Ngày ${c.billingDay || '-'}</td><td style="text-align: center;">${daysStr}</td></tr>`;
    }).join('');

    if (configList) {
        html += '<div class="table-container">';
        html += '<table style="width: 100%; min-width: auto;"><thead><tr><th style="text-align: center; width: 40px;">STT</th><th style="text-align: center;">Công ty</th><th style="text-align: center;">Nhóm</th><th style="text-align: center;">Hệ số Khoán</th><th style="text-align: center;">Kỳ phí</th><th style="text-align: center;">Ngày nghỉ</th></tr></thead><tbody>';
        html += configList;
        html += '</tbody></table></div>';
    } else {
        html += '<p>Chưa có cấu hình doanh nghiệp nào được thiết lập trong hệ thống mới.</p>';
    }
    html += '</div>';
    
    contentDiv.innerHTML = html;
}

function setupConfigModal() {
    const modal = document.getElementById('configModal');
    const btn = document.getElementById('openConfigModal');
    const span = document.getElementById("closeConfigModal");
    
    if (btn) btn.onclick = async () => { 
        modal.style.display = "block"; 
        toggleBodyScroll(true); 
        document.getElementById('configModalContent').innerHTML = '<p>Đang tải dữ liệu...</p>'; 
        const data = await fetchReportConfigData(); 
        renderConfigModal(data); 
    };
    if (span) span.onclick = () => { modal.style.display = "none"; toggleBodyScroll(false); };
    window.addEventListener('click', (event) => { if (event.target == modal) { modal.style.display = "none"; toggleBodyScroll(false); } });
}

// ===============================================
// 🔥 QUẢN LÝ CA BÁO CÁO (Tab 2)
// ===============================================
let autoplanTimes = new Set();
let allReportShifts = [];
const shiftListBody = document.getElementById('shift-list-body');

async function loadAutoplanTimes() {
    try {
        const snap = await getDocs(collection(db, "work_patterns"));
        autoplanTimes.clear();
        snap.docs.forEach(doc => {
            const pattern = doc.data();
            if (pattern.startTime) autoplanTimes.add(pattern.startTime);
            if (pattern.endTime) autoplanTimes.add(pattern.endTime);
        });
    } catch (e) {
        console.error("Lỗi tải work_patterns:", e);
    }
}

function timeToMins(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function findClosestTime(targetTime, timeSet) {
    if (timeSet.size === 0) return "không rõ";
    const targetMins = timeToMins(targetTime);
    let closestTime = "";
    let minDiff = Infinity;
    for (const time of timeSet) {
        const diff = Math.abs(timeToMins(time) - targetMins);
        if (diff < minDiff) { minDiff = diff; closestTime = time; }
    }
    return closestTime;
}

function setupShiftManagement() {
    onSnapshot(collection(db, "report_shifts"), (snapshot) => {
        allReportShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allReportShifts.sort((a, b) => a.startTime.localeCompare(b.startTime));
        
        if (!shiftListBody) return;
        shiftListBody.innerHTML = '';
        if (allReportShifts.length === 0) {
            shiftListBody.innerHTML = '<tr><td colspan="4" style="padding: 15px; color: #64748b;">Chưa có ca báo cáo nào.</td></tr>';
            return;
        }
        
        allReportShifts.forEach(shift => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td style="font-weight: bold;">${shift.name}</td><td>${shift.startTime}</td><td>${shift.endTime}${shift.isNextDay ? " <small style='color: #e74c3c;'>(+1 ngày)</small>" : ""}</td><td><button data-id="${shift.id}" class="delete-shift-btn" style="background: #e74c3c; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">🗑️ Xóa</button></td>`;
            shiftListBody.appendChild(tr);
        });
        
        document.querySelectorAll('.delete-shift-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                const shiftToDelete = allReportShifts.find(s => s.id === id);
                const isConfirmed = await showConfirmSwal(`Xóa ca "${shiftToDelete ? shiftToDelete.name : "Không rõ"}"?`, "Bạn sẽ không thể hoàn tác hành động này!", "Vâng, xóa nó!", "Hủy bỏ", "error");
                if (isConfirmed) {
                    try {
                        await deleteDoc(doc(db, "report_shifts", id));
                        showSwal("success", "Thành công", "Đã xóa ca.");
                        addLog("admin_delete_shift_success", { shiftId: id, shiftName: shiftToDelete ? shiftToDelete.name : "Không rõ", email: auth.currentUser?.email || "admin" });
                    } catch (error) { showSwal("error", "Lỗi khi xóa ca", error.message); }
                }
            });
        });
    });
    
    const btnSave = document.getElementById('save-shift-btn');
    if (btnSave) btnSave.addEventListener('click', async () => {
        const data = { name: document.getElementById('shift-name').value.trim(), startTime: document.getElementById('shift-start-time').value, endTime: document.getElementById('shift-end-time').value, isNextDay: document.getElementById('shift-is-next-day').checked };
        if (!data.name || !data.startTime || !data.endTime) return showSwal("error", "Thiếu thông tin", "Vui lòng nhập Tên, Giờ bắt đầu và Giờ kết thúc.");
        
        let warnings = [];
        if (!autoplanTimes.has(data.startTime)) warnings.push(`Giờ bắt đầu '<b>${data.startTime}</b>' không khớp với lịch autoplan (gần nhất là '<b>${findClosestTime(data.startTime, autoplanTimes)}</b>').`);
        if (!autoplanTimes.has(data.endTime)) warnings.push(`Giờ kết thúc '<b>${data.endTime}</b>' không khớp với lịch autoplan (gần nhất là '<b>${findClosestTime(data.endTime, autoplanTimes)}</b>').`);
        
        const saveAction = async () => {
            try {
                showLoading("Đang lưu ca...");
                await addDoc(collection(db, "report_shifts"), data);
                hideLoading();
                showSwal("success", "Thành công", "Đã lưu ca báo cáo.");
                document.getElementById('shift-name').value = ''; document.getElementById('shift-start-time').value = ''; document.getElementById('shift-end-time').value = ''; document.getElementById('shift-is-next-day').checked = false;
                addLog("admin_create_shift_success", { shiftName: data.name, time: `${data.startTime}-${data.endTime}`, email: auth.currentUser?.email || "admin" });
            } catch (error) { hideLoading(); showSwal("error", "Lỗi khi lưu ca", error.message); }
        };
        
        if (warnings.length > 0) {
            const isConfirmed = await showConfirmSwal('⚠️ Cảnh báo Mâu thuẫn!', `<p>Các mốc thời gian bạn nhập có thể gây lỗi điền tên nhân viên:</p><ul style="text-align: left; margin-left: 20px;">${warnings.map(w => `<li>${w}</li>`).join('')}</ul><p style="margin-top: 15px;">Bạn có chắc chắn muốn lưu?</p>`, 'Vẫn Lưu', 'Hủy bỏ', 'warning');
            if (isConfirmed) saveAction();
        } else saveAction();
    });
}

// ===============================================
// 🔥 QUẢN LÝ LỊCH TRỰC VÀ CÔNG VIỆC (Tab 3)
// ===============================================

let allWorkRules = [];
let allWorkPatterns = [];
let allShiftSwaps = [];
let allKnownEmails = new Set();
let scheduleSearchDebounceTimer = null; // Biến chống giật khi gõ tìm kiếm

function setupScheduleManagement() {
    initScheduleModalsUI();
    listenScheduleData();
    setupScheduleEventListeners();
    
    const searchInput = document.getElementById('scheduleSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (scheduleSearchDebounceTimer) clearTimeout(scheduleSearchDebounceTimer);
            scheduleSearchDebounceTimer = setTimeout(() => {
                renderRuleList();
                renderPatternList();
                renderSwapList();
            }, 300); // Đợi 300ms sau khi ngừng gõ mới render 3 bảng
        });
    }
}

function normalizeForSearch(str) {
    if (!str) return "";
    return str.toString().toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/\s*([/-])\s*/g, "$1");
}

// Trình thông dịch ngày tháng cho trang Settings
function buildSettingSearchString(fields) {
    return fields.map(field => {
        if (!field) return "";
        const str = field.toString();
        let variants = "";
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

function getScheduleSearchQuery() {
    const input = document.getElementById('scheduleSearchInput');
    return input ? normalizeForSearch(input.value).trim() : "";
}

function initScheduleModalsUI() {
    const btnOpenAddModal = document.getElementById('btn-openAddModal');
    const btnOpenSwapModal = document.getElementById('btn-openSwapModal');

    if(btnOpenAddModal) btnOpenAddModal.onclick = () => { openAddRuleModal(); };
    if(btnOpenSwapModal) btnOpenSwapModal.onclick = () => { 
        document.getElementById("swapDate").value = "";
        document.getElementById("swapUser1").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
        document.getElementById("swapUser2").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
        document.getElementById("swapReason").value = "";
        document.getElementById("swapModal").style.display = "block"; 
        toggleBodyScroll(true); 
    };

    // Sự kiện Đóng Modal
    document.getElementById("closeEditPatternModal").onclick = closeEditPatternModalFn;
    document.getElementById("cancelEditPatternBtn").onclick = closeEditPatternModalFn;
    document.getElementById("closeEditRuleModal").onclick = closeEditRuleModalFn;
    document.getElementById("cancelEditRuleBtn").onclick = closeEditRuleModalFn;
    document.getElementById("closeAddRuleModal").onclick = closeAddRuleModalFn;
    document.getElementById("cancelAddRuleBtn").onclick = closeAddRuleModalFn;
    document.getElementById("closeSwapModal").onclick = closeSwapModalFn;
    document.getElementById("cancelSwapBtn").onclick = closeSwapModalFn;
    document.getElementById("closeEditSwapModal").onclick = closeEditSwapModalFn;
    document.getElementById("cancelEditSwapBtn").onclick = closeEditSwapModalFn;

    // Đổi form trong Add Modal (Quy tắc CV vs Quy tắc Lịch)
    const addRuleTypeSelect = document.getElementById('addRuleTypeSelect');
    if (addRuleTypeSelect) {
        addRuleTypeSelect.onchange = (e) => {
            document.getElementById('addJobFormContainer').style.display = e.target.value === 'job' ? 'block' : 'none';
            document.getElementById('addPatternFormContainer').style.display = e.target.value === 'pattern' ? 'block' : 'none';
        };
    }

    // Đổi form Kiểu lịch (Cố định vs Xoay ca)
    const patternTypeSelect = document.getElementById('patternTypeSelect');
    if (patternTypeSelect) {
        patternTypeSelect.onchange = (e) => {
            document.getElementById('administrativeInputs').style.display = e.target.value === 'administrative' ? 'block' : 'none';
            document.getElementById('shiftRotationInputs').style.display = e.target.value === 'shift_rotation' ? 'block' : 'none';
        };
    }

    const editPatternTypeSelect = document.getElementById('editPatternTypeSelect');
    if (editPatternTypeSelect) {
        editPatternTypeSelect.onchange = (e) => {
            document.getElementById('editAdministrativeInputs').style.display = e.target.value === 'administrative' ? 'block' : 'none';
            document.getElementById('editShiftRotationInputs').style.display = e.target.value === 'shift_rotation' ? 'block' : 'none';
        };
    }

    // Tự động sinh Option cho select Ngày trong tháng (1->31)
    const domSelects = [document.getElementById('domSelect'), document.getElementById('editRuleDom')];
    domSelects.forEach(sel => {
        if (sel) {
            sel.innerHTML = '<option value="">--Ngày--</option>';
            for(let i=1; i<=31; i++) sel.innerHTML += `<option value="${i}">${i}</option>`;
        }
    });

    // Cập nhật trạng thái các input định kỳ
    [document.getElementById("exactDate"), document.getElementById("domSelect"), document.getElementById("daySelect"), document.getElementById("weekSelect"), document.getElementById("monthSelect")].forEach(el => {
        if (el) { el.addEventListener('change', updateAddRuleState); el.addEventListener('input', updateAddRuleState); }
    });
    [document.getElementById("editRuleExactDate"), document.getElementById("editRuleDom"), document.getElementById("editRuleDay"), document.getElementById("editRuleWeek"), document.getElementById("editRuleMonth")].forEach(el => {
        if (el) { el.addEventListener('change', updateEditRuleState); el.addEventListener('input', updateEditRuleState); }
    });

    // Logic checkbox độc quyền
    const isAdminJobCb = document.getElementById("isAdminJobRuleCheckbox");
    const isCommonJobCb = document.getElementById("isCommonJobRuleCheckbox");
    if(isAdminJobCb) isAdminJobCb.addEventListener("change", function() { if (this.checked) isCommonJobCb.checked = false; });
    if(isCommonJobCb) isCommonJobCb.addEventListener("change", function() {
        if (this.checked) isAdminJobCb.checked = false;
        document.getElementById("addCommonJobSettings").style.display = this.checked ? "block" : "none";
        if (this.checked) document.getElementById("addCommonJobNotifyTime").value = "immediate";
    });

    const editIsAdminCb = document.getElementById("editRuleIsAdminCheckbox");
    const editIsCommonCb = document.getElementById("editRuleIsCommonCheckbox");
    if(editIsAdminCb) editIsAdminCb.addEventListener("change", function() {
        if (this.checked) editIsCommonCb.checked = false;
        const completionFields = document.getElementById("editRuleCompletionFields");
        if (completionFields) completionFields.style.display = this.checked ? "block" : "none";
    });
    if(editIsCommonCb) editIsCommonCb.addEventListener("change", function() {
        if (this.checked) editIsAdminCb.checked = false;
        document.getElementById("editCommonJobSettings").style.display = this.checked ? "block" : "none";
        if (this.checked) document.getElementById("editCommonJobNotifyTime").value = "immediate";
    });

    document.getElementById("editRuleCompletedNoteSelect")?.addEventListener("change", function() {
        const customInput = document.getElementById("editRuleCompletedNoteCustom");
        if (this.value === "Khác") {
            customInput.style.display = "block";
            customInput.focus();
        } else {
            customInput.style.display = "none";
        }
    });
    
    // Tìm nhanh job
    const jobInput = document.getElementById("jobName");
    if (jobInput) {
        jobInput.addEventListener("input", function() {
            const val = this.value.trim().toLowerCase();
            const currentEditId = document.getElementById("addJobRuleEditId").value;

            if (!val) { if (currentEditId) resetAddJobFormMode(); return; }

            const normalizedVal = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const exactMatchRule = allWorkRules.find(r => {
                if (!r.job) return false;
                const normalizedJob = r.job.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return normalizedJob === normalizedVal;
            });

            if (exactMatchRule) {
                if (currentEditId !== exactMatchRule.id) {
                    document.getElementById("jobTime").value = exactMatchRule.time || "";
                    document.getElementById("exactDate").value = exactMatchRule.exactDate || "";
                    document.getElementById("domSelect").value = exactMatchRule.dom || "";
                    document.getElementById("daySelect").value = exactMatchRule.day || "";
                    document.getElementById("weekSelect").value = exactMatchRule.week || "";
                    document.getElementById("monthSelect").value = exactMatchRule.month || "";
                    document.getElementById("addRuleEndDate").value = exactMatchRule.ruleEndDate || "";
                    document.getElementById("isAdminJobRuleCheckbox").checked = exactMatchRule.is_admin_job || false;
                    document.getElementById("isCommonJobRuleCheckbox").checked = exactMatchRule.is_common_job || false;
                    document.getElementById("addCommonJobSettings").style.display = exactMatchRule.is_common_job ? "block" : "none";
                    if (exactMatchRule.is_common_job) {
                        document.getElementById("addCommonJobTargetGroup").value = exactMatchRule.targetGroup || "all";
                        document.getElementById("addCommonJobNotifyTime").value = (exactMatchRule.notifyTime !== undefined && exactMatchRule.notifyTime !== null) ? exactMatchRule.notifyTime : "immediate";
                    }
                    let rawNote = exactMatchRule.note || "";
                    if (rawNote.startsWith("[CVAdmin]")) rawNote = rawNote.replace("[CVAdmin]", "").trim();
                    else if (rawNote.startsWith("[CVChung]")) rawNote = rawNote.replace("[CVChung]", "").trim();
                    document.getElementById("jobNote").value = rawNote;
                    
                    updateAddRuleState();
                    document.getElementById("addJobRuleEditId").value = exactMatchRule.id;
                    document.getElementById("deleteAddRuleBtn").style.display = "block";
                    document.getElementById("addRuleSpacer").style.display = "block";
                    const saveBtn = document.getElementById("saveNewRuleBtn");
                    saveBtn.innerHTML = "💾 Lưu thay đổi";
                    saveBtn.style.background = "#f39c12";
                    const saveAsNewBtn = document.getElementById("saveAsNewRuleBtn");
                    if (saveAsNewBtn) saveAsNewBtn.style.display = "block";
                    showSwal("info", "Đã tải dữ liệu công việc cũ", "Bạn có thể chỉnh sửa hoặc lưu thành việc mới.");
                }
            } else {
                if (currentEditId) resetAddJobFormMode();
            }
        });
    }
    
    document.getElementById("swapDate")?.addEventListener("change", (e) => {
        populateSwapUsersForDate(e.target.value, "swapUser1", "swapUser2");
    });
    document.getElementById("editSwapDate")?.addEventListener("change", (e) => {
        populateSwapUsersForDate(e.target.value, "editSwapUser1", "editSwapUser2");
    });
}

function closeEditPatternModalFn() {
    document.getElementById("editPatternModal").style.display = "none";
    toggleBodyScroll(false);
    ["editPatternId", "editPatternUser", "editPatternDisplayName", "editPatternStartDate", "editPatternEndDate", "editStartTime", "editEndTime", "editPatternNotifyTime", "editShiftGroupName", "editAdminShiftGroupName", "editPatternNote"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    document.getElementById("editPatternTypeSelect").value = "administrative";
    document.querySelectorAll("#editDayCheckboxes input").forEach(cb => cb.checked = false);
    document.getElementById("editAdministrativeInputs").style.display = 'block';
    document.getElementById("editShiftRotationInputs").style.display = 'none';
}

function closeEditRuleModalFn() {
    document.getElementById("editRuleModal").style.display = "none";
    toggleBodyScroll(false);
    ["editRuleId", "editRuleJobName", "editRuleTime", "editRuleExactDate", "editRuleDom", "editRuleDay", "editRuleWeek", "editRuleMonth", "editRuleEndDate", "editRuleNote", "editRuleLastCompletedDate", "editRuleActualCompletedDate", "editRuleCompletedNoteSelect", "editRuleCompletedNoteCustom"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    ["editRuleIsAdminCheckbox", "editRuleIsCommonCheckbox"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    });
    if (document.getElementById("editCommonJobSettings")) document.getElementById("editCommonJobSettings").style.display = "none";
    if (document.getElementById("editRuleCompletionFields")) document.getElementById("editRuleCompletionFields").style.display = "none";
    if (document.getElementById("editRuleCompletedNoteCustom")) document.getElementById("editRuleCompletedNoteCustom").style.display = "none";
    updateEditRuleState();
}

function closeAddRuleModalFn() {
    document.getElementById("addRuleModal").style.display = "none";
    toggleBodyScroll(false);
    ["jobName", "daySelect", "weekSelect", "monthSelect", "domSelect", "exactDate", "jobNote", "jobTime", "addRuleEndDate"].forEach(id => { const el = document.getElementById(id); if(el) el.value = ""; });
    if (document.getElementById("isAdminJobRuleCheckbox")) document.getElementById("isAdminJobRuleCheckbox").checked = false;
    if (document.getElementById("isCommonJobRuleCheckbox")) document.getElementById("isCommonJobRuleCheckbox").checked = false;
    if (document.getElementById("addCommonJobSettings")) document.getElementById("addCommonJobSettings").style.display = "none";
    ["patternUser", "patternDisplayName", "patternStartDate", "patternNote", "adminShiftGroupName", "adminStartTime", "adminEndTime", "shiftGroupName", "shiftStartTime", "shiftEndTime", "patternNotifyTime"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    document.querySelectorAll("#dayCheckboxes input").forEach(cb => cb.checked = false);
    resetAddJobFormMode();
    updateAddRuleState();
}

function closeSwapModalFn() {
    document.getElementById("swapModal").style.display = "none";
    toggleBodyScroll(false);
    document.getElementById("swapDate").value = "";
    document.getElementById("swapReason").value = "";
    document.getElementById("swapUser1").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
    document.getElementById("swapUser2").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
}

function closeEditSwapModalFn() {
    document.getElementById("editSwapModal").style.display = "none";
    toggleBodyScroll(false);
    document.getElementById("editSwapId").value = "";
    document.getElementById("editSwapDate").value = "";
    document.getElementById("editSwapReason").value = "";
    document.getElementById("editSwapUser1").innerHTML = '';
    document.getElementById("editSwapUser2").innerHTML = '';
}

function listenScheduleData() {
    onSnapshot(collection(db, "work_rules"), (snap) => {
        allWorkRules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allWorkRules.sort((a, b) => {
            const groupA = getNormalizedFirstChar(a.job);
            const groupB = getNormalizedFirstChar(b.job);
            if (groupA !== groupB) return groupA.localeCompare(groupB);
            if (b.createdAt && a.createdAt) return b.createdAt.toMillis() - a.createdAt.toMillis();
            return 0;
        });
        renderRuleList();
        updateJobNameDatalist(allWorkRules);
    });

    onSnapshot(collection(db, "work_patterns"), (snap) => {
        allWorkPatterns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allWorkPatterns.sort((a, b) => (a.user || "").localeCompare(b.user || ""));
        renderPatternList();
        updateShiftGroupDatalist(allWorkPatterns);
        let newUsersFound = false;
        allWorkPatterns.forEach(p => {
            if (p.user && !allKnownEmails.has(p.user)) {
                allKnownEmails.add(p.user);
                newUsersFound = true;
            }
        });
        if(newUsersFound) renderUserDatalist();
    });

    onSnapshot(collection(db, "shift_swaps"), (snap) => {
        allShiftSwaps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderSwapList();
    });
}

function getCleanName(name) {
    if (!name) return "Khác";
    let base = name;
    base = base.replace(/\s+(?:\d+\s+)?(?:tháng|thang)\s+(?:đầu|cuối|giữa)\s+(?:năm|nam)$/i, '');
    base = base.replace(/\s+(?:(?:\d+\s+)?(?:t|th|tháng|thang|kỳ|ky|năm|nam|quý|quy|q|quỉ)[\s\d\/\-]*|(?:đầu năm|cuối năm))$/i, '');
    return base.trim() === "" ? name : base.trim();
}

function groupTasks(rulesArray) {
    const tempProcessed = rulesArray.map(d => ({
        ...d,
        cleanNameLower: getCleanName(d.job).toLowerCase(),
        cleanNameDisplay: getCleanName(d.job)
    }));
    const displayNamesMap = {};
    tempProcessed.forEach(d => {
        if (!displayNamesMap[d.cleanNameLower]) {
            displayNamesMap[d.cleanNameLower] = d.cleanNameDisplay;
        } else if (d.cleanNameDisplay.length < displayNamesMap[d.cleanNameLower].length) {
            displayNamesMap[d.cleanNameLower] = d.cleanNameDisplay;
        }
    });
    const uniqueCleanNames = Object.keys(displayNamesMap).sort((a, b) => a.length - b.length);
    const groupedRules = {};
    tempProcessed.forEach(d => {
        let matchedGroup = null;
        for (const groupName of uniqueCleanNames) {
            if (d.cleanNameLower === groupName || d.cleanNameLower.startsWith(groupName + " ") || d.cleanNameLower.startsWith(groupName + " -")) {
                matchedGroup = groupName;
                break;
            }
        }
        if (!matchedGroup) matchedGroup = d.cleanNameLower;
        if (!groupedRules[matchedGroup]) {
            groupedRules[matchedGroup] = { baseNameDisplay: displayNamesMap[matchedGroup] || d.cleanNameDisplay, rules: [] };
        }
        groupedRules[matchedGroup].rules.push(d);
    });
    return Object.values(groupedRules).sort((a, b) => a.baseNameDisplay.localeCompare(b.baseNameDisplay));
}

function renderRuleList() {
    const tbody = document.getElementById('ruleListBody');
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    const query = getScheduleSearchQuery();
    let rulesToRender = allWorkRules;
    if (query) {
        rulesToRender = allWorkRules.filter(r => {
            const fields = [r.job, r.note, r.exactDate, r.targetGroup, r.time, r.dom, r.day, r.week, r.month, r.ruleEndDate];
            return buildSettingSearchString(fields).includes(query);
        });
    }
    
    const countSpan = document.getElementById('ruleListCount');
    if (countSpan) {
        countSpan.textContent = `${rulesToRender.length} công việc`;
        countSpan.style.display = "inline-block";
    }

    if (rulesToRender.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 20px; color: #888; font-style: italic;">Không tìm thấy công việc nào phù hợp.</td></tr>`;
        return;
    }
    
    const todayForCheck = new Date();
    todayForCheck.setHours(0, 0, 0, 0);
    
    const activeRules = [];
    const completedSingleTasks = []; 
    const expiredRecurringRules = [];

    rulesToRender.forEach(d => {
        let isExpired = false;
        let endDateDisplay = "-";
        
        if (d.ruleEndDate) {
            endDateDisplay = d.ruleEndDate.split('-').reverse().join('/');
            const endDateObj = new Date(d.ruleEndDate + 'T00:00:00');
            if (todayForCheck > endDateObj) isExpired = true;
        }
        if (d.exactDate && d.lastCompletedDate) {
            isExpired = true; 
            if (!d.ruleEndDate) { 
                if (d.actualCompletedDate) {
                    const acDate = new Date(d.actualCompletedDate);
                    endDateDisplay = `${String(acDate.getDate()).padStart(2, '0')}/${String(acDate.getMonth() + 1).padStart(2, '0')}/${acDate.getFullYear()}`;
                } else {
                    endDateDisplay = d.exactDate.split('-').reverse().join('/');
                }
            }
        }
        const processed = { ...d, isExpired, endDateDisplay };
        if (isExpired) {
            if (processed.exactDate) completedSingleTasks.push(processed); 
            else expiredRecurringRules.push(processed); 
        } else {
            activeRules.push(processed);
        }
    });

    if (activeRules.length === 0 && completedSingleTasks.length === 0 && expiredRecurringRules.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 20px; color: #888; font-style: italic; text-align: center;">Không có quy tắc công việc nào.</td></tr>`;
        return;
    }

    const sortedActiveGroups = groupTasks(activeRules);
    const sortedCompletedGroups = groupTasks(completedSingleTasks);

    const hasSearchQuery = !!query;

    let lastGroupChar = null;
    let useColorB = false; 
    let groupIdCounter = 0;

    const renderRow = (d, colorClass, isChild, parentId, forceShow = false, isCompletedSection = false, isFlatListItem = false) => {
        const tr = document.createElement("tr");
        tr.className = colorClass;
        
        if (isChild) {
            tr.classList.add("rule-child-row");
            tr.dataset.parent = parentId;
            tr.style.display = forceShow ? "table-row" : "none"; 
            if (isCompletedSection) tr.classList.add("completed-level-2");
        }
        if (isCompletedSection && !isChild) {
            tr.classList.add("completed-level-1");
            tr.style.display = forceShow ? "table-row" : "none";
        }
        if (isFlatListItem) {
            tr.classList.add("expired-recurring-row");
            tr.style.display = forceShow ? "table-row" : "none";
        }
        if (d.isExpired) {
            tr.style.color = "#999";
            tr.style.opacity = "0.7";
        }
        const noteDisplay = (d.note || "").replace("[CVAdmin]", "<b>[CVAdmin]</b>").replace("[CVChung]", "<b style='color:#3498db'>[CVChung]</b>");
        tr.innerHTML = `
            <td style="position: relative; padding-right: 10px; text-align: left;">
                <span>${d.job}</span>${noteDisplay ? `<br><span style="font-size: 0.85em; color: #7f8c8d; text-decoration: none; display: inline-block;">${noteDisplay}</span>` : ""}
            </td>
            <td>${d.time || "-"}</td>
            <td style="color: #d35400; font-weight:bold;">${d.exactDate ? d.exactDate.split('-').reverse().join('/') : "-"}</td>
            <td style="color: #c0392b;">${d.endDateDisplay}</td>
            <td style="font-size:0.9em; color:#555;">
                ${d.exactDate ? "<i>(Bỏ qua định kỳ)</i>" : `N:${d.dom || "-"} | ${d.day === "8" ? "CN" : (d.day === "all" ? "Mọi ngày" : (d.day ? "T" + d.day : "-"))} | T:${d.week === "all" ? "Mọi tuần" : (d.week || "-")} | Th:${d.month === "all" ? "Mọi tháng" : (d.month || "-")}`}
            </td>
            <td style="white-space: nowrap; text-align: center;">
                <div style="display: flex; gap: 4px; justify-content: center;">
                    <button class="editRuleBtn" data-id="${d.id}" style="background:#f39c12; padding: 4px 8px; font-size: 12px; border:none; border-radius:4px; color:white; cursor:pointer;">✏️ Sửa</button>
                </div>
            </td>`;
        tr.querySelector(".editRuleBtn").addEventListener("click", () => { openEditRuleModal(d); });
        
        // Gắn sự kiện sao chép ID tài liệu bằng chuột phải hoặc nhấn giữ cho Admin
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            copyDocIdToClipboard('work_rules', d.id);
        });

        let pressTimer;
        tr.addEventListener('touchstart', () => {
            pressTimer = window.setTimeout(() => {
                copyDocIdToClipboard('work_rules', d.id);
            }, 800);
        }, { passive: true });
        tr.addEventListener('touchend', () => clearTimeout(pressTimer));
        tr.addEventListener('touchmove', () => clearTimeout(pressTimer));

        tbody.appendChild(tr);
    };

    const renderGroupLoop = (groups, isCompletedSection = false) => {
        groups.forEach(group => {
            const currentGroupChar = getNormalizedFirstChar(group.baseNameDisplay);
            if (currentGroupChar !== lastGroupChar) { useColorB = !useColorB; lastGroupChar = currentGroupChar; }
            const colorClass = useColorB ? 'group-color-b' : 'group-color-a';

            if (group.rules.length === 1) {
                renderRow(group.rules[0], colorClass, false, null, hasSearchQuery, isCompletedSection);
            } else {
                groupIdCounter++;
                const groupId = `job-group-${groupIdCounter}`;
                const headerTr = document.createElement("tr");
                headerTr.className = `rule-group-header ${colorClass} ${isCompletedSection ? 'completed-level-1' : ''}`;
                headerTr.dataset.target = groupId;
                if (isCompletedSection && !hasSearchQuery) headerTr.style.display = "none";

                headerTr.innerHTML = `
                    <td colspan="6" style="text-align: left; padding: 10px; cursor: pointer; border-bottom: 1px solid #ccc;">
                        <span class="group-toggle-btn" style="display:inline-block; width: 22px; color: ${isCompletedSection ? '#16a085' : '#3498db'}; font-size: 12px; font-weight: bold;">${hasSearchQuery ? '▼' : '▶'}</span>
                        <b style="color: ${isCompletedSection ? '#16a085' : '#2c3e50'};">${group.baseNameDisplay}</b> 
                        <span style="font-weight:normal; color:#e74c3c; font-size: 0.85em; background: #fff; border: 1px solid #f5b7b1; padding: 2px 6px; border-radius: 12px; margin-left: 5px;">${group.rules.length} công việc</span>
                    </td>`;
                headerTr.addEventListener('click', function() {
                    const targetId = this.dataset.target;
                    const childRows = tbody.querySelectorAll(`.rule-child-row[data-parent="${targetId}"]`);
                    const toggleBtn = this.querySelector('.group-toggle-btn');
                    const isClosed = toggleBtn.textContent.trim() === '▶';
                    childRows.forEach(row => { row.style.display = isClosed ? 'table-row' : 'none'; });
                    toggleBtn.textContent = isClosed ? '▼' : '▶';
                });
                tbody.appendChild(headerTr);
                group.rules.sort((a, b) => {
                    const dateA = a.exactDate ? new Date(a.exactDate) : new Date(0);
                    const dateB = b.exactDate ? new Date(b.exactDate) : new Date(0);
                    if (dateA - dateB !== 0) return dateB - dateA; 
                    return b.job.localeCompare(a.job);
                });
                group.rules.forEach(d => renderRow(d, colorClass, true, groupId, hasSearchQuery, isCompletedSection));
            }
        });
    };

    renderGroupLoop(sortedActiveGroups, false);

    if (completedSingleTasks.length > 0) {
        const masterHeaderTr = document.createElement("tr");
        masterHeaderTr.className = `rule-group-header`;
        masterHeaderTr.innerHTML = `
            <td colspan="6" style="text-align: left; padding: 10px; cursor: pointer; border-bottom: 1px solid #ccc; background-color: #e8f8f5;">
                <span class="group-toggle-btn" style="display:inline-block; width: 22px; color: #16a085; font-size: 12px; font-weight: bold;">${hasSearchQuery ? '▼' : '▶'}</span>
                <b style="color: #16a085;">Hoàn thành (Công việc đơn lẻ)</b> 
                <span style="font-weight:normal; color:#16a085; font-size: 0.85em; background: #fff; border: 1px solid #a9dfbf; padding: 2px 6px; border-radius: 12px; margin-left: 5px;">${completedSingleTasks.length} công việc</span>
            </td>`;
        masterHeaderTr.addEventListener('click', function() {
            const level1Rows = tbody.querySelectorAll('.completed-level-1');
            const toggleBtn = this.querySelector('.group-toggle-btn');
            const isClosed = toggleBtn.textContent.trim() === '▶';
            level1Rows.forEach(row => {
                row.style.display = isClosed ? 'table-row' : 'none';
                if (!isClosed && row.classList.contains('rule-group-header')) {
                    const targetId = row.dataset.target;
                    if (targetId) {
                        tbody.querySelectorAll(`.rule-child-row[data-parent="${targetId}"]`).forEach(child => child.style.display = 'none');
                        const childToggleBtn = row.querySelector('.group-toggle-btn');
                        if (childToggleBtn) childToggleBtn.textContent = '▶';
                    }
                }
            });
            toggleBtn.textContent = isClosed ? '▼' : '▶';
        });
        tbody.appendChild(masterHeaderTr);
        renderGroupLoop(sortedCompletedGroups, true);
    }

    if (expiredRecurringRules.length > 0) {
        const hiddenGroupTr = document.createElement("tr");
        hiddenGroupTr.className = `rule-group-header rule-group-hidden`;
        hiddenGroupTr.innerHTML = `
            <td colspan="6" style="text-align: left; padding: 10px; cursor: pointer; border-bottom: 1px solid #ccc; background-color: #f8fafc;">
                <span class="group-toggle-btn" style="display:inline-block; width: 22px; color: #94a3b8; font-size: 12px; font-weight: bold;">${hasSearchQuery ? '▼' : '▶'}</span>
                <b style="color: #64748b;">Quy tắc hết hiệu lực</b> 
                <span style="font-weight:normal; color:#94a3b8; font-size: 0.85em; background: #fff; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 12px; margin-left: 5px;">${expiredRecurringRules.length} quy tắc</span>
            </td>`;
        hiddenGroupTr.addEventListener('click', function() {
            const hiddenRows = tbody.querySelectorAll('.expired-recurring-row');
            const toggleBtn = this.querySelector('.group-toggle-btn');
            const isClosed = toggleBtn.textContent.trim() === '▶';
            hiddenRows.forEach(row => row.style.display = isClosed ? 'table-row' : 'none');
            toggleBtn.textContent = isClosed ? '▼' : '▶';
        });
        tbody.appendChild(hiddenGroupTr);
        expiredRecurringRules.forEach(d => renderRow(d, 'group-color-a', false, null, hasSearchQuery, false, true));
    }
}

function renderPatternList() {
    const tbody = document.getElementById('patternListBody');
    if (!tbody) return;
    
    tbody.innerHTML = "";
    const todayForCheck = new Date();
    todayForCheck.setHours(0, 0, 0, 0);
    
    const query = getScheduleSearchQuery();
    let patternsToRender = allWorkPatterns;
    if (query) {
        patternsToRender = allWorkPatterns.filter(p => {
            const typeStr = p.type === "administrative" ? "Cố định hành chính" : "Xoay Vòng theo ca";
            const fields = [p.user, p.displayName, p.shiftGroup, p.note, p.patternStartDate, p.patternEndDate, p.startTime, p.endTime, typeStr];
            return buildSettingSearchString(fields).includes(query);
        });
    }
    
    const countSpan = document.getElementById('patternListCount');
    if (countSpan) {
        countSpan.textContent = `${patternsToRender.length} quy tắc`;
        countSpan.style.display = "inline-block";
    }

    const activePatterns = [];
    const expiredPatterns = [];

    patternsToRender.forEach(d => {
        let isExpired = false;
        if (d.patternEndDate) {
            const endDateObj = new Date(d.patternEndDate + 'T00:00:00');
            if (todayForCheck > endDateObj) isExpired = true;
        }
        const processed = { ...d, isExpired };
        if (isExpired) expiredPatterns.push(processed);
        else activePatterns.push(processed);
    });
    
    const hasSearchQuery = !!query;

    const renderRow = (d, isHiddenRow = false, forceShow = false) => {
        let detail = "", startTime = d.startTime || "-", endTime = "-";
        const nameStyle = d.isExpired && !isHiddenRow ? 'text-decoration: line-through; color: #999;' : '';
        
        if (d.type === 'administrative') {
            const mapDay = {2:"T2",3:"T3",4:"T4",5:"T5",6:"T6",7:"T7",8:"CN"};
            const workDays = Array.isArray(d.workDaysOfWeek) ? d.workDaysOfWeek : [];
            const daysStr = workDays.map(x => mapDay[x]).join(", ");
            const groupNameDisplay = d.shiftGroup ? `[${d.shiftGroup}]` : `[Hành chính]`;
            detail = `${groupNameDisplay} ${daysStr}`;
            endTime = d.endTime || "-"; 
            if(d.isNextDay) detail += " (Gối đầu)"; 
        } else if (d.type === 'shift_rotation') {
            endTime = d.endTime || "-"; 
            let groupNameDisplay = d.shiftGroup ? `[${d.shiftGroup}]` : `[Vận hành (mặc định)]`;
            if (d.isNextDay === true) detail = `${groupNameDisplay} (Kết thúc hôm sau)`;
            else detail = `${groupNameDisplay} (Trong ngày)`;
        }
        if (d.isNextDay === true && endTime !== "-") endTime += " *";
        const tr = document.createElement("tr");
        
        if (isHiddenRow) {
            tr.classList.add("hidden-pattern-row");
            tr.style.display = forceShow ? "table-row" : "none";
            tr.style.opacity = "0.7";
        } else if (d.isExpired) {
            tr.style.opacity = "0.7";
        }
        
        tr.innerHTML = `
            <td style="${nameStyle}" title="${d.user}">${d.user}</td>
            <td style="${nameStyle}">${d.displayName || "-"}</td>
            <td>${d.type === "administrative" ? "Cố định" : "Xoay Vòng"}</td>
            <td>${detail}</td>
            <td>${d.patternStartDate}</td>
            <td>${d.patternEndDate || "-"}</td>
            <td>${startTime}</td>
            <td>${endTime}</td>
            <td style="white-space: nowrap; text-align: center;">
                <div style="display: flex; gap: 4px; justify-content: center;">
                    <button class="editPatternBtn" data-id="${d.id}" style="background:#f39c12; padding: 4px 8px; font-size: 12px; border:none; border-radius:4px; color:white; cursor:pointer;">✏️ Sửa</button>
                </div>
            </td>`;
        tr.querySelector(".editPatternBtn").addEventListener("click", () => { openEditPatternModal(d); });
        
        // Gắn sự kiện sao chép ID tài liệu bằng chuột phải hoặc nhấn giữ cho Admin
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            copyDocIdToClipboard('work_patterns', d.id);
        });

        let pressTimer;
        tr.addEventListener('touchstart', () => {
            pressTimer = window.setTimeout(() => {
                copyDocIdToClipboard('work_patterns', d.id);
            }, 800);
        }, { passive: true });
        tr.addEventListener('touchend', () => clearTimeout(pressTimer));
        tr.addEventListener('touchmove', () => clearTimeout(pressTimer));

        tbody.appendChild(tr);
    };
    
    if (patternsToRender.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="padding: 20px; color: #888; font-style: italic;">Không tìm thấy lịch làm việc nào phù hợp.</td></tr>`;
        return;
    }

    activePatterns.forEach(d => renderRow(d, false));

    if (expiredPatterns.length > 0) {
        const hiddenGroupTr = document.createElement("tr");
        hiddenGroupTr.className = `rule-group-header rule-group-hidden`;
        hiddenGroupTr.innerHTML = `
            <td colspan="9" style="text-align: left; padding: 10px; cursor: pointer; border-bottom: 1px solid #ccc; background-color: #f8fafc;">
                <span class="group-toggle-btn" style="display:inline-block; width: 22px; color: #94a3b8; font-size: 12px; font-weight: bold;">${hasSearchQuery ? '▼' : '▶'}</span>
                <b style="color: #64748b;">Quy tắc hết hiệu lực</b> 
                <span style="font-weight:normal; color:#94a3b8; font-size: 0.85em; background: #fff; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 12px; margin-left: 5px;">${expiredPatterns.length} nhân viên</span>
            </td>`;
        hiddenGroupTr.addEventListener('click', function() {
            const hiddenRows = tbody.querySelectorAll('.hidden-pattern-row');
            const toggleBtn = this.querySelector('.group-toggle-btn');
            const isClosed = toggleBtn.textContent.trim() === '▶';
            hiddenRows.forEach(row => row.style.display = isClosed ? 'table-row' : 'none');
            toggleBtn.textContent = isClosed ? '▼' : '▶';
        });
        tbody.appendChild(hiddenGroupTr);
        expiredPatterns.forEach(d => renderRow(d, true, hasSearchQuery));
    }
}

function renderSwapList() {
    const tbody = document.getElementById('swapListBody');
    if (!tbody) return;
    
    tbody.innerHTML = "";

    const query = getScheduleSearchQuery();
    let swapsToRender = allShiftSwaps;
    if (query) {
        swapsToRender = allShiftSwaps.filter(s => {
            const createdAtStr = s.createdAt && s.createdAt.toDate ? s.createdAt.toDate().toLocaleString('vi-VN') : "";
            const fields = [s.date, s.user1, s.user2, s.reason, createdAtStr];
            return buildSettingSearchString(fields).includes(query);
        });
    }
    
    const countSpan = document.getElementById('swapListCount');
    if (countSpan) {
        countSpan.textContent = `${swapsToRender.length} lượt`;
        countSpan.style.display = "inline-block";
    }

    if (swapsToRender.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 20px; color: #888; font-style: italic;">Không tìm thấy hoán đổi nào phù hợp.</td></tr>`;
        return;
    }

    [...swapsToRender].sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0)).forEach(s => {
        const tr = document.createElement("tr");
        const createdAtStr = s.createdAt && s.createdAt.toDate ? s.createdAt.toDate().toLocaleString('vi-VN') : "-";
        const dateStr = s.date ? s.date.split('-').reverse().join('/') : "-";
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${s.user1 || "-"}</td>
            <td>${s.user2 || "-"}</td>
            <td>${s.reason || "-"}</td>
            <td>${createdAtStr}</td>
            <td style="white-space: nowrap; text-align: center;">
                <div style="display: flex; gap: 4px; justify-content: center;">
                    <button class="editSwapBtn" data-id="${s.id}" style="background:#f39c12; padding: 4px 8px; font-size: 12px; border:none; border-radius:4px; color:white; cursor:pointer;">✏️ Sửa</button>
                </div>
            </td>
        `;
        tr.querySelector('.editSwapBtn').addEventListener('click', () => { openEditSwapModal(s); });
        
        // Gắn sự kiện sao chép ID tài liệu bằng chuột phải hoặc nhấn giữ cho Admin
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            copyDocIdToClipboard('shift_swaps', s.id);
        });

        let pressTimer;
        tr.addEventListener('touchstart', () => {
            pressTimer = window.setTimeout(() => {
                copyDocIdToClipboard('shift_swaps', s.id);
            }, 800);
        }, { passive: true });
        tr.addEventListener('touchend', () => clearTimeout(pressTimer));
        tr.addEventListener('touchmove', () => clearTimeout(pressTimer));

        tbody.appendChild(tr);
    });
} 

function resetAddJobFormMode() {
    const editIdEl = document.getElementById("addJobRuleEditId");
    if(editIdEl) editIdEl.value = "";
    const delBtn = document.getElementById("deleteAddRuleBtn");
    if(delBtn) delBtn.style.display = "none";
    const spacer = document.getElementById("addRuleSpacer");
    if(spacer) spacer.style.display = "none";
    const saveBtn = document.getElementById("saveNewRuleBtn");
    if(saveBtn) {
        saveBtn.innerHTML = "💾 Lưu quy tắc";
        saveBtn.style.background = "#2ecc71";
    }
    const saveAsNewBtn = document.getElementById("saveAsNewRuleBtn");
    if (saveAsNewBtn) saveAsNewBtn.style.display = "none";
}

function updateAddRuleState() {
    const exactDateInput = document.getElementById("exactDate");
    const domSelect = document.getElementById("domSelect");
    const daySelect = document.getElementById("daySelect");
    const weekSelect = document.getElementById("weekSelect");
    const monthSelect = document.getElementById("monthSelect");
    if(!exactDateInput) return;
    if (exactDateInput.value) {
        domSelect.disabled = true; daySelect.disabled = true; weekSelect.disabled = true; monthSelect.disabled = true;
    } else if (domSelect.value || daySelect.value || weekSelect.value || monthSelect.value) {
        exactDateInput.disabled = true;
    } else {
        exactDateInput.disabled = false; domSelect.disabled = false; daySelect.disabled = false; weekSelect.disabled = false; monthSelect.disabled = false;
    }
}

function updateEditRuleState() {
    const editRuleExactDate = document.getElementById("editRuleExactDate");
    const editRuleDom = document.getElementById("editRuleDom");
    const editRuleDay = document.getElementById("editRuleDay");
    const editRuleWeek = document.getElementById("editRuleWeek");
    const editRuleMonth = document.getElementById("editRuleMonth");
    if(!editRuleExactDate) return;
    if (editRuleExactDate.value) {
        editRuleDom.disabled = true; editRuleDay.disabled = true; editRuleWeek.disabled = true; editRuleMonth.disabled = true;
    } else if (editRuleDom.value || editRuleDay.value || editRuleWeek.value || editRuleMonth.value) {
        editRuleExactDate.disabled = true;
    } else {
        editRuleExactDate.disabled = false; editRuleDom.disabled = false; editRuleDay.disabled = false; editRuleWeek.disabled = false; editRuleMonth.disabled = false;
    }
}

function openAddRuleModal() {
    resetAddJobFormMode();
    const addRuleTypeSelect = document.getElementById("addRuleTypeSelect");
    if(addRuleTypeSelect) addRuleTypeSelect.dispatchEvent(new Event('change'));
    document.getElementById("addRuleModal").style.display = "block";
    toggleBodyScroll(true);
    updateAddRuleState();
}

function openEditRuleModal(rule) {
    activeEditingRuleData = rule;
    document.getElementById("editRuleId").value = rule.id;
    document.getElementById("editRuleJobName").value = rule.job || "";
    document.getElementById("editRuleTime").value = rule.time || "";
    document.getElementById("editRuleExactDate").value = rule.exactDate || "";
    document.getElementById("editRuleDom").value = rule.dom || "";
    document.getElementById("editRuleDay").value = rule.day || "";
    document.getElementById("editRuleWeek").value = rule.week || "";
    document.getElementById("editRuleMonth").value = rule.month || "";
    document.getElementById("editRuleEndDate").value = rule.ruleEndDate || "";
    
    document.getElementById("editRuleIsAdminCheckbox").checked = rule.is_admin_job || false;
    document.getElementById("editRuleIsCommonCheckbox").checked = rule.is_common_job || false;
    let rawNote = rule.note || "";
    if (rawNote.startsWith("[CVAdmin]")) rawNote = rawNote.replace("[CVAdmin]", "").trim();
    else if (rawNote.startsWith("[CVChung]")) rawNote = rawNote.replace("[CVChung]", "").trim();
    document.getElementById("editRuleNote").value = rawNote;
    
    const commonSettings = document.getElementById("editCommonJobSettings");
    if (rule.is_common_job) {
        commonSettings.style.display = "block";
        document.getElementById("editCommonJobTargetGroup").value = rule.targetGroup || "all";
        document.getElementById("editCommonJobNotifyTime").value = (rule.notifyTime !== undefined && rule.notifyTime !== null) ? rule.notifyTime : "immediate";
    } else {
        commonSettings.style.display = "none";
        document.getElementById("editCommonJobTargetGroup").value = "all";
        document.getElementById("editCommonJobNotifyTime").value = "immediate";
    }
    
    document.getElementById("editRuleLastCompletedDate").value = rule.lastCompletedDate || "";
    let actualCompletedDateValue = "";
    if (rule.actualCompletedDate) {
        try {
            const acDate = new Date(rule.actualCompletedDate);
            const tzOffset = acDate.getTimezoneOffset() * 60000;
            actualCompletedDateValue = (new Date(acDate - tzOffset)).toISOString().slice(0, 16);
        } catch(e) {}
    }
    document.getElementById("editRuleActualCompletedDate").value = actualCompletedDateValue;
    
    const completedNote = rule.completedNote || "";
    const noteSelect = document.getElementById("editRuleCompletedNoteSelect");
    const noteCustom = document.getElementById("editRuleCompletedNoteCustom");
    const predefinedNotes = ["Đã hoàn thành", "Hoàn thành 1 phần", "Không thể hoàn thành", "Loại bỏ"];
    
    if (!completedNote) {
        noteSelect.value = "";
        noteCustom.style.display = "none";
        noteCustom.value = "";
    } else if (predefinedNotes.includes(completedNote)) {
        noteSelect.value = completedNote;
        noteCustom.style.display = "none";
        noteCustom.value = "";
    } else {
        noteSelect.value = "Khác";
        noteCustom.style.display = "block";
        noteCustom.value = completedNote;
    }
    
    const completionFields = document.getElementById("editRuleCompletionFields");
    if (completionFields) completionFields.style.display = rule.is_admin_job ? "block" : "none";

    updateEditRuleState();
    document.getElementById("editRuleModal").style.display = "block";
    toggleBodyScroll(true);
}

function openEditPatternModal(pattern) {
    activeEditingPatternData = pattern;
    document.getElementById("editPatternId").value = pattern.id;
    document.getElementById("editPatternUser").value = pattern.user || "";
    document.getElementById("editPatternDisplayName").value = pattern.displayName || "";
    document.getElementById("editPatternStartDate").value = pattern.patternStartDate || "";
    document.getElementById("editPatternEndDate").value = pattern.patternEndDate || "";
    document.getElementById("editPatternTypeSelect").value = pattern.type || "administrative";
    document.getElementById("editPatternTypeSelect").dispatchEvent(new Event('change'));
    
    document.getElementById("editStartTime").value = pattern.startTime || "";
    document.getElementById("editEndTime").value = pattern.endTime || "";
    document.getElementById("editPatternNotifyTime").value = pattern.notifyTime || "";
    document.getElementById("editShiftGroupName").value = pattern.shiftGroup || "";
    document.getElementById("editAdminShiftGroupName").value = pattern.shiftGroup || "";
    document.getElementById("editPatternNote").value = pattern.note || "";

    document.querySelectorAll("#editDayCheckboxes input").forEach(cb => cb.checked = false);
    if (pattern.type === 'administrative' && Array.isArray(pattern.workDaysOfWeek)) {
        pattern.workDaysOfWeek.forEach(day => {
            const cb = document.querySelector(`#editDayCheckboxes input[value="${day}"]`);
            if (cb) cb.checked = true;
        });
    }
    
    document.getElementById("editPatternModal").style.display = "block";
    toggleBodyScroll(true);
}

function openEditSwapModal(swapData) {
    document.getElementById("editSwapId").value = swapData.id;
    document.getElementById("editSwapDate").value = swapData.date || "";
    document.getElementById("editSwapReason").value = swapData.reason || "";
    populateSwapUsersForDate(swapData.date, "editSwapUser1", "editSwapUser2", swapData.user1, swapData.user2);
    document.getElementById("editSwapModal").style.display = "block";
    toggleBodyScroll(true);
}

function renderUserDatalist() {
    const datalist = document.getElementById("systemUsersList");
    if (datalist) {
        let optionsHtml = "";
        Array.from(allKnownEmails).sort().forEach(email => { 
            optionsHtml += `<option value="${email}">${email}</option>`; 
        });
        datalist.innerHTML = optionsHtml;
    }
}

function updateShiftGroupDatalist(patterns) {
    const datalist = document.getElementById("existingShiftGroups");
    if (!datalist) return;
    const groups = new Set();
    patterns.forEach(p => { if (p.shiftGroup) groups.add(p.shiftGroup); });
    datalist.innerHTML = "";
    groups.forEach(group => {
        const option = document.createElement("option");
        option.value = group;
        datalist.appendChild(option);
    });
    const addSelect = document.getElementById("addCommonJobTargetGroup");
    const editSelect = document.getElementById("editCommonJobTargetGroup");
    if (addSelect && editSelect) {
        const currentAddVal = addSelect.value;
        const currentEditVal = editSelect.value;
        let optionsHtml = '<option value="all">Tất cả nhân viên</option>';
        groups.forEach(g => { optionsHtml += `<option value="${g}">Nhóm: ${g}</option>`; });
        addSelect.innerHTML = optionsHtml;
        editSelect.innerHTML = optionsHtml;
        if (groups.has(currentAddVal) || currentAddVal === 'all') addSelect.value = currentAddVal;
        if (groups.has(currentEditVal) || currentEditVal === 'all') editSelect.value = currentEditVal;
    }
}

function updateJobNameDatalist(rules) {
    const datalist = document.getElementById("existingJobsList");
    if (!datalist) return;
    const jobs = new Set();
    rules.forEach(r => { if (r.job) jobs.add(r.job.trim()); });
    datalist.innerHTML = "";
    jobs.forEach(job => {
        const option = document.createElement("option");
        option.value = job;
        datalist.appendChild(option);
    });
}

function populateSwapUsersForDate(dateStr, select1Id, select2Id, defaultU1 = "", defaultU2 = "") {
    const select1 = document.getElementById(select1Id);
    const select2 = document.getElementById(select2Id);
    if (!dateStr) {
        select1.innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
        select2.innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
        return;
    }
    const d = new Date(dateStr + 'T00:00:00');
    const checkDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const scheduledWorkers = new Set();
    const dayOfWeek = checkDate.getDay() === 0 ? 8 : checkDate.getDay() + 1;
    const adminRules = allWorkPatterns.filter(p => p.type === 'administrative');
    const shiftRules = allWorkPatterns.filter(p => p.type === 'shift_rotation');

    adminRules.forEach(rule => {
        if (isRuleActiveOnDate(rule, checkDate) && Array.isArray(rule.workDaysOfWeek) && rule.workDaysOfWeek.includes(dayOfWeek)) {
            scheduledWorkers.add(rule.displayName);
        }
    });

    if (shiftRules.length > 0) {
        const shiftGroups = {};
        shiftRules.forEach(rule => {
            const group = rule.shiftGroup || "Vận hành";
            if (!shiftGroups[group]) shiftGroups[group] = [];
            shiftGroups[group].push(rule);
        });
        for (const group in shiftGroups) {
            const groupRules = shiftGroups[group];
            const sortedGroupRules = [...groupRules].sort(sortShiftRules);
            const groupRefDate = new Date(sortedGroupRules[0].patternStartDate + 'T00:00:00');
            const membersToday = groupRules.filter(rule => isRuleActiveOnDate(rule, checkDate)).sort(sortShiftRules);
            if (membersToday.length > 0) {
                const n_today = membersToday.length;
                const daysSinceToday = getDaysDifference(checkDate, groupRefDate);
                const workerIndexToday = (daysSinceToday % n_today + n_today) % n_today;
                const workerToday = membersToday[workerIndexToday];
                if (workerToday) scheduledWorkers.add(workerToday.displayName);
            }
        }
    }
    const activeWorkers = new Set();
    allWorkPatterns.forEach(rule => {
        if (rule.displayName && isRuleActiveOnDate(rule, checkDate)) activeWorkers.add(rule.displayName);
    });

    const listA = Array.from(scheduledWorkers).sort();
    const listB = Array.from(activeWorkers).filter(name => !scheduledWorkers.has(name)).sort();

    let optionsA = '<option value="">-- Chọn người xin nghỉ --</option>';
    if (listA.length === 0) optionsA = '<option value="">-- Không có ai trực ngày này --</option>';
    else listA.forEach(u => optionsA += `<option value="${u}">${u}</option>`);
    select1.innerHTML = optionsA;

    let optionsB = '<option value="">-- Chọn người làm thay --</option>';
    if (listB.length === 0) optionsB = '<option value="">-- Không có người rảnh --</option>';
    else listB.forEach(u => optionsB += `<option value="${u}">${u}</option>`);
    select2.innerHTML = optionsB;

    if (defaultU1) select1.value = defaultU1;
    if (defaultU2) select2.value = defaultU2;
}

function setupScheduleEventListeners() {
    // --- Sự kiện Thêm Mới ---
    const saveNewRuleBtn = document.getElementById("saveNewRuleBtn");
    if (saveNewRuleBtn) saveNewRuleBtn.addEventListener("click", async () => {
        const ruleType = document.getElementById("addRuleTypeSelect").value;
        
        if (ruleType === 'job') {
            const editId = document.getElementById("addJobRuleEditId").value;
            const isAdmin = document.getElementById("isAdminJobRuleCheckbox").checked;
            const isCommon = document.getElementById("isCommonJobRuleCheckbox").checked;
            const originalNote = document.getElementById("jobNote").value.trim();
            const jobNameVal = document.getElementById("jobName").value.trim();
            const ruleEndDateVal = document.getElementById("addRuleEndDate").value;
            const exactDateVal = document.getElementById("exactDate").value;
            const dom = document.getElementById("domSelect").value;
            const day = document.getElementById("daySelect").value;
            const week = document.getElementById("weekSelect").value;
            const month = document.getElementById("monthSelect").value;

            if (!jobNameVal) return showSwal("error", "Lỗi", "Vui lòng nhập tên công việc!");
            if (!exactDateVal && !dom && !day && !week && !month) return showSwal("error", "Lỗi", "Vui lòng chọn Ngày cụ thể hoặc định kỳ!");

            let noteStr = originalNote;
            if (isAdmin) noteStr = `[CVAdmin] ${originalNote}`.trim();
            else if (isCommon) noteStr = `[CVChung] ${originalNote}`.trim();

            if (editId) {
                const updateData = {
                    job: jobNameVal, time: document.getElementById("jobTime").value, exactDate: exactDateVal,
                    day, week, month, dom, ruleEndDate: ruleEndDateVal, note: noteStr, 
                    is_admin_job: isAdmin, is_common_job: isCommon, updatedAt: serverTimestamp()
                };
                if (isCommon) {
                    updateData.targetGroup = document.getElementById("addCommonJobTargetGroup").value;
                    updateData.notifyTime = document.getElementById("addCommonJobNotifyTime").value;
                } else {
                    updateData.targetGroup = null; updateData.notifyTime = null;
                }
                try {
                    showLoading("Đang cập nhật...");
                    await updateDoc(doc(db, "work_rules", editId), updateData);
                    hideLoading(); showSwal("success", "Thành công", "Đã cập nhật quy tắc!");
                    closeAddRuleModalFn();
                } catch (e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
                return;
            }

            const jobData = {
                job: jobNameVal, time: document.getElementById("jobTime").value, exactDate: exactDateVal,
                day, week, month, dom, ruleEndDate: ruleEndDateVal, note: noteStr, 
                is_admin_job: isAdmin, is_common_job: isCommon, createdAt: serverTimestamp()
            };
            if (isCommon) {
                jobData.targetGroup = document.getElementById("addCommonJobTargetGroup").value;
                jobData.notifyTime = document.getElementById("addCommonJobNotifyTime").value;
            }
            try {
                showLoading("Đang lưu...");
                await addDoc(collection(db, "work_rules"), jobData);
                addLog("admin_create_work_rule", { email: auth.currentUser?.email || "admin", job: jobNameVal, exactDate: exactDateVal });
                hideLoading(); showSwal("success", "Thành công", "Đã lưu quy tắc!");
                closeAddRuleModalFn();
            } catch (e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
            
        } else if (ruleType === 'pattern') {
            const user = document.getElementById("patternUser").value.trim();
            const displayName = document.getElementById("patternDisplayName").value.trim();
            const patternStartDate = document.getElementById("patternStartDate").value;
            const note = document.getElementById("patternNote").value.trim();
            const type = document.getElementById("patternTypeSelect").value;
            const notifyTime = document.getElementById("patternNotifyTime").value;

            if (!user || !displayName || !patternStartDate) return showSwal("error", "Lỗi", "Vui lòng nhập Nhân viên, Tên hiển thị và Ngày bắt đầu.");

            let data = { user, displayName, patternStartDate, note, type, notifyTime, createdAt: serverTimestamp() };
            
            if (type === 'administrative') {
                const workDaysOfWeek = Array.from(document.querySelectorAll("#dayCheckboxes input:checked")).map(cb => parseInt(cb.value));
                const startTime = document.getElementById("adminStartTime").value;
                const endTime = document.getElementById("adminEndTime").value;
                if (workDaysOfWeek.length === 0) return showSwal("error", "Lỗi", "Vui lòng chọn ít nhất một thứ làm việc.");
                if (!startTime || !endTime) return showSwal("error", "Lỗi", "Vui lòng nhập Giờ bắt đầu và kết thúc.");
                data.workDaysOfWeek = workDaysOfWeek; data.startTime = startTime; data.endTime = endTime;
                let adminShiftGroup = document.getElementById("adminShiftGroupName").value.trim().replace(/\s+/g, ' ');
                data.shiftGroup = adminShiftGroup || "Hành chính";
                
                const [startH, startM] = (data.startTime || "00:00").split(':').map(Number);
                const [endH, endM] = (data.endTime || "00:00").split(':').map(Number);
                data.isNextDay = (endH < startH) || (endH === startH && endM < startM) || (startH === endH && startM === endM && (startH !== 0 || startM !== 0));
            } else {
                const startTime = document.getElementById("shiftStartTime").value;
                const endTime = document.getElementById("shiftEndTime").value;
                let shiftGroup = document.getElementById("shiftGroupName").value.trim().replace(/\s+/g, ' ');
                if (!shiftGroup) shiftGroup = "Vận hành";
                if (!startTime || !endTime) return showSwal("error", "Lỗi", "Vui lòng nhập Giờ bắt đầu và kết thúc ca.");
                data.startTime = startTime; data.endTime = endTime; data.shiftGroup = shiftGroup;
                
                const [startH, startM] = (data.startTime || "00:00").split(':').map(Number);
                const [endH, endM] = (data.endTime || "00:00").split(':').map(Number);
                data.isNextDay = (endH < startH) || (endH === startH && endM < startM) || (startH === endH && startM === endM && (startH !== 0 || startM !== 0));
            }

            try {
                showLoading("Đang lưu...");
                await addDoc(collection(db, "work_patterns"), data);
                addLog("admin_create_work_pattern", { email: auth.currentUser?.email || "admin", user: user, displayName: displayName, type: type });
                hideLoading(); showSwal("success", "Thành công", "Đã lưu quy tắc phân ca!");
                closeAddRuleModalFn();
            } catch (e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
        }
    });

    // --- Sự kiện Lưu as New (Copy) ---
    const saveAsNewRuleBtn = document.getElementById("saveAsNewRuleBtn");
    if (saveAsNewRuleBtn) saveAsNewRuleBtn.addEventListener("click", () => {
        document.getElementById("addJobRuleEditId").value = "";
        document.getElementById("saveNewRuleBtn").click();
    });

    // --- Sự kiện Lưu Edit Pattern ---
    const saveEditPatternBtn = document.getElementById("saveEditPatternBtn");
    if (saveEditPatternBtn) saveEditPatternBtn.addEventListener("click", async () => {
        const id = document.getElementById("editPatternId").value;
        const displayName = document.getElementById("editPatternDisplayName").value.trim();
        const patternStartDate = document.getElementById("editPatternStartDate").value;
        const patternEndDate = document.getElementById("editPatternEndDate").value;
        const type = document.getElementById("editPatternTypeSelect").value;
        const note = document.getElementById("editPatternNote").value.trim();
        const startTime = document.getElementById("editStartTime").value;
        const endTime = document.getElementById("editEndTime").value;
        const notifyTime = document.getElementById("editPatternNotifyTime").value;

        if (!displayName || !patternStartDate || !startTime || !endTime) return showSwal("error", "Lỗi", "Vui lòng nhập đầy đủ thông tin.");

        let updateData = { displayName, patternStartDate, patternEndDate: patternEndDate || null, type, note, startTime, endTime, notifyTime, updatedAt: serverTimestamp() };
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        updateData.isNextDay = (endH < startH) || (endH === startH && endM < startM) || (startH === endH && startM === endM && (startH !== 0 || startM !== 0));

        if (type === 'administrative') {
            const workDaysOfWeek = Array.from(document.querySelectorAll("#editDayCheckboxes input:checked")).map(cb => parseInt(cb.value));
            if (workDaysOfWeek.length === 0) return showSwal("error", "Lỗi", "Vui lòng chọn ít nhất một thứ làm việc.");
            updateData.workDaysOfWeek = workDaysOfWeek;
            let adminShiftGroup = document.getElementById("editAdminShiftGroupName").value.trim().replace(/\s+/g, ' ');
            updateData.shiftGroup = adminShiftGroup || "Hành chính";
        } else {
            let shiftGroup = document.getElementById("editShiftGroupName").value.trim().replace(/\s+/g, ' ');
            updateData.shiftGroup = shiftGroup || "Vận hành";
            updateData.workDaysOfWeek = null;
        }

        try {
            showLoading("Đang lưu...");
            const fieldLabels = {
                displayName: "Tên hiển thị",
                patternStartDate: "Ngày bắt đầu",
                patternEndDate: "Ngày kết thúc",
                type: "Loại lịch",
                note: "Ghi chú",
                startTime: "Giờ bắt đầu ca",
                endTime: "Giờ kết thúc ca",
                notifyTime: "Giờ thông báo",
                workDaysOfWeek: "Ngày làm việc trong tuần",
                shiftGroup: "Nhóm ca trực"
            };
            const changes = {};
            if (activeEditingPatternData) {
                for (const [key, label] of Object.entries(fieldLabels)) {
                    let oldVal = activeEditingPatternData[key];
                    let newVal = updateData[key];
                    
                    const getNormalized = (v) => {
                        if (v === null || v === undefined) return "";
                        if (Array.isArray(v)) return v.map(String).join(",");
                        return String(v).trim();
                    };
                    
                    let cleanOldVal = getNormalized(oldVal);
                    let cleanNewVal = getNormalized(newVal);
                    
                    if (cleanOldVal !== cleanNewVal) {
                        let oldDisp = oldVal;
                        let newDisp = newVal;
                        if (Array.isArray(oldVal)) oldDisp = oldVal.join(", ");
                        if (Array.isArray(newVal)) newDisp = newVal.join(", ");
                        changes[key] = {
                            label: label,
                            old: oldVal === null || oldVal === undefined || oldVal === "" ? "Trống" : oldDisp,
                            new: newVal === null || newVal === undefined || newVal === "" ? "Trống" : newDisp
                        };
                    }
                }
            }
            await updateDoc(doc(db, "work_patterns", id), updateData);
            addLog("admin_update_work_pattern", { email: auth.currentUser?.email || "admin", patternId: id, targetName: displayName, changes: changes });
            hideLoading(); showSwal("success", "Thành công", "Đã cập nhật quy tắc!");
            closeEditPatternModalFn();
        } catch (e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
    });

    // --- Sự kiện Lưu Edit Rule ---
    const saveEditRuleBtn = document.getElementById("saveEditRuleBtn");
    if (saveEditRuleBtn) saveEditRuleBtn.addEventListener("click", async () => {
        const id = document.getElementById("editRuleId").value;
        const job = document.getElementById("editRuleJobName").value.trim();
        const isAdmin = document.getElementById("editRuleIsAdminCheckbox").checked;
        const isCommon = document.getElementById("editRuleIsCommonCheckbox").checked;
        const time = document.getElementById("editRuleTime").value;
        const exactDate = document.getElementById("editRuleExactDate").value;
        const dom = document.getElementById("editRuleDom").value;
        const day = document.getElementById("editRuleDay").value;
        const week = document.getElementById("editRuleWeek").value;
        const month = document.getElementById("editRuleMonth").value;
        const ruleEndDate = document.getElementById("editRuleEndDate").value;
        const rawNote = document.getElementById("editRuleNote").value.trim();
        
        if (!job) return showSwal("error", "Lỗi", "Vui lòng nhập tên công việc!");
        if (!exactDate && !dom && !day && !week && !month) return showSwal("error", "Lỗi", "Vui lòng chọn Ngày cụ thể hoặc định kỳ!");

        let note = rawNote;
        if (isAdmin) note = `[CVAdmin] ${rawNote}`.trim();
        else if (isCommon) note = `[CVChung] ${rawNote}`.trim();

        let completedNote = document.getElementById("editRuleCompletedNoteSelect").value;
        if (completedNote === "Khác") completedNote = document.getElementById("editRuleCompletedNoteCustom").value.trim();
        else if (!completedNote) completedNote = "";

        let lastCompletedDate = document.getElementById("editRuleLastCompletedDate").value;
        let actualCompletedDateInput = document.getElementById("editRuleActualCompletedDate").value;
        let actualCompletedDate = actualCompletedDateInput ? new Date(actualCompletedDateInput).toISOString() : null;
        
        if (completedNote === "") { lastCompletedDate = null; actualCompletedDate = null; }

        const updateData = { job, is_admin_job: isAdmin, is_common_job: isCommon, time, exactDate, dom, day, week, month, ruleEndDate, note, updatedAt: serverTimestamp() };
        
        if (isCommon) {
            updateData.targetGroup = document.getElementById("editCommonJobTargetGroup").value;
            updateData.notifyTime = document.getElementById("editCommonJobNotifyTime").value;
        } else {
            updateData.targetGroup = null; updateData.notifyTime = null;
        }
        if (isAdmin) {
            updateData.lastCompletedDate = lastCompletedDate || null;
            updateData.actualCompletedDate = actualCompletedDate || null;
            updateData.completedNote = completedNote || null;
        }

        try {
            showLoading("Đang lưu...");
            const fieldLabels = {
                job: "Tên công việc",
                time: "Giờ thực hiện",
                exactDate: "Ngày cụ thể",
                dom: "Ngày trong tháng",
                day: "Thứ trong tuần",
                week: "Tuần trong tháng",
                month: "Tháng trong năm",
                ruleEndDate: "Ngày kết thúc",
                note: "Ghi chú",
                is_admin_job: "Việc Admin",
                is_common_job: "Việc chung",
                targetGroup: "Nhóm nhận việc",
                notifyTime: "Giờ thông báo",
                lastCompletedDate: "Ngày hoàn thành cuối",
                actualCompletedDate: "Ngày hoàn thành thực tế",
                completedNote: "Ghi chú hoàn thành"
            };
            const changes = {};
            if (activeEditingRuleData) {
                for (const [key, label] of Object.entries(fieldLabels)) {
                    let oldVal = activeEditingRuleData[key];
                    let newVal = updateData[key];
                    
                    const getNormalized = (v) => {
                        if (v === null || v === undefined) return "";
                        return String(v).trim();
                    };
                    
                    let cleanOldVal = getNormalized(oldVal);
                    let cleanNewVal = getNormalized(newVal);
                    
                    if (key === "note") {
                        cleanOldVal = cleanOldVal.replace("[CVAdmin]", "").replace("[CVChung]", "").trim();
                        cleanNewVal = cleanNewVal.replace("[CVAdmin]", "").replace("[CVChung]", "").trim();
                    }
                    
                    if (cleanOldVal !== cleanNewVal) {
                        let oldDisp = oldVal;
                        let newDisp = newVal;
                        if (key === "note") {
                            oldDisp = cleanOldVal;
                            newDisp = cleanNewVal;
                        }
                        changes[key] = {
                            label: label,
                            old: oldVal === null || oldVal === undefined || oldVal === "" ? "Trống" : oldDisp,
                            new: newVal === null || newVal === undefined || newVal === "" ? "Trống" : newDisp
                        };
                    }
                }
            }
            await updateDoc(doc(db, "work_rules", id), updateData);
            addLog("admin_update_work_rule", { email: auth.currentUser?.email || "admin", ruleId: id, targetName: job, changes: changes });
            hideLoading(); showSwal("success", "Thành công", "Đã cập nhật công việc!");
            closeEditRuleModalFn();
        } catch (e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
    });

    // --- Sự kiện Lưu Hoán đổi ---
    const saveSwapBtn = document.getElementById("saveSwapBtn");
    if (saveSwapBtn) saveSwapBtn.addEventListener("click", async () => {
        const date = document.getElementById("swapDate").value;
        const user1 = document.getElementById("swapUser1").value;
        const user2 = document.getElementById("swapUser2").value;
        const reason = document.getElementById("swapReason").value.trim();
        if (!date || !user1 || !user2) return showSwal("error", "Lỗi", "Vui lòng nhập ngày và chọn nhân viên!");
        if (user1 === user2) return showSwal("error", "Lỗi", "Không thể đổi cho cùng 1 người!");
        try {
            showLoading("Đang lưu...");
            await addDoc(collection(db, "shift_swaps"), { date, user1, user2, reason, createdAt: serverTimestamp(), createdBy: auth.currentUser?.email || "admin" });
            addLog("admin_create_shift_swap", { email: auth.currentUser?.email || "admin", date: date, user1: user1, user2: user2 });
            hideLoading(); showSwal("success", "Thành công", "Đã lưu hoán đổi!");
            closeSwapModalFn();
        } catch(e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
    });

    // --- Sự kiện Lưu Edit Hoán đổi ---
    const saveEditSwapBtn = document.getElementById("saveEditSwapBtn");
    if (saveEditSwapBtn) saveEditSwapBtn.addEventListener("click", async () => {
        const id = document.getElementById("editSwapId").value;
        const date = document.getElementById("editSwapDate").value;
        const user1 = document.getElementById("editSwapUser1").value;
        const user2 = document.getElementById("editSwapUser2").value;
        const reason = document.getElementById("editSwapReason").value.trim();
        if (!date || !user1 || !user2) return showSwal("error", "Lỗi", "Vui lòng nhập ngày và chọn nhân viên!");
        if (user1 === user2) return showSwal("error", "Lỗi", "Không thể đổi cho cùng 1 người!");
        try {
            showLoading("Đang lưu...");
            await updateDoc(doc(db, "shift_swaps", id), { date, user1, user2, reason, updatedAt: serverTimestamp() });
            addLog("admin_update_shift_swap", { email: auth.currentUser?.email || "admin", swapId: id, date: date, user1: user1, user2: user2 });
            hideLoading(); showSwal("success", "Thành công", "Đã cập nhật hoán đổi!");
            closeEditSwapModalFn();
        } catch(e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
    });

    // --- Các sự kiện Xóa ---
    const delBtnAction = async (id, collName, successMsg, closeFn) => {
        if(!id) return;
        if(await showConfirmSwal("Xác nhận Xóa", "Bạn có chắc chắn muốn xóa vĩnh viễn mục này?", "Xóa", "Hủy", "error")) {
            try {
                showLoading("Đang xóa...");
                const docSnap = await getDoc(doc(db, collName, id));
                const data = docSnap.exists() ? docSnap.data() : {};
                await deleteDoc(doc(db, collName, id));
                let logData = { email: auth.currentUser?.email || "admin", deletedId: id };
                if (collName === "work_rules") logData.deletedRule = data;
                else if (collName === "work_patterns") logData.deletedPattern = data;
                else if (collName === "shift_swaps") {
                    logData.date = data.date;
                    logData.user1 = data.user1;
                    logData.user2 = data.user2;
                }
                addLog(`admin_delete_${collName}`, logData);
                hideLoading(); showSwal("success", "Thành công", successMsg);
                closeFn();
            } catch(e) { hideLoading(); showSwal("error", "Lỗi", e.message); }
        }
    };

    const deleteAddRuleBtn = document.getElementById("deleteAddRuleBtn");
    if(deleteAddRuleBtn) deleteAddRuleBtn.addEventListener("click", () => delBtnAction(document.getElementById("addJobRuleEditId").value, "work_rules", "Đã xóa quy tắc", () => document.getElementById("closeAddRuleModal").click()));
    
    const deleteEditRuleBtn = document.getElementById("deleteEditRuleBtn");
    if(deleteEditRuleBtn) deleteEditRuleBtn.addEventListener("click", () => delBtnAction(document.getElementById("editRuleId").value, "work_rules", "Đã xóa quy tắc", () => document.getElementById("closeEditRuleModal").click()));
    
    const deleteEditPatternBtn = document.getElementById("deleteEditPatternBtn");
    if(deleteEditPatternBtn) deleteEditPatternBtn.addEventListener("click", () => delBtnAction(document.getElementById("editPatternId").value, "work_patterns", "Đã xóa lịch làm việc", () => document.getElementById("closeEditPatternModal").click()));
    
    const deleteEditSwapBtn = document.getElementById("deleteEditSwapBtn");
    if(deleteEditSwapBtn) deleteEditSwapBtn.addEventListener("click", () => delBtnAction(document.getElementById("editSwapId").value, "shift_swaps", "Đã xóa hoán đổi", () => document.getElementById("closeEditSwapModal").click()));
}

// ===============================================
// 🔥 QUẢN LÝ HỆ THỐNG (Tab 4)
// ===============================================

let systemUsers = [];
let systemRoles = {};

function setupSystemManagement() {
    listenSystemUsers();
    setupBackupRestore();
    setupResetCache();
    setupAdminDataExplorer();
}

function setupResetCache() {
    const refreshCacheBtn = document.getElementById("refreshCacheBtn");
    if (refreshCacheBtn) {
        refreshCacheBtn.addEventListener('click', async () => {
            const isConfirmed = await showConfirmSwal("Làm mới dữ liệu", "Hành động này sẽ xóa bộ nhớ đệm hiện tại trên thiết bị này và tải lại dữ liệu mới nhất từ máy chủ. Tiếp tục?", "Đồng ý", "Hủy");
            if (isConfirmed) {
                showLoading("Đang làm mới bộ nhớ đệm...");
                const req = indexedDB.open('KCN_LocalDB');
                req.onsuccess = (e) => {
                    const dbLocal = e.target.result;
                    const tx = dbLocal.transaction(['logs', 'sync_info'], 'readwrite');
                    tx.objectStore('logs').clear(); // Xóa sạch log cũ
                    tx.objectStore('sync_info').delete('logs'); // Xóa mốc đồng bộ tiến
                    tx.objectStore('sync_info').delete('logs_oldest'); // Xóa mốc đồng bộ lùi
                    localStorage.removeItem('lastBgSync_logs'); // Mở khóa cho phép tải ngầm chạy lại
                    tx.oncomplete = () => {
                        window.location.reload(); // Tải lại trang
                    };
                };
            }
        });
    }
}

function setupAdminDataExplorer() {
    const fetchBtn = document.getElementById("adminExploreFetchBtn");
    const collectionSelect = document.getElementById("adminExploreCollection");
    const docIdInput = document.getElementById("adminExploreDocId");
    const editorContainer = document.getElementById("adminJsonEditorContainer");
    const jsonTextArea = document.getElementById("adminJsonTextArea");
    const cancelBtn = document.getElementById("adminExploreCancelBtn");
    const saveBtn = document.getElementById("adminExploreSaveBtn");
    const deleteBtn = document.getElementById("adminExploreDeleteBtn");

    if (!fetchBtn) return;

    let activeFetchedData = null; // Lưu dữ liệu cũ phục vụ việc đối chiếu khi xóa trường

    // Gán hàm module để gọi từ các hàm render khác
    triggerAdminExplore = (colName, docId) => {
        // 1. Chuyển tab sang Hệ thống
        const tabBtns = document.querySelectorAll(".settings-tab-btn");
        const tabPanes = document.querySelectorAll(".settings-tab-pane");
        tabBtns.forEach(b => {
            if (b.getAttribute("data-target") === "tab-system") b.classList.add("active");
            else b.classList.remove("active");
        });
        tabPanes.forEach(p => {
            if (p.id === "tab-system") p.classList.add("active");
            else p.classList.remove("active");
        });

        // 2. Điền thông tin truy vấn
        if (collectionSelect) collectionSelect.value = colName;
        if (docIdInput) docIdInput.value = docId;

        // 3. Thực thi lấy dữ liệu
        fetchBtn.click();

        // 4. Cuộn xuống khu vực editor
        const explorerHeading = document.querySelector("#tab-system h3:nth-of-type(3)");
        if (explorerHeading) {
            explorerHeading.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    };

    // Hàm đệ quy chuyển đổi Firestore Timestamp hoặc Date sang ISO string
    function convertTimestampsToISO(obj) {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj.toMillis === "function") {
            return new Date(obj.toMillis()).toISOString();
        }
        if (obj instanceof Date) {
            return obj.toISOString();
        }
        if (Array.isArray(obj)) {
            return obj.map(item => convertTimestampsToISO(item));
        }
        if (typeof obj === "object") {
            const res = {};
            for (const [key, val] of Object.entries(obj)) {
                res[key] = convertTimestampsToISO(val);
            }
            return res;
        }
        return obj;
    }

    // Hàm đệ quy parse chuỗi ISO date thành Date object
    function convertISOToDates(obj) {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) {
            const d = new Date(obj);
            if (!isNaN(d.getTime())) {
                return d;
            }
        }
        if (Array.isArray(obj)) {
            return obj.map(item => convertISOToDates(item));
        }
        if (typeof obj === "object") {
            const res = {};
            for (const [key, val] of Object.entries(obj)) {
                res[key] = convertISOToDates(val);
            }
            return res;
        }
        return obj;
    }

    const handleIdAutoDetect = (val) => {
        const trimmed = val.trim();
        if (trimmed.includes(':')) {
            const parts = trimmed.split(':');
            const colName = parts[0].trim();
            const docId = parts[1].trim();

            const validCollections = ["reports_1", "reports_2", "shift_reports", "logs", "companies_master", "company_configs", "work_rules", "work_patterns", "users"];
            if (validCollections.includes(colName) && docId) {
                if (collectionSelect) collectionSelect.value = colName;
                if (docIdInput) docIdInput.value = docId;

                setTimeout(() => {
                    fetchBtn.click();
                    if (window.Swal) {
                        window.Swal.fire({
                            toast: true,
                            position: 'top-end',
                            icon: 'success',
                            title: `Đã tự động nạp bản ghi từ Clipboard!`,
                            showConfirmButton: false,
                            timer: 2000
                        });
                    }
                }, 50);
                return true;
            }
        }
        return false;
    };

    if (docIdInput) {
        docIdInput.addEventListener("paste", (e) => {
            const pasteText = (e.clipboardData || window.clipboardData).getData('text');
            const detected = handleIdAutoDetect(pasteText);
            if (detected) {
                e.preventDefault();
            }
        });

        docIdInput.addEventListener("input", (e) => {
            handleIdAutoDetect(e.target.value);
        });
    }

    fetchBtn.addEventListener("click", async () => {
        const colName = collectionSelect.value;
        const docId = docIdInput.value.trim();

        if (!docId) {
            showSwal("error", "Lỗi", "Vui lòng nhập ID tài liệu.");
            return;
        }

        showLoading("Đang tải tài liệu...");
        try {
            const docRef = doc(db, colName, docId);
            const snap = await getDoc(docRef);

            if (!snap.exists()) {
                showSwal("error", "Không tìm thấy", `Không tìm thấy tài liệu với ID: ${docId} trong bảng ${colName}.`);
                editorContainer.style.display = "none";
                return;
            }

            const data = snap.data();
            activeFetchedData = data;

            // Chuyển đổi timestamp sang ISO string đệ quy để Admin dễ chỉnh sửa
            const editableData = convertTimestampsToISO(data);
            delete editableData.updatedAt; // Khóa updatedAt không cho chỉnh sửa ở tool

            jsonTextArea.value = JSON.stringify(editableData, null, 2);
            editorContainer.style.display = "flex";
        } catch (err) {
            console.error("Lỗi lấy dữ liệu:", err);
            showSwal("error", "Lỗi", err.message);
        } finally {
            hideLoading();
        }
    });

    cancelBtn.addEventListener("click", () => {
        editorContainer.style.display = "none";
        docIdInput.value = "";
        activeFetchedData = null;
    });

    saveBtn.addEventListener("click", async () => {
        const colName = collectionSelect.value;
        const docId = docIdInput.value.trim();

        let parsedData;
        try {
            parsedData = JSON.parse(jsonTextArea.value);
        } catch (err) {
            showSwal("error", "Lỗi cú pháp JSON", "Dữ liệu nhập vào không hợp lệ. Vui lòng kiểm tra kỹ dấu ngoặc kép, dấu phẩy.");
            return;
        }

        const isConfirmed = await showConfirmSwal(
            "Xác nhận Lưu",
            "Hành động này sẽ thay đổi dữ liệu trực tiếp trên Firestore và tự động đồng bộ xuống các thiết bị khác. Tiếp tục?",
            "Đồng ý lưu", "Hủy bỏ"
        );
        if (!isConfirmed) return;

        showLoading("Đang lưu thay đổi...");
        try {
            // Chuyển đổi các trường ngày tháng ISO sang Date object đệ quy
            const finalData = convertISOToDates(parsedData);

            // Đối chiếu xóa các trường đã bị xóa khỏi JSON
            if (activeFetchedData) {
                for (const key of Object.keys(activeFetchedData)) {
                    if (!(key in parsedData) && key !== 'updatedAt') {
                        finalData[key] = deleteField();
                    }
                }
            }

            finalData.updatedAt = serverTimestamp();
            finalData.adminEdited = true;
            finalData.updatedBy = auth.currentUser?.email || "admin";

            const docRef = doc(db, colName, docId);
            await setDoc(docRef, finalData, { merge: true });

            // Ghi nhật ký hệ thống
            await addLog("admin_manual_edit", {
                email: auth.currentUser?.email,
                collection: colName,
                docId: docId,
                changes: parsedData
            });

            showSwal("success", "Đã lưu", "Tài liệu đã được cập nhật thành công!");
            editorContainer.style.display = "none";
            docIdInput.value = "";
            activeFetchedData = null;
        } catch (err) {
            console.error("Lỗi khi lưu:", err);
            showSwal("error", "Lỗi", err.message);
        } finally {
            hideLoading();
        }
    });

    deleteBtn.addEventListener("click", async () => {
        const colName = collectionSelect.value;
        const docId = docIdInput.value.trim();

        if (!activeFetchedData) return;

        const isConfirmed = await showConfirmSwal(
            "Xác nhận Xóa vĩnh viễn",
            `<span style="color:red; font-weight:bold;">CẢNH BÁO:</span> Hành động này sẽ xóa vĩnh viễn tài liệu này khỏi Firestore và đồng bộ xóa sạch cache trên tất cả thiết bị. Bạn có chắc chắn không?`,
            "Có, xóa vĩnh viễn", "Hủy bỏ", "error"
        );
        if (!isConfirmed) return;

        showLoading("Đang thực hiện xóa tài liệu...");
        try {
            const docRef = doc(db, colName, docId);
            const batchInstance = writeBatch(db);

            // 1. Xóa tài liệu chính
            batchInstance.delete(docRef);

            // 2. Ghi bia mộ (tombstone) để kích hoạt đồng bộ xóa ở các thiết bị khác
            batchInstance.set(doc(collection(db, "sync_deletes")), {
                docId: docId,
                collectionName: colName,
                deletedAt: serverTimestamp()
            });

            await batchInstance.commit();

            // 3. Ghi log lưu trữ toàn bộ dữ liệu trước khi xóa
            await addLog("admin_manual_delete", {
                email: auth.currentUser?.email,
                collection: colName,
                docId: docId,
                deletedData: activeFetchedData
            });

            showSwal("success", "Đã xóa", "Tài liệu đã được xóa vĩnh viễn thành công!");
            editorContainer.style.display = "none";
            docIdInput.value = "";
            activeFetchedData = null;
        } catch (err) {
            console.error("Lỗi khi xóa tài liệu:", err);
            showSwal("error", "Lỗi", err.message);
        } finally {
            hideLoading();
        }
    });

    // Tự động kích hoạt từ URL params (Ví dụ khi chuyển hướng từ trang datatable)
    const urlParams = new URLSearchParams(window.location.search);
    const urlCol = urlParams.get('col');
    const urlId = urlParams.get('id');
    if (urlCol && urlId) {
        setTimeout(() => {
            if (typeof triggerAdminExplore === "function") {
                triggerAdminExplore(urlCol, urlId);
            }
        }, 500);
    }
}

function listenSystemUsers() {
    onSnapshot(collection(db, "users"), (snap) => {
        systemUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderUsersTable();
    });

    onSnapshot(collection(db, "roles"), (snap) => {
        const roles = {};
        snap.docs.forEach(d => { roles[d.id] = d.data().role; });
        systemRoles = roles;
        renderUsersTable();
    });
}

function renderUsersTable() {
    const tbody = document.getElementById("usersTableBody");
    if (!tbody) return;

    const usersList = typeof systemUsers !== 'undefined' ? systemUsers : [];
    const rolesMap = typeof systemRoles !== 'undefined' ? systemRoles : {};

    // Gộp danh sách người dùng từ cả users (đã đăng nhập) và roles (được phân quyền)
    const userMap = new Map();
    
    // 1. Nạp từ users list (những người đã từng đăng nhập)
    usersList.forEach(u => {
        const email = (u.email || u.id || "").toLowerCase().trim();
        if (email) {
            userMap.set(email, {
                email: email,
                lastActiveAt: u.lastActiveAt || null,
                ...u
            });
        }
    });

    // 2. Nạp từ roles map (để bao quát những người đã được phân quyền nhưng chưa đăng nhập)
    Object.keys(rolesMap).forEach(emailKey => {
        const email = emailKey.toLowerCase().trim();
        if (email && !userMap.has(email)) {
            userMap.set(email, {
                email: email,
                lastActiveAt: null
            });
        }
    });

    const mergedUsers = Array.from(userMap.values());

    if (mergedUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 15px; color: #666;">Không có dữ liệu người dùng.</td></tr>';
        return;
    }

    const sortedUsers = mergedUsers.sort((a, b) => a.email.localeCompare(b.email));

    tbody.innerHTML = sortedUsers.map(u => {
        const email = u.email;
        const role = rolesMap[email] || "user";
        const lastActive = u.lastActiveAt?.toDate ? u.lastActiveAt.toDate().toLocaleString('vi-VN') : "-";
        
        // Trích xuất thông tin thiết bị tin cậy dạng nhãn thân thiện
        const trustedPCs = Array.isArray(u.trustedPCs) ? u.trustedPCs : [];
        if (u.trustedPC && !trustedPCs.includes(u.trustedPC)) {
            trustedPCs.push(u.trustedPC);
        }
        const trustedMobiles = Array.isArray(u.trustedMobiles) ? u.trustedMobiles : [];
        if (u.trustedMobile && !trustedMobiles.includes(u.trustedMobile)) {
            trustedMobiles.push(u.trustedMobile);
        }
        
        const labelsMap = u.deviceLabels || {};
        const pcLabels = trustedPCs.map(id => labelsMap[id] || "Máy tính").join(", ");
        const mobileLabels = trustedMobiles.map(id => labelsMap[id] || "Điện thoại").join(", ");
        
        let devicesDisplay = "-";
        if (pcLabels && mobileLabels) {
            devicesDisplay = `🖥️ ${pcLabels} <br/> 📱 ${mobileLabels}`;
        } else if (pcLabels) {
            devicesDisplay = `🖥️ ${pcLabels}`;
        } else if (mobileLabels) {
            devicesDisplay = `📱 ${mobileLabels}`;
        }

        const roleDisplay = role === "admin" ? `<span style="color: #e74c3c; font-weight: bold;">Admin</span>` : `<span style="color: #273668;">User</span>`;
        const actionBtn = role === "admin" 
            ? `<button class="change-role-btn" data-email="${email}" data-newrole="user" style="background:#f39c12; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size: 12px;">Hạ quyền User</button>`
            : `<button class="change-role-btn" data-email="${email}" data-newrole="admin" style="background:#2ecc71; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size: 12px;">Cấp quyền Admin</button>`;

        const forceLogoutBtn = `<button class="force-logout-btn" data-email="${email}" style="background:#e74c3c; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size: 12px;">Đăng xuất</button>`;

        return `<tr>
            <td>${email}</td>
            <td>${lastActive}</td>
            <td style="font-size: 12px; color: #475569; line-height: 1.4; text-align: left; padding: 6px 8px;">${devicesDisplay}</td>
            <td>${roleDisplay}</td>
            <td><div style="display:flex; gap:4px; flex-wrap: wrap; justify-content: center;">${actionBtn}${forceLogoutBtn}</div></td>
        </tr>`;
    }).join("");

    // Gắn sự kiện sao chép ID tài liệu bằng chuột phải hoặc nhấn giữ cho Admin (email của user chính là ID của tài liệu)
    tbody.querySelectorAll("tr").forEach((tr, index) => {
        const u = sortedUsers[index];
        if (u) {
            const email = u.email;
            tr.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                copyDocIdToClipboard('users', email);
            });

            let pressTimer;
            tr.addEventListener('touchstart', () => {
                pressTimer = window.setTimeout(() => {
                    copyDocIdToClipboard('users', email);
                }, 800);
            }, { passive: true });
            tr.addEventListener('touchend', () => clearTimeout(pressTimer));
            tr.addEventListener('touchmove', () => clearTimeout(pressTimer));
        }
    });

    document.querySelectorAll(".change-role-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const email = e.target.dataset.email;
            const newRole = e.target.dataset.newrole;
            
            if (email === auth.currentUser?.email && newRole === "user") {
                return showSwal("error", "Từ chối thao tác", "Để đảm bảo an toàn, bạn không thể tự hạ quyền Admin của chính mình!");
            }
            
            const isConfirmed = await showConfirmSwal("Xác nhận đổi quyền", `Bạn muốn đổi quyền của <b>${email}</b> thành <b>${newRole.toUpperCase()}</b>?`, "Đồng ý", "Hủy", "warning");
            if (isConfirmed) {
                const isVerified = await promptForReAuth();
                if (!isVerified) return;
                
                try {
                    showLoading("Đang cập nhật...");
                    await setDoc(doc(db, "roles", email), { role: newRole }, { merge: true });
                    addLog("user_role_update", { targetUser: email, newRole: newRole, email: auth.currentUser?.email });
                    hideLoading();
                    showSwal("success", "Thành công", `Đã cập nhật quyền cho ${email}`);
                } catch (err) {
                    hideLoading();
                    showSwal("error", "Lỗi", err.message);
                }
            }
        });
    });

    document.querySelectorAll(".force-logout-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const email = e.target.dataset.email.toLowerCase(); // Ép về chữ thường để đảm bảo ID chính xác
            
            if (email === auth.currentUser?.email?.toLowerCase()) {
                return showSwal("error", "Từ chối thao tác", "Bạn không thể ép chính mình đăng xuất từ đây!");
            }
            
            const isConfirmed = await showConfirmSwal("Đăng xuất", `Bạn có chắc chắn muốn <b>${email}</b> đăng xuất ngay lập tức không?`, "Đăng xuất", "Hủy", "warning");
            if (isConfirmed) {
                const isVerified = await promptForReAuth();
                if (!isVerified) return;
                
                try {
                    showLoading("Đang xử lý...");
                    await setDoc(doc(db, "users", email), { forceLogoutAt: serverTimestamp() }, { merge: true });
                    addLog("force_logout_requested", { targetUser: email, email: auth.currentUser?.email });
                    hideLoading();
                    showSwal("success", "Thành công", `Đã gửi lệnh đăng xuất đến ${email}`);
                } catch (err) {
                    hideLoading();
                    showSwal("error", "Lỗi", err.message);
                }
            }
        });
    });
}

function setupBackupRestore() {
    const btnBackup = document.getElementById("btnBackupData");
    const restoreInput = document.getElementById("restoreFileInput");

    if (btnBackup) {
        btnBackup.addEventListener("click", async () => {
            try {
                showLoading("Đang thu thập dữ liệu sao lưu...");
                const backupData = {};
                const collectionsToBackup = ["work_rules", "work_patterns", "company_configs", "companies_master", "report_shifts"];
                for (const colName of collectionsToBackup) {
                    const snap = await getDocs(collection(db, colName));
                    backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                }

                const conf1 = await getDoc(doc(db, "config", "reportConfig"));
                if (conf1.exists()) backupData["config_reportConfig"] = conf1.data();
                
                const conf2 = await getDoc(doc(db, "settings", "reportConfig"));
                if (conf2.exists()) backupData["settings_reportConfig"] = conf2.data();

                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", `KCN_Backup_${formatISODate(new Date())}.json`);
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();

                addLog("backup_created", { email: auth.currentUser?.email });
                hideLoading();
                showSwal("success", "Thành công", "Đã tải xuống bản sao lưu.");
            } catch (err) {
                hideLoading();
                showSwal("error", "Lỗi sao lưu", err.message);
            }
        });
    }

    if (restoreInput) {
        restoreInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const isConfirmed = await showConfirmSwal(
                "⚠️ Cảnh báo Khôi phục", 
                "Quá trình này sẽ <b>GHI ĐÈ</b> toàn bộ quy tắc công việc, lịch làm việc và cấu hình công ty hiện tại bằng dữ liệu từ file sao lưu.<br><br>Bạn có chắc chắn muốn tiếp tục?", 
                "Có, Khôi phục", "Hủy bỏ", "error"
            );

            if (!isConfirmed) {
                restoreInput.value = "";
                return;
            }

            const isVerified = await promptForReAuth();
            if (!isVerified) {
                restoreInput.value = "";
                return;
            }

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    showLoading("Đang khôi phục dữ liệu...");
                    const data = JSON.parse(event.target.result);

                    const collectionsToRestore = ["work_rules", "work_patterns", "company_configs", "companies_master", "report_shifts"];
                    for (const colName of collectionsToRestore) {
                        if (data[colName]) {
                            const existingDocs = await getDocs(collection(db, colName));
                            for (const d of existingDocs.docs) {
                                await deleteDoc(doc(db, colName, d.id));
                            }
                            for (const item of data[colName]) {
                                const { id, ...docData } = item;
                                if (docData.createdAt && docData.createdAt.seconds) docData.createdAt = new Date(docData.createdAt.seconds * 1000);
                                if (docData.updatedAt && docData.updatedAt.seconds) docData.updatedAt = new Date(docData.updatedAt.seconds * 1000);
                                
                                if (id) await setDoc(doc(db, colName, id), docData);
                                else await addDoc(collection(db, colName), docData);
                            }
                        }
                    }

                    if (data["config_reportConfig"]) await setDoc(doc(db, "config", "reportConfig"), data["config_reportConfig"]);
                    if (data["settings_reportConfig"]) await setDoc(doc(db, "settings", "reportConfig"), data["settings_reportConfig"]);

                    addLog("restore_completed", { email: auth.currentUser?.email });
                    hideLoading();
                    showSwal("success", "Thành công", "Đã khôi phục dữ liệu hệ thống.");
                    restoreInput.value = "";
                } catch (err) {
                    hideLoading();
                    showSwal("error", "Lỗi khôi phục", err.message);
                    restoreInput.value = "";
                }
            };
            reader.readAsText(file);
        });
    }
}