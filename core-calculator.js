// core-calculator.js
// Bộ Não dùng chung cho hệ thống Tính toán Lưu lượng & Khoán

export function formatISODate(d) {
    if (!(d instanceof Date) || isNaN(d)) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function formatVNDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return "N/A";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
}

export function safeFixed(val, digits = 1, forceDecimals = false) { 
    if (typeof val !== "number" || isNaN(val)) return "N/A";
    return new Intl.NumberFormat('vi-VN', {
        minimumFractionDigits: forceDecimals ? digits : 0,
        maximumFractionDigits: digits
    }).format(val);
}

export function getWeekStart(date, weekDayStart) {
    const d = new Date(date);
    const diff = (d.getDay() - weekDayStart + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0,0,0,0);
    return d;
}

export function getMonthStart(date, monthDayStart) {
    const d = new Date(date.getFullYear(), date.getMonth(), monthDayStart);
    d.setHours(0,0,0,0);
    return d;
}

export function getYearStart(date, yearDayStart) {
    const d = new Date(date.getFullYear(), 0, yearDayStart);
    d.setHours(0,0,0,0);
    return d;
}

export function findValueExact(readings, dateMark) {
    const dateMarkStr = formatISODate(dateMark);
    const exactReadings = readings.filter(r => formatISODate(r.date) === dateMarkStr);
    
    if (exactReadings.length === 0) return null;

    exactReadings.sort((a, b) => a.date - b.date); 
    return exactReadings[0].value;
}

export function findLatestReadingBeforeOrOnMark(readings, dateMark) {
    const pastReadings = readings.filter(r => r.date <= dateMark); 
    
    if (pastReadings.length === 0) return null;

    pastReadings.sort((a, b) => {
        if (b.date.getTime() !== a.date.getTime()) return b.date - a.date;
        return b.value - a.value; 
    }); 

    return pastReadings[0];
}

export function getCompanyConfigAtDate(company, dateStr, allCompanyConfigs) {
    const configs = allCompanyConfigs.filter(c => c.company === company);
    if (configs.length === 0) return null;
    configs.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const validConfig = configs.find(c => c.effectiveDate <= dateStr);
    return validConfig || configs[configs.length - 1];
}

export function calculateWorkingDays(startDate, endDate, companyName, config, processedHolidayData, allCompanyConfigs) {
    const safeCompany = (typeof companyName === 'string') ? companyName.trim() : companyName;

    if (!startDate || !endDate || startDate > endDate) {
        return { workingDays: 0, dayOffsCount: 0, dayOffDates: [] }; 
    }

    const companyHolidays = (processedHolidayData && processedHolidayData[safeCompany]) 
                                ? processedHolidayData[safeCompany] 
                                : { dayOffs: new Set(), specialWorkdays: new Set() };

    let totalDaysInPeriod = 0;
    const dayOffsSet = new Set(); 

    const endRange = new Date(endDate);
    endRange.setHours(23, 59, 59, 999);

    let currentDay = new Date(startDate);
    currentDay.setHours(0,0,0,0);
    
    while (currentDay <= endRange) {
        const currentDayStr = formatISODate(currentDay);
        totalDaysInPeriod++;
        const dayOfWeek = currentDay.getDay(); 
        let isDefaultHoliday = false;
        const currentConfig = getCompanyConfigAtDate(safeCompany, currentDayStr, allCompanyConfigs);

        if (currentConfig && currentConfig.defaultHolidays) {
            isDefaultHoliday = currentConfig.defaultHolidays.includes(dayOfWeek);
        } else {
            const defaultHolidaySetting = config.defaultHolidays ? config.defaultHolidays[safeCompany] : undefined;
            if (defaultHolidaySetting === 'sat-sun' || defaultHolidaySetting === 'sat_sun') {
                isDefaultHoliday = (dayOfWeek === 0 || dayOfWeek === 6);
            } else if (defaultHolidaySetting === 'sun' || defaultHolidaySetting === 'sun_only') {
                isDefaultHoliday = (dayOfWeek === 0);
            } else if (defaultHolidaySetting === 'sat') {
                isDefaultHoliday = (dayOfWeek === 6);
            }
        }

        let isOff = false;
        if (companyHolidays.dayOffs && companyHolidays.dayOffs.has(currentDayStr)) {
            isOff = true; 
        } else if (isDefaultHoliday) {
            if (companyHolidays.specialWorkdays && companyHolidays.specialWorkdays.has(currentDayStr)) {
                isOff = false; 
            } else {
                isOff = true; 
            }
        }

        if (isOff) {
            dayOffsSet.add(currentDayStr);
        }
        currentDay.setDate(currentDay.getDate() + 1);
    }
    
    const specialDayOffs = dayOffsSet.size;
    const dayOffDates = Array.from(dayOffsSet);
    let netWorkingDays = totalDaysInPeriod - specialDayOffs;

    return { workingDays: netWorkingDays, dayOffsCount: specialDayOffs, dayOffDates };
}

export function getPeriodsInFilter(readings, from, to, type, config, processedHolidayData, companyName, allCompanyConfigs) {
    const today = new Date(); 
    today.setHours(23, 59, 59, 999); 
    
    let stepFn, getStartFn;
    if (type === "week") {
        stepFn = d => { const nd = new Date(d); nd.setDate(nd.getDate() + 7); return nd; };
        getStartFn = d => getWeekStart(d, config.weekDayStart);
    } else if (type === "month") {
        stepFn = d => { const nd = new Date(d); nd.setMonth(nd.getMonth() + 1); return nd; };
        getStartFn = d => getMonthStart(d, config.monthDayStart);
    } else {
        stepFn = d => { const nd = new Date(d); nd.setFullYear(nd.getFullYear() + 1); return nd; };
        getStartFn = d => getYearStart(d, config.yearDayStart);
    }

    const periods = [];
    let cursor = new Date(from);
    while (cursor <= to) {
        const start = getStartFn(cursor);
        const end = stepFn(start);
        if (end > from && start <= to) periods.push({ start, end });
        cursor = end;
    }

    const uniq = [];
    const seen = new Set();
    for (const p of periods) {
        const key = formatISODate(p.start);
        if (!seen.has(key)) { uniq.push(p); seen.add(key); }
    }
    uniq.sort((a,b) => b.start - a.start);

    const currentStart = getStartFn(new Date()); 
    const current = uniq.find(p => formatISODate(p.start) === formatISODate(currentStart));
    const result = { current: null, past: [] };

    for (const p of uniq) {
        const isCurrent = current && formatISODate(p.start) === formatISODate(current.start);
        const endMarkDate = p.end; 
        
        let startValue, endValue, latestDataDate = null;
        let workingDaysForAvg = 0, dayOffsCount = 0, dayOffDates = [], label = "";
        
        startValue = findValueExact(readings, p.start);

        if (isCurrent) {
            const latestReading = findLatestReadingBeforeOrOnMark(readings, today);
            endValue = latestReading ? latestReading.value : null;
            latestDataDate = latestReading ? latestReading.date : null;

            if (latestDataDate) {
                const consumedEndDate = new Date(latestDataDate.getTime());
                consumedEndDate.setDate(consumedEndDate.getDate() - 1);
                const avgResult = calculateWorkingDays(p.start, consumedEndDate, companyName, config, processedHolidayData, allCompanyConfigs);
                workingDaysForAvg = avgResult.workingDays; 
                dayOffsCount = avgResult.dayOffsCount; 
                dayOffDates = avgResult.dayOffDates; 
            }
        } else {
            endValue = findValueExact(readings, endMarkDate);
            const dayBeforeEndMark = new Date(endMarkDate.getTime()); 
            dayBeforeEndMark.setTime(dayBeforeEndMark.getTime() - 86400000); 
            
            const pastResult = calculateWorkingDays(p.start, dayBeforeEndMark, companyName, config, processedHolidayData, allCompanyConfigs); 
            workingDaysForAvg = pastResult.workingDays;
            dayOffsCount = pastResult.dayOffsCount; 
            dayOffDates = pastResult.dayOffDates;    
        }
        
        if (isCurrent) label = type === "week" ? "Tuần hiện tại" : type === "month" ? "Tháng hiện tại" : "Năm hiện tại";
        else label = type === "week" ? `Tuần: ${formatVNDate(p.start)} - ${formatVNDate(p.end)}` : type === "month" ? `Tháng: ${formatVNDate(p.start)} - ${formatVNDate(p.end)}` : `Năm: ${formatVNDate(p.start)} - ${formatVNDate(p.end)}`;
        
        let numericTotal = "N/A";
        if (startValue !== null && endValue !== null) {
            let diff = endValue - startValue;
            if (diff < 0) diff = 0; 
            numericTotal = diff; 
        } 
        
        const avg = (typeof numericTotal === "number" && workingDaysForAvg > 0) ? (numericTotal / workingDaysForAvg) : "N/A";

        if (isCurrent) result.current = { label, total: numericTotal, avg, startValue, endValue, workingDaysForAvg, start: p.start, end: p.end, latestDataDate, dayOffsCount, holidayDates: dayOffDates }; 
        else result.past.push({ label, total: numericTotal, avg, startValue, endValue, workingDaysForAvg, start: p.start, end: p.end, latestDataDate, dayOffsCount, holidayDates: dayOffDates }); 
    }

    if (!result.current) result.current = { label: type==="week"?"Tổng tuần hiện tại":type==="month"?"Tổng tháng hiện tại":"Năm hiện tại", total:"N/A", avg:"N/A", startValue: null, endValue: null, workingDaysForAvg: 0, dayOffsCount: 0, holidayDates: [] };
    return result;
}

export function getBillingPeriodsInFilter(readings, from, to, config, processedHolidayData, companyName, allCompanyConfigs) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    const stepFn = start => { 
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
        end.setMonth(end.getMonth() + 1);
        return end;
    };

    const getStartFn = d => {
        const currentConfig = getCompanyConfigAtDate(companyName, formatISODate(d), allCompanyConfigs);
        const endDay = currentConfig && currentConfig.billingDay ? Number(currentConfig.billingDay) : 15;
        let end = new Date(d.getFullYear(), d.getMonth(), endDay, 0, 0, 0, 0);

        if (d > end) end.setMonth(end.getMonth() + 1);
        
        const start = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
        start.setMonth(start.getMonth() - 1); 
        start.setDate(endDay + 1);            
        return start;
    };
    
    const periods = [];
    let cursor = new Date(from);
    while (cursor <= to) {
        const start = getStartFn(cursor);
        const end = stepFn(start);
        if (end > from && start <= to) periods.push({ start, end });
        cursor = end; 
    }

    const uniq = [];
    const seen = new Set();
    for (const p of periods) {
        const key = formatISODate(p.start);
        if (!seen.has(key)) { uniq.push(p); seen.add(key); }
    }
    uniq.sort((a,b) => b.start - a.start);

    const currentStart = getStartFn(new Date()); 
    const current = uniq.find(p => formatISODate(p.start) === formatISODate(currentStart));
    const result = { current: null, past: [] };

    for (const p of uniq) {
        const isCurrent = current && formatISODate(p.start) === formatISODate(current.start);
        let label = "";
        if (isCurrent) label = `Kỳ thu phí hiện tại: ${formatVNDate(p.start)} -> Hôm nay`; 
        else label = `Kỳ thu phí: ${formatVNDate(p.start)} - ${formatVNDate(new Date(p.end.getTime() - 86400000))}`;

        let startValue, endValue, latestDataDate = null;
        let numericTotal = "N/A";

        startValue = findValueExact(readings, p.start);

        if (isCurrent) {
            const latestReading = findLatestReadingBeforeOrOnMark(readings, today);
            endValue = latestReading ? latestReading.value : null;
            latestDataDate = latestReading ? latestReading.date : null;
        } else {
            const lastDayOfPeriod = new Date(p.end.getTime());
            lastDayOfPeriod.setDate(lastDayOfPeriod.getDate() - 1); 
            endValue = findValueExact(readings, lastDayOfPeriod);
        }

        if (startValue !== null && endValue !== null) {
            let diff = endValue - startValue;
            if (diff < 0) diff = 0;
            numericTotal = diff;
        }

        let workingDaysForAvg = 0, dayOffsCount = 0, dayOffDates = [];

        if (isCurrent) {
            if (latestDataDate) {
                const consumedEndDate = new Date(latestDataDate.getTime());
                consumedEndDate.setDate(consumedEndDate.getDate() - 1);
                
                const avgResult = calculateWorkingDays(p.start, consumedEndDate, companyName, config, processedHolidayData, allCompanyConfigs);
                workingDaysForAvg = avgResult.workingDays;
                dayOffsCount = avgResult.dayOffsCount; 
                dayOffDates = avgResult.dayOffDates; 
            }
        } else {
            const endDayForCounting = new Date(p.end.getTime());
            endDayForCounting.setDate(endDayForCounting.getDate() - 1); 
            
            const pastResult = calculateWorkingDays(p.start, endDayForCounting, companyName, config, processedHolidayData, allCompanyConfigs);
            workingDaysForAvg = pastResult.workingDays;
            dayOffsCount = pastResult.dayOffsCount;
            dayOffDates = pastResult.dayOffDates;
        }

        const periodEndStr = formatISODate(p.end);
        const currentConfig = getCompanyConfigAtDate(companyName, periodEndStr, allCompanyConfigs);
        const QUOTA_MULTIPLIER = currentConfig 
            ? (Number(currentConfig.quotaMultiplier) || 0) 
            : (config.quotaMultipliers[companyName] !== undefined ? Number(config.quotaMultipliers[companyName]) : 0);

        const quotaValue = (workingDaysForAvg * QUOTA_MULTIPLIER);
        const avg = (typeof numericTotal === "number" && workingDaysForAvg > 0) ? (numericTotal / workingDaysForAvg) : "N/A";

        if (isCurrent) result.current = { label, total: numericTotal, avg, quota: quotaValue, startValue, endValue, workingDaysForAvg, quotaMultiplier: QUOTA_MULTIPLIER, start: p.start, end: p.end, latestDataDate, dayOffsCount, holidayDates: dayOffDates };
        else if (result.past.length < 12) result.past.push({ label, total: numericTotal, avg, quota: quotaValue, startValue, endValue, workingDaysForAvg, quotaMultiplier: QUOTA_MULTIPLIER, start: p.start, end: p.end, latestDataDate, dayOffsCount, holidayDates: dayOffDates });
    }

    if (!result.current) result.current = { label: "Tổng Kỳ thu phí hiện tại", total:"N/A", avg:"N/A", quota:"N/A", startValue: null, endValue: null, workingDaysForAvg: 0, quotaMultiplier: 0, dayOffsCount: 0, holidayDates: [] };
    return result;
}
