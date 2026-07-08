import { db, onAuth, getRole, showLoading, hideLoading, loadTemplate } from "./script.js";
import { collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initMenu } from "./menu.js";
import { getWeekNumber, getDaysDifference, isRuleActiveOnDate, sortShiftRules, ruleMatchesDate, getLastMatchDate, getNextMatchDate, getNormalizedFirstChar, getWorkersForDateMonth } from "./autoplan-core.js";

// === Load menu, modal và footer===
loadTemplate("menu-placeholder", "menu.html", () => {
  initMenu();
});
loadTemplate("loading-placeholder", "modal.html");
loadTemplate("footer-placeholder", "footer.html");


const notLogged = document.getElementById("notLogged");
const content = document.getElementById("pageContent");
const footerPlaceholder = document.getElementById("footer-placeholder");
let currentlyViewedDate = new Date();

const scheduleBody = document.getElementById("scheduleBody");

// --- Hàm tiện ích: Khóa cuộn trang ---
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

let allRulesData = [];
let allPatternsData = [];
let allSwapsData = [];
let allMaintRulesData = []; // Lưu trữ quy trình bảo trì thiết bị

let rulesLoaded = false;
let patternsLoaded = false;
let swapsLoaded = false;
let maintRulesLoaded = false; // Trạng thái tải của bảo trì
let initialLoadComplete = false; 

let unsubscribeRules = null;
let unsubscribePatterns = null;
let unsubscribeSwaps = null;
let unsubscribeMaintRules = null; // Unsubscribe của bảo trì

const personalScheduleModal = document.getElementById("personalScheduleModal");
const closeModalBtn = document.getElementById("closeModal");
const personalScheduleDetails = document.getElementById("personalScheduleDetails");

let userRole = "user";

// --- HÀM 1: onAuth ---
onAuth(async (user) => {
    if (!user) {
        notLogged.style.display = "flex";
        content.style.display = "none";
        if (footerPlaceholder) footerPlaceholder.style.display = "block";
        
        // Hủy lắng nghe thời gian thực khi đăng xuất để tránh lỗi quyền và trùng lặp
        if (unsubscribeRules) { unsubscribeRules(); unsubscribeRules = null; }
        if (unsubscribePatterns) { unsubscribePatterns(); unsubscribePatterns = null; }
        if (unsubscribeSwaps) { unsubscribeSwaps(); unsubscribeSwaps = null; }
        if (unsubscribeMaintRules) { unsubscribeMaintRules(); unsubscribeMaintRules = null; }
        
        rulesLoaded = false;
        patternsLoaded = false;
        swapsLoaded = false;
        maintRulesLoaded = false;
        initialLoadComplete = false;
        return;
    }
    showLoading("Đang tải dữ liệu lịch làm việc...");
    notLogged.style.display = "none";
    content.style.display = "block";
    if (footerPlaceholder) footerPlaceholder.style.display = "block";
    userRole = await getRole(user.email);
    setupRealtimeListeners(user.email, userRole);
});

// --- HÀM 2: checkAllDataLoadedAndRender ---
function checkAllDataLoadedAndRender(email, role) {
    const searchInputEl = document.getElementById('globalSearchInput');
    const searchVal = searchInputEl ? searchInputEl.value : "";
    
    if (initialLoadComplete) {
        try {
            renderSchedule(searchVal, currentlyViewedDate);
        } catch (e) {
            console.error("Lỗi khi render lịch tuần:", e);
        }
        return;
    }
    
    if (rulesLoaded && patternsLoaded && swapsLoaded && maintRulesLoaded) {
        initialLoadComplete = true; 
        try {
            renderSchedule(searchVal, currentlyViewedDate);
        } catch (e) {
            console.error("Lỗi khi render lịch tuần:", e);
        }
        if (role !== 'admin') {
            try {
                showPersonalScheduleModal(email, role); 
            } catch (e) {
                console.error("Lỗi khi hiển thị lịch cá nhân:", e);
            }
        }
        hideLoading(); 
    }
}

// --- HÀM 3: setupRealtimeListeners ---
function setupRealtimeListeners(email, role) {
    // Hủy các listener cũ nếu có trước khi đăng ký mới
    if (unsubscribeRules) unsubscribeRules();
    if (unsubscribePatterns) unsubscribePatterns();
    if (unsubscribeSwaps) unsubscribeSwaps();

    const qRules = query(collection(db, "work_rules"));
    unsubscribeRules = onSnapshot(qRules, (snapshot) => {
        allRulesData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        allRulesData.sort((a, b) => {
            const groupA = getNormalizedFirstChar(a.job);
            const groupB = getNormalizedFirstChar(b.job);
            if (groupA !== groupB) return groupA.localeCompare(groupB);
            if (b.createdAt && a.createdAt) return b.createdAt.toMillis() - a.createdAt.toMillis();
            return 0;
        });
        if (!rulesLoaded) rulesLoaded = true;
        checkAllDataLoadedAndRender(email, role); 
    }, (error) => {
        console.error("Lỗi lắng nghe work_rules:", error);
        if (!rulesLoaded) rulesLoaded = true; 
        checkAllDataLoadedAndRender(email, role); 
    });

    const qPatterns = query(collection(db, "work_patterns"));
    unsubscribePatterns = onSnapshot(qPatterns, (snapshot) => {
        allPatternsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        allPatternsData.sort((a, b) => {
            return (a.user || "").localeCompare(b.user || "");
        });
        if (!patternsLoaded) patternsLoaded = true;
        checkAllDataLoadedAndRender(email, role); 
    }, (error) => {
        console.error("Lỗi lắng nghe work_patterns:", error);
        if (!patternsLoaded) patternsLoaded = true; 
        checkAllDataLoadedAndRender(email, role); 
    });

    const qSwaps = query(collection(db, "shift_swaps"));
    unsubscribeSwaps = onSnapshot(qSwaps, (snapshot) => {
        allSwapsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        if (!swapsLoaded) swapsLoaded = true;
        checkAllDataLoadedAndRender(email, role);
    }, (error) => {
        console.error("Lỗi lắng nghe shift_swaps:", error);
        if (!swapsLoaded) swapsLoaded = true;
        checkAllDataLoadedAndRender(email, role);
    });

    const qMaintRules = query(collection(db, "device_maintenance_rules"));
    unsubscribeMaintRules = onSnapshot(qMaintRules, (snapshot) => {
        allMaintRulesData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        if (!maintRulesLoaded) maintRulesLoaded = true;
        checkAllDataLoadedAndRender(email, role);
    }, (error) => {
        console.error("Lỗi lắng nghe device_maintenance_rules:", error);
        if (!maintRulesLoaded) maintRulesLoaded = true;
        checkAllDataLoadedAndRender(email, role);
    });
}


// --- HÀM 4: renderSchedule ---
async function renderSchedule(searchQuery = "", referenceDate = new Date()) {
    scheduleBody.innerHTML = "";
    
    const lowerCaseQuery = searchQuery.toLowerCase().trim();

    const weekStart = new Date(referenceDate);
    weekStart.setDate(referenceDate.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));

    const adminRules = allPatternsData.filter(p => p.type === 'administrative');
    const allShiftRules = allPatternsData.filter(p => p.type === 'shift_rotation');

    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const yesterday = new Date(d);
        yesterday.setDate(d.getDate() - 1);

        const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const swapsForDate = allSwapsData.filter(s => s.date === isoDate);

        let people = [];  // danh sách người làm (tên + ca/giờ)

        const dayOfWeek = d.getDay() === 0 ? 8 : d.getDay() + 1;

        // ===== 1) LỊCH CỐ ĐỊNH =====
        adminRules.forEach(rule => {
            if (!isRuleActiveOnDate(rule, d) || !Array.isArray(rule.workDaysOfWeek)) {
                return;
            }

            const startTime = rule.startTime || "00:00";
            const endTime = rule.endTime || "00:00";
            
            const [startH, startM] = (startTime || "00:00").split(':').map(Number);
            const [endH, endM] = (endTime || "00:00").split(':').map(Number);
            let isNightShift = false;

            if ( (endH < startH) || (endH === startH && endM < startM) ) {
                isNightShift = true;
            } else if (rule.isNextDay === true && startH === endH && startM === endM) {
                isNightShift = true; // Xử lý ca 24h
            }
            
            const prevDay = dayOfWeek === 2 ? 8 : dayOfWeek - 1;

            if (rule.workDaysOfWeek.includes(dayOfWeek)) {
                let displayName = rule.displayName;
                const swap = swapsForDate.find(s => s.user1 === displayName);
                let swapText = "";
                if (swap) {
                    displayName = swap.user2;
                    swapText = ` 🔄 (Thay ${swap.user1})`;
                }
                const groupTag = rule.shiftGroup ? ` [${rule.shiftGroup}]` : ` [Hành chính]`;
                const shiftLabel = isNightShift
                    ? `- ${displayName} (${startTime} – ${endTime} hôm sau)${groupTag}${swapText}`
                    : `- ${displayName} (${startTime} – ${endTime})${groupTag}${swapText}`;
                people.push(shiftLabel);
            }
        });


        // ===== 2) LỊCH XOAY CA =====
        if (allShiftRules.length > 0) {
            const shiftGroups = {};
            allShiftRules.forEach(rule => {
                const group = rule.shiftGroup || "Vận hành";
                if (!shiftGroups[group]) shiftGroups[group] = [];
                shiftGroups[group].push(rule);
            });

            for (const group in shiftGroups) {
                const groupRules = shiftGroups[group];
                const sortedGroupRules = [...groupRules].sort(sortShiftRules);
                const groupRefDate = (sortedGroupRules[0] && sortedGroupRules[0].patternStartDate) ? new Date(sortedGroupRules[0].patternStartDate + 'T00:00:00') : null;
                
                if (groupRefDate && !isNaN(groupRefDate.getTime())) {
                    const membersYesterday = groupRules
                        .filter(rule => isRuleActiveOnDate(rule, yesterday))
                        .sort(sortShiftRules);
                    
                    const membersToday = groupRules
                        .filter(rule => isRuleActiveOnDate(rule, d))
                        .sort(sortShiftRules);

                    let workerYesterday = null, isNightYesterday = false, workerYesterdayName = null;

                    if (membersYesterday.length > 0) {
                        const n_yesterday = membersYesterday.length;
                        const daysSinceYesterday = getDaysDifference(yesterday, groupRefDate);
                        const workerIndexYesterday = (daysSinceYesterday % n_yesterday + n_yesterday) % n_yesterday;
                        
                        workerYesterday = membersYesterday[workerIndexYesterday];
                        if (workerYesterday) {
                            workerYesterdayName = workerYesterday.displayName;
                            const [startH, startM] = (workerYesterday.startTime || "00:00").split(':').map(Number);
                            const [endH, endM] = (workerYesterday.endTime || "00:00").split(':').map(Number);

                            if ( (endH < startH) || (endH === startH && endM < startM) ) {
                                isNightYesterday = true;
                            } else if (workerYesterday.isNextDay === true && startH === endH && startM === endM) {
                                isNightYesterday = true; // Ca 24h
                            }
                        }
                    }

                    if (membersToday.length > 0) {
                        const n_today = membersToday.length;
                        const daysSinceToday = getDaysDifference(d, groupRefDate);
                        const workerIndexToday = (daysSinceToday % n_today + n_today) % n_today;
                        const workerToday = membersToday[workerIndexToday];
                        
                        if (workerToday) {
                            let isNightToday = false;
                            const [startH, startM] = (workerToday.startTime || "00:00").split(':').map(Number);
                            const [endH, endM] = (workerToday.endTime || "00:00").split(':').map(Number);

                            if ( (endH < startH) || (endH === startH && endM < startM) ) {
                                isNightToday = true;
                            } else if (workerToday.isNextDay === true && startH === endH && startM === endM) {
                                isNightToday = true; // Ca 24h
                            }
                            if (!isNightYesterday || workerYesterdayName !== workerToday.displayName) {
                                let displayName = workerToday.displayName;
                                
                                const swap = swapsForDate.find(s => s.user1 === displayName);
                                let swapText = "";
                                if (swap) {
                                    displayName = swap.user2;
                                    swapText = ` 🔄 (Thay ${swap.user1})`;
                                }
                                const groupTag = Object.keys(shiftGroups).length > 1 ? ` [${group}]` : "";
                                const shiftLabel = `- ${displayName} (${workerToday.startTime} – ${workerToday.endTime}${isNightToday ? " hôm sau" : ""})${groupTag}${swapText}`;
                                people.push(shiftLabel);
                            }
                        }
                    }
                }
            }
        }

        // ===== 3) TỔNG HỢP CÔNG VIỆC =====
        let jobsForDay = []; 
        const allRuleJobs = allRulesData.filter(rule => 
            ( !rule.is_admin_job ) &&
            ruleMatchesDate(rule, d) 
        );
        allRuleJobs.forEach(r => {
            const timeStr = r.time ? ` <strong>(${r.time})</strong>` : "";
            const noteDisplay = (r.note || "").replace("[CVAdmin]", "<span style='color:#e74c3c; font-weight:bold;'>[CVAdmin]</span>").replace("[CVChung]", "<span style='color:#3498db; font-weight:bold;'>[CVChung]</span>");
            const noteStr = noteDisplay ? `<div style="color:#666; font-style:italic; font-size:0.9em; margin-top:2px; padding-left:14px;">↳ 📝 Ghi chú: ${noteDisplay}</div>` : "";
            const targetTag = (r.is_common_job && r.targetGroup && r.targetGroup !== 'all') ? `<span style='color:#8e44ad; font-weight:bold;'>[Nhóm: ${r.targetGroup}]</span> ` : "";
            jobsForDay.push(`<div style="margin-bottom:8px;">• ${targetTag}${r.job}${timeStr}${noteStr}</div>`);
        });

        // Bổ sung các việc bảo trì thiết bị từ device_maintenance_rules trùng khớp ngày d
        const matchedMaintRules = allMaintRulesData.filter(rule => 
            ruleMatchesDate(rule, d)
        );
        matchedMaintRules.forEach(mr => {
            const timeStr = mr.time ? ` <strong>(${mr.time})</strong>` : "";
            const deviceTag = mr.deviceCode 
              ? `<span style='color:#16a085; font-weight:bold;'>[🛠️ Bảo trì ${mr.deviceCode}]</span>` 
              : `<span style='color:#16a085; font-weight:bold;'>[🛠️ Bảo trì]</span>`;
            const noteStr = mr.note ? `<div style="color:#666; font-style:italic; font-size:0.9em; margin-top:2px; padding-left:14px;">↳ 📝 Ghi chú: ${mr.note}</div>` : "";
            
            jobsForDay.push(`<div style="margin-bottom:8px; color: #16a085;">• ${deviceTag} ${mr.deviceName}: ${mr.job}${timeStr}${noteStr}</div>`);
        });

        // ===== 4) HIỂN THỊ TRÊN BẢNG =====
        const thuDisplay = d.getDay() === 0 ? 'Chủ Nhật' : 'Thứ ' + (d.getDay() + 1);
        const dateStr = d.toLocaleDateString("vi-VN");
        const [year, weekNo] = getWeekNumber(d);
        const tr = document.createElement("tr");
        
        const today = new Date();
        if (d.toDateString() === today.toDateString()) {
            tr.classList.add('today-row');
        }

        const hidePeopleClass = people.length === 0 ? "hide-empty-mobile" : "";
        const hideJobsClass = jobsForDay.length === 0 ? "hide-empty-mobile" : "";

        tr.innerHTML = `
            <td data-label="Ngày">${thuDisplay} (${dateStr}) <br> <span class="week-label">(Tuần ${weekNo})</span></td>
            <td data-label="Người làm" class="${hidePeopleClass}">${people.length ? people.join('<br>') : '-'}</td>
            <td data-label="Nội dung công việc" class="${hideJobsClass}">${jobsForDay.length ? jobsForDay.join('') : '-'}</td>
        `;
        if (lowerCaseQuery && tr.textContent.toLowerCase().includes(lowerCaseQuery)) {
            tr.classList.add('highlight');
        }
        scheduleBody.appendChild(tr);
    }

    const [year, weekNo] = getWeekNumber(referenceDate);
    document.getElementById('weekNumberDisplay').textContent = `Tuần ${weekNo} / ${year}`;
}

// --- LOGIC GIAO DIỆN & MODAL ---
closeModalBtn.onclick = () => {
    toggleBodyScroll(false);
    personalScheduleModal.style.display = "none";
};
window.onclick = (event) => { 
    if (event.target == personalScheduleModal) {
        toggleBodyScroll(false); 
        personalScheduleModal.style.display = "none"; 
    }
    if (event.target == document.getElementById("monthScheduleModal")) {
        closeMonthScheduleModal();
    }
};
document.getElementById("closeModalBottom").onclick = () => {
    toggleBodyScroll(false);
    personalScheduleModal.style.display = "none";
};

// Tìm kiếm
const globalSearchInput = document.getElementById('globalSearchInput');
globalSearchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase().trim();
    renderSchedule(query, currentlyViewedDate);
});

// In lịch tuần
document.getElementById('printScheduleBtn').addEventListener('click', () => {
    window.print();
});

// Chuyển tuần
const weekNav = document.getElementById('weekNavigator');
if (weekNav) {
    weekNav.addEventListener('click', (event) => {
        const targetId = event.target.id;
        const currentYear = currentlyViewedDate.getFullYear();
        switch (targetId) {
            case 'prevWeekBtn': currentlyViewedDate.setDate(currentlyViewedDate.getDate() - 7); break;
            case 'nextWeekBtn': currentlyViewedDate.setDate(currentlyViewedDate.getDate() + 7); break;
            case 'todayWeekBtn': currentlyViewedDate = new Date(); break;
            case 'firstWeekBtn': currentlyViewedDate = new Date(currentYear, 0, 1); break;
            case 'lastWeekBtn': currentlyViewedDate = new Date(currentYear, 11, 31); break;
            default: return;
        }
        renderSchedule(globalSearchInput.value, currentlyViewedDate);
    });
}

// --- HÀM GỌI MODAL LỊCH CÁ NHÂN ---
async function showPersonalScheduleModal(email, currentUserRole) {
    window.scrollTo(0, 0);
    toggleBodyScroll(true); 
    
    personalScheduleModal.style.display = "block";
    personalScheduleDetails.innerHTML = "<p>Đang tải lịch cá nhân...</p>";

    let myDisplayName = null;
    const myPattern = allPatternsData.find(p => p.user === email);
    if (myPattern) myDisplayName = myPattern.displayName;
    if (!myDisplayName && currentUserRole !== 'admin') {
        return personalScheduleDetails.innerHTML = "<p>Không tìm thấy tài khoản nhân viên.</p>";
    }

    const today = new Date();
    today.setHours(0,0,0,0);
    let html = '';

    if (currentUserRole === 'admin') {
        document.querySelector("#personalScheduleModal h2").textContent = "Công việc Admin";
        const adminRules = allRulesData.filter(r => r.is_admin_job);
        let taskList = [];

        adminRules.forEach(d => {
            const lastMatchDate = getLastMatchDate(d);
            const nextMatchDate = getNextMatchDate(d);
            const [h, m] = (d.time || "23:59").split(':').map(Number);
            const currentNow = new Date();
            const todayMidnight = new Date(currentNow); 
            todayMidnight.setHours(0, 0, 0, 0);

            const createTaskRow = (targetDate, isFuture) => {
                if (!targetDate) return null;
                const matchDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`;
                
                let isCompleted = false;
                if (d.lastCompletedDate === matchDateStr) isCompleted = true;
                if (isCompleted) return null;

                const dueDateTime = new Date(targetDate);
                dueDateTime.setHours(h, m, 0, 0);
                const dueMidnight = new Date(targetDate); 
                dueMidnight.setHours(0, 0, 0, 0);

                const currentHistory = (d.progressHistory && d.progressHistory[matchDateStr]) ? d.progressHistory[matchDateStr] : [];
                const isInProgress = currentHistory.length > 0;

                let category = 5;
                let diffDays = 999;
                let statusText = "";
                let statusColor = "";

                if (!isFuture) {
                    if (currentNow > dueDateTime) {
                        category = 2; // Quá hạn
                        const daysOverdue = Math.floor((todayMidnight - dueMidnight) / (1000 * 60 * 60 * 24));
                        if (isInProgress) {
                            statusText = daysOverdue > 0 ? `🏃 Đang làm (Quá hạn ${daysOverdue} ngày)` : '🏃 Đang làm (Quá hạn)';
                            statusColor = '#d35400';
                        } else {
                            statusText = daysOverdue > 0 ? `⚠️ Quá hạn (${daysOverdue} ngày)` : '⚠️ Quá hạn';
                            statusColor = '#e74c3c';
                        }
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
                        category = 1; // Sắp đến hạn
                        statusText = isInProgress ? `🏃 Đang làm (Còn ${daysUntil} ngày)` : `🔔 Sắp đến hạn (${daysUntil} ngày)`;
                        statusColor = isInProgress ? '#2980b9' : '#3498db';
                    } else return null;
                }

                return {
                    id: d.id, job: d.job, time: d.time || "23:59", category: category,
                    targetDate: targetDate, diffDays: diffDays, statusText: statusText,
                    statusColor: statusColor, note: d.note ? d.note.replace("[CVAdmin]", "").trim() : "",
                    currentHistory: currentHistory
                };
            };

            const pastTask = createTaskRow(lastMatchDate, false);
            const futureTask = createTaskRow(nextMatchDate, true);

            if (pastTask) taskList.push(pastTask);
            if (futureTask && (!pastTask || futureTask.targetDate.getTime() !== pastTask.targetDate.getTime())) {
                taskList.push(futureTask);
            }
        });

        const uniqueTasks = [];
        const seenKeys = new Set();
        taskList.forEach(t => {
           const key = `${t.job}_${t.targetDate.getTime()}`;
           if (!seenKeys.has(key)) { seenKeys.add(key); uniqueTasks.push(t); }
        });

        uniqueTasks.sort((a, b) => {
            if (a.category !== b.category) return a.category - b.category;
            if (a.category === 1) return a.diffDays - b.diffDays;
            if (a.category === 2) return a.targetDate - b.targetDate; 
            return a.targetDate - b.targetDate;
        });

        if (uniqueTasks.length > 0) {
            html = `<div style="width: 100%; max-width: 100%; box-sizing: border-box; overflow: visible;">
                <table style="width: 100%; max-width: 100%; min-width: 0; text-align:left; table-layout: fixed; font-size: 14px; box-sizing: border-box; word-break: break-word;">
                <thead>
                  <tr style="background:#f0f0f0;">
                    <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px;">Công việc</th>
                    <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; width: 270px;">Hạn / Trạng thái</th>
                  </tr>
                </thead>
                <tbody>`;
            
            uniqueTasks.forEach(task => {
                const displayDate = `${String(task.targetDate.getDate()).padStart(2,'0')}/${String(task.targetDate.getMonth()+1).padStart(2,'0')}/${task.targetDate.getFullYear()}`;
                let bg = task.category === 1 ? "#ebf5fb" : (task.category === 2 ? "#fdedec" : "");

                let statusHtml = `<span style="color: ${task.statusColor}; font-weight:bold; font-size: 0.9em;">${task.statusText}</span>`;
                if (task.currentHistory && task.currentHistory.length > 0) {
                    const lastUpdate = task.currentHistory[task.currentHistory.length - 1];
                    statusHtml += `<br><span style="font-size: 0.85em; color: #2980b9; font-style: italic;">↳ Tiến độ: ${lastUpdate.note}</span>`;
                }

                html += `
                <tr class="admin-task-row" data-task-id="${task.id}" style="background:${bg}; cursor: pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1" title="Nhấn để chuyển đến xử lý công việc này">
                    <td style="padding: 8px; border: 1px solid #ccc; text-align: left; font-size: 14px; word-break: break-word;">
                        <b>${task.job}</b>
                        ${task.note ? `<br><span style="font-size: 0.85em; color: #7f8c8d;">${task.note}</span>` : ""}
                    </td>
                    <td style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; word-break: break-word;">
                        ${displayDate} ${task.time}<br>
                        ${statusHtml}
                    </td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        } else {
            html = `<p style="text-align:center; color:#2ecc71; font-weight:bold; font-size: 16px; padding: 20px 0;">🎉 Tuyệt vời! Không có công việc Admin nào quá hạn hoặc sắp đến hạn trong 7 ngày tới.</p>`;
        }

    } else {
        document.querySelector("#personalScheduleModal h2").textContent = "Ca làm việc gần nhất của bạn";
        const allShiftRules = allPatternsData.filter(p => p.type === 'shift_rotation');
        const adminRulesAll = allPatternsData.filter(p => p.type === 'administrative');
        
        let foundDayHtml = "";
        
        for (let i = 0; i <= 14; i++) {
            const d = new Date(); 
            d.setDate(d.getDate() + i);
            const checkDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()); 

            const dayNum = d.getDay() === 0 ? 8 : d.getDay() + 1;
            const isToday = i === 0;
            const dateStr = d.toLocaleDateString("vi-VN");
            const thuDisplay = d.getDay() === 0 ? 'Chủ Nhật' : 'Thứ ' + (d.getDay() + 1);
            const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const swapsForDate = allSwapsData.filter(s => s.date === isoDate);

            let matchedShifts = [];

            adminRulesAll.forEach(rule => {
                if (!isRuleActiveOnDate(rule, checkDate)) return;
                if (Array.isArray(rule.workDaysOfWeek) && rule.workDaysOfWeek.includes(dayNum)) {
                    let finalName = rule.displayName;
                    const swap = swapsForDate.find(s => s.user1 === finalName);
                    let swapText = "";
                    if (swap) {
                        finalName = swap.user2;
                        swapText = ` 🔄 (Thay ${swap.user1})`;
                    }
                    if (finalName === myDisplayName) {
                        const groupTag = rule.shiftGroup ? ` [${rule.shiftGroup}]` : ` [Hành chính]`;
                        matchedShifts.push(`👤 ${finalName} (${rule.startTime} – ${rule.endTime}${rule.isNextDay ? " (hôm sau)" : ""})${groupTag}${swapText}`);
                    }
                }
            });

            if (allShiftRules.length > 0) {
                const shiftGroups = {};
                allShiftRules.forEach(rule => {
                    const groupName = rule.shiftGroup || "Vận hành";
                    if (!shiftGroups[groupName]) shiftGroups[groupName] = [];
                    shiftGroups[groupName].push(rule);
                });
                for (const group in shiftGroups) {
                    const groupRules = shiftGroups[group];
                    const sortedGroupRules = [...groupRules].sort(sortShiftRules);
                    const groupRefDate = (sortedGroupRules[0] && sortedGroupRules[0].patternStartDate) ? new Date(sortedGroupRules[0].patternStartDate + 'T00:00:00') : null;

                    if (groupRefDate && !isNaN(groupRefDate.getTime())) {
                        const allMembersToday = groupRules.filter(r => isRuleActiveOnDate(r, checkDate)).sort(sortShiftRules);
                        if (allMembersToday.length > 0) {
                            const n_today = allMembersToday.length;
                            const daysSinceToday = getDaysDifference(checkDate, groupRefDate);
                            const workerIndexToday = (daysSinceToday % n_today + n_today) % n_today;
                            const workerToday = allMembersToday[workerIndexToday];
                            
                            if (workerToday) {
                                let finalName = workerToday.displayName;
                                const swap = swapsForDate.find(s => s.user1 === finalName);
                                let swapText = "";
                                if (swap) {
                                    finalName = swap.user2;
                                    swapText = ` 🔄 (Thay ${swap.user1})`;
                                }
                                if (finalName === myDisplayName) {
                                    const groupTag = workerToday.shiftGroup ? ` [${workerToday.shiftGroup}]` : ` [Vận hành]`;
                                    matchedShifts.push(`👤 ${finalName} (${workerToday.startTime} – ${workerToday.endTime}${workerToday.isNextDay ? " (hôm sau)" : ""})${groupTag}${swapText}`);
                                }
                            }
                        }
                    }
                }
            }

            const myShiftGroup = myPattern ? myPattern.shiftGroup : null;
            const allRuleJobs = allRulesData.filter(rule => 
                !rule.is_admin_job && ruleMatchesDate(rule, checkDate)
            );
            const personalRuleJobs = allRuleJobs.filter(rule => {
                if (rule.is_common_job && rule.targetGroup && rule.targetGroup !== 'all' && rule.targetGroup !== myShiftGroup) return false;
                return true;
            });

            const hasCommonJobs = personalRuleJobs.some(r => r.is_common_job);

            if (matchedShifts.length > 0 || hasCommonJobs) {
                let tasksHtml = "";
                if (personalRuleJobs.length > 0) {
                    const tasksArray = personalRuleJobs.map(task => {
                        const noteDisplay = (task.note || "").replace("[CVChung]", "<b style='color:#3498db'>[CVChung]</b>");
                        let noteString = noteDisplay && noteDisplay !== "" ? ` <i>— ${noteDisplay}</i>` : "";
                        return `<div style="margin-bottom: 3px; word-break: break-word;">- ${task.job} ${task.time ? `(${task.time})` : ""}${noteString}</div>`;
                    });
                    tasksHtml = tasksArray.join('');
                } else {
                    tasksHtml = "<i style='font-size: 0.9em; color:#777;'>Không có công việc chung nào được gán.</i>";
                }

                const shiftContent = matchedShifts.length > 0 ? matchedShifts.join("<br>") : "<i style='color:#7f8c8d; font-weight:normal;'>Không có ca trực (Nghỉ)</i>";

                foundDayHtml = `<div style="width: 100%; max-width: 100%; box-sizing: border-box; overflow: visible;">
                  <table style="width: 100%; max-width: 100%; min-width: 0; text-align:left; table-layout: fixed; font-size: 14px; box-sizing: border-box; word-break: break-word;">
                  <thead>
                    <tr style="background:#f0f0f0;">
                      <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; width: 40%;">Ngày & Ca</th>
                      <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; width: 60%;">Công việc</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr${isToday ? " style='background:#dff0ff;'" : ""}>
                      <td style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; word-break: break-word; line-height: 1.4;"><strong style="font-size: 15px; color:#273668;">${thuDisplay}</strong><br><span style="font-size: 13px;">${dateStr}</span><br><br><span style="font-size: 13px; color: #d35400; font-weight:500;">${shiftContent}</span></td>
                      <td style="padding: 8px; border: 1px solid #ccc; text-align: left; font-size: 14px; word-break: break-word; line-height: 1.5;">${tasksHtml}</td>
                    </tr>
                  </tbody>
                  </table></div>`;
                break; 
            }
        }

        if (foundDayHtml !== "") {
            html = foundDayHtml;
        } else {
            html = `<p style="text-align:center; color:#e74c3c; font-size: 15px; padding: 20px;">Bạn không có lịch làm việc nào trong 14 ngày tới.</p>`;
        }
    
    personalScheduleDetails.innerHTML = html;
}
}

// --- LOGIC LỊCH THÁNG ---
let currentMonthView = new Date();

function openMonthScheduleModal() {
    currentMonthView = new Date(currentlyViewedDate); 
    renderMonthCalendar(currentMonthView.getFullYear(), currentMonthView.getMonth());
    document.getElementById("monthScheduleModal").style.display = "block";
    toggleBodyScroll(true);
}

function closeMonthScheduleModal() {
    document.getElementById("monthScheduleModal").style.display = "none";
    toggleBodyScroll(false);
}

document.getElementById("monthViewBtn").addEventListener("click", openMonthScheduleModal);
document.getElementById("closeMonthScheduleModal").addEventListener("click", closeMonthScheduleModal);

document.getElementById("prevMonthBtn").addEventListener("click", () => {
    currentMonthView.setMonth(currentMonthView.getMonth() - 1);
    renderMonthCalendar(currentMonthView.getFullYear(), currentMonthView.getMonth());
});

document.getElementById("nextMonthBtn").addEventListener("click", () => {
    currentMonthView.setMonth(currentMonthView.getMonth() + 1);
    renderMonthCalendar(currentMonthView.getFullYear(), currentMonthView.getMonth());
});

function renderMonthCalendar(year, month) {
    const title = document.getElementById("monthScheduleTitle");
    title.textContent = `Lịch Tháng ${month + 1} / ${year}`;
    
    const container = document.getElementById("monthCalendarContainer");
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;
    
    const daysInMonth = lastDay.getDate();
    
    let html = `<div class="calendar-grid">`;
    const dayNames = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    
    dayNames.forEach(d => {
        html += `<div class="calendar-header">${d}</div>`;
    });
    
    for (let i = 0; i < startDayOfWeek; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }
    
    const today = new Date();
    
    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
        
        const workers = getWorkersForDateMonth(d, allPatternsData, allSwapsData);
        
        const shortNames = workers.map(name => {
            const parts = name.trim().split(/\s+/);
            return `<div>${parts[parts.length - 1]}</div>`; 
        }).join(""); 
        
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''}">
                <div class="calendar-date">${day}</div>
                <div class="calendar-workers">${shortNames}</div>
            </div>
        `;
    }
    
    let totalCells = startDayOfWeek + daysInMonth;
    let remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < remainingCells; i++) {
         html += `<div class="calendar-day empty"></div>`;
    }
    
    html += `</div>`;
    container.innerHTML = html;
}
