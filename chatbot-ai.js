// Chatbot AI using Google Gemini

import { db, auth, getRole } from "./script.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAIKnowledgeBase } from "./chatbot-firebase-queries.js?v=6";

let cachedAIKnowledge = [];
let currentUserRole = "guest";

// Theo dõi vai trò người dùng hiện tại để phân quyền quy chế RAG
if (auth) {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
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
const PREFERRED_MODEL = 'gemini-2.5-flash';

// Các model + endpoint dùng cho chế độ gọi trực tiếp (USE_PROXY = false)
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash'];
const GEMINI_API_BASES = [
    'https://generativelanguage.googleapis.com/v1beta',
    'https://generativelanguage.googleapis.com/v1'
];
const buildGeminiUrl = (base, model) => `${base}/models/${model}:generateContent`;

const isValidAPIKey = (USE_PROXY && PROXY_URL) || (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE' && GEMINI_API_KEY.startsWith('AIza'));

// System prompt ngắn gọn (Fallback bảo mật, thông tin thực tế tải từ Firestore)
let SYSTEM_CONTEXT = `Bạn là trợ lý ảo. Trả lời ngắn gọn, thân thiện bằng tiếng Việt.`;


export let WELCOME_MESSAGE_MEMBER = `Xin chào! Tôi là trợ lý ảo hỗ trợ bạn.`;

export let WELCOME_MESSAGE_GUEST = `Xin chào! Tôi là trợ lý ảo hỗ trợ bạn. Vui lòng đăng nhập để sử dụng đầy đủ tính năng.`;

export function getWelcomeMessage() {
    return auth.currentUser ? WELCOME_MESSAGE_MEMBER : WELCOME_MESSAGE_GUEST;
}

let conversationHistory = [
    { role: "user", parts: [{ text: SYSTEM_CONTEXT }] },
    { role: "model", parts: [{ text: WELCOME_MESSAGE_GUEST }] }
];

let companyNameMap = {};
let staticResponsesMap = {};

function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

export async function initDynamicChatbotData() {
    try {
        let masterSnap = null;
        let configSnap = null;
        let aiConfigSnap = null;

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

        if (aiConfigSnap && aiConfigSnap.exists()) {
            const aiData = aiConfigSnap.data();
            if (aiData.systemContext) {
                SYSTEM_CONTEXT = aiData.systemContext;
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
        'liên hệ hỗ trợ': staticResponsesMap['liên hệ hỗ trợ'] || '📞 Vui lòng liên hệ Văn phòng Quản lý để được hỗ trợ.',
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
                enhancedMessage = `${userMessage}\n\n[Tài liệu quy chế tham khảo chính thức:\n${knowledgeText}\n]`;
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
        let aiResponse = parts && parts.length
            ? parts.map(p => p.text).join('\n')
            : 'Xin lỗi, tôi chưa có câu trả lời cho câu hỏi này.';

        // Đính kèm nguồn trích dẫn nếu sử dụng RAG
        if (contextData && contextData.rag_knowledge && contextData.rag_knowledge.length > 0) {
            const sources = contextData.rag_knowledge.map(k => {
                const titlePart = `**${k.title}**`;
                if (k.sourceUrl) {
                    return `KCN - [${titlePart}](${k.sourceUrl})`;
                }
                return `KCN - ${titlePart}`;
            }).join(', ');
            aiResponse += `\n\n<span style="font-size: 11px; color: #64748b; display: block; margin-top: 10px;">*(Nguồn tham khảo: ${sources})*</span>`;
        }


        if (typeof document !== 'undefined') {
            const aiStatusEl = document.getElementById('aiStatus');
            if (aiStatusEl) {
                aiStatusEl.textContent = '(AI)';
                aiStatusEl.title = 'Chatbot đang sử dụng Google Gemini AI';
                aiStatusEl.style.color = '#00ff00';
            }
        }

        conversationHistory.push({ role: 'model', parts: [{ text: aiResponse }] });

        // Giới hạn history: System prompt + Welcome + 6 lượt gần nhất (= 14 entries)
        // Payload nhỏ hơn → ít token hơn → ít tốn quota hơn
        if (conversationHistory.length > 14) {
            conversationHistory = [
                conversationHistory[0], // System context
                conversationHistory[1], // Initial response
                ...conversationHistory.slice(-12) // 6 lượt hội thoại gần nhất
            ];
        }


        return aiResponse;

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
                if (d.avg !== null) responseText += `- Trung bình: **${d.avg.toLocaleString('vi-VN', {maximumFractionDigits: 1})} m³/ngày** (Tính trên ${d.workingDays} ngày làm việc)\n`;
                if (d.quota !== null) responseText += `- Khối lượng khoán: **${d.quota.toLocaleString('vi-VN')} m³**\n`;
            } else if (stats.tong_luong_xa_thai_kcn !== undefined) {
                responseText += `- Tổng KCN: **${stats.tong_luong_xa_thai_kcn.toLocaleString('vi-VN')} m³** (Từ ${stats.so_cong_ty_co_du_lieu} công ty)\n\n`;
                if (stats.topConsumers && stats.topConsumers.length > 0) {
                    responseText += `🏆 **Top xả thải nhiều nhất:**\n`;
                    stats.topConsumers.forEach((c, i) => { responseText += `${i+1}. **${c.company}**: ${c.total.toLocaleString('vi-VN')} m³\n`; });
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
        'giới thiệu': '🏢 Khu công nghiệp (KCN) Thốt Nốt là trung tâm công nghiệp trọng điểm tại cửa ngõ phía Bắc TP. Cần Thơ, giáp ranh tỉnh An Giang. Với quy mô lên tới 600 ha, đây là hạt nhân thu hút đầu tư, tập trung chế biến nông - thủy sản và logistics, tận dụng vị trí đắc địa tiếp giáp sông Hậu. Nằm tiếp giáp trung tâm vùng nguyên liệu nông nghiệp trù phú miền Tây (An Giang, Đồng Tháp, Cần Thơ) và mặt tiền sông Hậu, vô cùng thuận lợi cho vận tải thủy nội địa và xuất nhập khẩu. Được định hướng trở thành trung tâm công nghiệp, tiểu thủ công nghiệp trọng điểm – đặc biệt tập trung chế biến lương thực, thủy sản (cá tra, gạo) và các ngành công nghiệp phụ trợ, kho bãi.\n\n🔗 Bạn có thể xem chi tiết tại: <a href="https://www.google.com/search?q=t%E1%BB%95ng+quan+kcn+th%E1%BB%91t+n%E1%BB%91t&sca_esv=a05e7dbab888ec56&sxsrf=APpeQnuqPq_BOimAI5s5zkWwc1s1TcMluA%3A1782308889386&source=hp&ei=GeA7aoLBFJKnvr0PoJ2CsA4&iflsig=ABILxe8AAAAAajvuKUK9g1RrNljrWhNCiIgxR4cVWIoM&ved=0ahUKEwjCseqBgqCVAxWSk68BHaCOAOYQ4dUDCDc&uact=5&oq=t%E1%BB%95ng+quan+kcn+th%E1%BB%91t+n%E1%BB%91t&gs_lp=Egdnd3Mtd2l6Ihx04buVbmcgcXVhbiBrY24gdGjhu5F0IG7hu5F0MgUQIRigATIFECEYoAEyBRAhGJ8FMgUQIRifBTIFECEYnwUyBRAhGJ8FMgUQIRifBTIFECEYnwVIhEFQ_wZYwz9wDXgAkAEDmAHCAaABpR-qAQQxLjMxuAEDyAEA-AEBmAIioALcF6gCCsICDRAjGPAFGJ4GGOoCGCfCAgcQIxjqAhgnwgINECMYngYY8AUY6gIYJ8ICChAjGJ4GGPAFGCfCAg4QABiABBiKBRixAxiDAcICCxAAGIAEGLEDGIMBwgIIEAAYgAQYsQPCAgUQLhiABMICERAuGIAEGLEDGIMBGMcBGNEDwgIOEC4YgAQYigUYsQMYgwHCAggQLhiABBixA8ICBRAAGIAEwgIEEAAYA8ICCxAuGIAEGLEDGIMBwgIMEAAYgAQYChgLGLEDwgIEECMYJ8ICChAjGIAEGIoFGCfCAgQQIRgVmAMi8QWIi3SKmIdYvJIHBzEyLjIxLjGgB5HXAbIHBjEuMjEuMbgHjRfCBwsxLjE1LjE2LjEuMcgHigGACAE&sclient=gws-wiz" target="_blank" style="color: #034892; font-weight: bold; text-decoration: underline;">Tổng quan KCN Thốt Nốt</a>',
        'địa chỉ': '📍 Địa chỉ KCN Thốt Nốt: KV Thới Hòa 1, P. Thốt Nốt, Q. Thốt Nốt, TP. Cần Thơ.',
        'giờ làm việc': '⏰ Giờ làm việc văn phòng KCN Thốt Nốt: 7:30 - 17:00 (Thứ 2 - Thứ 6).',
        'liên hệ hỗ trợ': '📞 Hỗ trợ kỹ thuật: Mr Toàn - 0946.000.865. Số điện thoại văn phòng KCN: 02923.854.408.',
        'hỗ trợ': '📞 Hỗ trợ kỹ thuật: Mr Toàn - 0946.000.865.',
        'liên hệ': '📞 Số điện thoại liên hệ KCN Thốt Nốt: 02923.854.408',
        'xin chào': auth.currentUser ? WELCOME_MESSAGE_MEMBER : WELCOME_MESSAGE_GUEST,
        'hello': 'Hello! Xin chào bạn.',
        'cám ơn': 'Rất vui được giúp bạn! 😊',
        'tạm biệt': 'Tạm biệt! Chúc bạn một ngày tốt lành.',
        'chức năng': auth.currentUser 
            ? 'Tôi hỗ trợ tra cứu: Chỉ số đồng hồ doanh nghiệp, Thông báo nghỉ, Thống kê Lưu lượng, Phân công công việc...'
            : 'Trợ lý ảo hỗ trợ tìm hiểu thông tin cơ bản về KCN Thốt Nốt. Vui lòng đăng nhập để tra cứu số liệu kỹ thuật.',
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

    // 1. Ưu tiên tìm kiếm chính xác (Exact matching) để luôn chính xác 100% khi khớp từ khóa/tiêu đề
    const exactMatches = allowedKnowledge.filter(item => {
        const title = (item.title || "").toLowerCase();
        const content = (item.content || "").toLowerCase();
        const keywords = (item.keywords || "").toLowerCase();
        
        const keywordMatch = keywords.split(',').some(k => {
            const trimmedKey = k.trim();
            return trimmedKey && (lowerQuery.includes(trimmedKey) || trimmedKey.includes(lowerQuery));
        });
        
        return title.includes(lowerQuery) || content.includes(lowerQuery) || keywordMatch;
    });

    if (exactMatches.length > 0) {
        return exactMatches;
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
    return results.map(r => r.item);
}

/**
 * Kiểm tra xem câu hỏi có cần truy vấn database không
 */
export function detectDataQuery(message) {
    const lowerMsg = message.toLowerCase().trim();

    // Các từ khóa chỉ định câu hỏi dạng Quy chế/Kiến thức/Hướng dẫn (RAG) rõ ràng
    const informationalKeywords = [
        'quy định', 'quy chế', 'tiêu chuẩn', 'phạt', 'cách pha', 'quy trình', 
        'hướng dẫn', 'định nghĩa', 'là gì', 'thế nào', 'làm sao', 'liên hệ', 
        'địa chỉ', 'giờ làm', 'chức năng', 'hỗ trợ'
    ];

    const isInformational = informationalKeywords.some(kw => lowerMsg.includes(kw));

    // 1. Nếu chứa từ khóa RAG rõ ràng -> Ưu tiên quét quy chế RAG trước tiên
    if (isInformational && cachedAIKnowledge && cachedAIKnowledge.length > 0) {
        const matches = searchAIKnowledge(message);
        if (matches && matches.length > 0) {
            return { type: 'rag_knowledge', query: message };
        }
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
                if ((msg.includes('xả') || msg.includes('dùng') || msg.includes('tiêu thụ') || msg.includes('thoát')) && (msg.includes('bao nhiêu') || msg.includes('mấy') || msg.includes('nhiều hay ít'))) return true;
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
                if (hasCompany && (msg.includes('số') || msg.includes('chỉ') || msg.includes('ghi') || msg.includes('đồng hồ') || msg.includes('mới nhất') || msg.includes('hiện tại'))) return true;
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
                'bao nhiêu đơn vị', 'những ai', 'gồm những ai', 'bao nhiêu bên'
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

            const sortedCompanyKeywords = Object.entries(companyNameMap).sort((a, b) => b[0].length - a[0].length);
            for (const [lowerName, realName] of sortedCompanyKeywords) {
                if (lowerMsg.includes(lowerName)) { result.company = realName; break; }
            }

            if (pattern.type === 'statistics') {
                const specificWeekMatch = lowerMsg.match(/tuần\s*(\d+)/);
                const specificMonthMatch = lowerMsg.match(/tháng\s*(\d+)/);
                const specificYearMatch = lowerMsg.match(/năm\s*(\d{4})/);
                const specificQuarterMatch = lowerMsg.match(/quý\s*(\d+)/);

                if (specificWeekMatch || specificMonthMatch || specificYearMatch || specificQuarterMatch) {
                    result.requiresRedirect = true;
                    return result;
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

    // ===== THỐNG KÊ NÂNG CAO =====
    if (contextData.advancedStats) {
        const stats = contextData.advancedStats;
        let r = `📌 **${stats.periodLabel || 'Thống kê'}**\n\n`;

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

        r += `\n[BUTTON]Xem kỳ trước[/BUTTON]\n[BUTTON]Xem từng công ty[/BUTTON]`;
        return r;
    }

    // ===== CHỈ SỐ CÔNG TY =====
    if (contextData.companyData) {
        const d = contextData.companyData;
        let r = `📋 **Chỉ số mới nhất của ${d.company}**\n\n`;
        r += `📅 Ngày ghi: **${d.ngay_ghi_hien_tai || 'N/A'}**\n`;
        r += `🔢 Chỉ số: **${(d.chi_so_dong_ho_hien_tai || 0).toLocaleString('vi-VN')}**\n`;
        r += `\n[BUTTON]Lịch sử chỉ số ${d.company}[/BUTTON]`;
        return r;
    }

    // ===== DANH SÁCH CÔNG TY =====
    if (contextData.companyList) {
        const list = contextData.companyList;
        let r = `🏭 **Danh sách công ty KCN Thốt Nốt** _(${list.total} công ty)_\n\n`;
        if (list.group1.length) r += `🔵 **Nhóm 1 (Đồng hồ):** ${list.group1.join(', ')}\n`;
        if (list.group2.length) r += `🟢 **Nhóm 2 (Hóa đơn):** ${list.group2.join(', ')}\n`;
        if (list.group3.length) r += `🟡 **Nhóm 3 (Khoán):** ${list.group3.join(', ')}\n`;
        r += `\n[BUTTON]Chỉ số mới nhất của NTSF[/BUTTON]\n[BUTTON]Tổng xả thải tháng này[/BUTTON]`;
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

    // ===== LỖI =====
    if (contextData.error) {
        return `⚠️ **Không thể tải dữ liệu:** ${contextData.error}\n\nVui lòng thử lại sau.`;
    }

    return null; // Không nhận dạng được → để AI xử lý
}
