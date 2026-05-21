// Chatbot AI using Google Gemini

import { db, auth } from "./script.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ========== CẤU HÌNH PROXY ==========
// CÁCH 1: Sử dụng Google Apps Script Proxy (bảo mật API Key)
const USE_PROXY = true; // Đổi thành true khi đã setup proxy
const PROXY_URL = 'https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec'; // Thay bằng URL từ Apps Script

// CÁCH 2: Gọi trực tiếp (KHÔNG an toàn khi public)
// Chỉ dùng khi USE_PROXY = false (local development)
let DIRECT_API_KEY = '';
if (!USE_PROXY) {
    // Chỉ import config.js khi cần thiết (local dev)
    try {
        const { CONFIG } = await import('./config.js');
        DIRECT_API_KEY = CONFIG.GEMINI_API_KEY;
    } catch (error) {
        console.warn('config.js not found - using proxy mode');
    }
}

// API Key từ config.js (chỉ dùng khi USE_PROXY = false)
const OVERRIDE_KEY = typeof localStorage !== 'undefined' ? localStorage.getItem('GEMINI_API_KEY') : null;
const GEMINI_API_KEY = OVERRIDE_KEY || DIRECT_API_KEY;

// Danh sách model fallback. Thử nhiều biến thể để tương thích tài khoản/khu vực.
const GEMINI_MODELS = [
    'gemini-flash-latest',      // Model này có trong log của bạn
    'gemini-pro-latest',        // Model này có trong log của bạn
    'gemini-2.5-flash',         // Model này cũng có, thêm vào dự phòng
    'gemini-2.5-pro'            // Model này cũng có, thêm vào dự phòng
];
// Cơ sở endpoint: ưu tiên v1beta (ổn định cho generateContent), sau đó thử v1.
const GEMINI_API_BASES = [
    'https://generativelanguage.googleapis.com/v1beta',
    'https://generativelanguage.googleapis.com/v1'
];
const buildGeminiUrl = (base, model) => `${base}/models/${model}:generateContent`;

// Kiểm tra API key có hợp lệ không
const isValidAPIKey = (USE_PROXY && PROXY_URL) || (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE' && GEMINI_API_KEY.startsWith('AIza'));

// System prompt để định nghĩa vai trò và kiến thức của chatbot
let SYSTEM_CONTEXT = `
Bạn là một trợ lý ảo thân thiện, thông minh và chủ động của Trung Tâm Xây Dựng Hạ Tầng Khu Công Nghiệp Thốt Nốt, Cần Thơ.

THÔNG TIN CƠ BẢN:
- Địa chỉ: KV Thới Hòa 1, P. Thốt Nốt, TP Cần Thơ
- Giờ làm việc: 7:30 - 17:00 (Thứ 2 - Thứ 6)
- Chức năng chính: Quản lý lưu lượng nước xả thải của các doanh nghiệp vào KCN

HỆ THỐNG QUẢN LÝ:
- Theo dõi chỉ số đồng hồ nước xả thải của các công ty
- Quản lý ngày nghỉ, ngày làm việc đặc biệt
- Thống kê báo cáo lượng nước xả thải theo tuần/tháng/năm
- Tính toán khoán tiêu thụ dựa trên ngày làm việc
- Hệ số khoán (quota multipliers) cho từng công ty
- Cấu hình ngày bắt đầu tuần/tháng/năm/kỳ thanh toán

CÁC CÔNG TY TRONG KCN:
(Danh sách công ty sẽ được nạp tự động từ Database)

QUY TẮC MỐC NEO THỜI GIAN (CỰC KỲ QUAN TRỌNG):
- "Tuần", "Tháng", "Năm" và "Kỳ thu phí" trong hệ thống này KHÔNG được tính theo lịch thông thường. Chúng phụ thuộc hoàn toàn vào các "Mốc neo" do quản trị viên cài đặt.
- Ví dụ: "Tháng 5" có thể được tính từ ngày 05/05 đến 04/06 nếu mốc neo là ngày 5.
- DO ĐÓ: Khi trả lời về thống kê, bạn BẮT BUỘC phải trích dẫn khoảng thời gian chính xác từ trường \`periodLabel\` trong \`contextData\` để người dùng hiểu rõ. Ví dụ: "Trong Tháng hiện tại (từ 05/05 đến 04/06), tổng lưu lượng là...".
- TUYỆT ĐỐI KHÔNG tự suy luận lịch hoặc giả định ngày tháng. Chỉ đọc dữ liệu đã được tính sẵn.

KHẢ NĂNG TRUY VẤN DỮ LIỆU:
1. Phân biệt rạch ròi THÁNG, KỲ THU PHÍ và KHOÁN (Tuyệt đối tuân thủ):
   - Nếu user hỏi "THÁNG" (Lưu lượng tháng): Đọc giá trị Total (Tổng). Dữ liệu này đã được hệ thống lấy theo mốc neo Ngày đầu tháng.
   - Nếu user hỏi "KỲ THU PHÍ" (Lưu lượng kỳ): Đọc giá trị Total (Tổng). Dữ liệu này đã được hệ thống lấy theo mốc neo Ngày chốt kỳ (Chỉ số sau - Chỉ số trước).
   - Nếu user hỏi "KHOÁN" (Khối lượng khoán): CHỈ ĐỌC giá trị Quota (Khối lượng khoán). Bản chất: Dùng mốc neo của kỳ thu phí để đếm ngày làm việc ròng x Hệ số khoán.
   - BẮT BUỘC: Bạn CHỈ ĐỌC số liệu có sẵn trong \`contextData\`. Không giải thích dài dòng cách tính nếu không được yêu cầu.
2. Các chỉ số khác:
   - LƯU LƯỢNG TRUNG BÌNH: Chỉ đọc giá trị Avg (Trung bình/ngày). KHÔNG tự chia.
   - Chỉ số (chi_so): Là số đọc trên mặt đồng hồ.
3. Ngày nghỉ/làm việc: Nếu có \`defaultHolidayConfig\`, hãy thông báo quy tắc nghỉ hàng tuần trước, sau đó mới liệt kê danh sách ngày nghỉ đột xuất/lễ từ \`holidays\`.
4. Thống kê KCN: Tổng lượng xả thải toàn KCN tuần/tháng/kỳ, top 5 công ty xả thải nhiều nhất.
5. Danh sách công ty: Tổng số công ty, tên tất cả công ty chia theo nhóm.

LOGIC AUTOPLAN (LỊCH TRỰC TỰ ĐỘNG) - QUAN TRỌNG:
Hệ thống đã tự động tính toán lịch trực và cung cấp kết quả trong trường \`calculatedSchedule\`.
Khi được hỏi về việc "ai trực", "lịch làm việc", BẠN CHỈ ĐƯỢC PHÉP ĐỌC giá trị từ \`calculatedSchedule\`.
Ví dụ trả lời: "Theo lịch hệ thống, ngày [Ngày] là ca trực của: [calculatedSchedule]". Tuyệt đối không tự suy đoán.

CÂU HỎI MẪU BẠN CÓ THỂ TRẢ LỜI:
- "Chỉ số mới nhất của NTSF là bao nhiêu?"
- "Ngày nghỉ tháng này có những ngày nào?"
- "Tổng lượng xả thải tuần này của toàn KCN?"
- "Top 5 công ty xả thải nhiều nhất tháng này"
- "Lượng xả thải kỳ thu phí này của VNPT là bao nhiêu? Có vượt khoán không?"
- "Có bao nhiêu công ty trong KCN?"
- "Hôm nay ai trực?" hoặc "Ngày 12/12 là ca của ai?"

NHIỆM VỤ CỦA BẠN:
1. Trả lời các câu hỏi về KCN Thốt Nốt dựa trên dữ liệu thực từ Firebase
2. Hỗ trợ người dùng tìm hiểu về hệ thống quản lý
3. Giải thích các chức năng, báo cáo, thống kê
4. Hướng dẫn sử dụng hệ thống khi được hỏi
5. Định dạng số liệu rõ ràng (dùng dấu chấm phân cách hàng nghìn)

QUY TẮC TRẢ LỜI:
- Luôn luôn thân thiện, chủ động và sử dụng văn phong tự nhiên, gần gũi.
- Sử dụng tiếng Việt
- Nếu có contextData từ database, dùng nó để trả lời chính xác
- **QUAN TRỌNG:** Sau khi trả lời xong một câu hỏi về dữ liệu (thống kê, chỉ số...), hãy luôn chủ động đưa ra 1-2 gợi ý câu hỏi liên quan mà người dùng có thể muốn hỏi tiếp. Ví dụ: "Bạn có muốn xem chi tiết theo tuần không?", "So sánh với công ty khác?". Hãy trình bày các gợi ý này dưới dạng các nút bấm bằng cách sử dụng định dạng đặc biệt: [BUTTON]Nội dung gợi ý[/BUTTON].
- Khi chào hỏi, hãy đưa ra một vài gợi ý ban đầu để người dùng bắt đầu.
- Ngắn gọn, rõ ràng.
- Định dạng số đẹp (VD: 1.234.567 thay vì 1234567)
- Đơn vị khối lượng nước sử dụng là m³ (tuyệt đối không dùng định dạng toán học như $m^3$ hay m^3).
- Với danh sách dài, chỉ hiển thị top 5-10 kèm tổng số
- Nếu không có dữ liệu, giải thích rõ ràng
`;

// Lịch sử hội thoại để duy trì ngữ cảnh
const WELCOME_MESSAGE = `Xin chào! Tôi là trợ lý ảo của KCN Thốt Nốt.

Bạn có thể hỏi tôi bất cứ điều gì, hoặc thử một trong các gợi ý sau:
[BUTTON]Hôm nay ai trực?[/BUTTON]
[BUTTON]Tổng xả thải tháng này?[/BUTTON]
[BUTTON]Chỉ số mới nhất của NTSF[/BUTTON]`;

let conversationHistory = [
    {
        role: "user",
        parts: [{ text: SYSTEM_CONTEXT }]
    },
    {
        role: "model",
        parts: [{ text: WELCOME_MESSAGE }]
    }
];

// Khởi tạo rỗng, danh sách sẽ được nạp tự động qua hàm initDynamicChatbotData()
// Nếu bạn có các từ gọi tắt đặc biệt không trùng tên (ví dụ gọi Agribank là ngân hàng), hãy giữ lại những từ đó.
let companyNameMap = {
    'ngân hàng': 'Agribank',
    'ngan hang': 'Agribank'
};

function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// Hàm khởi tạo dữ liệu động (chạy ngầm không chặn luồng)
async function initDynamicChatbotData() {
    try {
        const [masterSnap, configSnap] = await Promise.all([
            getDocs(collection(db, "companies_master")),
            getDocs(collection(db, "company_configs"))
        ]);

        const masterCompanies = masterSnap.docs.map(doc => doc.data().company).filter(Boolean);
        const configs = configSnap.docs.map(d => d.data());
        const configCompanies = configs.map(c => c.company).filter(Boolean);

        const allCompanies = [...new Set([...masterCompanies, ...configCompanies])];
        if (allCompanies.length === 0) return;

        // 1. Cập nhật từ điển tìm kiếm (Fuzzy search map)
        const newMap = {};
        allCompanies.forEach(comp => {
            const lower = comp.toLowerCase();
            const noAccent = removeAccents(lower);
            newMap[lower] = comp;
            if (lower !== noAccent) newMap[noAccent] = comp;
        });
        // Bổ sung một số từ khóa gọi tắt thủ công
        newMap['ấn độ'] = 'Ấn Độ Dương';
        newMap['đại tây'] = 'Đại Tây Dương';
        companyNameMap = newMap;

        // 2. Phân nhóm động để dạy AI
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

        // Thay thế khối thông tin cứng bằng thông tin động trong SYSTEM_CONTEXT
        SYSTEM_CONTEXT = SYSTEM_CONTEXT.replace(/CÁC CÔNG TY TRONG KCN:[\s\S]*?(?=KHẢ NĂNG TRUY VẤN DỮ LIỆU:)/, dynamicGroupsText);
        
        // Nhồi lại vào não Chatbot cho phiên hiện tại
        if (conversationHistory.length > 0 && conversationHistory[0].role === "user") {
            conversationHistory[0].parts[0].text = SYSTEM_CONTEXT;
        }
        console.log("🤖 Chatbot AI: Đã tự động học xong danh sách công ty mới nhất từ Database!");
    } catch (e) {
        console.error("⚠️ Lỗi tải dữ liệu động cho chatbot:", e);
    }
}
// Kích hoạt tiến trình học ngay khi tải xong file
initDynamicChatbotData();

/**
 * Gọi Gemini API để xử lý câu hỏi
 * @param {string} userMessage - Tin nhắn từ người dùng
 * @param {object} contextData - Dữ liệu ngữ cảnh từ Firebase (nếu có)
 * @returns {Promise<string>} - Câu trả lời từ AI
 */
export async function getAIResponse(userMessage, contextData = null) {
    // Nếu chưa có API key hợp lệ, dùng fallback responses
    if (!isValidAPIKey) {
        console.warn('⚠️ Gemini API key chưa được cấu hình. Sử dụng chế độ fallback.');
        return getFallbackResponse(userMessage, contextData);
    }

    try {
        // Thêm ngữ cảnh dữ liệu nếu có
        let enhancedMessage = userMessage;
        if (contextData) {
            enhancedMessage = `${userMessage}\n\n[Dữ liệu hệ thống: ${JSON.stringify(contextData)}]`;
        }

                // Thêm tin nhắn người dùng vào lịch sử (dạng chat)
                conversationHistory.push({ role: 'user', parts: [{ text: enhancedMessage }] });

                // Payload đơn giản (nhiều tài khoản chưa hỗ trợ system_instruction). Giữ SYSTEM_CONTEXT là message đầu tiên.
                const payload = {
                    contents: conversationHistory,
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 768
                    }
                };

                let data = null;
                let lastStatus = null;
                let lastErrorBody = null;
                
                // ========== GỌI API THEO CÁCH ĐÃ CHỌN ==========
                if (USE_PROXY) {
                    // CÁCH 1: Gọi qua Google Apps Script Proxy
                    try {
                        const currentUser = auth.currentUser;
                        if (!currentUser) throw new Error("Vui lòng đăng nhập để sử dụng AI Chatbot.");
                        const idToken = await currentUser.getIdToken();

                        const formData = new URLSearchParams();
                        formData.append("action", "chatAI");
                        formData.append("idToken", idToken);
                        formData.append("data", JSON.stringify({ model: GEMINI_MODELS[0], contents: conversationHistory }));

                        const response = await fetch(PROXY_URL, {
                            method: 'POST',
                            body: formData
                        });
                        
                        if (!response.ok) {
                            const errorText = await response.text();
                            console.error('Proxy error:', response.status, errorText);
                            throw new Error(`Proxy error: ${response.status}`);
                        }
                        
                        data = await response.json();
                        
                        // ⭐️ SỬA LỖI: Bắt lỗi nếu Proxy trả về object error (chạm giới hạn, lỗi token...)
                        if (data.error || data.success === false) {
                            const errDetail = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : (data.error || 'Lỗi không xác định');
                            throw new Error(`Hệ thống API từ chối: ${errDetail}`);
                        }
                        console.log('✅ Proxy call success');
                        
                    } catch (error) {
                        console.error('❌ Proxy call failed:', error);
                        throw error;
                    }
                } else {
                    // CÁCH 2: Gọi trực tiếp Gemini API (không an toàn khi public)
                    // Thử lần lượt các base và model
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
                                try { lastErrorBody = await resp.json(); } catch { lastErrorBody = null; }
                                // Nếu 404 thì thử model/endpoint tiếp theo
                                if (resp.status === 404) continue;
                                // Nếu 400 có thể do model không có quyền hoặc payload không đúng -> thử model khác / base khác
                                if (resp.status === 400) continue;
                                // Các lỗi khác tạm dừng để fallback
                                continue;
                            }
                            data = await resp.json();
                            if (data) break;
                        }
                        if (data) break;
                    }
                }

                        if (!data) {
                            console.error('Gemini request failed details:', { status: lastStatus, error: lastErrorBody });
                            // Thử gọi danh sách model để chẩn đoán (nếu key hợp lệ, API bật sẽ trả về list)
                            try {
                                const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`);
                                const listJson = await listResp.json();
                                if (listJson.models) {
    const modelNames = listJson.models.map(m => m.name); // m.name có dạng "models/gemini-pro"
    console.warn('CÁC MODEL BẠN CÓ THỂ DÙNG (DEBUG):', JSON.stringify(modelNames, null, 2));
} else {
    console.warn('Available models response (DEBUG):', listResp.status, listJson);
}
                            } catch (e) {
                                console.warn('Failed to fetch model list for diagnostics:', e);
                            }
                    throw new Error(`API Error: ${lastStatus || 'unknown'}`);
                }

                const parts = data?.candidates?.[0]?.content?.parts;
                const aiResponse = parts && parts.length ? parts.map(p => p.text).join('\n') : 'Xin lỗi, tôi chưa có câu trả lời cho câu hỏi này.';

                // Thêm phản hồi vào lịch sử
                conversationHistory.push({ role: 'model', parts: [{ text: aiResponse }] });

        // Giới hạn lịch sử (giữ system prompt + 10 lượt hội thoại gần nhất)
        if (conversationHistory.length > 22) {
            conversationHistory = [
                conversationHistory[0], // System context
                conversationHistory[1], // Initial response
                ...conversationHistory.slice(-20) // 10 lượt hội thoại gần nhất
            ];
        }

        return aiResponse;

    } catch (error) {
        console.error('Gemini AI Error:', error);
        // ⭐️ SỬA LỖI: Xóa tin nhắn rác để bảo vệ chuỗi luân phiên User/Model khi có lỗi API
        if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
            conversationHistory.pop();
        }
        // Nếu lỗi API, dùng fallback và truyền kèm thông tin lỗi để dễ debug
        return getFallbackResponse(userMessage, contextData, error.message);
    }
}

/**
 * Fallback response khi không có API key hoặc API lỗi
 * @param {string} userMessage - Tin nhắn từ người dùng
 * @param {object} contextData - Dữ liệu ngữ cảnh
 * @returns {string} - Câu trả lời đơn giản
 */
function getFallbackResponse(userMessage, contextData, errorMessage = null) {
    const lowerMsg = userMessage.toLowerCase();
    
    let errorNotice = "";
    if (errorMessage) {
        errorNotice = `*(Hệ thống AI đang bận: ${errorMessage})*\n\n`;
    }

    // Xử lý hiển thị đẹp các loại dữ liệu thô từ Firebase
    if (contextData) {
        let responseText = `📊 **Kết quả tra cứu (Chế độ cơ bản):**\n${errorNotice}`;

        // 1. Chỉ số công ty (companyData)
        if (contextData.companyData) {
            const data = contextData.companyData;
            responseText += `- Công ty: **${data.company}**\n`;
            responseText += `- Chỉ số ĐH hiện tại: **${data.chi_so_dong_ho_hien_tai.toLocaleString('vi-VN')}** (ngày ${data.ngay_ghi_hien_tai})\n`;
            return responseText;
        }
        
        // 2. Lịch trực (calculatedSchedule)
        if (contextData.calculatedSchedule) {
            responseText += `Lịch làm việc ngày ${contextData.targetDate || "được yêu cầu"}:\n👉 **${contextData.calculatedSchedule}**`;
            return responseText;
        }

        // 3. Số lượng công ty (companyList)
        if (contextData.companyList) {
            const list = contextData.companyList;
            responseText += `Hiện tại có **${list.total}** công ty trong KCN, được chia thành 3 nhóm:\n`;
            responseText += `- **Nhóm 1 (Đồng hồ):** ${list.group1.length} công ty${list.group1.length > 0 ? ` gồm ${list.group1.join(', ')}` : ''}\n`;
            responseText += `- **Nhóm 2 (Hóa đơn):** ${list.group2.length} công ty${list.group2.length > 0 ? ` gồm ${list.group2.join(', ')}` : ''}\n`;
            responseText += `- **Nhóm 3 (Khoán):** ${list.group3.length} công ty${list.group3.length > 0 ? ` gồm ${list.group3.join(', ')}` : ''}\n`;
            return responseText;
        }
        
        // 4. Thống kê nâng cao KCN / Công ty
        if (contextData.advancedStats) {
            const stats = contextData.advancedStats;
            responseText += `📌 **${stats.periodLabel}**\n\n`;
            if (stats.companyData) {
                const d = stats.companyData;
                if (!d.hasData) return responseText + `⚠️ Công ty **${d.company}** bị thiếu chỉ số mốc đầu kỳ (${d.startMark}), không thể tính toán.`;
                responseText += `- Công ty: **${d.company}**\n`;
                responseText += `- Tổng lưu lượng: **${d.total.toLocaleString('vi-VN')} m³**\n`;
                if (d.avg !== null) responseText += `- Trung bình: **${d.avg.toLocaleString('vi-VN')} m³/ngày** (Tính trên ${d.workingDays} ngày làm việc)\n`;
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

        // 5. Ngày nghỉ (holidayData)
        if (contextData.holidays) {
            const hols = contextData.holidays;
            if (contextData.company && contextData.defaultHolidayConfig) {
                responseText += `**Cấu hình nghỉ định kỳ của ${contextData.company}:** ${contextData.defaultHolidayConfig}\n\n`;
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

        // Fallback chung
        return "Dữ liệu tra cứu thành công, nhưng chế độ cơ bản chưa hỗ trợ định dạng hiển thị cho loại thông tin này.";
    }
    
    // Các câu trả lời tĩnh cơ bản
    const responses = {
        'xin chào': WELCOME_MESSAGE,
        'hello': 'Hello! Xin chào bạn.',
        'địa chỉ': '📍 Trung tâm tọa lạc tại: KV Thới Hòa 1, P. Thốt Nốt, TP Cần Thơ',
        'giờ làm việc': '⏰ Giờ làm việc: 7:30 - 17:00 (Thứ 2 - Thứ 6)',
        'liên hệ': '📞 Số điện thoại liên hệ KCN Thốt Nốt: 02923.854.408',
        'hỗ trợ': '📞 Mr Toàn - Số điện thoại: 0946.000.865',
        'cám ơn': 'Rất vui được giúp bạn! 😊',
        'tạm biệt': 'Tạm biệt! Chúc bạn một ngày tốt lành.',
        'chức năng': 'Công cụ ghi nhận: Chỉ số đồng hồ doanh nghiệp, Thông báo nghỉ, Thống kê Lưu lượng, Phân công công việc,...là thành viên nên bạn có thể xem chi tiết ở menu hệ thống',
    };
    
    // Tìm response phù hợp
    for (const [key, value] of Object.entries(responses)) {
        if (lowerMsg.includes(key)) {
            return value;
        }
    }
    
    // Thông báo lỗi mặc định thân thiện hơn
    let fallbackMsg = `⚠️ **Hệ thống AI đang tạm thời gián đoạn.**\n\nTôi đang ở chế độ cơ bản và chưa hiểu câu hỏi này.\n\nBạn có thể thử hỏi các câu tra cứu dữ liệu ngắn gọn hơn (VD: *"Chỉ số của NTSF"*, *"Có bao nhiêu công ty"*).`;
    
    if (errorMessage) {
        fallbackMsg += `\n\n*(Chi tiết lỗi hệ thống: ${errorMessage})*`;
    }
    return fallbackMsg;
}

/**
 * Kiểm tra xem câu hỏi có cần truy vấn database không
 * @param {string} message - Tin nhắn từ người dùng
 * @returns {object|null} - Thông tin truy vấn cần thực hiện hoặc null
 */
export function detectDataQuery(message) {
    const lowerMsg = message.toLowerCase();
    
    // Các pattern cần truy vấn dữ liệu (MỞ RỘNG)
    const patterns = [
        // 1. Thống kê & So sánh nâng cao (Gộp chung logic Tính toán) - ĐƯỢC ĐƯA LÊN ĐẦU ĐỂ ƯU TIÊN
        {
            keywords: ['thống kê', 'báo cáo', 'tổng', 'trung bình', 'tiêu thụ', 'xả thải', 'lưu lượng', 'so sánh', 'nhiều nhất', 'top', 'khoán', 'vượt khoán', 'khối', 'bao nhiêu khối'],
            timeKeywords: ['tuần', 'tháng', 'kỳ', 'thu phí', 'kỳ này', 'năm'],
            type: 'statistics'
        },
        
        // 2. Chỉ số nước của công ty cụ thể (Chỉ đọc mặt đồng hồ, không tính toán)
        {
            keywords: ['chỉ số', 'đồng hồ', 'nước', 'mới nhất', 'hiện tại'],
            type: 'companyData'
        },
        
        // 3. Danh sách ngày nghỉ
        {
            keywords: ['ngày nghỉ', 'nghỉ việc', 'holiday', 'nghỉ lễ', 'nghỉ phép', 'ngày lễ'],
            type: 'holidayData'
        },
        
        // 3. Ngày làm việc đặc biệt
        {
            keywords: ['ngày làm đặc biệt', 'làm việc đặc biệt', 'làm thêm', 'tăng ca'],
            type: 'specialWorkday'
        },
        
        // 6. Danh sách công ty
        {
            keywords: ['danh sách công ty', 'các công ty', 'có bao nhiêu công ty', 'liệt kê công ty', 'tất cả công ty'],
            type: 'companyList'
        },
        
        // 9. Lịch sử tiêu thụ
        {
            keywords: ['lịch sử', 'theo thời gian', 'xu hướng', 'biến động'],
            type: 'history'
        },

        // 10. Autoplan / Lịch trực
        {
            keywords: ['autoplan', 'lịch trực', 'quy tắc', 'công việc tự động', 'lịch làm việc', 'job', 'ai trực', 'ca làm', 'ca trực', 'người trực'],
            type: 'autoplan'
        }
    ];

    for (const pattern of patterns) {
        const hasKeyword = pattern.keywords.some(kw => lowerMsg.includes(kw));
        if (hasKeyword) {
            const result = { type: pattern.type, query: message };
            
            // Tìm tên công ty chung cho mọi pattern nếu có xuất hiện
            for (const [lowerName, realName] of Object.entries(companyNameMap)) {
                if (lowerMsg.includes(lowerName)) {
                    result.company = realName;
                    break;
                }
            }
            
            if (pattern.type === 'statistics') {
                const specificWeekMatch = lowerMsg.match(/tuần\s*(\d+)/);
                const specificMonthMatch = lowerMsg.match(/tháng\s*(\d+)/);
                const specificYearMatch = lowerMsg.match(/năm\s*(\d{4})/);
                const specificQuarterMatch = lowerMsg.match(/quý\s*(\d+)/);

                // QUY TẮC MỚI: Nếu hỏi sâu vào lịch sử (Có số tháng/tuần/năm/quý cụ thể) -> REDIRECT TẤT CẢ
                if (specificWeekMatch || specificMonthMatch || specificYearMatch || specificQuarterMatch) {
                    result.requiresRedirect = true;
                    return result; 
                }

                // KIỂM TRA QUÁ KHỨ GẦN NHẤT (Trạng thái an toàn được phép xử lý)
                const isKhoan = lowerMsg.includes('khoán');
                const isKyThuPhi = lowerMsg.includes('kỳ') || lowerMsg.includes('thu phí') || isKhoan;

                if (lowerMsg.includes('năm trước') || lowerMsg.includes('năm ngoái')) {
                    result.timeframe = isKyThuPhi ? 'billing' : 'year';
                    const d = new Date();
                    d.setFullYear(d.getFullYear() - 1);
                    result.targetDateExact = d.toISOString();
                } else if (lowerMsg.includes('kỳ trước')) {
                    result.timeframe = 'billing'; // Bắt buộc là billing
                    const d = new Date();
                    d.setMonth(d.getMonth() - 1);
                    d.setDate(15); // Neo vào giữa tháng trước để lọt đúng kỳ cũ
                    result.targetDateExact = d.toISOString();
                } else if (lowerMsg.includes('tháng trước')) {
                    result.timeframe = isKyThuPhi ? 'billing' : 'month'; // Hỗ trợ câu "Khoán tháng trước"
                    const d = new Date();
                    d.setMonth(d.getMonth() - 1);
                    d.setDate(15);
                    result.targetDateExact = d.toISOString();
                } else if (lowerMsg.includes('tuần trước')) {
                    result.timeframe = 'week'; 
                    const d = new Date();
                    d.setDate(d.getDate() - 7);
                    result.targetDateExact = d.toISOString();
                } else {
                    // TRƯỜNG HỢP HỎI HIỆN TẠI (tuần này, tháng này, kỳ này...)
                    if (lowerMsg.includes('tuần')) result.timeframe = 'week';
                    else if (isKyThuPhi) result.timeframe = 'billing';
                    else if (lowerMsg.includes('tháng')) result.timeframe = 'month';
                    else if (lowerMsg.includes('năm')) result.timeframe = 'year';
                }
            }
            
            // NẾU LÀ CÂU HỎI LƯU LƯỢNG MÀ KHÔNG GHI THỜI GIAN -> MẶC ĐỊNH TÍNH THEO KỲ THU PHÍ
            // SỬA LỖI: Mặc định phải là 'kỳ thu phí' (billing) vì đây là mục đích chính của hệ thống.
            // Chỉ tính theo 'tháng' khi người dùng nói rõ "tháng này", "tháng trước", v.v.
            if (pattern.type === 'statistics' && !result.timeframe) {
                result.timeframe = 'billing';
            }
            
            return result;
        }
    }
    
    return null;
}

/**
 * Reset lịch sử hội thoại
 */
export function resetConversation() {
    conversationHistory = [
        {
            role: "user",
            parts: [{ text: SYSTEM_CONTEXT }]
        },
        {
            role: "model",
        parts: [{ text: WELCOME_MESSAGE }]
        }
    ];
}

/**
 * Kiểm tra API key có hợp lệ không
 */
export function hasValidAPIKey() {
    return isValidAPIKey;
}
