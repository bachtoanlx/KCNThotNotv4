// autoplan-core.js
// Bộ Não chuyên biệt dùng cho việc xử lý logic Lịch làm việc & Ca trực

export function getWeekNumber(d) {
    let date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return [date.getUTCFullYear(), weekNo];
}

export function getWeekOfMonth(date) {
    const day = date.getDate();
    return Math.ceil(day / 7);
}

export function getDaysDifference(date1, date2) {
    const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
    const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
    return Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
}

export function isRuleActiveOnDate(rule, d) {
    // Đồng bộ logic với GAS: Cắt bỏ giờ phút giây, đưa về chuẩn 00:00:00
    const checkDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const startDate = new Date(rule.patternStartDate + 'T00:00:00');
    const endDate = rule.patternEndDate ? new Date(rule.patternEndDate + 'T00:00:00') : null;
    if (checkDate < startDate) return false;
    // Dùng >= để đảm bảo quy tắc kết thúc ngay từ đầu ngày endDate
    if (endDate && checkDate >= endDate) return false;
    return true;
}

export function sortShiftRules(a, b) {
    // 1. So sánh Ngày
    const dateA = new Date(a.patternStartDate);
    const dateB = new Date(b.patternStartDate);
    if (dateA - dateB !== 0) return dateA - dateB;

    // 2. So sánh Giờ
    const timeA = a.startTime || "00:00";
    const timeB = b.startTime || "00:00";
    if (timeA.localeCompare(timeB) !== 0) return timeA.localeCompare(timeB);

    // 3. So sánh Tên
    return (a.displayName || "").localeCompare(b.displayName || "");
}

export function ruleMatchesDate(rule, d) {
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    if (rule.ruleStartDate && rule.ruleStartDate !== "") {
        if (isoDate < rule.ruleStartDate) return false;
    }
    if (rule.ruleEndDate && rule.ruleEndDate !== "") {
        if (isoDate > rule.ruleEndDate) return false;
    }
    if (rule.exactDate && rule.exactDate !== "") {
        return rule.exactDate === isoDate;
    }

    const dayNum = d.getDate();
    const monthNum = d.getMonth() + 1;
    const weekOfMonth = getWeekOfMonth(d);
    const weekDay = d.getDay() === 0 ? 8 : d.getDay() + 1;

    if (rule.dom && rule.dom !== "" && rule.dom !== String(dayNum)) return false;
    if (rule.day && rule.day !== "" && rule.day !== "all" && Number(rule.day) !== Number(weekDay)) return false;
    if (rule.week && rule.week !== "" && rule.week !== "all" && Number(rule.week) !== Number(weekOfMonth)) return false;
    if (rule.month && rule.month !== "" && rule.month !== "all" && Number(rule.month) !== Number(monthNum)) return false;

    return true;
}

export function getLastMatchDate(rule) {
    const today = new Date();
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        if (ruleMatchesDate(rule, d)) return d;
    }
    return null;
}

export function getNextMatchDate(rule) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
        const d = new Date(tomorrow);
        d.setDate(tomorrow.getDate() + i);
        if (ruleMatchesDate(rule, d)) return d;
    }
    return null;
}

export function getNormalizedFirstChar(str) {
    if (!str || str.trim() === "") return '?';
    return str
        .trim()
        .normalize('NFD') // Tách ký tự và dấu
        .replace(/[\u0300-\u036f]/g, '') // Xóa dấu
        .charAt(0)
        .toUpperCase();
}

export function getWorkersForDateMonth(d, allPatternsData, allSwapsData) {
    const adminRules = allPatternsData.filter(p => p.type === 'administrative');
    const allShiftRules = allPatternsData.filter(p => p.type === 'shift_rotation');
    let workers = [];
    
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const swapsForDate = allSwapsData.filter(s => s.date === isoDate);
    const yesterday = new Date(d);
    yesterday.setDate(d.getDate() - 1);
    const dayOfWeek = d.getDay() === 0 ? 8 : d.getDay() + 1;

    adminRules.forEach(rule => {
        if (!isRuleActiveOnDate(rule, d) || !Array.isArray(rule.workDaysOfWeek)) return;
        if (rule.workDaysOfWeek.includes(dayOfWeek)) {
            let displayName = rule.displayName;
            const swap = swapsForDate.find(s => s.user1 === displayName);
            if (swap) displayName = swap.user2;
            if (!workers.includes(displayName)) workers.push(displayName);
        }
    });

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
            const groupRefDate = new Date(sortedGroupRules[0].patternStartDate + 'T00:00:00');
            
            const membersYesterday = groupRules.filter(rule => isRuleActiveOnDate(rule, yesterday)).sort(sortShiftRules);
            const membersToday = groupRules.filter(rule => isRuleActiveOnDate(rule, d)).sort(sortShiftRules);
            
            let workerYesterdayName = null;
            let isNightYesterday = false;
            
            if (membersYesterday.length > 0) {
                const n_yesterday = membersYesterday.length;
                const daysSinceYesterday = getDaysDifference(yesterday, groupRefDate);
                const workerIndexYesterday = (daysSinceYesterday % n_yesterday + n_yesterday) % n_yesterday;
                const workerYesterday = membersYesterday[workerIndexYesterday];
                if (workerYesterday) {
                    workerYesterdayName = workerYesterday.displayName;
                    const [startH, startM] = (workerYesterday.startTime || "00:00").split(':').map(Number);
                    const [endH, endM] = (workerYesterday.endTime || "00:00").split(':').map(Number);
                    if ( (endH < startH) || (endH === startH && endM < startM) ) isNightYesterday = true;
                    else if (workerYesterday.isNextDay === true && startH === endH && startM === endM) isNightYesterday = true;
                }
            }

            if (membersToday.length > 0) {
                const n_today = membersToday.length;
                const daysSinceToday = getDaysDifference(d, groupRefDate);
                const workerIndexToday = (daysSinceToday % n_today + n_today) % n_today;
                const workerToday = membersToday[workerIndexToday];
                
                if (workerToday) {
                    if (!isNightYesterday || workerYesterdayName !== workerToday.displayName) {
                        let displayName = workerToday.displayName;
                        const swap = swapsForDate.find(s => s.user1 === displayName);
                        if (swap) displayName = swap.user2;
                        if (!workers.includes(displayName)) workers.push(displayName);
                    }
                }
            }
        }
    }
    return workers;
}