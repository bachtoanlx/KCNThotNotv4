// Chatbot AI using Google Gemini

import { db, auth, getRole } from "./script.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAIKnowledgeBase } from "./chatbot-firebase-queries.js?v=7";

let cachedAIKnowledge = [];
let currentUserRole = "guest";

// Theo dõi vai trò người dùng hiện tại để phân quyền quy chế RAG
if (auth) {
    auth.onAuthStateChanged(async (user) => {
        if (user && user.email) {
            try {
                currentUserRole = await getRole(user.email);
            } catch (e) {
                console.error("Lỗi lấy vai trò chatbot:", e);
                currentUserRole = "user";
            }
        } else {
            currentUserRole = "guest";
        }

        // Cập nhật lại cachedAIKnowledge theo vai trò mới của người dùng
        try {
            cachedAIKnowledge = await getAIKnowledgeBase(currentUserRole);
            console.log(`🤖 Chatbot AI: Đã tải và cache quy chế cho vai trò: ${currentUserRole} (${cachedAIKnowledge.length} tài liệu).`);
        } catch (knowledgeErr) {
            console.warn("⚠️ Không thể tải quy chế AI sau khi đổi vai trò:", knowledgeErr);
        }
    });
}


// ========== CẤU HÌNH PROXY ==========
const USE_PROXY = true;
const PROXY_URL = 'https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec';

// Chỉ dùng khi USE_PROXY = false (local development)
let DIRECT_API_KEY = '';
if (!USE_PROXY) {
    try {
        const { CONFIG } = await import('./config.js');
        DIRECT_API_KEY = CONFIG.GEMINI_API_KEY;
    } catch (error) {
        console.warn('config.js not found - using proxy mode');
    }
}

const OVERRIDE_KEY = typeof localStorage !== 'undefined' ? localStorage.getItem('GEMINI_API_KEY') : null;
const GEMINI_API_KEY = OVERRIDE_KEY || DIRECT_API_KEY;

// Model ưu tiên gửi lên Proxy (Proxy sẽ tự fallback sang model khác nếu bị quota)
const PREFERRED_MODEL = 'gemini-3.6-flash';

// Các model + endpoint dùng cho chế độ gọi trực tiếp (USE_PROXY = false)
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
const GEMINI_API_BASES = [
    'https://generativelanguage.googleapis.com/v1beta',
    'https://generativelanguage.googleapis.com/v1'
];
const buildGeminiUrl = (base, model) => `${base}/models/${model}:generateContent`;

const isValidAPIKey = (USE_PROXY && PROXY_URL) || (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE' && GEMINI_API_KEY.startsWith('AIza'));

// System prompt ngắn gọn (Tải động từ Firestore nhưng cấu hình sẵn khung hướng dẫn phân tích)
let SYSTEM_CONTEXT = `Bạn là trợ lý ảo của KCN Thốt Nốt. Trả lời ngắn gọn, thân thiện bằng tiếng Việt.
Bạn được cung cấp dữ liệu thực tế từ hệ thống Firestore (lịch trực, chỉ số nước, thống kê xả thải, nhật ký hệ thống...) qua context để trả lời câu hỏi một cách chính xác nhất.

QUY TẮC HIỂN THỊ VÀ PHÂN TÍCH DỮ LIỆU:
- Tuyệt đối không tự bịa đặt thông tin. Nếu dữ liệu hệ thống trống hoặc không tìm thấy, hãy thông báo rõ ràng là không tìm thấy.
- Đối với dữ liệu nhân sự (personal_schedule_ai):
  - Hãy kiểm tra danh sách 'work_patterns' (chứa lịch sử phân ca) và 'shift_swaps' (đổi ca).
  - Nếu nhân sự đã nghỉ việc (tất cả quy tắc phân ca đều có patternEndDate trong quá khứ hoặc note ghi 'Nghỉ việc/thôi việc'): Hãy nêu rõ thời gian họ bắt đầu làm việc (patternStartDate) và ngày kết thúc/nghỉ việc (patternEndDate), đồng thời khẳng định rõ hiện tại họ đã nghỉ việc.
  - Nếu họ đang làm việc (có ít nhất 1 quy tắc có patternEndDate là null hoặc trong tương lai): Hãy liệt kê lịch trực sắp tới của họ rõ ràng và chi tiết.
  - Hãy trả lời tự nhiên, bao phủ toàn bộ câu hỏi của người dùng (ví dụ: giải đáp cả lịch trực và câu hỏi họ "còn làm việc hay không").
- Đối với nhật ký hệ thống (system_logs):
  - Đọc danh sách logs được cung cấp trong context.
  - Tổng hợp ngắn gọn các hoạt động của nhân sự đó (ví dụ: đăng nhập, thêm/sửa thiết bị, cập nhật cấu hình, báo cáo sự cố...) kèm theo mốc thời gian rõ ràng (đổi sang định dạng Việt Nam DD/MM/YYYY HH:mm).
  - Nếu người dùng hỏi về một nhân sự đã bị xóa tài khoản khỏi CSDL (như Tạ Minh Ngô), hãy tìm kiếm vết hoạt động của họ trong logs (ví dụ: email 'taminhngo.vl...' hoặc dữ liệu log liên quan) để nhận định: họ đã từng làm việc/thao tác gì trên hệ thống và thời điểm hoạt động cuối cùng của họ là khi nào.
- Đối với so sánh xả thải: Trình bày dạng danh sách gạch đầu dòng có số liệu thực tế xả thải, định mức khoán và chênh lệch rõ ràng.
- Sử dụng emoji sinh động để người dùng dễ đọc.`;


export let WELCOME_MESSAGE_MEMBER = `Xin chào! Tôi là trợ lý ảo hỗ trợ bạn.`;

export let WELCOME_MESSAGE_GUEST = `Xin chào! Tôi là trợ lý ảo hỗ trợ bạn. Vui lòng đăng nhập để sử dụng đầy đủ tính năng.`;


export function getWelcomeMessage() {
    if (auth && auth.currentUser && auth.currentUser.email) {
        const username = auth.currentUser.email.split('@')[0];
        let msg = WELCOME_MESSAGE_MEMBER;

        if (msg.startsWith("Xin chào!")) {
            return msg.replace("Xin chào!", `Xin chào ${username} !`);
        } else if (msg.startsWith("Xin chào")) {
            return msg.replace("Xin chào", `Xin chào ${username} `);
        } else {
            return `Xin chào ${username} !\n\n` + msg;
        }
    }
    return WELCOME_MESSAGE_GUEST;
}

let conversationHistory = [
    { role: "user", parts: [{ text: SYSTEM_CONTEXT }] },
    { role: "model", parts: [{ text: WELCOME_MESSAGE_GUEST }] }
];

let companyNameMap = {};
let staticResponsesMap = {};
export let employeeNamesList = [];
export let allEmployeeNamesList = [];

function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

let fuseInstance = null;

export function findClosestCompany(queryText) {
    if (!fuseInstance && typeof window !== 'undefined' && window.Fuse && companyNameMap) {
        const uniqueCompanies = [...new Set(Object.values(companyNameMap))];
        if (uniqueCompanies.length > 0) {
            fuseInstance = new window.Fuse(uniqueCompanies, { 
                includeScore: true, 
                threshold: 0.5 
            });
        }
    }
    if (fuseInstance) {
        // Loại bỏ các từ khóa nhiễu để việc so khớp tên công ty chính xác hơn
        const cleanQuery = queryText.toLowerCase()
            .replace(/lịch sử/g, '')
            .replace(/xả thải/g, '')
            .replace(/chỉ số/g, '')
            .replace(/đồng hồ/g, '')
            .replace(/ngày nghỉ/g, '')
            .replace(/công ty/g, '')
            .replace(/doanh nghiệp/g, '')
            .trim();
        
        const results = fuseInstance.search(cleanQuery || queryText);
        if (results.length > 0) {
            return {
                company: results[0].item,
                score: results[0].score
            };
        }
    }
    return null;
}

export async function initDynamicChatbotData() {
    try {
        let masterSnap = null;
        let configSnap = null;
        let aiConfigSnap = null;
        let patternsSnap = null;

        // Tải độc lập để tránh lỗi chặn quyền truy cập của một bảng làm hỏng cả quá trình
        try {
            masterSnap = await getDocs(collection(db, "companies_master"));
        } catch (e) {
            console.warn("⚠️ Không thể tải companies_master (Có thể do chưa đăng nhập):", e.message);
        }

        try {
            configSnap = await getDocs(collection(db, "company_configs"));
        } catch (e) {
            console.warn("⚠️ Không thể tải company_configs (Có thể do chưa đăng nhập):", e.message);
        }

        try {
            aiConfigSnap = await getDoc(doc(db, "settings", "ai_config"));
        } catch (e) {
            console.warn("⚠️ Không thể tải ai_config:", e.message);
        }

        try {
            patternsSnap = await getDocs(collection(db, "work_patterns"));
        } catch (e) {
            console.warn("⚠️ Không thể tải work_patterns:", e.message);
        }

        if (aiConfigSnap && aiConfigSnap.exists()) {
            const aiData = aiConfigSnap.data();
            if (aiData.systemContext) {
                SYSTEM_CONTEXT = aiData.systemContext + "\n\n" + `QUY TẮC HIỂN THỊ VÀ PHÂN TÍCH DỮ LIỆU:
- Tuyệt đối không tự bịa đặt thông tin. Nếu dữ liệu hệ thống trống hoặc không tìm thấy, hãy thông báo rõ ràng là không tìm thấy.
- Đối với dữ liệu nhân sự (personal_schedule_ai):
  - Hãy kiểm tra danh sách 'work_patterns' (chứa lịch sử phân ca) và 'shift_swaps' (đổi ca).
  - Nếu nhân sự đã nghỉ việc (tất cả quy tắc phân ca đều có patternEndDate trong quá khứ hoặc note ghi 'Nghỉ việc/thôi việc'): Hãy nêu rõ thời gian họ bắt đầu làm việc (patternStartDate) và ngày kết thúc/nghỉ việc (patternEndDate), đồng thời khẳng định rõ hiện tại họ đã nghỉ việc.
  - Nếu họ đang làm việc (có ít nhất 1 quy tắc có patternEndDate là null hoặc trong tương lai): Hãy liệt kê lịch trực sắp tới của họ rõ ràng và chi tiết.
  - Hãy trả về tự nhiên, bao phủ toàn bộ câu hỏi của người dùng (ví dụ: giải đáp cả lịch trực và câu hỏi họ "còn làm việc hay không").
- Đối với nhật ký hệ thống (system_logs):
  - Đọc danh sách logs được cung cấp trong context.
  - Tổng hợp ngắn gọn các hoạt động của nhân sự đó (ví dụ: đăng nhập, thêm/sửa thiết bị, cập nhật cấu hình, báo cáo sự cố...) kèm theo mốc thời gian rõ ràng (đổi sang định dạng Việt Nam DD/MM/YYYY HH:mm).
  - Nếu người dùng hỏi về một nhân sự đã bị xóa tài khoản khỏi CSDL (như Tạ Minh Ngô), hãy tìm kiếm vết hoạt động của họ trong logs (ví dụ: email 'taminhngo.vl...' hoặc dữ liệu log liên quan) để nhận định: họ đã từng làm việc/thao tác gì trên hệ thống và thời điểm hoạt động cuối cùng của họ là khi nào.
- Đối với so sánh xả thải: Trình bày dạng danh sách gạch đầu dòng có số liệu thực tế xả thải, định mức khoán và chênh lệch rõ ràng.
- Sử dụng emoji sinh động để người dùng dễ đọc.`;
                // Cập nhật lại prompt trong history đầu tiên nếu cuộc gọi reset chưa diễn ra
                if (conversationHistory.length > 0 && conversationHistory[0].role === "user") {
                    conversationHistory[0].parts[0].text = SYSTEM_CONTEXT;
                }
            }
            if (aiData.welcomeGuest) WELCOME_MESSAGE_GUEST = aiData.welcomeGuest;
            if (aiData.welcomeMember) WELCOME_MESSAGE_MEMBER = aiData.welcomeMember;
            if (aiData.staticResponses) {
                staticResponsesMap = typeof aiData.staticResponses === 'string'
                    ? JSON.parse(aiData.staticResponses)
                    : aiData.staticResponses;
            }
        }

        const masterCompanies = masterSnap ? masterSnap.docs.map(doc => doc.data().company).filter(Boolean) : [];
        const configs = configSnap ? configSnap.docs.map(d => d.data()) : [];
        const configCompanies = configs.map(c => c.company).filter(Boolean);

        const allCompanies = [...new Set([...masterCompanies, ...configCompanies])];
        if (allCompanies.length > 0) {
            const newMap = {};
            allCompanies.forEach(comp => {
                const lower = comp.toLowerCase();
                const noAccent = removeAccents(lower);
                newMap[lower] = comp;
                if (lower !== noAccent) newMap[noAccent] = comp;
            });

            // Nạp các từ viết tắt và gọi tắt thủ công từ Firestore để bảo mật
            if (aiConfigSnap && aiConfigSnap.exists()) {
                const aiData = aiConfigSnap.data();
                if (aiData.companyAbbreviations) {
                    const manualMap = typeof aiData.companyAbbreviations === 'string'
                        ? JSON.parse(aiData.companyAbbreviations)
                        : aiData.companyAbbreviations;

                    Object.keys(manualMap).forEach(key => {
                        newMap[key.toLowerCase()] = manualMap[key];
                    });
                }
            }

            companyNameMap = newMap;

            if (patternsSnap) {
                const allNames = patternsSnap.docs.map(doc => doc.data().displayName).filter(Boolean);
                allEmployeeNamesList = [...new Set(allNames)];

                const todayStr = new Date().toISOString().split('T')[0];
                const activeNames = patternsSnap.docs
                    .filter(doc => {
                        const data = doc.data();
                        if (data.patternEndDate && data.patternEndDate < todayStr) return false;
                        return true;
                    })
                    .map(doc => doc.data().displayName)
                    .filter(Boolean);
                employeeNamesList = [...new Set(activeNames)];
                console.log("👥 [AI Chatbot] Đã nạp danh sách nhân viên đang làm việc:", employeeNamesList);
                console.log("👥 [AI Chatbot] Đã nạp toàn bộ danh sách nhân viên (cả nghỉ việc):", allEmployeeNamesList);
            }

            const latestConfigs = {};
            configs.sort((a, b) => (a.effectiveDate || "").localeCompare(b.effectiveDate || ""));
            configs.forEach(c => { if (c.company) latestConfigs[c.company] = c; });

            const group1 = [], group2 = [], group3 = [];
            allCompanies.forEach(comp => {
                const group = latestConfigs[comp]?.group || (['NTSF', 'Ấn Độ Dương', 'Đại Tây Dương', 'Amicogen', 'Cá Việt Nam'].includes(comp) ? 'group1' : 'group3');
                if (group === 'group1') group1.push(comp);
                else if (group === 'group2') group2.push(comp);
                else group3.push(comp);
            });

            const dynamicGroupsText = `CÁC CÔNG TY TRONG KCN (Dữ liệu động):\n- Nhóm 1 (Đồng hồ): ${group1.join(', ') || 'Trống'}\n- Nhóm 2 (Hóa đơn): ${group2.join(', ') || 'Trống'}\n- Nhóm 3 (Khoán): ${group3.join(', ') || 'Trống'}\n\n`;

            SYSTEM_CONTEXT = SYSTEM_CONTEXT.replace(/CÁC CÔNG TY TRONG KCN:\s*\(Danh sách công ty sẽ được nạp tự động từ Database\)/, dynamicGroupsText);

            if (conversationHistory.length > 0 && conversationHistory[0].role === "user") {
                conversationHistory[0].parts[0].text = SYSTEM_CONTEXT;
            }
            console.log("🤖 Chatbot AI: Đã tự động học xong danh sách công ty mới nhất từ Database!");
        }

        // Tải và cache danh sách quy chế RAG từ Firestore
        try {
            cachedAIKnowledge = await getAIKnowledgeBase(currentUserRole);
            console.log(`🤖 Chatbot AI: Đã tải và cache ${cachedAIKnowledge.length} tài liệu quy chế (Vai trò: ${currentUserRole}).`);
        } catch (knowledgeErr) {
            console.warn("⚠️ Không thể tải quy chế AI:", knowledgeErr);
        }
    } catch (e) {
        console.error("⚠️ Lỗi tải dữ liệu động cho chatbot:", e);
    }
}

/**
 * Gọi Gemini API để xử lý câu hỏi
 */
export async function getAIResponse(userMessage, contextData = null) {
    const lowerMsg = userMessage.toLowerCase().trim();
    const responses = {
        'giới thiệu': staticResponsesMap['giới thiệu'] || '🏢 Thông tin giới thiệu về Khu công nghiệp.',
        'địa chỉ': staticResponsesMap['địa chỉ'] || '📍 Vui lòng tham khảo thông tin địa chỉ trên trang liên hệ chính thức.',
        'giờ làm việc': staticResponsesMap['giờ làm việc'] || '⏰ Giờ làm việc hành chính từ Thứ 2 đến Thứ 6.',
        'liên hệ hỗ trợ': staticResponsesMap['liên hệ hỗ trợ'] || '📞 Vui lòng liên hệ bộ phận hỗ trợ kỹ thuật để được hỗ trợ.',
        'hỗ trợ': staticResponsesMap['hỗ trợ'] || '📞 Vui lòng liên hệ bộ phận hỗ trợ kỹ thuật để được hỗ trợ.',
        'liên hệ': staticResponsesMap['liên hệ'] || '📞 Vui lòng tham khảo thông tin liên hệ chính thức.',
        'xin chào': auth.currentUser ? WELCOME_MESSAGE_MEMBER : WELCOME_MESSAGE_GUEST,
        'hello': 'Hello! Xin chào bạn.',
        'cám ơn': 'Rất vui được giúp bạn! 😊',
        'tạm biệt': 'Tạm biệt! Chúc bạn một ngày tốt lành.',
        'chức năng': auth.currentUser
            ? (staticResponsesMap['chức năng_member'] || 'Hỗ trợ tra cứu thông tin hệ thống (chỉ số, lịch trực, thống kê...).')
            : (staticResponsesMap['chức năng_guest'] || 'Trợ lý ảo hỗ trợ tìm hiểu thông tin cơ bản về Khu công nghiệp. Vui lòng đăng nhập để tra cứu số liệu kỹ thuật.'),
    };

    for (const [key, value] of Object.entries(responses)) {
        if (lowerMsg.includes(key)) {
            conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });
            conversationHistory.push({ role: 'model', parts: [{ text: value }] });
            if (conversationHistory.length > 14) {
                conversationHistory = [
                    conversationHistory[0],
                    conversationHistory[1],
                    ...conversationHistory.slice(-12)
                ];
            }
            return value;
        }
    }

    if (!isValidAPIKey) {
        console.warn('⚠️ Gemini API key chưa được cấu hình. Sử dụng chế độ fallback.');
        if (typeof document !== 'undefined') {
            const aiStatusEl = document.getElementById('aiStatus');
            if (aiStatusEl) {
                aiStatusEl.textContent = '(Chế độ cơ bản)';
                aiStatusEl.title = 'Chưa cấu hình API Key. Chatbot hoạt động ở Chế độ cơ bản.';
                aiStatusEl.style.color = '#ffa500';
            }
        }
        return getFallbackResponse(userMessage, contextData);
    }

    try {
        let enhancedMessage = userMessage;
        if (contextData) {
            if (contextData.rag_knowledge && contextData.rag_knowledge.length > 0) {
                const knowledgeText = contextData.rag_knowledge.map(k => `Tiêu đề: ${k.title}\nNội dung: ${k.content}`).join('\n---\n');
                enhancedMessage = `${userMessage}\n\n[Tài liệu quy chế tham khảo chính thức:\n${knowledgeText}\n(GHI CHÚ DÀNH CHO AI: Hệ thống đã tự động hiển thị nguồn tham khảo bên dưới câu trả lời rồi, vì vậy AI TUYỆT ĐỐI KHÔNG ĐƯỢC trích dẫn nguồn hay ghi chú "Nguồn tham khảo" ở cuối câu trả lời của mình nữa)]`;
            } else {
                enhancedMessage = `${userMessage}\n\n[Dữ liệu hệ thống: ${JSON.stringify(contextData)}]`;
            }
        }


        // LƯU VÀO HISTORY: CHỈ lưu tin nhắn gốc (không kèm contextData JSON)
        // Điều này ngăn payload phình to sau mỗi lượt hỏi
        conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });

        // Tạo payload riêng để gửi (kèm contextData nếu có), không ảnh hưởng history
        const historyToSend = [
            ...conversationHistory.slice(0, -1), // Tất cả trước tin hiện tại
            { role: 'user', parts: [{ text: enhancedMessage }] } // Tin hiện tại kèm data
        ];

        let data = null;

        if (USE_PROXY) {
            // ========== GỌI PROXY - CHỈ 1 LẦN ==========
            // Toàn bộ logic model fallback + exponential backoff retry
            // đã được xử lý ở phía Google Apps Script server.
            // Client không cần retry, giảm tải băng thông và tránh lỗi quota lan rộng.
            const currentUser = auth.currentUser;
            if (!currentUser) {
                return "⚠️ Bạn cần **đăng nhập** để sử dụng đầy đủ tính năng của trợ lý ảo AI Chatbot (hỏi đáp tự do, tra cứu số liệu...).";
            }
            const idToken = await currentUser.getIdToken();

            const formData = new URLSearchParams();
            formData.append("action", "chatAI");
            formData.append("idToken", idToken);
            formData.append("data", JSON.stringify({
                model: PREFERRED_MODEL,
                contents: historyToSend  // Gửi payload có data, không phải history gốc
            }));

            const response = await fetch(PROXY_URL, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            data = await response.json();

            if (data.error || data.success === false) {
                const errDetail = typeof data.error === 'object'
                    ? (data.error.message || JSON.stringify(data.error))
                    : (data.error || 'Lỗi không xác định');
                throw new Error(errDetail);
            }

            console.log('✅ Gọi thành công qua Proxy');

        } else {
            // ========== GỌI TRỰC TIẾP (USE_PROXY = false, local dev) ==========
            const payload = {
                contents: conversationHistory,
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 768
                }
            };
            let lastStatus = null;

            for (const base of GEMINI_API_BASES) {
                for (const model of GEMINI_MODELS) {
                    const url = `${buildGeminiUrl(base, model)}?key=${encodeURIComponent(GEMINI_API_KEY)}`;
                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    lastStatus = resp.status;
                    if (!resp.ok) {
                        if (resp.status === 429 || resp.status === 503) break;
                        continue;
                    }
                    data = await resp.json();
                    if (data) break;
                }
                if (data) break;
            }

            if (!data) {
                throw new Error(`API Error: ${lastStatus || 'unknown'}`);
            }
        }

        const parts = data?.candidates?.[0]?.content?.parts;
        let aiResponseRaw = parts && parts.length
            ? parts.map(p => p.text).join('\n')
            : 'Xin lỗi, tôi chưa có câu trả lời cho câu hỏi này.';

        // LƯU VÀO HISTORY BẢN GỐC (Tránh việc AI học lõm nguồn trích dẫn ở các lượt sau)
        conversationHistory.push({ role: 'model', parts: [{ text: aiResponseRaw }] });

        let finalAiResponse = aiResponseRaw;

        // Đính kèm nguồn trích dẫn nếu sử dụng RAG
        if (contextData && contextData.rag_knowledge && contextData.rag_knowledge.length > 0) {
            const sources = contextData.rag_knowledge.map(k => {
                const titlePart = `**${k.title}**`;
                if (k.sourceUrl) {
                    return `KCN - [${titlePart}](${k.sourceUrl})`;
                }
                return `KCN - ${titlePart}`;
            }).join(', ');
            finalAiResponse += `\n\n<span style="font-size: 11px; color: #64748b; display: block; margin-top: 10px; font-style: italic;">(Nguồn tham khảo: ${sources}) - AI tổng hợp</span>`;
        } else {
            // Chú thích chung cho câu trả lời tự do của AI
            finalAiResponse += `\n\n<span style="font-size: 11px; color: #888; display: block; margin-top: 10px; font-style: italic;">✨ Ý kiến phân tích/gợi ý của trợ lý AI - Vui lòng đối soát lại số liệu thực tế.</span>`;
        }


        if (typeof document !== 'undefined') {
            const aiStatusEl = document.getElementById('aiStatus');
            if (aiStatusEl) {
                aiStatusEl.textContent = '(AI)';
                aiStatusEl.title = 'Chatbot đang sử dụng Google Gemini AI';
                aiStatusEl.style.color = '#00ff00';
            }
        }

        // Giới hạn history: System prompt + Welcome + 6 lượt gần nhất (= 14 entries)
        // Payload nhỏ hơn → ít token hơn → ít tốn quota hơn
        if (conversationHistory.length > 14) {
            conversationHistory = [
                conversationHistory[0], // System context
                conversationHistory[1], // Initial response
                ...conversationHistory.slice(-12) // 6 lượt hội thoại gần nhất
            ];
        }


        return finalAiResponse;

    } catch (error) {
        console.error('Gemini AI Error:', error);
        if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
            conversationHistory.pop();
        }
        if (typeof document !== 'undefined') {
            const aiStatusEl = document.getElementById('aiStatus');
            if (aiStatusEl) {
                aiStatusEl.textContent = '(Chế độ cơ bản)';
                aiStatusEl.title = 'Hệ thống AI đang quá tải hoặc gặp lỗi. Đang chạy ở Chế độ cơ bản.';
                aiStatusEl.style.color = '#ffa500';
            }
        }
        return getFallbackResponse(userMessage, contextData, error.message);
    }
}

/**
 * Fallback response khi không có API key hoặc API lỗi
 */
function getFallbackResponse(userMessage, contextData, errorMessage = null) {
    const lowerMsg = userMessage.toLowerCase();

    let errorNotice = "";
    if (errorMessage) {
        errorNotice = `*(Hệ thống AI đang bận: ${errorMessage})*\n\n`;
    }

    if (contextData) {
        let responseText = `📊 **Kết quả tra cứu (Chế độ cơ bản):**\n${errorNotice}`;

        if (contextData.rag_knowledge) {
            let ragText = `📖 **Tra cứu quy chế (Chế độ cơ bản):**\n${errorNotice}`;
            contextData.rag_knowledge.forEach(k => {
                ragText += `\n**${k.title}**:\n${k.content}\n`;
            });
            return ragText;
        }

        if (contextData.companyData) {
            const data = contextData.companyData;
            responseText += `- Công ty: **${data.company}**\n`;
            responseText += `- Chỉ số ĐH hiện tại: **${data.chi_so_dong_ho_hien_tai.toLocaleString('vi-VN')}** (ngày ${data.ngay_ghi_hien_tai})\n`;
            return responseText;
        }

        if (contextData.calculatedSchedule) {
            responseText += `Lịch làm việc ngày ${contextData.targetDate || "được yêu cầu"}:\n👉 **${contextData.calculatedSchedule}**`;
            return responseText;
        }

        if (contextData.companyList) {
            const list = contextData.companyList;
            responseText += `Hiện tại có **${list.total}** công ty trong KCN, được chia thành 3 nhóm:\n`;
            responseText += `- **Nhóm 1 (Đồng hồ):** ${list.group1.length} công ty${list.group1.length > 0 ? ` gồm ${list.group1.join(', ')}` : ''}\n`;
            responseText += `- **Nhóm 2 (Hóa đơn):** ${list.group2.length} công ty${list.group2.length > 0 ? ` gồm ${list.group2.join(', ')}` : ''}\n`;
            responseText += `- **Nhóm 3 (Khoán):** ${list.group3.length} công ty${list.group3.length > 0 ? ` gồm ${list.group3.join(', ')}` : ''}\n`;
            return responseText;
        }

        if (contextData.advancedStats) {
            const stats = contextData.advancedStats;
            responseText += `📌 **${stats.periodLabel}**\n\n`;
            if (stats.companyData) {
                const d = stats.companyData;
                if (!d.hasData) return responseText + `⚠️ Công ty **${d.company}** bị thiếu chỉ số mốc đầu kỳ (${d.startMark}), không thể tính toán.`;
                responseText += `- Công ty: **${d.company}**\n`;
                responseText += `- Tổng lưu lượng: **${d.total.toLocaleString('vi-VN')} m³**\n`;
                if (d.avg !== null) responseText += `- Trung bình: **${d.avg.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} m³/ngày** (Tính trên ${d.workingDays} ngày làm việc)\n`;
                if (d.quota !== null) responseText += `- Khối lượng khoán: **${d.quota.toLocaleString('vi-VN')} m³**\n`;
            } else if (stats.tong_luong_xa_thai_kcn !== undefined) {
                responseText += `- Tổng KCN: **${stats.tong_luong_xa_thai_kcn.toLocaleString('vi-VN')} m³** (Từ ${stats.so_cong_ty_co_du_lieu} công ty)\n\n`;
                if (stats.topConsumers && stats.topConsumers.length > 0) {
                    responseText += `🏆 **Top xả thải nhiều nhất:**\n`;
                    stats.topConsumers.forEach((c, i) => { responseText += `${i + 1}. **${c.company}**: ${c.total.toLocaleString('vi-VN')} m³\n`; });
                }
            }
            return responseText;
        }

        if (contextData.holidays) {
            const hols = contextData.holidays;
            if (contextData.company && contextData.defaultHolidayConfig) {
                responseText += `**Cấu hình nghỉ định kỳ của ${contextData.company}:** ${contextData.defaultHolidayConfig}\n\n`;
            } else if (contextData.allDefaultHolidays) {
                const dayMap = { 'sat_sun': 'Thứ 7 & Chủ nhật', 'sat-sun': 'Thứ 7 & Chủ nhật', 'sun_only': 'Chủ nhật', 'sun': 'Chủ nhật', 'sat': 'Thứ 7' };
                responseText += `**Cấu hình nghỉ định kỳ các công ty:**\n`;
                let hasDefault = false;
                for (const [comp, config] of Object.entries(contextData.allDefaultHolidays)) {
                    if (config && config !== 'none') {
                        let displayVal = dayMap[config] || config;
                        responseText += displayVal === 'Không nghỉ'
                            ? `- **${comp}**: Không nghỉ (làm việc full tuần)\n`
                            : `- **${comp}**: Nghỉ ${displayVal}\n`;
                        hasDefault = true;
                    }
                }
                if (!hasDefault) responseText += `- Không có cấu hình ngày nghỉ hàng tuần mặc định nào được thiết lập.\n`;
                responseText += `\n`;
            }

            if (hols.length === 0) {
                responseText += "Không có báo cáo thông báo nghỉ lễ/đột xuất nào trong khoảng thời gian được tra cứu.";
            } else {
                responseText += `Danh sách **${hols.length}** thông báo nghỉ lễ/đột xuất:\n`;
                hols.forEach(h => {
                    const parts = h.date.split('-');
                    const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : h.date;
                    responseText += `- **${h.company}**: Ngày ${displayDate} (${h.ghi_chu || 'Không có ghi chú'})\n`;
                });
            }
            return responseText;
        }

        return "Dữ liệu tra cứu thành công, nhưng chế độ cơ bản chưa hỗ trợ định dạng hiển thị cho loại thông tin này.";
    }

    const responses = {
        'giới thiệu': staticResponsesMap['giới thiệu'] || '🏢 Thông tin giới thiệu về Khu công nghiệp.',
        'địa chỉ': staticResponsesMap['địa chỉ'] || '📍 Vui lòng tham khảo thông tin địa chỉ trên trang liên hệ chính thức.',
        'giờ làm việc': staticResponsesMap['giờ làm việc'] || '⏰ Giờ làm việc hành chính từ Thứ 2 đến Thứ 6.',
        'liên hệ hỗ trợ': staticResponsesMap['liên hệ hỗ trợ'] || '📞 Vui lòng liên hệ bộ phận hỗ trợ kỹ thuật để được hỗ trợ.',
        'hỗ trợ': staticResponsesMap['hỗ trợ'] || '📞 Vui lòng liên hệ bộ phận hỗ trợ kỹ thuật để được hỗ trợ.',
        'liên hệ': staticResponsesMap['liên hệ'] || '📞 Vui lòng tham khảo thông tin liên hệ chính thức.',
        'xin chào': auth.currentUser ? WELCOME_MESSAGE_MEMBER : WELCOME_MESSAGE_GUEST,
        'hello': 'Hello! Xin chào bạn.',
        'cám ơn': 'Rất vui được giúp bạn! 😊',
        'tạm biệt': 'Tạm biệt! Chúc bạn một ngày tốt lành.',
        'chức năng': auth.currentUser
            ? (staticResponsesMap['chức năng_member'] || 'Hỗ trợ tra cứu thông tin hệ thống (chỉ số, lịch trực, thống kê...).')
            : (staticResponsesMap['chức năng_guest'] || 'Trợ lý ảo hỗ trợ tìm hiểu thông tin cơ bản về Khu công nghiệp. Vui lòng đăng nhập để tra cứu số liệu kỹ thuật.'),
    };

    for (const [key, value] of Object.entries(responses)) {
        if (lowerMsg.includes(key)) return value;
    }

    let fallbackMsg = `⚠️ **Hệ thống AI đang tạm thời gián đoạn.**\n\nTôi đang ở chế độ cơ bản và chưa hiểu câu hỏi này.\n\nBạn có thể thử hỏi các câu tra cứu dữ liệu ngắn gọn hơn (VD: *"Chỉ số của NTSF"*, *"Có bao nhiêu công ty"*).`;
    if (errorMessage) {
        fallbackMsg += `\n\n*(Chi tiết lỗi hệ thống: ${errorMessage})*`;
    }
    return fallbackMsg;
}

/**
 * Tìm kiếm mờ trong quy chế/kiến thức AI được cache
 */
export function searchAIKnowledge(queryText) {
    // Lọc danh sách quy chế theo quyền truy cập của vai trò người dùng hiện tại
    const allowedKnowledge = cachedAIKnowledge.filter(item => {
        const itemTarget = item.targetGroup || "user";
        if (currentUserRole === "admin") return true;
        if (currentUserRole !== "guest") return itemTarget === "guest" || itemTarget === "user";
        return itemTarget === "guest"; // guest
    });

    if (!allowedKnowledge || allowedKnowledge.length === 0) return [];

    const lowerQuery = queryText.toLowerCase().trim();

    // 1. Ưu tiên tìm kiếm chính xác (Exact matching) có chấm điểm (Scoring)
    const scoredMatches = [];

    allowedKnowledge.forEach(item => {
        const title = (item.title || "").toLowerCase();
        const content = (item.content || "").toLowerCase();
        const keywords = (item.keywords || "").toLowerCase();

        let score = 0;

        const keywordMatch = keywords.split(',').some(k => {
            const trimmedKey = k.trim();
            return trimmedKey && (lowerQuery.includes(trimmedKey) || trimmedKey.includes(lowerQuery));
        });

        // Trọng số xếp hạng
        if (keywordMatch) score += 30; // Ưu tiên tuyệt đối: Trúng Keyword do admin cấu hình
        if (title.includes(lowerQuery)) score += 20; // Ưu tiên 2: Xuất hiện trong Tiêu đề
        if (content.includes(lowerQuery)) score += 10; // Ưu tiên 3: Xuất hiện trong Nội dung

        if (score > 0) {
            scoredMatches.push({ item, score });
        }
    });

    if (scoredMatches.length > 0) {
        // Sắp xếp theo điểm số từ cao xuống thấp
        scoredMatches.sort((a, b) => b.score - a.score);
        // GIỚI HẠN TỐI ĐA 3 TÀI LIỆU liên quan nhất để chống quá tải Token
        return scoredMatches.slice(0, 3).map(m => m.item);
    }

    // 2. Nếu không có khớp chính xác, dùng Fuse.js tìm kiếm mờ (Fuzzy matching)
    const FuseConstructor = typeof window !== 'undefined' && window.Fuse ? window.Fuse : (typeof Fuse !== 'undefined' ? Fuse : null);
    if (!FuseConstructor) {
        return [];
    }

    const fuse = new FuseConstructor(allowedKnowledge, {
        keys: [
            { name: 'keywords', weight: 0.6 },
            { name: 'title', weight: 0.3 },
            { name: 'content', weight: 0.1 }
        ],
        threshold: 0.5
    });
    const results = fuse.search(queryText);
    // GIỚI HẠN TỐI ĐA 3 TÀI LIỆU (ưu tiên điểm số phù hợp cao nhất từ Fuse)
    return results.slice(0, 3).map(r => r.item);
}

export function findEmployeeInList(message, nameList) {
    const lowerMsg = message.toLowerCase().trim();
    const cleanMsg = removeAccents(lowerMsg);
    
    let found = [];
    const sortedEmployees = [...nameList].sort((a, b) => b.length - a.length);
    
    for (const emp of sortedEmployees) {
        const lowerEmp = emp.toLowerCase();
        const noAccentEmp = removeAccents(lowerEmp);
        
        // 1. Khớp nguyên tên đầy đủ
        if (lowerMsg.includes(lowerEmp) || cleanMsg.includes(noAccentEmp)) {
            found.push(emp);
            continue;
        }
        
        // 2. Khớp các biến thể viết tắt phổ biến (Họ + Tên, hoặc Tên Lót + Tên)
        const parts = emp.split(/\s+/);
        if (parts.length >= 3) {
            const short1 = removeAccents((parts[parts.length - 2] + " " + parts[parts.length - 1]).toLowerCase()); // hoai viet
            const short2 = removeAccents((parts[0] + " " + parts[parts.length - 1]).toLowerCase()); // truong viet
            const regex1 = new RegExp('\\b' + short1 + '\\b');
            const regex2 = new RegExp('\\b' + short2 + '\\b');
            if (regex1.test(cleanMsg) || regex2.test(cleanMsg)) {
                found.push(emp);
                continue;
            }
        }
        
        // 3. Nếu người dùng gõ từ 2 chữ trở lên và tên nhân viên chứa từ đó (ví dụ: gõ "hoài việt" khớp "Trương Hoài Việt")
        const msgWords = lowerMsg.split(/\s+/);
        if (msgWords.length >= 2) {
            if (lowerEmp.includes(lowerMsg) || noAccentEmp.includes(cleanMsg)) {
                found.push(emp);
                continue;
            }
        }
        
        // 4. Khớp tên gọi riêng lẻ (chữ cuối cùng)
        const lastName = parts[parts.length - 1].toLowerCase();
        const noAccentLastName = removeAccents(lastName);
        const regexLastName = new RegExp('\\b' + noAccentLastName + '\\b');
        if (regexLastName.test(cleanMsg)) {
            if (noAccentLastName === 'duong') {
                const occurrencesMsg = (cleanMsg.match(/\bduong\b/g) || []).length;
                let occurrencesCompany = 0;
                if (cleanMsg.includes('an do duong')) occurrencesCompany++;
                if (cleanMsg.includes('dai tay duong')) occurrencesCompany++;
                
                if (occurrencesMsg > occurrencesCompany) {
                    found.push(emp);
                }
            } else {
                found.push(emp);
            }
        }
    }
    return [...new Set(found)];
}

export function isQueryAmbiguous(message) {
    const lowerMsg = message.toLowerCase().trim();
    
    // Luôn đi AI Router nếu hỏi về nhật ký hệ thống (logs) hoặc hoạt động của nhân sự
    const logKeywords = ['log', 'nhật ký', 'hành động', 'hoạt động', 'vết', 'dấu vết', 'lịch sử hoạt động', 'lịch sử thao tác'];
    if (logKeywords.some(kw => lowerMsg.includes(kw))) {
        return true;
    }
    
    // 1. Chỉ đi local nếu chứa TÊN ĐẦY ĐỦ CHÍNH XÁC của nhân sự đang hoạt động
    if (employeeNamesList.length > 0) {
        const hasFullActiveEmployee = employeeNamesList.some(emp => {
            return lowerMsg.includes(emp.toLowerCase());
        });
        if (hasFullActiveEmployee) {
            const wordCount = lowerMsg.split(/\s+/).length;
            if (wordCount <= 3) return true; // Câu hỏi quá ngắn vẫn cần AI Router
            return false;
        }
    }
    
    // 2. Chỉ đi local nếu chứa TÊN ĐẦY ĐỦ CHÍNH XÁC của công ty
    if (typeof companyNameMap !== 'undefined' && companyNameMap) {
        const uniqueComps = [...new Set(Object.values(companyNameMap))];
        const hasFullCompany = uniqueComps.some(comp => {
            return lowerMsg.includes(comp.toLowerCase());
        });
        if (hasFullCompany) {
            const wordCount = lowerMsg.split(/\s+/).length;
            if (wordCount <= 3) return true; // Câu hỏi quá ngắn vẫn cần AI Router
            return false;
        }
    }
    
    // Bỏ qua các câu lệnh nút bấm hoặc câu lệnh cố định rõ ràng (luôn chạy local)
    const unambiguousCommands = [
        'xem lịch trực tuần này', 'danh sách ca trực hôm nay', 'lịch trực hôm nay',
        'tổng xả thải tháng này', 'xem từng công ty', 'chỉ số nước', 'quy trình ghi chỉ số',
        'lịch nghỉ', 'quy định nghỉ phép', 'danh sách vượt khoán', 'quy định xử phạt vượt khoán',
        'xem lịch trực của', 'đúng, xem thông tin', 'không, xem danh sách công ty',
        'chỉ số mới nhất của', 'lịch sử xả thải', 'lịch nghỉ của'
    ];
    if (unambiguousCommands.some(cmd => lowerMsg.includes(cmd))) {
        return false;
    }
    
    // Mọi trường hợp khác (viết tắt, gõ thiếu, mơ hồ, nhân sự nghỉ việc...) -> Đi AI Router xử lý thông minh
    return true;
}

/**
 * Sử dụng Gemini làm bộ định tuyến ý định (Intent Router) khi câu hỏi mơ hồ
 */
export async function routeIntentWithAI(message, history) {
    try {
        const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        if (!idToken) {
            console.warn("👤 AI Router: Người dùng chưa đăng nhập, không gọi AI Router");
            return null;
        }

        // Tạo context động danh sách công ty và nhân viên
        const compsList = [...new Set(Object.values(companyNameMap))].join(', ');
        const empsList = employeeNamesList.join(', ');
        const allEmpsList = allEmployeeNamesList.join(', ');
        const todayStr = new Date().toISOString().split('T')[0]; // Định dạng YYYY-MM-DD
        const todayLocale = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });

        const routerPrompt = `Bạn là bộ định tuyến ý định (Intent Router) của hệ thống Quản lý KCN Thốt Nốt. 
Nhiệm vụ của bạn là phân loại câu hỏi của người dùng và trích xuất các thực thể (Entity) dưới dạng JSON.

THỜI GIAN HỆ THỐNG HIỆN TẠI (RẤT QUAN TRỌNG):
- Hôm nay là: ${todayLocale} (Định dạng YYYY-MM-DD là: ${todayStr})
- Hãy sử dụng ngày này làm mốc để quy đổi các mốc thời gian tương đối như "hôm nay", "ngày mai", "hôm qua", "tuần này", "tuần tới", "24/7", "ngày 24/7",... sang ngày cụ thể YYYY-MM-DD.
- Năm mặc định luôn là năm của ngày hệ thống hiện tại (${new Date().getFullYear()}). Không được tự ý giả định năm khác.

DANH SÁCH Ý ĐỊNH (intents):
1. 'companyData': Tra cứu chỉ số nước/đồng hồ xả thải mới nhất của 1 công ty.
2. 'history': Xem lịch sử, nhật ký xả thải của 1 công ty.
3. 'statistics': Thống kê lưu lượng xả thải toàn KCN (tuần/tháng/kỳ hiện tại).
4. 'holidayData': Lịch nghỉ phép, ngày nghỉ của công ty/doanh nghiệp.
5. 'specialWorkday': Lịch làm việc đặc biệt, làm bù ngày nghỉ của công ty.
6. 'companyList': Xem danh sách các công ty trong KCN.
7. 'autoplan': Lịch trực chung KCN (ai trực ngày gác hôm nay/ngày mai).
8. 'personal_schedule': Lịch trực/làm việc/ca trực của một nhân viên cụ thể.
9. 'comparison': So sánh lượng nước xả thải/tiêu thụ giữa các công ty hoặc giữa các khoảng thời gian.
10. 'system_logs': Tra cứu nhật ký hệ thống, log hành động, lịch sử thao tác của nhân sự (kể cả nhân sự đã bị xóa/đã nghỉ như Tạ Minh Ngô, Trương Hoài Việt) hoặc hoạt động trong một ngày cụ thể (ví dụ: "Trần Nguyễn Dương đã hành động gì ngày 23/7", "Trương Hoài Việt có hành động cuối ngày nào", "Tạ Minh Ngô đã làm những gì").
11. 'clarify': Ý định mơ hồ, trùng khớp nhiều hơn một công ty hoặc nhân sự (ví dụ: gõ "Dương" vừa có thể là "Ấn Độ Dương", "Đại Tây Dương", hoặc "Trần Nguyễn Dương").
12. 'chat': Chào hỏi, trò chuyện tự do hoặc câu hỏi không liên quan tới dữ liệu KCN.

DANH SÁCH CÔNG TY TRÊN HỆ THỐNG: [ ${compsList} ]
DANH SÁCH NHÂN SỰ ĐANG LÀM VIỆC: [ ${empsList} ]
DANH SÁCH TOÀN BỘ NHÂN SỰ (CẢ NGƯỜI ĐÃ NGHỈ): [ ${allEmpsList} ]

HÃY PHÂN TÍCH TIN NHẮN SAU VÀ TRẢ VỀ ĐẦU RA JSON:
Tin nhắn: "${message}"

Cấu trúc JSON bắt buộc phải trả về:
{
  "intent": "tên_ý_định",
  "companies": ["tên_công_ty_đầy_đủ_trong_hệ_thống"], // mảng chứa các công ty được nhắc đến (nếu có)
  "employee": "tên_nhân_sự_đầy_đủ_trong_hệ_thống", // tên nhân sự đầy đủ chính xác lấy từ DANH SÁCH TOÀN BỘ NHÂN SỰ
  "timeframe": "week" | "month" | "billing" | "year", // mặc định là "billing"
  "targetDateExact": "YYYY-MM-DD", // ngày cụ thể được nhắc đến (nếu có)
  "isInactiveEmployee": true | false, // Đặt thành true NẾU tên nhân sự này KHÔNG CÓ trong DANH SÁCH NHÂN SỰ ĐANG LÀM VIỆC
  "candidates": ["tên_đối_tượng_1", "tên_đối_tượng_2"] // Chỉ điền trường này nếu intent là 'clarify'. Chứa danh sách các công ty hoặc nhân sự trong hệ thống có thể trùng khớp với từ khóa mơ hồ mà người dùng gõ.
}

Chú ý:
- Nếu người dùng viết tắt, gõ thiếu hoặc gõ không dấu tên nhân sự (ví dụ: "hoài việt" -> "Trương Hoài Việt", "Nguyễn Dương" -> "Trần Nguyễn Dương", "đông" -> "Lê Lâm Đông"), bạn phải ánh xạ về tên đầy đủ chính xác tương ứng trong DANH SÁCH TOÀN BỘ NHÂN SỰ (CẢ NGƯỜI ĐÃ NGHỈ).
- Nếu người dùng hỏi về lịch trực/lịch làm của một người không nằm trong DANH SÁCH NHÂN SỰ ĐANG LÀM VIỆC (ví dụ: Tạ Minh Ngô, Trương Hoài Việt), hãy bắt buộc đặt intent là "personal_schedule", điền tên đầy đủ của họ từ DANH SÁCH TOÀN BỘ NHÂN SỰ vào trường "employee" và đặt "isInactiveEmployee": true.
- Nếu người dùng hỏi về hoạt động, log hành động, thao tác, lịch sử thao tác của nhân sự (kể cả nhân sự cũ/đã bị xóa như Tạ Minh Ngô), hãy bắt buộc đặt intent là "system_logs", điền tên của nhân sự đó vào trường "employee".
- Nếu người dùng chỉ nhập tên của một nhân sự (ví dụ: "Nguyễn Dương", "Trần Nguyễn Dương", "Trần Dương") mà không ghi kèm hành động hay động từ nào khác, hãy bắt buộc đặt ý định là "personal_schedule" và điền trường "employee" với tên đầy đủ của nhân sự đó trong hệ thống.
- Hãy trả về DUY NHẤT một chuỗi JSON hợp lệ nằm trong thẻ \`\`\`json ... \`\`\`. Không viết bất kỳ lời giải thích nào khác.`;

        const payload = [
            { role: "user", parts: [{ text: routerPrompt }] }
        ];

        // Gọi qua Proxy
        const formData = new URLSearchParams();
        formData.append("action", "chatAI");
        formData.append("idToken", idToken);
        formData.append("data", JSON.stringify({
            model: PREFERRED_MODEL,
            contents: payload
        }));

        const response = await fetch(PROXY_URL, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) return null;
        const resData = await response.json();
        
        const textResponse = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResponse) return null;

        console.log("🔍 AI Router Response Raw:", textResponse);
        const jsonMatch = textResponse.match(/```json\s*([\s\S]*?)\s*```/) || textResponse.match(/({[\s\S]*})/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1].trim());
            console.log("🎯 AI Router Parsed Intent:", parsed);
            return parsed;
        }
        return null;
    } catch (e) {
        console.error("❌ Lỗi gọi AI Router:", e);
        return null;
    }
}

/**
 * Kiểm tra xem câu hỏi có cần truy vấn database không
 */
export function detectDataQuery(message) {
    const lowerMsg = message.toLowerCase().trim();

    // Kiểm tra xem tin nhắn có chứa tên nhân viên nào không
    let matchingEmployees = [];
    if (employeeNamesList.length > 0) {
        const cleanMsg = removeAccents(lowerMsg);
        for (const emp of employeeNamesList) {
            const lowerEmp = emp.toLowerCase();
            const noAccentEmp = removeAccents(lowerEmp);
            
            // 1. Khớp nguyên tên
            if (lowerMsg.includes(lowerEmp) || cleanMsg.includes(noAccentEmp)) {
                matchingEmployees.push(emp);
                continue;
            }
            
            // 2. Khớp các biến thể rút gọn (ví dụ: Trần Nguyễn Dương -> Nguyễn Dương, Trần Dương)
            const parts = emp.split(/\s+/);
            if (parts.length >= 3) {
                const short1 = removeAccents((parts[parts.length - 2] + " " + parts[parts.length - 1]).toLowerCase()); // nguyen duong
                const short2 = removeAccents((parts[0] + " " + parts[parts.length - 1]).toLowerCase()); // tran duong
                const regex1 = new RegExp('\\b' + short1 + '\\b');
                const regex2 = new RegExp('\\b' + short2 + '\\b');
                if (regex1.test(cleanMsg) || regex2.test(cleanMsg)) {
                    matchingEmployees.push(emp);
                    continue;
                }
            }
            
            // 3. Khớp tên gọi riêng (chữ cuối cùng)
            const lastName = parts[parts.length - 1].toLowerCase();
            const noAccentLastName = removeAccents(lastName);
            const regexLastName = new RegExp('\\b' + noAccentLastName + '\\b');
            if (regexLastName.test(cleanMsg)) {
                if (noAccentLastName === 'duong') {
                    const occurrencesMsg = (cleanMsg.match(/\bduong\b/g) || []).length;
                    let occurrencesCompany = 0;
                    if (cleanMsg.includes('an do duong')) occurrencesCompany++;
                    if (cleanMsg.includes('dai tay duong')) occurrencesCompany++;
                    if (occurrencesMsg > occurrencesCompany) {
                        matchingEmployees.push(emp);
                    }
                } else {
                    matchingEmployees.push(emp);
                }
            }
        }
        matchingEmployees = [...new Set(matchingEmployees)];
    }

    if (matchingEmployees.length > 1) {
        return {
            type: 'employee_multiple',
            query: message,
            employees: matchingEmployees
        };
    }

    const foundEmployee = matchingEmployees.length === 1 ? matchingEmployees[0] : null;

    // Các từ khóa chỉ định câu hỏi dạng Quy chế/Kiến thức/Hướng dẫn (RAG) rõ ràng
    const informationalKeywords = [
        'quy định', 'quy chế', 'tiêu chuẩn', 'phạt', 'cách pha', 'quy trình',
        'hướng dẫn', 'định nghĩa', 'là gì', 'thế nào', 'làm sao', 'liên hệ',
        'địa chỉ', 'giờ làm', 'chức năng', 'hỗ trợ'
    ];

    const strongInformationalKeywords = [
        'là gì', 'định nghĩa', 'cách pha', 'nguyên lý', 'vì sao', 'tại sao',
        'ý nghĩa', 'có tác dụng gì', 'như thế nào', 'khái niệm'
    ];

    const isInformational = informationalKeywords.some(kw => lowerMsg.includes(kw));
    const isStrongInformational = strongInformationalKeywords.some(kw => lowerMsg.includes(kw));

    // 0. Kiểm tra câu hỏi quá ngắn gây ngờ vực
    const wordCount = lowerMsg.split(/\s+/).length;
    if (wordCount <= 4) {
        if (lowerMsg === 'xả thải' || lowerMsg === 'nước thải' || lowerMsg === 'lưu lượng' || lowerMsg === 'số liệu') {
            return {
                type: 'ambiguous',
                query: message,
                message: 'Ý bạn muốn tra cứu số liệu thống kê hay xem quy định về xả thải?',
                options: [
                    { label: '📊 Tra cứu Số liệu', query: 'Thống kê xả thải' },
                    { label: '📖 Xem Quy định xả thải', query: 'Quy định xả thải' }
                ]
            };
        }
        if (lowerMsg === 'lịch trực' || lowerMsg === 'trực' || lowerMsg === 'ca trực') {
            return {
                type: 'ambiguous',
                query: message,
                message: 'Ý bạn muốn xem lịch phân công trực hay xem quy chế tổ chức ca trực?',
                options: [
                    { label: '📅 Xem Lịch trực hôm nay', query: 'Lịch trực hôm nay' },
                    { label: '📖 Xem Quy định trực', query: 'Quy định ca trực' }
                ]
            };
        }
        if (lowerMsg === 'chỉ số' || lowerMsg === 'số nước' || lowerMsg === 'ghi nước' || lowerMsg === 'đồng hồ') {
            return {
                type: 'ambiguous',
                query: message,
                message: 'Ý bạn muốn tra cứu chỉ số nước hiện tại của một nhà máy hay tìm hiểu cách ghi chỉ số?',
                options: [
                    { label: '💧 Tra cứu Chỉ số nước', query: 'Chỉ số nước' },
                    { label: '📖 Quy trình ghi chỉ số', query: 'Quy trình ghi chỉ số' }
                ]
            };
        }
        if (lowerMsg === 'nghỉ' || lowerMsg === 'ngày nghỉ' || lowerMsg === 'lịch nghỉ' || lowerMsg === 'phép') {
            return {
                type: 'ambiguous',
                query: message,
                message: 'Ý bạn muốn kiểm tra lịch nghỉ phép của KCN hay quy định về ngày nghỉ?',
                options: [
                    { label: '📅 Lịch nghỉ phép KCN', query: 'Lịch nghỉ' },
                    { label: '📖 Quy định nghỉ phép', query: 'Quy định nghỉ phép' }
                ]
            };
        }
        if (lowerMsg === 'phạt' || lowerMsg === 'vượt khoán') {
            return {
                type: 'ambiguous',
                query: message,
                message: 'Ý bạn muốn xem danh sách các đơn vị vượt khoán tháng này hay xem quy định phạt?',
                options: [
                    { label: '📊 Danh sách vượt khoán', query: 'Danh sách vượt khoán' },
                    { label: '📖 Quy định xử phạt', query: 'Quy định xử phạt vượt khoán' }
                ]
            };
        }
    }

    // 1. Nếu chứa từ khóa RAG rõ ràng -> Ưu tiên quét quy chế RAG trước tiên
    if (isInformational && cachedAIKnowledge && cachedAIKnowledge.length > 0) {
        const matches = searchAIKnowledge(message);
        if (matches && matches.length > 0) {
            return { type: 'rag_knowledge', query: message };
        }
    }

    // NẾU CHỨA CÁC TỪ KHÓA LÝ THUYẾT MẠNH (như "là gì", "tại sao") MÀ RAG KHÔNG CÓ,
    // TUYỆT ĐỐI không phân luồng xuống các bộ tra cứu Database (tránh bắt nhầm từ khóa).
    if (isStrongInformational) {
        return null; // Bàn giao hoàn toàn cho AI dùng kiến thức Internet tự trả lời
    }


    let isCompanyRelatedHolidayOrWorkday = false;
    if (lowerMsg.includes('lịch làm việc') || lowerMsg.includes('ngày làm việc') || lowerMsg.includes('lịch nghỉ') || lowerMsg.includes('ngày nghỉ') || lowerMsg.includes('nghỉ')) {
        const hasCompanyWord = lowerMsg.includes('công ty') || lowerMsg.includes('doanh nghiệp');
        let hasCompanyName = false;
        for (const lowerName of Object.keys(companyNameMap)) {
            if (lowerMsg.includes(lowerName)) { hasCompanyName = true; break; }
        }
        if (hasCompanyWord || hasCompanyName) isCompanyRelatedHolidayOrWorkday = true;
    }

    const patterns = [
        {
            type: 'comparison',
            customCheck: (msg) => {
                const keywords = [
                    'so sánh', 'khác biệt', 'khác nhau', 'chênh lệch', 'hơn kém',
                    'nhiều hơn', 'ít hơn', 'cao hơn', 'thấp hơn'
                ];
                if (keywords.some(kw => msg.includes(kw))) {
                    const isFlowRelated = [
                        'xả', 'dùng', 'tiêu thụ', 'nước', 'chỉ số', 'lưu lượng', 'khối', 'm3', 'm³'
                    ].some(kw => msg.includes(kw));
                    if (isFlowRelated) return true;
                }
                return false;
            }
        },
        {
            type: 'statistics',
            customCheck: (msg) => {
                const direct = [
                    'thống kê lưu lượng', 'thống kê xả thải', 'thống kê nước',
                    'báo cáo lưu lượng', 'báo cáo xả thải', 'báo cáo nước',
                    'tổng xả', 'tổng dùng', 'tổng lưu lượng', 'tổng lượng nước', 'tổng khối',
                    'trung bình xả', 'trung bình dùng', 'trung bình lưu lượng', 'trung bình nước',
                    'lưu lượng', 'so sánh lưu lượng', 'so sánh xả thải', 'nhiều nhất', 'top',
                    'vượt khoán', 'mức khoán', 'sản lượng khoán',
                    'bao nhiêu khối', 'mét khối', 'm3', 'm³', 'số khối', 'cbm',
                    'lượng xả', 'lượng nước thải', 'lượng tiêu thụ', 'lượng nước', 'lượng dùng',
                    'nước xả ra', 'nước thoát'
                ];
                if (direct.some(kw => msg.includes(kw))) return true;
                if ((msg.includes('xả') || msg.includes('tiêu thụ') || msg.includes('thoát')) && (msg.includes('bao nhiêu') || msg.includes('mấy') || msg.includes('nhiều hay ít'))) return true;
                if (msg.includes('dùng') && (msg.includes('bao nhiêu') || msg.includes('mấy') || msg.includes('nhiều hay ít'))) {
                    // Tránh nhầm lẫn "chất khử trùng dùng bao nhiêu" (hỏi về hóa chất)
                    if (msg.includes('nước') || msg.includes('khối') || msg.includes('m3') || msg.includes('m³')) return true;
                }
                const timeShortcuts = [
                    'tuần trước', 'tuần này', 'tháng trước', 'tháng này', 'kỳ trước', 'kỳ này',
                    'tuần rồi', 'tháng rồi', 'kỳ rồi', 'tuần qua', 'tháng qua', 'năm ngoái',
                    'năm nay', 'năm trước', 'kỳ qua', 'đợt này', 'đợt trước', 'kỳ thu phí trước'
                ];
                if (timeShortcuts.some(ts => msg.includes(ts))) {
                    const isOther = msg.includes('trực') || msg.includes('nghỉ') || msg.includes('lễ') || msg.includes('ca') || msg.includes('gác');
                    if (!isOther) return true;
                }
                return false;
            }
        },
        {
            type: 'companyData',
            customCheck: (msg) => {
                const direct = [
                    'chỉ số', 'đồng hồ', 'mới nhất', 'hiện tại', 'mặt đồng hồ', 'số nước',
                    'chỉ số nước', 'số mét khối', 'số m3', 'đồng hồ nước', 'chỉ số mới', 'chỉ số hiện tại',
                    'mặt số', 'số đọc', 'số ghi', 'chỉ số ghi', 'chỉ số cuối', 'số cuối',
                    'số mới', 'số đầu', 'chỉ số đầu', 'ghi nước'
                ];
                if (direct.some(kw => msg.includes(kw))) return true;
                if (msg.includes('bao nhiêu') && (msg.includes('số') || msg.includes('đồng hồ') || msg.includes('ghi'))) return true;
                if (msg.includes('mấy') && (msg.includes('số') || msg.includes('ghi'))) return true;
                const hasCompany = Object.keys(companyNameMap).some(n => msg.includes(n));
                if (hasCompany) {
                    if (msg.includes('số') || msg.includes('chỉ') || msg.includes('ghi') || msg.includes('đồng hồ') || msg.includes('mới nhất') || msg.includes('hiện tại')) return true;
                    const words = msg.split(/\s+/);
                    if (words.length <= 4 || msg.includes('xem') || msg.includes('thông tin') || msg.includes('chi tiết') || msg.includes('tra cứu')) return true;
                }
                return false;
            }
        },
        {
            type: 'holidayData',
            keywords: [
                'ngày nghỉ', 'nghỉ việc', 'holiday', 'nghỉ lễ', 'nghỉ phép', 'ngày lễ', 'lịch nghỉ',
                'thông báo nghỉ', 'nghỉ đột xuất', 'nghỉ công ty', 'được nghỉ',
                'cho nghỉ', 'không đi làm', 'nghỉ ca', 'cúp ca', 'off', 'day off', 'xin nghỉ',
                'báo nghỉ', 'ngưng sản xuất', 'tạm ngưng', 'tạm dừng', 'không làm việc', 'ngừng hoạt động',
                'không chạy máy', 'lịch off', 'ngày off', 'nghỉ chủ nhật', 'không hoạt động'
            ],
            customCheck: (msg) => {
                const direct = [
                    'ngày nghỉ', 'nghỉ việc', 'holiday', 'nghỉ lễ', 'nghỉ phép', 'ngày lễ', 'lịch nghỉ',
                    'thông báo nghỉ', 'nghỉ đột xuất', 'nghỉ công ty', 'được nghỉ',
                    'cho nghỉ', 'không đi làm', 'nghỉ ca', 'cúp ca', 'off', 'day off', 'xin nghỉ',
                    'báo nghỉ', 'ngưng sản xuất', 'tạm ngưng', 'tạm dừng', 'không làm việc', 'ngừng hoạt động',
                    'không chạy máy', 'lịch off', 'ngày off', 'nghỉ chủ nhật', 'không hoạt động'
                ];
                if (direct.some(kw => msg.includes(kw))) return true;
                if ((msg.includes('nghỉ') || msg.includes('off') || msg.includes('ngưng') || msg.includes('dừng')) && (msg.includes('lịch') || msg.includes('ngày') || msg.includes('hôm nay') || msg.includes('ngày mai') || msg.includes('được') || msg.includes('cho') || msg.includes('phép') || msg.includes('báo'))) return true;
                if (msg.includes('không') && (msg.includes('đi làm') || msg.includes('chạy máy') || msg.includes('sản xuất') || msg.includes('hoạt động') || msg.includes('vận hành'))) return true;
                return false;
            }
        },
        {
            type: 'specialWorkday',
            keywords: [
                'ngày làm đặc biệt', 'làm việc đặc biệt', 'làm thêm', 'tăng ca', 'làm bù', 'lịch làm bù',
                'ngày làm bù', 'làm đặc biệt', 'làm chủ nhật', 'tăng ca chủ nhật', 'làm thêm giờ',
                'làm bù lễ', 'đi làm bù', 'chạy máy chủ nhật', 'làm ngày nghỉ',
                'làm ngoài giờ', 'ot', 'overtime', 'chạy bù', 'chạy ngày lễ'
            ]
        },
        {
            type: 'companyList',
            keywords: [
                'danh sách công ty', 'các công ty', 'có bao nhiêu công ty', 'liệt kê công ty',
                'tất cả công ty', 'danh sách doanh nghiệp', 'các doanh nghiệp', 'bao nhiêu doanh nghiệp',
                'có những công ty nào', 'tên công ty', 'nhóm công ty', 'phân nhóm', 'tên các doanh nghiệp',
                'nhà máy nào', 'các nhà máy', 'các đơn vị', 'danh sách đơn vị',
                'bao nhiêu đơn vị', 'những ai', 'gồm những ai', 'bao nhiêu bên',
                'xem từng công ty', 'từng công ty'
            ]
        },
        {
            type: 'history',
            keywords: [
                'lịch sử', 'theo thời gian', 'xu hướng', 'biến động', 'lịch sử xả thải',
                'lịch sử tiêu thụ', 'quá trình', 'quá khứ', 'lịch sử chỉ số', 'biểu đồ',
                'biểu đồ xả thải', 'diễn biến', 'tra cứu lịch sử', 'lịch sử ghi', 'lịch sử đồng hồ',
                'biểu đồ xả', 'biểu đồ lưu lượng', 'đồ thị', 'xu hướng xả', 'dòng thời gian'
            ]
        },
        {
            type: 'autoplan',
            keywords: [
                'autoplan', 'lịch trực', 'quy tắc', 'công việc tự động', 'lịch làm việc', 'job',
                'ai trực', 'ca làm', 'ca trực', 'người trực', 'ca ai', 'ca của ai', 'ai làm',
                'phân công', 'ca kíp', 'lịch ca', 'ai gác', 'gác ca', 'lịch gác', 'kíp trực',
                'phân công kíp', 'lịch bảo vệ', 'vận hành trực', 'lịch vận hành', 'lịch trực vận hành',
                'lịch trực bảo vệ', 'ca gác', 'lịch gác bảo vệ'
            ],
            customCheck: (msg) => {
                if (foundEmployee) return false; // Nhường cho personal_schedule
                
                const direct = [
                    'autoplan', 'lịch trực', 'lịch làm việc', 'ai trực', 'ca làm', 'ca trực',
                    'người trực', 'ca ai', 'ca của ai', 'ai làm', 'phân công', 'ca kíp', 'lịch ca',
                    'ai gác', 'gác ca', 'lịch gác', 'kíp trực', 'phân công kíp', 'lịch bảo vệ'
                ];
                if (direct.some(kw => msg.includes(kw))) return true;
                if ((msg.includes('ca') || msg.includes('kíp') || msg.includes('gác')) && (msg.includes('ai') || msg.includes('nào') || msg.includes('người'))) return true;
                if (msg.includes('trực') && (msg.includes('ai') || msg.includes('nào') || msg.includes('ngày') || msg.includes('hôm nay') || msg.includes('ngày mai'))) return true;
                if (msg.includes('gác') && (msg.includes('hôm nay') || msg.includes('ngày mai') || msg.includes('ngày') || msg.includes('kcn'))) return true;
                return false;
            }
        },
        {
            type: 'personal_schedule',
            customCheck: (msg) => {
                if (foundEmployee) {
                    const cleanMsg = removeAccents(msg).trim();
                    const cleanEmp = removeAccents(foundEmployee.toLowerCase());
                    if (cleanMsg === cleanEmp) return true;
                    
                    const parts = foundEmployee.split(/\s+/);
                    if (parts.length >= 3) {
                        const short1 = removeAccents((parts[parts.length - 2] + " " + parts[parts.length - 1]).toLowerCase()); // nguyen duong
                        const short2 = removeAccents((parts[0] + " " + parts[parts.length - 1]).toLowerCase()); // tran duong
                        if (cleanMsg === short1 || cleanMsg === short2) return true;
                    }
                    const lastName = removeAccents(parts[parts.length - 1].toLowerCase()); // duong
                    if (cleanMsg === lastName) return true;
                    
                    const keywords = ['lịch', 'trực', 'làm', 'ngày nào', 'khi nào', 'ca nào', 'ca trực', 'lịch trực', 'làm việc'];
                    if (keywords.some(kw => msg.includes(kw))) {
                        return true;
                    }
                }
                return false;
            }
        }
    ];

    for (const pattern of patterns) {
        let hasKeyword = false;
        if (pattern.customCheck) {
            hasKeyword = pattern.customCheck(lowerMsg);
        } else if (pattern.keywords) {
            hasKeyword = pattern.keywords.some(kw => lowerMsg.includes(kw));
        }

        if (isCompanyRelatedHolidayOrWorkday) {
            if (pattern.type === 'holidayData') hasKeyword = true;
            else if (pattern.type === 'autoplan') hasKeyword = false;
        }

        if (hasKeyword) {
            const result = { type: pattern.type, query: message };
            if (pattern.type === 'personal_schedule') {
                result.employee = foundEmployee;
                
                const keywords = ['lịch', 'trực', 'làm', 'ngày nào', 'khi nào', 'ca nào', 'ca trực', 'lịch trực', 'làm việc'];
                const hasActKeyword = keywords.some(kw => lowerMsg.includes(kw));
                result.nameOnly = !hasActKeyword;

                const cleanMsg = removeAccents(lowerMsg);
                const fullClean = removeAccents(foundEmployee.toLowerCase());
                result.isExactName = cleanMsg.includes(fullClean);
            }

            const sortedCompanyKeywords = Object.entries(companyNameMap).sort((a, b) => b[0].length - a[0].length);
            let foundExact = false;
            let foundCompanies = [];
            for (const [lowerName, realName] of sortedCompanyKeywords) {
                if (lowerMsg.includes(lowerName)) { 
                    if (!foundCompanies.includes(realName)) {
                        foundCompanies.push(realName);
                    }
                    foundExact = true; 
                }
            }
            if (foundExact) {
                result.company = foundCompanies[0];
                result.companies = foundCompanies;
            }

            if (!foundExact && ['companyData', 'history', 'holidayData', 'comparison'].includes(pattern.type)) {
                const closest = findClosestCompany(message);
                if (closest && closest.score < 0.5) {
                    return {
                        type: 'company_typo',
                        query: message,
                        intendedType: pattern.type,
                        closestCompany: closest.company
                    };
                }
            }

            if (pattern.type === 'statistics' || pattern.type === 'comparison') {
                const specificWeekMatch = lowerMsg.match(/tuần\s*(\d+)/);
                const specificMonthMatch = lowerMsg.match(/tháng\s*(\d+)/);
                const specificYearMatch = lowerMsg.match(/năm\s*(\d{4})/);
                const specificQuarterMatch = lowerMsg.match(/quý\s*(\d+)/);

                if (specificWeekMatch || specificMonthMatch || specificYearMatch || specificQuarterMatch) {
                    result.pastTimeframeRequested = true;
                    result.timeframe = 'billing'; // Fallback to current period
                }

                const isKhoan = lowerMsg.includes('khoán');
                const isKyThuPhi = lowerMsg.includes('kỳ') || lowerMsg.includes('thu phí') || isKhoan;

                if (lowerMsg.includes('năm trước') || lowerMsg.includes('năm ngoái')) {
                    result.timeframe = isKyThuPhi ? 'billing' : 'year';
                    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
                    result.targetDateExact = d.toISOString();
                } else if (lowerMsg.includes('kỳ trước') || lowerMsg.includes('kỳ rồi') || lowerMsg.includes('kỳ qua')) {
                    result.timeframe = 'billing';
                    const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(15);
                    result.targetDateExact = d.toISOString();
                } else if (lowerMsg.includes('tháng trước') || lowerMsg.includes('tháng rồi') || lowerMsg.includes('tháng qua')) {
                    result.timeframe = isKyThuPhi ? 'billing' : 'month';
                    const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(15);
                    result.targetDateExact = d.toISOString();
                } else if (lowerMsg.includes('tuần trước') || lowerMsg.includes('tuần rồi') || lowerMsg.includes('tuần qua')) {
                    result.timeframe = 'week';
                    const d = new Date(); d.setDate(d.getDate() - 7);
                    result.targetDateExact = d.toISOString();
                } else {
                    if (lowerMsg.includes('tuần')) result.timeframe = 'week';
                    else if (isKyThuPhi) result.timeframe = 'billing';
                    else if (lowerMsg.includes('tháng')) result.timeframe = 'month';
                    else if (lowerMsg.includes('năm')) result.timeframe = 'year';
                }

                if (!result.timeframe) result.timeframe = 'billing';
            }

            return result;
        }
    }

    // 2. Fallback: Nếu không khớp ý định hệ thống nào và chưa quét RAG -> Quét RAG làm cứu cánh cuối cùng
    if (!isInformational && cachedAIKnowledge && cachedAIKnowledge.length > 0) {
        const matches = searchAIKnowledge(message);
        if (matches && matches.length > 0) {
            return { type: 'rag_knowledge', query: message };
        }
    }

    return null;
}

export function resetConversation() {
    conversationHistory = [
        { role: "user", parts: [{ text: SYSTEM_CONTEXT }] },
        { role: "model", parts: [{ text: getWelcomeMessage() }] }
    ];
}

export function hasValidAPIKey() {
    return isValidAPIKey;
}

/**
 * Format dữ liệu có cấu trúc thành chuỗi văn bản đẹp — KHÔNG cần gọi AI.
 * Dùng cho mọi truy vấn dữ liệu (statistics, companyData, holidays...).
 * AI chỉ được gọi khi contextData = null (câu hỏi hội thoại thuần tuý).
 */
export function formatDataResponse(contextData, userMessage) {
    if (!contextData) return null; // Không có dữ liệu → để AI xử lý

    // ===== KIỂM TRA CÂU HỎI NGỜ VỰC =====
    if (contextData.ambiguousData) {
        let html = `<p>${contextData.ambiguousData.message}</p><div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
        contextData.ambiguousData.options.forEach(opt => {
            html += `<button class="suggestion-btn" data-query="${opt.query}" style="background: #e2e8f0; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 20px; cursor: pointer; font-size: 13px; color: #334155; font-weight: 500;">${opt.label}</button>`;
        });
        html += `</div>`;
        return html;
    }

    // ===== KIỂM TRA SAI CHÍNH TẢ TÊN CÔNG TY =====
    if (contextData.company_typo) {
        const typo = contextData.company_typo;
        let intendedQuery = typo.intendedType === 'history'
            ? `Lịch sử xả thải ${typo.closestCompany}`
            : (typo.intendedType === 'holidayData' ? `Lịch nghỉ của ${typo.closestCompany}` : `Chỉ số mới nhất của ${typo.closestCompany}`);
        
        let html = `<p>⚠️ Không tìm thấy công ty nào khớp chính xác tên trong câu hỏi của bạn. Có phải ý bạn là <strong>${typo.closestCompany}</strong> không?</p>`;
        html += `<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
        html += `<button class="suggestion-btn" data-query="${intendedQuery}">Đúng, xem thông tin</button>`;
        html += `<button class="suggestion-btn" data-query="Xem từng công ty">Không, xem danh sách công ty</button>`;
        html += `</div>`;
        return html;
    }

    // ===== KIỂM TRA NHIỀU NHÂN SỰ TRÙNG TÊN =====
    if (contextData.employee_multiple) {
        const mul = contextData.employee_multiple;
        let html = `<p>👥 Hệ thống tìm thấy nhiều nhân sự khớp với tên bạn nhập. Ý bạn muốn hỏi về ai?</p>`;
        html += `<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
        mul.employees.forEach(emp => {
            html += `<button class="suggestion-btn" data-query="Lịch trực của ${emp}">${emp}</button>`;
        });
        html += `</div>`;
        return html;
    }

    // ===== SO SÁNH LƯU LƯỢNG XẢ THẢI =====
    if (contextData.comparison) {
        const compData = contextData.comparison;
        
        const timeframeLabels = {
            'week': 'Tuần này',
            'month': 'Tháng này',
            'billing': 'Kỳ thanh toán hiện hành',
            'year': 'Năm nay'
        };
        const tfLabel = timeframeLabels[compData.timeframe] || 'Kỳ này';

        if (compData.companies && compData.companies.length > 0) {
            let r = `📊 **So sánh xả thải (${compData.periodLabel || tfLabel}):**\n\n`;
            
            compData.companies.forEach(c => {
                const totalStr = c.total !== null ? `**${c.total.toLocaleString('vi-VN')} m³**` : 'N/A';
                const quotaStr = c.quota !== null && c.quota > 0 ? `**${c.quota.toLocaleString('vi-VN')} m³**` : 'Không khoán';
                
                let pctStr = '';
                let statusStr = 'Trong hạn mức';
                
                if (c.total !== null && c.quota !== null && c.quota > 0) {
                    const pct = (c.total / c.quota) * 100;
                    pctStr = ` (${pct.toFixed(1)}%)`;
                    if (pct > 100) {
                        statusStr = `🔴 **Vượt khoán**${pctStr}`;
                    } else if (pct > 90) {
                        statusStr = `🟡 *Cảnh báo*${pctStr}`;
                    } else {
                        statusStr = `Trong hạn mức${pctStr}`;
                    }
                }
                
                r += `• 🏢 **${c.company}**:\n`;
                r += `  - Thực tế xả: ${totalStr}\n`;
                r += `  - Định mức khoán: ${quotaStr}\n`;
                r += `  - Trạng thái: ${statusStr}\n\n`;
            });
            
            // Tính chênh lệch nếu có 2 công ty
            if (compData.companies.length === 2) {
                const c1 = compData.companies[0];
                const c2 = compData.companies[1];
                if (c1.total !== null && c2.total !== null) {
                    const diff = Math.abs(c1.total - c2.total);
                    const larger = c1.total > c2.total ? c1.company : c2.company;
                    const smaller = c1.total > c2.total ? c2.company : c1.company;
                    r += `⚖️ **Chênh lệch**: **${larger}** xả nhiều hơn **${smaller}** là **${diff.toLocaleString('vi-VN')} m³**.\n`;
                }
            }
            
            r += `\n*(${compData.timeframe === 'billing' ? 'Định mức khoán = Hệ số khoán × Số ngày làm việc thực tế' : 'Định mức khoán = Hệ số khoán × Số ngày làm việc'})*\n`;
            r += `\n<br><button class="suggestion-btn" data-query="Tổng xả thải tháng này" style="display: inline-block; padding: 6px 12px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; border-radius: 20px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; outline: 1px solid #cbd5e1; margin-top: 5px;">💧 Xem tổng xả thải KCN</button>`;
            return r;
        } else if (compData.kcnStats) {
            const stats = compData.kcnStats;
            let r = `📊 **Thống kê so sánh xả thải toàn KCN (${stats.periodLabel || tfLabel}):**\n\n`;
            r += `💧 **Tổng lượng xả thải KCN:** ${stats.tong_luong_xa_thai_kcn.toLocaleString('vi-VN')} m³ _(${stats.so_cong_ty_co_du_lieu} công ty có dữ liệu)_\n\n`;
            
            if (stats.topConsumers && stats.topConsumers.length > 0) {
                r += `🏆 **Xếp hạng các công ty xả thải nhiều nhất:**\n`;
                stats.topConsumers.forEach((c, idx) => {
                    const totalStr = c.total !== null ? `${c.total.toLocaleString('vi-VN')} m³` : 'N/A';
                    const quotaStr = c.quota !== null && c.quota > 0 ? `${c.quota.toLocaleString('vi-VN')} m³` : 'Không';
                    let status = '';
                    if (c.total !== null && c.quota !== null && c.quota > 0) {
                        const pct = (c.total / c.quota) * 100;
                        if (pct > 100) status = ' (🔴 Vượt)';
                        else if (pct > 90) status = ' (🟡 Cảnh báo)';
                    }
                    r += `${idx + 1}. **${c.company}**: ${totalStr} / Khoán: ${quotaStr}${status}\n`;
                });
            }
            
            r += `\n<br><button class="suggestion-btn" data-query="Xem từng công ty" style="display: inline-block; padding: 6px 12px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; border-radius: 20px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; outline: 1px solid #cbd5e1; margin-top: 5px;">🏭 Xem từng công ty</button>`;
            return r;
        }
    }

    // ===== LỊCH TRỰC CÁ NHÂN =====
    if (contextData.personal_schedule) {
        const ps = contextData.personal_schedule;

        // Nếu nhân sự đã nghỉ việc hoặc không nằm trong danh sách đang làm việc
        if (ps.isInactive) {
            let html = `<p>⚠️ Nhân sự <b>${ps.employee}</b> không nằm trong danh sách nhân sự làm việc hiện hành của KCN Thốt Nốt (có thể đã nghỉ việc hoặc chưa được cấu hình lịch làm việc).</p>`;
            html += `<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
            html += `<button class="suggestion-btn" data-query="Lịch trực tuần này">Xem lịch trực chung tuần này</button>`;
            html += `<button class="suggestion-btn" data-query="Danh sách ca trực hôm nay">Danh sách ca trực hôm nay</button>`;
            html += `</div>`;
            return html;
        }

        // Nếu người dùng chỉ gõ tên không kèm ngữ cảnh
        if (ps.nameOnly) {
            let html = `<p>🙋‍♂️ Có phải ý bạn đang đề cập đến <b>${ps.employee}</b> là nhân viên vận hành?</p>`;
            html += `<p>Bạn muốn thực hiện thao tác nào tiếp theo?</p>`;
            html += `<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
            html += `<button class="suggestion-btn" data-query="Lịch trực của ${ps.employee}">📅 Xem lịch trực sắp tới của ${ps.employee}</button>`;
            html += `<button class="suggestion-btn" data-query="Lịch trực hôm nay">👥 Xem ca trực hôm nay</button>`;
            html += `</div>`;
            return html;
        }

        // Tạo prefix xác nhận nếu người dùng viết tắt tên nhân sự
        let prefix = '';
        if (ps.isExactName === false) {
            prefix = `<p>💡 <i>Ý bạn là nhân sự <b>${ps.employee}</b>:</i></p>\n\n`;
        }

        if (!ps.schedule || ps.schedule.length === 0) {
            let r = prefix + `📅 **Lịch trực của ${ps.employee} (7 ngày tới):**\n\n`;
            r += `Hiện tại không có lịch trực nào được phân công cho **${ps.employee}** từ ngày ${ps.startDate.split('-').reverse().join('/')} đến 7 ngày tiếp theo.\n`;
            r += `\n<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
            r += `<button class="suggestion-btn" data-query="Lịch trực tuần này">Xem lịch trực tuần này</button>`;
            r += `<button class="suggestion-btn" data-query="Lịch trực hôm nay">Xem lịch trực hôm nay</button>`;
            r += `</div>`;
            return r;
        } else {
            let r = prefix + `📅 **Lịch trực của ${ps.employee} (7 ngày tới):**\n\n`;
            ps.schedule.forEach(item => {
                const dateParts = item.date.split('-');
                const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                const noteStr = item.note ? ` _(${item.note})_` : '';
                r += `• **${item.dayLabel} (${formattedDate})**:\n`;
                r += `  - Nhóm: **${item.shiftGroup}**\n`;
                r += `  - Ca trực: \`${item.startTime} - ${item.endTime}\`${noteStr}\n\n`;
            });
            r += `\n<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
            r += `<button class="suggestion-btn" data-query="Lịch trực tuần này">Xem lịch trực tuần này</button>`;
            r += `<button class="suggestion-btn" data-query="Lịch trực hôm nay">Xem lịch trực hôm nay</button>`;
            r += `</div>`;
            return r;
        }
    }


    // ===== THỐNG KÊ NÂNG CAO =====
    if (contextData.advancedStats) {
        const stats = contextData.advancedStats;
        let r = '';

        if (stats.pastTimeframeRequested) {
            r += `⚠️ Hệ thống hiện chưa hỗ trợ thống kê lưu lượng cho từng khoảng thời gian cụ thể trong quá khứ qua chat. Dưới đây là dữ liệu của kỳ hiện tại:\n\n`;
        }

        r += `📌 **${stats.periodLabel || 'Thống kê'}**\n\n`;

        if (stats.companyData) {
            const d = stats.companyData;
            if (!d.hasData) {
                return r + `⚠️ Công ty **${d.company}** bị thiếu chỉ số mốc đầu kỳ, không thể tính toán.`;
            }
            r += `🏭 Công ty: **${d.company}**\n`;
            r += `💧 Tổng lưu lượng: **${d.total.toLocaleString('vi-VN')} m³**\n`;
            if (d.avg !== null) r += `📊 Trung bình: **${d.avg.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} m³/ngày** (${d.workingDays} ngày làm việc)\n`;
            if (d.quota !== null) r += `📦 Khối lượng khoán: **${d.quota.toLocaleString('vi-VN')} m³**\n`;
        } else if (stats.tong_luong_xa_thai_kcn !== undefined) {
            r += `💧 **Tổng KCN: ${stats.tong_luong_xa_thai_kcn.toLocaleString('vi-VN')} m³**`;
            if (stats.so_cong_ty_co_du_lieu) r += ` _(${stats.so_cong_ty_co_du_lieu} công ty)_`;
            r += `\n\n`;
            if (stats.topConsumers && stats.topConsumers.length > 0) {
                r += `🏆 **Top xả thải nhiều nhất:**\n`;
                stats.topConsumers.forEach((c, i) => {
                    r += `${i + 1}. **${c.company}**: ${c.total.toLocaleString('vi-VN')} m³\n`;
                });
            }
            if (stats.companies && stats.companies.length > 0) {
                const allZero = stats.companies.every(c => (c.total || 0) === 0);
                if (allZero) {
                    r += `\n⚠️ Có vẻ như chưa có dữ liệu xả thải được ghi nhận trong kỳ này.`;
                }
            }
        }

        r += `\n<br><a href="statistics.html" target="_blank" style="display: inline-block; padding: 6px 12px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; border-radius: 20px; font-size: 13px; font-weight: 500; text-decoration: none; margin-top: 5px;">📊 Xem Thống kê quá khứ ↗</a>`;
        r += `\n<br><button class="suggestion-btn" data-query="Xem từng công ty" style="display: inline-block; padding: 6px 12px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; border-radius: 20px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; outline: 1px solid #cbd5e1; margin-top: 5px; margin-left: 5px;">🏭 Xem từng công ty</button>`;
        return r;
    }

    // ===== CHỈ SỐ CÔNG TY =====
    if (contextData.companyData) {
        const d = contextData.companyData;
        let r = '';

        // Bắt lỗi nếu người dùng tra ngày cụ thể (vd: 1/1/2026, 20/10)
        const specificDatePattern = /(\d{1,2}[\/\-\.]\d{1,2})|(\d{4})|(hôm qua)|(tháng \d)|(ngày \d)/i;
        if (userMessage && specificDatePattern.test(userMessage)) {
            r += `⚠️ Hệ thống hiện chưa hỗ trợ tra cứu chỉ số vào một ngày cụ thể trong quá khứ. Dưới đây là kết quả mới nhất:\n\n`;
        }

        r += `📋 **Chỉ số mới nhất của ${d.company}**\n\n`;
        r += `📅 Ngày ghi: **${d.ngay_ghi_hien_tai || 'N/A'}**\n`;
        r += `🔢 Chỉ số: **${(d.chi_so_dong_ho_hien_tai || 0).toLocaleString('vi-VN')}**\n`;

        // Dùng link HTML trực tiếp dẫn qua trang chủ (chứa bảng thống kê) thay vì tạo nút bấm gây vòng lặp chat
        r += `\n<br><a href="datatable.html" target="_blank" style="display: inline-block; padding: 6px 12px; background: #e2e8f0; color: #334155; border: 1px solid #cbd5e1; border-radius: 20px; font-size: 13px; font-weight: 500; text-decoration: none; margin-top: 5px;">📊 Xem Lịch sử chỉ số ↗</a>`;
        return r;
    }

    // ===== DANH SÁCH CÔNG TY =====
    if (contextData.companyList) {
        const list = contextData.companyList;
        let r = `🏭 **Danh sách công ty KCN Thốt Nốt** _(${list.total} công ty)_\n\n`;
        if (list.group1.length) r += `🔵 **Nhóm 1 (Đồng hồ):** ${list.group1.join(', ')}\n`;
        if (list.group2.length) r += `🟢 **Nhóm 2 (Hóa đơn):** ${list.group2.join(', ')}\n`;
        if (list.group3.length) r += `🟡 **Nhóm 3 (Khoán):** ${list.group3.join(', ')}\n`;
        r += `\nBạn muốn xem chi tiết thông tin của công ty nào?\n`;
        if (list.group1.length) {
            list.group1.slice(0, 4).forEach(comp => {
                r += `[BUTTON]Chỉ số mới nhất của ${comp}[/BUTTON]\n`;
            });
        }
        r += `[BUTTON]Tổng xả thải tháng này[/BUTTON]`;
        return r;
    }

    // ===== NGÀY NGHỈ / LỊCH NGHỈ =====
    if (contextData.holidays !== undefined) {
        const hols = contextData.holidays;
        let r = ``;

        const dayMap = { 'sat_sun': 'Thứ 7 & Chủ nhật', 'sat-sun': 'Thứ 7 & Chủ nhật', 'sun_only': 'Chủ nhật', 'sun': 'Chủ nhật', 'sat': 'Thứ 7', 'none': 'Không nghỉ' };

        if (contextData.company && contextData.defaultHolidayConfig) {
            const cfg = contextData.defaultHolidayConfig;
            r += `📋 **Cấu hình nghỉ định kỳ của ${contextData.company}:** ${dayMap[cfg] || cfg}\n\n`;
        } else if (contextData.allDefaultHolidays) {
            r += `📋 **Cấu hình nghỉ định kỳ các công ty:**\n`;
            for (const [comp, cfg] of Object.entries(contextData.allDefaultHolidays)) {
                if (cfg && cfg !== 'none') {
                    r += `- **${comp}**: Nghỉ ${dayMap[cfg] || cfg}\n`;
                }
            }
            r += `\n`;
        }

        if (hols.length === 0) {
            r += `✅ Không có thông báo nghỉ đột xuất nào trong khoảng thời gian tra cứu.`;
        } else {
            r += `📅 **${hols.length} thông báo nghỉ:**\n`;
            hols.forEach(h => {
                const parts = h.date.split('-');
                const disp = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : h.date;
                r += `- **${h.company}**: Ngày ${disp}${h.ghi_chu ? ` _(${h.ghi_chu})_` : ''}\n`;
            });
        }

        r += `\n[BUTTON]Xem lịch trực hôm nay[/BUTTON]`;
        return r;
    }

    // ===== LỊCH TRỰC (AUTOPLAN) =====
    if (contextData.calculatedSchedule !== undefined) {
        const schedule = contextData.calculatedSchedule;
        const dateLabel = contextData.targetDate
            ? (() => {
                const p = contextData.targetDate.split('-');
                return `ngày ${p[2]}/${p[1]}/${p[0]}`;
            })()
            : 'hôm nay';

        if (!schedule) {
            return `📅 Không tìm thấy lịch trực cho ${dateLabel}.\n\n[BUTTON]Xem lịch tuần này[/BUTTON]`;
        }

        let r = `📅 **Lịch trực ${dateLabel}:**\n\n${schedule}\n\n[BUTTON]Ngày mai ai trực?[/BUTTON]`;
        return r;
    }

    // ===== LÀM RÕ Ý ĐỊNH MƠ HỒ (CLARIFY) =====
    if (contextData.clarify) {
        const cl = contextData.clarify;
        if (cl.candidates && cl.candidates.length > 0) {
            let html = `<p>🔍 Hệ thống tìm thấy nhiều đối tượng trùng khớp với từ khóa của bạn. Ý bạn muốn hỏi về đối tượng nào sau đây?</p>`;
            html += `<div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">`;
            cl.candidates.forEach(cand => {
                const isEmployee = allEmployeeNamesList.includes(cand);
                const icon = isEmployee ? '🙋‍♂️' : '🏭';
                html += `<button class="suggestion-btn" data-query="${cand}">${icon} ${cand}</button>`;
            });
            html += `</div>`;
            return html;
        }
    }

    // ===== LỖI =====
    if (contextData.error) {
        return `⚠️ **Không thể tải dữ liệu:** ${contextData.error}\n\nVui lòng thử lại sau.`;
    }

    return null; // Không nhận dạng được → để AI xử lý
}
