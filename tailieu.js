import { initMenu } from "./menu.js";
import { auth, db, onAuth, getRole, loadTemplate, uploadFileToDrive, showSwal, promptForReAuth } from "./script.js";
import { collection, getDoc, getDocs, query, where, doc, setDoc, deleteDoc } from "./script.js";

// Cấu hình endpoint Google Apps Script Web App
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyQiM0jOcnpNSumDCt75jki2Y6v7rOMu2KFVraq_0G-whX9fq3HYYTZ1C7453tOVAgpiA/exec";

// Khởi tạo Menu chung của trang web
loadTemplate("menu-placeholder", "menu.html", () => {
    initMenu();
});

// Khởi tạo Footer
loadTemplate("footer-placeholder", "footer.html");

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
const PREFERRED_MODEL = 'gemini-3.6-flash';

// Trạng thái Tìm kiếm AI
let isAiSearchActive = false;
let aiSearchResults = null; // Mảng các { id, score, reason } trả về từ AI
let aiSummaryChatHistory = [];
let currentSearchCandidates = [];

// Trạng thái Trình đọc tài liệu gốc (Split-screen Reader)
let currentOpenDocId = null;
let currentOpenDocBlobUrl = null;
let currentOpenDocName = "";
let readerChatHistory = [];
let readerChatIsThinking = false;

// Bộ lọc hiển thị tri thức theo tài liệu gốc cụ thể
let activeDocIdFilter = null;

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

        // Ẩn thông báo chưa đăng nhập
        const notLogged = document.getElementById("notLogged");
        if (notLogged) notLogged.style.display = "none";

        // Tải cấu hình AI của hệ thống trước
        await loadAiSettings();

        // Nếu người dùng là admin, hiển thị nút cấu hình & chuyển đổi icon thư mục thành nút tải lên
        if (userRole === "admin") {
            const settingsBtn = document.getElementById("adminAiSettingsBtn");
            if (settingsBtn) {
                settingsBtn.style.display = "inline-flex";
            }
            const settingsBtnMain = document.getElementById("adminAiSettingsBtnMain");
            if (settingsBtnMain) {
                settingsBtnMain.style.display = "inline-flex";
            }
            const uploadTriggerBtn = document.getElementById("uploadDocTriggerBtn");
            const uploadFolderLabel = document.getElementById("uploadDocFolderLabel");
            if (uploadTriggerBtn) {
                uploadTriggerBtn.style.display = "inline-block";
            }
            if (uploadFolderLabel) {
                uploadFolderLabel.style.display = "none";
            }
        }

        // Hiển thị giao diện chính sau khi đã xác thực xong
        const pageContent = document.getElementById("pageContent");
        if (pageContent) {
            pageContent.style.display = "block";
        }

        // Khởi động tính năng tải lên tài liệu cho Admin
        initUploadDocumentFeature();

        // Tải dữ liệu tri thức từ Firestore
        await loadDocumentChunks();

    } else {
        // ===== XỬ LÝ ĐĂNG XUẤT: Xóa ngay nội dung trang =====
        userRole = "guest";

        // 1. Ẩn toàn bộ nội dung trang
        const pageContent = document.getElementById("pageContent");
        if (pageContent) pageContent.style.display = "none";

        // Hiện thông báo yêu cầu đăng nhập
        const notLogged = document.getElementById("notLogged");
        if (notLogged) notLogged.style.display = "block";

        // 2. Xóa dữ liệu tri thức khỏi bộ nhớ JS
        allChunks = [];
        allDocuments = {};
        docCodeMap = {};
        invertedIndex = {};

        // 3. Xóa nội dung DOM
        const documentGrid = document.getElementById("documentGrid");
        if (documentGrid) documentGrid.innerHTML = "";
        const docLinksList = document.getElementById("docLinksList");
        if (docLinksList) docLinksList.innerHTML = "";
        const quickLinksList = document.getElementById("quickLinksList");
        if (quickLinksList) quickLinksList.innerHTML = "";

        // 4. Xóa IndexedDB cache — CHỈ khi thiết bị KHÔNG được tin cậy
        //    (Trusted device giữ cache để load nhanh hơn lần đăng nhập sau)
        if (!window.isCurrentDeviceTrusted) {
            try {
                const deleteReq = indexedDB.deleteDatabase("tailieu_cache_v1");
                deleteReq.onsuccess = () => console.log("[Tailieu] Cache IndexedDB đã được xóa sau logout (thiết bị không tin cậy).");
                deleteReq.onerror = () => console.warn("[Tailieu] Không thể xóa cache IndexedDB.");
                deleteReq.onblocked = () => console.warn("[Tailieu] Xóa cache bị chặn (blocked).");
            } catch (e) {
                console.warn("[Tailieu] Lỗi xóa cache sau logout:", e);
            }
        }
    }
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

    // ===== CẬP NHẬT BẢO MẬT: Khôi phục allDocuments và lọc theo Role =====
    allDocuments = {};
    cachedDocs.forEach(d => {
        const { _id, ...data } = d;
        // Kiểm tra quyền (Nếu tài liệu không có trường targetGroup thì mặc định cho phép để tránh mất dữ liệu)
        if (userRole === "admin" ||
            (userRole === "user" && (data.targetGroup === "guest" || data.targetGroup === "user")) ||
            (userRole === "guest" && data.targetGroup === "guest") ||
            !data.targetGroup) {
            allDocuments[_id] = data;
        }
    });

    const docIds = Object.keys(allDocuments).sort((a, b) => {
        const codeA = allDocuments[a].docCode || "";
        const codeB = allDocuments[b].docCode || "";
        return codeB.localeCompare(codeA, undefined, { numeric: true, sensitivity: 'base' });
    });
    docCodeMap = {};
    docIds.forEach((id) => {
        docCodeMap[id] = allDocuments[id].docCode || "TL-00";
    });

    // ===== CẬP NHẬT BẢO MẬT: Lọc chunk từ cache lên RAM theo Role hiện tại =====
    allChunks = cachedChunks.filter(chunk => {
        if (userRole === "admin") return true;
        if (userRole === "user") return chunk.targetGroup === "guest" || chunk.targetGroup === "user";
        return chunk.targetGroup === "guest";
    });

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
        // ===== ĐỒNG BỘ XÓA (DELETE SYNC) CHO INDEXEDDB CACHE =====
        if (lastSyncTime && userRole === "admin") {
            try {
                const deletedQuery = query(
                    collection(db, "deleted_logs"),
                    where("deletedAt", ">", lastSyncTime)
                );
                const deletedSnap = await getDocs(deletedQuery);
                const deletedDocIds = [];
                deletedSnap.forEach(d => {
                    deletedDocIds.push(d.id);
                });

                if (deletedDocIds.length > 0) {
                    console.log(`[Delete Sync] Phát hiện ${deletedDocIds.length} tài liệu bị xóa từ Firestore:`, deletedDocIds);

                    // 1. Xóa documents khỏi IndexedDB
                    await idbDeleteKeys(idb, STORE_DOCS, deletedDocIds);

                    // 2. Xóa chunks thuộc các tài liệu bị xóa khỏi IndexedDB
                    const existingChunks = await idbGetAll(idb, STORE_CHUNKS);
                    const chunksToDelete = existingChunks
                        .filter(c => deletedDocIds.includes(c.documentId))
                        .map(c => c.id);

                    if (chunksToDelete.length > 0) {
                        await idbDeleteKeys(idb, STORE_CHUNKS, chunksToDelete);
                    }

                    // 3. Xóa khỏi bộ nhớ RAM
                    deletedDocIds.forEach(docId => {
                        delete allDocuments[docId];
                    });
                    allChunks = allChunks.filter(chunk => !deletedDocIds.includes(chunk.documentId));

                    hasChanges = true;
                }
            } catch (err) {
                console.warn("[Delete Sync] Lỗi khi đồng bộ các tài liệu đã bị xóa:", err);
            }
        }

        // ===== CẬP NHẬT BẢO MẬT 1: Lọc quyền truy vấn Metadata (documents) =====
        let docQuery;
        if (userRole === "admin") {
            docQuery = query(collection(db, "documents"));
        } else if (userRole === "user") {
            docQuery = query(collection(db, "documents"), where("targetGroup", "in", ["guest", "user"]));
        } else {
            docQuery = query(collection(db, "documents"), where("targetGroup", "==", "guest"));
        }

        const docSnap = await getDocs(docQuery);
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
                const codeA = allDocuments[a].docCode || "";
                const codeB = allDocuments[b].docCode || "";
                return codeB.localeCompare(codeA, undefined, { numeric: true, sensitivity: 'base' });
            });
            docCodeMap = {};
            docIds.forEach((id) => {
                docCodeMap[id] = allDocuments[id].docCode || "TL-00";
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
            const existingChunks = await idbGetAll(idb, STORE_CHUNKS);

            // ===== CẬP NHẬT BẢO MẬT 2: Chỉ lấy ID cũ thuộc quyền hiện tại để so sánh =====
            const existingRoleIds = new Set(
                existingChunks
                    .filter(c => {
                        if (userRole === "admin") return true;
                        if (userRole === "user") return c.targetGroup === "guest" || c.targetGroup === "user";
                        return c.targetGroup === "guest";
                    })
                    .map(c => c.id)
            );

            const freshIds = new Set(freshChunks.map(c => c.id));

            // Chỉ xóa các chunk mà User có quyền nhìn thấy nhưng không còn trên Firestore
            const deletedIds = [...existingRoleIds].filter(id => !freshIds.has(id));
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
        // ===== CẬP NHẬT BẢO MẬT: Lọc quyền cả ở fallback =====
        let docQuery;
        if (userRole === "admin") {
            docQuery = query(collection(db, "documents"));
        } else if (userRole === "user") {
            docQuery = query(collection(db, "documents"), where("targetGroup", "in", ["guest", "user"]));
        } else {
            docQuery = query(collection(db, "documents"), where("targetGroup", "==", "guest"));
        }

        const docSnap = await getDocs(docQuery);
        allDocuments = {};
        docSnap.forEach(d => { allDocuments[d.id] = d.data(); });

        const docIds = Object.keys(allDocuments).sort((a, b) => {
            const codeA = allDocuments[a].docCode || "";
            const codeB = allDocuments[b].docCode || "";
            return codeB.localeCompare(codeA, undefined, { numeric: true, sensitivity: 'base' });
        });
        docCodeMap = {};
        docIds.forEach((id) => { docCodeMap[id] = allDocuments[id].docCode || "TL-00"; });
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

    // Sắp xếp danh sách tài liệu gốc theo mã TL-xx giảm dần (mã mới nhất ở trên đầu)
    uniqueDocs.sort((a, b) => {
        const codeA = docCodeMap[a.id] || "";
        const codeB = docCodeMap[b.id] || "";
        return codeB.localeCompare(codeA, undefined, { numeric: true, sensitivity: 'base' });
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
                <div class="doc-link-item" data-docid="${doc.id}" title="${doc.title.replace(/"/g, '&quot;')}${userRole === 'admin' ? ' (Nhấn giữ để xóa)' : ''}">
                    <div class="doc-link-icon">
                        📄
                        <span class="doc-chunk-count-badge" title="Tài liệu có ${chunkCount} phần tri thức">${chunkCount}</span>
                    </div>
                    <div class="doc-link-details">
                        <div class="doc-link-title" data-doctitle="${doc.title.replace(/"/g, '&quot;')}">
                            <span class="badge-doc-code" style="font-size: 9px; padding: 1px 4px; margin-right: 4px; border-radius: 3px;">${docCode}</span>
                            ${dispDocTitle}
                        </div>
                        ${metaLine}
                        <div class="doc-link-meta">
                            <span class="doc-link-badge ${catClass}">${doc.category}</span>
                            <span class="doc-link-badge ${targetClass}">${targetText}</span>
                            <button class="btn-filter-chunks ${(activeDocIdFilter === doc.id) ? 'active' : ''}" data-docid="${doc.id}" title="Chỉ xem các thẻ tri thức của tài liệu này" onclick="event.stopPropagation()">Thẻ TL</button>
                            ${deleteBtn}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Đăng ký sự kiện click & nhấn giữ (long press) cho các nút tài liệu trong sidebar
        document.querySelectorAll(".doc-link-item").forEach(item => {
            let pressTimer = null;
            let isLongPress = false;

            const startPress = (e) => {
                isLongPress = false;
                if (userRole !== "admin") return;
                
                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    if (navigator.vibrate) navigator.vibrate(50); // Rung nhẹ phản hồi di động
                    
                    const docId = item.dataset.docid;
                    const titleEl = item.querySelector(".doc-link-title");
                    const docTitle = titleEl ? titleEl.getAttribute("data-doctitle") : "Tài liệu";
                    
                    deleteDocumentAndKnowledge(docId, docTitle);
                }, 750); // 750ms nhấn giữ để xóa
            };

            const cancelPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            // Hỗ trợ Pointer Events cho cả chuột và cảm ứng trên di động
            item.addEventListener("pointerdown", startPress);
            item.addEventListener("pointerup", cancelPress);
            item.addEventListener("pointerleave", cancelPress);
            item.addEventListener("pointercancel", cancelPress);
            item.addEventListener("touchmove", cancelPress); // Hủy nhấn đè khi vuốt cuộn danh sách

            item.addEventListener("click", (e) => {
                if (isLongPress) {
                    e.preventDefault();
                    e.stopPropagation();
                    isLongPress = false;
                    return;
                }
                const docId = item.dataset.docid;
                openDocumentSecurely(docId);
            });
        });

        // Đăng ký sự kiện lọc tri thức cho nút "Thẻ TL"
        document.querySelectorAll(".btn-filter-chunks").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const docId = btn.dataset.docid;

                if (activeDocIdFilter === docId) {
                    activeDocIdFilter = null; // Tắt lọc nếu nhấn lại
                } else {
                    activeDocIdFilter = docId;

                    // Reset tìm kiếm AI và từ khóa tìm kiếm
                    isAiSearchActive = false;
                    aiSearchResults = null;
                    docSearchInput.value = "";
                    const aiSummaryBlock = document.getElementById("aiSummaryBlock");
                    if (aiSummaryBlock) {
                        aiSummaryBlock.style.display = "none";
                        aiSummaryBlock.innerHTML = "";
                    }
                }

                renderGrid();
            });
        });

        // Đăng ký sự kiện xóa click truyền thống (dành cho nút "Xóa" xuất hiện khi hover trên desktop)
        document.querySelectorAll(".btn-delete-doc").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const docId = btn.dataset.docid;
                const docTitle = btn.dataset.doctitle;
                deleteDocumentAndKnowledge(docId, docTitle);
            });
        });
    }

    // Hiển thị trạng thái đồng bộ & lỗi cho Admin
    renderSyncStatus();
}

// Hàm hiển thị danh sách hàng đợi (pending/processing) và các file lỗi (failed) kèm nút thử lại
function renderSyncStatus() {
    const syncIssuesContainer = document.getElementById("syncIssuesContainer");
    if (!syncIssuesContainer) return;

    // Chỉ hiển thị cho tài khoản có vai trò Admin
    if (userRole !== "admin") {
        syncIssuesContainer.style.display = "none";
        return;
    }

    const failedDocs = [];
    const pendingDocs = [];
    const processingDocs = [];

    Object.keys(allDocuments).forEach(id => {
        const doc = allDocuments[id];
        if (doc.status === "failed") {
            failedDocs.push({ id, ...doc });
        } else if (doc.status === "pending") {
            pendingDocs.push({ id, ...doc });
        } else if (doc.status === "processing") {
            processingDocs.push({ id, ...doc });
        }
    });

    const totalIssues = failedDocs.length + pendingDocs.length + processingDocs.length;
    if (totalIssues === 0) {
        syncIssuesContainer.style.display = "none";
        return;
    }

    syncIssuesContainer.style.display = "block";

    let html = `
        <div style="font-size:12.5px; font-weight:700; color:#c2410c; margin-bottom:8px; display:flex; align-items:center; gap:5px;">
            ⚠️ Hàng đợi & Lỗi đồng bộ (${totalIssues})
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; max-height:180px; overflow-y:auto; padding-right:4px;">
    `;

    processingDocs.forEach(doc => {
        html += `
            <div style="font-size:11.5px; background:rgba(245, 158, 11, 0.08); border:1px solid rgba(245, 158, 11, 0.2); border-radius:6px; padding:6px 8px; color:#b45309; display:flex; justify-content:space-between; align-items:center;">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80%;" title="${doc.fileName}">
                    🔄 <b style="font-size: 9px; background:#f59e0b; color:white; padding:1px 3px; border-radius:3px; margin-right:3px;">${doc.docCode || 'TL-XX'}</b> ${doc.fileName}
                </div>
                <span style="font-size: 10px; font-style:italic;">Đang tách...</span>
            </div>
        `;
    });

    pendingDocs.forEach(doc => {
        html += `
            <div style="font-size:11.5px; background:rgba(100, 116, 139, 0.08); border:1px solid rgba(100, 116, 139, 0.2); border-radius:6px; padding:6px 8px; color:#475569; display:flex; justify-content:space-between; align-items:center;">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80%;" title="${doc.fileName}">
                    ⏳ <b style="font-size: 9px; background:#64748b; color:white; padding:1px 3px; border-radius:3px; margin-right:3px;">${doc.docCode || 'TL-XX'}</b> ${doc.fileName}
                </div>
                <span style="font-size: 10px; font-style:italic;">Đang chờ...</span>
            </div>
        `;
    });

    failedDocs.forEach(doc => {
        html += `
            <div style="font-size:11.5px; background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.2); border-radius:6px; padding:6px 8px; color:#b91c1c; display:flex; justify-content:space-between; align-items:center;">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%;" title="${doc.fileName}">
                    ❌ <b style="font-size: 9px; background:#ef4444; color:white; padding:1px 3px; border-radius:3px; margin-right:3px;">${doc.docCode || 'TL-XX'}</b> ${doc.fileName}
                </div>
                <button class="btn-retry-doc" data-docid="${doc.id}" style="background:#ef4444; color:white; border:none; padding:2px 8px; border-radius:4px; font-size:10px; cursor:pointer; font-weight:600;">Thử lại</button>
            </div>
        `;
    });

    html += `</div>`;
    syncIssuesContainer.innerHTML = html;

    // Đăng ký sự kiện nút thử lại cho tài liệu bị lỗi
    document.querySelectorAll(".btn-retry-doc").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const docId = btn.dataset.docid;
            btn.disabled = true;
            btn.textContent = "...";
            try {
                // setDoc with merge: true để reset trạng thái về pending
                await setDoc(doc(db, "documents", docId), { status: "pending", retryCount: 0 }, { merge: true });

                // Cập nhật biến cục bộ ngay để UI thay đổi lập tức
                if (allDocuments[docId]) {
                    allDocuments[docId].status = "pending";
                    allDocuments[docId].retryCount = 0;
                }

                renderSyncStatus();

                Swal.fire({
                    icon: "success",
                    title: "Đã đưa vào hàng đợi",
                    text: "Tài liệu đã được xếp hàng để hệ thống tự động quét và phân tách tri thức lại.",
                    timer: 2500,
                    showConfirmButton: false
                });
            } catch (err) {
                console.error("Lỗi khi thử lại tài liệu:", err);
                btn.disabled = false;
                btn.textContent = "Thử lại";
                Swal.fire({
                    icon: "error",
                    title: "Thất bại",
                    text: "Không thể kết nối Firestore để thử lại tài liệu."
                });
            }
        });
    });
}


// Hàm hiển thị kết quả ra lưới (đã lọc theo Tab và Ô Tìm kiếm)
function renderGrid() {
    const searchKeyword = docSearchInput.value.trim().toLowerCase();
    const cleanKeyword = removeAccents(searchKeyword);
    const searchTokens = searchKeyword ? searchKeyword.split(/\s+/).filter(t => t.length > 0) : [];

    // Map chứa thông tin score và lý do của AI
    const aiMatchMap = {};

    // Trạng thái ban đầu: Chưa gõ từ khóa & Tab đang chọn là Tất cả & Không tìm kiếm bằng AI & Không lọc tài liệu cụ thể
    if (!cleanKeyword && activeCategory === "Tất cả" && !isAiSearchActive && !activeDocIdFilter) {
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
                            ${userRole === "admin" ? `
                            <button class="btn-delete-chunk" data-chunkid="${item.id}" data-section="${item.sectionName || ''}" data-title="${item.title || ''}" title="Xóa thẻ tri thức này">
                                <span>🗑️</span> Xóa thẻ
                            </button>
                            ` : ""}
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

        // Đăng ký click cho nút xóa thẻ tri thức (nếu là Admin)
        if (userRole === "admin") {
            document.querySelectorAll(".document-card .btn-delete-chunk").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    const chunkId = btn.dataset.chunkid;
                    const section = btn.dataset.section || "";
                    const title = btn.dataset.title || "";
                    deleteKnowledgeChunk(chunkId, section, title);
                });
            });
        }

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

        // Lọc theo tài liệu cụ thể nếu có
        if (activeDocIdFilter) {
            filtered = filtered.filter(item => item.documentId === activeDocIdFilter);
        }

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

        // Lọc theo tài liệu cụ thể nếu có
        if (activeDocIdFilter) {
            filtered = filtered.filter(item => item.documentId === activeDocIdFilter);
        }

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
    renderLeftSidebar(activeDocIdFilter ? allChunks : filtered, searchTokens);

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
                        ${userRole === "admin" ? `
                        <button class="btn-delete-chunk" data-chunkid="${item.id}" data-section="${item.sectionName || ''}" data-title="${item.title || ''}" title="Xóa thẻ tri thức này">
                            <span>🗑️</span> Xóa thẻ
                        </button>
                        ` : ""}
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

    // Đăng ký click cho nút xóa thẻ tri thức (nếu là Admin)
    if (userRole === "admin") {
        document.querySelectorAll(".document-card .btn-delete-chunk").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const chunkId = btn.dataset.chunkid;
                const section = btn.dataset.section || "";
                const title = btn.dataset.title || "";
                deleteKnowledgeChunk(chunkId, section, title);
            });
        });
    }

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
        showSwal("warning", "Không có quyền: Chỉ Admin mới được phép xóa tài liệu.");
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

        // 2.5. Ghi log xóa tài liệu để đồng bộ các Client khác
        try {
            await setDoc(doc(db, "deleted_logs", documentId), {
                deletedAt: new Date().toISOString()
            });
            console.log(`[Sync] Đã ghi log xóa cho tài liệu ${documentId}`);
        } catch (err) {
            console.warn("Không thể ghi log xóa tài liệu lên Firestore:", err);
        }

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
        showSwal("error", "Lỗi xóa: Không thể xóa tài liệu. Kiểm tra Firestore Rules hoặc thử lại.");
    }
}

// Xóa một thẻ tri thức cụ thể (Chỉ Admin, yêu cầu xác thực)
async function deleteKnowledgeChunk(chunkId, sectionName, title) {
    if (userRole !== "admin") {
        showSwal("warning", "Không có quyền: Chỉ Admin mới được phép xóa thẻ tri thức.");
        return;
    }

    const chunkTitle = (sectionName + (title ? " - " + title : "")).trim() || "Thẻ tri thức";

    const result = await window.Swal.fire({
        title: "⚠️ Xác nhận xóa thẻ tri thức?",
        html: `Bạn sắp xóa hoàn toàn thẻ tri thức:<br><br>
               <b style="color:#e53e3e;">${chunkTitle}</b><br><br>
               Thao tác này chỉ xóa thẻ tri thức hiện tại, không ảnh hưởng đến tài liệu gốc.<br><br>
               <small style="color:#64748b;">Hệ thống sẽ yêu cầu xác thực mật khẩu của bạn.</small>`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#e53e3e",
        cancelButtonColor: "#64748b",
        confirmButtonText: "🗑️ Xóa thẻ",
        cancelButtonText: "Hủy bỏ"
    });

    if (!result.isConfirmed) return;

    // Yêu cầu xác thực mật khẩu qua promptForReAuth
    const authed = await promptForReAuth();
    if (!authed) {
        return;
    }

    window.Swal.fire({
        title: "Đang xóa...",
        text: "Hệ thống đang gỡ thẻ tri thức này.",
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => window.Swal.showLoading()
    });

    try {
        // 1. Xóa trên Firestore
        await deleteDoc(doc(db, "document_chunks", chunkId));

        // 2. Xóa trên IndexedDB cục bộ
        const idb = await openIDB();
        await idbDeleteKeys(idb, STORE_CHUNKS, [chunkId]);

        // 3. Xóa trên bộ nhớ RAM
        allChunks = allChunks.filter(chunk => chunk.id !== chunkId);

        // 4. Cập nhật giao diện
        buildInvertedIndex();
        renderGrid();

        window.Swal.fire({
            icon: "success",
            title: "Đã xóa thẻ tri thức",
            text: `Thẻ "${chunkTitle}" đã được gỡ khỏi hệ thống.`,
            timer: 2000,
            showConfirmButton: false
        });

    } catch (e) {
        console.error("Lỗi khi xóa thẻ tri thức:", e);
        showSwal("error", "Lỗi xóa: Không thể xóa thẻ tri thức. Kiểm tra Firestore Rules hoặc thử lại.");
    }
}
window.deleteKnowledgeChunk = deleteKnowledgeChunk;

// Mở tài liệu an toàn thông qua Apps Script Proxy kiểm tra quyền bằng Ticket dùng 1 lần
async function openDocumentSecurely(documentId) {
    if (!documentId) {
        showSwal("error", "Lỗi: Không tìm thấy ID tài liệu gốc.");
        return;
    }

    // Kiểm tra trạng thái đăng nhập
    const user = auth.currentUser;
    if (!user || !user.email) {
        showSwal("warning", "Yêu cầu đăng nhập: Vui lòng đăng nhập hệ thống để tải tài liệu gốc.");
        return;
    }

    // Hiển thị Modal Split-screen Reader trước
    const modal = document.getElementById("documentReaderModal");
    if (!modal) {
        showSwal("error", "Lỗi giao diện: Không tìm thấy Modal đọc tài liệu gốc.");
        return;
    }

    // Đặt trạng thái ban đầu cho Modal
    currentOpenDocId = documentId;
    readerChatHistory = [];
    document.getElementById("readerChatMessages").innerHTML = "";
    document.getElementById("readerChatInput").value = "";

    modal.style.display = "flex";
    switchReaderTab("overview");

    // Hiển thị loading bên khung iframe
    const loaderEl = document.getElementById("docReaderLoading");
    const frameEl = document.getElementById("docReaderFrame");
    const fallbackEl = document.getElementById("docReaderFallback");
    const mobileFallbackEl = document.getElementById("docReaderMobileFallback");

    if (loaderEl) loaderEl.style.display = "flex";
    if (frameEl) {
        frameEl.style.display = "none";
        frameEl.src = "";
    }
    if (fallbackEl) fallbackEl.style.display = "none";
    if (mobileFallbackEl) mobileFallbackEl.style.display = "none";

    // Kết xuất thông tin tri thức / metadata tài liệu bên phải
    renderReaderRightPane(documentId);

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        if (loaderEl) loaderEl.style.display = "none";
        if (mobileFallbackEl) {
            mobileFallbackEl.style.display = "flex";
            const openNewTabBtn = document.getElementById("btnMobileOpenNewTab");
            if (openNewTabBtn) {
                openNewTabBtn.href = `https://drive.google.com/file/d/${documentId}/view?usp=drivesdk`;
            }
        }
        return; // Dừng xử lý tải trước tệp Base64 trên thiết bị di động
    }

    try {
        // 1. Tạo ticketId ngẫu nhiên (UUID v4 client-side đơn giản)
        const ticketId = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );

        // 2. Ghi ticket lên Firestore bảng download_tickets
        const expiresAt = new Date(Date.now() + 60 * 1000);
        await setDoc(doc(db, "download_tickets", ticketId), {
            email: user.email,
            documentId: documentId,
            expiresAt: expiresAt.toISOString(),
            used: false,
            createdAt: new Date().toISOString()
        });

        // 3. Gọi Web App để lấy nội dung file dưới dạng Base64
        const formData = new URLSearchParams();
        formData.append("action", "viewFile");
        formData.append("ticketId", ticketId);
        const response = await fetch(GAS_API_URL, {
            method: "POST",
            body: formData
        });
        if (!response.ok) {
            throw new Error(`Lỗi kết nối máy chủ (HTTP ${response.status})`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || "Không thể tải tài liệu.");
        }

        // 4. Giải mã Base64 thành Blob URL
        const byteCharacters = atob(data.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const fileBlob = new Blob([byteArray], { type: data.mimeType });
        const fileUrl = URL.createObjectURL(fileBlob);

        currentOpenDocBlobUrl = fileUrl;
        currentOpenDocName = data.fileName;

        // 5. Mở xem trực tiếp nếu xem được (PDF, Ảnh, Text), hoặc hiển thị fallback tải về (Desktop)
        const viewableTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain'];

        if (loaderEl) loaderEl.style.display = "none";

        if (viewableTypes.includes(data.mimeType)) {
            if (frameEl) {
                frameEl.src = fileUrl;
                frameEl.style.display = "block";
            }
        } else {
            // Không hỗ trợ xem inline, hiện fallback tải về
            if (fallbackEl) {
                fallbackEl.style.display = "flex";
                const fallbackBtn = document.getElementById("btnDownloadFallback");
                if (fallbackBtn) fallbackBtn.href = fileUrl;
            }
        }

    } catch (e) {
        console.error("Lỗi tải tài liệu gốc:", e);
        if (loaderEl) loaderEl.style.display = "none";
        showSwal("error", "Lỗi tải tài liệu: " + (e.message || "Không thể tải tài liệu gốc."));
        closeDocumentReader();
    }
}
window.openDocumentSecurely = openDocumentSecurely;

// Tải tài liệu bảo mật trực tiếp trên di động khi người dùng bấm "Tải Về"
async function downloadFileSecurely(documentId, fileName) {
    const user = auth.currentUser;
    if (!user || !user.email) {
        showSwal("warning", "Yêu cầu đăng nhập: Vui lòng đăng nhập hệ thống để tải tài liệu gốc.");
        return;
    }

    window.Swal.fire({
        title: "Đang chuẩn bị tệp...",
        text: "Hệ thống đang tải tài liệu từ Google Drive bảo mật. Vui lòng chờ.",
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => window.Swal.showLoading()
    });

    try {
        // 1. Tạo ticketId ngẫu nhiên (UUID v4 client-side đơn giản)
        const ticketId = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );

        // 2. Ghi ticket lên Firestore bảng download_tickets
        const expiresAt = new Date(Date.now() + 60 * 1000);
        await setDoc(doc(db, "download_tickets", ticketId), {
            email: user.email,
            documentId: documentId,
            expiresAt: expiresAt.toISOString(),
            used: false,
            createdAt: new Date().toISOString()
        });

        // 3. Gọi Web App để lấy nội dung file dưới dạng Base64
        const formData = new URLSearchParams();
        formData.append("action", "viewFile");
        formData.append("ticketId", ticketId);
        const response = await fetch(GAS_API_URL, {
            method: "POST",
            body: formData
        });
        if (!response.ok) {
            throw new Error(`Lỗi kết nối máy chủ (HTTP ${response.status})`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || "Không thể tải tài liệu.");
        }

        // 4. Giải mã Base64 thành Blob
        const byteCharacters = atob(data.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const fileBlob = new Blob([byteArray], { type: data.mimeType });
        const fileUrl = URL.createObjectURL(fileBlob);

        // 5. Kích hoạt tải xuống tự động bằng liên kết ảo
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = data.fileName || fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.Swal.close();
    } catch (e) {
        console.error("Lỗi tải tài liệu:", e);
        showSwal("error", "Lỗi tải tài liệu: " + (e.message || "Không thể tải tài liệu gốc."));
    }
}
window.downloadFileSecurely = downloadFileSecurely;


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
        // Quyết định xem có cần chạy AI để mở rộng từ khóa hay không
        // Bỏ qua nếu từ khóa quá ngắn, là một mã tài liệu (ví dụ: TL-60), hoặc là tìm kiếm từ đơn giản
        const cleanQuery = queryText.trim().toLowerCase();
        const isDocCodePattern = /^tl-?\d+$/i.test(cleanQuery);
        const shouldSkipExpand = cleanQuery.length < 4 || isDocCodePattern || !cleanQuery.includes(" ");

        let expandedKeywords = [queryText]; // Mặc định chứa từ khóa người dùng gõ
        if (!shouldSkipExpand) {
            try {
                // Gọi lên Google Apps Script để Gemini lấy thêm từ đồng nghĩa
                const formData = new URLSearchParams();
                formData.append("action", "expand");
                formData.append("query", queryText);
                const expandResp = await fetch(GAS_API_URL, {
                    method: "POST",
                    body: formData
                });
                const expandData = await expandResp.json();

                if (expandData.success && expandData.keywords) {
                    // Trộn từ khóa gốc và từ do AI gợi ý (loại bỏ từ trùng lặp)
                    expandedKeywords = [...new Set([...expandedKeywords, ...expandData.keywords])];
                    console.log("AI đã mở rộng từ khóa thành:", expandedKeywords);
                }
            } catch (e) {
                console.warn("Lỗi gọi AI mở rộng từ khóa, hệ thống tiếp tục dùng từ gốc:", e);
            }
        } else {
            console.log("[AI Search] Bỏ qua mở rộng từ khóa AI cho câu truy vấn đơn giản/mã tài liệu:", queryText);
        }

        // Chuyển mảng từ khóa mở rộng thành một chuỗi dài
        const combinedQueryText = expandedKeywords.join(" ");

        // Phân tách chuỗi đã mở rộng thành các tokens để lọc thô
        const searchTokens = combinedQueryText.toLowerCase().split(/\s+/).filter(t => t.length > 0);
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

                // TĂNG ĐIỂM ĐẶC BIỆT: Nếu từ khóa trùng khớp chính xác với mã tài liệu (docCode) của chunk
                const cleanDocCode = removeAccents(docCode.toLowerCase());
                searchVariants.forEach(variant => {
                    if (cleanDocCode === variant) {
                        score += 5000; // Đảm bảo tài liệu khớp mã luôn đứng đầu
                    }
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
        const maxCandidates = window.aiConfig.wideContext ? 10 : 5;
        scoredCandidates.sort((a, b) => b.score - a.score);
        // Chỉ lấy các chunk thực sự liên quan (điểm số > 0)
        const relevantCandidates = scoredCandidates.filter(sc => sc.score > 0);
        const topCandidates = relevantCandidates.slice(0, maxCandidates).map(sc => sc.chunk);


        // Chuẩn bị danh sách chunks rút gọn làm ngữ cảnh gửi lên Gemini (dạng văn bản phân cấp nén)
        const plainTextContext = buildHierarchicalContext(topCandidates);

        // Định hướng chi tiết câu trả lời theo cài đặt cấu hình
        let detailInstruction = "Viết một câu trả lời tóm tắt ngắn gọn (1-2 câu) bằng tiếng Việt giải thích trực tiếp về thông tin người dùng đang tìm kiếm dựa trên các tài liệu có sẵn. Chỉ tập trung vào ý chính cốt lõi. Bắt buộc phải ghi rõ nguồn trích dẫn bằng mã tài liệu ở cuối các thông tin (ví dụ: [TL-11] hoặc [TL-09]).";
        if (window.aiConfig.detailedResponse) {
            detailInstruction = "Viết một câu trả lời phân tích chuyên sâu, chi tiết đầy đủ và rõ ràng (có thể kèm các mục hướng dẫn nếu cần) bằng tiếng Việt dựa trên tài liệu cung cấp. Bắt buộc phải ghi rõ nguồn trích dẫn bằng mã tài liệu ở cuối các câu hoặc ý chính tương ứng (ví dụ: [TL-11] hoặc [TL-09]) để người dùng dễ dàng tra cứu.";
        }

        // System Instruction & Prompt chi tiết yêu cầu cả tóm tắt và danh sách xếp hạng
        const systemInstruction = `Bạn là một trợ lý AI thông minh phụ trách công tác tìm kiếm tài liệu của Khu công nghiệp Thốt Nốt.
Nhiệm vụ của bạn là phân tích yêu cầu tìm kiếm bằng ngôn ngữ tự nhiên của người dùng, đối chiếu với danh sách các đoạn tài liệu được cung cấp dưới đây.

Hãy thực hiện 2 việc sau:
1. ${detailInstruction}
   *Quy tắc ứng xử đặc biệt*: Khi trả lời, nếu thông tin hoặc vai trò/chức danh cụ thể (ví dụ: ai là kế toán, ai là chỉ huy...) không được ghi rõ chính thức trong tài liệu, bạn phải thẳng thắn tuyên bố là tài liệu không đề cập chức danh/thông tin chính thức đó. Tuy nhiên, thay vì chỉ từ chối một cách cứng nhắc, bạn hãy liệt kê thêm các manh mối gián tiếp có sẵn trong văn bản (ví dụ: ai trình bày báo cáo tài chính, phòng ban nào liên quan...) để làm gợi ý tham khảo cho người dùng. TUYỆT ĐỐI KHÔNG ĐƯỢC SUY DIỄN, đoán mò hoặc bịa đặt thêm bất cứ điều gì ngoài văn bản; chỉ được phép trích xuất trung thực các dữ kiện thô có sẵn trong tài liệu.
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
${plainTextContext}`;

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
                currentSearchCandidates = topCandidates;
                aiSummaryChatHistory = [
                    { role: "user", text: queryText },
                    { role: "model", text: summaryText }
                ];

                // Lấy danh sách các tài liệu tham khảo độc nhất từ các ứng viên
                const uniqueDocIds = [...new Set(topCandidates.map(c => c.documentId))];
                const sourcesHtml = uniqueDocIds.map(docId => {
                    const docData = allDocuments[docId] || {};
                    const docCode = docCodeMap[docId] || "TL-XX";
                    const docTitle = docData.title || docData.fileName || "Tài liệu";
                    
                    // Lấy chunk đầu tiên khớp của tài liệu này
                    const firstChunk = topCandidates.find(c => c.documentId === docId);
                    const chunkId = firstChunk ? firstChunk.id : "";
                    
                    return `
                        <a href="javascript:void(0);" onclick="openDocAndScrollToChunk('${docId}', '${chunkId}')" 
                           style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; font-size: 12px; border: 1px solid #bae6fd;"
                           title="${docTitle}"
                           onmouseover="this.style.background='#bae6fd'" 
                           onmouseout="this.style.background='#e0f2fe'">
                           📂 ${docCode}
                        </a>
                    `;
                }).join(" ");

                aiSummaryBlock.innerHTML = `
                    <div class="ai-summary-content" style="font-size: 15px; line-height: 1.6; color: #334155;">
                        <strong>✨ AI tóm tắt:</strong> ${renderAiResponseWithCitations(summaryText)}
                    </div>
                    <div class="ai-summary-sources" style="margin-top: 10px; font-size: 13px; color: #64748b; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        <span style="font-weight: 600;">📌 Nguồn tham khảo (${uniqueDocIds.length} tài liệu):</span>
                        ${sourcesHtml}
                    </div>
                    <div class="ai-summary-chat-section" style="margin-top: 15px; border-top: 1px dashed #cbd5e1; padding-top: 15px;">
                        <div id="aiSummaryChatMessages" style="max-height: 250px; overflow-y: auto; margin-bottom: 12px; font-size: 14px; display: none; padding-right: 5px;"></div>
                        <div class="ai-summary-chat-input-row" style="display: flex; gap: 8px;">
                            <input type="text" id="aiSummaryChatInput" placeholder="Hỏi tiếp về kết quả tìm kiếm này..." style="flex: 1; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px;" />
                            <button id="aiSummaryChatSend" style="background: #4f46e5; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;">➤ Hỏi AI</button>
                        </div>
                    </div>
                `;
                aiSummaryBlock.style.display = "block";

                const chatInput = document.getElementById("aiSummaryChatInput");
                const chatSend = document.getElementById("aiSummaryChatSend");
                
                chatSend?.addEventListener("click", sendAiSummaryChatMessage);
                chatInput?.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        sendAiSummaryChatMessage();
                    }
                });
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

// Hàm gửi câu hỏi tiếp nối ngay trong khung Tìm kiếm AI
async function sendAiSummaryChatMessage() {
    const inputEl = document.getElementById("aiSummaryChatInput");
    const sendBtn = document.getElementById("aiSummaryChatSend");
    const messagesEl = document.getElementById("aiSummaryChatMessages");
    if (!inputEl || !sendBtn || !messagesEl) return;

    const question = inputEl.value.trim();
    if (!question) return;

    // Hiển thị khung tin nhắn nếu đang ẩn
    messagesEl.style.display = "block";

    // Thêm tin nhắn user vào giao diện
    const userMsgDiv = document.createElement("div");
    userMsgDiv.style.margin = "8px 0";
    userMsgDiv.style.padding = "8px 12px";
    userMsgDiv.style.background = "#e0f2fe";
    userMsgDiv.style.borderRadius = "8px";
    userMsgDiv.style.fontSize = "14px";
    userMsgDiv.style.color = "#0369a1";
    userMsgDiv.style.textAlign = "right";
    userMsgDiv.innerHTML = `<strong>Bạn:</strong> ${question.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}`;
    messagesEl.appendChild(userMsgDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    inputEl.value = "";
    inputEl.disabled = true;
    sendBtn.disabled = true;

    // Thêm tin nhắn AI dạng loading
    const aiMsgDiv = document.createElement("div");
    aiMsgDiv.style.margin = "8px 0";
    aiMsgDiv.style.padding = "8px 12px";
    aiMsgDiv.style.background = "#f1f5f9";
    aiMsgDiv.style.borderRadius = "8px";
    aiMsgDiv.style.fontSize = "14px";
    aiMsgDiv.style.color = "#334155";
    aiMsgDiv.style.textAlign = "left";
    aiMsgDiv.innerHTML = `<strong>AI:</strong> <span style="color:#64748b; font-style:italic;">⏳ Đang suy nghĩ...</span>`;
    messagesEl.appendChild(aiMsgDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
        const historyLimit = 4;
        const recentHistory = aiSummaryChatHistory.slice(-(historyLimit * 2));

        // Dựng ngữ cảnh phân cấp từ các candidates đã lưu của phiên search này
        const plainTextContext = buildHierarchicalContext(currentSearchCandidates);

        const systemPrompt = `Bạn là trợ lý AI chuyên về tra cứu tài liệu của Khu công nghiệp Thốt Nốt.
Nhiệm vụ của bạn là trả lời câu hỏi tiếp nối của người dùng dựa trên ngữ cảnh các đoạn tài liệu được cung cấp dưới đây.
Hãy trả lời trực tiếp câu hỏi nối tiếp của người dùng dựa vào ngữ cảnh này. Trả lời bằng tiếng Việt ngắn gọn, rõ ràng.
Bắt buộc phải ghi rõ nguồn trích dẫn bằng mã tài liệu (ví dụ: [TL-11] hoặc [TL-09]) ở cuối câu hoặc ý tương ứng khi bạn lấy thông tin từ tài liệu đó.

*Quy tắc ứng xử đặc biệt*: Khi trả lời, nếu thông tin hoặc vai trò/chức danh cụ thể (ví dụ: ai là kế toán, ai là chỉ huy...) không được ghi rõ chính thức trong tài liệu, bạn phải thẳng thắn tuyên bố là tài liệu không đề cập chức danh/thông tin chính thức đó. Tuy nhiên, thay vì chỉ từ chối một cách cứng nhắc, bạn hãy liệt kê thêm các manh mối gián tiếp có sẵn trong văn bản (ví dụ: ai trình bày báo cáo tài chính, phòng ban nào liên quan...) để làm gợi ý tham khảo cho người dùng. TUYỆT ĐỐI KHÔNG ĐƯỢC SUY DIỄN, đoán mò hoặc bịa đặt thêm bất cứ điều gì ngoài văn bản; chỉ được phép trích xuất trung thực các dữ kiện thô có sẵn trong tài liệu.

Ngữ cảnh tài liệu:
${plainTextContext}`;

        const contents = [];
        contents.push({
            role: "user",
            parts: [{ text: systemPrompt }]
        });
        contents.push({
            role: "model",
            parts: [{ text: "Đã hiểu ngữ cảnh tài liệu. Tôi sẵn sàng trả lời các câu hỏi tiếp nối của bạn." }]
        });

        recentHistory.forEach(msg => {
            contents.push({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.text }]
            });
        });

        // Thêm câu hỏi hiện tại
        contents.push({
            role: "user",
            parts: [{ text: question }]
        });

        let aiResponseRaw = "";
        if (USE_PROXY) {
            const user = auth.currentUser;
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
            aiResponseRaw = parts && parts.length ? parts.map(p => p.text).join('\n') : "";
        } else {
            aiResponseRaw = await callGeminiDirectly(contents);
        }

        if (!aiResponseRaw) throw new Error("Không nhận được phản hồi từ AI.");

        // Hiển thị câu trả lời của AI
        aiMsgDiv.innerHTML = `<strong>AI:</strong> ${renderAiResponseWithCitations(aiResponseRaw).replace(/\n/g, "<br>")}`;
        messagesEl.scrollTop = messagesEl.scrollHeight;

        // Lưu lịch sử chat
        aiSummaryChatHistory.push({ role: "user", text: question });
        aiSummaryChatHistory.push({ role: "model", text: aiResponseRaw });

    } catch (e) {
        console.error("Lỗi chat nối tiếp AI Search:", e);
        aiMsgDiv.innerHTML = `<strong>AI:</strong> <span style="color:var(--danger-color);">❌ Lỗi: ${e.message}</span>`;
    } finally {
        inputEl.disabled = false;
        sendBtn.disabled = false;
        inputEl.focus();
    }
}

// Bắt sự kiện gõ tìm kiếm tức thì (tự động tắt chế độ AI, ẩn tóm tắt và reset giới hạn phân trang)
docSearchInput.addEventListener("input", () => {
    isAiSearchActive = false;
    aiSearchResults = null;
    activeDocIdFilter = null; // Reset document filter
    displayLimit = 12;
    aiSummaryChatHistory = [];
    currentSearchCandidates = [];
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
        activeDocIdFilter = null; // Reset document filter
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
        activeDocIdFilter = null; // Reset document filter
        renderGrid();
    });
});

// Hàm tìm kiếm nhanh từ thẻ gợi ý ở màn hình chào mừng
window.triggerQuickSearch = function (keyword) {
    if (docSearchInput) {
        docSearchInput.value = keyword;
        displayLimit = 12;
        activeDocIdFilter = null; // Reset document filter
        renderGrid();
    }
};


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
    const htmlText = renderAiResponseWithCitations(text);
    div.innerHTML = htmlText.replace(/\n/g, "<br>");
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

// Hàm tìm kiếm ID tài liệu đang hoạt động từ bộ lọc, ô tìm kiếm hoặc lịch sử chat gần nhất
function getActiveDocumentIdFromContext() {
    if (typeof activeDocIdFilter !== 'undefined' && activeDocIdFilter) {
        return activeDocIdFilter;
    }
    const searchInput = document.getElementById("docSearchInput")?.value || "";
    const cleanSearch = searchInput.trim().toLowerCase();
    const docCodeMatch = cleanSearch.match(/tl-?\d+/i);
    if (docCodeMatch) {
        const matchedCode = docCodeMatch[0].replace(/-/g, "");
        for (const docId in docCodeMap) {
            const cleanCode = docCodeMap[docId].toLowerCase().replace(/-/g, "");
            if (cleanCode === matchedCode) return docId;
        }
    }
    if (typeof docChatHistory !== 'undefined' && docChatHistory.length > 0) {
        for (let i = docChatHistory.length - 1; i >= 0; i--) {
            if (docChatHistory[i].role === "user") {
                const prevText = docChatHistory[i].text.trim().toLowerCase();
                const chatDocCodeMatch = prevText.match(/tl-?\d+/i);
                if (chatDocCodeMatch) {
                    const matchedCode = chatDocCodeMatch[0].replace(/-/g, "");
                    for (const docId in docCodeMap) {
                        const cleanCode = docCodeMap[docId].toLowerCase().replace(/-/g, "");
                        if (cleanCode === matchedCode) return docId;
                    }
                }
                break;
            }
        }
    }
}

// Hàm chuyển đổi danh sách Chunks thành dạng văn bản thuần có cấu trúc ngắn gọn để tiết kiệm token
// Hàm chuyển đổi danh sách Chunks thành dạng văn bản phân cấp (nhóm theo tài liệu cha kèm tóm tắt tổng quan tài liệu đó)
function buildHierarchicalContext(chunks) {
    // Nhóm các chunks theo documentId
    const docGroups = {};
    chunks.forEach(c => {
        if (!docGroups[c.documentId]) {
            docGroups[c.documentId] = [];
        }
        docGroups[c.documentId].push(c);
    });

    // Dựng ngữ cảnh phân cấp
    let contextParts = [];
    Object.keys(docGroups).forEach(docId => {
        const docData = allDocuments[docId] || {};
        const docCode = docCodeMap[docId] || "TL-XX";
        
        let docText = `=== TÀI LIỆU [${docCode}]: ${docData.title || docData.fileName || "Tài liệu"}\n`;
        docText += `Tóm tắt tổng quan tài liệu: ${docData.summary || "Không có tóm tắt tổng quan."}\n\n`;
        
        docGroups[docId].forEach((c, idx) => {
            docText += `  [Đoạn tri thức ${idx + 1}] ID: ${c.id}\n`;
            if (c.sectionName) docText += `  Phần: ${c.sectionName}\n`;
            if (c.title) docText += `  Mục: ${c.title}\n`;
            
            const mainContent = c.summary || (c.content ? c.content.substring(0, 250) : "");
            docText += `  Nội dung chi tiết: ${mainContent}\n\n`;
        });
        
        docText += `===`;
        contextParts.push(docText);
    });

    return contextParts.join("\n\n");
}

// Bảng màu phấn nhạt (Pastel) đồng bộ cho trích dẫn và văn bản câu/đoạn trích dẫn
// Bảng màu phấn cực nhạt (Pastel) dịu mắt, tránh cộm mắt và không đổi màu chữ
const CITE_COLORS = [
    { bg: "rgba(59, 130, 246, 0.04)", border: "rgba(59, 130, 246, 0.2)", text: "#1e40af" },      // Blue
    { bg: "rgba(16, 185, 129, 0.04)", border: "rgba(16, 185, 129, 0.2)", text: "#065f46" },    // Green
    { bg: "rgba(245, 158, 11, 0.04)", border: "rgba(245, 158, 11, 0.2)", text: "#9a3412" },     // Orange
    { bg: "rgba(139, 92, 246, 0.04)", border: "rgba(139, 92, 246, 0.2)", text: "#5b21b6" },     // Purple
    { bg: "rgba(236, 72, 153, 0.04)", border: "rgba(236, 72, 153, 0.2)", text: "#9d174d" },     // Pink
    { bg: "rgba(6, 182, 212, 0.04)", border: "rgba(6, 182, 212, 0.2)", text: "#075985" },      // Cyan
    { bg: "rgba(239, 68, 68, 0.04)", border: "rgba(239, 68, 68, 0.2)", text: "#991b1b" }       // Red
];

// Hàm tìm kiếm và chuyển đổi định dạng trích dẫn [TL-XX] thành liên kết HTML bấm được & Tô màu đoạn văn bản dẫn chứng (chừa lời dẫn/tiêu đề)
function renderAiResponseWithCitations(text) {
    if (!text) return "";

    // 1. Quét tìm tất cả các mã tài liệu TL-XX xuất hiện trong text để lập bản đồ màu không trùng lặp (Dynamic Color Map)
    const docCodeRegex = /TL-\d+/g;
    const foundCodes = [];
    let match;
    while ((match = docCodeRegex.exec(text)) !== null) {
        const code = match[0].toUpperCase();
        if (!foundCodes.includes(code)) {
            foundCodes.push(code);
        }
    }

    // Tạo map từ docCode sang index màu độc nhất
    const docColorMapLocal = {};
    foundCodes.forEach((code, idx) => {
        docColorMapLocal[code] = idx % CITE_COLORS.length;
    });

    function getDocColorStyleLocal(docCode) {
        const clean = docCode.toUpperCase().replace(/\s/g, "");
        const colorIndex = docColorMapLocal[clean] !== undefined ? docColorMapLocal[clean] : 0;
        const color = CITE_COLORS[colorIndex];
        // Đơn thuần chỉ tô nền rất nhạt, giữ nguyên màu chữ gốc (inherit) và không có đường gạch chân (no border)
        return `background-color: ${color.bg}; color: inherit; padding: 2px 4px; border-radius: 4px; transition: all 0.2s;`;
    }

    // Helper tách phần lời dẫn hoặc tiêu đề danh sách không liên quan ra khỏi phần chữ được tô màu của trích dẫn
    function separateCitationText(val) {
        if (!val) return { preText: "", citeText: "" };
        
        // Quét tìm điểm ngắt gần nhất từ dưới lên (Dấu xuống dòng, dấu chấm câu, hoặc ký tự đầu danh sách)
        const markers = [
            { regex: /\n/g, offset: 1 },
            { regex: /\.\s/g, offset: 2 },
            { regex: /;\s/g, offset: 2 },
            { regex: /:\s/g, offset: 2 },
            { regex: /\-\s/g, offset: 0 },
            { regex: /\d+\.\s\*\*/g, offset: 0 },
            { regex: /\d+\.\s/g, offset: 0 }
        ];
        
        let lastPos = -1;
        let chosenOffset = 0;
        
        markers.forEach(m => {
            let mMatch;
            m.regex.lastIndex = 0;
            while ((mMatch = m.regex.exec(val)) !== null) {
                if (mMatch.index > lastPos) {
                    lastPos = mMatch.index;
                    chosenOffset = m.offset;
                }
            }
        });
        
        if (lastPos !== -1) {
            const breakIdx = lastPos + chosenOffset;
            if (breakIdx > 0 && breakIdx < val.length) {
                return {
                    preText: val.substring(0, breakIdx),
                    citeText: val.substring(breakIdx)
                };
            }
        }
        
        return {
            preText: "",
            citeText: val
        };
    }

    // Regex tìm các khối nằm trong ngoặc vuông [] có chứa chữ TL (ví dụ: [TL-09] hoặc [TL-03, TL-11] hoặc [TL-09#chunk_123])
    const bracketRegex = /(\[[^\]]*TL-\d+[^\]]*\])/g;

    const parts = text.split(bracketRegex);
    let resultHtml = "";

    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            const currentText = parts[i];
            const nextCitation = parts[i + 1];
            
            if (nextCitation && currentText.trim().length > 0) {
                // Phân tích trích dẫn kế tiếp để lấy docCode tô màu
                const cleanCite = nextCitation.replace(/[\[\]]/g, "").trim();
                const firstCitePart = cleanCite.split(",")[0].trim();
                let docCode = firstCitePart;
                if (firstCitePart.includes("#")) {
                    docCode = firstCitePart.split("#")[0].trim();
                }
                
                const style = getDocColorStyleLocal(docCode);
                const separated = separateCitationText(currentText);
                
                resultHtml += separated.preText + `<span class="cite-text-highlight" style="${style}">${separated.citeText}</span>`;
            } else {
                resultHtml += currentText;
            }
        } else {
            const citationText = parts[i];
            const innerContent = citationText.replace(/[\[\]]/g, "").trim();
            const citeParts = innerContent.split(",").map(p => p.trim());
            
            const badgesHtml = citeParts.map(part => {
                let docCode = part;
                let chunkId = "";
                
                if (part.includes("#")) {
                    const subParts = part.split("#");
                    docCode = subParts[0].trim();
                    chunkId = subParts[1].trim();
                }

                const cleanDocCode = docCode.toUpperCase().replace(/\s/g, "");
                
                let matchedDocId = "";
                for (const id in docCodeMap) {
                    const codeInMap = docCodeMap[id].toUpperCase().replace(/\s/g, "");
                    if (codeInMap === cleanDocCode || codeInMap.replace(/-/g, "") === cleanDocCode.replace(/-/g, "")) {
                        matchedDocId = id;
                        break;
                    }
                }

                if (!matchedDocId) {
                    return part;
                }

                if (!chunkId) {
                    const candidateChunk = currentSearchCandidates.find(c => c.documentId === matchedDocId);
                    if (candidateChunk) {
                        chunkId = candidateChunk.id;
                    } else {
                        const fallbackChunk = allChunks.find(c => c.documentId === matchedDocId);
                        if (fallbackChunk) {
                            chunkId = fallbackChunk.id;
                        }
                    }
                }

                const chunk = allChunks.find(c => c.id === chunkId);
                const tooltipText = chunk ? `${docCode} - ${chunk.sectionName || ""} - ${chunk.title || ""}` : docCode;

                const cleanCodeStyle = docCode.toUpperCase().replace(/\s/g, "");
                const colorIndex = docColorMapLocal[cleanCodeStyle] !== undefined ? docColorMapLocal[cleanCodeStyle] : 0;
                const colorObj = CITE_COLORS[colorIndex];

                return `
                    <a href="javascript:void(0);" onclick="openDocAndScrollToChunk('${matchedDocId}', '${chunkId}')"
                       style="background-color: ${colorObj.bg}; color: ${colorObj.text}; padding: 2px 6px; border-radius: 4px; font-weight: 600; text-decoration: none; font-size: 13px; border: 1px solid ${colorObj.border}; display: inline-flex; align-items: center; gap: 2px; transition: all 0.2s; margin-left: 2px;"
                       title="${tooltipText}"
                       onmouseover="this.style.filter='brightness(0.95)'" 
                       onmouseout="this.style.filter='none'">
                       🔗 ${docCode}
                    </a>
                `;
            }).join(" ");

            resultHtml += badgesHtml;
        }
    }

    return resultHtml;
}

// Hàm mở tài liệu gốc và cuộn đến đoạn tri thức cụ thể, sau đó highlight và mở rộng đoạn đó
async function openDocAndScrollToChunk(docId, chunkId) {
    if (!docId) return;

    // 1. Mở tài liệu bảo mật
    openDocumentSecurely(docId);

    // 2. Chờ để giao diện Reader và Chunks kịp render
    let attempts = 0;
    const interval = setInterval(() => {
        const itemEl = document.querySelector(`#readerChunksList .reader-chunk-item[data-chunk-id="${chunkId}"]`);
        attempts++;
        if (itemEl) {
            clearInterval(interval);
            
            // Chuyển sang tab "Tri thức" (Overview)
            switchReaderTab("overview");
            
            // Cuộn mượt mà đưa phần tử về giữa màn hình
            itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Tự động mở rộng (Accordion) để xem nội dung chi tiết
            document.querySelectorAll("#readerChunksList .reader-chunk-item").forEach(el => {
                el.classList.remove("expanded");
            });
            itemEl.classList.add("expanded");

            // Hiệu ứng highlight màu vàng nhạt
            itemEl.style.transition = "background-color 0.5s ease";
            itemEl.style.backgroundColor = "#fef08a"; // Màu vàng highlight
            itemEl.style.border = "1px solid #eab308";
            
            setTimeout(() => {
                itemEl.style.backgroundColor = ""; // Trả lại nền cũ
                itemEl.style.border = "";
            }, 3000);
        }
        if (attempts >= 20) {
            clearInterval(interval);
        }
    }, 100);
}

// Xuất ra phạm vi toàn cục để onclick HTML có thể gọi được
window.openDocAndScrollToChunk = openDocAndScrollToChunk;

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
        const activeDocId = getActiveDocumentIdFromContext();
        let searchScope = allChunks;
        if (activeDocId) {
            const filtered = allChunks.filter(c => c.documentId === activeDocId);
            if (filtered.length > 0) {
                searchScope = filtered;
            }
        }
        scoredCandidates = searchScope.map(chunk => {
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

                // TĂNG ĐIỂM ĐẶC BIỆT: Nếu từ khóa trùng khớp chính xác với mã tài liệu (docCode) của chunk
                const cleanDocCode = removeAccents(docCode.toLowerCase());
                searchVariants.forEach(variant => {
                    if (cleanDocCode === variant) {
                        score += 5000; // Đảm bảo tài liệu khớp mã luôn đứng đầu
                    }
                });
                const synonyms = SYNONYM_DICT[tokenClean];
                if (synonyms) {
                    synonyms.forEach(syn => {
                        const synClean = removeAccents(syn);
                        fields.forEach(f => { if (f.includes(synClean)) score += 5; });
                    });
                }
            });

            // TĂNG ĐIỂM NGỮ CẢNH: Nếu chunk thuộc tài liệu đang thảo luận
            if (activeDocId && chunk.documentId === activeDocId) {
                score += 2000;
            }

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

        let replyHtml = `🔍 <b>Tìm thấy tài liệu phù hợp (Trực tiếp từ kho tri thức):</b><br><br>`;
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
    const typingBubble = appendChatMessage("ai", "⏳ AI đang phân tích tài liệu và tổng hợp...", true);

    try {
        // Lấy số lượng chunks theo cấu hình (mặc định 5, hoặc 10 nếu bật Ngữ cảnh rộng)
        const maxChunks = window.aiConfig.wideContext ? 10 : 5;
        let topChunks = scoredCandidates.slice(0, maxChunks).map(s => s.chunk);
        if (topChunks.length === 0) {
            topChunks = allChunks.slice(0, maxChunks);
        }

        // Bước 2: Xây dựng system prompt với ngữ cảnh tài liệu (dạng văn bản phân cấp nén)
        const plainTextContext = buildHierarchicalContext(topChunks);

        let detailPrompt = "Trả lời ngắn gọn, rõ ràng, tập trung trực tiếp vào câu trả lời, không viết dài dòng. Trả lời bằng tiếng Việt.";
        if (window.aiConfig.detailedResponse) {
            detailPrompt = "Phân tích chuyên sâu, hướng dẫn chi tiết đầy đủ từng bước (nếu có) bằng tiếng Việt dựa trên tài liệu cung cấp.";
        }

        const systemPrompt = `Bạn là trợ lý AI chuyên về tra cứu tài liệu của Khu công nghiệp Thốt Nốt.
Nhiệm vụ: Trả lời câu hỏi của người dùng dựa trên các đoạn tài liệu được cung cấp dưới đây.
${detailPrompt}
Bắt buộc phải ghi rõ nguồn trích dẫn bằng mã tài liệu (ví dụ: [TL-11] hoặc [TL-09]) ở cuối câu hoặc ý tương ứng khi bạn lấy thông tin từ tài liệu đó.
Nếu thông tin không có trong tài liệu, hãy nói thẳng là không tìm thấy.

*Quy tắc ứng xử đặc biệt*: Khi trả lời, nếu thông tin hoặc vai trò/chức danh cụ thể (ví dụ: ai là kế toán, ai là chỉ huy...) không được ghi rõ chính thức trong tài liệu, bạn phải thẳng thắn tuyên bố là tài liệu không đề cập chức danh/thông tin chính thức đó. Tuy nhiên, thay vì chỉ từ chối một cách cứng nhắc, bạn hãy liệt kê thêm các manh mối gián tiếp có sẵn trong văn bản (ví dụ: ai trình bày báo cáo tài chính, phòng ban nào liên quan...) để làm gợi ý tham khảo cho người dùng. TUYỆT ĐỐI KHÔNG ĐƯỢC SUY DIỄN, đoán mò hoặc bịa đặt thêm bất cứ điều gì ngoài văn bản; chỉ được phép trích xuất trung thực các dữ kiện thô có sẵn trong tài liệu.

Ngữ cảnh tài liệu:
${plainTextContext}`;

        // Bước 3: Xây dựng lịch sử hội thoại gửi lên Gemini (giới hạn N lượt gần nhất)
        const historyLimit = window.aiConfig.fullHistory ? 10 : 4;
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
window.toggleLimitInputUI = function (show) {
    const limitCountRow = document.getElementById("limitCountRow");
    if (limitCountRow) {
        limitCountRow.style.display = show ? "flex" : "none";
    }
};

// Mở Modal
window.openAiSettingsModal = function () {
    const modal = document.getElementById("aiSettingsModal");
    if (modal) {
        syncSettingsToModalUI();
        modal.style.display = "flex";
    }
};

// Đóng Modal
window.closeAiSettingsModal = function () {
    const modal = document.getElementById("aiSettingsModal");
    if (modal) {
        modal.style.display = "none";
    }
};

// Lưu cấu hình vào Firestore
window.saveAiSettings = async function () {
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

// =========================================================
// 📂 HỆ THỐNG TRÌNH ĐỌC SONG SONG (SPLIT-SCREEN READER)
// =========================================================

function renderReaderRightPane(docId) {
    const docData = allDocuments[docId] || {};
    const code = docCodeMap[docId] || "TL-XX";

    document.getElementById("readerDocCode").textContent = code;
    document.getElementById("readerDocTitle").textContent = docData.title || docData.fileName || "Tài liệu";
    document.getElementById("readerDocIssuer").textContent = docData.issuedBy || "Không rõ";
    document.getElementById("readerDocNumber").textContent = docData.documentNumber || docData.fileName || "Không rõ";

    let issuedDateStr = "Không rõ";
    if (docData.issuedDate) {
        const dateObj = new Date(docData.issuedDate);
        if (!isNaN(dateObj.getTime())) {
            issuedDateStr = dateObj.toLocaleDateString("vi-VN");
        } else {
            issuedDateStr = docData.issuedDate;
        }
    }
    document.getElementById("readerDocDate").textContent = issuedDateStr;
    document.getElementById("readerDocSummary").textContent = docData.summary || "Không có tóm tắt.";

    // Render Chunks
    const chunks = allChunks.filter(c => c.documentId === docId);
    const chunksListEl = document.getElementById("readerChunksList");

    if (chunks.length === 0) {
        chunksListEl.innerHTML = `<div style="font-size:12px; color:#64748b; padding:10px; text-align:center;">Không có đoạn tri thức trích dẫn nào.</div>`;
    } else {
        chunksListEl.innerHTML = chunks.map((c, index) => {
            const escapedContent = (c.content || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\n/g, "<br>");

            return `
                <div class="reader-chunk-item" data-chunk-id="${c.id}">
                    <div class="reader-chunk-secname">${c.sectionName || `Đoạn ${index + 1}`}</div>
                    <div class="reader-chunk-title">${c.title || ""}</div>
                    <div class="reader-chunk-summary">${c.summary || (c.content ? c.content.substring(0, 100) + "..." : "")}</div>
                    <div class="reader-chunk-content-full">${escapedContent}</div>
                </div>
            `;
        }).join('');

        // Add click listener to chunks (Accordion toggle)
        document.querySelectorAll("#readerChunksList .reader-chunk-item").forEach(item => {
            item.addEventListener("click", () => {
                const isExpanded = item.classList.contains("expanded");

                // Thu gọn tất cả các thẻ khác trước
                document.querySelectorAll("#readerChunksList .reader-chunk-item").forEach(el => {
                    el.classList.remove("expanded");
                });

                // Nếu chưa mở rộng thì mở rộng thẻ hiện tại
                if (!isExpanded) {
                    item.classList.add("expanded");
                }
            });
        });
    }
}

function switchReaderTab(tabName) {
    const tabOverview = document.getElementById("readerTabOverview");
    const tabChat = document.getElementById("readerTabChat");
    const btnTabOverview = document.getElementById("btnReaderTabOverview");
    const btnTabChat = document.getElementById("btnReaderTabChat");

    if (!tabOverview || !tabChat || !btnTabOverview || !btnTabChat) return;

    if (tabName === "overview") {
        tabOverview.classList.add("active");
        tabChat.classList.remove("active");
        btnTabOverview.classList.add("active");
        btnTabChat.classList.remove("active");
    } else if (tabName === "chat") {
        tabOverview.classList.remove("active");
        tabChat.classList.add("active");
        btnTabOverview.classList.remove("active");
        btnTabChat.classList.add("active");

        // Render history if empty
        if (readerChatHistory.length === 0) {
            appendReaderChatMessage("ai", "💬 Chào bạn! Hãy đặt câu hỏi bất kỳ liên quan đến tài liệu này.");
        }

        setTimeout(() => document.getElementById("readerChatInput")?.focus(), 200);
    }
}

function appendReaderChatMessage(role, text) {
    const messagesEl = document.getElementById("readerChatMessages");
    if (!messagesEl) return;

    const div = document.createElement("div");
    div.className = `doc-chat-msg ${role}`;
    const htmlText = renderAiResponseWithCitations(text);
    div.innerHTML = htmlText.replace(/\n/g, "<br>");
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
}

async function sendReaderChatMessage(text) {
    if (!text.trim() || readerChatIsThinking) return;

    const user = auth.currentUser;
    if (!user) {
        appendReaderChatMessage("ai", "⚠️ Vui lòng đăng nhập để sử dụng tính năng này.");
        return;
    }

    // Kiểm tra quota trước
    const proceed = await confirmAiAction();
    if (!proceed) return;

    const hasQuota = await checkAndIncrementDailyUsage();
    if (!hasQuota) return;

    readerChatHistory.push({ role: "user", text });
    appendReaderChatMessage("user", text);
    readerChatIsThinking = true;

    // Disable input
    const inputEl = document.getElementById("readerChatInput");
    const sendBtn = document.getElementById("readerChatSend");
    if (inputEl) inputEl.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    // Show loading
    const typingBubble = appendReaderChatMessage("ai", "⏳ Trợ lý đang phân tích tài liệu để trả lời...");

    try {
        const chunks = allChunks.filter(c => c.documentId === currentOpenDocId);

        // Chấm điểm nhanh chọn ra các chunks liên quan nhất đến câu hỏi
        let scoredChunks = chunks.map(c => {
            let score = 0;
            const fields = [
                c.sectionName || "",
                c.title || "",
                c.summary || "",
                c.content || "",
                (c.keywords || []).join(" ")
            ].map(f => removeAccents(f.toLowerCase()));

            const tokens = removeAccents(text.toLowerCase()).split(/\s+/).filter(t => t.length > 0 && !STOP_WORDS.has(t));
            tokens.forEach(token => {
                fields.forEach(field => {
                    if (field.includes(token)) score += 10;
                });
            });
            return { chunk: c, score };
        });

        // Sắp xếp giảm dần theo mức độ phù hợp
        scoredChunks.sort((a, b) => b.score - a.score);
        let selectedChunks = scoredChunks.filter(sc => sc.score > 0).map(sc => sc.chunk);
        
        // Nếu không khớp từ khóa nào, lấy 6 chunks đầu làm mặc định, ngược lại lấy tối đa 6 chunks phù hợp nhất
        if (selectedChunks.length === 0) {
            selectedChunks = chunks.slice(0, 6);
        } else {
            selectedChunks = selectedChunks.slice(0, 6);
        }

        // Tạo ngữ cảnh tài liệu rút gọn (dạng văn bản phân cấp nén)
        const plainTextContext = buildHierarchicalContext(selectedChunks);

        const systemPrompt = `Bạn là trợ lý AI thông minh chuyên hỗ trợ đọc hiểu văn bản pháp lý / quy trình kỹ thuật.
Nhiệm vụ của bạn là trả lời các câu hỏi dựa trên nội dung duy nhất của tài liệu được cung cấp dưới đây.
Nếu thông tin không nằm trong ngữ cảnh tài liệu này, hãy nói thẳng là tài liệu không đề cập đến thông tin đó và đề xuất người dùng hỏi câu hỏi khác liên quan. Trả lời bằng tiếng Việt ngắn gọn, rõ ràng.

*Quy tắc ứng xử đặc biệt*: Khi trả lời, nếu thông tin hoặc vai trò/chức danh cụ thể (ví dụ: ai là kế toán, ai là chỉ huy...) không được ghi rõ chính thức trong tài liệu, bạn phải thẳng thắn tuyên bố là tài liệu không đề cập chức danh/thông tin chính thức đó. Tuy nhiên, thay vì chỉ từ chối một cách cứng nhắc, bạn hãy liệt kê thêm các manh mối gián tiếp có sẵn trong văn bản (ví dụ: ai trình bày báo cáo tài chính, phòng ban nào liên quan...) để làm gợi ý tham khảo cho người dùng. TUYỆT ĐỐI KHÔNG ĐƯỢC SUY DIỄN, đoán mò hoặc bịa đặt thêm bất cứ điều gì ngoài văn bản; chỉ được phép trích xuất trung thực các dữ kiện thô có sẵn trong tài liệu.

Ngữ cảnh tài liệu:
${plainTextContext}`;

        // Build history turns
        const contents = [];
        contents.push({
            role: "user",
            parts: [{ text: systemPrompt }]
        });
        contents.push({
            role: "model",
            parts: [{ text: "Đã hiểu ngữ cảnh tài liệu. Tôi sẵn sàng giải đáp câu hỏi của bạn." }]
        });

        // Add history
        readerChatHistory.forEach(msg => {
            contents.push({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.text }]
            });
        });

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
                console.warn("[ReaderChat] Proxy AI gặp lỗi, thử gọi trực tiếp bằng Local Key làm dự phòng:", proxyError);
                aiText = await callGeminiDirectly(contents);
            }
        } else {
            aiText = await callGeminiDirectly(contents);
        }

        if (typingBubble) typingBubble.remove();
        readerChatHistory.push({ role: "ai", text: aiText });
        appendReaderChatMessage("ai", aiText);

    } catch (err) {
        console.error("[ReaderChat] Lỗi:", err);
        if (typingBubble) typingBubble.remove();
        appendReaderChatMessage("ai", `❌ Lỗi: ${err.message || "Không thể kết nối AI. Vui lòng thử lại."}`);
    } finally {
        readerChatIsThinking = false;
        if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
        if (sendBtn) sendBtn.disabled = false;
    }
}

function closeDocumentReader() {
    const modal = document.getElementById("documentReaderModal");
    if (modal) modal.style.display = "none";

    // Thu hồi Blob URL để giải phóng RAM
    if (currentOpenDocBlobUrl) {
        URL.revokeObjectURL(currentOpenDocBlobUrl);
        currentOpenDocBlobUrl = null;
    }
    currentOpenDocId = null;
    currentOpenDocName = "";

    // Xóa lịch sử chat
    readerChatHistory = [];
    document.getElementById("readerChatMessages").innerHTML = "";
    document.getElementById("docReaderFrame").src = "";
}

function initDocumentReader() {
    const btnReaderClose = document.getElementById("btnReaderClose");
    const btnReaderTabOverview = document.getElementById("btnReaderTabOverview");
    const btnReaderTabChat = document.getElementById("btnReaderTabChat");
    const btnDownloadOriginal = document.getElementById("btnDownloadOriginal");
    const btnDownloadFallback = document.getElementById("btnDownloadFallback");
    const readerChatSend = document.getElementById("readerChatSend");
    const readerChatInput = document.getElementById("readerChatInput");

    btnReaderClose?.addEventListener("click", closeDocumentReader);

    btnReaderTabOverview?.addEventListener("click", () => switchReaderTab("overview"));
    btnReaderTabChat?.addEventListener("click", () => switchReaderTab("chat"));

    const downloadHandler = () => {
        if (currentOpenDocBlobUrl) {
            const link = document.createElement('a');
            link.href = currentOpenDocBlobUrl;
            link.download = currentOpenDocName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else if (currentOpenDocId) {
            // Trường hợp tệp chưa được tải về RAM (ví dụ trên di động)
            const docData = allDocuments[currentOpenDocId] || {};
            const fileName = docData.title || docData.fileName || "Tài liệu";
            downloadFileSecurely(currentOpenDocId, fileName);
        }
    };

    btnDownloadOriginal?.addEventListener("click", downloadHandler);
    btnDownloadFallback?.addEventListener("click", downloadHandler);

    readerChatSend?.addEventListener("click", () => {
        const text = readerChatInput?.value.trim();
        if (text) {
            readerChatInput.value = "";
            sendReaderChatMessage(text);
        }
    });

    readerChatInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const text = readerChatInput.value.trim();
            if (text) {
                readerChatInput.value = "";
                sendReaderChatMessage(text);
            }
        }
    });
}

function initScrollToTop() {
    const btn = document.getElementById("scrollToTopBtn");
    if (!btn) return;

    let scrollTimeout = null;
    let isHovering = false;

    const startHideTimeout = () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!isHovering && window.scrollY > 300) {
                btn.classList.remove("visible");
            }
        }, 1500); // Ẩn nút sau 1.5 giây dừng cuộn
    };

    window.addEventListener("scroll", () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);

        if (window.scrollY > 300) {
            btn.classList.add("visible");
            if (!isHovering) {
                startHideTimeout();
            }
        } else {
            btn.classList.remove("visible");
        }
    });

    btn.addEventListener("mouseenter", () => {
        isHovering = true;
        if (scrollTimeout) clearTimeout(scrollTimeout);
        btn.classList.add("visible"); // Giữ nút luôn hiện khi người dùng rê chuột vào
    });

    btn.addEventListener("mouseleave", () => {
        isHovering = false;
        if (window.scrollY > 300) {
            startHideTimeout();
        }
    });

    btn.addEventListener("click", () => {
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });
}

// Khởi chạy trình đọc tài liệu gốc & nút cuộn đầu trang
initDocumentReader();
initScrollToTop();

// =======================================================
// 📤 HỆ THỐNG PHỤ TRỢ TẢI LÊN TÀI LIỆU DÀNH CHO ADMIN
// =======================================================
function initUploadDocumentFeature() {
    console.log("🛠️ initUploadDocumentFeature() được gọi.");
    const uploadTriggerBtn = document.getElementById("uploadDocTriggerBtn");
    const uploadModal = document.getElementById("uploadDocModal");
    console.log("-> uploadTriggerBtn:", uploadTriggerBtn);
    console.log("-> uploadModal:", uploadModal);

    const closeUploadModalBtn = document.getElementById("closeUploadDocModalBtn");
    const cancelUploadBtn = document.getElementById("cancelUploadDocBtn");
    const uploadForm = document.getElementById("uploadDocForm");
    const groupSelect = document.getElementById("uploadGroupSelect");
    const subfolderSelect = document.getElementById("uploadSubfolderSelect");
    const categorySelect = document.getElementById("uploadCategorySelect");
    const fileInput = document.getElementById("uploadFileInput");
    const progressContainer = document.getElementById("uploadProgressContainer");
    const progressStatus = document.getElementById("uploadProgressStatus");
    const progressPercent = document.getElementById("uploadProgressPercent");
    const progressBar = document.getElementById("uploadProgressBar");

    if (!uploadTriggerBtn || !uploadModal) {
        console.warn("⚠️ Không tìm thấy nút Tải tài liệu hoặc Modal!");
        return;
    }

    // Các ID thư mục gốc của Google Drive (đã cấu hình trong GAS.txt)
    const ROOT_FOLDER_IDS = {
        "guest": "1WA14y4XVU2wHE6hL6S3liRFUAR_j_0bB",
        "user": "1-ghDDDgYo4ussA8epsxNdAcurvLsPHjI",
        "admin": "1elB0J7QoRlrhjJVNI_0nc4ewWPiYR9Sb"
    };

    // Hàm load các thư mục con dựa trên thư mục chính
    async function loadSubfolders(groupId) {
        subfolderSelect.innerHTML = '<option value="" disabled selected>Đang tải danh sách thư mục con...</option>';
        subfolderSelect.disabled = true;

        const parentId = ROOT_FOLDER_IDS[groupId];
        if (!parentId) {
            subfolderSelect.innerHTML = '<option value="" disabled selected>Lỗi: Không tìm thấy thư mục gốc</option>';
            return;
        }

        try {
            const formData = new URLSearchParams();
            formData.append("action", "getSubfolders");
            formData.append("folderId", parentId);
            const response = await fetch(GAS_API_URL, {
                method: "POST",
                body: formData
            });
            const data = await response.json();
            
            if (data.success && data.subfolders) {
                let html = "";
                data.subfolders.forEach(folder => {
                    html += `<option value="${folder.id}">${folder.name}</option>`;
                });
                subfolderSelect.innerHTML = html;
            } else {
                subfolderSelect.innerHTML = `<option value="${parentId}">[Thư mục gốc]</option>`;
            }
        } catch (e) {
            console.error("Lỗi khi tải danh sách thư mục con:", e);
            subfolderSelect.innerHTML = `<option value="${parentId}">[Thư mục gốc]</option>`;
        } finally {
            subfolderSelect.disabled = false;
            // Tự động gợi ý danh mục sau khi danh sách thư mục con thay đổi
            suggestCategoryBasedOnSubfolder();
        }
    }

    // Tự động gợi ý danh mục (Category) dựa trên tên của thư mục con được chọn
    function suggestCategoryBasedOnSubfolder() {
        const selectedText = subfolderSelect.options[subfolderSelect.selectedIndex]?.text || "";
        const nameLower = selectedText.toLowerCase();

        if (nameLower.includes("pháp lý") || nameLower.includes("luật") || nameLower.includes("quy chuẩn")) {
            categorySelect.value = "Pháp lý";
        } else if (nameLower.includes("kỹ thuật") || nameLower.includes("sơ đồ") || nameLower.includes("vận hành")) {
            categorySelect.value = "Kỹ thuật";
        } else {
            categorySelect.value = "Khác";
        }
    }

    // Sự kiện mở modal
    uploadTriggerBtn.addEventListener("click", () => {
        console.log("📥 Nút Tải tài liệu được click!");
        uploadForm.reset();
        progressContainer.style.display = "none";
        progressBar.style.width = "0%";
        progressPercent.textContent = "0%";
        uploadModal.style.display = "flex";
        console.log("-> Đã thiết lập display: flex cho Modal.");
        // Mặc định load danh sách thư mục con cho nhóm 'user' (Nội bộ)
        loadSubfolders(groupSelect.value);
    });

    // Sự kiện thay đổi nhóm quyền xem -> load lại thư mục con
    groupSelect.addEventListener("change", () => {
        loadSubfolders(groupSelect.value);
    });

    // Sự kiện thay đổi thư mục con -> gợi ý danh mục
    subfolderSelect.addEventListener("change", () => {
        suggestCategoryBasedOnSubfolder();
    });

    // Các sự kiện đóng modal
    const closeModal = () => {
        uploadModal.style.display = "none";
    };
    closeUploadModalBtn.addEventListener("click", closeModal);
    cancelUploadBtn.addEventListener("click", closeModal);

    // Xử lý gửi Form tải lên
    uploadForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const file = fileInput.files[0];
        if (!file) return;

        const targetGroup = groupSelect.value;
        const targetFolderId = subfolderSelect.value;
        const category = categorySelect.value;

        // Hiển thị thanh tiến trình
        progressContainer.style.display = "block";
        progressStatus.textContent = "Đang tải file lên Google Drive...";
        progressBar.style.width = "20%";
        progressPercent.textContent = "20%";

        const submitBtn = document.getElementById("submitUploadDocBtn");
        submitBtn.disabled = true;

        try {
            // Bước 1: Gọi hàm uploadFileToDrive (script.js) tải tệp lên Drive qua Apps Script
            progressBar.style.width = "40%";
            progressPercent.textContent = "40%";
            
            // uploadFileToDrive(file, company, folderId, formId, data)
            const uploadedFile = await uploadFileToDrive(
                file, 
                "KCN Thốt Nốt", 
                targetFolderId, 
                "web_doc_upload", 
                { category, targetGroup }
            );

            if (!uploadedFile || !uploadedFile.id) {
                throw new Error("Không nhận được phản hồi ID hợp lệ từ Google Drive.");
            }

            progressBar.style.width = "75%";
            progressPercent.textContent = "75%";
            progressStatus.textContent = "Đang đăng ký hàng đợi trên Firestore...";

            // Bước 2: Sinh mã TL-XX tiếp theo cho tài liệu mới
            let nextDocCode = "TL-01";
            let maxNum = 0;
            Object.keys(allDocuments).forEach(id => {
                const docData = allDocuments[id];
                if (docData.docCode && docData.docCode.startsWith("TL-")) {
                    const num = parseInt(docData.docCode.substring(3), 10);
                    if (!isNaN(num) && num > maxNum) {
                        maxNum = num;
                    }
                }
            });
            nextDocCode = `TL-${String(maxNum + 1).padStart(2, "0")}`;

            // Bước 3: Lưu bản ghi tài liệu mới với status='pending' vào Firestore
            const newDocId = uploadedFile.id;
            const docRef = doc(db, "documents", newDocId);
            const docData = {
                fileName: file.name,
                folderId: targetFolderId,
                targetGroup: targetGroup,
                category: category,
                status: "pending",
                docCode: nextDocCode,
                retryCount: 0,
                errorMessage: "",
                updatedAt: new Date().toISOString()
            };

            await setDoc(docRef, docData);

            // Cập nhật tức thời biến cục bộ allDocuments trên Client để UI render ngay lập tức
            allDocuments[newDocId] = docData;

            progressBar.style.width = "100%";
            progressPercent.textContent = "100%";
            progressStatus.textContent = "Tải lên và đồng bộ thành công!";

            // Render lại Sync Status trên sidebar lập tức
            renderSyncStatus();

            // Hiển thị thông báo thành công
            Swal.fire({
                icon: "success",
                title: "Thành công!",
                text: `Đã tải lên và đưa tệp ${file.name} vào hàng đợi phân tách tri thức AI.`,
                timer: 3000,
                showConfirmButton: true
            });

            closeModal();
        } catch (err) {
            console.error("Lỗi trong quá trình upload tài liệu mới:", err);
            Swal.fire({
                icon: "error",
                title: "Thất bại",
                text: "Không thể upload tài liệu: " + err.message
            });
        } finally {
            submitBtn.disabled = false;
            progressContainer.style.display = "none";
        }
    });
}
