/**
 * CHATBOT FIREBASE QUERIES
 * Module chứa các function truy vấn Firebase cho chatbot
 * Sử dụng: import vào trangchu.html và gọi khi AI cần dữ liệu
 */

// Import db từ script.js (đã export)
import { db, auth } from "./script.js";
import { formatISODate, getCompanyConfigAtDate, getPeriodsInFilter, getBillingPeriodsInFilter } from "./core-calculator.js";

// Import IndexedDB
import { saveToLocalDB, getAllFromLocalDB, setLastSyncTime, getLastSyncTime, deleteFromLocalDB } from "./localDB.js";

// Import Firestore functions trực tiếp từ Firebase
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    getDoc,
    doc,
    setDoc,
    serverTimestamp,
    getAggregateFromServer,
    sum,
    average,
    count
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// Helper để xác định thời điểm bắt đầu của dữ liệu đã cache trong IndexedDB
function getStoreCacheStartDate(localData, dateField1, dateField2) {
    if (!localData || localData.length === 0) return null;
    let minDate = null;
    for (const item of localData) {
        const d = item[dateField1] || (dateField2 ? item[dateField2] : null);
        if (d) {
            if (!minDate || d < minDate) {
                minDate = d;
            }
        }
    }
    return minDate;
}

/**
 * Đồng bộ ngầm delta cho reports_1 (xả thải)
 */
export async function syncDeltaReports1() {
    try {
        const lastSync = await getLastSyncTime("reports_1");
        let maxTime = lastSync;

        // 1. Đồng bộ Tombstone (Dữ liệu bị xóa)
        if (lastSync > 0) {
            const qDel = query(collection(db, "sync_deletes"), 
                where("deletedAt", ">", new Date(lastSync))
            );
            const snapDel = await getDocs(qDel);
            if (!snapDel.empty) {
                const relevantDeletes = snapDel.docs
                    .map(d => d.data())
                    .filter(data => data.collectionName === "reports_1");
                
                relevantDeletes.forEach(data => {
                    const t = data.deletedAt?.toMillis?.() || 0;
                    if (t > maxTime) maxTime = t;
                });

                const idsToDelete = relevantDeletes.map(data => data.docId);
                if (idsToDelete.length > 0) {
                    await deleteFromLocalDB("reports_1", idsToDelete);
                }
            }
        }

        // 2. Đồng bộ Upserts (Dữ liệu Mới/Sửa)
        let newRecords = [];
        if (lastSync === 0) {
            // TỐI ƯU FIREBASE: Lần đầu chỉ tải 60 ngày gần nhất thay vì TOÀN BỘ
            const sixtyDaysAgo = new Date();
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
            const qInit = query(collection(db, "reports_1"), where("ngay_ghi", ">=", formatISODate(sixtyDaysAgo)));
            const snapInit = await getDocs(qInit);
            newRecords = snapInit.docs.map(doc => ({id: doc.id, ...doc.data()}));
        } else {
            // Tải dữ liệu thay đổi
            const qCreated = query(collection(db, "reports_1"), where("createdAt", ">", new Date(lastSync)));
            const qUpdated = query(collection(db, "reports_1"), where("updatedAt", ">", new Date(lastSync)));
            const [snapC, snapU] = await Promise.all([getDocs(qCreated), getDocs(qUpdated)]);
            const map = new Map();
            snapC.docs.forEach(d => map.set(d.id, {id: d.id, ...d.data()}));
            snapU.docs.forEach(d => map.set(d.id, {id: d.id, ...d.data()}));
            newRecords = Array.from(map.values());
        }

        if (newRecords.length > 0) {
            const parsedRecords = newRecords.map(data => ({
                ...data,
                _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
                _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now()
            }));
            await saveToLocalDB("reports_1", parsedRecords);

            newRecords.forEach(r => {
                const t = r.updatedAt?.toMillis?.() || r.createdAt?.toMillis?.() || 0;
                if (t > maxTime) maxTime = t;
            });
        }

        // Cập nhật mốc thời gian đồng bộ sử dụng thời gian của Server (maxTime)
        if (maxTime > lastSync) {
            await setLastSyncTime("reports_1", maxTime);
        }
    } catch (e) {
        console.warn("Lỗi đồng bộ reports_1:", e);
    }
}

/**
 * Đồng bộ ngầm delta cho reports_2 (ngày nghỉ/làm đặc biệt)
 */
export async function syncDeltaReports2() {
    try {
        const lastSync = await getLastSyncTime("reports_2");
        let maxTime = lastSync;

        // 1. Đồng bộ Tombstone (Dữ liệu bị xóa)
        if (lastSync > 0) {
            const qDel = query(collection(db, "sync_deletes"), 
                where("deletedAt", ">", new Date(lastSync))
            );
            const snapDel = await getDocs(qDel);
            if (!snapDel.empty) {
                const relevantDeletes = snapDel.docs
                    .map(d => d.data())
                    .filter(data => data.collectionName === "reports_2");
                
                relevantDeletes.forEach(data => {
                    const t = data.deletedAt?.toMillis?.() || 0;
                    if (t > maxTime) maxTime = t;
                });

                const idsToDelete = relevantDeletes.map(data => data.docId);
                if (idsToDelete.length > 0) {
                    await deleteFromLocalDB("reports_2", idsToDelete);
                }
            }
        }

        // 2. Đồng bộ Upserts (Dữ liệu Mới/Sửa)
        let newRecords = [];
        if (lastSync === 0) {
            // TỐI ƯU FIREBASE: Lần đầu Deep Search chỉ tải 60 ngày gần nhất
            const sixtyDaysAgo = new Date();
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
            const iso60 = formatISODate(sixtyDaysAgo);
            
            const qInit1 = query(collection(db, "reports_2"), where("ngay_nghi", ">=", iso60));
            const qInit2 = query(collection(db, "reports_2"), where("ngay_lam_db", ">=", iso60));
            const [snap1, snap2] = await Promise.all([getDocs(qInit1), getDocs(qInit2)]);
            
            const map = new Map();
            snap1.docs.forEach(doc => map.set(doc.id, {id: doc.id, ...doc.data()}));
            snap2.docs.forEach(doc => map.set(doc.id, {id: doc.id, ...doc.data()}));
            newRecords = Array.from(map.values());
        } else {
            // Tải dữ liệu thay đổi. Dùng song song 2 truy vấn để bắt cả mới và sửa
            const qCreated = query(collection(db, "reports_2"), where("createdAt", ">", new Date(lastSync)));
            const qUpdated = query(collection(db, "reports_2"), where("updatedAt", ">", new Date(lastSync)));
            const [snapC, snapU] = await Promise.all([getDocs(qCreated), getDocs(qUpdated)]);
            const map = new Map();
            snapC.docs.forEach(d => map.set(d.id, {id: d.id, ...d.data()}));
            snapU.docs.forEach(d => map.set(d.id, {id: d.id, ...d.data()}));
            newRecords = Array.from(map.values());
        }

        if (newRecords.length > 0) {
            const parsedRecords = newRecords.map(data => ({
                ...data,
                _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
                _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now()
            }));
            await saveToLocalDB("reports_2", parsedRecords);

            newRecords.forEach(r => {
                const t = r.updatedAt?.toMillis?.() || r.createdAt?.toMillis?.() || 0;
                if (t > maxTime) maxTime = t;
            });
        }

        // Cập nhật mốc thời gian đồng bộ sử dụng thời gian của Server (maxTime)
        if (maxTime > lastSync) {
            await setLastSyncTime("reports_2", maxTime);
        }
    } catch (e) {
        console.warn("Lỗi đồng bộ reports_2:", e);
    }
}


// ============================================
// 1. QUERIES CHO reports_1 (Chỉ số nước)
// ============================================

/**
 * Lấy chỉ số mới nhất của một công ty
 */
export async function getLatestCompanyIndex(companyName) {
    try {
        // 1. Thử tìm trong store reports_1 của IndexedDB trước
        const localData = await getAllFromLocalDB("reports_1");
        const companyData = localData.filter(item => item.company === companyName);
        if (companyData.length > 0) {
            companyData.sort((a, b) => (b.ngay_ghi || '').localeCompare(a.ngay_ghi || ''));
            const current = companyData[0];
            return {
                company: companyName,
                chi_so_dong_ho_hien_tai: current.chi_so || 0,
                ngay_ghi_hien_tai: current.ngay_ghi || 'N/A'
            };
        }

        // 2. Fallback Firebase Firestore
        const q = query(
            collection(db, "reports_1"),
            where("company", "==", companyName),
            orderBy("ngay_ghi", "desc"),
            limit(1)
        );
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const docSnap = snapshot.docs[0];
            const current = docSnap.data();
            const record = { id: docSnap.id, ...current };
            
            try {
                const parsed = {
                    ...record,
                    _createdAtMillis: record.createdAt?.toMillis ? record.createdAt.toMillis() : Date.now(),
                    _updatedAtMillis: record.updatedAt?.toMillis ? record.updatedAt.toMillis() : Date.now()
                };
                await saveToLocalDB("reports_1", [parsed]);
            } catch (cacheErr) {
                console.warn("Lỗi lưu cache getLatestCompanyIndex:", cacheErr);
            }

            return {
                company: companyName,
                chi_so_dong_ho_hien_tai: current.chi_so || 0,
                ngay_ghi_hien_tai: current.ngay_ghi || 'N/A'
            };
        }
        return null;
    } catch (error) {
        console.error(`Error fetching latest index for ${companyName}:`, error);
        return null;
    }
}

/**
 * Lấy lịch sử chỉ số của công ty trong khoảng thời gian
 */
export async function getCompanyIndexHistory(companyName, startDate, endDate) {
    try {
        // 1. Thử tìm trong store reports_1 của IndexedDB trước nếu khoảng ngày được bao phủ
        const localData = await getAllFromLocalDB("reports_1");
        const cacheStartDate = getStoreCacheStartDate(localData, "ngay_ghi");
        
        if (cacheStartDate && startDate >= cacheStartDate) {
            const companyData = localData.filter(item => 
                item.company === companyName && 
                item.ngay_ghi >= startDate && 
                item.ngay_ghi <= endDate
            );
            companyData.sort((a, b) => (b.ngay_ghi || '').localeCompare(a.ngay_ghi || ''));
            return companyData;
        }

        // 2. Fallback Firebase Firestore
        const q = query(
            collection(db, "reports_1"),
            where("company", "==", companyName),
            where("ngay_ghi", ">=", startDate),
            where("ngay_ghi", "<=", endDate),
            orderBy("ngay_ghi", "desc")
        );
        const snapshot = await getDocs(q);
        const records = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        if (records.length > 0) {
            try {
                const parsedRecords = records.map(data => ({
                    ...data,
                    _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
                    _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now()
                }));
                await saveToLocalDB("reports_1", parsedRecords);
            } catch (cacheErr) {
                console.warn("Lỗi lưu cache getCompanyIndexHistory:", cacheErr);
            }
        }
        
        return records;
    } catch (error) {
        console.error('Error fetching company index history:', error);
        return [];
    }
}

/**
 * Lấy tổng số công ty có trong hệ thống
 */
export async function getTotalCompanies() {
    try {
        const snapshot = await getDocs(collection(db, "company_configs"));
        return snapshot.size;
    } catch (error) {
        console.error('Error fetching total companies:', error);
        return 0;
    }
}

/**
 * Lấy danh sách tất cả công ty
 */
export async function getAllCompanies() {
    try {
        const snapshot = await getDocs(collection(db, "company_configs"));
        const groups = { group1: [], group2: [], group3: [] };
        let total = 0;
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.company) {
                total++;
                const g = data.group || 'group3'; // Mặc định là nhóm khoán
                if (groups[g]) groups[g].push(data.company);
                else groups['group3'].push(data.company);
            }
        });
        return {
            total: total,
            group1: groups.group1.sort(),
            group2: groups.group2.sort(),
            group3: groups.group3.sort()
        };
    } catch (error) {
        console.error('Error fetching all companies:', error);
        return [];
    }
}

// ============================================
// 2. QUERIES CHO reports_2 (Ngày nghỉ/làm)
// ============================================

/**
 * Lấy danh sách ngày nghỉ trong khoảng thời gian
 */
export async function getHolidays(startDate, endDate) {
    try {
        // 1. Thử tìm trong store reports_2 của IndexedDB trước nếu khoảng ngày được bao phủ
        const localData = await getAllFromLocalDB("reports_2");
        const cacheStartDate = getStoreCacheStartDate(localData, "ngay_nghi", "ngay_lam_db");
        
        if (cacheStartDate && startDate >= cacheStartDate) {
            const holidays = localData
                .filter(item => item.ngay_nghi && item.ngay_nghi >= startDate && item.ngay_nghi <= endDate)
                .map(item => ({
                    date: item.ngay_nghi,
                    ...item
                }));
            holidays.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            return holidays;
        }

        // 2. Fallback Firebase Firestore
        const q = query(
            collection(db, "reports_2"),
            where("ngay_nghi", ">=", startDate),
            where("ngay_nghi", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        const records = snapshot.docs.map(doc => ({
            date: doc.data().ngay_nghi,
            id: doc.id,
            ...doc.data()
        }));

        if (records.length > 0) {
            try {
                const parsedRecords = records.map(data => ({
                    ...data,
                    _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
                    _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now()
                }));
                await saveToLocalDB("reports_2", parsedRecords);
            } catch (cacheErr) {
                console.warn("Lỗi lưu cache getHolidays:", cacheErr);
            }
        }
        
        return records;
    } catch (error) {
        console.error('Error fetching holidays:', error);
        return [];
    }
}

/**
 * Lấy ngày nghỉ sắp tới gần nhất
 */
export async function getNextHoliday() {
    try {
        // 1. Thử tìm trong store reports_2 của IndexedDB trước
        const localData = await getAllFromLocalDB("reports_2");
        const today = new Date().toISOString().split('T')[0];
        const futureHolidays = localData.filter(item => item.ngay_nghi && item.ngay_nghi >= today);
        if (futureHolidays.length > 0) {
            futureHolidays.sort((a, b) => (a.ngay_nghi || '').localeCompare(b.ngay_nghi || ''));
            return futureHolidays[0];
        }

        // 2. Fallback Firebase Firestore
        const q = query(
            collection(db, "reports_2"),
            where("ngay_nghi", ">=", today),
            orderBy("ngay_nghi", "asc"),
            limit(1)
        );
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const docSnap = snapshot.docs[0];
            const current = docSnap.data();
            const record = { id: docSnap.id, ...current };
            
            try {
                const parsed = {
                    ...record,
                    _createdAtMillis: record.createdAt?.toMillis ? record.createdAt.toMillis() : Date.now(),
                    _updatedAtMillis: record.updatedAt?.toMillis ? record.updatedAt.toMillis() : Date.now()
                };
                await saveToLocalDB("reports_2", [parsed]);
            } catch (cacheErr) {
                console.warn("Lỗi lưu cache getNextHoliday:", cacheErr);
            }

            return current;
        }
        return null;
    } catch (error) {
        console.error('Error fetching next holiday:', error);
        return null;
    }
}

/**
 * Lấy danh sách ngày làm việc đặc biệt
 */
export async function getSpecialWorkdays(startDate, endDate) {
    try {
        // 1. Thử tìm trong store reports_2 của IndexedDB trước nếu khoảng ngày được bao phủ
        const localData = await getAllFromLocalDB("reports_2");
        const cacheStartDate = getStoreCacheStartDate(localData, "ngay_nghi", "ngay_lam_db");
        
        if (cacheStartDate && startDate >= cacheStartDate) {
            const workdays = localData
                .filter(item => item.isSpecialWorkday === true && item.ngay_lam_db && item.ngay_lam_db >= startDate && item.ngay_lam_db <= endDate)
                .map(item => ({
                    date: item.ngay_lam_db,
                    ...item
                }));
            workdays.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            return workdays;
        }

        // 2. Fallback Firebase Firestore
        const q = query(
            collection(db, "reports_2"),
            where("isSpecialWorkday", "==", true),
            where("ngay_lam_db", ">=", startDate),
            where("ngay_lam_db", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        const records = snapshot.docs.map(doc => ({
            date: doc.data().ngay_lam_db,
            id: doc.id,
            ...doc.data()
        }));

        if (records.length > 0) {
            try {
                const parsedRecords = records.map(data => ({
                    ...data,
                    _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
                    _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now()
                }));
                await saveToLocalDB("reports_2", parsedRecords);
            } catch (cacheErr) {
                console.warn("Lỗi lưu cache getSpecialWorkdays:", cacheErr);
            }
        }
        
        return records;
    } catch (error) {
        console.error('Error fetching special workdays:', error);
        return [];
    }
}

/**
 * Lấy cấu hình ngày nghỉ định kỳ của công ty
 */
export async function getCompanyHolidayConfig(companyName) {
    try {
        const [settingsSnap, companiesSnap] = await Promise.all([
            getDoc(doc(db, "settings", "reportConfig")),
            getDocs(query(collection(db, "company_configs"), where("company", "==", companyName)))
        ]);
        
        let defaultHolidays = [];
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        const globalDef = settings.defaultHolidays || {};
        
        const configs = companiesSnap.docs.map(d => d.data());
        if (configs.length > 0) {
            configs.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
            const latest = configs[0];
            if (latest.defaultHolidays) {
                defaultHolidays = latest.defaultHolidays;
            } else {
                const defSet = globalDef[companyName];
                if (defSet === 'sat_sun' || defSet === 'sat-sun') defaultHolidays = [0, 6];
                else if (defSet === 'sun_only' || defSet === 'sun') defaultHolidays = [0];
                else if (defSet === 'sat') defaultHolidays = [6];
            }
        } else {
            const defSet = globalDef[companyName];
            if (defSet === 'sat_sun' || defSet === 'sat-sun') defaultHolidays = [0, 6];
            else if (defSet === 'sun_only' || defSet === 'sun') defaultHolidays = [0];
            else if (defSet === 'sat') defaultHolidays = [6];
        }
        
        const dayMap = {0:"Chủ nhật", 1:"Thứ 2", 2:"Thứ 3", 3:"Thứ 4", 4:"Thứ 5", 5:"Thứ 6", 6:"Thứ 7"};
        if (defaultHolidays.length === 0) return "Không nghỉ (Làm full tuần)";
        
        // Sắp xếp T2->CN
        const sorted = defaultHolidays.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
        return sorted.map(d => dayMap[d]).join(", ");
    } catch (error) {
        console.error('Error fetching holiday config:', error);
        return "Chưa rõ cấu hình";
    }
}

// ============================================
// 3. QUERIES CHO CONFIG (Cấu hình hệ thống)
// ============================================

/**
 * Lấy hệ số khoán của các công ty
 */
export async function getQuotaMultipliers() {
    try {
        const docRef = doc(db, "config", "reportConfig");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return docSnap.data().quotaMultipliers || {};
        }
        return {};
    } catch (error) {
        console.error('Error fetching quota multipliers:', error);
        return {};
    }
}

/**
 * Lấy cấu hình ngày bắt đầu (tuần/tháng/năm/kỳ thanh toán)
 */
export async function getStartDaySettings() {
    try {
        const docRef = doc(db, "config", "reportConfig");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                weekDayStart: data.weekDayStart || 'Chưa cài đặt',
                monthDayStart: data.monthDayStart || 'Chưa cài đặt',
                yearDayStart: data.yearDayStart || 'Chưa cài đặt',
                billingDayStart: data.billingDayStart || 'Chưa cài đặt'
            };
        }
        return null;
    } catch (error) {
        console.error('Error fetching start day settings:', error);
        return null;
    }
}

/**
 * Lấy ngày nghỉ mặc định
 */
export async function getDefaultHolidays() {
    try {
        const snap = await getDocs(collection(db, "company_configs"));
        const latestConfigs = {};
        
        snap.forEach(doc => {
            const data = doc.data();
            const comp = data.company;
            if (comp) {
                if (!latestConfigs[comp] || (data.effectiveDate || "").localeCompare(latestConfigs[comp].effectiveDate || "") > 0) {
                    latestConfigs[comp] = data;
                }
            }
        });

        const dayMap = { 0: "Chủ nhật", 1: "Thứ 2", 2: "Thứ 3", 3: "Thứ 4", 4: "Thứ 5", 5: "Thứ 6", 6: "Thứ 7" };
        const results = {};
        
        for (const [comp, cfg] of Object.entries(latestConfigs)) {
            if (cfg.defaultHolidays) {
                if (cfg.defaultHolidays.length === 0) {
                    results[comp] = "Không nghỉ";
                } else {
                    const sorted = cfg.defaultHolidays.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
                    results[comp] = sorted.map(d => dayMap[d]).join(", ");
                }
            }
        }
        
        // Fallback sang settings/reportConfig cho các cty chưa cấu hình mới
        const oldRef = doc(db, "settings", "reportConfig");
        const oldSnap = await getDoc(oldRef);
        if (oldSnap.exists()) {
            const oldDef = oldSnap.data().defaultHolidays || {};
            const oldDayMap = { 'sat_sun': 'Thứ 7, Chủ nhật', 'sat-sun': 'Thứ 7, Chủ nhật', 'sun_only': 'Chủ nhật', 'sun': 'Chủ nhật', 'sat': 'Thứ 7' };
            for (const [comp, config] of Object.entries(oldDef)) {
                if (!results[comp] && config && config !== 'none') {
                    results[comp] = oldDayMap[config] || config;
                }
            }
        }
        
        return results;
    } catch (error) {
        console.error('Error fetching default holidays:', error);
        return {};
    }
}

// ============================================
// 4. THỐNG KÊ NÂNG CAO
// ============================================

/**
 * ⭐️ ĐỘNG CƠ THỐNG KÊ TRÍ TUỆ (SỬ DỤNG CHUNG CORE-CALCULATOR)
 * @param {string} timeframe - 'week', 'month', 'billing'
 * @param {string} targetCompany - Tên công ty (hoặc null nếu lấy toàn KCN)
 * @param {Date} targetDateObj - Mốc thời gian muốn tính (null = hiện tại)
 */
export async function getAdvancedStatistics(timeframe, targetCompany = null, targetDateObj = null) {
    try {
        const now = targetDateObj ? new Date(targetDateObj) : new Date();

        // 1. TẢI CẤU HÌNH HỆ THỐNG
        const [configSnap, settingsSnap, companiesSnap] = await Promise.all([
            getDoc(doc(db, "config", "reportConfig")),
            getDoc(doc(db, "settings", "reportConfig")),
            getDocs(collection(db, "company_configs"))
        ]);
        
        const sysConfig = configSnap.exists() ? configSnap.data() : {};
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        const allCompanyConfigs = companiesSnap.docs.map(d => d.data());

        const coreConfig = {
            weekDayStart: sysConfig.weekDayStart || 1,
            monthDayStart: sysConfig.monthDayStart || 1,
            yearDayStart: sysConfig.yearDayStart || 1,
            defaultHolidays: settings.defaultHolidays || {},
            quotaMultipliers: sysConfig.quotaMultipliers || {}
        };

        // 2. XÁC ĐỊNH KHOẢNG THỜI GIAN LẤY DỮ LIỆU RỘNG RÃI
        let fetchStart = new Date(now);
        if (timeframe === 'year') {
            fetchStart = new Date(now.getFullYear(), 0, 1);
        } else {
            fetchStart.setMonth(fetchStart.getMonth() - 2); 
        }
        fetchStart.setDate(fetchStart.getDate() - 15);
        const fetchStartStr = formatISODate(fetchStart);
        
        const fetchEnd = new Date(now);
        fetchEnd.setDate(fetchEnd.getDate() + 45); // Dư dả thời gian về tương lai để chốt mốc cuối
        const fetchEndStr = formatISODate(fetchEnd);

        // 3. TẢI DỮ LIỆU ĐỂ TÍNH TOÁN (LOCAL-FIRST)
        let allReadings = [];
        const processedHolidays = {};

        const localReports1 = await getAllFromLocalDB("reports_1");
        const localReports2 = await getAllFromLocalDB("reports_2");
        
        const cacheStartDate1 = getStoreCacheStartDate(localReports1, "ngay_ghi");
        const cacheStartDate2 = getStoreCacheStartDate(localReports2, "ngay_nghi", "ngay_lam_db");

        const hasLocalCache1 = cacheStartDate1 && fetchStartStr >= cacheStartDate1;
        const hasLocalCache2 = cacheStartDate2 && fetchStartStr >= cacheStartDate2;

        if (hasLocalCache1 && hasLocalCache2) {
            // Sử dụng dữ liệu cache từ IndexedDB
            const readingsLocal = localReports1.filter(item => item.ngay_ghi >= fetchStartStr && item.ngay_ghi <= fetchEndStr);
            allReadings = readingsLocal.map(item => ({
                date: new Date(item.ngay_ghi + "T00:00:00"),
                value: parseFloat(item.chi_so),
                company: item.company
            }));

            const holidaysLocal = localReports2.filter(item => 
                (item.ngay_nghi && item.ngay_nghi >= fetchStartStr && item.ngay_nghi <= fetchEndStr) ||
                (item.ngay_lam_db && item.ngay_lam_db >= fetchStartStr && item.ngay_lam_db <= fetchEndStr)
            );
            
            holidaysLocal.forEach(item => {
                if (!processedHolidays[item.company]) processedHolidays[item.company] = { dayOffs: new Set(), specialWorkdays: new Set() };
                if (item.ngay_nghi) processedHolidays[item.company].dayOffs.add(item.ngay_nghi);
                if (item.ngay_lam_db) processedHolidays[item.company].specialWorkdays.add(item.ngay_lam_db);
            });
            console.log("📊 [Advanced Stats] Loaded from local IndexedDB cache.");
        } else {
            // Fallback truy vấn Firestore
            console.log("📊 [Advanced Stats] Cache miss, querying Firestore...");
            const qReports = query(collection(db, "reports_1"), where("ngay_ghi", ">=", fetchStartStr), where("ngay_ghi", "<=", fetchEndStr));
            const snapReports = await getDocs(qReports);
            const reports1Docs = snapReports.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const qHolidays1 = query(collection(db, "reports_2"), where("ngay_nghi", ">=", fetchStartStr), where("ngay_nghi", "<=", fetchEndStr));
            const qHolidays2 = query(collection(db, "reports_2"), where("ngay_lam_db", ">=", fetchStartStr), where("ngay_lam_db", "<=", fetchEndStr));
            const [snapH1, snapH2] = await Promise.all([getDocs(qHolidays1), getDocs(qHolidays2)]);
            
            const mapH = new Map();
            snapH1.docs.forEach(doc => mapH.set(doc.id, { id: doc.id, ...doc.data() }));
            snapH2.docs.forEach(doc => mapH.set(doc.id, { id: doc.id, ...doc.data() }));
            const holidaysDocs = Array.from(mapH.values());

            // Cache vào IndexedDB
            if (reports1Docs.length > 0) {
                try {
                    const parsedReports1 = reports1Docs.map(data => ({
                        ...data,
                        _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
                        _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now()
                    }));
                    await saveToLocalDB("reports_1", parsedReports1);
                } catch (cacheErr) {
                    console.warn("Lỗi lưu cache reports_1 trong stats:", cacheErr);
                }
            }

            if (holidaysDocs.length > 0) {
                try {
                    const parsedReports2 = holidaysDocs.map(data => ({
                        ...data,
                        _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
                        _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now()
                    }));
                    await saveToLocalDB("reports_2", parsedReports2);
                } catch (cacheErr) {
                    console.warn("Lỗi lưu cache reports_2 trong stats:", cacheErr);
                }
            }

            // Map thành cấu trúc mong muốn
            allReadings = reports1Docs.map(d => ({ date: new Date(d.ngay_ghi + "T00:00:00"), value: parseFloat(d.chi_so), company: d.company }));
            
            holidaysDocs.forEach(r => {
                if (!processedHolidays[r.company]) processedHolidays[r.company] = { dayOffs: new Set(), specialWorkdays: new Set() };
                if (r.ngay_nghi) processedHolidays[r.company].dayOffs.add(r.ngay_nghi);
                if (r.ngay_lam_db) processedHolidays[r.company].specialWorkdays.add(r.ngay_lam_db);
            });
        }

        // 4. TÍNH TOÁN CHO TỪNG CÔNG TY
        const companyList = targetCompany ? [targetCompany] : [...new Set(allReadings.map(r => r.company))];
        let kcnTotal = 0;
        const topConsumers = [];
        let targetCompanyData = null;
        let kcnPeriodLabel = "";

        companyList.forEach(comp => {
            const compReadings = allReadings.filter(r => r.company === comp);
            
            let periodData;
            if (timeframe === 'billing') {
                periodData = getBillingPeriodsInFilter(compReadings, now, now, coreConfig, processedHolidays, comp, allCompanyConfigs);
            } else {
                periodData = getPeriodsInFilter(compReadings, now, now, timeframe, coreConfig, processedHolidays, comp, allCompanyConfigs);
            }

            // Do query `from = now, to = now`, kết quả sẽ rớt vào `current` (nếu đang là kỳ này) hoặc `past[0]` (nếu là quá khứ)
            const currentData = (periodData.past && periodData.past.length > 0) ? periodData.past[0] : periodData.current;
            
            if (!currentData) return;
            if (!kcnPeriodLabel) kcnPeriodLabel = currentData.label;

            let total = currentData.total === "N/A" ? null : currentData.total;
            let avg = currentData.avg === "N/A" ? null : currentData.avg;
            let quota = currentData.quota === "N/A" ? null : (currentData.quota !== undefined ? currentData.quota : null);
            let workingDays = currentData.workingDaysForAvg || 0;

            // Tính Khoán (Nếu là tuần/tháng/năm nhưng công ty có áp khoán, AI vẫn cần đọc)
            const periodEndStr = currentData.end ? formatISODate(currentData.end) : null;
            const cCfg = periodEndStr ? getCompanyConfigAtDate(comp, periodEndStr, allCompanyConfigs) : null;
            const qMult = cCfg ? (Number(cCfg.quotaMultiplier) || 0) : (Number(sysConfig.quotaMultipliers?.[comp]) || 0);

            if (timeframe !== 'billing' && total !== null) {
                if (qMult > 0) {
                    quota = parseFloat((workingDays * qMult).toFixed(0));
                } else {
                    quota = 0;
                }
            }

            if (total !== null) {
                kcnTotal += total;
            }

            const compResult = {
                company: comp,
                total: total,
                avg: avg,
                quota: quota,
                workingDays: workingDays,
                quotaMultiplier: qMult,
                startMark: currentData.start ? formatISODate(currentData.start) : 'N/A',
                endMark: currentData.end ? formatISODate(currentData.end) : 'N/A',
                hasData: total !== null
            };
            
            topConsumers.push(compResult);
            if (comp === targetCompany) targetCompanyData = compResult;
        });

        // 5. TRẢ VỀ KẾT QUẢ CHO AI
        if (targetCompany) {
            return {
                periodLabel: kcnPeriodLabel,
                companyData: targetCompanyData || {
                    company: targetCompany,
                    hasData: false,
                    startMark: 'N/A',
                    total: 0
                }
            };
        } else {
            // Lấy Top 5 xả thải
            const sortedTop = topConsumers.filter(c => c.hasData).sort((a, b) => b.total - a.total).slice(0, 5);
            return {
                periodLabel: kcnPeriodLabel || "Báo cáo KCN",
                tong_luong_xa_thai_kcn: kcnTotal,
                so_cong_ty_co_du_lieu: topConsumers.filter(c => c.hasData).length,
                topConsumers: sortedTop
            };
        }

    } catch (error) {
        console.error('Error getting advanced statistics:', error);
        return null;
    }
}

// ============================================
// 6. HÀM TÍNH TOÁN & CACHE AUTOPLAN (Client-side Logic)
// ============================================

/**
 * Hàm này thực hiện tính toán logic Autoplan bằng JS (thay vì AI)
 * và lưu kết quả vào Firestore để dùng lại.
 */
export async function calculateAndCacheSchedule(dateStr) {
    try {
        const checkDate = new Date(dateStr + "T00:00:00");
        const [patternsSnap, swapsSnap] = await Promise.all([
            getDocs(collection(db, "work_patterns")),
            getDocs(collection(db, "shift_swaps"))
        ]);
        
        const patterns = patternsSnap.docs.map(d => d.data());
        const swaps = swapsSnap.docs.map(d => d.data()).filter(s => s.date === dateStr);
        
        const dayOfWeek = checkDate.getDay() === 0 ? 8 : checkDate.getDay() + 1;
        let workers = [];

        // Hàm kiểm tra quy tắc
        const isRuleActive = (r) => {
            const start = new Date(r.patternStartDate + 'T00:00:00');
            const end = r.patternEndDate ? new Date(r.patternEndDate + 'T00:00:00') : null;
            if (checkDate < start) return false;
            if (end && checkDate > end) return false;
            return true;
        };

        // Nhóm cố định (Hành chính)
        patterns.filter(p => p.type === 'administrative').forEach(r => {
            if (isRuleActive(r) && r.workDaysOfWeek && r.workDaysOfWeek.includes(dayOfWeek)) {
                let name = r.displayName;
                const swap = swaps.find(s => s.user1 === name);
                if (swap) name = `${swap.user2} (trực thay ${swap.user1})`;
                workers.push(`[${r.shiftGroup || 'Hành chính'}] ${name} (${r.startTime}-${r.endTime})`);
            }
        });

        // Nhóm xoay ca
        const shiftRules = patterns.filter(p => p.type === 'shift_rotation');
        const shiftGroups = {};
        shiftRules.forEach(r => {
            const g = r.shiftGroup || "Vận hành";
            if (!shiftGroups[g]) shiftGroups[g] = [];
            shiftGroups[g].push(r);
        });

        for (const group in shiftGroups) {
            const groupRules = shiftGroups[group];
            groupRules.sort((a,b) => {
                if (a.patternStartDate !== b.patternStartDate) return new Date(a.patternStartDate) - new Date(b.patternStartDate);
                if (a.startTime !== b.startTime) return (a.startTime || "").localeCompare(b.startTime || "");
                return (a.displayName || "").localeCompare(b.displayName || "");
            });
            const groupRefDate = new Date(groupRules[0].patternStartDate + 'T00:00:00');
            
            const membersToday = groupRules.filter(isRuleActive);
            if (membersToday.length > 0) {
                const n = membersToday.length;
                const diffDays = Math.round((checkDate - groupRefDate) / (1000 * 60 * 60 * 24));
                const idx = (diffDays % n + n) % n;
                const worker = membersToday[idx];
                if (worker) {
                    let name = worker.displayName;
                    const swap = swaps.find(s => s.user1 === name);
                    if (swap) name = `${swap.user2} (trực thay ${swap.user1})`;
                    workers.push(`[${group}] ${name} (${worker.startTime}-${worker.endTime})`);
                }
            }
        }

        const resultString = workers.length > 0 ? workers.join(", ") : "Không có ai trực";

        // Lưu cache nhưng không để lỗi ghi database (ví dụ permission denied) chặn luồng trả kết quả
        try {
            await setDoc(doc(db, "daily_schedules", dateStr), {
                content: resultString,
                updatedAt: serverTimestamp(),
                source: "auto_calculation_js"
            });
            console.log(`✅ Đã tính toán và cache lịch cho ngày ${dateStr}: ${resultString}`);
        } catch (dbError) {
            console.warn(`⚠️ Không thể lưu cache lịch trực ngày ${dateStr} vào Firestore:`, dbError);
        }

        return resultString;

    } catch (error) {
        console.error("Lỗi tính toán lịch:", error);
        return null;
    }
}

/**
 * Lấy lịch trực trong 7 ngày tới của một nhân viên cụ thể
 */
export async function getEmployeeWeeklySchedule(employeeName, startDateStr) {
    try {
        const [patternsSnap, swapsSnap] = await Promise.all([
            getDocs(collection(db, "work_patterns")),
            getDocs(collection(db, "shift_swaps"))
        ]);
        
        const patterns = patternsSnap.docs.map(d => d.data());
        const swaps = swapsSnap.docs.map(d => d.data());
        
        const schedule = [];
        const start = new Date(startDateStr + "T00:00:00");
        
        const dayNames = {
            1: "Chủ nhật",
            2: "Thứ 2",
            3: "Thứ 3",
            4: "Thứ 4",
            5: "Thứ 5",
            6: "Thứ 6",
            7: "Thứ 7"
        };
        
        for (let i = 0; i < 7; i++) {
            const checkDate = new Date(start);
            checkDate.setDate(start.getDate() + i);
            const checkDateStr = checkDate.toISOString().split('T')[0];
            const dayOfWeek = checkDate.getDay() === 0 ? 8 : checkDate.getDay() + 1; // 2=T2, 8=CN
            
            const isRuleActive = (r) => {
                const sDate = new Date(r.patternStartDate + 'T00:00:00');
                const eDate = r.patternEndDate ? new Date(r.patternEndDate + 'T00:00:00') : null;
                if (checkDate < sDate) return false;
                if (eDate && checkDate > eDate) return false;
                return true;
            };
            
            const swapsToday = swaps.filter(s => s.date === checkDateStr);
            
            // 1. Kiểm tra nhóm Hành chính
            patterns.filter(p => p.type === 'administrative').forEach(r => {
                if (isRuleActive(r) && r.workDaysOfWeek && r.workDaysOfWeek.includes(dayOfWeek)) {
                    let name = r.displayName;
                    let swapped = false;
                    let swappedWith = '';
                    const swap = swapsToday.find(s => s.user1 === name);
                    if (swap) {
                        name = swap.user2;
                        swapped = true;
                        swappedWith = swap.user1;
                    }
                    const swapIn = swapsToday.find(s => s.user2 === name && s.user1 === r.displayName);
                    if (swapIn) {
                        name = swapIn.user2;
                        swapped = true;
                        swappedWith = swapIn.user1;
                    }
                    
                    if (name === employeeName) {
                        schedule.push({
                            date: checkDateStr,
                            dayLabel: dayNames[checkDate.getDay() + 1],
                            shiftGroup: r.shiftGroup || 'Hành chính',
                            startTime: r.startTime,
                            endTime: r.endTime,
                            note: swapped ? `Trực thay ${swappedWith}` : ''
                        });
                    }
                }
            });
            
            // 2. Kiểm tra nhóm xoay ca
            const shiftRules = patterns.filter(p => p.type === 'shift_rotation');
            const shiftGroups = {};
            shiftRules.forEach(r => {
                const g = r.shiftGroup || "Vận hành";
                if (!shiftGroups[g]) shiftGroups[g] = [];
                shiftGroups[g].push(r);
            });
            
            for (const group in shiftGroups) {
                const groupRules = shiftGroups[group];
                groupRules.sort((a,b) => {
                    if (a.patternStartDate !== b.patternStartDate) return new Date(a.patternStartDate) - new Date(b.patternStartDate);
                    if (a.startTime !== b.startTime) return (a.startTime || "").localeCompare(b.startTime || "");
                    return (a.displayName || "").localeCompare(b.displayName || "");
                });
                
                const groupRefDate = new Date(groupRules[0].patternStartDate + 'T00:00:00');
                const membersToday = groupRules.filter(isRuleActive);
                
                if (membersToday.length > 0) {
                    const n = membersToday.length;
                    const diffDays = Math.round((checkDate - groupRefDate) / (1000 * 60 * 60 * 24));
                    const idx = (diffDays % n + n) % n;
                    const worker = membersToday[idx];
                    
                    if (worker) {
                        let name = worker.displayName;
                        let swapped = false;
                        let swappedWith = '';
                        const swap = swapsToday.find(s => s.user1 === name);
                        if (swap) {
                            name = swap.user2;
                            swapped = true;
                            swappedWith = swap.user1;
                        }
                        
                        if (name === employeeName) {
                            schedule.push({
                                date: checkDateStr,
                                dayLabel: dayNames[checkDate.getDay() + 1],
                                shiftGroup: group,
                                startTime: worker.startTime,
                                endTime: worker.endTime,
                                note: swapped ? `Trực thay ${swappedWith}` : ''
                            });
                        }
                    }
                }
            }
        }
        
        return schedule;
    } catch (error) {
        console.error('Error fetching employee weekly schedule:', error);
        return [];
    }
}

/**
 * Lấy toàn bộ ngữ cảnh dữ liệu của một nhân sự (gồm lịch sử phân ca và đổi ca)
 */
export async function getEmployeeFullContext(employeeName) {
    try {
        const [patternsSnap, swapsSnap] = await Promise.all([
            getDocs(collection(db, "work_patterns")),
            getDocs(collection(db, "shift_swaps"))
        ]);

        const targetNameLower = employeeName.toLowerCase().trim();
        const removeAccentsLocal = (str) => {
            return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
        };
        const targetNameNoAccent = removeAccentsLocal(targetNameLower);

        // Lọc trong bộ nhớ: case-insensitive và accent-insensitive
        const patterns = patternsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(p => {
                if (!p.displayName) return false;
                const nameLower = p.displayName.toLowerCase().trim();
                const nameNoAccent = removeAccentsLocal(nameLower);
                return nameLower === targetNameLower || nameNoAccent === targetNameNoAccent;
            });

        const swaps = swapsSnap.docs
            .map(d => d.data())
            .filter(s => {
                const u1 = (s.user1 || "").toLowerCase().trim();
                const u2 = (s.user2 || "").toLowerCase().trim();
                const u1NoAccent = removeAccentsLocal(u1);
                const u2NoAccent = removeAccentsLocal(u2);
                return u1 === targetNameLower || u1NoAccent === targetNameNoAccent ||
                       u2 === targetNameLower || u2NoAccent === targetNameNoAccent;
            });

        return {
            employee: employeeName,
            work_patterns: patterns,
            shift_swaps: swaps,
            currentDate: new Date().toISOString().split('T')[0]
        };
    } catch (e) {
        console.error("❌ Lỗi lấy full context nhân sự:", e);
        return { employee: employeeName, error: e.message };
    }
}

/**
 * Lấy nhật ký hệ thống (logs) liên quan đến nhân sự hoặc thời gian cụ thể
 */
export async function getSystemLogsContext(employeeName, targetDateExact = null) {
    try {
        let logs = [];
        
        const removeAccentsLocal = (str) => {
            return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
        };
        
        let searchWords = [];
        if (employeeName) {
            const cleanName = removeAccentsLocal(employeeName.toLowerCase().trim());
            searchWords = cleanName.split(/\s+/).filter(w => w.length >= 2);
        }

        if (targetDateExact) {
            // Lọc theo ngày cụ thể (từ 00:00:00 đến 23:59:59)
            const startOfDay = new Date(targetDateExact + 'T00:00:00');
            const endOfDay = new Date(targetDateExact + 'T23:59:59');
            const q = query(collection(db, "logs"), 
                where("createdAt", ">=", startOfDay),
                where("createdAt", "<=", endOfDay),
                orderBy("createdAt", "desc")
            );
            const snapshot = await getDocs(q);
            logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } else if (employeeName) {
            // Lấy song song logs mới nhất và query prefix cho email của nhân viên
            const cleanName = removeAccentsLocal(employeeName.toLowerCase().trim());
            const prefix = cleanName.replace(/\s+/g, ''); // "taminhngo"
            const lastName = searchWords[searchWords.length - 1]; // "ngo"
            
            const [snapLatest, snapPrefix, snapLastName] = await Promise.all([
                getDocs(query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(250))),
                getDocs(query(collection(db, "logs"), where("email", ">=", prefix), where("email", "<=", prefix + "\uf8ff"), limit(100))),
                lastName ? getDocs(query(collection(db, "logs"), where("email", ">=", lastName), where("email", "<=", lastName + "\uf8ff"), limit(100))) : Promise.resolve({ docs: [] })
            ]);
            
            const allDocs = [...snapLatest.docs, ...snapPrefix.docs, ...snapLastName.docs];
            const uniqueMap = new Map();
            allDocs.forEach(d => uniqueMap.set(d.id, { id: d.id, ...d.data() }));
            logs = Array.from(uniqueMap.values());
        } else {
            // Mặc định lấy 150 logs mới nhất
            const snapshot = await getDocs(query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(150)));
            logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        
        // Định dạng logs và lọc chính xác trong bộ nhớ
        let formattedLogs = logs.map(data => {
            return {
                id: data.id,
                action: data.action,
                email: data.email || null,
                createdAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : new Date(data.createdAt).toISOString()) : null,
                details: { ...data, createdAt: undefined, action: undefined, id: undefined }
            };
        });
        
        if (employeeName) {
            const searchLower = employeeName.toLowerCase();
            const searchClean = removeAccentsLocal(searchLower);
            // Lọc lại trong bộ nhớ để chắc chắn
            formattedLogs = formattedLogs.filter(log => {
                const logStr = JSON.stringify(log).toLowerCase();
                const logClean = removeAccentsLocal(logStr);
                
                if (logClean.includes(searchClean)) return true;
                if (searchWords.length > 0 && searchWords.some(word => logClean.includes(word))) return true;
                return false;
            });
        }
        
        // Sắp xếp logs theo ngày giảm dần
        formattedLogs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        
        return {
            queryEmployee: employeeName,
            queryDate: targetDateExact,
            matchedLogsCount: formattedLogs.length,
            logs: formattedLogs.slice(0, 35) // Giới hạn 35 logs cho AI
        };
    } catch (e) {
        console.error("❌ Lỗi lấy system logs:", e);
        return { error: e.message };
    }
}

/**
 * Lấy lịch trực đã được tính toán sẵn (Cache) của một ngày cụ thể
 */
export async function getCachedSchedule(dateStr) {
    // dateStr format: YYYY-MM-DD
    try {
        const docRef = doc(db, "daily_schedules", dateStr);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return { date: dateStr, content: docSnap.data().content, source: 'cache' };
        }
        return null;
    } catch (error) {
        console.error(`Error fetching cached schedule for ${dateStr}:`, error);
        return null;
    }
}

// ============================================
// 5. QUERIES CHO AUTOPLAN (JOB)
// ============================================

/**
 * Lấy danh sách các quy tắc Autoplan
 */
export async function getAutoplanRules() {
    try {
        // Tự động dò tìm collection chứa quy tắc
        // Ưu tiên 'autoplan', nếu không có thì tìm 'job'
        let collectionName = 'autoplan';
        let q = query(collection(db, collectionName));
        let snapshot = await getDocs(q);

        if (snapshot.empty) {
            console.log("ℹ️ Collection 'autoplan' trống hoặc không tồn tại. Đang chuyển sang tìm trong 'job'...");
            collectionName = 'job';
            q = query(collection(db, collectionName));
            snapshot = await getDocs(q);
        }
        
        console.log(`✅ [Autoplan] Đã tải ${snapshot.size} quy tắc từ collection '${collectionName}'.`);
        
        const rules = snapshot.docs.map(doc => {
            const d = doc.data();
            return {
                content: d.content,
                // Ép kiểu số để AI so sánh chính xác
                dayOfWeek: (d.dayOfWeek !== null && d.dayOfWeek !== undefined) ? Number(d.dayOfWeek) : null,
                dayOfMonth: (d.dayOfMonth !== null && d.dayOfMonth !== undefined) ? Number(d.dayOfMonth) : null,
                createdAt: d.createdAt
            };
        });

        // Sắp xếp mảng trong Javascript (Mới nhất lên đầu trang)
        return rules.sort((a, b) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA;
        });

    } catch (error) {
        console.error('❌ Lỗi lấy autoplan rules:', error);
        console.warn('👤 Trạng thái đăng nhập:', auth.currentUser ? auth.currentUser.email : 'Chưa đăng nhập');
        return [];
    }
}

/**
 * Lấy toàn bộ danh sách quy chế/kiến thức AI từ collection 'ai_knowledge'
 */
export async function getAIKnowledgeBase(role = "guest") {
    try {
        let q;
        const colRef = collection(db, "ai_knowledge");
        
        if (role === "admin") {
            q = query(colRef, where("targetGroup", "in", ["guest", "user", "admin"]));
        } else if (role === "guest") {
            q = query(colRef, where("targetGroup", "==", "guest"));
        } else {
            // Mọi vai trò đã đăng nhập khác (user, staff, doanhnghiep...) đều xem được tài liệu công cộng + nội bộ
            q = query(colRef, where("targetGroup", "in", ["guest", "user"]));
        }

        const snapshot = await getDocs(q);
        const docsCount = snapshot.size;
        
        console.log(`✅ [AI Knowledge] Đã tải ${snapshot.size} quy chế từ Firestore (Vai trò: ${role}).`);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        try {
            const { addLog: scriptAddLog } = await import("./script.js");
            if (scriptAddLog) {
                await scriptAddLog("debug_ai_knowledge", {
                    role: role,
                    status: "error",
                    error: error.message,
                    email: auth.currentUser?.email || "anonymous",
                    timestamp: new Date().toISOString()
                });
            }
        } catch (logErr) {
            console.warn("Failed to write error log:", logErr);
        }
        console.error('❌ Lỗi lấy danh sách quy chế/kiến thức AI:', error);
        return [];
    }
}

