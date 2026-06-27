import { initMenu } from "./menu.js"; // Giữ nguyên
import { auth, addLog, showSwal, db, collection, query, getDocs, where, orderBy, limit } from "./script.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
// Import AI chatbot functions
import { getAIResponse, detectDataQuery, resetConversation, hasValidAPIKey, formatDataResponse, getWelcomeMessage, searchAIKnowledge, initDynamicChatbotData } from "./chatbot-ai.js?v=6";



// Import Firebase query functions
import {
    getLatestCompanyIndex,
    getCompanyIndexHistory,
    getTotalCompanies,
    getAllCompanies,
    getHolidays,
    getNextHoliday,
    getSpecialWorkdays,
    getAutoplanRules,
    getCachedSchedule,
    calculateAndCacheSchedule,
    getAdvancedStatistics,
    getCompanyHolidayConfig,
    getDefaultHolidays,
    syncDeltaReports1,
    syncDeltaReports2
} from "./chatbot-firebase-queries.js?v=6";

// load menu
fetch("menu.html").then(r => r.text()).then(h => {
    document.getElementById("menu-placeholder").innerHTML = h;
    initMenu();

    // Attach submit handler to the inline homepage login form (if present)
    const homeForm = document.getElementById('homeLoginForm');
    if (homeForm) {
        homeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = (document.getElementById('homeEmail') || {}).value || '';
            const password = (document.getElementById('homePassword') || {}).value || '';
            try {
                await signInWithEmailAndPassword(auth, email, password);
                await addLog('login_success', { email, status: 'success', timestamp: new Date().toISOString(), userAgent: navigator.userAgent });
                showSwal('success', 'Đăng nhập thành công!');
                homeForm.reset();
            } catch (err) {
                console.error('LOGIN FAIL (home):', err);
                try { await addLog('login_failure', { email, status: 'error', error_code: err.code, error_message: err.message, timestamp: new Date().toISOString(), userAgent: navigator.userAgent }); } catch (e) { }
                showSwal('error', 'Đăng nhập thất bại. Vui lòng kiểm tra lại tài khoản.');
            }
        });
    }
});

// load modal 
fetch("modal.html").then(r => r.text()).then(h => {
    document.getElementById("loading-placeholder").innerHTML = h;
});
// TẢI FOOTER (thêm đoạn này vào)
fetch("footer.html").then(r => r.text()).then(h => {
    document.getElementById("footer-placeholder").innerHTML = h;
});

// Loại bỏ hoàn toàn logic kiểm tra đăng nhập để trang luôn hiển thị

// Setup footer date and marquee behavior
(function () {
    const dEl = document.getElementById('homeFooterDate');
    if (dEl) dEl.textContent = new Date().toLocaleDateString('vi-VN');
    const mq = document.getElementById('homeMarquee');
    if (mq) {
        mq.addEventListener('mouseenter', () => mq.style.animationPlayState = 'paused');
        mq.addEventListener('mouseleave', () => mq.style.animationPlayState = 'running');
    }
})();

// Chat functionality
(function () { // Đơn giản hóa thành một IIFE duy nhất
    const chatToggle = document.getElementById('chatToggle');
    const chatContainer = document.getElementById('chatContainer');
    const chatClose = document.getElementById('chatClose');
    const chatInput = document.getElementById('chatInput');
    const chatSubmit = document.getElementById('chatSubmit');
    const chatMessages = document.getElementById('chatMessages');

    let allCompanies = []; // Biến lưu danh sách công ty
    let fuse; // Biến cho Fuse.js
    let lastMentionedCompany = null; // Biến lưu tên công ty được nhắc đến gần nhất
    let companySearchTerm = null; // Khai báo biến này ở đây
    let chatbotState = 'idle'; // 'idle', 'waitingForCompanyIndexCompany'
    let lastIntent = null; // e.g., 'getLatestCompanyIndex'

    // Hàm khởi tạo: Tải danh sách công ty một lần
    async function initializeChatbot() {
        try {
            await initDynamicChatbotData();
            // ⭐️ TỐI ƯU HÓA: Chỉ đọc Master List thay vì quét toàn bộ reports_1
            const companiesRef = collection(db, "companies_master");
            const snapshot = await getDocs(companiesRef);
            const uniqueCompanies = new Set();
            snapshot.forEach(doc => {
                if (doc.data().company) uniqueCompanies.add(doc.data().company);
            });
            allCompanies = Array.from(uniqueCompanies);
            fuse = new Fuse(allCompanies, { includeScore: true, threshold: 0.4 }); // Cấu hình Fuse.js
            console.log("Chatbot initialized with companies:", allCompanies);
        } catch (error) { console.error("Failed to initialize chatbot companies:", error); }
    }

    // Toggle chat visibility
    chatToggle.addEventListener('click', () => {
        chatContainer.classList.remove('hidden');
    });

    chatClose.addEventListener('click', () => {
        chatContainer.classList.add('hidden');
    });

    // Handle message submission
    function addMessage(content, isUser = false, isHtml = false) {
        // Xóa hiệu ứng "Đang gõ" nếu có (khi bot chuẩn bị trả lời)
        if (!isUser) {
            const typingMsg = chatMessages.querySelector('.typing-message');
            if (typingMsg) typingMsg.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`; // Gán class
        if (isHtml) {
            messageDiv.innerHTML = content;
        } else {
            // Parse markdown
            let parsedContent = content
                .replace(/\$m\^3\$/g, 'm³') // Gọt lỗi hiển thị m3 dạng LaTeX 1
                .replace(/m\^3/g, 'm³')     // Gọt lỗi hiển thị m3 dạng LaTeX 2

                // 1. Phải xử lý `code` trước để tránh các ký tự bên trong code block bị dính định dạng khác
                .replace(/`(.+?)`/g, '<code>$1</code>')

                // 2. Xử lý BOLD (dấu ** đôi) TRƯỚC dấu * đơn
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

                // 3. Xử lý ITALIC (dấu * đơn) SAU, dùng [^*] để ép nó không ăn vào thẻ strong
                .replace(/\*([^*]+?)\*/g, '<em>$1</em>')

                // Xử lý LINK markdown [text](url)
                .replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+?)\)/g, '<a href="$2" target="_blank" style="color: #3498db; text-decoration: underline; font-weight: bold;">$1</a>')

                // 4. Sửa lại Regex của BUTTON (Thêm ngoặc tròn () để tạo nhóm $1)
                .replace(new RegExp('\\[BUTTON\\](.*?)\\[/BUTTON\\]', 'g'), '<button class="suggestion-btn">$1</button>')

                // 5. Xuống dòng xử lý cuối cùng
                .replace(/\n/g, '<br>');

            messageDiv.innerHTML = parsedContent;
        }
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Nếu là tin nhắn có nút xác nhận, thêm event listener
        if (isHtml && content.includes('confirm-btn')) {
            messageDiv.querySelectorAll('.confirm-btn').forEach(btn => {
                btn.addEventListener('click', handleConfirmationClick, { once: true });
            });
        }
    }

    // Lắng nghe sự kiện click trên các nút gợi ý
    chatMessages.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('suggestion-btn')) {
            const question = e.target.textContent;
            handleUserInput(question);
        }
    });

    // Hàm xử lý khi người dùng nhấn nút "Đúng" / "Không"
    async function handleConfirmationClick(event) {
        const button = event.target;
        const isConfirmed = button.dataset.confirmed === 'yes';
        const companyName = button.dataset.company;

        // Vô hiệu hóa các nút trong tin nhắn này
        button.parentElement.querySelectorAll('.confirm-btn').forEach(b => b.disabled = true);

        if (isConfirmed) {
            lastMentionedCompany = companyName; // Set lastMentionedCompany on confirmation

            // Hiện "đang gõ..." khi đang chui vào Firebase lấy dữ liệu
            const typingDiv = document.createElement('div');
            typingDiv.className = 'message bot-message typing-message';
            typingDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            const response = await getLatestCompanyIndexFromFirebase(companyName);
            setTimeout(() => addMessage(response), 300);
        } else { setTimeout(() => addMessage("Xin lỗi, vậy bạn vui lòng gõ lại tên công ty chính xác hơn nhé."), 300); }
    }

    // Hàm: Lấy số lượng công ty từ Firebase
    async function getCompanyCountFromFirebase() {
        try {
            const companiesRef = collection(db, "reports_1");
            const snapshot = await getDocs(companiesRef);
            const uniqueCompanies = new Set();
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.company) {
                    uniqueCompanies.add(data.company);
                }
            });
            return `Hiện tại có ${uniqueCompanies.size} công ty trong KCN Thốt Nốt.`;
        } catch (error) {
            console.error("Chatbot Error - getCompanyCountFromFirebase:", error);
            return "Xin lỗi, tôi không thể lấy thông tin số lượng công ty lúc này.";
        }
    }

    // Hàm: Lấy chỉ số mới nhất của một công ty từ Firebase
    async function getLatestCompanyIndexFromFirebase(companyName) {
        try {
            const reportsRef = collection(db, "reports_1");
            const q = query(
                reportsRef,
                where("company", "==", companyName),
                orderBy("ngay_ghi", "desc"), // Giả định 'ngay_ghi' là chuỗi ngày có thể sắp xếp (YYYY-MM-DD)
                orderBy("createdAt", "desc"), // Sắp xếp phụ nếu có nhiều báo cáo cùng ngày
                limit(1) // Chỉ lấy báo cáo mới nhất
            );
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                const latestReport = snapshot.docs[0].data();
                const chiSo = latestReport.chi_so ? latestReport.chi_so.toLocaleString('vi-VN') : 'N/A';
                const ngayGhi = latestReport.ngay_ghi || 'N/A';
                return `Chỉ số mới nhất của ${companyName} là ${chiSo} vào ngày ${ngayGhi}.`;
            } else {
                return `Không tìm thấy chỉ số nào cho công ty ${companyName}.`;
            }
        } catch (error) {
            console.error(`Chatbot Error - getLatestCompanyIndexFromFirebase for ${companyName}:`, error);
            return `Xin lỗi, tôi không thể lấy chỉ số mới nhất của ${companyName} lúc này.`;
        }
    }

    async function handleUserInput(userMessage) {
        // Add user message to chat
        addMessage(userMessage, true);

        // Hiển thị hiệu ứng "Đang gõ..." của Bot
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot-message typing-message';
        typingDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // 🛡️ BẢO VỆ LỚP 1: Khóa giao diện trong lúc chờ AI
        chatSubmit.disabled = true;
        chatInput.disabled = true;
        chatSubmit.textContent = '...';
        chatSubmit.style.background = '#6c757d';

        const lowerMsg = userMessage.toLowerCase();

        // ====== AI-POWERED CHATBOT ======
        // Bước 1: Kiểm tra xem có cần truy vấn database không
        const dataQuery = detectDataQuery(userMessage);
        console.log('🔍 detectDataQuery result:', dataQuery);
        let contextData = null;

        // --- XỬ LÝ QUY TẮC REDIRECT CHO LỊCH SỬ LƯU LƯỢNG CỤ THỂ ---
        if (dataQuery && dataQuery.requiresRedirect) {
            setTimeout(() => {
                addMessage(`Dữ liệu đã được tải, bạn có thể truy cập <a href="https://bachtoanlx.github.io/KCNThotNotv4/statistics.html" target="_blank" style="color: #034892; font-weight: bold; text-decoration: underline;">Thống kê lưu lượng</a> để xem chi tiết. Thank!`, false, true);
                chatSubmit.disabled = false;
                chatInput.disabled = false;
                chatSubmit.textContent = 'Gửi';
                chatSubmit.style.background = '#1f3765';
            }, 500);
            return; // Dừng, không gọi AI và Firebase (Tiết kiệm tài nguyên)
        }

        // Bước 2: Nếu cần truy vấn dữ liệu, lấy dữ liệu trước
        if (dataQuery) {
            // KIỂM TRA ĐĂNG NHẬP: Nếu cần dữ liệu mà chưa đăng nhập thì chặn lại
            // KIỂM TRA ĐĂNG NHẬP: Nếu cần dữ liệu hệ thống mà chưa đăng nhập thì chặn lại (bỏ qua nếu chỉ truy vấn Quy chế/Kiến thức RAG công cộng)
            if (!auth.currentUser && dataQuery.type !== 'rag_knowledge') {
                setTimeout(() => addMessage("⚠️ Bạn cần <b>đăng nhập</b> để tra cứu dữ liệu chi tiết (chỉ số, ngày nghỉ, thống kê...).", false, true), 500);
                chatSubmit.disabled = false;
                chatInput.disabled = false;
                chatSubmit.textContent = 'Gửi';
                chatSubmit.style.background = '#1f3765';
                return; // Dừng xử lý, không gọi AI tốn quota
            }

            try {
                switch (dataQuery.type) {
                    case 'rag_knowledge':
                        const matches = searchAIKnowledge(userMessage);
                        contextData = { rag_knowledge: matches };
                        break;

                    case 'companyList':
                        // Lấy danh sách và số lượng công ty được phân nhóm
                        const companyList = await getAllCompanies();
                        contextData = { companyList: companyList };
                        break;

                    case 'companyData':
                        if (dataQuery.company) {
                            // Lấy chỉ số mới nhất của công ty
                            console.log('📊 Fetching data for company:', dataQuery.company);
                            const latestData = await getLatestCompanyIndex(dataQuery.company);
                            console.log('📊 Latest data:', latestData);
                            contextData = { companyData: latestData };
                        } else {
                            // Tìm kiếm fuzzy để gợi ý công ty
                            console.log('🔎 Running fuzzy search for:', userMessage);
                            if (!fuse) {
                                console.warn('⚠️ Hệ thống tìm kiếm chưa sẵn sàng.');
                                break;
                            }
                            const results = fuse.search(userMessage);
                            console.log('🔎 Fuzzy results:', results);
                            if (results.length > 0 && results[0].score < 0.3) {
                                const suggestion = results[0].item;
                                const confirmationHtml = `<p>Ý bạn là "${suggestion}" phải không?</p>
                                    <button class="confirm-btn" data-confirmed="yes" data-company="${suggestion}">Đúng</button>
                                    <button class="confirm-btn" data-confirmed="no">Không</button>`;
                                setTimeout(() => addMessage(confirmationHtml, false, true), 500);
                                chatSubmit.disabled = false;
                                chatInput.disabled = false;
                                chatSubmit.textContent = 'Gửi';
                                chatSubmit.style.background = '#1f3765';
                                return;
                            } else {
                                console.warn('⚠️ No fuzzy match found or score too low');
                            }
                        }
                        break;

                    case 'holidayData':
                        // Lấy ngày nghỉ theo thời gian yêu cầu
                        let hYear = dataQuery.targetYear || new Date().getFullYear();
                        let hMonth = dataQuery.targetMonth || (new Date().getMonth() + 1);
                        let startDate = `${hYear}-${String(hMonth).padStart(2, '0')}-01`;
                        let endDate = `${hYear}-${String(hMonth).padStart(2, '0')}-31`;

                        let holidays = await getHolidays(startDate, endDate);
                        let defaultHolidayConfig = null;
                        let allDefaultHolidays = null;
                        // Lọc đúng công ty nếu người dùng có nhắc đến tên công ty
                        if (dataQuery.company) {
                            holidays = holidays.filter(h => h.company === dataQuery.company);
                            defaultHolidayConfig = await getCompanyHolidayConfig(dataQuery.company);
                        } else {
                            allDefaultHolidays = await getDefaultHolidays();
                        }
                        const nextHoliday = await getNextHoliday();
                        contextData = { holidays, nextHoliday, company: dataQuery.company, defaultHolidayConfig, allDefaultHolidays };
                        break;

                    case 'specialWorkday':
                        // Lấy ngày làm việc đặc biệt
                        const now2 = new Date();
                        const start2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}-01`;
                        const end2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}-31`;
                        const specialDays = await getSpecialWorkdays(start2, end2);
                        contextData = { specialWorkdays: specialDays };
                        break;

                    case 'statistics':
                        // Phân tích Timeframe
                        // Động cơ detectDataQuery đã chuẩn hóa timeframe thành 'week', 'month', 'billing', 'year'
                        const timeMode = dataQuery.timeframe;

                        // Phân tích Target Date (Cỗ máy thời gian)
                        let targetDateObj = null;
                        if (dataQuery.targetDateExact) {
                            targetDateObj = new Date(dataQuery.targetDateExact);
                        }

                        // Sử dụng Động cơ Thống kê mới
                        const advStats = await getAdvancedStatistics(timeMode, dataQuery.company || null, targetDateObj);
                        if (advStats) {
                            contextData = { advancedStats: advStats };
                        } else {
                            contextData = { error: 'Lỗi tính toán mốc thời gian.' };
                        }
                        break;

                    case 'history':
                        // Lấy lịch sử công ty (nếu có company trong dataQuery)
                        if (dataQuery.company) {
                            const now3 = new Date();
                            const start3 = new Date(now3.getFullYear(), now3.getMonth(), 1);
                            const end3 = new Date(now3.getFullYear(), now3.getMonth() + 1, 0);
                            const startStr = start3.toISOString().split('T')[0];
                            const endStr = end3.toISOString().split('T')[0];
                            const history = await getCompanyIndexHistory(dataQuery.company, startStr, endStr);
                            contextData = { history, company: dataQuery.company };
                        }
                        break;

                    case 'autoplan':
                        // Lấy danh sách Autoplan

                        // --- LOGIC MỚI: Thử tìm ngày cụ thể trong câu hỏi để lấy Cache ---
                        let cachedData = null;
                        let targetDateStr = "";

                        const lowerMsgStr = userMessage.toLowerCase();
                        const dateMatch = lowerMsgStr.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
                        const dNow = new Date();

                        if (dateMatch) {
                            const day = dateMatch[1].padStart(2, '0');
                            const month = dateMatch[2].padStart(2, '0');
                            const year = dateMatch[3] || dNow.getFullYear();
                            targetDateStr = `${year}-${month}-${day}`;
                        } else if (lowerMsgStr.includes("ngày mai") || lowerMsgStr.includes("mai")) {
                            dNow.setDate(dNow.getDate() + 1);
                            targetDateStr = `${dNow.getFullYear()}-${String(dNow.getMonth() + 1).padStart(2, '0')}-${String(dNow.getDate()).padStart(2, '0')}`;
                        } else if (lowerMsgStr.includes("hôm qua") || lowerMsgStr.includes("qua")) {
                            dNow.setDate(dNow.getDate() - 1);
                            targetDateStr = `${dNow.getFullYear()}-${String(dNow.getMonth() + 1).padStart(2, '0')}-${String(dNow.getDate()).padStart(2, '0')}`;
                        } else {
                            // Mặc định là hôm nay
                            targetDateStr = `${dNow.getFullYear()}-${String(dNow.getMonth() + 1).padStart(2, '0')}-${String(dNow.getDate()).padStart(2, '0')}`;
                        }

                        console.log(`🔍 Đang kiểm tra lịch trực ngày: ${targetDateStr}`);
                        cachedData = await getCachedSchedule(targetDateStr);

                        let finalScheduleContent = "";

                        if (cachedData) {
                            console.log('✅ Tìm thấy lịch Cache:', cachedData);
                            finalScheduleContent = cachedData.content;
                        } else if (targetDateStr) {
                            // Nếu chưa có cache, dùng JS tính toán ngay lập tức và lưu lại
                            console.log('⚠️ Chưa có cache, đang tính toán JS...');
                            finalScheduleContent = await calculateAndCacheSchedule(targetDateStr);
                        }
                        // ----------------------------------------------------------------

                        // Gửi thêm ngày hiện tại để AI tính toán lịch cho năm nay
                        contextData = {
                            calculatedSchedule: finalScheduleContent, // Chỉ gửi kết quả cuối cùng
                            targetDate: targetDateStr,
                            currentDate: new Date().toLocaleDateString('vi-VN'),
                            note: "Dữ liệu lịch trực đã được tính toán sẵn."
                        };
                        break;

                    default:
                        // Không có query type cụ thể
                        break;
                }
            } catch (error) {
                console.error('Error fetching data:', error);
                contextData = { error: 'Không thể lấy dữ liệu từ database' };
            }
        }

        // Bước 3: Nếu đã có dữ liệu cấu trúc → format trực tiếp, KHÔNG gọi AI
        const directResponse = formatDataResponse(contextData, userMessage);
        if (directResponse) {
            setTimeout(() => {
                addMessage(directResponse);
                chatSubmit.disabled = false;
                chatInput.disabled = false;
                chatSubmit.textContent = 'Gửi';
                chatSubmit.style.background = '#1f3765';
            }, 300);
            return;
        }

        // Bước 4: Không có dữ liệu cấu trúc → gọi AI (câu hỏi hội thoại thuần tuý)
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Yêu cầu quá hạn (Timeout 30s)")), 30000)
        );

        let aiResponse;
        try {
            aiResponse = await Promise.race([
                getAIResponse(userMessage, contextData),
                timeoutPromise
            ]);
        } catch (e) {
            console.error("AI Request failed or timed out:", e);
            aiResponse = `⚠️ **Yêu cầu không phản hồi.**\n\nKết nối với máy chủ AI bị quá hạn. Vui lòng thử lại sau.\n\n*(Chi tiết: ${e.message})*`;
        }

        setTimeout(() => {
            addMessage(aiResponse);
            chatSubmit.disabled = false;
            chatInput.disabled = false;
            chatSubmit.textContent = 'Gửi';
            chatSubmit.style.background = '#1f3765';
        }, 500);
    }


    // Handle submit button click
    chatSubmit.addEventListener('click', () => {
        const message = chatInput.value.trim();
        if (message) {
            handleUserInput(message);
            chatInput.value = '';
        }
    });

    // Handle enter key press
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const message = chatInput.value.trim();
            if (message) {
                handleUserInput(message);
                chatInput.value = '';
            }
        }
    });

    // Handle reset button
    const chatReset = document.getElementById('chatReset');
    chatReset.addEventListener('click', () => {
        resetConversation();
        chatMessages.innerHTML = '';
        addMessage(getWelcomeMessage());
    });

    // Khởi tạo chatbot khi trang tải xong
    // Chỉ khởi tạo dữ liệu tìm kiếm nếu đã đăng nhập (để tránh lỗi permission denied trong console)
    auth.onAuthStateChanged(async (user) => {
        const homeLoginBox = document.querySelector('.home-login-box');
        const chatDisclaimer = document.querySelector('.chat-disclaimer');

        if (user) {
            await initializeChatbot();
            // Ẩn box đăng nhập nhanh nếu đã đăng nhập
            if (homeLoginBox) homeLoginBox.style.display = 'none';
            if (chatDisclaimer) chatDisclaimer.style.display = 'block';

            // Chạy đồng bộ ngầm IndexedDB cho reports_1 và reports_2
            console.log("🔄 Khởi chạy đồng bộ ngầm IndexedDB...");
            syncDeltaReports1().then(() => {
                console.log("✅ Đồng bộ ngầm reports_1 hoàn tất.");
            }).catch(err => {
                console.warn("❌ Đồng bộ ngầm reports_1 thất bại:", err);
            });

            syncDeltaReports2().then(() => {
                console.log("✅ Đồng bộ ngầm reports_2 hoàn tất.");
            }).catch(err => {
                console.warn("❌ Đồng bộ ngầm reports_2 thất bại:", err);
            });
        } else {
            // Hiện box đăng nhập nhanh nếu chưa đăng nhập
            if (homeLoginBox) homeLoginBox.style.display = 'block';
            if (chatDisclaimer) chatDisclaimer.style.display = 'none';
            
            // Tải cấu hình chào mừng và proxy cho khách vãng lai
            await initializeChatbot();
        }
        
        // Luôn hiển thị hoặc cập nhật tin nhắn chào mừng phù hợp với quyền hạn của user
        resetConversation();
        chatMessages.innerHTML = '';
        addMessage(getWelcomeMessage());
    });

    // Kiểm tra và hiển thị trạng thái AI
    const aiStatusEl = document.getElementById('aiStatus');
    if (aiStatusEl) {
        if (!hasValidAPIKey()) {
            aiStatusEl.textContent = '(Chế độ cơ bản)';
            aiStatusEl.title = 'Chưa có API key. Chatbot hoạt động ở chế độ giới hạn. Xem GEMINI_API_SETUP.md để cấu hình AI.';
            aiStatusEl.style.color = '#ffa500';
        } else {
            aiStatusEl.textContent = '(AI)';
            aiStatusEl.title = 'Chatbot đang sử dụng Google Gemini AI';
            aiStatusEl.style.color = '#00ff00';
        }
    }
})();

// Digital Clock Logic
(function () {
    const h1 = document.getElementById('hour1');
    const h2 = document.getElementById('hour2');
    const m1 = document.getElementById('min1');
    const m2 = document.getElementById('min2');
    const s1 = document.getElementById('sec1');
    const s2 = document.getElementById('sec2');

    // Prevent script from crashing if elements are missing
    if (!h1 || !h2 || !m1 || !m2 || !s1 || !s2) return;

    function updateDigit(element, newValue) {
        if (element.textContent !== newValue) {
            element.classList.remove('update');
            // force reflow
            void element.offsetWidth;
            element.textContent = newValue;
            element.classList.add('update');
        }
    }

    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');

        updateDigit(h1, h[0]);
        updateDigit(h2, h[1]);
        updateDigit(m1, m[0]);
        updateDigit(m2, m[1]);
        updateDigit(s1, s[0]);
        updateDigit(s2, s[1]);
    }

    setInterval(updateClock, 1000);
    updateClock();
})();