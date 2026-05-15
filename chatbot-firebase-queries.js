/**
 * CHATBOT FIREBASE QUERIES
 * Module chứa các function truy vấn Firebase cho chatbot
 * Sử dụng: import vào trangchu.html và gọi khi AI cần dữ liệu
 */

// Import db từ script.js (đã export)
import { db, auth } from "./script.js";

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
    getAggregateFromServer,
    sum,
    average,
    count
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ============================================
// 1. QUERIES CHO reports_1 (Chỉ số điện/nước)
// ============================================

/**
 * Lấy chỉ số mới nhất của một công ty
 */
export async function getLatestCompanyIndex(companyName) {
    try {
        const q = query(
            collection(db, "reports_1"),
            where("company", "==", companyName),
            orderBy("ngay_ghi", "desc"),
            orderBy("createdAt", "desc"),
            limit(1)
        );
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const data = snapshot.docs[0].data();
            return {
                company: companyName,
                chi_so: data.chi_so || 0,
                ngay_ghi: data.ngay_ghi || 'N/A',
                ghi_chu: data.ghi_chu || ''
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
        const q = query(
            collection(db, "reports_1"),
            where("company", "==", companyName),
            where("ngay_ghi", ">=", startDate),
            where("ngay_ghi", "<=", endDate),
            orderBy("ngay_ghi", "desc")
        );
        const snapshot = await getDocs(q);
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
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
        const snapshot = await getDocs(collection(db, "reports_1"));
        const companies = new Set();
        snapshot.forEach(doc => {
            if (doc.data().company) {
                companies.add(doc.data().company);
            }
        });
        return companies.size;
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
        const snapshot = await getDocs(collection(db, "reports_1"));
        const companies = new Set();
        snapshot.forEach(doc => {
            if (doc.data().company) {
                companies.add(doc.data().company);
            }
        });
        return Array.from(companies).sort();
    } catch (error) {
        console.error('Error fetching all companies:', error);
        return [];
    }
}

/**
 * So sánh tiêu thụ giữa các công ty trong tháng
 */
export async function compareCompaniesThisMonth() {
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const startDate = `${year}-${month}-01`;
        const endDate = `${year}-${month}-31`;
        
        const q = query(
            collection(db, "reports_1"),
            where("ngay_ghi", ">=", startDate),
            where("ngay_ghi", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        
        // Nhóm theo công ty và tính tổng
        const companyData = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!companyData[data.company]) {
                companyData[data.company] = {
                    total: 0,
                    count: 0,
                    records: []
                };
            }
            companyData[data.company].total += (data.chi_so || 0);
            companyData[data.company].count += 1;
            companyData[data.company].records.push(data);
        });
        
        // Chuyển sang array và sắp xếp
        return Object.entries(companyData)
            .map(([company, stats]) => ({
                company,
                total: stats.total,
                average: stats.count > 0 ? stats.total / stats.count : 0,
                count: stats.count
            }))
            .sort((a, b) => b.total - a.total);
    } catch (error) {
        console.error('Error comparing companies:', error);
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
        const q = query(
            collection(db, "reports_2"),
            where("ngay_nghi", ">=", startDate),
            where("ngay_nghi", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        
        return snapshot.docs.map(doc => ({
            date: doc.data().ngay_nghi,
            ...doc.data()
        }));
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
        const today = new Date().toISOString().split('T')[0];
        const q = query(
            collection(db, "reports_2"),
            where("ngay_nghi", ">=", today),
            orderBy("ngay_nghi", "asc"),
            limit(1)
        );
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            return snapshot.docs[0].data();
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
        const q = query(
            collection(db, "reports_2"),
            where("isSpecialWorkday", "==", true),
            where("ngay_lam_db", ">=", startDate),
            where("ngay_lam_db", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        
        return snapshot.docs.map(doc => ({
            date: doc.data().ngay_lam_db,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching special workdays:', error);
        return [];
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
        const docRef = doc(db, "settings", "reportConfig");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return docSnap.data().defaultHolidays || {};
        }
        return {};
    } catch (error) {
        console.error('Error fetching default holidays:', error);
        return {};
    }
}

// ============================================
// 4. THỐNG KÊ NÂNG CAO
// ============================================

/**
 * Thống kê tiêu thụ theo tuần hiện tại
 */
export async function getWeeklyStatistics() {
    try {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek + 1); // Thứ 2
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6); // Chủ nhật
        
        const startDate = startOfWeek.toISOString().split('T')[0];
        const endDate = endOfWeek.toISOString().split('T')[0];
        
        const q = query(
            collection(db, "reports_1"),
            where("ngay_ghi", ">=", startDate),
            where("ngay_ghi", "<=", endDate)
        );
        
        // ⭐️ TỐI ƯU: Sử dụng Aggregation Queries (Tính toán trên Server)
        // Không tải documents về, chỉ tải kết quả số -> Cực nhanh
        const snapshot = await getAggregateFromServer(q, {
            totalConsumption: sum('chi_so'),
            recordCount: count()
        });
        
        const data = snapshot.data();

        return {
            period: `${startDate} đến ${endDate}`,
            totalConsumption: data.totalConsumption,
            averageConsumption: data.recordCount > 0 ? data.totalConsumption / data.recordCount : 0,
            recordCount: data.recordCount,
            companyCount: "N/A" // Aggregation chưa hỗ trợ count distinct, chấp nhận bỏ qua để đổi lấy tốc độ
        };
    } catch (error) {
        console.error('Error fetching weekly statistics:', error);
        return null;
    }
}

/**
 * Thống kê tiêu thụ theo tháng hiện tại
 */
export async function getMonthlyStatistics() {
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const startDate = `${year}-${month}-01`;
        const endDate = `${year}-${month}-31`;
        
        const q = query(
            collection(db, "reports_1"),
            where("ngay_ghi", ">=", startDate),
            where("ngay_ghi", "<=", endDate)
        );

        // ⭐️ TỐI ƯU: Sử dụng Aggregation Queries
        const snapshot = await getAggregateFromServer(q, {
            totalConsumption: sum('chi_so'),
            recordCount: count()
        });
        
        const data = snapshot.data();

        return {
            period: `Tháng ${month}/${year}`,
            totalConsumption: data.totalConsumption,
            averageConsumption: data.recordCount > 0 ? data.totalConsumption / data.recordCount : 0,
            recordCount: data.recordCount,
            companyCount: "N/A"
        };
    } catch (error) {
        console.error('Error fetching monthly statistics:', error);
        return null;
    }
}

/**
 * Tìm công ty tiêu thụ nhiều nhất
 */
export async function getTopConsumers(limit = 5) {
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const startDate = `${year}-${month}-01`;
        const endDate = `${year}-${month}-31`;
        
        const comparison = await compareCompaniesThisMonth();
        return comparison.slice(0, limit);
    } catch (error) {
        console.error('Error fetching top consumers:', error);
        return [];
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
        // 1. Lấy quy tắc
        const rules = await getAutoplanRules();
        if (rules.length === 0) return "Chưa có quy tắc trực.";

        // 2. Phân tích ngày
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay(); // 0-6
        const dayOfMonth = date.getDate(); // 1-31

        // 3. Logic so khớp (JS thuần, cực nhanh)
        let matchedContent = [];
        
        rules.forEach(rule => {
            // So khớp thứ
            if (rule.dayOfWeek !== null && rule.dayOfWeek === dayOfWeek) {
                matchedContent.push(rule.content);
            }
            // So khớp ngày
            if (rule.dayOfMonth !== null && rule.dayOfMonth === dayOfMonth) {
                matchedContent.push(rule.content);
            }
        });

        // Loại bỏ trùng lặp
        const uniqueContent = [...new Set(matchedContent)];
        const resultString = uniqueContent.length > 0 ? uniqueContent.join(", ") : "Không có lịch trực";

        // 4. LƯU CACHE (Quan trọng: Để lần sau không phải tính lại)
        // Import hàm save từ script.js hoặc dùng trực tiếp setDoc
        const { setDoc, doc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
        
        await setDoc(doc(db, "daily_schedules", dateStr), {
            content: resultString,
            updatedAt: serverTimestamp(),
            source: "auto_calculation_js"
        });

        console.log(`✅ Đã tính toán và cache lịch cho ngày ${dateStr}: ${resultString}`);
        return resultString;

    } catch (error) {
        console.error("Lỗi tính toán lịch:", error);
        return null;
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

        // Sắp xếp mảng trong Javascript (Mới nhất lên đầu)
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
