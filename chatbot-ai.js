// Chatbot AI using Google Gemini
import { CONFIG } from './config.js';

// ========== CẤU HÌNH PROXY ==========
// CÁCH 1: Sử dụng Google Apps Script Proxy (bảo mật API Key)
const USE_PROXY = true; // Đổi thành true khi đã setup proxy
const PROXY_URL = 'https://script.google.com/macros/s/AKfycbxUECm-8_DoYZwJTf9mle24TcphZXClID-fTNqD2CRRHyoZpkquyQlsQy_bhdLCLEu8XQ/exec'; // Thay bằng URL từ Apps Script

// CÁCH 2: Gọi trực tiếp (KHÔNG an toàn khi public)
const DIRECT_API_KEY = CONFIG.GEMINI_API_KEY;

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
const isValidAPIKey = GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE' && GEMINI_API_KEY.startsWith('AIza');

// System prompt để định nghĩa vai trò và kiến thức của chatbot
const SYSTEM_CONTEXT = `
Bạn là trợ lý ảo thông minh của Trung Tâm Xây Dựng Hạ Tầng Khu Công Nghiệp Thốt Nốt, Cần Thơ.

THÔNG TIN CƠ BẢN:
- Địa chỉ: KV Thới Hòa 1, P. Thốt Nốt, TP Cần Thơ
- Giờ làm việc: 7:30 - 17:00 (Thứ 2 - Thứ 6)
- Chức năng chính: Quản lý tiêu thụ điện nước các công ty trong KCN

HỆ THỐNG QUẢN LÝ:
- Theo dõi chỉ số đồng hồ điện/nước của các công ty
- Quản lý ngày nghỉ, ngày làm việc đặc biệt
- Thống kê báo cáo tiêu thụ theo tuần/tháng/năm
- Tính toán khoán tiêu thụ dựa trên ngày làm việc
- Hệ số khoán (quota multipliers) cho từng công ty
- Cấu hình ngày bắt đầu tuần/tháng/năm/kỳ thanh toán

CÁC CÔNG TY TRONG KCN:
- Nhóm 1 (đồng hồ): NTSF, Ấn Độ Dương, Đại Tây Dương, Cá Việt Nam, Amicogen
- Nhóm 2 (khoán): VNPT, Hiệp Phú, Honoroad, Trường Hải, Petec, Tân Cảng

KHẢ NĂNG TRUY VẤN DỮ LIỆU:
1. Chỉ số công ty: Xem chỉ số mới nhất, lịch sử tiêu thụ, so sánh giữa các công ty
2. Ngày nghỉ/làm việc: Danh sách ngày nghỉ, ngày nghỉ sắp tới, ngày làm việc đặc biệt
3. Thống kê: Tổng tiêu thụ tuần/tháng, trung bình, top công ty tiêu thụ nhiều nhất
4. Cấu hình hệ thống: Hệ số khoán, ngày bắt đầu các kỳ báo cáo
5. Danh sách công ty: Tổng số công ty, tên tất cả công ty

CÂU HỎI MẪU BẠN CÓ THỂ TRẢ LỜI:
- "Chỉ số mới nhất của NTSF là bao nhiêu?"
- "Ngày nghỉ tháng này có những ngày nào?"
- "Thống kê tiêu thụ tuần này"
- "Top 5 công ty tiêu thụ nhiều nhất"
- "Hệ số khoán của VNPT là bao nhiêu?"
- "Có bao nhiêu công ty trong KCN?"
- "Ngày bắt đầu kỳ thanh toán là khi nào?"

NHIỆM VỤ CỦA BẠN:
1. Trả lời các câu hỏi về KCN Thốt Nốt dựa trên dữ liệu thực từ Firebase
2. Hỗ trợ người dùng tìm hiểu về hệ thống quản lý
3. Giải thích các chức năng, báo cáo, thống kê
4. Hướng dẫn sử dụng hệ thống khi được hỏi
5. Định dạng số liệu rõ ràng (dùng dấu chấm phân cách hàng nghìn)

CÁCH TRẢ LỜI:
- Ngắn gọn, rõ ràng, thân thiện
- Sử dụng tiếng Việt
- Nếu có contextData từ database, dùng nó để trả lời chính xác
- Định dạng số đẹp (VD: 1.234.567 thay vì 1234567)
- Với danh sách dài, chỉ hiển thị top 5-10 kèm tổng số
- Nếu không có dữ liệu, giải thích rõ ràng
`;

// Lịch sử hội thoại để duy trì ngữ cảnh
let conversationHistory = [
    {
        role: "user",
        parts: [{ text: SYSTEM_CONTEXT }]
    },
    {
        role: "model",
        parts: [{ text: "Tôi hiểu rồi. Tôi sẽ hỗ trợ người dùng về KCN Thốt Nốt một cách thân thiện và chuyên nghiệp." }]
    }
];

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
                        const response = await fetch(PROXY_URL, {
                            method: 'POST',
                            headers: { 
                                'Content-Type': 'text/plain' // Dùng text/plain để tránh CORS preflight
                            },
                            body: JSON.stringify({
                                model: GEMINI_MODELS[0],
                                contents: conversationHistory
                            })
                        });
                        
                        if (!response.ok) {
                            const errorText = await response.text();
                            console.error('Proxy error:', response.status, errorText);
                            throw new Error(`Proxy error: ${response.status}`);
                        }
                        
                        data = await response.json();
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
        // Nếu lỗi API, dùng fallback
        return getFallbackResponse(userMessage, contextData);
    }
}

/**
 * Fallback response khi không có API key hoặc API lỗi
 * @param {string} userMessage - Tin nhắn từ người dùng
 * @param {object} contextData - Dữ liệu ngữ cảnh
 * @returns {string} - Câu trả lời đơn giản
 */
function getFallbackResponse(userMessage, contextData) {
    const lowerMsg = userMessage.toLowerCase();
    
    // Nếu có dữ liệu từ Firebase, trả về dữ liệu đó
    if (contextData) {
        if (contextData.totalCompanies) {
            return contextData.totalCompanies;
        }
        if (contextData.companyData) {
            return contextData.companyData;
        }
    }
    
    // Các câu trả lời cơ bản
    const responses = {
        'xin chào': 'Xin chào! Tôi là trợ lý ảo của KCN Thốt Nốt. Tôi có thể giúp gì cho bạn?\n\n💡 Bạn có thể hỏi về:\n- Địa chỉ, giờ làm việc\n- Số lượng công ty\n- Chỉ số tiêu thụ của công ty',
        'hello': 'Hello! Tôi có thể giúp gì cho bạn?',
        'địa chỉ': 'Trung tâm tọa lạc tại: KV Thới Hòa 1, P. Thốt Nốt, TP Cần Thơ',
        'giờ làm việc': 'Giờ làm việc: 7:30 - 17:00 (Thứ 2 - Thứ 6)',
        'cảm ơn': 'Rất vui được giúp bạn! 😊',
        'tạm biệt': 'Tạm biệt! Hẹn gặp lại bạn.',
    };
    
    // Tìm response phù hợp
    for (const [key, value] of Object.entries(responses)) {
        if (lowerMsg.includes(key)) {
            return value;
        }
    }
    
    // Response mặc định
    return `Tôi hiểu bạn đang hỏi về: "${userMessage}"\n\n⚠️ Chatbot đang chạy ở chế độ cơ bản (chưa có AI).\n\n📌 Để kích hoạt AI:\n1. Lấy API key từ: https://makersuite.google.com/app/apikey\n2. Mở file chatbot-ai.js\n3. Thay YOUR_GEMINI_API_KEY_HERE bằng key thực tế\n\nHiện tại tôi có thể trả lời:\n- Địa chỉ, giờ làm việc\n- Số lượng công ty (nếu kết nối DB)\n- Chỉ số công ty (nếu kết nối DB)`;
}

/**
 * Kiểm tra xem câu hỏi có cần truy vấn database không
 * @param {string} message - Tin nhắn từ người dùng
 * @returns {object|null} - Thông tin truy vấn cần thực hiện hoặc null
 */
export function detectDataQuery(message) {
    const lowerMsg = message.toLowerCase();
    
    // Map tên công ty viết thường -> tên chính xác trong DB
    const companyNameMap = {
        'ntsf': 'NTSF',
        'vnpt': 'VNPT',
        'amicogen': 'Amicogen',
        'hiệp phú': 'Hiệp Phú',
        'honoroad': 'Honoroad',
        'petec': 'Petec',
        'ấn độ dương': 'Ấn Độ Dương',
        'an do duong': 'Ấn Độ Dương',
        'ấn độ': 'Ấn Độ Dương',
        'đại tây dương': 'Đại Tây Dương',
        'dai tay duong': 'Đại Tây Dương',
        'đại tây': 'Đại Tây Dương',
        'cá việt nam': 'Cá Việt Nam',
        'ca viet nam': 'Cá Việt Nam',
        'trường hải': 'Trường Hải',
        'truong hai': 'Trường Hải',
        'tân cảng': 'Tân Cảng',
        'tan cang': 'Tân Cảng'
    };
    
    // Các pattern cần truy vấn dữ liệu (MỞ RỘNG)
    const patterns = [
        // 1. Chỉ số điện/nước của công ty cụ thể
        {
            keywords: ['chỉ số', 'tiêu thụ', 'đồng hồ', 'điện', 'nước', 'mới nhất', 'hiện tại'],
            type: 'companyData'
        },
        
        // 2. Danh sách ngày nghỉ
        {
            keywords: ['ngày nghỉ', 'nghỉ việc', 'holiday', 'nghỉ lễ', 'nghỉ phép', 'ngày lễ'],
            type: 'holidayData'
        },
        
        // 3. Ngày làm việc đặc biệt
        {
            keywords: ['ngày làm đặc biệt', 'làm việc đặc biệt', 'làm thêm', 'tăng ca'],
            type: 'specialWorkday'
        },
        
        // 4. Thống kê tổng quan
        {
            keywords: ['thống kê', 'báo cáo', 'tổng', 'trung bình', 'tổng tiêu thụ'],
            timeKeywords: ['tuần', 'tháng', 'năm', 'hôm nay', 'tuần này', 'tháng này', 'năm nay', 'week', 'month'],
            type: 'statistics'
        },
        
        // 5. So sánh công ty
        {
            keywords: ['so sánh', 'công ty nào', 'nhiều nhất', 'ít nhất', 'top', 'xếp hạng'],
            type: 'comparison'
        },
        
        // 6. Danh sách công ty
        {
            keywords: ['danh sách công ty', 'các công ty', 'có bao nhiêu công ty', 'liệt kê công ty', 'tất cả công ty'],
            type: 'companyList'
        },
        
        // 7. Hệ số khoán
        {
            keywords: ['hệ số khoán', 'khoán', 'quota', 'hệ số'],
            type: 'quotaMultipliers'
        },
        
        // 8. Cấu hình hệ thống
        {
            keywords: ['cấu hình', 'ngày bắt đầu', 'kỳ thanh toán', 'settings', 'config'],
            type: 'systemConfig'
        },
        
        // 9. Lịch sử tiêu thụ
        {
            keywords: ['lịch sử', 'theo thời gian', 'xu hướng', 'biến động'],
            type: 'history'
        }
    ];

    for (const pattern of patterns) {
        const hasKeyword = pattern.keywords.some(kw => lowerMsg.includes(kw));
        if (hasKeyword) {
            const result = { type: pattern.type, query: message };
            
            // Tìm tên công ty nếu có (pattern companyData)
            if (pattern.type === 'companyData') {
                for (const [lowerName, realName] of Object.entries(companyNameMap)) {
                    if (lowerMsg.includes(lowerName)) {
                        result.company = realName;
                        break;
                    }
                }
            }
            
            // Tìm khoảng thời gian nếu có
            if (pattern.timeKeywords) {
                const foundTime = pattern.timeKeywords.find(t => lowerMsg.includes(t));
                if (foundTime) {
                    result.timeframe = foundTime;
                }
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
            parts: [{ text: "Tôi hiểu rồi. Tôi sẽ hỗ trợ người dùng về KCN Thốt Nốt một cách thân thiện và chuyên nghiệp." }]
        }
    ];
}

/**
 * Kiểm tra API key có hợp lệ không
 */
export function hasValidAPIKey() {
    return isValidAPIKey;
}
