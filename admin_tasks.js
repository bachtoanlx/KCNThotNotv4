
import { auth, db, onAuth, getRole, addLog, showSwal, showLoading, hideLoading, getCurrentUserEmail } from "./script.js";
import { collection, updateDoc, doc, onSnapshot, query, where, addDoc, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initMenu } from "./menu.js";
import { getLastMatchDate, getNextMatchDate, ruleMatchesDate } from "./autoplan-core.js";

// === Load menu, modal và footer===
fetch("menu.html").then(r => r.text()).then(h => {
    document.getElementById("menu-placeholder").innerHTML = h;
    initMenu();
});
fetch("modal.html").then(r => r.text()).then(h => document.getElementById("loading-placeholder").innerHTML = h);
fetch("footer.html").then(r => r.text()).then(h => document.getElementById("footer-placeholder").innerHTML = h);

const notLogged = document.getElementById("notLogged");
const noPermission = document.getElementById("noPermission");
const pageContent = document.getElementById("pageContent");
const adminTaskListBody = document.getElementById("adminTaskListBody");

// DOM Elements cho Filter
const filterFromDateInput = document.getElementById("filterFromDate");
const filterToDateInput = document.getElementById("filterToDate");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const adminTaskSearchInput = document.getElementById("adminTaskSearchInput");
const quickFilterSelect = document.getElementById("quickFilterSelect");

let allAdminRulesData = [];
let currentFilter = { from: null, to: null };
let currentSearchQuery = "";
let activeEditingRuleData = null;

function getRuleChanges(oldData, newData) {
    const fieldLabels = {
        job: "Tên công việc",
        time: "Giờ thực hiện",
        exactDate: "Ngày cụ thể",
        dom: "Ngày trong tháng",
        day: "Thứ trong tuần",
        week: "Tuần trong tháng",
        month: "Tháng trong năm",
        ruleEndDate: "Ngày kết thúc",
        note: "Ghi chú"
    };
    const changes = {};
    if (oldData) {
        for (const [key, label] of Object.entries(fieldLabels)) {
            let oldVal = oldData[key];
            let newVal = newData[key];
            
            // Nếu newVal không được định nghĩa trong newData (không có trong form cập nhật), ta bỏ qua
            if (newVal === undefined) continue;
            
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
    return changes;
}

onAuth(async (user) => {
    if (!user) {
        notLogged.style.display = "flex";
        pageContent.style.display = "none";
        noPermission.style.display = "none";
        return;
    }

    const role = await getRole(user.email);
    if (role !== "admin") {
        notLogged.style.display = "none";
        pageContent.style.display = "none";
        noPermission.style.display = "block";
        return;
    }

    // Khởi tạo thời gian mặc định: Tháng này
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fromStr = `${firstDayOfMonth.getFullYear()}-${String(firstDayOfMonth.getMonth() + 1).padStart(2, '0')}-${String(firstDayOfMonth.getDate()).padStart(2, '0')}`;
    const toStr = `${lastDayOfMonth.getFullYear()}-${String(lastDayOfMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDayOfMonth.getDate()).padStart(2, '0')}`;
    currentFilter = { from: fromStr, to: toStr };
    if (filterFromDateInput) filterFromDateInput.value = fromStr;
    if (filterToDateInput) filterToDateInput.value = toStr;

    notLogged.style.display = "none";
    noPermission.style.display = "none";
    pageContent.style.display = "block";
    setupAdminTasksListener();
});

function setupAdminTasksListener() {
    showLoading("Đang tải dữ liệu công việc...");
    // Truy vấn được tối ưu, chỉ tải các rule là CV Admin
    const qRules = query(collection(db, "work_rules"), where("is_admin_job", "==", true));
    
    onSnapshot(qRules, (snapshot) => {
        allAdminRulesData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        updateAdminJobNameDatalist(allAdminRulesData);
        renderAdminTaskList(allAdminRulesData);
        hideLoading();
    }, (error) => {
        console.error("Lỗi lắng nghe admin tasks:", error);
        hideLoading();
        showSwal("error", "Lỗi tải dữ liệu", error.message);
    });
}

// Xử lý Bộ lọc
if (applyFilterBtn) {
    applyFilterBtn.addEventListener("click", () => {
        const fromVal = filterFromDateInput.value;
        const toVal = filterToDateInput.value;
        if (fromVal && toVal) {
            if (fromVal > toVal) return showSwal("warning", "Ngày bắt đầu phải nhỏ hơn ngày kết thúc!");
            currentFilter = { from: fromVal, to: toVal };
            renderAdminTaskList(allAdminRulesData);
        } else {
            showSwal("info", "Vui lòng chọn đầy đủ Từ ngày và Đến ngày");
        }
    });
}

// Xử lý Chọn nhanh
function setQuickFilterDates(value) {
    const now = new Date();
    let fromDate, toDate;
    
    if (value === "month") {
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (value === "quarter") {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        fromDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
        toDate = new Date(now.getFullYear(), currentQuarter * 3 + 3, 0);
    } else if (value === "year") {
        fromDate = new Date(now.getFullYear(), 0, 1);
        toDate = new Date(now.getFullYear(), 11, 31);
    } else {
        return;
    }
    
    if (filterFromDateInput) {
        filterFromDateInput.value = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;
    }
    if (filterToDateInput) {
        filterToDateInput.value = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`;
    }
}

if (quickFilterSelect) {
    quickFilterSelect.addEventListener("change", (e) => {
        if (e.target.value !== "custom") {
            setQuickFilterDates(e.target.value);
            if (applyFilterBtn) applyFilterBtn.click();
        }
    });
}

function resetQuickFilterSelect() {
    if (quickFilterSelect && quickFilterSelect.value !== "custom") {
        quickFilterSelect.value = "custom";
    }
}

if (filterFromDateInput) filterFromDateInput.addEventListener("change", resetQuickFilterSelect);
if (filterToDateInput) filterToDateInput.addEventListener("change", resetQuickFilterSelect);

// Lắng nghe tìm kiếm nhanh
if (adminTaskSearchInput) {
    adminTaskSearchInput.addEventListener("input", (e) => {
        currentSearchQuery = e.target.value.toLowerCase().trim();
        
        // --- UX: Làm mờ và vô hiệu hóa bộ lọc thời gian khi đang tìm kiếm ---
        const isSearching = currentSearchQuery.length > 0;
        const filterElements = [filterFromDateInput, filterToDateInput, quickFilterSelect, applyFilterBtn];
        
        filterElements.forEach(el => {
            if (el) {
                el.disabled = isSearching;
                el.style.opacity = isSearching ? "0.4" : "1";
                el.style.cursor = isSearching ? "not-allowed" : "";
            }
        });

        renderAdminTaskList(allAdminRulesData);
    });
}

// Cập nhật danh sách gợi ý Công việc Admin
function updateAdminJobNameDatalist(rules) {
    const datalist = document.getElementById("existingAdminJobsList");
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

function renderAdminTaskList(rulesToRender) {
    if (!adminTaskListBody) return;
    
    // --- BẢO TOÀN VỊ TRÍ CUỘN TRANG & BẢNG ---
    const scrollContainer = document.querySelector(".table-responsive-wrapper");
    const tableScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const pageContentEl = document.getElementById("pageContent");
    const pageScrollTop = pageContentEl ? pageContentEl.scrollTop : 0;
    const windowScrollTop = window.scrollY || document.documentElement.scrollTop;
    
    if (scrollContainer) {
        scrollContainer.style.minHeight = scrollContainer.scrollHeight + "px";
    }
    if (pageContentEl) {
        pageContentEl.style.minHeight = pageContentEl.scrollHeight + "px";
    }

    adminTaskListBody.innerHTML = "";
    
    if (rulesToRender.length === 0) {
        adminTaskListBody.innerHTML = `<tr><td colspan="5" style="padding: 20px; color: #888; font-style: italic; text-align: center;">Không có công việc Admin nào.</td></tr>`;
        if (scrollContainer) { scrollContainer.style.minHeight = ""; scrollContainer.scrollTop = tableScrollTop; }
        if (pageContentEl) { pageContentEl.style.minHeight = ""; if (pageScrollTop > 0) pageContentEl.scrollTop = pageScrollTop; }
        if (windowScrollTop > 0) window.scrollTo(0, windowScrollTop);
        return;
    }
    
    let taskList = [];
    rulesToRender.forEach(d => {
        const noteDisplay = (d.note || "").replace("[CVAdmin]", "").trim();
        
        const currentNow = new Date();
        const [h, m] = (d.time || "23:59").split(':').map(Number);
        const todayMidnight = new Date(currentNow); 
        todayMidnight.setHours(0, 0, 0, 0);

        const createTaskRow = (targetDate, isFuture) => {
            if (!targetDate) return null;
            
            const matchDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`;
            let statusText = "Chưa xác định"; let statusColor = "#333"; let doneBtnHtml = "";
            let category = 5; let diffDays = 999; let actualCompletedStr = "-"; let isCompleted = false;
            let daysOverdue = 0;
            
            const currentHistory = (d.progressHistory && d.progressHistory[matchDateStr]) ? [...d.progressHistory[matchDateStr]].sort((a, b) => new Date(a.time) - new Date(b.time)) : [];
            
            // Ưu tiên kiểm tra trạng thái hoàn thành từ lịch sử (Hỗ trợ tra cứu quá khứ tốt hơn)
            if (currentHistory.length > 0) {
                const lastUpdate = currentHistory[currentHistory.length - 1];
                if (lastUpdate.status === 'Hoàn thành') {
                    isCompleted = true;
                    const acDate = new Date(lastUpdate.time);
                    actualCompletedStr = `${String(acDate.getDate()).padStart(2,'0')}/${String(acDate.getMonth() + 1).padStart(2,'0')}/${acDate.getFullYear()} ${String(acDate.getHours()).padStart(2,'0')}:${String(acDate.getMinutes()).padStart(2,'0')}`;
                }
            }
            
            // Fallback: Kiểm tra lastCompletedDate cũ
            if (!isCompleted && d.lastCompletedDate === matchDateStr) {
                isCompleted = true;
                if (d.actualCompletedDate) {
                    const acDate = new Date(d.actualCompletedDate);
                    actualCompletedStr = `${String(acDate.getDate()).padStart(2,'0')}/${String(acDate.getMonth() + 1).padStart(2,'0')}/${acDate.getFullYear()} ${String(acDate.getHours()).padStart(2,'0')}:${String(acDate.getMinutes()).padStart(2,'0')}`;
                }
            }
            
            const dueDateTime = new Date(targetDate); dueDateTime.setHours(h, m, 0, 0);
            const dueMidnight = new Date(targetDate); dueMidnight.setHours(0, 0, 0, 0);

            const isInProgress = !isCompleted && currentHistory.length > 0;
            
            if (isCompleted) {
                category = 3; statusText = '✅ Đã hoàn thành'; statusColor = '#2ecc71';
                doneBtnHtml = `<button class="doneAdminTaskBtn" data-id="${d.id}" data-date="${matchDateStr}" style="background:#95a5a6; color:white; border:none; padding: 6px 12px; border-radius:4px; cursor:pointer;"><span class="desktop-only">🔍 </span>Lịch sử</button>`;
            } else {
                if (!isFuture) {
                    if (currentNow > dueDateTime) {
                        category = 2; // Quá hạn
                        daysOverdue = Math.floor((todayMidnight - dueMidnight) / (1000 * 60 * 60 * 24));
                        statusText = daysOverdue > 0 ? (isInProgress ? `🏃 Đang làm (Quá hạn ${daysOverdue} ngày)` : `⚠️ Quá hạn (${daysOverdue} ngày)`) : (isInProgress ? '🏃 Đang làm (Quá hạn)' : '⚠️ Quá hạn');
                        statusColor = isInProgress ? '#d35400' : '#e74c3c';
                    } else {
                        category = 1; // Hôm nay
                        statusText = isInProgress ? '🏃 Đang làm (Hạn hôm nay)' : '⏳ Đến hạn hôm nay';
                        statusColor = isInProgress ? '#2980b9' : '#f39c12';
                        diffDays = 0;
                    }
                } else {
                    const daysUntil = Math.ceil((dueMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
                    diffDays = daysUntil;
                    if (daysUntil <= 7) {
                        category = 1; // Sắp đến
                        statusText = isInProgress ? `🏃 Đang làm (Còn ${daysUntil} ngày)` : `🔔 Sắp đến hạn (${daysUntil} ngày)`;
                        statusColor = isInProgress ? '#2980b9' : '#3498db';
                    } else {
                        category = 4; // Tương lai xa
                        statusText = isInProgress ? `🏃 Đang làm (${daysUntil} ngày)` : `Chưa đến hạn (${daysUntil} ngày)`;
                        statusColor = isInProgress ? '#2980b9' : '#7f8c8d';
                    }
                }
                doneBtnHtml = `<button class="doneAdminTaskBtn" data-id="${d.id}" data-date="${matchDateStr}" style="background:#2980b9; color:white; border:none; padding: 6px 12px; border-radius:4px; cursor:pointer;"><span class="desktop-only">📝 </span>Cập nhật</button>`;
            }
            
            return {
                id: d.id, job: d.job, time: d.time || "23:59", noteDisplay: noteDisplay, category: category, targetDate: targetDate, diffDays: diffDays, matchDateStr: matchDateStr, statusText: statusText, statusColor: statusColor, doneBtnHtml: doneBtnHtml, currentHistory: currentHistory, actualCompletedStr: actualCompletedStr, actualCompletedDate: isCompleted && d.actualCompletedDate ? new Date(d.actualCompletedDate) : new Date(0), completedNote: isCompleted ? (d.completedNote || "") : "", isInProgress: isInProgress, daysOverdue: daysOverdue
            };
        };

        // --- LOGIC: Sử dụng bộ lọc thời gian nếu KHÔNG có từ khóa tìm kiếm ---
        if (currentFilter.from && currentFilter.to && !currentSearchQuery) {
            // MỞ RỘNG: Chế độ Lọc theo khoảng ngày (Tháng, Quý, Năm...)
            const startDate = new Date(currentFilter.from + "T00:00:00");
            const endDate = new Date(currentFilter.to + "T00:00:00");
            
            for (let curr = new Date(startDate); curr <= endDate; curr.setDate(curr.getDate() + 1)) {
                if (ruleMatchesDate(d, curr)) {
                    const currMidnight = new Date(curr);
                    currMidnight.setHours(0,0,0,0);
                    const isFuture = currMidnight > todayMidnight;
                    const task = createTaskRow(new Date(curr), isFuture);
                    if (task) {
                        taskList.push(task);
                    }
                }
            }
        } else {
            // MẶC ĐỊNH: Khi tìm kiếm, duyệt qua các kỳ để gom hết việc chưa hoàn thành trong 365 ngày qua
            const nextMatchDate = getNextMatchDate(d);
            const futureTask = createTaskRow(nextMatchDate, true);
            if (futureTask) {
                taskList.push(futureTask);
            }

            const today = new Date();
            let foundFirstPast = false;
            for (let i = 0; i < 365; i++) {
                const curr = new Date(today);
                curr.setDate(today.getDate() - i);
                if (ruleMatchesDate(d, curr)) {
                    const pastTask = createTaskRow(curr, false);
                    if (pastTask) {
                        const isCompleted = pastTask.category === 3;
                        if (!isCompleted) {
                            // Việc quá hạn chưa làm -> luôn đưa vào để tìm kiếm
                            taskList.push(pastTask);
                        } else if (!foundFirstPast) {
                            // Việc đã hoàn thành -> chỉ lấy kỳ gần nhất để tránh trùng lặp
                            taskList.push(pastTask);
                            foundFirstPast = true;
                        }
                    }
                }
            }
        }
    });

    // Bộ lọc tìm kiếm Text
    if (currentSearchQuery) {
        taskList = taskList.filter(task => {
            const searchString = [
                task.job,
                task.noteDisplay,
                task.statusText,
                task.completedNote,
                task.actualCompletedStr,
                task.targetDate ? `${String(task.targetDate.getDate()).padStart(2,'0')}/${String(task.targetDate.getMonth() + 1).padStart(2,'0')}/${task.targetDate.getFullYear()}` : "",
                (task.currentHistory && task.currentHistory.length > 0) ? task.currentHistory[task.currentHistory.length - 1].note : ""
            ].map(f => f ? f.toString().toLowerCase() : "").join(" ");
            
            return searchString.includes(currentSearchQuery);
        });
    }

    if (taskList.length === 0) {
        adminTaskListBody.innerHTML = `<tr><td colspan="5" style="padding: 20px; color: #888; font-style: italic; text-align: center;">Không tìm thấy công việc nào phù hợp với tìm kiếm.</td></tr>`;
        if (scrollContainer) { scrollContainer.style.minHeight = ""; scrollContainer.scrollTop = tableScrollTop; }
        if (pageContentEl) { pageContentEl.style.minHeight = ""; if (pageScrollTop > 0) pageContentEl.scrollTop = pageScrollTop; }
        if (windowScrollTop > 0) window.scrollTo(0, windowScrollTop);
        return;
    }

    const activeTasks = [];
    const overdue45Tasks = [];
    const completedTasks = [];

    taskList.forEach(task => {
        if (task.category === 3) {
            completedTasks.push(task);
        } else if (task.category === 2 && task.daysOverdue > 45 && !task.isInProgress) {
            overdue45Tasks.push(task);
        } else {
            activeTasks.push(task);
        }
    });

    activeTasks.sort((a, b) => {
        if (a.category !== b.category) return a.category - b.category;
        if (a.category === 1) return a.diffDays - b.diffDays;
        if (a.category === 2) return (a.targetDate || 0) - (b.targetDate || 0);
        return (a.targetDate || 0) - (b.targetDate || 0);
    });

    overdue45Tasks.sort((a, b) => (a.targetDate || 0) - (b.targetDate || 0));
    completedTasks.sort((a, b) => (b.actualCompletedDate || 0) - (a.actualCompletedDate || 0));

    const renderRow = (task, isChild, parentId, forceShow = false) => {
        const tr = document.createElement("tr");
        
        if (isChild) {
            tr.classList.add("rule-child-row");
            tr.dataset.parent = parentId;
            tr.style.display = forceShow ? "table-row" : "none";
        }
        
        if (task.category === 1) tr.style.backgroundColor = "#ebf5fb";
        else if (task.category === 2) tr.style.backgroundColor = "#fdedec";

        const displayDate = task.targetDate ? `${String(task.targetDate.getDate()).padStart(2,'0')}/${String(task.targetDate.getMonth() + 1).padStart(2,'0')}/${task.targetDate.getFullYear()}` : "-";

        let statusHtml = `<span style="color: ${task.statusColor}; font-weight:bold;">${task.statusText}</span>`;
        if (task.completedNote && task.category === 3) {
            statusHtml += `<br><span style="font-size: 0.85em; color: #555; font-style: italic;">↳ ${task.completedNote}</span>`;
        } else if (task.currentHistory && task.currentHistory.length > 0 && task.category !== 3) {
            const lastUpdate = task.currentHistory[task.currentHistory.length - 1];
            statusHtml += `<br><span style="font-size: 0.85em; color: #2980b9; font-style: italic;">↳ Tiến độ: ${lastUpdate.note}</span>`;
        }

        let actualDateHtml = task.actualCompletedStr;
        if (task.category === 3 && task.actualCompletedStr !== "-") actualDateHtml = `<span style="color:#16a085; font-weight:bold;">${task.actualCompletedStr}</span>`;

        tr.innerHTML = `
            <td style="text-align:left;"><b>${task.job}</b>${task.noteDisplay ? `<br><span style="font-size: 0.85em; color: #7f8c8d;">${task.noteDisplay}</span>` : ""}</td>
            <td style="text-align: center;">${displayDate} ${task.time}</td>
            <td style="text-align: center;">${actualDateHtml}</td>
            <td style="text-align: center;">${statusHtml}</td>
            <td style="text-align: center;">
                <div style="display: flex; gap: 5px; justify-content: center;">
                    ${task.doneBtnHtml}
                    <button class="editAdminTaskBtn" data-id="${task.id}" style="background:#f39c12; color:white; border:none; padding: 6px 12px; border-radius:4px; cursor:pointer;" title="Chỉnh sửa công việc">✏️</button>
                </div>
            </td>`;

        const doneBtn = tr.querySelector(".doneAdminTaskBtn");
        if (doneBtn) doneBtn.addEventListener("click", () => openProgressModal(task));

        const editBtn = tr.querySelector(".editAdminTaskBtn");
        if (editBtn) editBtn.addEventListener("click", () => {
            const ruleData = allAdminRulesData.find(r => r.id === task.id);
            if (ruleData) openEditRuleModal(ruleData);
        });
        adminTaskListBody.appendChild(tr);
    };

    activeTasks.forEach(task => renderRow(task, false, null));

    const renderGroup = (tasks, groupTitle, groupId, bgClass) => {
        if (tasks.length === 0) return;
        
        const headerTr = document.createElement("tr");
        headerTr.className = `rule-group-header`;
        headerTr.dataset.target = groupId;
        if (bgClass) headerTr.style.backgroundColor = bgClass;
        
        let colorTag = groupTitle.includes("Đã hoàn thành") ? "#2ecc71" : "#e74c3c";
        const isSearching = currentSearchQuery.length > 0;
        const toggleIcon = isSearching ? '▼' : '▶';

        headerTr.innerHTML = `
            <td colspan="5" style="text-align: left; cursor: pointer; border-bottom: 1px solid #ccc;">
                <span class="group-toggle-btn" style="display:inline-block; width: 22px; color: #3498db; font-size: 12px; font-weight: bold;">${toggleIcon}</span>
                <b style="color: #2c3e50;">${groupTitle}</b> 
                <span style="font-weight:normal; color:${colorTag}; font-size: 0.85em; background: #fff; border: 1px solid ${colorTag}; padding: 2px 6px; border-radius: 12px; margin-left: 5px;">${tasks.length} công việc</span>
            </td>
        `;
        
        headerTr.addEventListener('click', function() {
            const targetId = this.dataset.target;
            const childRows = adminTaskListBody.querySelectorAll(`.rule-child-row[data-parent="${targetId}"]`);
            const toggleBtn = this.querySelector('.group-toggle-btn');
            
            const isClosed = toggleBtn.textContent.trim() === '▶';
            
            childRows.forEach(row => {
                row.style.display = isClosed ? 'table-row' : 'none';
            });
            toggleBtn.textContent = isClosed ? '▼' : '▶';
        });

        adminTaskListBody.appendChild(headerTr);
        tasks.forEach(task => renderRow(task, true, groupId, isSearching));
    };

    renderGroup(overdue45Tasks, "⚠️ Quá hạn trên 45 ngày (Đang chờ)", "group-overdue-45", "#fdedec");
    renderGroup(completedTasks, "✅ Đã hoàn thành", "group-completed", "#e8f8f5");

    // --- KHÔI PHỤC VỊ TRÍ CUỘN ---
    if (scrollContainer) { scrollContainer.style.minHeight = ""; scrollContainer.scrollTop = tableScrollTop; }
    if (pageContentEl) { pageContentEl.style.minHeight = ""; if (pageScrollTop > 0) pageContentEl.scrollTop = pageScrollTop; }
    if (windowScrollTop > 0) window.scrollTo(0, windowScrollTop);
}

// Hàm tiện ích: Khóa cuộn trang và bù đắp chiều rộng thanh cuộn (Chống giật/nháy giao diện)
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

let currentTaskForProgress = null;

async function openProgressModal(task) {
    currentTaskForProgress = task;
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - tzOffset)).toISOString().slice(0, 16);
    const isTaskCompleted = task.category === 3;
    
    const ruleData = allAdminRulesData.find(r => r.id === task.id);
    const allHistoryObj = ruleData ? (ruleData.progressHistory || {}) : {};
    const pastDateKeys = Object.keys(allHistoryObj).filter(k => k !== task.matchDateStr).sort((a,b) => new Date(b) - new Date(a));

    // Thiết lập dữ liệu ban đầu
    document.getElementById("progressTaskId").value = task.id;
    document.getElementById("progressMatchDateStr").value = task.matchDateStr;
    document.getElementById("progressModalTitle").innerHTML = isTaskCompleted ? '🔍 Lịch sử tiến độ' : '📝 Cập nhật tiến độ';
    document.getElementById("progressTime").value = localISOTime;
    document.getElementById("progressNote").value = "";
    document.getElementById("progressCompletedReason").value = "Đã hoàn thành";
    document.getElementById("progressCustomReason").value = "";
    document.getElementById("progressStatus").value = "Đang làm";
    
    // Hiển thị form cập nhật hoặc thông báo
    if (isTaskCompleted) {
        document.getElementById("progressUpdateForm").style.display = "none";
        document.getElementById("progressCompletedMessage").style.display = "block";
        document.getElementById("saveProgressBtn").style.display = "none";
        document.getElementById("cancelProgressBtn").textContent = "Đóng";
    } else {
        document.getElementById("progressUpdateForm").style.display = "block";
        document.getElementById("progressCompletedMessage").style.display = "none";
        document.getElementById("saveProgressBtn").style.display = "block";
        document.getElementById("cancelProgressBtn").textContent = "Hủy";
    }
    document.getElementById("progressStatus").dispatchEvent(new Event('change'));

    // Render Lịch sử hiện tại
    const historyContainer = document.getElementById("progressHistoryContainer");
    if (task.currentHistory && task.currentHistory.length > 0) {
        let historyHtml = `<div style="max-height: 150px; overflow-y: auto; background: var(--surface-hover); border: 1px solid var(--border-color); padding: 10px; border-radius: 6px; margin-bottom: 15px; font-size: 13px; text-align: left;"><strong style="color: var(--primary-color); display: block; margin-bottom: 8px;">Lịch sử tiến độ kỳ này:</strong>`;
        task.currentHistory.forEach((h, index) => {
            const t = new Date(h.time);
            historyHtml += `<div style="margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed var(--border-color); display: flex; justify-content: space-between; align-items: flex-start; line-height: 1.4;"><div><span style="color:#888; font-size: 0.9em;">[${String(t.getDate()).padStart(2,'0')}/${String(t.getMonth() + 1).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}]</span> ${h.status === 'Hoàn thành' ? '✅' : '🏃'} <b>${h.note}</b></div><button type="button" class="delete-history-btn" data-index="${index}" style="background: none; border: none; color: var(--danger-color); cursor: pointer; padding: 0 5px; font-size: 14px;" title="Xóa">❌</button></div>`;
        });
        historyHtml += `</div>`;
        historyContainer.innerHTML = historyHtml;
        historyContainer.style.display = "block";
        
        historyContainer.querySelectorAll('.delete-history-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                if ((await Swal.fire({ title: 'Xóa tiến độ?', text: 'Bạn có chắc muốn xóa?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#e74c3c', confirmButtonText: 'Có, xóa', cancelButtonText: 'Hủy', returnFocus: false, heightAuto: false })).isConfirmed) {
                    try {
                        showLoading("Đang xóa...");
                        const updatedHistory = [...task.currentHistory];
                        const deletedLog = updatedHistory.splice(idx, 1)[0];
                        let updatePayload = { [`progressHistory.${task.matchDateStr}`]: updatedHistory };
                        if (deletedLog.status === 'Hoàn thành') { 
                            updatePayload.lastCompletedDate = null; 
                            updatePayload.actualCompletedDate = null; 
                            updatePayload.completedNote = null; 
                            // Tự động xóa Ngày kết thúc nếu khôi phục lại công việc đơn lẻ
                            const ruleData = allAdminRulesData.find(r => r.id === task.id);
                            if (ruleData && ruleData.exactDate) { updatePayload.ruleEndDate = ""; }
                        }
                        await updateDoc(doc(db, "work_rules", task.id), updatePayload);
                        closeProgressModalFn();
                        hideLoading(); showSwal("success", "Đã xóa!");
                    } catch (err) { hideLoading(); showSwal("error", "Lỗi", err.message); }
                }
            });
        });
    } else {
        historyContainer.style.display = "none";
        historyContainer.innerHTML = "";
    }

    // Lịch sử kỳ quá khứ
    const pastSelect = document.getElementById("progressPastSelect");
    const pastContainer = document.getElementById("progressPastHistoryContainer");
    const pastContent = document.getElementById("progressPastContent");
    
    pastSelect.innerHTML = '<option value="">-- Chọn kỳ --</option>';
    pastContent.style.display = 'none';
    
    if (pastDateKeys.length > 0) {
        pastDateKeys.forEach(k => {
            pastSelect.innerHTML += `<option value="${k}">Kỳ: ${k.split('-').reverse().join('/')}</option>`;
        });
        pastContainer.style.display = 'flex';
        
        pastSelect.onchange = () => {
            const key = pastSelect.value; 
            if (!key) { pastContent.style.display = 'none'; return; }
            const historyArr = allHistoryObj[key] || [];
            if (historyArr.length === 0) pastContent.innerHTML = '<i>Không có dữ liệu tiến độ.</i>';
            else {
                pastContent.innerHTML = [...historyArr].sort((a, b) => new Date(a.time) - new Date(b.time)).map(h => {
                    const t = new Date(h.time); return `<div style="margin-top: 6px; padding-bottom: 6px; border-bottom: 1px dashed var(--border-color); display: flex; justify-content: space-between; align-items: flex-start;"><div><span style="color:#888;">[${String(t.getDate()).padStart(2,'0')}/${String(t.getMonth() + 1).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}]</span> ${h.status === 'Hoàn thành' ? '✅' : '🏃'} <b>${h.note}</b></div></div>`;
                }).join('');
            }
            pastContent.style.display = 'block';
        };
    } else {
        pastContainer.style.display = 'none';
    }

    document.getElementById("progressModal").style.display = "block";
    toggleBodyScroll(true);
}

// Event Listeners cho Modal Tiến Độ
const closeProgressModalFn = () => {
    document.getElementById("progressModal").style.display = "none";
    toggleBodyScroll(false);
    currentTaskForProgress = null;
};
document.getElementById("closeProgressModal").onclick = closeProgressModalFn;
document.getElementById("cancelProgressBtn").onclick = closeProgressModalFn;

document.getElementById("progressStatus").addEventListener("change", (e) => {
    if (e.target.value === 'Hoàn thành') { 
        document.getElementById("progressNoteContainer").style.display = 'none'; 
        document.getElementById("progressCompletedContainer").style.display = 'block'; 
    } else { 
        document.getElementById("progressNoteContainer").style.display = 'flex'; 
        document.getElementById("progressCompletedContainer").style.display = 'none'; 
    }
});

document.getElementById("progressCompletedReason").addEventListener("change", (e) => {
    if (e.target.value === 'Khác') { 
        document.getElementById("progressCustomReasonContainer").style.display = 'flex'; 
        document.getElementById("progressCustomReason").focus(); 
    } else { 
        document.getElementById("progressCustomReasonContainer").style.display = 'none'; 
    }
});

document.getElementById("saveProgressBtn").addEventListener("click", async () => {
    if (!currentTaskForProgress) return;
    const task = currentTaskForProgress;
    
    const status = document.getElementById("progressStatus").value;
    const timeInput = document.getElementById("progressTime").value;
    let note = '';
    
    if (status === 'Hoàn thành') { 
        note = document.getElementById("progressCompletedReason").value; 
        if (note === 'Khác') { 
            note = document.getElementById("progressCustomReason").value.trim(); 
            if (!note) return showSwal('error', 'Lỗi', 'Vui lòng nhập lý do!'); 
        } 
    } else { 
        note = document.getElementById("progressNote").value.trim(); 
        if (!note) return showSwal('error', 'Lỗi', 'Vui lòng nhập nội dung!'); 
    }
    if (!timeInput) return showSwal('error', 'Lỗi', 'Vui lòng chọn thời gian!');

    try {
        showLoading("Đang cập nhật...");
        const timeIso = new Date(timeInput).toISOString();
        const updatedHistory = [...(task.currentHistory || []), { time: timeIso, note: note, status: status, user: getCurrentUserEmail() }].sort((a, b) => new Date(a.time) - new Date(b.time));
        
        let updatePayload = { [`progressHistory.${task.matchDateStr}`]: updatedHistory };
        if (status === 'Hoàn thành') { 
            updatePayload.lastCompletedDate = task.matchDateStr; 
            updatePayload.actualCompletedDate = timeIso; 
            updatePayload.completedNote = note; 
            
            // Tự động đóng băng (kết thúc) công việc đơn lẻ bằng cách truyền ngày vào ruleEndDate
            const ruleData = allAdminRulesData.find(r => r.id === task.id);
            if (ruleData && ruleData.exactDate) {
                updatePayload.ruleEndDate = timeInput.split('T')[0]; // Trích xuất định dạng YYYY-MM-DD
            }
        }
        
        await updateDoc(doc(db, "work_rules", task.id), updatePayload);
        hideLoading(); 
        showSwal("success", status === 'Hoàn thành' ? "Đã đánh dấu hoàn thành!" : "Đã lưu nhật ký tiến độ!");
        closeProgressModalFn();
    } catch (e) { 
        hideLoading(); 
        showSwal("error", "Lỗi", e.message); 
    }
});

// ==========================================
// LOGIC CHỈNH SỬA CÔNG VIỆC (MODAL)
// ==========================================

const editRuleDomEl = document.getElementById('editRuleDom');
if (editRuleDomEl) {
    let domOptions = '<option value="">--Ngày--</option>';
    for(let i=1; i<=31; i++) { domOptions += `<option value="${i}">${i}</option>`; }
    editRuleDomEl.innerHTML = domOptions;
}

const editRuleExactDate = document.getElementById("editRuleExactDate");
const editRuleDom = document.getElementById("editRuleDom");
const editRuleDay = document.getElementById("editRuleDay");
const editRuleWeek = document.getElementById("editRuleWeek");
const editRuleMonth = document.getElementById("editRuleMonth");

function updateEditRuleState() {
    if (editRuleExactDate.value) {
        editRuleDom.disabled = true; editRuleDay.disabled = true; editRuleWeek.disabled = true; editRuleMonth.disabled = true;
    } else if (editRuleDom.value || editRuleDay.value || editRuleWeek.value || editRuleMonth.value) {
        editRuleExactDate.disabled = true;
    } else {
        editRuleExactDate.disabled = false; editRuleDom.disabled = false; editRuleDay.disabled = false; editRuleWeek.disabled = false; editRuleMonth.disabled = false;
    }
}

[editRuleExactDate, editRuleDom, editRuleDay, editRuleWeek, editRuleMonth].forEach(el => {
    if (el) { el.addEventListener('change', updateEditRuleState); el.addEventListener('input', updateEditRuleState); }
});

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
    
    let rawNote = rule.note || "";
    if (rawNote.startsWith("[CVAdmin]")) {
        rawNote = rawNote.replace("[CVAdmin]", "").trim();
    }
    document.getElementById("editRuleNote").value = rawNote;

    updateEditRuleState();
    document.getElementById("editRuleModal").style.display = "block";
    toggleBodyScroll(true);
}

const closeEditRuleModalFn = () => {
    document.getElementById("editRuleModal").style.display = "none";
    toggleBodyScroll(false);
    activeEditingRuleData = null;
    
    ["editRuleId", "editRuleJobName", "editRuleTime", "editRuleExactDate", "editRuleDom", "editRuleDay", "editRuleWeek", "editRuleMonth", "editRuleEndDate", "editRuleNote"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    updateEditRuleState();
};
document.getElementById("closeEditRuleModal").onclick = closeEditRuleModalFn;
document.getElementById("cancelEditRuleBtn").onclick = closeEditRuleModalFn;

document.getElementById("saveEditRuleBtn").addEventListener("click", async () => {
    const id = document.getElementById("editRuleId").value;
    const job = document.getElementById("editRuleJobName").value.trim();
    const time = document.getElementById("editRuleTime").value;
    const exactDate = document.getElementById("editRuleExactDate").value;
    const dom = document.getElementById("editRuleDom").value;
    const day = document.getElementById("editRuleDay").value;
    const week = document.getElementById("editRuleWeek").value;
    const month = document.getElementById("editRuleMonth").value;
    const ruleEndDate = document.getElementById("editRuleEndDate").value;
    const rawNote = document.getElementById("editRuleNote").value.trim();

    if (!job) return showSwal("error", "Lỗi", "Vui lòng nhập tên công việc!");

    if (!exactDate && !dom && !day && !week && !month) {
        return showSwal("error", "Lỗi", "Vui lòng chọn Ngày cụ thể hoặc ít nhất một thời gian định kỳ (Ngày/Thứ/Tuần/Tháng)!");
    }

    let note = `[CVAdmin] ${rawNote}`.trim();
    
    const updateData = { job, time, exactDate, dom, day, week, month, ruleEndDate, note, updatedAt: serverTimestamp() };
    const changes = getRuleChanges(activeEditingRuleData, updateData);

    try {
        showLoading("Đang lưu...");
        await updateDoc(doc(db, "work_rules", id), updateData);
        addLog("admin_update_work_rule", { email: getCurrentUserEmail(), ruleId: id, targetName: job, changes });
        hideLoading();
        showSwal("success", "Đã cập nhật công việc!");
        closeEditRuleModalFn();
    } catch (error) {
        hideLoading();
        showSwal("error", "Lỗi!", "Không thể cập nhật: " + error.message);
    }
});

document.getElementById("deleteEditRuleBtn").addEventListener("click", async () => {
    const id = document.getElementById("editRuleId").value;
    const ruleData = allAdminRulesData.find(r => r.id === id);
    
    if ((await Swal.fire({ title: 'Xóa công việc?', text: `Bạn có chắc muốn xóa công việc "${ruleData?.job || ''}" này vĩnh viễn?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#e74c3c', confirmButtonText: 'Có, xóa', cancelButtonText: 'Hủy', returnFocus: false, heightAuto: false })).isConfirmed) {
        try {
            showLoading("Đang xóa...");
            await deleteDoc(doc(db, "work_rules", id));
            hideLoading();
            showSwal("success", "Đã xóa công việc!");
            closeEditRuleModalFn();
        } catch (err) { hideLoading(); showSwal("error", "Lỗi", err.message); }
    }
});

// LOGIC THÊM NHANH (MỚI)
function resetQuickAddFormMode() {
    activeEditingRuleData = null;
    document.getElementById("quickAddRuleEditId").value = "";
    document.getElementById("deleteQuickAddBtn").style.display = "none";
    document.getElementById("quickAddSpacer").style.display = "none";
    document.getElementById("quickAddModalTitle").innerHTML = "➕ Thêm Việc Nhanh";
    
    const saveBtn = document.getElementById("saveQuickAddBtn");
    saveBtn.innerHTML = "💾 Lưu công việc";
    saveBtn.style.background = "#2ecc71";
    
    const saveAsNewBtn = document.getElementById("saveAsNewQuickBtn");
    if (saveAsNewBtn) saveAsNewBtn.style.display = "none";
}

const closeQuickAddModalFn = () => {
    document.getElementById("quickAddModal").style.display = "none";
    toggleBodyScroll(false);
    resetQuickAddFormMode();
};
document.getElementById("closeQuickAddModal").onclick = closeQuickAddModalFn;
document.getElementById("cancelQuickAddBtn").onclick = closeQuickAddModalFn;

document.getElementById('quickAddBtn').addEventListener('click', () => {
    document.getElementById("quickTaskName").value = "";
    document.getElementById("quickTaskDate").value = "";
    document.getElementById("quickTaskNote").value = "";
    resetQuickAddFormMode();
    document.getElementById("quickAddModal").style.display = "block";
    toggleBodyScroll(true);
});

// Chuyển Modal Thêm Nhanh sang chế độ Sửa khi trùng tên
document.getElementById("quickTaskName").addEventListener("input", function() {
    const val = this.value.trim().toLowerCase();
    const currentEditId = document.getElementById("quickAddRuleEditId").value;
    
    if (!val) {
        if (currentEditId) resetQuickAddFormMode();
        return;
    }

    const normalizedVal = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const exactMatchRule = allAdminRulesData.find(r => {
         if (!r.job) return false;
         const normalizedJob = r.job.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
         return normalizedJob === normalizedVal;
    });

    if (exactMatchRule) {
        if (currentEditId !== exactMatchRule.id) {
            activeEditingRuleData = exactMatchRule;
            document.getElementById("quickTaskDate").value = exactMatchRule.exactDate || "";
            
            let rawNote = exactMatchRule.note || "";
            if (rawNote.startsWith("[CVAdmin]")) rawNote = rawNote.replace("[CVAdmin]", "").trim();
            document.getElementById("quickTaskNote").value = rawNote;
            
            document.getElementById("quickAddRuleEditId").value = exactMatchRule.id;
            document.getElementById("deleteQuickAddBtn").style.display = "block";
            document.getElementById("quickAddSpacer").style.display = "block";
            document.getElementById("quickAddModalTitle").innerHTML = "✏️ Sửa Việc Nhanh";
            
            const saveBtn = document.getElementById("saveQuickAddBtn");
            saveBtn.innerHTML = "💾 Lưu thay đổi";
            saveBtn.style.background = "#f39c12";
    
            const saveAsNewBtn = document.getElementById("saveAsNewQuickBtn");
            if (saveAsNewBtn) saveAsNewBtn.style.display = "block";
    
            showSwal("info", "Đã tải dữ liệu công việc cũ");
        }
    } else {
        if (currentEditId) {
            resetQuickAddFormMode();
        }
    }
});

document.getElementById("saveAsNewQuickBtn").addEventListener("click", () => {
    document.getElementById("quickAddRuleEditId").value = "";
    document.getElementById("saveQuickAddBtn").click();
});

document.getElementById("deleteQuickAddBtn").addEventListener("click", async () => {
    const ruleIdToDelete = document.getElementById("quickAddRuleEditId").value;
    if (!ruleIdToDelete) return;
    const ruleData = allAdminRulesData.find(r => r.id === ruleIdToDelete);
    
    if ((await Swal.fire({ title: 'Xóa công việc?', text: `Bạn có chắc muốn xóa công việc "${ruleData?.job || ''}" này vĩnh viễn?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#e74c3c', confirmButtonText: 'Có, xóa', cancelButtonText: 'Hủy', returnFocus: false, heightAuto: false })).isConfirmed) {
        try {
            showLoading("Đang xóa...");
            await deleteDoc(doc(db, "work_rules", ruleIdToDelete));
            addLog("admin_delete_work_rule_quick", { email: getCurrentUserEmail(), deletedRuleId: ruleIdToDelete });
            hideLoading();
            showSwal("success", "Đã xóa công việc!");
            closeQuickAddModalFn();
        } catch (err) { hideLoading(); showSwal("error", "Lỗi", err.message); }
    }
});

document.getElementById("saveQuickAddBtn").addEventListener("click", async () => {
    const editId = document.getElementById("quickAddRuleEditId").value;
    const jobName = document.getElementById("quickTaskName").value.trim();
    const jobDate = document.getElementById("quickTaskDate").value;
    const jobNote = document.getElementById("quickTaskNote").value.trim();
    
    if (!jobName) return showSwal("error", "Lỗi", "Vui lòng nhập tên công việc!");
    if (!jobDate) return showSwal("error", "Lỗi", "Vui lòng chọn ngày thực hiện!");

    try {
        showLoading("Đang lưu công việc...");
        
        let finalNote = "[CVAdmin]";
        if (jobNote) finalNote += " " + jobNote;
        else finalNote += " Thêm nhanh";

        if (editId) {
            // Cập nhật công việc hiện tại
            const updateData = {
                job: jobName,
                exactDate: jobDate,
                note: finalNote,
                updatedAt: serverTimestamp()
            };
            const changes = getRuleChanges(activeEditingRuleData, updateData);
            await updateDoc(doc(db, "work_rules", editId), updateData);
            addLog("admin_update_work_rule_quick", { email: getCurrentUserEmail(), ruleId: editId, targetName: jobName, changes });
            
            hideLoading();
            showSwal("success", "Đã cập nhật công việc!");
            closeQuickAddModalFn();
        } else {
            // Thêm mới với kiểm tra trùng lặp
            const normalizedVal = jobName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const uniqueJobs = Array.from(new Set(allAdminRulesData.map(r => r.job).filter(Boolean)));
            
            const exactMatch = uniqueJobs.find(job => {
                 const normalizedJob = job.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                 return normalizedJob === normalizedVal;
            });
            const similarJobs = uniqueJobs.filter(job => {
                const normalizedJob = job.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return normalizedJob.includes(normalizedVal) && normalizedJob !== normalizedVal;
            });

            if (exactMatch) {
                const isConfirmed = await Swal.fire({
                    title: 'Công việc đã tồn tại!',
                    html: `Công việc "<b>${exactMatch}</b>" đã có trong hệ thống.<br>Bạn có chắc chắn muốn thêm một quy tắc mới với cùng tên này không?`,
                    icon: 'warning', showCancelButton: true, confirmButtonColor: '#e74c3c', cancelButtonColor: '#95a5a6', confirmButtonText: 'Vẫn thêm', cancelButtonText: 'Hủy', heightAuto: false
                });
                if (!isConfirmed.isConfirmed) { hideLoading(); return; }
            } else if (similarJobs.length > 0) {
                const suggestions = similarJobs.slice(0, 4).map(j => `"${j}"`).join(", ");
                const isConfirmed = await Swal.fire({
                    title: 'Công việc tương tự đã tồn tại!',
                    html: `Các công việc có thể giống với nội dung bạn nhập:<br><b>${suggestions}</b><br><br>Bạn có chắc chắn muốn thêm mới không?`,
                    icon: 'info', showCancelButton: true, confirmButtonColor: '#f39c12', cancelButtonColor: '#95a5a6', confirmButtonText: 'Vẫn thêm', cancelButtonText: 'Hủy', heightAuto: false
                });
                if (!isConfirmed.isConfirmed) { hideLoading(); return; }
            }

            const jobData = {
                job: jobName, time: "17:00", exactDate: jobDate,
                day: "", week: "", month: "", ruleEndDate: "", dom: "",
                note: finalNote, is_admin_job: true, is_common_job: false,
                targetGroup: null, notifyTime: null, createdAt: serverTimestamp()
            };
            
            const docRef = await addDoc(collection(db, "work_rules"), jobData);
            addLog("admin_create_work_rule_quick", { email: getCurrentUserEmail(), ruleId: docRef.id, ...jobData });
            
            hideLoading();
            showSwal("success", "Đã thêm công việc nhanh!");
            closeQuickAddModalFn();
        }
    } catch (error) {
        hideLoading();
        showSwal("error", "Lỗi lưu công việc", error.message);
    }
});
