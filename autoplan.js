import { auth, db, onAuth, getRole, addLog, showSwal, showLoading, hideLoading, getCurrentUserEmail, fetchAllUsers } from "./script.js";
    import { collection, addDoc, deleteDoc, doc, getDocs, serverTimestamp, updateDoc, onSnapshot, query, limit } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
    import { initMenu } from "./menu.js";
    import { getWeekNumber, getWeekOfMonth, getDaysDifference, isRuleActiveOnDate, sortShiftRules, ruleMatchesDate, getLastMatchDate, getNextMatchDate, getNormalizedFirstChar, getWorkersForDateMonth } from "./autoplan-core.js";


    // === Load menu, modal và footer===
    fetch("menu.html").then(r => r.text()).then(h => {
      document.getElementById("menu-placeholder").innerHTML = h;
      initMenu();
    });
    fetch("modal.html").then(r => r.text()).then(h => {
      document.getElementById("loading-placeholder").innerHTML = h;
    });
    fetch("footer.html").then(r => r.text()).then(h => {
        document.getElementById("footer-placeholder").innerHTML = h;
    });

    const notLogged = document.getElementById("notLogged");
    const content = document.getElementById("pageContent");
    const footerPlaceholder = document.getElementById("footer-placeholder");
    let currentlyViewedDate = new Date();


    const scheduleBody = document.getElementById("scheduleBody");
    const ruleListBody = document.querySelector("#ruleList tbody");
    const jobInput = document.getElementById("jobName");
    const daySelect = document.getElementById("daySelect");
    const weekSelect = document.getElementById("weekSelect");
    const monthSelect = document.getElementById("monthSelect"); 
    const domSelect = document.getElementById("domSelect");
    const adminConfig = document.getElementById("adminConfig");
    
    // Logic checkbox độc quyền
    document.getElementById("isAdminJobRuleCheckbox").addEventListener("change", function() {
        if (this.checked) document.getElementById("isCommonJobRuleCheckbox").checked = false;
    });
    document.getElementById("isCommonJobRuleCheckbox").addEventListener("change", function() {
        if (this.checked) document.getElementById("isAdminJobRuleCheckbox").checked = false;
        document.getElementById("addCommonJobSettings").style.display = this.checked ? "block" : "none";
        
        if (this.checked) {
            document.getElementById("addCommonJobNotifyTime").value = "immediate"; // Chọn mặc định: Ngay lập tức
        }
    });
    document.getElementById("editRuleIsAdminCheckbox").addEventListener("change", function() {
        if (this.checked) document.getElementById("editRuleIsCommonCheckbox").checked = false;
        const completionFields = document.getElementById("editRuleCompletionFields");
        if (completionFields) {
            completionFields.style.display = this.checked ? "block" : "none";
        }
    });
    document.getElementById("editRuleIsCommonCheckbox").addEventListener("change", function() {
        if (this.checked) document.getElementById("editRuleIsAdminCheckbox").checked = false;
        document.getElementById("editCommonJobSettings").style.display = this.checked ? "block" : "none";
        
        if (this.checked) {
            document.getElementById("editCommonJobNotifyTime").value = "immediate"; // Chọn mặc định: Ngay lập tức
        }
    });

    document.getElementById("editRuleCompletedNoteSelect").addEventListener("change", function() {
        const customInput = document.getElementById("editRuleCompletedNoteCustom");
        if (this.value === "Khác") {
            customInput.style.display = "block";
            customInput.focus();
        } else {
            customInput.style.display = "none";
        }
    });

    // --- LOGIC VÔ HIỆU HÓA NGÀY CỤ THỂ HOẶC ĐỊNH KỲ ---
    const exactDateInput = document.getElementById("exactDate");
    function updateAddRuleState() {
        if (exactDateInput.value) {
            domSelect.disabled = true;
            daySelect.disabled = true;
            weekSelect.disabled = true;
            monthSelect.disabled = true;
        } else if (domSelect.value || daySelect.value || weekSelect.value || monthSelect.value) {
            exactDateInput.disabled = true;
        } else {
            exactDateInput.disabled = false;
            domSelect.disabled = false;
            daySelect.disabled = false;
            weekSelect.disabled = false;
            monthSelect.disabled = false;
        }
    }

    [exactDateInput, domSelect, daySelect, weekSelect, monthSelect].forEach(el => {
        if (el) {
            el.addEventListener('change', updateAddRuleState);
            el.addEventListener('input', updateAddRuleState);
        }
    });

    const editRuleExactDate = document.getElementById("editRuleExactDate");
    const editRuleDom = document.getElementById("editRuleDom");
    const editRuleDay = document.getElementById("editRuleDay");
    const editRuleWeek = document.getElementById("editRuleWeek");
    const editRuleMonth = document.getElementById("editRuleMonth");
    
    function updateEditRuleState() {
        if (editRuleExactDate.value) {
            editRuleDom.disabled = true; editRuleDay.disabled = true; editRuleWeek.disabled = true; editRuleMonth.disabled = true;
        } else if (editRuleDom.value || editRuleDay.value || editRuleWeek.value || editRuleMonth.value) {
            editRuleExactDate.disabled = true;
        } else {
            editRuleExactDate.disabled = false; editRuleDom.disabled = false; editRuleDay.disabled = false; editRuleWeek.disabled = false; editRuleMonth.disabled = false;
        }
    }
    [editRuleExactDate, editRuleDom, editRuleDay, editRuleWeek, editRuleMonth].forEach(el => {
        if (el) { el.addEventListener('change', updateEditRuleState); el.addEventListener('input', updateEditRuleState); }
    });

    // --- Hàm tiện ích: Khóa cuộn trang và bù đắp chiều rộng thanh cuộn (Chống giật/nháy giao diện) ---
    function toggleBodyScroll(disable) {
        if (disable) {
            const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.paddingRight = scrollbarWidth + "px";
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.paddingRight = "";
            document.body.style.overflow = "";
        }
    }

    let allRulesData = [];
    let allPatternsData = [];
    let allSwapsData = []; // Khai báo biến để tránh lỗi ReferenceError

    // --- DÒNG MỚI THÊM VÀO ---
    let rulesLoaded = false;
    let patternsLoaded = false;
    let swapsLoaded = false;
    let initialLoadComplete = false; // Cờ chính
    let allKnownEmails = new Set(); // Khai báo Set toàn cục để lưu email

    const specificDate = document.getElementById("specificDate");
    const jobNoteInput = document.getElementById("jobNote");
    const personalScheduleModal = document.getElementById("personalScheduleModal");
    const closeModalBtn = document.getElementById("closeModal");
    const personalScheduleDetails = document.getElementById("personalScheduleDetails");

    // --- LOGIC TABS ADMIN ---
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.id === 'btn-openAddModal') {
                openAddRuleModal();
                return;
            }
                if (e.target.id === 'btn-openSwapModal') {
                    return; // Mở modal (đã xử lý ở dưới), bỏ qua logic chuyển tab để không bị ẩn bảng
                }
            document.getElementById('btn-openAddModal').classList.remove('active');
            document.getElementById('btn-openSwapModal').classList.remove('active');
            
            document.querySelectorAll('.admin-tab-btn').forEach(b => {
                if (b.id !== 'btn-openAddModal' && b.id !== 'btn-openSwapModal') b.classList.remove('active');
            });
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            
            const targetId = e.target.id.replace('tabBtn-', '');
            e.target.classList.add('active');
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.classList.add('active');
            }
        });
    });

    let userRole = "user";

    // --- Đổ dữ liệu ngày cho select (Thay thế document.write) ---
    const domSelectEl = document.getElementById('domSelect');
    const editRuleDomEl = document.getElementById('editRuleDom');
    let domOptions = '<option value="">--Ngày--</option>';
    for(let i=1; i<=31; i++) { domOptions += `<option value="${i}">${i}</option>`; }
    if(domSelectEl) domSelectEl.innerHTML = domOptions;
    if(editRuleDomEl) editRuleDomEl.innerHTML = domOptions;

    // --- HÀM MỚI: Cập nhật datalist từ Set toàn cục ---
    function renderUserDatalist() {
        const datalist = document.getElementById("systemUsersList");
        // Chỉ chạy nếu là admin và có datalist
        if (datalist && userRole === 'admin') {
            let optionsHtml = "";
            Array.from(allKnownEmails).sort().forEach(email => { 
                optionsHtml += `<option value="${email}">${email}</option>`; 
            });
            datalist.innerHTML = optionsHtml;
        }
    }

    // --- HÀM 1 (MỚI): onAuth ---
    onAuth(async (user) => {
        if (!user) {
            notLogged.style.display = "flex";
            content.style.display = "none";
            if (footerPlaceholder) footerPlaceholder.style.display = "block";
            return;
        }
        showLoading("Đang tải dữ liệu lịch làm việc...");
        notLogged.style.display = "none";
        content.style.display = "block";
        if (footerPlaceholder) footerPlaceholder.style.display = "block";
        userRole = await getRole(user.email);
        if (userRole === "admin") {
            document.querySelectorAll(".admin-only").forEach(el => el.classList.add("admin-visible"));
            const adminTabs = document.getElementById("adminTabsContainer");
            if (adminTabs) adminTabs.style.display = "block";
            // Tải danh sách người dùng cơ bản một lần duy nhất khi admin đăng nhập
            const firestoreUsers = await fetchAllUsers();
            firestoreUsers.forEach(u => { if (u.email) allKnownEmails.add(u.email); });
            renderUserDatalist(); // Render danh sách email lần đầu
            // Tải danh sách người dùng ngầm (Không dùng await để không chặn luồng vẽ lịch)
            fetchAllUsers().then(firestoreUsers => {
                firestoreUsers.forEach(u => { if (u.email) allKnownEmails.add(u.email); });
                renderUserDatalist(); // Render danh sách email lần đầu
            });
        }
        // Sau khi đã có danh sách cơ bản, mới bắt đầu lắng nghe các thay đổi
        // Lắng nghe dữ liệu và vẽ lịch ngay lập tức mà không cần chờ danh sách user
        setupRealtimeListeners(user.email, userRole);
    });

    // --- LOGIC MODAL THÊM QUY TẮC MỚI ---
    const addRuleModal = document.getElementById("addRuleModal");
    const addRuleTypeSelect = document.getElementById("addRuleTypeSelect");
    const addJobFormContainer = document.getElementById("addJobFormContainer");
    const addPatternFormContainer = document.getElementById("addPatternFormContainer");

    // Hàm reset form Thêm Quy tắc về chế độ mặc định (ẩn chức năng Sửa/Xóa)
    function resetAddJobFormMode() {
        document.getElementById("addJobRuleEditId").value = "";
        document.getElementById("deleteAddRuleBtn").style.display = "none";
        document.getElementById("addRuleSpacer").style.display = "none";
        const saveBtn = document.getElementById("saveNewRuleBtn");
        saveBtn.innerHTML = "💾 Lưu quy tắc";
        saveBtn.style.background = "#2ecc71"; // Màu xanh lá
        const saveAsNewBtn = document.getElementById("saveAsNewRuleBtn");
        if (saveAsNewBtn) saveAsNewBtn.style.display = "none";
    }

    function openAddRuleModal() {
        resetAddJobFormMode(); // Trả về giao diện chuẩn khi vừa mở modal
        // Khắc phục lỗi trống form: Ép kích hoạt sự kiện hiển thị khối dữ liệu theo tùy chọn mặc định
        addRuleTypeSelect.dispatchEvent(new Event('change'));
        addRuleModal.style.display = "block";
        toggleBodyScroll(true);
        updateAddRuleState();
    }
    const closeAddRuleModalFn = () => {
        addRuleModal.style.display = "none";
        toggleBodyScroll(false);
        
        // --- LÀM MỚI FORM KHI ĐÓNG MODAL ---
        // Xóa dữ liệu form Quy tắc công việc
        [jobInput, daySelect, weekSelect, monthSelect, domSelect, document.getElementById("exactDate"), jobNoteInput, document.getElementById("jobTime"), document.getElementById("addRuleEndDate")].forEach(el => { if (el) el.value = ""; });
        if (document.getElementById("isAdminJobRuleCheckbox")) document.getElementById("isAdminJobRuleCheckbox").checked = false;
        if (document.getElementById("isCommonJobRuleCheckbox")) document.getElementById("isCommonJobRuleCheckbox").checked = false;
        if (document.getElementById("addCommonJobSettings")) document.getElementById("addCommonJobSettings").style.display = "none";
        
        // Xóa dữ liệu form Quy tắc phân ca
        ["patternUser", "patternDisplayName", "patternStartDate", "patternNote", "adminShiftGroupName", "adminStartTime", "adminEndTime", "shiftGroupName", "shiftStartTime", "shiftEndTime", "patternNotifyTime"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        document.querySelectorAll("#dayCheckboxes input").forEach(cb => cb.checked = false);
        
        resetAddJobFormMode();
        updateAddRuleState();
    };
    document.getElementById("closeAddRuleModal").onclick = closeAddRuleModalFn;
    document.getElementById("cancelAddRuleBtn").onclick = closeAddRuleModalFn;
    addRuleTypeSelect.addEventListener('change', () => {
        addJobFormContainer.style.display = addRuleTypeSelect.value === 'job' ? 'block' : 'none';
        addPatternFormContainer.style.display = addRuleTypeSelect.value === 'pattern' ? 'block' : 'none';
    });

    // --- LOGIC BIẾN FORM THÊM THÀNH FORM SỬA KHI TÌM NHANH ---
    jobInput.addEventListener("input", function() {
        const val = this.value.trim().toLowerCase();
        const currentEditId = document.getElementById("addJobRuleEditId").value;

        if (!val) {
            if (currentEditId) resetAddJobFormMode();
            return;
        }

        const normalizedVal = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        // Tìm xem có công việc cũ trùng tên 100% không
        const exactMatchRule = allRulesData.find(r => {
             if (!r.job) return false;
             const normalizedJob = r.job.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
             return normalizedJob === normalizedVal;
        });

        if (exactMatchRule) {
            if (currentEditId !== exactMatchRule.id) {
                // Tự động tải dữ liệu cũ lên form
                document.getElementById("jobTime").value = exactMatchRule.time || "";
                document.getElementById("exactDate").value = exactMatchRule.exactDate || "";
                domSelect.value = exactMatchRule.dom || "";
                daySelect.value = exactMatchRule.day || "";
                weekSelect.value = exactMatchRule.week || "";
                monthSelect.value = exactMatchRule.month || "";
                document.getElementById("addRuleEndDate").value = exactMatchRule.ruleEndDate || "";
                
                document.getElementById("isAdminJobRuleCheckbox").checked = exactMatchRule.is_admin_job || false;
                document.getElementById("isCommonJobRuleCheckbox").checked = exactMatchRule.is_common_job || false;
                
                document.getElementById("addCommonJobSettings").style.display = exactMatchRule.is_common_job ? "block" : "none";
                if (exactMatchRule.is_common_job) {
                    document.getElementById("addCommonJobTargetGroup").value = exactMatchRule.targetGroup || "all";
                    document.getElementById("addCommonJobNotifyTime").value = (exactMatchRule.notifyTime !== undefined && exactMatchRule.notifyTime !== null) ? exactMatchRule.notifyTime : "immediate";
                }
                
                let rawNote = exactMatchRule.note || "";
                if (rawNote.startsWith("[CVAdmin]")) rawNote = rawNote.replace("[CVAdmin]", "").trim();
                else if (rawNote.startsWith("[CVChung]")) rawNote = rawNote.replace("[CVChung]", "").trim();
                jobNoteInput.value = rawNote;
                
                updateAddRuleState(); // Khóa các trường định kỳ nếu có ngày cụ thể
                
                // Biến UI thành chế độ Edit
                document.getElementById("addJobRuleEditId").value = exactMatchRule.id;
                document.getElementById("deleteAddRuleBtn").style.display = "block";
                document.getElementById("addRuleSpacer").style.display = "block";
                
                const saveBtn = document.getElementById("saveNewRuleBtn");
                saveBtn.innerHTML = "💾 Lưu thay đổi";
                saveBtn.style.background = "#f39c12"; // Màu cam như Sửa
    
                // Hiển thị nút Lưu thêm việc mới
                const saveAsNewBtn = document.getElementById("saveAsNewRuleBtn");
                if (saveAsNewBtn) saveAsNewBtn.style.display = "block";
    
                showSwal("info", "Đã tải dữ liệu công việc cũ");
            }
        } else {
            // Tên mới hoàn toàn -> Trả lại giao diện Thêm mới
            if (currentEditId) {
                resetAddJobFormMode();
            }
        }
    });

    // Kích hoạt chức năng Lưu thành việc mới
    document.getElementById("saveAsNewRuleBtn").addEventListener("click", () => {
        // Chỉ cần xóa ID đi, hệ thống sẽ hiểu đây là lệnh Tạo mới thay vì Cập nhật
        document.getElementById("addJobRuleEditId").value = "";
        // Tự động bấm nút Lưu gốc
        document.getElementById("saveNewRuleBtn").click();
    });

    // Chức năng Xóa cho nút "Xóa vĩnh viễn" tích hợp thẳng trên Modal Thêm
    document.getElementById("deleteAddRuleBtn").addEventListener("click", async () => {
        const ruleIdToDelete = document.getElementById("addJobRuleEditId").value;
        if (!ruleIdToDelete) return;
        const ruleData = allRulesData.find(r => r.id === ruleIdToDelete);
        
        Swal.fire({
            title: 'Bạn có chắc chắn muốn xóa?',
            text: `Quy tắc "${ruleData ? ruleData.job : ""}" sẽ bị xóa vĩnh viễn!`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e74c3c',
            cancelButtonColor: '#95a5a6',
            confirmButtonText: 'Vâng, xóa nó!',
            cancelButtonText: 'Hủy'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    showLoading("Đang xóa...");
                    await deleteDoc(doc(db, "work_rules", ruleIdToDelete));
                    addLog("admin_delete_work_rule", { email: getCurrentUserEmail(), deletedRuleId: ruleIdToDelete, deletedRule: ruleData || {} });
                    hideLoading();
                    showSwal("success", "Đã xóa quy tắc!");
                    
                    // Reset form và đóng modal
                    [jobInput, daySelect, weekSelect, monthSelect, domSelect, document.getElementById("exactDate"), jobNoteInput, document.getElementById("jobTime"), document.getElementById("addRuleEndDate")].forEach(el => el.value = "");
                    resetAddJobFormMode();
                    updateAddRuleState();
                    closeAddRuleModalFn();
                } catch (error) {
                    hideLoading();
                    showSwal("error", "Lỗi khi xóa quy tắc!");
                }
            }
        });
    });


    // --- HÀM 2 (MỚI): checkAllDataLoadedAndRender ---
    function checkAllDataLoadedAndRender(email, role) {
        // Fix lỗi ReferenceError bằng cách gọi trực tiếp DOM
        const searchInputEl = document.getElementById('globalSearchInput');
        const searchVal = searchInputEl ? searchInputEl.value : "";
        
        // Nếu đã tải xong lần đầu, chỉ cần vẽ lại lịch
        if (initialLoadComplete) {
            console.log("Real-time: Dữ liệu thay đổi, vẽ lại lịch.");
            renderSchedule(searchVal, currentlyViewedDate);
            return;
        }
        
        // Kiểm tra xem tất cả listener đã sẵn sàng chưa
        if (rulesLoaded && patternsLoaded && swapsLoaded) {
            initialLoadComplete = true; // Đánh dấu hoàn tất tải lần đầu
            
            console.log("Tất cả dữ liệu đã tải. Hiển thị lần đầu.");
            renderSchedule(searchVal, currentlyViewedDate);
            if (role !== 'admin') {
                showPersonalScheduleModal(email, role); // Chỉ gọi modal cho User
            }
            hideLoading(); // Ẩn loading khi đã vẽ xong
        }
    }

    // --- HÀM 3 (MỚI): setupRealtimeListeners ---
    // (Hàm này thay thế cho cả 3 hàm load... cũ)
    function setupRealtimeListeners(email, role) {
        
        // 1. Lắng nghe work_rules (Bỏ limit để tương thích hoàn toàn với Cache ngoại tuyến)
        const qRules = query(collection(db, "work_rules"));
        onSnapshot(qRules, (snapshot) => {
            console.log("Real-time: work_rules đã thay đổi.");
            allRulesData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            
            // (Copy y hệt logic Sắp xếp từ hàm loadRules cũ của bạn)
            allRulesData.sort((a, b) => {
                const groupA = getNormalizedFirstChar(a.job);
                const groupB = getNormalizedFirstChar(b.job);
                if (groupA !== groupB) return groupA.localeCompare(groupB);
                if (b.createdAt && a.createdAt) return b.createdAt.toMillis() - a.createdAt.toMillis();
                return 0;
            });

            renderRuleList(allRulesData); // Cập nhật bảng admin
            updateJobNameDatalist(allRulesData); // Cập nhật datalist cho input tên công việc
            
            if (!rulesLoaded) rulesLoaded = true; // Đặt cờ
            checkAllDataLoadedAndRender(email, role); // Kiểm tra
        }, (error) => {
            console.error("Lỗi lắng nghe work_rules:", error);
            if (!rulesLoaded) rulesLoaded = true; 
            checkAllDataLoadedAndRender(email, role); 
        });

        // 2. Lắng nghe work_patterns
        const qPatterns = query(collection(db, "work_patterns"));
        onSnapshot(qPatterns, (snapshot) => {
            console.log("Real-time: work_patterns đã thay đổi.");
            allPatternsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

            // (Copy y hệt logic Sắp xếp từ hàm loadPatterns cũ của bạn)
            allPatternsData.sort((a, b) => {
                return (a.user || "").localeCompare(b.user || "");
            });

            renderPatternList(allPatternsData); // Cập nhật bảng admin
            updateShiftGroupDatalist(allPatternsData); // Cập nhật danh sách gợi ý nhóm ca
            
            // Cập nhật danh sách email toàn cục với các user từ pattern
            if (role === 'admin') {
                let newUsersFound = false;
                allPatternsData.forEach(p => {
                    if (p.user && !allKnownEmails.has(p.user)) {
                        allKnownEmails.add(p.user);
                        newUsersFound = true;
                    }
                });
                // Luôn cập nhật lại datalist vì trạng thái "chưa có lịch" của user có thể đã thay đổi (vd: bị xóa lịch, thêm lịch)
                renderUserDatalist();
            }

            if (!patternsLoaded) patternsLoaded = true; // Đặt cờ
            checkAllDataLoadedAndRender(email, role); // Kiểm tra
        }, (error) => {
            console.error("Lỗi lắng nghe work_patterns:", error);
            if (!patternsLoaded) patternsLoaded = true; 
            checkAllDataLoadedAndRender(email, role); 
        });

        // 3. Lắng nghe shift_swaps
        const qSwaps = query(collection(db, "shift_swaps"));
        onSnapshot(qSwaps, (snapshot) => {
            console.log("Real-time: shift_swaps đã thay đổi.");
            allSwapsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            renderSwapList();
            
            if (!swapsLoaded) swapsLoaded = true;
            checkAllDataLoadedAndRender(email, role);
        }, (error) => {
            console.error("Lỗi lắng nghe shift_swaps:", error);
            if (!swapsLoaded) swapsLoaded = true;
            checkAllDataLoadedAndRender(email, role);
        });
    }
        
    // --- HÀM MỚI: Cập nhật danh sách gợi ý Nhóm ca ---
    function updateShiftGroupDatalist(patterns) {
        const datalist = document.getElementById("existingShiftGroups");
        if (!datalist) return;
        
        const groups = new Set();
        patterns.forEach(p => {
            if (p.shiftGroup) {
                groups.add(p.shiftGroup);
            }
        });
        
        datalist.innerHTML = "";
        groups.forEach(group => {
            const option = document.createElement("option");
            option.value = group;
            datalist.appendChild(option);
        });
        
        // Đổ dữ liệu vào select Nhóm áp dụng của CV Chung
        const addSelect = document.getElementById("addCommonJobTargetGroup");
        const editSelect = document.getElementById("editCommonJobTargetGroup");
        if (addSelect && editSelect) {
            const currentAddVal = addSelect.value;
            const currentEditVal = editSelect.value;
            let optionsHtml = '<option value="all">Tất cả nhân viên</option>';
            groups.forEach(g => { optionsHtml += `<option value="${g}">Nhóm: ${g}</option>`; });
            
            addSelect.innerHTML = optionsHtml;
            editSelect.innerHTML = optionsHtml;
            
            if (groups.has(currentAddVal) || currentAddVal === 'all') addSelect.value = currentAddVal;
            if (groups.has(currentEditVal) || currentEditVal === 'all') editSelect.value = currentEditVal;
        }
    }

    // --- HÀM MỚI: Cập nhật danh sách gợi ý Công việc ---
    function updateJobNameDatalist(rules) {
        const datalist = document.getElementById("existingJobsList");
        if (!datalist) return;
        
        const jobs = new Set();
        rules.forEach(r => {
            if (r.job) jobs.add(r.job.trim());
        });
        
        datalist.innerHTML = "";
        jobs.forEach(job => {
            const option = document.createElement("option");
            option.value = job;
            datalist.appendChild(option);
        });
    }

    // =========================================================================
    // LOGIC MODAL CHỈNH SỬA QUY TẮC PATTERN
    // =========================================================================
    const editPatternModal = document.getElementById("editPatternModal");
    const editPatternTypeSelect = document.getElementById("editPatternTypeSelect");
    const editAdministrativeInputs = document.getElementById("editAdministrativeInputs");
    const editShiftRotationInputs = document.getElementById("editShiftRotationInputs");

    // Đóng mở giao diện loại lịch trong modal
    editPatternTypeSelect.addEventListener('change', () => {
        if (editPatternTypeSelect.value === 'administrative') {
            editAdministrativeInputs.style.display = 'block';
            editShiftRotationInputs.style.display = 'none';
        } else {
            editAdministrativeInputs.style.display = 'none';
            editShiftRotationInputs.style.display = 'block';
        }
    });

    // Hàm mở modal và đổ dữ liệu
    function openEditPatternModal(pattern) {
        document.getElementById("editPatternId").value = pattern.id;
        document.getElementById("editPatternUser").value = pattern.user || "";
        document.getElementById("editPatternDisplayName").value = pattern.displayName || "";
        document.getElementById("editPatternStartDate").value = pattern.patternStartDate || "";
        document.getElementById("editPatternEndDate").value = pattern.patternEndDate || "";
        document.getElementById("editPatternTypeSelect").value = pattern.type || "administrative";
        document.getElementById("editPatternTypeSelect").dispatchEvent(new Event('change')); // Kích hoạt đổi giao diện
        
        document.getElementById("editStartTime").value = pattern.startTime || "";
        document.getElementById("editEndTime").value = pattern.endTime || "";
        document.getElementById("editPatternNotifyTime").value = pattern.notifyTime || "";
        document.getElementById("editShiftGroupName").value = pattern.shiftGroup || "";
        document.getElementById("editAdminShiftGroupName").value = pattern.shiftGroup || "";
        document.getElementById("editPatternNote").value = pattern.note || "";

        // Reset và tick checkbox
        document.querySelectorAll("#editDayCheckboxes input").forEach(cb => cb.checked = false);
        if (pattern.type === 'administrative' && Array.isArray(pattern.workDaysOfWeek)) {
            pattern.workDaysOfWeek.forEach(day => {
                const cb = document.querySelector(`#editDayCheckboxes input[value="${day}"]`);
                if (cb) cb.checked = true;
            });
        }
        
        editPatternModal.style.display = "block";
        toggleBodyScroll(true);
    }

    // Đóng Modal
    const closeEditModalFn = () => {
        editPatternModal.style.display = "none";
        toggleBodyScroll(false);
        
        // --- LÀM MỚI FORM SỬA QUY TẮC PHÂN CA KHI ĐÓNG ---
        ["editPatternId", "editPatternUser", "editPatternDisplayName", "editPatternStartDate", "editPatternEndDate", "editStartTime", "editEndTime", "editPatternNotifyTime", "editShiftGroupName", "editAdminShiftGroupName", "editPatternNote"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        document.getElementById("editPatternTypeSelect").value = "administrative";
        document.querySelectorAll("#editDayCheckboxes input").forEach(cb => cb.checked = false);
        document.getElementById("editAdministrativeInputs").style.display = 'block';
        document.getElementById("editShiftRotationInputs").style.display = 'none';
    };
    document.getElementById("closeEditPatternModal").onclick = closeEditModalFn;
    document.getElementById("cancelEditPatternBtn").onclick = closeEditModalFn;

    // Nút Lưu thay đổi
    document.getElementById("saveEditPatternBtn").addEventListener("click", async () => {
        const id = document.getElementById("editPatternId").value;
        const displayName = document.getElementById("editPatternDisplayName").value.trim();
        const patternStartDate = document.getElementById("editPatternStartDate").value;
        const patternEndDate = document.getElementById("editPatternEndDate").value;
        const type = document.getElementById("editPatternTypeSelect").value;
        const note = document.getElementById("editPatternNote").value.trim();
        const startTime = document.getElementById("editStartTime").value;
        const endTime = document.getElementById("editEndTime").value;
        
        // Lấy và lưu trực tiếp chuỗi thời gian người dùng đã chọn
        const notifyTime = document.getElementById("editPatternNotifyTime").value;

        if (!displayName || !patternStartDate || !startTime || !endTime) {
            return Swal.fire("Thiếu thông tin!", "Tên hiển thị, Ngày áp dụng và Giờ làm việc không được để trống.", "warning");
        }

        let updateData = { 
            displayName, 
            patternStartDate, 
            patternEndDate: patternEndDate || null, 
            type, 
            note, 
            startTime, 
            endTime,
            notifyTime,
            updatedAt: serverTimestamp() 
        };

        // Tính toán isNextDay
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        if ( (endH < startH) || (endH === startH && endM < startM) ) {
            updateData.isNextDay = true;
        } else if (startH === endH && startM === endM && (startH !== 0 || startM !== 0)) {
            updateData.isNextDay = true;
        } else {
            updateData.isNextDay = false;
        }

        if (type === 'administrative') {
            const workDaysOfWeek = Array.from(document.querySelectorAll("#editDayCheckboxes input:checked")).map(cb => parseInt(cb.value));
            if (workDaysOfWeek.length === 0) return Swal.fire("Cảnh báo!", "Vui lòng chọn ít nhất một thứ làm việc.", "warning");
            updateData.workDaysOfWeek = workDaysOfWeek;
            updateData.shiftGroup = null; // Xóa nhóm ca nếu chuyển thành cố định
            let adminShiftGroup = document.getElementById("editAdminShiftGroupName").value.trim().replace(/\s+/g, ' ');
            updateData.shiftGroup = adminShiftGroup || "Hành chính";
        } else {
            let shiftGroup = document.getElementById("editShiftGroupName").value.trim().replace(/\s+/g, ' ');
            updateData.shiftGroup = shiftGroup || "Vận hành";
            updateData.workDaysOfWeek = null; // Xóa thứ nếu chuyển thành ca
        }

        const oldData = allPatternsData.find(p => p.id === id) || {};
        const changes = {};
        const fieldLabels = { displayName: "Tên hiển thị", patternStartDate: "Ngày BĐ", patternEndDate: "Ngày KT", type: "Loại lịch", note: "Ghi chú", startTime: "Giờ BĐ", endTime: "Giờ KT", notifyTime: "Giờ TB", shiftGroup: "Nhóm ca", workDaysOfWeek: "Thứ làm việc", user: "Tài khoản" };
        
        for (const key in updateData) {
            if (key === "updatedAt" || key === "isNextDay") continue;
            let oldVal = oldData[key];
            let newVal = updateData[key];
            if (key === "workDaysOfWeek" || key === "notifyTime") {
                oldVal = JSON.stringify(oldVal || []);
                newVal = JSON.stringify(newVal || []);
            }
            if (oldVal !== newVal) {
                if ((oldVal === undefined || oldVal === null || oldVal === "[]" || oldVal === "") && (newVal === undefined || newVal === null || newVal === "[]" || newVal === "")) continue;
                changes[key] = { old: oldData[key], new: updateData[key], label: fieldLabels[key] || key };
            }
        }

        try {
            showLoading("Đang lưu...");
            await updateDoc(doc(db, "work_patterns", id), updateData);
            addLog("admin_update_work_pattern", { email: getCurrentUserEmail(), patternId: id, targetName: displayName, changes, updateData });
            hideLoading();
            Swal.fire("Thành công!", "Đã cập nhật quy tắc.", "success");
            closeEditModalFn();
        } catch (error) {
            hideLoading();
            Swal.fire("Lỗi!", "Không thể cập nhật: " + error.message, "error");
        }
    });

    // Nút Xóa vĩnh viễn trong Modal
    document.getElementById("deleteEditPatternBtn").addEventListener("click", async () => {
        const id = document.getElementById("editPatternId").value;
        Swal.fire({
            title: 'Xóa vĩnh viễn nhân viên này?',
            text: "Dữ liệu lịch sử phân ca của nhân viên này sẽ bị ảnh hưởng. Nên dùng 'Đến ngày' để kết thúc thay vì xóa hẳn.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e74c3c',
            cancelButtonColor: '#95a5a6',
            confirmButtonText: 'Vẫn xóa!',
            cancelButtonText: 'Hủy'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    showLoading("Đang xóa...");
                    await deleteDoc(doc(db, "work_patterns", id));
                    addLog("admin_delete_work_pattern", { email: getCurrentUserEmail(), patternId: id });
                    hideLoading();
                    Swal.fire('Đã xóa!', 'Quy tắc đã bị xóa khỏi hệ thống.', 'success');
                    closeEditModalFn();
                } catch (error) {
                    hideLoading();
                    Swal.fire('Lỗi!', 'Không thể xóa: ' + error.message, 'error');
                }
            }
        });
    });

    // =========================================================================
    // LOGIC MODAL CHỈNH SỬA QUY TẮC CÔNG VIỆC (MỤC 1)
    // =========================================================================
    const editRuleModal = document.getElementById("editRuleModal");
    
    function openEditRuleModal(rule) {
        document.getElementById("editRuleId").value = rule.id;
        document.getElementById("editRuleJobName").value = rule.job || "";
        document.getElementById("editRuleTime").value = rule.time || "";
        document.getElementById("editRuleExactDate").value = rule.exactDate || "";
        document.getElementById("editRuleDom").value = rule.dom || "";
        document.getElementById("editRuleDay").value = rule.day || "";
        document.getElementById("editRuleWeek").value = rule.week || "";
        document.getElementById("editRuleMonth").value = rule.month || "";
        document.getElementById("editRuleEndDate").value = rule.ruleEndDate || "";
        
        document.getElementById("editRuleIsAdminCheckbox").checked = rule.is_admin_job || false;
        document.getElementById("editRuleIsCommonCheckbox").checked = rule.is_common_job || false;
        let rawNote = rule.note || "";
        if (rawNote.startsWith("[CVAdmin]")) {
            rawNote = rawNote.replace("[CVAdmin]", "").trim();
        } else if (rawNote.startsWith("[CVChung]")) {
            rawNote = rawNote.replace("[CVChung]", "").trim();
        }
        document.getElementById("editRuleNote").value = rawNote;
        
        const commonSettings = document.getElementById("editCommonJobSettings");
        if (rule.is_common_job) {
            commonSettings.style.display = "block";
            document.getElementById("editCommonJobTargetGroup").value = rule.targetGroup || "all";
            document.getElementById("editCommonJobNotifyTime").value = (rule.notifyTime !== undefined && rule.notifyTime !== null) ? rule.notifyTime : "immediate";
        } else {
            commonSettings.style.display = "none";
            document.getElementById("editCommonJobTargetGroup").value = "all";
            document.getElementById("editCommonJobNotifyTime").value = "immediate";
        }
        
        document.getElementById("editRuleLastCompletedDate").value = rule.lastCompletedDate || "";
        let actualCompletedDateValue = "";
        if (rule.actualCompletedDate) {
            try {
                const acDate = new Date(rule.actualCompletedDate);
                const tzOffset = acDate.getTimezoneOffset() * 60000;
                actualCompletedDateValue = (new Date(acDate - tzOffset)).toISOString().slice(0, 16);
            } catch(e) {}
        }
        document.getElementById("editRuleActualCompletedDate").value = actualCompletedDateValue;
        
        const completedNote = rule.completedNote || "";
        const noteSelect = document.getElementById("editRuleCompletedNoteSelect");
        const noteCustom = document.getElementById("editRuleCompletedNoteCustom");
        const predefinedNotes = ["Đã hoàn thành", "Hoàn thành 1 phần", "Không thể hoàn thành", "Loại bỏ"];
        
        if (!completedNote) {
            noteSelect.value = "";
            noteCustom.style.display = "none";
            noteCustom.value = "";
        } else if (predefinedNotes.includes(completedNote)) {
            noteSelect.value = completedNote;
            noteCustom.style.display = "none";
            noteCustom.value = "";
        } else {
            noteSelect.value = "Khác";
            noteCustom.style.display = "block";
            noteCustom.value = completedNote;
        }
        
        const completionFields = document.getElementById("editRuleCompletionFields");
        if (completionFields) {
            completionFields.style.display = rule.is_admin_job ? "block" : "none";
        }

        updateEditRuleState();
        editRuleModal.style.display = "block";
        toggleBodyScroll(true);
    }

    const closeEditRuleModalFn = () => {
        editRuleModal.style.display = "none";
        toggleBodyScroll(false);
        
        // --- LÀM MỚI FORM SỬA CÔNG VIỆC KHI ĐÓNG ---
        ["editRuleId", "editRuleJobName", "editRuleTime", "editRuleExactDate", "editRuleDom", "editRuleDay", "editRuleWeek", "editRuleMonth", "editRuleEndDate", "editRuleNote", "editRuleLastCompletedDate", "editRuleActualCompletedDate", "editRuleCompletedNoteSelect", "editRuleCompletedNoteCustom"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        ["editRuleIsAdminCheckbox", "editRuleIsCommonCheckbox"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });
        if (document.getElementById("editCommonJobSettings")) document.getElementById("editCommonJobSettings").style.display = "none";
        if (document.getElementById("editRuleCompletionFields")) document.getElementById("editRuleCompletionFields").style.display = "none";
        if (document.getElementById("editRuleCompletedNoteCustom")) document.getElementById("editRuleCompletedNoteCustom").style.display = "none";
        
        updateEditRuleState();
    };
    document.getElementById("closeEditRuleModal").onclick = closeEditRuleModalFn;
    document.getElementById("cancelEditRuleBtn").onclick = closeEditRuleModalFn;

    document.getElementById("saveEditRuleBtn").addEventListener("click", async () => {
        const id = document.getElementById("editRuleId").value;
        const job = document.getElementById("editRuleJobName").value.trim();
        const isAdmin = document.getElementById("editRuleIsAdminCheckbox").checked;
        const isCommon = document.getElementById("editRuleIsCommonCheckbox").checked;
        const time = document.getElementById("editRuleTime").value;
        const exactDate = document.getElementById("editRuleExactDate").value;
        const dom = document.getElementById("editRuleDom").value;
        const day = document.getElementById("editRuleDay").value;
        const week = document.getElementById("editRuleWeek").value;
        const month = document.getElementById("editRuleMonth").value;
        const ruleEndDate = document.getElementById("editRuleEndDate").value;
        const rawNote = document.getElementById("editRuleNote").value.trim();
        let lastCompletedDate = document.getElementById("editRuleLastCompletedDate").value;
        const actualCompletedDateInput = document.getElementById("editRuleActualCompletedDate").value;
        
        let completedNote = document.getElementById("editRuleCompletedNoteSelect").value;
        if (completedNote === "Khác") {
            completedNote = document.getElementById("editRuleCompletedNoteCustom").value.trim();
        } else if (!completedNote) {
            completedNote = "";
        }

        if (!job) return Swal.fire("Lỗi", "Vui lòng nhập tên công việc!", "warning");

        if (!exactDate && !dom && !day && !week && !month) {
            return Swal.fire("Lỗi", "Vui lòng chọn Ngày cụ thể hoặc ít nhất một thời gian định kỳ (Ngày/Thứ/Tuần/Tháng)!", "warning");
        }

        // --- KIỂM TRA TRÙNG LẶP / TƯƠNG TỰ KHI SỬA ---
        const normalizedVal = job.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const otherRules = allRulesData.filter(r => r.id !== id);
        const uniqueJobs = Array.from(new Set(otherRules.map(r => r.job).filter(Boolean)));
        
        const exactMatch = uniqueJobs.find(j => {
             const normalizedJob = j.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
             return normalizedJob === normalizedVal;
        });

        const similarJobs = uniqueJobs.filter(j => {
            const normalizedJob = j.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return normalizedJob.includes(normalizedVal) && normalizedJob !== normalizedVal;
        });

        if (exactMatch) {
            const isConfirmed = await Swal.fire({
                title: 'Công việc đã tồn tại!',
                html: `Công việc "<b>${exactMatch}</b>" đã có sẵn trong hệ thống.<br>Bạn có chắc chắn muốn lưu với tên này không?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e74c3c',
                cancelButtonColor: '#95a5a6',
                confirmButtonText: 'Vẫn lưu',
                cancelButtonText: 'Hủy'
            });
            if (!isConfirmed.isConfirmed) return;
        } else if (similarJobs.length > 0) {
            const suggestions = similarJobs.slice(0, 4).map(j => `"${j}"`).join(", ");
            const isConfirmed = await Swal.fire({
                title: 'Công việc tương tự đã tồn tại!',
                html: `Các công việc có thể giống với nội dung bạn nhập:<br><b>${suggestions}</b><br><br>Bạn có chắc chắn muốn tiếp tục lưu không?`,
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#f39c12',
                cancelButtonColor: '#95a5a6',
                confirmButtonText: 'Vẫn lưu',
                cancelButtonText: 'Hủy'
            });
            if (!isConfirmed.isConfirmed) return;
        }
        // --- KẾT THÚC KIỂM TRA ---

        let note = rawNote;
        if (isAdmin) note = `[CVAdmin] ${rawNote}`.trim();
        else if (isCommon) note = `[CVChung] ${rawNote}`.trim();
        
        let actualCompletedDate = null;
        if (actualCompletedDateInput) {
            actualCompletedDate = new Date(actualCompletedDateInput).toISOString();
        }

        // --- LOGIC MỚI: TỰ ĐỘNG XÓA HOÀN THÀNH KHI LÝ DO TRỐNG ---
        // Chỉ xóa lúc lưu để tránh admin lỡ tay thay đổi dropdown mà mất ngày đã nhập trên UI
        if (completedNote === "") {
            lastCompletedDate = null;
            actualCompletedDate = null;
        }

        const updateData = { job, is_admin_job: isAdmin, is_common_job: isCommon, time, exactDate, dom, day, week, month, ruleEndDate, note, updatedAt: serverTimestamp() };
        
        if (isCommon) {
            updateData.targetGroup = document.getElementById("editCommonJobTargetGroup").value;
            updateData.notifyTime = document.getElementById("editCommonJobNotifyTime").value;
        } else {
            updateData.targetGroup = null; updateData.notifyTime = null;
        }
        
        if (isAdmin) {
            updateData.lastCompletedDate = lastCompletedDate || null;
            updateData.actualCompletedDate = actualCompletedDate || null;
            updateData.completedNote = completedNote || null;
        }

        const oldData = allRulesData.find(r => r.id === id) || {};
        const changes = {};
        const fieldLabels = { job: "Công việc", is_admin_job: "CV Admin", is_common_job: "CV Chung", time: "Giờ", exactDate: "Ngày cụ thể", dom: "Ngày", day: "Thứ", week: "Tuần", month: "Tháng", ruleEndDate: "Ngày kết thúc", note: "Ghi chú", lastCompletedDate: "Kỳ hoàn thành", actualCompletedDate: "Ngày xác nhận", completedNote: "Lý do hoàn thành" };
        for (const key in updateData) {
            if (key !== "updatedAt" && oldData[key] !== updateData[key]) {
                if ((oldData[key] === undefined || oldData[key] === null || oldData[key] === "") && (updateData[key] === undefined || updateData[key] === null || updateData[key] === "")) continue;
                changes[key] = { old: oldData[key], new: updateData[key], label: fieldLabels[key] || key };
            }
        }

        try {
            showLoading("Đang lưu...");
            await updateDoc(doc(db, "work_rules", id), updateData);
            addLog("admin_update_work_rule", { email: getCurrentUserEmail(), ruleId: id, targetName: job, changes, updateData });
            hideLoading();
            Swal.fire("Thành công!", "Đã cập nhật quy tắc.", "success");
            
            if (isCommon && updateData.notifyTime === 'immediate') {
                sendImmediateNotificationGAS(job, exactDate || dom || day || week || month || "Định kỳ", updateData.targetGroup, note);
            }
            
            closeEditRuleModalFn();
        } catch (error) {
            hideLoading();
            Swal.fire("Lỗi!", "Không thể cập nhật: " + error.message, "error");
        }
    });

    // Nút Xóa vĩnh viễn trong Modal Chỉnh sửa Quy tắc công việc
    document.getElementById("deleteEditRuleBtn").addEventListener("click", async () => {
        const ruleIdToDelete = document.getElementById("editRuleId").value;
        const ruleData = allRulesData.find(r => r.id === ruleIdToDelete);
        Swal.fire({
            title: 'Bạn có chắc chắn muốn xóa?',
            text: `Quy tắc "${ruleData ? ruleData.job : ""}" sẽ bị xóa vĩnh viễn!`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e74c3c',
            cancelButtonColor: '#95a5a6',
            confirmButtonText: 'Vâng, xóa nó!',
            cancelButtonText: 'Hủy'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    showLoading("Đang xóa...");
                    await deleteDoc(doc(db, "work_rules", ruleIdToDelete));
                    addLog("admin_delete_work_rule", {
                        email: getCurrentUserEmail(),
                        deletedRuleId: ruleIdToDelete,
                        deletedRule: ruleData || {}
                    });
                    hideLoading();
                    showSwal("success", "Đã xóa quy tắc!");
                    closeEditRuleModalFn();
                } catch (error) {
                    hideLoading();
                    addLog("admin_delete_work_rule_error", {
                        email: getCurrentUserEmail(),
                        ruleId: ruleIdToDelete,
                        error: error.message
                    });
                    showSwal("error", "Lỗi khi xóa quy tắc!");
                }
            }
        });
    });

    //
    function renderRuleList(rulesToRender) {
        ruleListBody.innerHTML = "";
        
        // --- BẢO TOÀN VỊ TRÍ CUỘN TRANG & BẢNG ---
        const scrollContainer = document.querySelector("#adminConfig .collapsible-content");
        const tableScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const pageScrollTop = document.getElementById("pageContent") ? document.getElementById("pageContent").scrollTop : 0;
        
        if (scrollContainer) {
            scrollContainer.style.minHeight = scrollContainer.scrollHeight + "px";
        }

        if (rulesToRender.length === 0) {
            ruleListBody.innerHTML = `<tr><td colspan="5" style="padding: 20px; color: #888; font-style: italic;">Không tìm thấy quy tắc công việc nào.</td></tr>`;
            return;
        }
        
        const todayForCheck = new Date();
        todayForCheck.setHours(0, 0, 0, 0);
        const hideExpired = document.getElementById('hideExpiredRulesCb') ? document.getElementById('hideExpiredRulesCb').checked : false;
        
        const searchInputEl = document.getElementById('globalSearchInput');
        const isSearching = searchInputEl && searchInputEl.value.trim().length > 0;

        // 1. Lọc và Tính toán trạng thái hết hạn cho toàn bộ danh sách trước
        const processedRules = [];
        rulesToRender.forEach(d => {
            let isExpired = false;
            let endDateDisplay = "-";
            
            if (d.ruleEndDate) {
                endDateDisplay = d.ruleEndDate.split('-').reverse().join('/');
                const endDateObj = new Date(d.ruleEndDate + 'T00:00:00');
                if (todayForCheck > endDateObj) {
                    isExpired = true;
                }
            }
            
            if (hideExpired && isExpired) return; // Nếu bật bộ lọc thì ẩn luôn dòng đã qua
            processedRules.push({ ...d, isExpired, endDateDisplay });
        });

        if (processedRules.length === 0) {
            ruleListBody.innerHTML = `<tr><td colspan="6" style="padding: 20px; color: #888; font-style: italic; text-align: center;">Tất cả công việc đã bị ẩn do ngày kết thúc đã qua.</td></tr>`;
            if (scrollContainer) { scrollContainer.style.minHeight = ""; scrollContainer.scrollTop = tableScrollTop; }
            if (document.getElementById("pageContent")) { document.getElementById("pageContent").scrollTop = pageScrollTop; }
            return;
        }

        // 2. Thuật toán trích xuất tên gốc (Cải tiến xử lý "Quý", "6 tháng đầu năm", tiền tố...)
        const getCleanName = (name) => {
            if (!name) return "Khác";
            let base = name;
            // Xóa cụm từ kiểu: " 6 tháng đầu năm", " 6 tháng cuối năm"
            base = base.replace(/\s+(?:\d+\s+)?(?:tháng|thang)\s+(?:đầu|cuối|giữa)\s+(?:năm|nam)$/i, '');
            // Xóa cụm thời gian ở cuối: Quý 1, Q1, Kỳ 1, Tháng 4, T4, Năm 2024...
            base = base.replace(/\s+(?:(?:\d+\s+)?(?:t|th|tháng|thang|kỳ|ky|năm|nam|quý|quy|q|quỉ)[\s\d\/\-]*|(?:đầu năm|cuối năm))$/i, '');
            return base.trim() === "" ? name : base.trim();
        };

        // 3. Tiến hành gom nhóm thông minh (Bao gồm nhóm theo Tiền tố)
        const tempProcessed = processedRules.map(d => ({
            ...d,
            cleanNameLower: getCleanName(d.job).toLowerCase(),
            cleanNameDisplay: getCleanName(d.job)
        }));

        // Bản đồ lưu trữ Tên hiển thị chuẩn cho mỗi Tên gốc
        const displayNamesMap = {};
        tempProcessed.forEach(d => {
            if (!displayNamesMap[d.cleanNameLower]) {
                displayNamesMap[d.cleanNameLower] = d.cleanNameDisplay;
            } else if (d.cleanNameDisplay.length < displayNamesMap[d.cleanNameLower].length) {
                // Ưu tiên tên ngắn gọn nhất làm tên đại diện
                displayNamesMap[d.cleanNameLower] = d.cleanNameDisplay;
            }
        });

        // Sắp xếp các Tên gốc từ ngắn đến dài (Để ưu tiên làm Thư mục cha)
        const uniqueCleanNames = Object.keys(displayNamesMap).sort((a, b) => a.length - b.length);

        const groupedRules = {};
        tempProcessed.forEach(d => {
            let matchedGroup = null;
            
            // Tìm thư mục cha: Nếu tên công việc hiện tại chứa tên Thư mục cha ở đầu
            for (const groupName of uniqueCleanNames) {
                if (d.cleanNameLower === groupName || 
                    d.cleanNameLower.startsWith(groupName + " ") || 
                    d.cleanNameLower.startsWith(groupName + " -")) {
                    matchedGroup = groupName;
                    break; // Chọn thư mục cha ngắn nhất
                }
            }
            
            if (!matchedGroup) matchedGroup = d.cleanNameLower; // Fallback an toàn

            if (!groupedRules[matchedGroup]) {
                groupedRules[matchedGroup] = {
                    baseNameDisplay: displayNamesMap[matchedGroup] || d.cleanNameDisplay, 
                    rules: []
                };
            }
            groupedRules[matchedGroup].rules.push(d);
        });

        // 4. Sắp xếp các nhóm theo bảng chữ cái
        const sortedGroups = Object.values(groupedRules).sort((a, b) => a.baseNameDisplay.localeCompare(b.baseNameDisplay));

        let lastGroupChar = null;
        let useColorB = false; 
        let groupIdCounter = 0;

        // Helper: Hàm Render 1 hàng dữ liệu
        const renderRow = (d, colorClass, isChild, parentId, forceShow = false) => {
            const tr = document.createElement("tr");
            tr.className = colorClass;
            
            if (isChild) {
                tr.classList.add("rule-child-row");
                tr.dataset.parent = parentId;
                tr.style.display = forceShow ? "table-row" : "none"; // Các hàng con mặc định bị ẩn
            }
            
            if (d.isExpired) {
                tr.style.color = "#999";
                tr.style.opacity = "0.7";
            }

            const noteDisplay = (d.note || "").replace("[CVAdmin]", "<b>[CVAdmin]</b>").replace("[CVChung]", "<b style='color:#3498db'>[CVChung]</b>");

            tr.innerHTML = `
                <td style="${d.isExpired ? 'text-decoration: line-through;' : ''}">${d.job}${noteDisplay ? `<br><span style="font-size: 0.85em; color: #7f8c8d; text-decoration: none; display: inline-block;">${noteDisplay}</span>` : ""}</td>
                <td>${d.time || "-"}</td>
                <td style="color: #d35400; font-weight:bold;">${d.exactDate ? d.exactDate.split('-').reverse().join('/') : "-"}</td>
                <td style="color: #c0392b;">${d.endDateDisplay}</td>
                <td style="font-size:0.9em; color:#555;">
                    ${d.exactDate ? "<i>(Bỏ qua định kỳ)</i>" : `N:${d.dom || "-"} | ${d.day === "8" ? "CN" : (d.day === "all" ? "Mọi ngày" : (d.day ? "T" + d.day : "-"))} | T:${d.week === "all" ? "Mọi tuần" : (d.week || "-")} | Th:${d.month === "all" ? "Mọi tháng" : (d.month || "-")}`}
                </td>
                <td style="white-space: nowrap; text-align: center;">
                    <div style="display: flex; gap: 4px; justify-content: center;">
                        <button class="editRuleBtn" data-id="${d.id}" style="background:#f39c12; padding: 4px 8px; font-size: 12px; border:none; border-radius:4px; color:white; cursor:pointer;">✏️ Sửa</button>
                    </div>
                </td>`;

            tr.querySelector(".editRuleBtn").addEventListener("click", () => {
                const ruleData = allRulesData.find(r => r.id === d.id);
                if (ruleData) openEditRuleModal(ruleData);
            });

            ruleListBody.appendChild(tr);
        };

        // 5. Chạy vòng lặp Render
        sortedGroups.forEach(group => {
            const currentGroupChar = getNormalizedFirstChar(group.baseNameDisplay);
            if (currentGroupChar !== lastGroupChar) {
                useColorB = !useColorB;
                lastGroupChar = currentGroupChar;
            }
            const colorClass = useColorB ? 'group-color-b' : 'group-color-a';

            if (group.rules.length === 1) {
                // Nếu nhóm chỉ có 1 công việc, render bình thường như cũ để tiết kiệm thao tác
                renderRow(group.rules[0], colorClass, false, null);
            } else {
                // Nếu có >= 2 công việc giống tên, tạo thư mục Header
                groupIdCounter++;
                const groupId = `job-group-${groupIdCounter}`;
                const toggleIcon = isSearching ? '▼' : '▶';
                
                const headerTr = document.createElement("tr");
                headerTr.className = `rule-group-header ${colorClass}`;
                headerTr.dataset.target = groupId;
                headerTr.innerHTML = `
                    <td colspan="6" style="text-align: left; padding: 10px; cursor: pointer; border-bottom: 1px solid #ccc;">
                        <span class="group-toggle-btn" style="display:inline-block; width: 22px; color: #3498db; font-size: 12px; font-weight: bold;">${toggleIcon}</span>
                        <b style="color: #2c3e50;">${group.baseNameDisplay}</b> 
                        <span style="font-weight:normal; color:#e74c3c; font-size: 0.85em; background: #fff; border: 1px solid #f5b7b1; padding: 2px 6px; border-radius: 12px; margin-left: 5px;">${group.rules.length} kỳ</span>
                    </td>
                `;
                
                // Gắn sự kiện đóng mở cho thư mục
                headerTr.addEventListener('click', function() {
                    const targetId = this.dataset.target;
                    const childRows = ruleListBody.querySelectorAll(`.rule-child-row[data-parent="${targetId}"]`);
                    const toggleBtn = this.querySelector('.group-toggle-btn');
                    
                    const isClosed = toggleBtn.textContent.trim() === '▶';
                    
                    childRows.forEach(row => {
                        row.style.display = isClosed ? 'table-row' : 'none';
                    });
                    toggleBtn.textContent = isClosed ? '▼' : '▶';
                });

                ruleListBody.appendChild(headerTr);

                // Render các công việc con (sắp xếp cái nào mới diễn ra thì đẩy lên trước)
                group.rules.sort((a, b) => {
                    const dateA = a.exactDate ? new Date(a.exactDate) : new Date(0);
                    const dateB = b.exactDate ? new Date(b.exactDate) : new Date(0);
                    if (dateA - dateB !== 0) return dateB - dateA; 
                    return b.job.localeCompare(a.job);
                });

                group.rules.forEach(d => renderRow(d, colorClass, true, groupId, isSearching));
            }
        });

        // --- KHÔI PHỤC VỊ TRÍ CUỘN ---
        if (scrollContainer) {
            scrollContainer.style.minHeight = "";
            scrollContainer.scrollTop = tableScrollTop;
        }
        if (document.getElementById("pageContent")) {
            document.getElementById("pageContent").scrollTop = pageScrollTop;
        }
    }

    // =========================================================================
    // LOGIC LƯU QUY TẮC CHUNG TỪ MODAL THÊM MỚI
    // =========================================================================
    document.getElementById("saveNewRuleBtn").addEventListener("click", async () => {
      const ruleType = document.getElementById("addRuleTypeSelect").value;
      
      if (ruleType === 'job') {
        const editId = document.getElementById("addJobRuleEditId").value;
        const isAdmin = document.getElementById("isAdminJobRuleCheckbox").checked;
        const isCommon = document.getElementById("isCommonJobRuleCheckbox").checked;
        const originalNote = jobNoteInput.value.trim();
        const jobNameVal = jobInput.value.trim();
        const ruleEndDateVal = document.getElementById("addRuleEndDate").value;

        if (!jobNameVal) return showSwal("error", "Vui lòng nhập tên công việc!");

        const exactDateVal = document.getElementById("exactDate").value;
        if (!exactDateVal && !domSelect.value && !daySelect.value && !weekSelect.value && !monthSelect.value) {
            return showSwal("error", "Vui lòng chọn Ngày cụ thể hoặc ít nhất một thời gian định kỳ (Ngày/Thứ/Tuần/Tháng)!");
        }

        const normalizedVal = jobNameVal.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        let noteStr = originalNote;
        if (isAdmin) noteStr = `[CVAdmin] ${originalNote}`.trim();
        else if (isCommon) noteStr = `[CVChung] ${originalNote}`.trim();

        // --- NẾU ĐANG Ở CHẾ ĐỘ SỬA (Do tìm nhanh) ---
        if (editId) {
            const otherRules = allRulesData.filter(r => r.id !== editId);
            const uniqueJobs = Array.from(new Set(otherRules.map(r => r.job).filter(Boolean)));
            
            const exactMatch = uniqueJobs.find(job => {
                 const normalizedJob = job.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                 return normalizedJob === normalizedVal;
            });
            const similarJobs = uniqueJobs.filter(job => {
                const normalizedJob = job.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return normalizedJob.includes(normalizedVal) && normalizedJob !== normalizedVal;
            });

            if (exactMatch) {
                const isConfirmed = await Swal.fire({
                    title: 'Công việc đã tồn tại!',
                    html: `Công việc "<b>${exactMatch}</b>" đã có sẵn.<br>Bạn chắc chắn muốn lưu với tên này?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#e74c3c',
                    cancelButtonColor: '#95a5a6',
                    confirmButtonText: 'Vẫn lưu',
                    cancelButtonText: 'Hủy'
                });
                if (!isConfirmed.isConfirmed) return;
            } else if (similarJobs.length > 0) {
                const suggestions = similarJobs.slice(0, 4).map(j => `"${j}"`).join(", ");
                const isConfirmed = await Swal.fire({
                    title: 'Công việc tương tự đã tồn tại!',
                    html: `Các công việc có thể giống với nội dung bạn nhập:<br><b>${suggestions}</b><br><br>Bạn có chắc chắn muốn tiếp tục lưu không?`,
                    icon: 'info',
                    showCancelButton: true,
                    confirmButtonColor: '#f39c12',
                    cancelButtonColor: '#95a5a6',
                    confirmButtonText: 'Vẫn lưu',
                    cancelButtonText: 'Hủy'
                });
                if (!isConfirmed.isConfirmed) return;
            }
            
            const updateData = {
                job: jobNameVal, time: document.getElementById("jobTime").value, exactDate: exactDateVal,
                day: daySelect.value, week: weekSelect.value, month: monthSelect.value, dom: domSelect.value,
                ruleEndDate: ruleEndDateVal, note: noteStr, is_admin_job: isAdmin, is_common_job: isCommon, updatedAt: serverTimestamp()
            };
            
            try {
                showLoading("Đang cập nhật...");
                await updateDoc(doc(db, "work_rules", editId), updateData);
                addLog("admin_update_work_rule", { email: getCurrentUserEmail(), ruleId: editId, targetName: jobNameVal, updateData });
                hideLoading();
                showSwal("success", "Đã cập nhật quy tắc!");
                
                [jobInput, daySelect, weekSelect, monthSelect, domSelect, document.getElementById("exactDate"), jobNoteInput, document.getElementById("jobTime"), document.getElementById("addRuleEndDate")].forEach(el => el.value = "");
                resetAddJobFormMode();
                updateAddRuleState();
                closeAddRuleModalFn();
            } catch (error) {
                hideLoading();
                Swal.fire("Lỗi!", "Không thể cập nhật: " + error.message, "error");
            }
            return; // Dừng tại đây, không chạy nhánh Add phía dưới
        }

        // --- KIỂM TRA TRÙNG LẶP / TƯƠNG TỰ KHI THÊM ---
        const uniqueJobs = Array.from(new Set(allRulesData.map(r => r.job).filter(Boolean)));
        
        const exactMatch = uniqueJobs.find(job => {
             const normalizedJob = job.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
             return normalizedJob === normalizedVal;
        });

        const similarJobs = uniqueJobs.filter(job => {
            const normalizedJob = job.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return normalizedJob.includes(normalizedVal) && normalizedJob !== normalizedVal;
        });

        if (exactMatch) {
            const isConfirmed = await Swal.fire({
                title: 'Công việc đã tồn tại!',
                html: `Công việc "<b>${exactMatch}</b>" đã có trong hệ thống.<br>Bạn có chắc chắn muốn thêm một quy tắc mới với cùng tên này không?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e74c3c',
                cancelButtonColor: '#95a5a6',
                confirmButtonText: 'Vẫn thêm',
                cancelButtonText: 'Hủy'
            });
            if (!isConfirmed.isConfirmed) return;
        } else if (similarJobs.length > 0) {
            const suggestions = similarJobs.slice(0, 4).map(j => `"${j}"`).join(", ");
            const isConfirmed = await Swal.fire({
                title: 'Công việc tương tự đã tồn tại!',
                html: `Các công việc có thể giống với nội dung bạn nhập:<br><b>${suggestions}</b><br><br>Bạn có chắc chắn muốn thêm mới không?`,
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#f39c12',
                cancelButtonColor: '#95a5a6',
                confirmButtonText: 'Vẫn thêm',
                cancelButtonText: 'Hủy'
            });
            if (!isConfirmed.isConfirmed) return;
        }
        // --- KẾT THÚC KIỂM TRA ---
        
        const jobData = {
            job: jobNameVal,
            time: document.getElementById("jobTime").value,
            exactDate: document.getElementById("exactDate").value,
            day: daySelect.value,
            week: weekSelect.value,
            month: monthSelect.value,
            ruleEndDate: ruleEndDateVal,
            dom: domSelect.value,
            note: noteStr,
            is_admin_job: isAdmin, // Vẫn lưu boolean để ẩn/hiện trên lịch
            is_common_job: isCommon,
            targetGroup: isCommon ? document.getElementById("addCommonJobTargetGroup").value : null,
            notifyTime: isCommon ? document.getElementById("addCommonJobNotifyTime").value : null,
            createdAt: serverTimestamp()
        };
        // (logic validation của bạn ở đây)

        try {
            const docRef = await addDoc(collection(db, "work_rules"), jobData);
            addLog("admin_create_work_rule", {
                email: getCurrentUserEmail(),
                ruleId: docRef.id,
                ...jobData
            });
            showSwal("success", "Đã lưu quy tắc!");
            
            if (isCommon && jobData.notifyTime === 'immediate') {
                sendImmediateNotificationGAS(jobNameVal, exactDateVal || domSelect.value || daySelect.value || weekSelect.value || monthSelect.value || "Định kỳ", jobData.targetGroup, noteStr);
            }
            
            [jobInput, daySelect, weekSelect, monthSelect, domSelect, document.getElementById("exactDate"), jobNoteInput, document.getElementById("jobTime"), document.getElementById("addRuleEndDate")].forEach(el => el.value = ""); 
            resetAddJobFormMode();
            updateAddRuleState();
            closeAddRuleModalFn();
        } catch (error) {
            addLog("admin_create_work_rule_error", {
                email: getCurrentUserEmail(),
                error: error.message,
                data: jobData
            });
            showSwal("error", "Lỗi!", "Không thể lưu quy tắc: " + error.message);
        }
      } else if (ruleType === 'pattern') {
        // --- BƯỚC 1: LẤY DỮ LIỆU CHUNG ---
        const user = document.getElementById("patternUser").value.trim();
        const displayName = document.getElementById("patternDisplayName").value.trim();
        const patternStartDate = document.getElementById("patternStartDate").value;
        const note = document.getElementById("patternNote").value.trim();
        const type = document.getElementById("patternTypeSelect").value;
        // Lưu trực tiếp chuỗi thời gian (VD: "19:00")
        const notifyTime = document.getElementById("patternNotifyTime").value;

        // --- VALIDATION CƠ BẢN ---
        if (!user || !displayName || !patternStartDate) {
            return Swal.fire("Thiếu thông tin!", "Vui lòng nhập Nhân viên, Tên hiển thị và Ngày bắt đầu.", "warning");
        }
        
        // Sử dụng Set email toàn cục đã được tải và cập nhật ở onAuth/setupRealtimeListeners
        if (!allKnownEmails.has(user)) {
            const isConfirmed = await Swal.fire({
                title: 'Sử dụng Email thủ công?',
                text: `Email "${user}" không nằm trong danh sách Tài khoản hệ thống (Firebase). Hệ thống sẽ ghi nhận đây là email nhận thông báo thủ công (nếu đây là chủ đích của bạn). Bạn có chắc chắn đã gõ đúng chính tả không?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#f39c12',
                cancelButtonColor: '#95a5a6',
                confirmButtonText: 'Đúng, tôi chắc chắn',
                cancelButtonText: 'Sửa lại'
            });
            if (!isConfirmed.isConfirmed) return;
        }

        let data = { user, displayName, patternStartDate, note, type, notifyTime, createdAt: serverTimestamp() };

        // --- BƯỚC 2: LẤY DỮ LIỆU VÀ VALIDATE TÙY THEO LOẠI QUY TẮC ---
        if (type === 'administrative') {
            const workDaysOfWeek = Array.from(document.querySelectorAll("#dayCheckboxes input:checked")).map(cb => parseInt(cb.value));
            const startTime = document.getElementById("adminStartTime").value;
            const endTime = document.getElementById("adminEndTime").value;

            if (workDaysOfWeek.length === 0) return Swal.fire("Thiếu thông tin!", "Vui lòng chọn ít nhất một thứ làm việc.", "warning");
            if (!startTime || !endTime) return Swal.fire("Thiếu thông tin!", "Vui lòng nhập Giờ bắt đầu và kết thúc.", "warning");
            
            data.workDaysOfWeek = workDaysOfWeek;
            data.startTime = startTime;
            data.endTime = endTime;

            let adminShiftGroup = document.getElementById("adminShiftGroupName").value.trim().replace(/\s+/g, ' ');
            data.shiftGroup = adminShiftGroup || "Hành chính";

            // Logic tự động phát hiện ca gối đầu
            const [startH, startM] = (data.startTime || "00:00").split(':').map(Number);
            const [endH, endM] = (data.endTime || "00:00").split(':').map(Number);
            if ( (endH < startH) || (endH === startH && endM < startM) ) {
                data.isNextDay = true;
            } else if (startH === endH && startM === endM && (startH !== 0 || startM !== 0)) {
                data.isNextDay = true;
            } else {
                data.isNextDay = false;
            }

        } else { // type === 'shift_rotation'
            const startTime = document.getElementById("shiftStartTime").value;
            const endTime = document.getElementById("shiftEndTime").value;
            
            // Chuẩn hóa chuỗi: xóa khoảng trắng thừa 2 đầu và giữa các từ để tránh lỗi (VD: "Vận  hành" -> "Vận hành")
            let shiftGroup = document.getElementById("shiftGroupName").value.trim().replace(/\s+/g, ' ');
            if (!shiftGroup) shiftGroup = "Vận hành";
            
            if (!startTime || !endTime) return Swal.fire("Thiếu thông tin!", "Vui lòng nhập Giờ bắt đầu và Giờ kết thúc ca.", "warning");
            data.startTime = startTime;
            data.endTime = endTime;
            data.shiftGroup = shiftGroup;

            // Logic tự động phát hiện ca gối đầu
            const [startH, startM] = (data.startTime || "00:00").split(':').map(Number);
            const [endH, endM] = (data.endTime || "00:00").split(':').map(Number);
            if ( (endH < startH) || (endH === startH && endM < startM) ) {
                data.isNextDay = true;
            } else if (startH === endH && startM === endM && (startH !== 0 || startM !== 0)) {
                data.isNextDay = true;
            } else {
                data.isNextDay = false;
            }
        }

        // --- BƯỚC 3: LƯU VÀO FIRESTORE VÀ GỌI APPS SCRIPT ---
        try {
            showLoading("Đang lưu quy tắc...");
            const docRef = await addDoc(collection(db, "work_patterns"), data);
            addLog("admin_create_work_pattern", {
                email: getCurrentUserEmail(),
                patternId: docRef.id,
                ...data
            });
            hideLoading(); // Tắt loading "Đang lưu quy tắc"
            
            closeAddRuleModalFn(); // Đóng modal thêm mới

            // === BẮT ĐẦU KHỐI GỬI EMAIL (ĐÃ SỬA LỖI LOADING) ===
            try {
                showLoading("Đang gửi email chào mừng..."); // Bật loading "Gửi email"
                const idToken = await auth.currentUser.getIdToken(true);
                const scriptUrl = "https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec";
                
                const formData = new FormData();
                formData.append("action", "addUser");
                formData.append("idToken", idToken);
                formData.append("data", JSON.stringify({ name: displayName, email: user })); 
                
                const response = await fetch(scriptUrl, { method: "POST", body: formData });
                const result = await response.json();
                
                if (result.success) {
                    addLog("apps_script_add_user_success", { email: getCurrentUserEmail(), status: "success", targetUser: user });
                    showSwal("success", "Đã gửi email chào mừng!");
                } else {
                    addLog("apps_script_add_user_failure", { email: getCurrentUserEmail(), targetEmail: user, error: result.message || result.error });
                    showSwal("warning", "Đã lưu (Lỗi gửi email)", `Đã lưu quy tắc, nhưng không thể gửi email: ${result.message || result.error}`);
                }
            } catch (err) {
                addLog("apps_script_call_error", { email: getCurrentUserEmail(), targetEmail: user, error: err.message });
                showSwal("warning", "Đã lưu (Lỗi gọi Script)", `Đã lưu quy tắc, nhưng không thể kết nối tới Apps Script: ${err.message}`);
            } finally {
                hideLoading();
                Swal.fire("✅ Đã lưu!", "Quy tắc đã được thêm thành công.", "success");
                
                // Xóa trống các ô nhập liệu cơ bản sau khi lưu thành công
                document.getElementById("patternUser").value = "";
                document.getElementById("patternDisplayName").value = "";
                document.getElementById("patternNote").value = "";
            }
            // === KẾT THÚC KHỐI GỬI EMAIL ===

        } catch (error) {
            // Lỗi khi lưu vào Firestore
            hideLoading();
            addLog("admin_create_work_pattern_error", {
                email: getCurrentUserEmail(),
                error: error.message,
                data: data
            });
            Swal.fire("Lỗi!", "Không thể lưu quy tắc: " + error.message, "error");
        }
      }
    });

    // =========================================================================
    // LOGIC HOÁN ĐỔI CA
    // =========================================================================
    const swapModal = document.getElementById("swapModal");
    
    document.getElementById("btn-openSwapModal").addEventListener("click", () => {
        // Reset form khi mở modal
        document.getElementById("swapDate").value = "";
        document.getElementById("swapUser1").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
        document.getElementById("swapUser2").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
        document.getElementById("swapReason").value = "";
        
        swapModal.style.display = "block";
        toggleBodyScroll(true);
    });

    // Hàm dùng chung để tải danh sách nhân viên theo ngày vào Select box
    function populateSwapUsersForDate(dateStr, select1Id, select2Id, defaultU1 = "", defaultU2 = "") {
        const select1 = document.getElementById(select1Id);
        const select2 = document.getElementById(select2Id);

        if (!dateStr) {
            select1.innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
            select2.innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
            return;
        }

        const d = new Date(dateStr + 'T00:00:00');
        const checkDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

        // 1. Tính toán danh sách nhân viên CÓ CA trực chính trong ngày này (Người A)
        const scheduledWorkers = new Set();
        const dayOfWeek = checkDate.getDay() === 0 ? 8 : checkDate.getDay() + 1;

        const adminRules = allPatternsData.filter(p => p.type === 'administrative');
        const shiftRules = allPatternsData.filter(p => p.type === 'shift_rotation');

        // Kiểm tra lịch Cố định
        adminRules.forEach(rule => {
            if (isRuleActiveOnDate(rule, checkDate) && Array.isArray(rule.workDaysOfWeek) && rule.workDaysOfWeek.includes(dayOfWeek)) {
                scheduledWorkers.add(rule.displayName);
            }
        });

        // Kiểm tra lịch Xoay ca
        if (shiftRules.length > 0) {
            const shiftGroups = {};
            shiftRules.forEach(rule => {
                const group = rule.shiftGroup || "Vận hành";
                if (!shiftGroups[group]) shiftGroups[group] = [];
                shiftGroups[group].push(rule);
            });

            for (const group in shiftGroups) {
                const groupRules = shiftGroups[group];
                const sortedGroupRules = [...groupRules].sort(sortShiftRules);
                const groupRefDate = new Date(sortedGroupRules[0].patternStartDate + 'T00:00:00');

                const membersToday = groupRules.filter(rule => isRuleActiveOnDate(rule, checkDate)).sort(sortShiftRules);

                if (membersToday.length > 0) {
                    const n_today = membersToday.length;
                    const daysSinceToday = getDaysDifference(checkDate, groupRefDate);
                    const workerIndexToday = (daysSinceToday % n_today + n_today) % n_today;
                    const workerToday = membersToday[workerIndexToday];
                    if (workerToday) {
                        scheduledWorkers.add(workerToday.displayName);
                    }
                }
            }
        }

        // 2. Tính toán danh sách TẤT CẢ nhân viên ĐANG HOẠT ĐỘNG
        const activeWorkers = new Set();
        allPatternsData.forEach(rule => {
            if (rule.displayName && isRuleActiveOnDate(rule, checkDate)) {
                activeWorkers.add(rule.displayName);
            }
        });

        // 3. Phân tách danh sách A và B
        const listA = Array.from(scheduledWorkers).sort();
        // Người B: Có trong nhóm Đang hoạt động, nhưng KHÔNG NẰM TRONG nhóm CÓ CA (A)
        const listB = Array.from(activeWorkers).filter(name => !scheduledWorkers.has(name)).sort();

        // 4. Đổ dữ liệu vào Select A (Người xin nghỉ)
        let optionsA = '<option value="">-- Chọn người xin nghỉ --</option>';
        if (listA.length === 0) {
            optionsA = '<option value="">-- Không có ai trực ngày này --</option>';
        } else {
            listA.forEach(u => optionsA += `<option value="${u}">${u}</option>`);
        }
        select1.innerHTML = optionsA;

        // 5. Đổ dữ liệu vào Select B (Người làm thay)
        let optionsB = '<option value="">-- Chọn người làm thay --</option>';
        if (listB.length === 0) {
            optionsB = '<option value="">-- Không có người rảnh --</option>';
        } else {
            listB.forEach(u => optionsB += `<option value="${u}">${u}</option>`);
        }
        select2.innerHTML = optionsB;

        if (defaultU1) select1.value = defaultU1;
        if (defaultU2) select2.value = defaultU2;
    }

    document.getElementById("swapDate").addEventListener("change", (e) => {
        populateSwapUsersForDate(e.target.value, "swapUser1", "swapUser2");
    });

    document.getElementById("editSwapDate").addEventListener("change", (e) => {
        populateSwapUsersForDate(e.target.value, "editSwapUser1", "editSwapUser2");
    });
    
    const closeSwapModalFn = () => {
        swapModal.style.display = "none";
        toggleBodyScroll(false);
        document.getElementById("swapDate").value = "";
        document.getElementById("swapReason").value = "";
        document.getElementById("swapUser1").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
        document.getElementById("swapUser2").innerHTML = '<option value="">-- Vui lòng chọn ngày trước --</option>';
    };
    document.getElementById("closeSwapModal").onclick = closeSwapModalFn;
    document.getElementById("cancelSwapBtn").onclick = closeSwapModalFn;

    document.getElementById("saveSwapBtn").addEventListener("click", async () => {
        const date = document.getElementById("swapDate").value;
        const user1 = document.getElementById("swapUser1").value;
        const user2 = document.getElementById("swapUser2").value;
        const reason = document.getElementById("swapReason").value.trim();
        
        if (!date || !user1 || !user2) return showSwal("error", "Thiếu thông tin ngày và nhân viên!");
        if (user1 === user2) return showSwal("error", "Không thể hoán đổi cho cùng 1 người!");
        
        try {
            showLoading("Đang lưu...");
            await addDoc(collection(db, "shift_swaps"), {
                date, user1, user2, reason,
                createdAt: serverTimestamp(),
                createdBy: getCurrentUserEmail()
            });
            addLog("admin_create_shift_swap", { email: getCurrentUserEmail(), date, user1, user2, reason });
            hideLoading();
            showSwal("success", "Đã lưu hoán đổi!");
            closeSwapModalFn();
        } catch(e) {
            hideLoading();
            showSwal("error", "Lỗi: " + e.message);
        }
    });

    // =========================================================================
    // LOGIC CHỈNH SỬA & XÓA HOÁN ĐỔI CA
    // =========================================================================
    const editSwapModal = document.getElementById("editSwapModal");

    function openEditSwapModal(swapData) {
        document.getElementById("editSwapId").value = swapData.id;
        document.getElementById("editSwapDate").value = swapData.date || "";
        document.getElementById("editSwapReason").value = swapData.reason || "";
        
        // Tự động tải danh sách User và set giá trị
        populateSwapUsersForDate(swapData.date, "editSwapUser1", "editSwapUser2", swapData.user1, swapData.user2);
        
        editSwapModal.style.display = "block";
        toggleBodyScroll(true);
    }

    const closeEditSwapModalFn = () => {
        editSwapModal.style.display = "none";
        toggleBodyScroll(false);
        
        // --- LÀM MỚI FORM SỬA HOÁN ĐỔI KHI ĐÓNG ---
        document.getElementById("editSwapId").value = "";
        document.getElementById("editSwapDate").value = "";
        document.getElementById("editSwapReason").value = "";
        document.getElementById("editSwapUser1").innerHTML = '';
        document.getElementById("editSwapUser2").innerHTML = '';
    };
    document.getElementById("closeEditSwapModal").onclick = closeEditSwapModalFn;
    document.getElementById("cancelEditSwapBtn").onclick = closeEditSwapModalFn;

    document.getElementById("saveEditSwapBtn").addEventListener("click", async () => {
        const id = document.getElementById("editSwapId").value;
        const date = document.getElementById("editSwapDate").value;
        const user1 = document.getElementById("editSwapUser1").value;
        const user2 = document.getElementById("editSwapUser2").value;
        const reason = document.getElementById("editSwapReason").value.trim();

        if (!date || !user1 || !user2) return showSwal("error", "Thiếu thông tin ngày và nhân viên!");
        if (user1 === user2) return showSwal("error", "Không thể hoán đổi cho cùng 1 người!");

        const updateData = { date, user1, user2, reason, updatedAt: serverTimestamp() };
        const oldData = allSwapsData.find(s => s.id === id) || {};
        const changes = {};
        const fieldLabels = { date: "Ngày đổi", user1: "Người xin nghỉ (A)", user2: "Người làm thay (B)", reason: "Lý do" };

        for (const key in updateData) {
            if (key !== "updatedAt" && oldData[key] !== updateData[key]) {
                changes[key] = { old: oldData[key], new: updateData[key], label: fieldLabels[key] || key };
            }
        }

        try {
            showLoading("Đang lưu...");
            await updateDoc(doc(db, "shift_swaps", id), updateData);
            addLog("admin_update_shift_swap", { email: getCurrentUserEmail(), targetName: `Hoán đổi ngày ${date.split('-').reverse().join('/')}`, changes, updateData });
            hideLoading();
            Swal.fire("Thành công!", "Đã cập nhật hoán đổi ca.", "success");
            closeEditSwapModalFn();
        } catch (error) {
            hideLoading();
            Swal.fire("Lỗi!", "Không thể cập nhật: " + error.message, "error");
        }
    });

    document.getElementById("deleteEditSwapBtn").addEventListener("click", async () => {
        const id = document.getElementById("editSwapId").value;
        const swapData = allSwapsData.find(s => s.id === id);
        Swal.fire({
            title: 'Xóa hoán đổi ca?',
            text: "Sẽ phục hồi lại ca trực ban đầu.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e74c3c',
            cancelButtonColor: '#95a5a6',
            confirmButtonText: 'Xóa',
            cancelButtonText: 'Hủy'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    showLoading("Đang xóa...");
                    await deleteDoc(doc(db, "shift_swaps", id));
                    addLog("admin_delete_shift_swap", { email: getCurrentUserEmail(), date: swapData.date, user1: swapData.user1, user2: swapData.user2 });
                    hideLoading();
                    showSwal("success", "Đã xóa thành công!");
                    closeEditSwapModalFn();
                } catch(err) {
                    hideLoading();
                    showSwal("error", "Lỗi: " + err.message);
                }
            }
        });
    });

    function renderSwapList() {
        const tbody = document.querySelector("#swapList tbody");
        if (!tbody) return;
        
        // --- BẢO TOÀN VỊ TRÍ CUỘN TRANG & BẢNG ---
        const scrollContainer = document.querySelector("#swapConfig .collapsible-content");
        const tableScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const pageScrollTop = document.getElementById("pageContent") ? document.getElementById("pageContent").scrollTop : 0;
        
        if (scrollContainer) {
            scrollContainer.style.minHeight = scrollContainer.scrollHeight + "px";
        }

        tbody.innerHTML = "";
        [...allSwapsData].sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0)).forEach(s => {
            const tr = document.createElement("tr");
            const createdAtStr = s.createdAt && s.createdAt.toDate ? s.createdAt.toDate().toLocaleString('vi-VN') : "-";
            const dateStr = s.date ? s.date.split('-').reverse().join('/') : "-";
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${s.user1 || "-"}</td>
                <td>${s.user2 || "-"}</td>
                <td>${s.reason || "-"}</td>
                <td>${createdAtStr}</td>
                <td><button class="editSwapBtn" data-id="${s.id}" style="background:#f39c12; padding: 4px 10px; border:none; color:white; border-radius:4px; cursor:pointer;">✏️ Sửa</button></td>
            `;
            tr.querySelector('.editSwapBtn').addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                const swapData = allSwapsData.find(swap => swap.id === id);
                if (swapData) openEditSwapModal(swapData);
            });
            tbody.appendChild(tr);
        });
    }

// --- LOGIC MỚI: ĐIỀU KHIỂN GIAO DIỆN MỤC 3 ---
    const patternTypeSelect = document.getElementById('patternTypeSelect');
    const administrativeInputs = document.getElementById('administrativeInputs');
    const shiftRotationInputs = document.getElementById('shiftRotationInputs');

    patternTypeSelect.addEventListener('change', () => {
        if (patternTypeSelect.value === 'administrative') {
            administrativeInputs.style.display = 'block';
            shiftRotationInputs.style.display = 'none';
        } else {
            administrativeInputs.style.display = 'none';
            shiftRotationInputs.style.display = 'block';
        }
    });

    
function renderPatternList(patternsToRender) {
        const tbody = document.querySelector("#patternList tbody");
        if (!tbody) return;
        
        // --- BẢO TOÀN VỊ TRÍ CUỘN TRANG & BẢNG ---
        const scrollContainer = document.querySelector("#workPatternConfig .collapsible-content");
        const tableScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const pageScrollTop = document.getElementById("pageContent") ? document.getElementById("pageContent").scrollTop : 0;
        
        if (scrollContainer) {
            scrollContainer.style.minHeight = scrollContainer.scrollHeight + "px";
        }

        tbody.innerHTML = "";
        
        const todayForCheck = new Date();
        todayForCheck.setHours(0, 0, 0, 0);
        
        patternsToRender.forEach(d => {
            let detail = "", startTime = d.startTime || "-", endTime = "-";
            
            let isExpired = false;
            if (d.patternEndDate) {
                const endDateObj = new Date(d.patternEndDate + 'T00:00:00');
                if (todayForCheck > endDateObj) {
                    isExpired = true;
                }
            }
            const nameStyle = isExpired ? 'text-decoration: line-through; color: #999;' : '';

            if (d.type === 'administrative') {
                const mapDay = {2:"T2",3:"T3",4:"T4",5:"T5",6:"T6",7:"T7",8:"CN"};
            // SỬA LỖI: Đảm bảo workDaysOfWeek là một mảng trước khi gọi .map()
            const workDays = Array.isArray(d.workDaysOfWeek) ? d.workDaysOfWeek : [];
            const daysStr = workDays.map(x => mapDay[x]).join(", ");
                const groupNameDisplay = d.shiftGroup ? `[${d.shiftGroup}]` : `[Hành chính]`;
                detail = `${groupNameDisplay} ${daysStr}`;
                endTime = d.endTime || "-"; // Hiển thị giờ KT
                if(d.isNextDay) detail += " (Gối đầu)"; // Thêm chi tiết gối đầu
            } else if (d.type === 'shift_rotation') {
                endTime = d.endTime || "-"; // Hiển thị giờ KT
                let groupNameDisplay;
                if (d.shiftGroup) {
                    groupNameDisplay = `[${d.shiftGroup}]`;
                } else {
                    groupNameDisplay = `[Vận hành (mặc định)]`;
                }
                if (d.isNextDay === true) {
                    detail = `${groupNameDisplay} (Kết thúc hôm sau)`;
                } else {
                    detail = `${groupNameDisplay} (Trong ngày)`;
                }
            }
            if (d.isNextDay === true && endTime !== "-") {
                                endTime += " *";
            }
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="${nameStyle}">${d.user}</td>
                <td style="${nameStyle}">${d.displayName || "-"}</td>
                <td>${d.type === "administrative" ? "Cố định" : "Xoay Vòng"}</td>
                <td>${detail}</td>
                <td>${d.patternStartDate}</td>
                <td>${d.patternEndDate || "-"}</td>
                <td>${startTime}</td>
                <td>${endTime}</td>
                <td style="white-space: nowrap; text-align: center;">
                    <button class="editPatternBtn" data-id="${d.id}" style="background:#f39c12; padding: 4px 10px;">✏️ Sửa</button>
                </td>`;

            // Gắn sự kiện cho nút Sửa mở Modal
            tr.querySelector(".editPatternBtn").addEventListener("click", (e) => {
                const patternId = e.target.dataset.id;
                const patternData = patternsToRender.find(p => p.id === patternId);
                if(patternData) {
                    openEditPatternModal(patternData);
                }
            });
            tbody.appendChild(tr);
        });

        // --- KHÔI PHỤC VỊ TRÍ CUỘN ---
        if (scrollContainer) {
            scrollContainer.style.minHeight = "";
            scrollContainer.scrollTop = tableScrollTop;
        }
        if (document.getElementById("pageContent")) {
            document.getElementById("pageContent").scrollTop = pageScrollTop;
        }
    }
    // Xóa hàm findWorkersForDate cũ đi.
    // Thay thế hoàn toàn hàm renderSchedule cũ bằng hàm mới này.

// Hàm renderSchedule thay thế — dán đè hàm cũ
async function renderSchedule(searchQuery = "", referenceDate = new Date()) {
    scheduleBody.innerHTML = "";
    
    const lowerCaseQuery = searchQuery.toLowerCase().trim();

    const weekStart = new Date(referenceDate);
    weekStart.setDate(referenceDate.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));

    const adminRules = allPatternsData.filter(p => p.type === 'administrative');
    const allShiftRules = allPatternsData.filter(p => p.type === 'shift_rotation');

    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const yesterday = new Date(d);
        yesterday.setDate(d.getDate() - 1);

        const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const swapsForDate = allSwapsData.filter(s => s.date === isoDate);

        let people = [];  // danh sách người làm (tên + ca/giờ)

        const dayOfWeek = d.getDay() === 0 ? 8 : d.getDay() + 1;

        // ===== 1) LỊCH CỐ ĐỊNH (CẬP NHẬT CẢI TIẾN 1) =====
        adminRules.forEach(rule => {
            if (!isRuleActiveOnDate(rule, d) || !Array.isArray(rule.workDaysOfWeek)) {
                return;
            }

            const startTime = rule.startTime || "00:00";
            const endTime = rule.endTime || "00:00";
            
            // --- LOGIC MỚI TỰ SUY LUẬN ---
            const [startH, startM] = (startTime || "00:00").split(':').map(Number);
            const [endH, endM] = (endTime || "00:00").split(':').map(Number);
            let isNightShift = false;

            if ( (endH < startH) || (endH === startH && endM < startM) ) {
                isNightShift = true;
            } else if (rule.isNextDay === true && startH === endH && startM === endM) {
                isNightShift = true; // Xử lý ca 24h
            }
            // --- KẾT THÚC LOGIC MỚI ---
            
            const prevDay = dayOfWeek === 2 ? 8 : dayOfWeek - 1;

            // 1️⃣ Ca bắt đầu hôm nay
            if (rule.workDaysOfWeek.includes(dayOfWeek)) {
                let displayName = rule.displayName;
                
                // CHECK HOÁN ĐỔI CA
                const swap = swapsForDate.find(s => s.user1 === displayName);
                let swapText = "";
                if (swap) {
                    displayName = swap.user2;
                    swapText = ` 🔄 (Thay ${swap.user1})`;
                }
                const groupTag = rule.shiftGroup ? ` [${rule.shiftGroup}]` : ` [Hành chính]`;
                const shiftLabel = isNightShift
                    ? `- ${displayName} (${startTime} – ${endTime} hôm sau)${groupTag}${swapText}`
                    : `- ${displayName} (${startTime} – ${endTime})${groupTag}${swapText}`;
                people.push(shiftLabel);
                // (Không tìm công việc ở đây nữa)
            }
            // 2️⃣ Ca bắt đầu hôm qua nhưng kéo sang hôm nay
            else if (isNightShift && rule.workDaysOfWeek.includes(prevDay)) {
                //const shiftLabel = `- ${rule.displayName} (Tiếp ca đêm ${startTime} hôm qua – ${endTime} sáng nay)`;
                //people.push(shiftLabel);
                // (Không tìm công việc ở đây nữa)
            }
        });


        // ===== 2) LỊCH XOAY CA (CẬP NHẬT CẢI TIẾN 4) =====
        if (allShiftRules.length > 0) {
            
            // Nhóm các quy tắc theo shiftGroup
            const shiftGroups = {};
            allShiftRules.forEach(rule => {
                const group = rule.shiftGroup || "Vận hành";
                if (!shiftGroups[group]) shiftGroups[group] = [];
                shiftGroups[group].push(rule);
            });

            // Duyệt qua từng nhóm để tính toán độc lập
            for (const group in shiftGroups) {
                const groupRules = shiftGroups[group];

                // 1. Tìm "Ngày 0" (refDate) ổn định cho NHÓM NÀY
                const sortedGroupRules = [...groupRules].sort(sortShiftRules);
                const groupRefDate = new Date(sortedGroupRules[0].patternStartDate + 'T00:00:00');
                
                // 2. Lọc và SẮP XẾP danh sách HÔM QUA cho NHÓM NÀY
                const membersYesterday = groupRules
                    .filter(rule => isRuleActiveOnDate(rule, yesterday))
                    .sort(sortShiftRules);
                
                // 3. Lọc và SẮP XẾP danh sách HÔM NAY cho NHÓM NÀY
                const membersToday = groupRules
                    .filter(rule => isRuleActiveOnDate(rule, d))
                    .sort(sortShiftRules);

                let workerYesterday = null, isNightYesterday = false, workerYesterdayName = null;

                // 4. TÍNH CA HÔM QUA
                if (membersYesterday.length > 0) {
                    const n_yesterday = membersYesterday.length;
                    const daysSinceYesterday = getDaysDifference(yesterday, groupRefDate);
                    const workerIndexYesterday = (daysSinceYesterday % n_yesterday + n_yesterday) % n_yesterday;
                    
                    workerYesterday = membersYesterday[workerIndexYesterday];
                    workerYesterdayName = workerYesterday.displayName;
                    if (workerYesterday) {
                        const [startH, startM] = (workerYesterday.startTime || "00:00").split(':').map(Number);
                        const [endH, endM] = (workerYesterday.endTime || "00:00").split(':').map(Number);

                        if ( (endH < startH) || (endH === startH && endM < startM) ) {
                            isNightYesterday = true;
                        } else if (workerYesterday.isNextDay === true && startH === endH && startM === endM) {
                            isNightYesterday = true; // Ca 24h
                        }
                    }
                }

                // 5. TÍNH CA HÔM NAY
                if (membersToday.length > 0) {
                    const n_today = membersToday.length;
                    const daysSinceToday = getDaysDifference(d, groupRefDate);
                    const workerIndexToday = (daysSinceToday % n_today + n_today) % n_today;
                    const workerToday = membersToday[workerIndexToday];
                    
                    if (workerToday) {
                        let isNightToday = false;
                        const [startH, startM] = (workerToday.startTime || "00:00").split(':').map(Number);
                        const [endH, endM] = (workerToday.endTime || "00:00").split(':').map(Number);

                        if ( (endH < startH) || (endH === startH && endM < startM) ) {
                            isNightToday = true;
                        } else if (workerToday.isNextDay === true && startH === endH && startM === endM) {
                            isNightToday = true; // Ca 24h
                        }
                        if (!isNightYesterday || workerYesterdayName !== workerToday.displayName) {
                            let displayName = workerToday.displayName;
                            
                            // CHECK HOÁN ĐỔI CA
                            const swap = swapsForDate.find(s => s.user1 === displayName);
                            let swapText = "";
                            if (swap) {
                                displayName = swap.user2;
                                swapText = ` 🔄 (Thay ${swap.user1})`;
                            }
                            // Thêm tên nhóm vào label nếu có nhiều nhóm (để dễ phân biệt)
                            const groupTag = Object.keys(shiftGroups).length > 1 ? ` [${group}]` : "";
                            const shiftLabel = `- ${displayName} (${workerToday.startTime} – ${workerToday.endTime}${isNightToday ? " hôm sau" : ""})${groupTag}${swapText}`;
                            people.push(shiftLabel);
                        }
                    }
                }
            }
        }

// ===== 3) TỔNG HỢP CÔNG VIỆC (CẬP NHẬT CẢI TIẾN 2) =====
        
        let jobsForDay = []; // Khởi tạo mảng công việc
        
        // 3.1) Lọc Công việc Quy tắc (Mục 1)
        const allRuleJobs = allRulesData.filter(rule => 
            ( !rule.is_admin_job ) &&
            ruleMatchesDate(rule, d) 
        );
        allRuleJobs.forEach(r => {
            const timeStr = r.time ? ` <strong>(${r.time})</strong>` : "";
            // Tạo ghi chú
            const noteDisplay = (r.note || "").replace("[CVAdmin]", "<span style='color:#e74c3c; font-weight:bold;'>[CVAdmin]</span>").replace("[CVChung]", "<span style='color:#3498db; font-weight:bold;'>[CVChung]</span>");
            const noteStr = noteDisplay ? `<div style="color:#666; font-style:italic; font-size:0.9em; margin-top:2px; padding-left:14px;">↳ 📝 Ghi chú: ${noteDisplay}</div>` : "";
            const targetTag = (r.is_common_job && r.targetGroup && r.targetGroup !== 'all') ? `<span style='color:#8e44ad; font-weight:bold;'>[Nhóm: ${r.targetGroup}]</span> ` : "";
            jobsForDay.push(`<div style="margin-bottom:8px;">• ${targetTag}${r.job}${timeStr}${noteStr}</div>`);
        });

        // ===== 4) HIỂN THỊ TRÊN BẢNG =====
        const thuDisplay = d.getDay() === 0 ? 'Chủ Nhật' : 'Thứ ' + (d.getDay() + 1);
        const dateStr = d.toLocaleDateString("vi-VN");
        const [year, weekNo] = getWeekNumber(d);
        const tr = document.createElement("tr");
        
        // Thêm tô sáng "hôm nay"
        const today = new Date();
        if (d.toDateString() === today.toDateString()) {
            tr.classList.add('today-row');
        }

        // Xác định class ẩn trên mobile nếu dữ liệu trống
        const hidePeopleClass = people.length === 0 ? "hide-empty-mobile" : "";
        const hideJobsClass = jobsForDay.length === 0 ? "hide-empty-mobile" : "";

        tr.innerHTML = `
            <td data-label="Ngày">${thuDisplay} (${dateStr}) <br> <span class="week-label">(Tuần ${weekNo})</span></td>
            <td data-label="Người làm" class="${hidePeopleClass}">${people.length ? people.join('<br>') : '-'}</td>
            <td data-label="Nội dung công việc" class="${hideJobsClass}">${jobsForDay.length ? jobsForDay.join('') : '-'}</td>
        `;
        if (lowerCaseQuery && tr.textContent.toLowerCase().includes(lowerCaseQuery)) {
            tr.classList.add('highlight');
        }
        scheduleBody.appendChild(tr);
    }

    const [year, weekNo] = getWeekNumber(referenceDate);
    document.getElementById('weekNumberDisplay').textContent = `Tuần ${weekNo} / ${year}`;
    
}

    


    // Logic modal
    closeModalBtn.onclick = () => {
        toggleBodyScroll(false); // Khôi phục scroll
        personalScheduleModal.style.display = "none";
    };
    window.onclick = (event) => { 
        if (event.target == personalScheduleModal) {
            toggleBodyScroll(false); // Khôi phục scroll
            personalScheduleModal.style.display = "none"; 
        }
        if (event.target == document.getElementById("monthScheduleModal")) {
            closeMonthScheduleModal();
        }
    };
    document.getElementById("closeModalBottom").onclick = () => {
        toggleBodyScroll(false); // Khôi phục scroll
        personalScheduleModal.style.display = "none";
    };

    

    // Logic tìm kiếm
    const globalSearchInput = document.getElementById('globalSearchInput');
    globalSearchInput.addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        filterAndRenderAdminLists(query);
        renderSchedule(query, currentlyViewedDate);
    });

    // In lịch tuần
    document.getElementById('printScheduleBtn').addEventListener('click', () => {
        window.print();
    });

    function filterAndRenderAdminLists(query) {
        // Nếu không có query, hiển thị lại tất cả
        if (!query) {
            renderRuleList(allRulesData);
            renderPatternList(allPatternsData);
            renderAdminTaskList(allRulesData);
            return;
        }

        // 1. Lọc Bảng 1: Quy tắc công việc (Tìm theo Tên CV, Ghi chú)
        const filteredRules = allRulesData.filter(rule => 
            (rule.job && rule.job.toLowerCase().includes(query)) ||
            (rule.note && rule.note.toLowerCase().includes(query))
        );
        renderRuleList(filteredRules);

        // 2. Lọc Bảng 2: Quy tắc ngày làm (Quy tắc mẫu)
        const filteredPatterns = allPatternsData.filter(p => 
            (p.user && p.user.toLowerCase().includes(query)) ||
            (p.displayName && p.displayName.toLowerCase().includes(query))
        );
        renderPatternList(filteredPatterns);
    }
    // Logic chuyển tuần
    const weekNav = document.getElementById('weekNavigator');
    if (weekNav) {
        weekNav.addEventListener('click', (event) => {
            const targetId = event.target.id;
            const currentYear = currentlyViewedDate.getFullYear();
            switch (targetId) {
                case 'prevWeekBtn': currentlyViewedDate.setDate(currentlyViewedDate.getDate() - 7); break;
                case 'nextWeekBtn': currentlyViewedDate.setDate(currentlyViewedDate.getDate() + 7); break;
                case 'todayWeekBtn': currentlyViewedDate = new Date(); break;
                case 'firstWeekBtn': currentlyViewedDate = new Date(currentYear, 0, 1); break;
                case 'lastWeekBtn': currentlyViewedDate = new Date(currentYear, 11, 31); break;
                default: return;
            }
            renderSchedule(globalSearchInput.value, currentlyViewedDate);
        });
    }
    
    // Hàm gọi GAS gửi email tức thì cho CV Chung
    async function sendImmediateNotificationGAS(job, dateInfo, targetGroup, note) {
        try {
            const idToken = await auth.currentUser.getIdToken(true);
            const scriptUrl = "https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec";
            const formData = new FormData();
            formData.append("action", "sendImmediateJobNotification");
            formData.append("idToken", idToken);
            formData.append("data", JSON.stringify({ job, dateInfo, targetGroup, note }));
            
            fetch(scriptUrl, { method: "POST", body: formData }); // Chạy ngầm không chặn UI
        } catch (e) {
            console.error("Lỗi gửi thông báo ngay lập tức:", e);
        }
    }

  // Hàm gọi modal lịch làm việc cá nhân (ĐÃ SỬA LẠI HOÀN TOÀN)
  async function showPersonalScheduleModal(email, currentUserRole) {
      // Reset scroll về đầu trang và giữa màn hình
      window.scrollTo(0, 0);
      toggleBodyScroll(true); // Chặn scroll khi modal mở
      
      personalScheduleModal.style.display = "block";
      personalScheduleDetails.innerHTML = "<p>Đang tải lịch cá nhân...</p>";

      // Lấy tên hiển thị của tài khoản đang đăng nhập
      let myDisplayName = null;
      const myPattern = allPatternsData.find(p => p.user === email);
      if (myPattern) myDisplayName = myPattern.displayName;
      if (!myDisplayName && currentUserRole !== 'admin') {
          return personalScheduleDetails.innerHTML = "<p>Không tìm thấy tài khoản nhân viên.</p>";
      }

      const today = new Date();
      today.setHours(0,0,0,0);
      let html = '';

      if (currentUserRole === 'admin') {
          document.querySelector("#personalScheduleModal h2").textContent = "Công việc Admin";
          const adminRules = allRulesData.filter(r => r.is_admin_job);
          let taskList = [];

          adminRules.forEach(d => {
              const lastMatchDate = getLastMatchDate(d);
              const nextMatchDate = getNextMatchDate(d);
              const [h, m] = (d.time || "23:59").split(':').map(Number);
              const currentNow = new Date();
              const todayMidnight = new Date(currentNow); 
              todayMidnight.setHours(0, 0, 0, 0);

              const createTaskRow = (targetDate, isFuture) => {
                  if (!targetDate) return null;
                  const matchDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`;
                  
                  let isCompleted = false;
                  if (d.lastCompletedDate === matchDateStr) {
                      isCompleted = true;
                  }
                  
                  // Chỉ quan tâm các công việc CHƯA hoàn thành
                  if (isCompleted) return null;

                  const dueDateTime = new Date(targetDate);
                  dueDateTime.setHours(h, m, 0, 0);
                  const dueMidnight = new Date(targetDate); 
                  dueMidnight.setHours(0, 0, 0, 0);

                  const currentHistory = (d.progressHistory && d.progressHistory[matchDateStr]) ? d.progressHistory[matchDateStr] : [];
                  const isInProgress = currentHistory.length > 0;

                  let category = 5;
                  let diffDays = 999;
                  let statusText = "";
                  let statusColor = "";

                  if (!isFuture) {
                      if (currentNow > dueDateTime) {
                          category = 2; // Quá hạn
                          const daysOverdue = Math.floor((todayMidnight - dueMidnight) / (1000 * 60 * 60 * 24));
                          if (isInProgress) {
                              statusText = daysOverdue > 0 ? `🏃 Đang làm (Quá hạn ${daysOverdue} ngày)` : '🏃 Đang làm (Quá hạn)';
                              statusColor = '#d35400';
                          } else {
                              statusText = daysOverdue > 0 ? `⚠️ Quá hạn (${daysOverdue} ngày)` : '⚠️ Quá hạn';
                              statusColor = '#e74c3c';
                          }
                      } else {
                          category = 1; // Sắp đến hạn (hôm nay)
                          statusText = isInProgress ? '🏃 Đang làm (Hạn hôm nay)' : '⏳ Đến hạn hôm nay';
                          statusColor = isInProgress ? '#2980b9' : '#f39c12';
                          diffDays = 0;
                      }
                  } else {
                      const daysUntil = Math.ceil((dueMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
                      diffDays = daysUntil;
                      if (daysUntil <= 7) {
                          category = 1; // Sắp đến hạn
                          statusText = isInProgress ? `🏃 Đang làm (Còn ${daysUntil} ngày)` : `🔔 Sắp đến hạn (${daysUntil} ngày)`;
                          statusColor = isInProgress ? '#2980b9' : '#3498db';
                      } else {
                          // Bỏ qua tương lai xa > 7 ngày
                          return null;
                      }
                  }

                  return {
                      id: d.id,
                      job: d.job,
                      time: d.time || "23:59",
                      category: category,
                      targetDate: targetDate,
                      diffDays: diffDays,
                      statusText: statusText,
                      statusColor: statusColor,
                      note: d.note ? d.note.replace("[CVAdmin]", "").trim() : "",
                      currentHistory: currentHistory
                  };
              };

              const pastTask = createTaskRow(lastMatchDate, false);
              const futureTask = createTaskRow(nextMatchDate, true);

              if (pastTask) taskList.push(pastTask);
              if (futureTask && (!pastTask || futureTask.targetDate.getTime() !== pastTask.targetDate.getTime())) {
                  taskList.push(futureTask);
              }
          });

          const uniqueTasks = [];
          const seenKeys = new Set();
          taskList.forEach(t => {
             const key = `${t.job}_${t.targetDate.getTime()}`;
             if (!seenKeys.has(key)) {
                 seenKeys.add(key);
                 uniqueTasks.push(t);
             }
          });

          uniqueTasks.sort((a, b) => {
              if (a.category !== b.category) return a.category - b.category;
              if (a.category === 1) return a.diffDays - b.diffDays;
              if (a.category === 2) return a.targetDate - b.targetDate; // Quá hạn lâu nhất lên đầu
              return a.targetDate - b.targetDate;
          });

          if (uniqueTasks.length > 0) {
              html = `<div style="width: 100%; max-width: 100%; box-sizing: border-box; overflow: visible;">
                  <table style="width: 100%; max-width: 100%; min-width: 0; text-align:left; table-layout: fixed; font-size: 14px; box-sizing: border-box; word-break: break-word;">
                  <thead>
                    <tr style="background:#f0f0f0;">
                      <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px;">Công việc</th>
                      <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; width: 270px;">Hạn / Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>`;
              
              uniqueTasks.forEach(task => {
                  const displayDate = `${String(task.targetDate.getDate()).padStart(2,'0')}/${String(task.targetDate.getMonth()+1).padStart(2,'0')}/${task.targetDate.getFullYear()}`;
                  let bg = "";
                  if (task.category === 1) bg = "#ebf5fb";
                  else if (task.category === 2) bg = "#fdedec";

                  let statusHtml = `<span style="color: ${task.statusColor}; font-weight:bold; font-size: 0.9em;">${task.statusText}</span>`;
                  if (task.currentHistory && task.currentHistory.length > 0) {
                      const lastUpdate = task.currentHistory[task.currentHistory.length - 1];
                      statusHtml += `<br><span style="font-size: 0.85em; color: #2980b9; font-style: italic;">↳ Tiến độ: ${lastUpdate.note}</span>`;
                  }

                  html += `
                  <tr class="admin-task-row" data-task-id="${task.id}" style="background:${bg}; cursor: pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1" title="Nhấn để chuyển đến xử lý công việc này">
                      <td style="padding: 8px; border: 1px solid #ccc; text-align: left; font-size: 14px; word-break: break-word;">
                          <b>${task.job}</b>
                          ${task.note ? `<br><span style="font-size: 0.85em; color: #7f8c8d;">${task.note}</span>` : ""}
                      </td>
                      <td style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; word-break: break-word;">
                          ${displayDate} ${task.time}<br>
                          ${statusHtml}
                      </td>
                  </tr>`;
              });
              html += `</tbody></table></div>`;
          } else {
              html = `<p style="text-align:center; color:#2ecc71; font-weight:bold; font-size: 16px; padding: 20px 0;">🎉 Tuyệt vời! Không có công việc Admin nào quá hạn hoặc sắp đến hạn trong 7 ngày tới.</p>`;
          }

      } else {
          document.querySelector("#personalScheduleModal h2").textContent = "Ca làm việc gần nhất của bạn";
          const allShiftRules = allPatternsData.filter(p => p.type === 'shift_rotation');
          const adminRulesAll = allPatternsData.filter(p => p.type === 'administrative');
          
          let foundDayHtml = "";
          
          for (let i = 0; i <= 14; i++) {
              const d = new Date(); 
              d.setDate(d.getDate() + i);
              const checkDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()); 

              const dayNum = d.getDay() === 0 ? 8 : d.getDay() + 1;
              const isToday = i === 0;
              const dateStr = d.toLocaleDateString("vi-VN");
              const thuDisplay = d.getDay() === 0 ? 'Chủ Nhật' : 'Thứ ' + (d.getDay() + 1);
              const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const swapsForDate = allSwapsData.filter(s => s.date === isoDate);

              let matchedShifts = [];

              adminRulesAll.forEach(rule => {
                  if (!isRuleActiveOnDate(rule, checkDate)) return;
                  if (Array.isArray(rule.workDaysOfWeek) && rule.workDaysOfWeek.includes(dayNum)) {
                      let finalName = rule.displayName;
                      const swap = swapsForDate.find(s => s.user1 === finalName);
                      let swapText = "";
                      if (swap) {
                          finalName = swap.user2;
                          swapText = ` 🔄 (Thay ${swap.user1})`;
                      }
                      if (finalName === myDisplayName) {
                          const groupTag = rule.shiftGroup ? ` [${rule.shiftGroup}]` : ` [Hành chính]`;
                          matchedShifts.push(`👤 ${finalName} (${rule.startTime} – ${rule.endTime}${rule.isNextDay ? " (hôm sau)" : ""})${groupTag}${swapText}`);
                      }
                  }
              });

              if (allShiftRules.length > 0) {
                  const shiftGroups = {};
                  allShiftRules.forEach(rule => {
                      const groupName = rule.shiftGroup || "Vận hành";
                      if (!shiftGroups[groupName]) shiftGroups[groupName] = [];
                      shiftGroups[groupName].push(rule);
                  });
                  for (const group in shiftGroups) {
                      const groupRules = shiftGroups[group];
                      const sortedGroupRules = [...groupRules].sort(sortShiftRules);
                      const groupRefDate = groupRules.length > 0 ? new Date(sortedGroupRules[0].patternStartDate + 'T00:00:00') : null;

                      if (groupRefDate) {
                          const allMembersToday = groupRules.filter(r => isRuleActiveOnDate(r, checkDate)).sort(sortShiftRules);
                          if (allMembersToday.length > 0) {
                              const n_today = allMembersToday.length;
                              const daysSinceToday = getDaysDifference(checkDate, groupRefDate);
                              const workerIndexToday = (daysSinceToday % n_today + n_today) % n_today;
                              const workerToday = allMembersToday[workerIndexToday];
                              
                              if (workerToday) {
                                  let finalName = workerToday.displayName;
                                  const swap = swapsForDate.find(s => s.user1 === finalName);
                                  let swapText = "";
                                  if (swap) {
                                      finalName = swap.user2;
                                      swapText = ` 🔄 (Thay ${swap.user1})`;
                                  }
                                  if (finalName === myDisplayName) {
                                      const groupTag = workerToday.shiftGroup ? ` [${workerToday.shiftGroup}]` : ` [Vận hành]`;
                                      matchedShifts.push(`👤 ${finalName} (${workerToday.startTime} – ${workerToday.endTime}${workerToday.isNextDay ? " (hôm sau)" : ""})${groupTag}${swapText}`);
                                  }
                              }
                          }
                      }
                  }
              }

              const myShiftGroup = myPattern ? myPattern.shiftGroup : null;
              const allRuleJobs = allRulesData.filter(rule => 
                  !rule.is_admin_job && ruleMatchesDate(rule, checkDate)
              );
              const personalRuleJobs = allRuleJobs.filter(rule => {
                  if (rule.is_common_job && rule.targetGroup && rule.targetGroup !== 'all' && rule.targetGroup !== myShiftGroup) return false;
                  return true;
              });

              // Kiểm tra xem ngày này có Công việc chung không
              const hasCommonJobs = personalRuleJobs.some(r => r.is_common_job);

              if (matchedShifts.length > 0 || hasCommonJobs) {
                  let tasksHtml = "";
                  if (personalRuleJobs.length > 0) {
                      const tasksArray = personalRuleJobs.map(task => {
                          const noteDisplay = (task.note || "").replace("[CVChung]", "<b style='color:#3498db'>[CVChung]</b>");
                          let noteString = noteDisplay && noteDisplay !== "" ? ` <i>— ${noteDisplay}</i>` : "";
                          return `<div style="margin-bottom: 3px; word-break: break-word;">- ${task.job} ${task.time ? `(${task.time})` : ""}${noteString}</div>`;
                      });
                      tasksHtml = tasksArray.join('');
                  } else {
                      tasksHtml = "<i style='font-size: 0.9em; color:#777;'>Không có công việc chung nào được gán.</i>";
                  }

                  // Nếu không có ca trực, hiển thị trạng thái Nghỉ
                  const shiftContent = matchedShifts.length > 0 ? matchedShifts.join("<br>") : "<i style='color:#7f8c8d; font-weight:normal;'>Không có ca trực (Nghỉ)</i>";

                  foundDayHtml = `<div style="width: 100%; max-width: 100%; box-sizing: border-box; overflow: visible;">
                    <table style="width: 100%; max-width: 100%; min-width: 0; text-align:left; table-layout: fixed; font-size: 14px; box-sizing: border-box; word-break: break-word;">
                    <thead>
                      <tr style="background:#f0f0f0;">
                        <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; width: 40%;">Ngày & Ca</th>
                        <th style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; width: 60%;">Công việc</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr${isToday ? " style='background:#dff0ff;'" : ""}>
                        <td style="padding: 8px; border: 1px solid #ccc; text-align: center; font-size: 14px; word-break: break-word; line-height: 1.4;"><strong style="font-size: 15px; color:#273668;">${thuDisplay}</strong><br><span style="font-size: 13px;">${dateStr}</span><br><br><span style="font-size: 13px; color: #d35400; font-weight:500;">${shiftContent}</span></td>
                        <td style="padding: 8px; border: 1px solid #ccc; text-align: left; font-size: 14px; word-break: break-word; line-height: 1.5;">${tasksHtml}</td>
                      </tr>
                    </tbody>
                    </table></div>`;
                  break; 
              }
          }

          if (foundDayHtml !== "") {
              html = foundDayHtml;
          } else {
              html = `<p style="text-align:center; color:#e74c3c; font-size: 15px; padding: 20px;">Bạn không có lịch làm việc nào trong 14 ngày tới.</p>`;
          }
      
      personalScheduleDetails.innerHTML = html;
  }
  }

  // --- LOGIC LỊCH THÁNG ---
  let currentMonthView = new Date();

  function openMonthScheduleModal() {
      currentMonthView = new Date(currentlyViewedDate); // Lấy tháng đang hiển thị trên lưới tuần
      renderMonthCalendar(currentMonthView.getFullYear(), currentMonthView.getMonth());
      document.getElementById("monthScheduleModal").style.display = "block";
      toggleBodyScroll(true);
  }

  function closeMonthScheduleModal() {
      document.getElementById("monthScheduleModal").style.display = "none";
      toggleBodyScroll(false);
  }

  document.getElementById("monthViewBtn").addEventListener("click", openMonthScheduleModal);
  document.getElementById("closeMonthScheduleModal").addEventListener("click", closeMonthScheduleModal);

  document.getElementById("prevMonthBtn").addEventListener("click", () => {
      currentMonthView.setMonth(currentMonthView.getMonth() - 1);
      renderMonthCalendar(currentMonthView.getFullYear(), currentMonthView.getMonth());
  });

  document.getElementById("nextMonthBtn").addEventListener("click", () => {
      currentMonthView.setMonth(currentMonthView.getMonth() + 1);
      renderMonthCalendar(currentMonthView.getFullYear(), currentMonthView.getMonth());
  });

  function renderMonthCalendar(year, month) {
      const title = document.getElementById("monthScheduleTitle");
      title.textContent = `Lịch Tháng ${month + 1} / ${year}`;
      
      const container = document.getElementById("monthCalendarContainer");
      
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      let startDayOfWeek = firstDay.getDay() - 1;
      if (startDayOfWeek === -1) startDayOfWeek = 6;
      
      const daysInMonth = lastDay.getDate();
      
      let html = `<div class="calendar-grid">`;
      const dayNames = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
      
      dayNames.forEach(d => {
          html += `<div class="calendar-header">${d}</div>`;
      });
      
      for (let i = 0; i < startDayOfWeek; i++) {
          html += `<div class="calendar-day empty"></div>`;
      }
      
      const today = new Date();
      
      for (let day = 1; day <= daysInMonth; day++) {
          const d = new Date(year, month, day);
          const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
          
          const workers = getWorkersForDateMonth(d, allPatternsData, allSwapsData);
          
          // Lấy chữ cuối cùng của tên (vd: Nguyễn Văn A -> A)
          const shortNames = workers.map(name => {
              const parts = name.trim().split(/\s+/);
              return `<div>${parts[parts.length - 1]}</div>`; 
          }).join(""); 
          
          html += `
              <div class="calendar-day ${isToday ? 'today' : ''}">
                  <div class="calendar-date">${day}</div>
                  <div class="calendar-workers">${shortNames}</div>
              </div>
          `;
      }
      
      let totalCells = startDayOfWeek + daysInMonth;
      let remainingCells = (7 - (totalCells % 7)) % 7;
      for (let i = 0; i < remainingCells; i++) {
           html += `<div class="calendar-day empty"></div>`;
      }
      
      html += `</div>`;
      container.innerHTML = html;
  }