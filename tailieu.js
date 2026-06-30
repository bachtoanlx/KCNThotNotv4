import { initMenu } from "./menu.js";
import { auth, db, onAuth, getRole, loadTemplate } from "./script.js";
import { collection, getDoc, getDocs, query, where, doc, setDoc, deleteDoc } from "./script.js";

// Cấu hình endpoint Google Apps Script Web App
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyQiM0jOcnpNSumDCt75jki2Y6v7rOMu2KFVraq_0G-whX9fq3HYYTZ1C7453tOVAgpiA/exec";

// Khởi tạo Menu chung của trang web
loadTemplate("menu-placeholder", "menu.html", () => {
    initMenu();
});

// Trạng thái cục bộ của ứng dụng
let userRole = "guest";
let allChunks = [];
let allDocuments = {}; // Siêu dữ liệu tài liệu gốc: docId -> docData
let docCodeMap = {}; // Ánh xạ mã tài liệu cố định: docId -> TL-XX
let invertedIndex = {}; // Chỉ mục đảo client-side
let activeCategory = "Tất cả";
let displayLimit = 12; // Số lượng kết quả hiển thị tối đa ban đầu

// Cấu hình Proxy AI (đồng bộ bảo mật với Chatbot trang chủ)
const USE_PROXY = true;
const PROXY_URL = 'https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec';
const PREFERRED_MODEL = 'gemini-2.5-flash';

// Trạng thái Tìm kiếm AI
let isAiSearchActive = false;
let aiSearchResults = null; // Mảng các { id, score, reason } trả về từ AI

// Từ điển đồng nghĩa và từ viết tắt chuyên ngành KCN/Doanh nghiệp
const SYNONYM_DICT = {
    "xlnt": ["xử lý nước thải", "nước thải"],
    "pccc": ["phòng cháy chữa cháy", "báo cháy", "chữa cháy"],
    "bql": ["ban quản lý"],
    "pac": ["poly aluminium chloride", "keo tụ"],
    "wwtp": ["nhà máy xử lý nước thải", "nước thải"]
};

// Danh sách các từ dừng (stop words) cực kỳ phổ biến trong văn bản tiếng Việt
const STOP_WORDS = new Set([
    "6", "tháng", "năm", "ngày", "đầu", "các", "và", "của", "là", "trong",
    "để", "cho", "có", "đã", "đang", "sẽ", "tại", "theo", "về", "như",
    "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín", "mười",
    "đầu", "cuối", "giữa", "trước", "sau", "ở", "an", "toàn", "sự", "việc"
]);

// Lấy các thành phần DOM
const docSearchInput = document.getElementById("docSearchInput");
const documentGrid = document.getElementById("documentGrid");
const tabButtons = document.querySelectorAll(".tab-btn");

// Khởi động khi trạng thái xác thực người dùng sẵn sàng
onAuth(async (user) => {
    if (user && user.email) {
        try {
            userRole = await getRole(user.email);
        } catch (e) {
            console.warn("Không thể lấy vai trò người dùng, mặc định làm khách:", e);
            userRole = "guest";
        }
    } else {
        userRole = "guest";
    }

    // Tải cấu hình AI của hệ thống trước
    await loadAiSettings();

    // Nếu người dùng là admin, hiển thị nút cấu hình
    if (userRole === "admin") {
        const settingsBtn = document.getElementById("adminAiSettingsBtn");
        if (settingsBtn) {
            settingsBtn.style.display = "inline-flex";
        }
    }

    // Tải và hiển thị Liên kết & Tài liệu nhanh
    loadQuickLinks();

    // Hiển thị giao diện chính sau khi đã xác thực xong
    const pageContent = document.getElementById("pageContent");
    if (pageContent) {
        pageContent.style.display = "block";
    }

    // Tải dữ liệu tri thức từ Firestore
    await loadDocumentChunks();
});

// =========================================================
// IndexedDB Cache Module cho Document Chunks (Delta Sync)
// =========================================================
const IDB_NAME = "tailieu_cache_v1";
const IDB_VERSION = 1;
const STORE_CHUNKS = "chunks";
const STORE_DOCS = "documents";
const STORE_META = "meta";

function openIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
                db.createObjectStore(STORE_CHUNKS, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_DOCS)) {
                db.createObjectStore(STORE_DOCS, { keyPath: "_id" });
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbGetAll(idb, storeName) {
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbPutAll(idb, storeName, items) {
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        items.forEach(item => store.put(item));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function idbDeleteKeys(idb, storeName, keys) {
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        keys.forEach(k => store.delete(k));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function idbGetMeta(idb, key) {
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_META, "readonly");
        const req = tx.objectStore(STORE_META).get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error);
    });
}

function idbSetMeta(idb, key, value) {
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_META, "readwrite");
        tx.objectStore(STORE_META).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Xây dựng chuỗi cache key phân biệt theo role người dùng
function getCacheKey() {
    return `lastSync_${userRole}`;
}

// Tải và áp dụng dữ liệu từ cache IndexedDB (không cần Firestore)
async function loadFromIDB(idb) {
    const [cachedChunks, cachedDocs] = await Promise.all([
        idbGetAll(idb, STORE_CHUNKS),
        idbGetAll(idb, STORE_DOCS)
    ]);

    if (cachedChunks.length === 0) return false; // Chưa có cache

    // Khôi phục allDocuments và docCodeMap từ cache
    allDocuments = {};
    cachedDocs.forEach(d => {
        const { _id, ...data } = d;
        allDocuments[_id] = data;
    });
    const docIds = Object.keys(allDocuments).sort((a, b) => {
        const titleA = allDocuments[a].title || allDocuments[a].fileName || "";
        const titleB = allDocuments[b].title || allDocuments[b].fileName || "";
        return titleA.localeCompare(titleB);
    });
    docCodeMap = {};
    docIds.forEach((id, idx) => {
        docCodeMap[id] = `TL-${String(idx + 1).padStart(2, "0")}`;
    });

    // Lọc chunk theo role hiện tại (vì cache lưu theo role)
    allChunks = cachedChunks;
    allChunks.sort((a, b) => {
        const catComp = (a.category || "").localeCompare(b.category || "");
        if (catComp !== 0) return catComp;
        return (a.sectionName || "").localeCompare(b.sectionName || "");
    });

    return true;
}

// Delta Sync: Chỉ tải các bản ghi được cập nhật sau thời điểm đồng bộ cuối
async function deltaSyncFromFirestore(idb, lastSyncTime) {
    let hasChanges = false;
    const syncStart = new Date();

    try {
        // Đồng bộ tài liệu gốc (documents)
        const docSnap = await getDocs(collection(db, "documents"));
        const freshDocs = [];
        docSnap.forEach(d => {
            freshDocs.push({ _id: d.id, ...d.data() });
        });

        if (freshDocs.length > 0) {
            await idbPutAll(idb, STORE_DOCS, freshDocs);
            allDocuments = {};
            freshDocs.forEach(({ _id, ...data }) => {
                allDocuments[_id] = data;
            });
            const docIds = Object.keys(allDocuments).sort((a, b) => {
                const titleA = allDocuments[a].title || allDocuments[a].fileName || "";
                const titleB = allDocuments[b].title || allDocuments[b].fileName || "";
                return titleA.localeCompare(titleB);
            });
            docCodeMap = {};
            docIds.forEach((id, idx) => {
                docCodeMap[id] = `TL-${String(idx + 1).padStart(2, "0")}`;
            });
        }

        // Đồng bộ chunks: nếu có lastSyncTime thì chỉ lấy bản ghi mới hơn
        let q;
        const { Timestamp } = await import("./script.js").catch(() => ({ Timestamp: null }));

        if (userRole === "admin") {
            q = query(collection(db, "document_chunks"));
        } else if (userRole === "user") {
            q = query(collection(db, "document_chunks"), where("targetGroup", "in", ["guest", "user"]));
        } else {
            q = query(collection(db, "document_chunks"), where("targetGroup", "==", "guest"));
        }

        const snap = await getDocs(q);
        const freshChunks = [];
        snap.forEach(d => freshChunks.push({ id: d.id, ...d.data() }));

        if (freshChunks.length > 0) {
            // Xóa cache cũ và ghi lại toàn bộ batch mới (đơn giản và đáng tin cậy)
            const existingChunks = await idbGetAll(idb, STORE_CHUNKS);
            const existingIds = new Set(existingChunks.map(c => c.id));
            const freshIds = new Set(freshChunks.map(c => c.id));

            // Xóa chunk bị xóa khỏi Firestore
            const deletedIds = [...existingIds].filter(id => !freshIds.has(id));
            if (deletedIds.length > 0) {
                await idbDeleteKeys(idb, STORE_CHUNKS, deletedIds);
            }

            await idbPutAll(idb, STORE_CHUNKS, freshChunks);

            // Cập nhật allChunks trong bộ nhớ
            allChunks = freshChunks;
            allChunks.sort((a, b) => {
                const catComp = (a.category || "").localeCompare(b.category || "");
                if (catComp !== 0) return catComp;
                return (a.sectionName || "").localeCompare(b.sectionName || "");
            });

            hasChanges = true;
        }

        // Lưu timestamp đồng bộ mới
        await idbSetMeta(idb, getCacheKey(), syncStart.toISOString());

    } catch (e) {
        console.warn("[Delta Sync] Lỗi đồng bộ, giữ nguyên dữ liệu cache:", e);
    }

    return hasChanges;
}

// Tải dữ liệu tri thức an toàn từ Firestore dựa trên Vai trò (có IndexedDB Cache + Delta Sync)
async function loadDocumentChunks() {
    renderLoading("Đang kết nối hệ thống tri thức...");

    try {
        const idb = await openIDB();
        const lastSync = await idbGetMeta(idb, getCacheKey());
        const hasCachedData = await loadFromIDB(idb);

        if (hasCachedData) {
            // Có cache: render ngay lập tức từ IndexedDB
            buildInvertedIndex();
            renderGrid();

            // Đồng bộ delta ở nền (không chặn UI)
            deltaSyncFromFirestore(idb, lastSync).then(changed => {
                if (changed) {
                    // Có dữ liệu mới: cập nhật lại UI lặng lẽ
                    buildInvertedIndex();
                    renderGrid();
                    console.log("[Cache] Delta sync hoàn tất, giao diện đã cập nhật.");
                } else {
                    console.log("[Cache] Dữ liệu đã đồng bộ, không có thay đổi mới.");
                }
            });

        } else {
            // Chưa có cache: tải full từ Firestore lần đầu
            renderLoading("Đang tải lần đầu từ Firestore...");
            await deltaSyncFromFirestore(idb, null);
            buildInvertedIndex();
            renderGrid();
            console.log("[Cache] Tải lần đầu hoàn tất, đã lưu vào IndexedDB.");
        }

    } catch (error) {
        console.error("Lỗi khi tải tri thức:", error);
        // Fallback: thử tải trực tiếp từ Firestore nếu IndexedDB gặp sự cố
        try {
            await loadDocumentChunksDirectly();
        } catch (e2) {
            renderError("Lỗi kết nối dữ liệu", "Không thể tải danh sách tài liệu. Vui lòng kiểm tra quyền truy cập Firestore Rules hoặc làm mới trang.");
        }
    }
}

// Fallback: tải trực tiếp từ Firestore không qua IndexedDB (dự phòng)
async function loadDocumentChunksDirectly() {
    try {
        const docSnap = await getDocs(collection(db, "documents"));
        allDocuments = {};
        docSnap.forEach(d => { allDocuments[d.id] = d.data(); });
        const docIds = Object.keys(allDocuments).sort((a, b) => {
            const titleA = allDocuments[a].title || allDocuments[a].fileName || "";
            const titleB = allDocuments[b].title || allDocuments[b].fileName || "";
            return titleA.localeCompare(titleB);
        });
        docCodeMap = {};
        docIds.forEach((id, idx) => { docCodeMap[id] = `TL-${String(idx + 1).padStart(2, "0")}`; });
    } catch (e) { console.warn("Lỗi khi tải metadata tài liệu gốc:", e); }

    let q;
    if (userRole === "admin") {
        q = query(collection(db, "document_chunks"));
    } else if (userRole === "user") {
        q = query(collection(db, "document_chunks"), where("targetGroup", "in", ["guest", "user"]));
    } else {
        q = query(collection(db, "document_chunks"), where("targetGroup", "==", "guest"));
    }
    const snap = await getDocs(q);
    allChunks = [];
    snap.forEach(d => allChunks.push({ id: d.id, ...d.data() }));
    allChunks.sort((a, b) => {
        const catComp = (a.category || "").localeCompare(b.category || "");
        if (catComp !== 0) return catComp;
        return (a.sectionName || "").localeCompare(b.sectionName || "");
    });
    buildInvertedIndex();
    renderGrid();
}


// Hàm bỏ dấu tiếng Việt để tìm kiếm không dấu (nhận diện "qd 85" thành "QĐ 85")
function removeAccents(str) {
    if (!str) return "";
    return str.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLowerCase();
}

// Hàm kiểm tra ký tự có phải là chữ/số thông thường không (để tìm ranh giới từ nguyên)
function isWordChar(char) {
    return /[a-zA-Z0-9_]/.test(char);
}

// Hàm xây dựng chỉ mục đảo client-side từ allChunks
function buildInvertedIndex() {
    invertedIndex = {};
    allChunks.forEach(chunk => {
        const docCode = docCodeMap[chunk.documentId] || "";
        
        // Hợp nhất các trường để bóc tách từ khóa
        const textToTokenize = [
            docCode,
            chunk.documentTitle || "",
            chunk.title || "",
            chunk.sectionName || "",
            chunk.content || "",
            chunk.summary || "",
            (chunk.keywords || []).join(" ")
        ].join(" ").toLowerCase();

        const cleanText = removeAccents(textToTokenize);

        // Tách thành các từ nguyên. Giữ lại từ từ 2 ký tự trở lên, hoặc các chữ số đơn lẻ (ví dụ "6")
        const terms = cleanText.split(/[^a-z0-9_]+/g).filter(t => t.length >= 2 || /[0-9]/.test(t));

        terms.forEach(term => {
            if (!invertedIndex[term]) {
                invertedIndex[term] = new Set();
            }
            invertedIndex[term].add(chunk);
        });

        // Bổ sung nguyên bản mã tài liệu (vd: "tl-01" và "tl01") phòng hờ bộ phân tách regex ở trên cắt mất ký tự gạch ngang
        if (docCode) {
            const docCodeClean = removeAccents(docCode);
            if (!invertedIndex[docCodeClean]) {
                invertedIndex[docCodeClean] = new Set();
            }
            invertedIndex[docCodeClean].add(chunk);
            
            const docCodeNoDash = docCodeClean.replace(/-/g, "");
            if (!invertedIndex[docCodeNoDash]) {
                invertedIndex[docCodeNoDash] = new Set();
            }
            invertedIndex[docCodeNoDash].add(chunk);
        }
    });
    console.log(`[Chỉ mục đảo] Khởi tạo thành công với ${Object.keys(invertedIndex).length} từ khóa độc lập.`);
}

// Kiểm tra khớp mã tài liệu có/không gạch ngang linh hoạt (ví dụ tl-01, tl01, TL01...)
function matchDocCode(docCode, token) {
    if (!docCode || !token) return false;
    const cleanCode = removeAccents(docCode.toLowerCase());
    const cleanToken = removeAccents(token.toLowerCase());
    if (cleanCode === cleanToken) return true;
    if (cleanCode.replace(/-/g, "") === cleanToken.replace(/-/g, "")) return true;
    return false;
}

// Đếm số lần xuất hiện của từ khóa dạng từ nguyên trong chuỗi văn bản gốc
function countOccurrences(fieldOriginal, token) {
    if (!fieldOriginal || !token) return 0;
    const fieldLower = fieldOriginal.toLowerCase();
    const isAccentSensitive = (token !== removeAccents(token));

    // Nếu nhạy cảm dấu: tìm trong văn bản gốc. Nếu không: tìm trong văn bản đã lọc dấu.
    const sourceText = isAccentSensitive ? fieldLower : removeAccents(fieldLower);

    let count = 0;
    let idx = 0;
    while (true) {
        const foundIdx = sourceText.indexOf(token, idx);
        if (foundIdx === -1) break;

        const hasLeft = foundIdx === 0 || !isWordChar(sourceText.charAt(foundIdx - 1));
        const hasRight = foundIdx + token.length === sourceText.length || !isWordChar(sourceText.charAt(foundIdx + token.length));

        if (hasLeft && hasRight) {
            count++;
            idx = foundIdx + token.length;
        } else {
            idx = foundIdx + 1;
        }
    }
    return count;
}

// Phân tích độ gần (Proximity) và thứ tự xuất hiện (Ordered Match) của mảng từ khóa trong văn bản
function analyzeFieldCloseness(fieldOriginal, tokens) {
    if (!fieldOriginal || !tokens || tokens.length <= 1) {
        return { ordered: false, proximityBonus: 0 };
    }

    const fieldLower = fieldOriginal.toLowerCase();
    const fieldClean = removeAccents(fieldLower);

    const indices = [];
    for (const token of tokens) {
        const isAccentSensitive = (token !== removeAccents(token));
        const sourceText = isAccentSensitive ? fieldLower : fieldClean;

        // Tìm vị trí khớp đầu tiên của token dạng từ nguyên
        let idx = 0;
        let foundIdx = -1;
        while (true) {
            foundIdx = sourceText.indexOf(token, idx);
            if (foundIdx === -1) break;

            const hasLeft = foundIdx === 0 || !isWordChar(sourceText.charAt(foundIdx - 1));
            const hasRight = foundIdx + token.length === sourceText.length || !isWordChar(sourceText.charAt(foundIdx + token.length));
            if (hasLeft && hasRight) break;
            idx = foundIdx + 1;
        }

        if (foundIdx === -1) {
            return { ordered: false, proximityBonus: 0 }; // Không đủ bộ từ khóa
        }
        indices.push(foundIdx);
    }

    // 1. Kiểm tra xem các từ khóa có xuất hiện đúng thứ tự của truy vấn gõ hay không
    let ordered = true;
    for (let i = 0; i < indices.length - 1; i++) {
        if (indices[i] >= indices[i + 1]) {
            ordered = false;
            break;
        }
    }

    // 2. Tính toán khoảng cách gần nhau của các từ (Proximity Score)
    const min = Math.min(...indices);
    const max = Math.max(...indices);
    const span = max - min;

    let proximityBonus = 0;
    if (span < 150) {
        proximityBonus = 30; // Từ khóa nằm sát sạt nhau (rất liên quan)
    } else if (span < 300) {
        proximityBonus = 15; // Từ khóa nằm tương đối gần nhau
    }

    return { ordered, proximityBonus };
}

// Hàm highlight từ khóa khớp trong văn bản (chấp nhận cả không dấu lẫn có dấu theo ngữ cảnh)
function highlightText(text, searchTokens) {
    if (!text || !searchTokens || searchTokens.length === 0) return text;

    // Escape HTML ký tự đặc biệt trước để tránh lỗi XSS
    let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Sắp xếp các từ tìm kiếm theo độ dài giảm dần để tránh highlight chồng lấn từ ngắn
    const sortedTokens = [...searchTokens].sort((a, b) => b.length - a.length);

    const MARK_START = "\uFFF0";
    const MARK_END = "\uFFF1";

    sortedTokens.forEach(token => {
        if (token.length < 2) return; // Bỏ qua từ quá ngắn (1 ký tự)

        let pos = 0;
        const isAccentSensitive = (token !== removeAccents(token));

        while (true) {
            // So khớp nhạy cảm dấu dựa trên văn bản gốc, ngược lại so khớp trên văn bản đã lọc dấu
            const sourceText = isAccentSensitive ? escaped.toLowerCase() : removeAccents(escaped);
            const index = sourceText.indexOf(token, pos);
            if (index === -1) break;

            // Kiểm tra ranh giới từ nguyên (Word Boundary)
            const hasLeftBoundary = index === 0 || !isWordChar(sourceText.charAt(index - 1));
            const hasRightBoundary = index + token.length === sourceText.length || !isWordChar(sourceText.charAt(index + token.length));

            if (hasLeftBoundary && hasRightBoundary) {
                // Đảm bảo không highlight lặp đè bên trong một thẻ mark đã có
                const leftPart = escaped.substring(0, index);
                const lastStart = leftPart.lastIndexOf(MARK_START);
                const lastEnd = leftPart.lastIndexOf(MARK_END);

                if (lastStart > lastEnd) {
                    pos = index + token.length;
                    continue;
                }

                const originalWord = escaped.substring(index, index + token.length);
                const replacement = MARK_START + originalWord + MARK_END;

                escaped = escaped.substring(0, index) + replacement + escaped.substring(index + token.length);
                pos = index + replacement.length;
            } else {
                // Không phải ranh giới từ, bỏ qua và tìm tiếp phía sau
                pos = index + 1;
            }
        }
    });

    // Thay thế các ký hiệu tạm thời bằng thẻ HTML <mark>
    return escaped
        .split(MARK_START).join('<mark class="search-highlight">')
        .split(MARK_END).join('</mark>');
}

// Hàm hiển thị danh sách tài liệu gốc bên Sidebar trái
function renderLeftSidebar(chunks, searchTokens = []) {
    const docLinksList = document.getElementById("docLinksList");
    if (!docLinksList) return;

    const uniqueDocs = [];
    const seenDocs = new Set();
    chunks.forEach(item => {
        if (item.documentId && !seenDocs.has(item.documentId)) {
            seenDocs.add(item.documentId);
            uniqueDocs.push({
                id: item.documentId,
                title: item.documentTitle || "Tài liệu gốc chưa đặt tên",
                category: item.category || "Khác",
                targetGroup: item.targetGroup || "guest"
            });
        }
    });

    // Cập nhật số lượng tài liệu gốc lên tiêu đề sidebar
    const sidebarDocCount = document.getElementById("sidebarDocCount");
    if (sidebarDocCount) {
        sidebarDocCount.textContent = `(${uniqueDocs.length})`;
    }

    if (uniqueDocs.length === 0) {
        docLinksList.innerHTML = `
            <div style="font-size:12.5px; color:#64748b; text-align:center; padding:30px 10px;">
                📭 Không có tài liệu nào phù hợp
            </div>
        `;
    } else {
        docLinksList.innerHTML = uniqueDocs.map(doc => {
            let catClass = "khac";
            const cat = (doc.category || "").toLowerCase();
            if (cat === "pháp lý") catClass = "phap-ly";
            else if (cat === "kỹ thuật") catClass = "ky-thuat";
            else if (cat === "hóa chất") catClass = "hoa-chat";

            let targetClass = "public";
            let targetText = "Công khai";
            const target = (doc.targetGroup || "").toLowerCase();
            if (target === "user") {
                targetClass = "internal";
                targetText = "Nội bộ";
            } else if (target === "admin") {
                targetClass = "confidential";
                targetText = "Mật";
            }

            // Áp dụng Highlight cho tên tài liệu gốc trong danh sách bên trái
            const dispDocTitle = highlightText(doc.title, searchTokens);

            const docCode = docCodeMap[doc.id] || "TL-XX";

            // Đếm số lượng tri thức (chunks) thuộc tài liệu này
            const chunkCount = allChunks.filter(c => c.documentId === doc.id).length;

            // Lấy số hiệu và ngày ban hành từ allDocuments
            const parentDoc = allDocuments[doc.id] || {};
            const docNumber = parentDoc.documentNumber || "";
            let issuedDateStr = "";
            if (parentDoc.issuedDate) {
                const dateObj = new Date(parentDoc.issuedDate);
                if (!isNaN(dateObj.getTime())) {
                    issuedDateStr = dateObj.toLocaleDateString("vi-VN");
                } else {
                    issuedDateStr = parentDoc.issuedDate;
                }
            }

            // Dòng metadata số + ngày (chỉ hiện nếu có)
            const metaLine = (docNumber || issuedDateStr) ? `
                <div class="doc-link-meta-detail">
                    ${docNumber ? `<span title="Số hiệu văn bản">📋 ${docNumber}</span>` : ""}
                    ${issuedDateStr ? `<span title="Ngày ban hành">📅 ${issuedDateStr}</span>` : ""}
                </div>` : "";

            // Nút xóa chỉ hiện với Admin (trong hàng badge)
            const deleteBtn = (userRole === "admin") ? `
                <button class="btn-delete-doc" data-docid="${doc.id}" data-doctitle="${doc.title.replace(/"/g, '&quot;')}"
                    title="Xóa tài liệu này khỏi hệ thống" onclick="event.stopPropagation()">Xóa</button>` : "";

            return `
                <div class="doc-link-item" data-docid="${doc.id}">
                    <div class="doc-link-icon">
                        📄
                        <span class="doc-chunk-count-badge" title="Tài liệu có ${chunkCount} phần tri thức">${chunkCount}</span>
                    </div>
                    <div class="doc-link-details">
                        <div class="doc-link-title" title="${doc.title}">
                            <span class="badge-doc-code" style="font-size: 9px; padding: 1px 4px; margin-right: 4px; border-radius: 3px;">${docCode}</span>
                            ${dispDocTitle}
                        </div>
                        ${metaLine}
                        <div class="doc-link-meta">
                            <span class="doc-link-badge ${catClass}">${doc.category}</span>
                            <span class="doc-link-badge ${targetClass}">${targetText}</span>
                            ${deleteBtn}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Đăng ký sự kiện click cho các nút liên kết tài liệu trong sidebar
        document.querySelectorAll(".doc-link-item").forEach(item => {
            item.addEventListener("click", () => {
                const docId = item.dataset.docid;
                openDocumentSecurely(docId);
            });
        });

        // Đăng ký sự kiện xóa (chỉ admin mới thấy nút này)
        document.querySelectorAll(".btn-delete-doc").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const docId = btn.dataset.docid;
                const docTitle = btn.dataset.doctitle;
                deleteDocumentAndKnowledge(docId, docTitle);
            });
        });
    }
}


// Hàm hiển thị kết quả ra lưới (đã lọc theo Tab và Ô Tìm kiếm)
function renderGrid() {
    const searchKeyword = docSearchInput.value.trim().toLowerCase();
    const cleanKeyword = removeAccents(searchKeyword);
    const searchTokens = searchKeyword ? searchKeyword.split(/\s+/).filter(t => t.length > 0) : [];

    // Map chứa thông tin score và lý do của AI
    const aiMatchMap = {};

    // Trạng thái ban đầu: Chưa gõ từ khóa & Tab đang chọn là Tất cả & Không tìm kiếm bằng AI
    if (!cleanKeyword && activeCategory === "Tất cả" && !isAiSearchActive) {
        // Đếm số lượng tài liệu gốc duy nhất
        const seenDocs = new Set();
        allChunks.forEach(chunk => {
            if (chunk.documentId) seenDocs.add(chunk.documentId);
        });
        const numDocs = seenDocs.size;

        // Số thẻ hiển thị = số tài liệu / 2, nếu là số lẻ thì -1. Tối thiểu 2 thẻ, tối đa 10 thẻ.
        let initialShowCount = Math.floor(numDocs / 2);
        if (initialShowCount % 2 !== 0) {
            initialShowCount = initialShowCount - 1;
        }
        initialShowCount = Math.max(2, Math.min(10, initialShowCount));

        // Sắp xếp các đoạn tri thức theo thời gian tạo (Mới nhất lên đầu)
        const sortedByNewest = [...allChunks].sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
            const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
            return dateB - dateA;
        });

        const newestItems = sortedByNewest.slice(0, initialShowCount);

        if (newestItems.length === 0) {
            documentGrid.innerHTML = `
                <div class="state-container">
                    <h3>📭 Chưa có tri thức nào được nạp</h3>
                    <p>Vui lòng cập nhật tài liệu từ trang Admin để đồng bộ dữ liệu.</p>
                </div>
            `;
            renderLeftSidebar([]);
            return;
        }

        // Render các thẻ tri thức mới nhất
        let html = "";

        html += newestItems.map(item => {
            let catClass = "khac";
            const cat = (item.category || "").toLowerCase();
            if (cat === "pháp lý") catClass = "phap-ly";
            else if (cat === "kỹ thuật") catClass = "ky-thuat";
            else if (cat === "hóa chất") catClass = "hoa-chat";

            let targetClass = "public";
            let targetText = "Công khai";
            const target = (item.targetGroup || "").toLowerCase();
            if (target === "user") {
                targetClass = "internal";
                targetText = "Nội bộ";
            } else if (target === "admin") {
                targetClass = "confidential";
                targetText = "Mật";
            }

            const keywordsArray = Array.isArray(item.keywords) ? item.keywords.slice(0, 5) : [];
            const keywordsHTML = keywordsArray.map(kw => `<span class="keyword-tag">#${kw}</span>`).join('');

            const dispDocTitle = item.documentTitle || "Tài liệu gốc chưa đặt tên";
            const dispSectionName = item.sectionName || "";
            const dispTitle = item.title || "";
            const dispContent = item.content || "Chưa có nội dung";

            const parentDoc = allDocuments[item.documentId] || {};
            const docCode = docCodeMap[item.documentId] || "TL-XX";

            let displayDate = "Chưa rõ";
            if (parentDoc.issuedDate) {
                const dateObj = new Date(parentDoc.issuedDate);
                if (!isNaN(dateObj.getTime())) {
                    displayDate = dateObj.toLocaleDateString("vi-VN");
                } else {
                    displayDate = parentDoc.issuedDate;
                }
            }
            const displayBy = parentDoc.issuedBy || "Đang cập nhật";
            const displayNo = parentDoc.documentNumber || parentDoc.fileName || "Chưa rõ";

            return `
                <div class="document-card">
                    <div>
                        <div class="card-header-info">
                            <div>
                                <span class="badge-doc-code" title="Mã tài liệu">${docCode}</span>
                                <span class="badge-category ${catClass}">${item.category || "Khác"}</span>
                            </div>
                            <span class="badge-target ${targetClass}">${targetText}</span>
                        </div>
                        <div class="card-doc-title" title="Tài liệu gốc">${dispDocTitle}</div>
                        
                        <div class="card-doc-meta-row">
                            <div class="card-doc-meta-item" title="Số / Ký hiệu văn bản">
                                <span>📋</span> <b>Số:</b> ${displayNo}
                            </div>
                            <div class="card-doc-meta-item" title="Ngày ban hành">
                                <span>📅</span> <b>Ngày:</b> ${displayDate}
                            </div>
                            <div class="card-doc-meta-item" title="Cơ quan ban hành">
                                <span>🏛️</span> <b>Ban hành:</b> ${displayBy}
                            </div>
                        </div>

                        <div class="card-section-name">${dispSectionName} ${dispTitle ? `- ${dispTitle}` : ""}</div>
                        <div class="card-content-extract" title="Nội dung trích dẫn chi tiết">
                            ${dispContent}
                        </div>
                    </div>
                    <div>
                        <div class="card-keywords">
                            ${keywordsHTML}
                        </div>
                        <div class="card-footer">
                            <button class="btn-view-doc" data-docid="${item.documentId}">
                                <span>🔗</span> Mở tài liệu gốc
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        documentGrid.innerHTML = html;

        // Đăng ký click cho nút mở tài liệu gốc
        document.querySelectorAll(".document-card .btn-view-doc").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const docId = btn.dataset.docid;
                openDocumentSecurely(docId);
            });
        });

        // Đăng ký click mở rộng/thu gọn
        document.querySelectorAll(".card-content-extract").forEach(el => {
            el.setAttribute("title", "Nhấp chuột để mở rộng hoặc thu gọn văn bản trích dẫn");
            el.addEventListener("click", () => {
                el.classList.toggle("expanded");
            });
        });

        // Render toàn bộ tài liệu gốc bên Sidebar trái
        renderLeftSidebar(allChunks);
        return;
    }

    let filtered = [];

    if (isAiSearchActive && aiSearchResults && aiSearchResults.length > 0) {
        // Chế độ Tìm kiếm bằng AI
        aiSearchResults.forEach(res => {
            aiMatchMap[res.id] = { score: res.score, reason: res.reason };
        });

        const matchedChunks = allChunks.filter(chunk => chunk.id in aiMatchMap);
        matchedChunks.sort((a, b) => aiMatchMap[b.id].score - aiMatchMap[a.id].score);
        filtered = matchedChunks;

        // Lọc theo danh mục của Tab đang chọn
        if (activeCategory !== "Tất cả") {
            filtered = filtered.filter(item => item.category === activeCategory);
        }
    } else {
        // Chế độ tìm kiếm thường:
        // 1. Chỉ mục đảo (Inverted Index lookup) thu hẹp số lượng ứng viên để tìm kiếm tức thì
        let candidates = null;
        if (searchTokens.length > 0) {
            for (const token of searchTokens) {
                const tokenClean = removeAccents(token);
                const termsToLookup = [tokenClean];

                // Hỗ trợ gõ dạng "tl01" vẫn tìm được "tl-01" và ngược lại
                if (tokenClean.startsWith("tl") && tokenClean.length > 2) {
                    const numberPart = tokenClean.substring(2).replace(/-/g, "");
                    if (/^\d+$/.test(numberPart)) {
                        termsToLookup.push(`tl-${numberPart}`);
                        termsToLookup.push(`tl${numberPart}`);
                    }
                }

                // Mở rộng từ điển đồng nghĩa (nếu có)
                const synonyms = SYNONYM_DICT[tokenClean];
                if (synonyms) {
                    synonyms.forEach(syn => {
                        const synClean = removeAccents(syn);
                        synClean.split(/\s+/).forEach(t => termsToLookup.push(t));
                    });
                }

                // Hợp các Set của từ gốc và từ đồng nghĩa
                let tokenChunks = new Set();
                termsToLookup.forEach(term => {
                    const set = invertedIndex[term];
                    if (set) {
                        set.forEach(chunk => tokenChunks.add(chunk));
                    }
                });

                // Giao tập hợp (AND constraint)
                if (candidates === null) {
                    candidates = tokenChunks;
                } else {
                    const nextCandidates = new Set();
                    tokenChunks.forEach(chunk => {
                        if (candidates.has(chunk)) {
                            nextCandidates.add(chunk);
                        }
                    });
                    candidates = nextCandidates;
                }

                if (candidates.size === 0) break;
            }
        }

        filtered = candidates ? Array.from(candidates) : allChunks;

        // Lọc theo danh mục của Tab đang chọn
        if (activeCategory !== "Tất cả") {
            filtered = filtered.filter(item => item.category === activeCategory);
        }

        // Helper kiểm tra một từ khóa có khớp như một TỪ NGUYÊN (Whole Word) trong chuỗi hay không
        // Tự động phân tích xem token có dấu hay không để áp dụng so khớp chính xác ngữ cảnh
        function checkWholeWordMatch(fieldOriginal, token) {
            if (!fieldOriginal) return false;

            const fieldLower = fieldOriginal.toLowerCase();
            const isAccentSensitive = (token !== removeAccents(token));

            // Nếu nhạy cảm dấu: tìm trong văn bản gốc. Nếu không: tìm trong văn bản đã lọc dấu.
            const sourceText = isAccentSensitive ? fieldLower : removeAccents(fieldLower);

            let idx = 0;
            while (true) {
                const foundIdx = sourceText.indexOf(token, idx);
                if (foundIdx === -1) return false;

                const hasLeft = foundIdx === 0 || !isWordChar(sourceText.charAt(foundIdx - 1));
                const hasRight = foundIdx + token.length === sourceText.length || !isWordChar(sourceText.charAt(foundIdx + token.length));

                if (hasLeft && hasRight) return true;
                idx = foundIdx + 1;
            }
        }

        // Helper kiểm tra khớp cụm từ chính xác (Exact Phrase Match) trong bất kỳ trường nào của tài liệu
        function checkExactPhraseMatch(item, queryText) {
            if (!queryText) return false;
            const cleanQuery = removeAccents(queryText);
            const docCode = docCodeMap[item.documentId] || "";
            
            // So khớp mã tài liệu có/không gạch ngang linh hoạt
            if (matchDocCode(docCode, queryText)) return true;

            const fields = [
                item.documentTitle || "",
                item.title || "",
                item.sectionName || "",
                item.content || "",
                item.summary || ""
            ];
            return fields.some(field => {
                const fieldLower = field.toLowerCase();
                if (fieldLower.includes(queryText)) return true;
                if (removeAccents(fieldLower).includes(cleanQuery)) return true;
                return false;
            });
        }

        const importantTokens = searchTokens.filter(t => !STOP_WORDS.has(t));

        // 2. Lọc và xếp hạng nâng cao theo cụm từ và từ khóa tìm kiếm (Relevance Multi-word Scoring)
        if (cleanKeyword) {
            if (searchTokens.length > 0) {
                const scoredItems = [];

                filtered.forEach(item => {
                    let score = 0;
                    let isMatched = false;

                    // A. Ưu tiên cao nhất: Khớp cụm từ nguyên bản chính xác (Exact Phrase Match)
                    if (checkExactPhraseMatch(item, searchKeyword)) {
                        score += 150; // Cộng điểm thưởng cực lớn cho khớp cả cụm từ liên tục
                        isMatched = true;
                    }

                    // B. Ưu tiên phụ: Khớp tất cả từ khóa quan trọng (nếu không tìm thấy cụm từ chính xác)
                    if (!isMatched) {
                        // Nếu truy vấn CHỈ chứa các từ dừng (ví dụ "6 tháng đầu năm") nhưng không khớp cụm từ chính xác -> Loại bỏ
                        if (importantTokens.length === 0) {
                            return;
                        }

                        let matchedImportantCount = 0;

                        // Chỉ yêu cầu khớp toàn bộ các từ quan trọng (AND matching cho important tokens)
                        importantTokens.forEach(token => {
                            let tokenMatched = false;

                            // So khớp mã tài liệu có/không gạch ngang linh hoạt
                            const docCode = docCodeMap[item.documentId] || "";
                            if (matchDocCode(docCode, token)) {
                                score += 50; // Trọng số cực lớn cho khớp mã tài liệu
                                tokenMatched = true;
                            }

                            const fieldsToCheck = [
                                { val: item.documentTitle || "", weight: 15 },
                                { val: item.title || "", weight: 10 },
                                { val: item.sectionName || "", weight: 10 },
                                { val: (item.keywords || []).join(" "), weight: 8 },
                                { val: item.summary || "", weight: 5 },
                                { val: item.content || "", weight: 3 }
                            ];

                            fieldsToCheck.forEach(f => {
                                const count = countOccurrences(f.val, token);
                                if (count > 0) {
                                    // TF log-scoring: weight * (1 + ln(count)) để tránh spam từ khóa
                                    score += f.weight * (1 + Math.log(count));
                                    tokenMatched = true;
                                }
                            });

                            // Kiểm tra từ đồng nghĩa từ điển bổ sung
                            if (!tokenMatched) {
                                const synonyms = SYNONYM_DICT[token];
                                if (synonyms) {
                                    synonyms.forEach(syn => {
                                        const count = countOccurrences(item.content || "", syn) + countOccurrences(item.title || "", syn);
                                        if (count > 0) {
                                            score += 5 * (1 + Math.log(count)); // Điểm thưởng đồng nghĩa
                                            tokenMatched = true;
                                        }
                                    });
                                }
                            }

                            if (tokenMatched) {
                                matchedImportantCount++;
                            }
                        });

                        if (matchedImportantCount === importantTokens.length) {
                            isMatched = true;

                            // C. Cấu trúc tính điểm nâng cao: Độ lân cận (Proximity) và Thứ tự xuất hiện (Ordered Match)
                            // Phân tích chi tiết trên nội dung trích dẫn và tiêu đề
                            const contentAnalysis = analyzeFieldCloseness(item.content || "", importantTokens);
                            if (contentAnalysis.ordered) {
                                score += 15; // Thưởng điểm đúng thứ tự từ (Ordered Match Bonus)
                            }
                            score += contentAnalysis.proximityBonus; // Thưởng điểm các từ đứng gần nhau (Proximity Bonus)

                            const titleAnalysis = analyzeFieldCloseness(item.title || "", importantTokens);
                            if (titleAnalysis.ordered) {
                                score += 10;
                            }
                            score += titleAnalysis.proximityBonus;
                        }
                    }

                    if (isMatched) {
                        // Cộng thêm điểm phụ nếu các từ dừng có xuất hiện trong tài liệu
                        searchTokens.forEach(token => {
                            if (STOP_WORDS.has(token)) {
                                const count = countOccurrences(item.content || "", token) + countOccurrences(item.title || "", token);
                                if (count > 0) {
                                    score += 0.5 * (1 + Math.log(count));
                                }
                            }
                        });

                        scoredItems.push({
                            item: item,
                            score: score
                        });
                    }
                });

                // Sắp xếp giảm dần theo điểm số mức độ liên quan (Relevance Score)
                scoredItems.sort((a, b) => b.score - a.score);

                // Trích xuất danh sách đã sắp xếp
                filtered = scoredItems.map(si => si.item);
            }
        }
    }

    // Render danh sách tài liệu gốc sang Sidebar bên trái
    renderLeftSidebar(filtered, searchTokens);

    // 3. Trả về kết quả rỗng nếu không tìm thấy
    if (filtered.length === 0) {
        documentGrid.innerHTML = `
            <div class="state-container">
                <h3>🔍 Không tìm thấy tài liệu phù hợp</h3>
                <p>Thử tìm kiếm với từ khóa khác hoặc chuyển sang danh mục khác xem sao.</p>
            </div>
        `;
        return;
    }

    // Lấy tối đa số lượng item theo displayLimit để render (Tránh quá tải DOM)
    const itemsToRender = filtered.slice(0, displayLimit);

    // 4. Render danh sách thẻ kết quả bên phải (Nay đổi sang phải, sidebar sang trái)
    let cardsHTML = itemsToRender.map(item => {
        // Phân loại Class cho Badge danh mục
        let catClass = "khac";
        const cat = (item.category || "").toLowerCase();
        if (cat === "pháp lý") catClass = "phap-ly";
        else if (cat === "kỹ thuật") catClass = "ky-thuat";
        else if (cat === "hóa chất") catClass = "hoa-chat";

        // Phân loại Class cho Badge đối tượng áp dụng
        let targetClass = "public";
        let targetText = "Công khai";
        const target = (item.targetGroup || "").toLowerCase();
        if (target === "user") {
            targetClass = "internal";
            targetText = "Nội bộ";
        } else if (target === "admin") {
            targetClass = "confidential";
            targetText = "Mật";
        }

        // Tạo danh sách Keyword tags
        const keywordsArray = Array.isArray(item.keywords) ? item.keywords.slice(0, 5) : [];
        const keywordsHTML = keywordsArray.map(kw => `<span class="keyword-tag">#${kw}</span>`).join('');

        // Áp dụng Highlight từ khóa cho các trường hiển thị văn bản
        const dispDocTitle = highlightText(item.documentTitle || "Tài liệu gốc chưa đặt tên", searchTokens);
        const dispSectionName = highlightText(item.sectionName || "", searchTokens);
        const dispTitle = highlightText(item.title || "", searchTokens);
        const dispContent = highlightText(item.content || "Chưa có nội dung", searchTokens);

        const parentDoc = allDocuments[item.documentId] || {};
        const docCode = docCodeMap[item.documentId] || "TL-XX";

        let displayDate = "Chưa rõ";
        if (parentDoc.issuedDate) {
            const dateObj = new Date(parentDoc.issuedDate);
            if (!isNaN(dateObj.getTime())) {
                displayDate = dateObj.toLocaleDateString("vi-VN");
            } else {
                displayDate = parentDoc.issuedDate;
            }
        }
        const displayBy = parentDoc.issuedBy || "Đang cập nhật";
        const displayNo = parentDoc.documentNumber || parentDoc.fileName || "Chưa rõ";

        // Badge thông tin AI (nếu có)
        const aiInfo = aiMatchMap[item.id];
        const aiBadgeHTML = aiInfo ? `<span class="badge-ai-match" title="AI xếp hạng: ${aiInfo.score}% khớp ngữ cảnh">✨ AI: ${aiInfo.score}%</span>` : "";
        const aiReasonHTML = (aiInfo && aiInfo.reason) ? `
            <div class="ai-reason-text" title="Lý do gợi ý từ AI">
                💡 <b>AI gợi ý:</b> ${aiInfo.reason}
            </div>` : "";

        return `
            <div class="document-card">
                <div>
                    <div class="card-header-info">
                        <div>
                            <span class="badge-doc-code" title="Mã tài liệu">${docCode}</span>
                            <span class="badge-category ${catClass}">${item.category || "Khác"}</span>
                            ${aiBadgeHTML}
                        </div>
                        <span class="badge-target ${targetClass}">${targetText}</span>
                    </div>
                    <!-- Hiển thị tiêu đề tài liệu gốc đầu tiên -->
                    <div class="card-doc-title" title="Tài liệu gốc">${dispDocTitle}</div>
                    
                    <!-- Dòng thông tin số hiệu, cơ quan, ngày ban hành -->
                    <div class="card-doc-meta-row">
                        <div class="card-doc-meta-item" title="Số / Ký hiệu văn bản">
                            <span>📋</span> <b>Số:</b> ${displayNo}
                        </div>
                        <div class="card-doc-meta-item" title="Ngày ban hành">
                            <span>📅</span> <b>Ngày:</b> ${displayDate}
                        </div>
                        <div class="card-doc-meta-item" title="Cơ quan ban hành">
                            <span>🏛️</span> <b>Ban hành:</b> ${displayBy}
                        </div>
                    </div>

                    <!-- Hiển thị tên Chương / Điều và tên phần bên dưới -->
                    <div class="card-section-name">${dispSectionName} ${dispTitle ? `- ${dispTitle}` : ""}</div>
                    ${aiReasonHTML}
                    <div class="card-content-extract" title="Nội dung trích dẫn chi tiết">
                        ${dispContent}
                    </div>
                </div>
                <div>
                    <div class="card-keywords">
                        ${keywordsHTML}
                    </div>
                    <div class="card-footer">
                        <button class="btn-view-doc" data-docid="${item.documentId}">
                            <span>🔗</span> Mở tài liệu gốc
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Nếu số lượng kết quả vượt quá giới hạn hiển thị, chèn nút Xem thêm
    if (filtered.length > displayLimit) {
        cardsHTML += `
            <div class="load-more-container">
                <button class="btn-load-more" id="btnLoadMore">
                    Xem thêm kết quả (${filtered.length - displayLimit} đoạn còn lại)
                </button>
            </div>
        `;
    }

    documentGrid.innerHTML = cardsHTML;

    // Đăng ký sự kiện click cho các nút "Mở tài liệu gốc" dưới mỗi card
    document.querySelectorAll(".document-card .btn-view-doc").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const docId = btn.dataset.docid;
            openDocumentSecurely(docId);
        });
    });

    // Đăng ký sự kiện cho nút Xem thêm nếu có
    const btnLoadMore = document.getElementById("btnLoadMore");
    if (btnLoadMore) {
        btnLoadMore.addEventListener("click", () => {
            displayLimit += 12; // Mở rộng thêm 12 card nữa
            renderGrid();
        });
    }

    // Đăng ký click để mở rộng/thu gọn nội dung trích dẫn khi quá dài
    document.querySelectorAll(".card-content-extract").forEach(el => {
        el.setAttribute("title", "Nhấp chuột để mở rộng hoặc thu gọn văn bản trích dẫn");
        el.addEventListener("click", () => {
            el.classList.toggle("expanded");
            const card = el.closest(".document-card");
            if (card) {
                card.classList.toggle("expanded-card");
            }
        });
    });
}

// Xóa tài liệu gốc và toàn bộ tri thức liên quan (Chỉ Admin)
async function deleteDocumentAndKnowledge(documentId, documentTitle) {
    if (userRole !== "admin") {
        window.Swal.fire({ icon: "warning", title: "Không có quyền", text: "Chỉ Admin mới được phép xóa tài liệu." });
        return;
    }

    const result = await window.Swal.fire({
        title: "⚠️ Xác nhận xóa tài liệu?",
        html: `Bạn sắp xóa hoàn toàn:<br><br>
               <b style="color:#e53e3e;">${documentTitle}</b><br><br>
               Thao tác này sẽ:<br>
               • Xóa tài liệu khỏi danh mục hệ thống<br>
               • Xóa toàn bộ thẻ tri thức liên quan<br><br>
               <small style="color:#64748b;">Lưu ý: Tệp gốc trên Google Drive <b>không bị xóa</b>.</small>`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#e53e3e",
        cancelButtonColor: "#64748b",
        confirmButtonText: "🗑️ Xóa hoàn toàn",
        cancelButtonText: "Hủy bỏ"
    });

    if (!result.isConfirmed) return;

    window.Swal.fire({
        title: "Đang xóa...",
        text: "Hệ thống đang gỡ tài liệu và tri thức liên quan.",
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => window.Swal.showLoading()
    });

    try {
        // 1. Xóa metadata tài liệu gốc trong collection "documents"
        await deleteDoc(doc(db, "documents", documentId));

        // 2. Xóa toàn bộ document_chunks liên quan
        const chunksQuery = query(
            collection(db, "document_chunks"),
            where("documentId", "==", documentId)
        );
        const chunksSnap = await getDocs(chunksQuery);
        const deletePromises = chunksSnap.docs.map(chunkDoc => deleteDoc(chunkDoc.ref));
        await Promise.all(deletePromises);

        // 3. Cập nhật dữ liệu local và render lại giao diện
        delete allDocuments[documentId];
        allChunks = allChunks.filter(chunk => chunk.documentId !== documentId);
        buildInvertedIndex();
        renderGrid();

        window.Swal.fire({
            icon: "success",
            title: "Đã xóa thành công",
            text: `Tài liệu "${documentTitle}" và ${chunksSnap.size} thẻ tri thức đã được gỡ khỏi hệ thống.`,
            timer: 3000,
            showConfirmButton: false
        });

    } catch (e) {
        console.error("Lỗi khi xóa tài liệu:", e);
        window.Swal.fire({ icon: "error", title: "Lỗi xóa", text: "Không thể xóa tài liệu. Kiểm tra Firestore Rules hoặc thử lại." });
    }
}

// Mở tài liệu an toàn thông qua Apps Script Proxy kiểm tra quyền bằng Ticket dùng 1 lần
async function openDocumentSecurely(documentId) {
    if (!documentId) {
        window.Swal.fire({ icon: "error", title: "Lỗi", text: "Không tìm thấy ID tài liệu gốc." });
        return;
    }

    // Kiểm tra trạng thái đăng nhập
    const user = auth.currentUser;
    if (!user || !user.email) {
        window.Swal.fire({ icon: "warning", title: "Yêu cầu đăng nhập", text: "Vui lòng đăng nhập hệ thống để tải tài liệu gốc." });
        return;
    }

    // Hiển thị trạng thái đang sinh Token bảo mật
    window.Swal.fire({
        title: "Đang sinh mã bảo mật...",
        text: "Hệ thống đang cấp vé truy cập an toàn dùng một lần.",
        icon: "info",
        showConfirmButton: false,
        allowOutsideClick: false,
        didOpen: () => {
            window.Swal.showLoading();
        }
    });

    try {
        // 1. Tạo ticketId ngẫu nhiên (UUID v4 client-side đơn giản)
        const ticketId = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );

        // 2. Ghi ticket lên Firestore bảng download_tickets
        // Vé này chỉ có thời hạn 60 giây
        const expiresAt = new Date(Date.now() + 60 * 1000);

        await setDoc(doc(db, "download_tickets", ticketId), {
            email: user.email,
            documentId: documentId,
            expiresAt: expiresAt.toISOString(),
            used: false,
            createdAt: new Date().toISOString()
        });

        // 3. Hiển thị thông báo đang tải file từ Google Drive
        window.Swal.fire({
            title: "Đang tải tài liệu...",
            text: "Hệ thống đang chuẩn bị tệp tin bảo mật trực tiếp từ Google Drive.",
            icon: "info",
            showConfirmButton: false,
            allowOutsideClick: false,
            didOpen: () => {
                window.Swal.showLoading();
            }
        });

        // 4. Mở sẵn một tab trống để tránh pop-up blocker của trình duyệt
        const newWindow = window.open("", "_blank");
        if (newWindow) {
            newWindow.document.write(`
                <!DOCTYPE html>
                <html>
                    <head>
                        <title>Đang tải tài liệu...</title>
                        <meta charset="utf-8">
                        <style>
                            body { margin:0; padding:0; display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background:#0f172a; color:#f1f5f9; font-family:sans-serif; }
                            .loader { border:4px solid rgba(255,255,255,0.1); border-left-color:#6366f1; width:36px; height:36px; border-radius:50%; animation:spin 1s linear infinite; margin-bottom:15px; }
                            @keyframes spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }
                            .box { text-align:center; }
                        </style>
                    </head>
                    <body>
                        <div class="box">
                            <div class="loader" style="margin:0 auto 15px auto;"></div>
                            <div style="font-size:15px; font-weight:500;">Đang tải tệp tin an toàn từ Google Drive...</div>
                            <div style="font-size:13px; color:#94a3b8; margin-top:5px;">Vui lòng không đóng cửa sổ này</div>
                        </div>
                    </body>
                </html>
            `);
        }

        // 5. Gọi Web App để lấy nội dung file dưới dạng Base64
        const redirectUrl = `${GAS_API_URL}?action=viewFile&ticketId=${ticketId}`;
        const response = await fetch(redirectUrl);
        if (!response.ok) {
            if (newWindow) newWindow.close();
            throw new Error(`Lỗi kết nối máy chủ (HTTP ${response.status})`);
        }

        const data = await response.json();
        if (!data.success) {
            if (newWindow) newWindow.close();
            throw new Error(data.error || "Không thể tải tài liệu.");
        }

        // 6. Giải mã Base64 thành Blob URL
        const byteCharacters = atob(data.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const fileBlob = new Blob([byteArray], { type: data.mimeType });
        const fileUrl = URL.createObjectURL(fileBlob);

        // 7. Mở xem trực tiếp nếu xem được (PDF, Ảnh), hoặc tự động tải về
        const viewableTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain'];
        
        if (viewableTypes.includes(data.mimeType)) {
            if (newWindow) {
                newWindow.location.href = fileUrl;
                newWindow.document.title = data.fileName;
            } else {
                window.open(fileUrl, "_blank");
            }
        } else {
            if (newWindow) newWindow.close();
            const link = document.createElement('a');
            link.href = fileUrl;
            link.download = data.fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        window.Swal.close();

    } catch (e) {
        console.error("Lỗi tải tài liệu gốc:", e);
        window.Swal.fire({ icon: "error", title: "Lỗi bảo mật", text: e.message || "Không thể tải tài liệu. Vui lòng liên hệ Admin hoặc làm mới trang." });
    }
}
window.openDocumentSecurely = openDocumentSecurely;


// Trạng thái đang tải dữ liệu
function renderLoading(msg) {
    documentGrid.innerHTML = `
        <div class="state-container">
            <div class="loader-spinner"></div>
            <h3>${msg}</h3>
            <p>Dữ liệu đang được đồng bộ và phản hồi nhanh chóng.</p>
        </div>
    `;
}

// Trạng thái báo lỗi dữ liệu
function renderError(title, desc) {
    documentGrid.innerHTML = `
        <div class="state-container" style="border-color: var(--danger-color);">
            <h3 style="color: var(--danger-color);">❌ ${title}</h3>
            <p>${desc}</p>
        </div>
    `;
}

// Hàm gọi trực tiếp Gemini API bằng Local Key làm dự phòng (khi Proxy lỗi mạng/cookie/Tracking Prevention)
async function callGeminiDirectly(contents) {
    let directKey = "";
    try {
        const { CONFIG } = await import("./config.js");
        directKey = CONFIG.GEMINI_API_KEY;
    } catch (e) {
        directKey = localStorage.getItem("GEMINI_API_KEY") || "";
    }

    if (!directKey || !directKey.startsWith("AIza")) {
        throw new Error("Chưa cấu hình API Key cho chế độ gọi trực tiếp.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PREFERRED_MODEL}:generateContent?key=${directKey}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents })
    });

    if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
    }

    const resJson = await response.json();
    const parts = resJson?.candidates?.[0]?.content?.parts;
    return parts && parts.length ? parts.map(p => p.text).join('\n') : "";
}

// Hàm tìm kiếm bằng Gemini AI qua Proxy bảo mật (giống trang chủ)
async function callGeminiAISearch(queryText) {
    const user = auth.currentUser;
    if (!user) {
        window.Swal.fire({
            icon: "warning",
            title: "Yêu cầu đăng nhập",
            text: "Vui lòng đăng nhập hệ thống để sử dụng tính năng tìm kiếm bằng AI."
        });
        return;
    }

    if (!allChunks || allChunks.length === 0) {
        window.Swal.fire({
            icon: "info",
            title: "Không có dữ liệu",
            text: "Dữ liệu tri thức chưa được tải xong. Vui lòng thử lại sau vài giây."
        });
        return;
    }

    // 1. Kiểm tra xác nhận trước khi dùng AI (nếu kích hoạt)
    const proceed = await confirmAiAction();
    if (!proceed) return;

    // Hiển thị trạng thái tải đơn giản trực tiếp dưới ô tìm kiếm (không nền, không che màn hình)
    const aiSummaryBlock = document.getElementById("aiSummaryBlock");
    if (aiSummaryBlock) {
        aiSummaryBlock.style.display = "block";
        aiSummaryBlock.innerHTML = `<div class="ai-summary-loading"><span class="ai-summary-spinner"></span> Gemini AI đang phân tích tài liệu và tổng hợp kết quả...</div>`;
    }

    // 2. Kiểm tra hạn mức sử dụng hằng ngày
    const hasQuota = await checkAndIncrementDailyUsage();
    if (!hasQuota) {
        if (aiSummaryBlock) aiSummaryBlock.style.display = "none";
        return;
    }

    try {
        // Phân tách queryText thành các tokens tìm kiếm để lọc thô
        const searchTokens = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 0);
        const importantTokens = searchTokens.filter(t => !STOP_WORDS.has(t));
        const tokensToCheck = importantTokens.length > 0 ? importantTokens : searchTokens;

        // Bước lọc thô tối ưu chi phí: chấm điểm nhanh cục bộ để chọn ra tối đa số lượng chunks theo cấu hình
        const scoredCandidates = allChunks.map(chunk => {
            let score = 0;
            const docCode = docCodeMap[chunk.documentId] || "";
            const fields = [
                docCode,
                chunk.documentTitle || "",
                chunk.title || "",
                chunk.sectionName || "",
                chunk.summary || "",
                chunk.content || "",
                (chunk.keywords || []).join(" ")
            ].map(f => removeAccents(f.toLowerCase()));

            tokensToCheck.forEach(token => {
                const tokenClean = removeAccents(token);
                const searchVariants = [tokenClean];
                if (tokenClean.startsWith("tl") && tokenClean.length > 2) {
                    const numberPart = tokenClean.substring(2).replace(/-/g, "");
                    if (/^\d+$/.test(numberPart)) {
                        searchVariants.push(`tl-${numberPart}`);
                        searchVariants.push(`tl${numberPart}`);
                    }
                }

                // 1. Khớp từ khóa gốc
                fields.forEach(field => {
                    searchVariants.forEach(variant => {
                        if (field.includes(variant)) {
                            score += 10;
                        }
                    });
                });

                // 2. Khớp từ đồng nghĩa trong từ điển
                const synonyms = SYNONYM_DICT[tokenClean];
                if (synonyms) {
                    synonyms.forEach(syn => {
                        const synClean = removeAccents(syn);
                        fields.forEach(field => {
                            if (field.includes(synClean)) {
                                score += 5;
                            }
                        });
                    });
                }
            });

            return { chunk, score };
        });

        // Sắp xếp giảm dần theo điểm và lấy tối đa ứng viên theo cấu hình (mặc định 6, admin rộng thì 15)
        const maxCandidates = window.aiConfig.wideContext ? 15 : 6;
        scoredCandidates.sort((a, b) => b.score - a.score);
        const topCandidates = scoredCandidates.slice(0, maxCandidates).map(sc => sc.chunk);

        // Chuẩn bị danh sách chunks rút gọn làm ngữ cảnh gửi lên Gemini (tiết kiệm 90% tokens)
        const chunkContexts = topCandidates.map((chunk, idx) => ({
            id: chunk.id,
            index: idx,
            title: chunk.documentTitle || "",
            section: chunk.sectionName || "",
            subTitle: chunk.title || "",
            summary: chunk.summary || "",
            contentSnippet: chunk.content ? chunk.content.substring(0, 300) : ""
        }));

        // Định hướng chi tiết câu trả lời theo cài đặt cấu hình
        let detailInstruction = "Viết một câu trả lời tóm tắt ngắn gọn (1-2 câu) bằng tiếng Việt giải thích trực tiếp về thông tin người dùng đang tìm kiếm dựa trên các tài liệu có sẵn. Chỉ tập trung vào ý chính cốt lõi, tránh viết dài dòng.";
        if (window.aiConfig.detailedResponse) {
            detailInstruction = "Viết một câu trả lời phân tích chuyên sâu, chi tiết đầy đủ và rõ ràng (có thể kèm các mục hướng dẫn nếu cần) bằng tiếng Việt dựa trên tài liệu cung cấp.";
        }

        // System Instruction & Prompt chi tiết yêu cầu cả tóm tắt và danh sách xếp hạng
        const systemInstruction = `Bạn là một trợ lý AI thông minh phụ trách công tác tìm kiếm tài liệu của Khu công nghiệp Thốt Nốt.
Nhiệm vụ của bạn là phân tích yêu cầu tìm kiếm bằng ngôn ngữ tự nhiên của người dùng, đối chiếu với danh sách các đoạn tài liệu được cung cấp dưới đây.

Hãy thực hiện 2 việc sau:
1. ${detailInstruction}
2. Xếp hạng và lọc ra danh sách các đoạn tài liệu liên quan nhất.

Trả về kết quả dưới dạng một đối tượng JSON có cấu trúc chính xác sau:
{
  "summary": "Câu trả lời tóm tắt/phân tích giải thích thông tin...",
  "results": [
    {
      "id": "id_cua_chunk",
      "score": 95, // Điểm số từ 0 đến 100
      "reason": "Giải thích ngắn gọn 1 câu vì sao đoạn này liên quan"
    }
  ]
}

Chỉ trả về chuỗi JSON thô hợp lệ, không bọc trong thẻ markdown, không có văn bản giải thích nào khác ngoài JSON.`;

        const userPrompt = `Yêu cầu tìm kiếm của người dùng: "${queryText}"

Danh sách các đoạn tài liệu có sẵn:
${JSON.stringify(chunkContexts)}`;

        const contents = [
            {
                role: "user",
                parts: [
                    { text: systemInstruction },
                    { text: userPrompt }
                ]
            }
        ];

        let aiResponseRaw = "";

        if (USE_PROXY) {
            try {
                // Lấy ID token để xác thực phía Server (Proxy GAS)
                const idToken = await user.getIdToken();

                const formData = new URLSearchParams();
                formData.append("action", "chatAI");
                formData.append("idToken", idToken);
                formData.append("data", JSON.stringify({
                    model: PREFERRED_MODEL,
                    contents: contents
                }));

                const response = await fetch(PROXY_URL, {
                    method: "POST",
                    body: formData
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errText}`);
                }

                const resJson = await response.json();
                if (resJson.error || resJson.success === false) {
                    throw new Error(resJson.error || "Lỗi Proxy không xác định");
                }

                const parts = resJson?.candidates?.[0]?.content?.parts;
                aiResponseRaw = parts && parts.length ? parts.map(p => p.text).join('\n') : "";
            } catch (proxyError) {
                console.warn("[DocChat] Proxy AI gặp lỗi, thử gọi trực tiếp bằng Local Key làm dự phòng:", proxyError);
                aiResponseRaw = await callGeminiDirectly(contents);
            }
        } else {
            aiResponseRaw = await callGeminiDirectly(contents);
        }

        if (!aiResponseRaw) {
            throw new Error("Không nhận được phản hồi từ AI.");
        }

        // Parse JSON phản hồi
        let cleanedText = aiResponseRaw.trim();
        if (cleanedText.startsWith("```json")) {
            cleanedText = cleanedText.substring(7);
        } else if (cleanedText.startsWith("```")) {
            cleanedText = cleanedText.substring(3);
        }
        if (cleanedText.endsWith("```")) {
            cleanedText = cleanedText.substring(0, cleanedText.length - 3);
        }
        cleanedText = cleanedText.trim();

        const dataObj = JSON.parse(cleanedText);

        if (!dataObj || typeof dataObj !== "object") {
            throw new Error("Định dạng dữ liệu trả về từ AI không hợp lệ.");
        }

        const results = dataObj.results || [];
        const summaryText = dataObj.summary || "";

        // Hiển thị tóm tắt trực tiếp trên nền
        if (aiSummaryBlock) {
            if (summaryText) {
                aiSummaryBlock.innerHTML = `<strong>✨ AI tóm tắt:</strong> ${summaryText}`;
            } else {
                aiSummaryBlock.style.display = "none";
            }
        }

        // Cập nhật trạng thái kết quả AI
        aiSearchResults = results.filter(r => r.id && r.score >= 40); // Lọc kết quả từ 40% khớp trở lên
        isAiSearchActive = true;
        displayLimit = 12;

        // Render lại Grid theo kết quả tìm kiếm AI
        renderGrid();

    } catch (error) {
        console.error("Lỗi tìm kiếm AI:", error);
        if (aiSummaryBlock) {
            aiSummaryBlock.innerHTML = `<span style="color: var(--danger-color);">❌ <b>Lỗi AI:</b> ${error.message || "Không thể phân tích yêu cầu ngữ cảnh."}</span>`;
        }
    }
}

// Bắt sự kiện gõ tìm kiếm tức thì (tự động tắt chế độ AI, ẩn tóm tắt và reset giới hạn phân trang)
docSearchInput.addEventListener("input", () => {
    isAiSearchActive = false;
    aiSearchResults = null;
    displayLimit = 12;
    const aiSummaryBlock = document.getElementById("aiSummaryBlock");
    if (aiSummaryBlock) {
        aiSummaryBlock.style.display = "none";
        aiSummaryBlock.innerHTML = "";
    }
    renderGrid();
});

// Bắt sự kiện click nút AI Tìm Kiếm
const aiSearchBtn = document.getElementById("aiSearchBtn");
if (aiSearchBtn) {
    aiSearchBtn.addEventListener("click", () => {
        const queryText = docSearchInput.value.trim();
        if (!queryText) {
            window.Swal.fire({
                icon: "warning",
                title: "Nhập nội dung tìm kiếm",
                text: "Vui lòng nhập câu hỏi hoặc yêu cầu tìm kiếm liên quan đến tài liệu trước khi nhấn nút AI."
            });
            return;
        }
        callGeminiAISearch(queryText);
    });
}

// Bắt sự kiện chọn các Tab phân loại (tự động reset giới hạn phân trang)
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeCategory = btn.dataset.category;
        displayLimit = 12;
        renderGrid();
    });
});

// Hàm tìm kiếm nhanh từ thẻ gợi ý ở màn hình chào mừng
window.triggerQuickSearch = function (keyword) {
    if (docSearchInput) {
        docSearchInput.value = keyword;
        displayLimit = 12;
        renderGrid();
    }
};

// =========================================================================
// 🔗 TẢI VÀ HIỂN THỊ LIÊN KẾT & TÀI LIỆU NHANH (Chuyển từ trang chủ sang)
// =========================================================================
async function loadQuickLinks() {
    const container = document.getElementById("quickLinksContainer");
    const listEl = document.getElementById("quickLinksList");
    if (!container || !listEl) return;

    try {
        // Lọc bảo mật từ gốc bằng cách chọn đúng Query dựa trên vai trò
        let q;
        if (userRole === "admin") {
            q = query(collection(db, "document_links"));
        } else if (userRole === "user") {
            q = query(collection(db, "document_links"), where("targetGroup", "in", ["guest", "user"]));
        } else {
            q = query(collection(db, "document_links"), where("targetGroup", "==", "guest"));
        }

        const snap = await getDocs(q);
        const docs = [];
        snap.forEach(docSnap => {
            docs.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Sắp xếp thứ tự
        docs.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

        if (docs.length === 0) {
            container.style.display = "none";
            return;
        }

        listEl.innerHTML = docs.map(doc => {
            return `
                <a href="${doc.url}" target="_blank" class="quick-link-item" title="${doc.title}">
                    <div class="quick-link-icon">🔗</div>
                    <div class="quick-link-info">
                        <div class="quick-link-title">${doc.title}</div>
                        <div class="quick-link-desc">${doc.description || "Nhấp để mở..."}</div>
                    </div>
                </a>
            `;
        }).join('');

        container.style.display = "block";
    } catch (err) {
        console.error("Lỗi khi tải Lối tắt công cụ:", err);
        container.style.display = "none";
    }
}
// Export để dùng nội bộ hoặc trong onAuth
window.loadQuickLinks = loadQuickLinks;

// =========================================================
// AI Chat Panel Multi-turn (Trợ lý Tài liệu)
// =========================================================

const CHAT_HISTORY_KEY_PREFIX = "chatHistory_";
const CHAT_MAX_MESSAGES = 30;       // Số tin nhắn lưu tối đa trong IndexedDB
const CHAT_CONTEXT_TURNS = 10;      // Số lượt hội thoại gần nhất gửi lên Gemini

let docChatHistory = [];            // Lịch sử hội thoại đang chạy (mảng {role, text})
let docChatIsThinking = false;      // Cờ chặn gửi khi AI đang trả lời

// Lấy key lịch sử theo email người dùng hiện tại
function getChatHistoryKey() {
    const email = auth.currentUser?.email || "guest";
    return `${CHAT_HISTORY_KEY_PREFIX}${email}`;
}

// Lưu lịch sử chat vào IndexedDB (meta store của tailieu_cache_v1)
async function saveChatHistory() {
    try {
        const idb = await openIDB();
        const trimmed = docChatHistory.slice(-CHAT_MAX_MESSAGES);
        await idbSetMeta(idb, getChatHistoryKey(), JSON.stringify(trimmed));
    } catch (e) {
        console.warn("[DocChat] Không thể lưu lịch sử chat:", e);
    }
}

// Đọc lịch sử chat từ IndexedDB
async function loadChatHistory() {
    try {
        const idb = await openIDB();
        const raw = await idbGetMeta(idb, getChatHistoryKey());
        if (raw) {
            docChatHistory = JSON.parse(raw);
        }
    } catch (e) {
        console.warn("[DocChat] Không thể đọc lịch sử chat:", e);
    }
}

// Thêm bong bóng tin nhắn vào UI
function appendChatMessage(role, text, isTyping = false) {
    const messagesEl = document.getElementById("docChatMessages");
    if (!messagesEl) return;

    const div = document.createElement("div");
    div.className = `doc-chat-msg ${role}${isTyping ? " typing" : ""}`;
    div.innerHTML = text.replace(/\n/g, "<br>");
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
}

// Render lại toàn bộ lịch sử chat vào UI
function renderChatHistory() {
    const messagesEl = document.getElementById("docChatMessages");
    if (!messagesEl) return;
    messagesEl.innerHTML = "";

    if (docChatHistory.length === 0) {
        // Tin nhắn chào ngắn gọn
        appendChatMessage("ai", "📄 Hỏi tôi bất cứ điều gì về tài liệu nhé!");
        return;
    }

    docChatHistory.forEach(msg => {
        appendChatMessage(msg.role, msg.text);
    });
}

async function sendDocChatMessage(text) {
    if (!text.trim() || docChatIsThinking) return;

    const user = auth.currentUser;
    if (!user) {
        appendChatMessage("ai", "⚠️ Vui lòng đăng nhập để sử dụng tính năng này.");
        return;
    }

    const cleanText = text.toLowerCase().trim();

    // Bước 1: Phân tách tokens tìm kiếm và chấm điểm cục bộ
    const searchTokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const importantTokens = searchTokens.filter(t => !STOP_WORDS.has(t));
    const tokensToCheck = importantTokens.length > 0 ? importantTokens : searchTokens;

    let scoredCandidates = [];
    if (tokensToCheck.length > 0) {
        scoredCandidates = allChunks.map(chunk => {
            let score = 0;
            const docCode = docCodeMap[chunk.documentId] || "";
            const fields = [
                docCode,
                chunk.documentTitle || "",
                chunk.title || "",
                chunk.sectionName || "",
                chunk.summary || "",
                chunk.content || "",
                (chunk.keywords || []).join(" ")
            ].map(f => removeAccents(f.toLowerCase()));

            tokensToCheck.forEach(token => {
                const tokenClean = removeAccents(token);
                const searchVariants = [tokenClean];
                if (tokenClean.startsWith("tl") && tokenClean.length > 2) {
                    const numberPart = tokenClean.substring(2).replace(/-/g, "");
                    if (/^\d+$/.test(numberPart)) {
                        searchVariants.push(`tl-${numberPart}`);
                        searchVariants.push(`tl${numberPart}`);
                    }
                }

                fields.forEach(f => {
                    searchVariants.forEach(variant => {
                        if (f.includes(variant)) {
                            score += 10;
                        }
                    });
                });
                const synonyms = SYNONYM_DICT[tokenClean];
                if (synonyms) {
                    synonyms.forEach(syn => {
                        const synClean = removeAccents(syn);
                        fields.forEach(f => { if (f.includes(synClean)) score += 5; });
                    });
                }
            });
            return { chunk, score };
        });
        scoredCandidates.sort((a, b) => b.score - a.score);
    }

    // Bước 2: Kiểm tra xem có phải câu hỏi/thảo luận cần AI hay chỉ là tìm kiếm từ khóa đơn giản
    const AI_TRIGGER_WORDS = [
        "tại sao", "vì sao", "thế nào", "như thế nào", "giải thích", "tổng hợp", "tóm tắt", 
        "so sánh", "đánh giá", "phân tích", "hãy", "hỏi", "gemini", "ai", "chatbot", "tư vấn",
        "liệt kê", "kể tên", "những", "các", "nào"
    ];
    
    const hasAiTrigger = AI_TRIGGER_WORDS.some(w => cleanText.includes(w));
    const isLongQuestion = searchTokens.length > 8;
    const hasGoodLocalMatch = scoredCandidates.length > 0 && scoredCandidates[0].score >= 20;

    const needsAI = hasAiTrigger || isLongQuestion || !hasGoodLocalMatch;

    // Nếu cần gọi AI, kiểm tra xác nhận và hạn mức sử dụng hằng ngày trước
    if (needsAI) {
        const proceed = await confirmAiAction();
        if (!proceed) return;

        const hasQuota = await checkAndIncrementDailyUsage();
        if (!hasQuota) return;
    }

    if (!needsAI && hasGoodLocalMatch) {
        // --- CHẾ ĐỘ TÌM KIẾM NHANH CỤC BỘ (KHÔNG DÙNG AI - 100% MIỄN PHÍ) ---
        docChatHistory.push({ role: "user", text });
        appendChatMessage("user", text);

        // Lấy tối đa 2 thẻ tri thức khớp nhất để hiển thị trực tiếp
        const topMatches = scoredCandidates.slice(0, 2);
        
        let replyHtml = `🔍 <b>Tìm thấy tài liệu phù hợp (Trực tiếp từ kho tri thức - Không dùng AI):</b><br><br>`;
        topMatches.forEach((item, index) => {
            const c = item.chunk;
            const docCode = docCodeMap[c.documentId] || "TL-XX";
            replyHtml += `<b>${index + 1}. [${docCode}] ${c.documentTitle || "Tài liệu"}</b><br>`;
            if (c.sectionName) replyHtml += `• Phần: <i>${c.sectionName}</i><br>`;
            if (c.title) replyHtml += `• Mục: <i>${c.title}</i><br>`;
            replyHtml += `📝 ${c.summary || c.content.substring(0, 200) + "..."}<br>`;
            replyHtml += `👉 <a href="javascript:void(0);" onclick="openDocumentSecurely('${c.documentId}')" style="color:#6366f1; font-weight:600; text-decoration:underline;">Mở xem tài liệu gốc</a><br><br>`;
        });

        docChatHistory.push({ role: "ai", text: replyHtml });
        appendChatMessage("ai", replyHtml);
        await saveChatHistory();
        return;
    }

    // --- CHẾ ĐỘ CHAT AI (MULTI-TURN) ---
    docChatHistory.push({ role: "user", text });
    appendChatMessage("user", text);
    docChatIsThinking = true;

    // Cập nhật trạng thái nút gửi
    const sendBtn = document.getElementById("docChatSend");
    const inputEl = document.getElementById("docChatInput");
    if (sendBtn) sendBtn.disabled = true;
    if (inputEl) inputEl.disabled = true;

    // Hiển thị bong bóng "đang gõ"
    const typingBubble = appendChatMessage("ai", "⏳ Gemini AI đang phân tích tài liệu và tổng hợp kết quả...", true);

    try {
        // Lấy số lượng chunks theo cấu hình (mặc định 6, hoặc 15 nếu bật Ngữ cảnh rộng)
        const maxChunks = window.aiConfig.wideContext ? 15 : 6;
        let topChunks = scoredCandidates.slice(0, maxChunks).map(s => s.chunk);
        if (topChunks.length === 0) {
            topChunks = allChunks.slice(0, maxChunks);
        }

        // Bước 2: Xây dựng system prompt với ngữ cảnh tài liệu
        const chunkContext = topChunks.map(c => ({
            id: c.id,
            title: c.documentTitle || "",
            section: c.sectionName || "",
            subTitle: c.title || "",
            summary: c.summary || "",
            content: c.content ? c.content.substring(0, 300) : ""
        }));

        let detailPrompt = "Trả lời ngắn gọn, rõ ràng, tập trung trực tiếp vào câu trả lời, không viết dài dòng. Trả lời bằng tiếng Việt.";
        if (window.aiConfig.detailedResponse) {
            detailPrompt = "Phân tích chuyên sâu, hướng dẫn chi tiết đầy đủ từng bước (nếu có) bằng tiếng Việt dựa trên tài liệu cung cấp.";
        }

        const systemPrompt = `Bạn là trợ lý AI chuyên về tra cứu tài liệu của Khu công nghiệp Thốt Nốt.
Nhiệm vụ: Trả lời câu hỏi của người dùng dựa trên các đoạn tài liệu được cung cấp dưới đây.
${detailPrompt}
Nếu thông tin không có trong tài liệu, hãy nói thẳng là không tìm thấy.

Ngữ cảnh tài liệu:
${JSON.stringify(chunkContext)}`;

        // Bước 3: Xây dựng lịch sử hội thoại gửi lên Gemini (giới hạn N lượt gần nhất)
        const historyLimit = window.aiConfig.fullHistory ? 20 : 5;
        const recentHistory = docChatHistory.slice(-(historyLimit * 2));
        const contents = [];

        // System prompt là turn đầu tiên
        contents.push({
            role: "user",
            parts: [{ text: systemPrompt }]
        });
        contents.push({
            role: "model",
            parts: [{ text: "Đã hiểu. Tôi sẵn sàng trả lời dựa trên tài liệu." }]
        });

        // Thêm các lượt hội thoại trước
        recentHistory.forEach(msg => {
            contents.push({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.text }]
            });
        });

        // Bước 4: Gọi Gemini qua Proxy bảo mật (có dự phòng gọi trực tiếp nếu lỗi mạng/cookie/Tracking Prevention)
        let aiText = "";
        if (USE_PROXY) {
            try {
                const idToken = await user.getIdToken();
                const formData = new URLSearchParams();
                formData.append("action", "chatAI");
                formData.append("idToken", idToken);
                formData.append("data", JSON.stringify({
                    model: PREFERRED_MODEL,
                    contents: contents
                }));

                const response = await fetch(PROXY_URL, { method: "POST", body: formData });
                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errText}`);
                }

                const resJson = await response.json();
                if (resJson.error || resJson.success === false) {
                    throw new Error(resJson.error || "Lỗi Proxy");
                }

                const parts = resJson?.candidates?.[0]?.content?.parts;
                aiText = parts && parts.length ? parts.map(p => p.text).join("") : "";
            } catch (proxyError) {
                console.warn("[DocChat] Proxy AI gặp lỗi, thử gọi trực tiếp bằng Local Key làm dự phòng:", proxyError);
                aiText = await callGeminiDirectly(contents);
            }
        } else {
            aiText = await callGeminiDirectly(contents);
        }

        // Bước 5: Hiển thị và lưu phản hồi
        if (typingBubble) typingBubble.remove();
        docChatHistory.push({ role: "ai", text: aiText });
        appendChatMessage("ai", aiText);
        await saveChatHistory();

    } catch (error) {
        console.error("[DocChat] Lỗi:", error);
        if (typingBubble) typingBubble.remove();
        appendChatMessage("ai", `❌ Lỗi: ${error.message || "Không thể kết nối AI. Vui lòng thử lại."}`);
    } finally {
        docChatIsThinking = false;
        if (sendBtn) sendBtn.disabled = false;
        if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
    }
}

// Khởi tạo sự kiện cho Chat Panel
function initDocChat() {
    const trigger = document.getElementById("docChatTrigger");
    const panel = document.getElementById("docChatPanel");
    const closeBtn = document.getElementById("docChatClose");
    const clearBtn = document.getElementById("docChatClear");
    const sendBtn = document.getElementById("docChatSend");
    const inputEl = document.getElementById("docChatInput");

    if (!trigger || !panel) return;

    // Mở panel
    trigger.addEventListener("click", async () => {
        panel.classList.add("open");
        trigger.classList.add("panel-open");

        // Tải lịch sử từ IndexedDB và render
        if (docChatHistory.length === 0) {
            await loadChatHistory();
        }
        renderChatHistory();

        setTimeout(() => inputEl?.focus(), 300);
    });

    // Đóng panel
    closeBtn?.addEventListener("click", () => {
        panel.classList.remove("open");
        trigger.classList.remove("panel-open");
    });

    // Xóa lịch sử
    clearBtn?.addEventListener("click", async () => {
        docChatHistory = [];
        renderChatHistory();
        await saveChatHistory();
    });

    // Gửi tin nhắn bằng nút
    sendBtn?.addEventListener("click", () => {
        const text = inputEl?.value.trim();
        if (text) {
            inputEl.value = "";
            sendDocChatMessage(text);
        }
    });

    // Gửi tin nhắn bằng Enter
    inputEl?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const text = inputEl.value.trim();
            if (text) {
                inputEl.value = "";
                sendDocChatMessage(text);
            }
        }
    });
}

// Kích hoạt chat panel sau khi xác thực xong
initDocChat();

// =========================================================
// ⚙️ HỆ THỐNG CẤU HÌNH AI & TỐI ƯU CHI PHÍ (ADMIN PANEL)
// =========================================================

// Cấu hình AI mặc định (Nếu Firestore chưa có)
window.aiConfig = {
    detailedResponse: false,
    wideContext: false,
    fullHistory: false,
    enableDailyLimit: true,
    dailyLimitCount: 15,
    confirmBeforeAI: false
};

// Hàm tải cấu hình AI từ Firestore
async function loadAiSettings() {
    try {
        const configDoc = await getDoc(doc(db, "settings", "ai_config"));
        if (configDoc.exists()) {
            window.aiConfig = { ...window.aiConfig, ...configDoc.data() };
        }
        console.log("🛠️ Đã tải cấu hình AI:", window.aiConfig);
        syncSettingsToModalUI();
    } catch (e) {
        console.warn("Không thể tải cấu hình AI từ Firestore, sử dụng mặc định:", e);
    }
}

// Đồng bộ cấu hình lên giao diện Modal
function syncSettingsToModalUI() {
    const elDetailed = document.getElementById("cfgDetailedResponse");
    const elWide = document.getElementById("cfgWideContext");
    const elHistory = document.getElementById("cfgFullHistory");
    const elLimit = document.getElementById("cfgEnableDailyLimit");
    const elLimitVal = document.getElementById("cfgDailyLimitCount");
    const elConfirm = document.getElementById("cfgConfirmBeforeAI");
    
    if (elDetailed) elDetailed.checked = window.aiConfig.detailedResponse;
    if (elWide) elWide.checked = window.aiConfig.wideContext;
    if (elHistory) elHistory.checked = window.aiConfig.fullHistory;
    if (elLimit) {
        elLimit.checked = window.aiConfig.enableDailyLimit;
        window.toggleLimitInputUI(window.aiConfig.enableDailyLimit);
    }
    if (elLimitVal) elLimitVal.value = window.aiConfig.dailyLimitCount || 15;
    if (elConfirm) elConfirm.checked = window.aiConfig.confirmBeforeAI;
}

// Ẩn/hiện trường nhập số giới hạn lượt hỏi
window.toggleLimitInputUI = function(show) {
    const limitCountRow = document.getElementById("limitCountRow");
    if (limitCountRow) {
        limitCountRow.style.display = show ? "flex" : "none";
    }
};

// Mở Modal
window.openAiSettingsModal = function() {
    const modal = document.getElementById("aiSettingsModal");
    if (modal) {
        syncSettingsToModalUI();
        modal.style.display = "flex";
    }
};

// Đóng Modal
window.closeAiSettingsModal = function() {
    const modal = document.getElementById("aiSettingsModal");
    if (modal) {
        modal.style.display = "none";
    }
};

// Lưu cấu hình vào Firestore
window.saveAiSettings = async function() {
    const elDetailed = document.getElementById("cfgDetailedResponse").checked;
    const elWide = document.getElementById("cfgWideContext").checked;
    const elHistory = document.getElementById("cfgFullHistory").checked;
    const elLimit = document.getElementById("cfgEnableDailyLimit").checked;
    const elLimitVal = parseInt(document.getElementById("cfgDailyLimitCount").value) || 15;
    const elConfirm = document.getElementById("cfgConfirmBeforeAI").checked;
    
    window.Swal.fire({
        title: "Đang lưu cấu hình...",
        allowOutsideClick: false,
        didOpen: () => { window.Swal.showLoading(); }
    });
    
    try {
        const newConfig = {
            detailedResponse: elDetailed,
            wideContext: elWide,
            fullHistory: elHistory,
            enableDailyLimit: elLimit,
            dailyLimitCount: elLimitVal,
            confirmBeforeAI: elConfirm,
            updatedAt: new Date().toISOString()
        };
        
        await setDoc(doc(db, "settings", "ai_config"), newConfig);
        window.aiConfig = newConfig;
        
        window.Swal.fire({
            icon: "success",
            title: "Đã lưu cấu hình",
            text: "Cấu hình AI hệ thống đã được cập nhật thành công!",
            timer: 1500,
            showConfirmButton: false
        });
        
        closeAiSettingsModal();
    } catch (e) {
        console.error("Lỗi lưu cấu hình AI:", e);
        window.Swal.fire({
            icon: "error",
            title: "Lỗi lưu cấu hình",
            text: "Không thể ghi cấu hình lên Firestore. Chi tiết: " + e.message
        });
    }
};

// Hàm hiển thị cảnh báo xác nhận trước khi gọi AI
async function confirmAiAction() {
    if (!window.aiConfig.confirmBeforeAI) return true;
    
    const result = await window.Swal.fire({
        title: "Sử dụng Gemini AI",
        text: "Hành động này sẽ sử dụng tài nguyên AI của hệ thống. Bạn có chắc chắn muốn tiếp tục?",
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#273668",
        cancelButtonColor: "#64748b",
        confirmButtonText: "Đồng ý",
        cancelButtonText: "Hủy"
    });
    return result.isConfirmed;
}

// Hàm kiểm tra và tăng số lượt truy vấn của User
async function checkAndIncrementDailyUsage() {
    if (userRole === "admin") return true; // Admin không bị giới hạn
    if (!window.aiConfig.enableDailyLimit) return true; // Không kích hoạt giới hạn
    
    const user = auth.currentUser;
    if (!user || !user.email) return false;
    
    const today = new Date().toISOString().split('T')[0];
    const usageDocRef = doc(db, "users", user.email, "usage", today);
    
    try {
        const usageDoc = await getDoc(usageDocRef);
        let count = 0;
        if (usageDoc.exists()) {
            count = usageDoc.data().count || 0;
        }
        
        if (count >= window.aiConfig.dailyLimitCount) {
            window.Swal.fire({
                icon: "warning",
                title: "Đạt giới hạn lượt hỏi",
                text: `Bạn đã sử dụng hết hạn mức tối đa ${window.aiConfig.dailyLimitCount} lượt hỏi AI trong ngày hôm nay. Vui lòng quay lại vào ngày mai hoặc sử dụng Tìm kiếm thường (miễn phí).`
            });
            return false;
        }
        
        // Tăng số lượt hỏi
        await setDoc(usageDocRef, { count: count + 1 }, { merge: true });
        return true;
    } catch (e) {
        console.warn("Không thể kiểm tra hạn mức sử dụng (có thể do lỗi kết nối/phân quyền):", e);
        return true; // Nếu lỗi phân quyền, cho phép chạy tiếp để tránh nghẽn tính năng
    }
}
