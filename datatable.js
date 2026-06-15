// === 1. IMPORT (ĐÃ SỬA LỖI) ===
    
    // Import các hàm TÙY CHỈNH (custom helpers) từ file script.js
    import { auth, onAuth, deleteReport, getRole, showLoading, hideLoading, showSwal, showConfirmSwal, 
             getReportsByDate, db } from "./script.js";
             
    // Import các hàm GỐC (native) của Firebase SDK
    import { collection, query, where, orderBy, getDocs, limit, onSnapshot, startAfter } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
    // Import IndexedDB
    import { saveToLocalDB, getAllFromLocalDB, setLastSyncTime, getLastSyncTime, deleteFromLocalDB } from "./localDB.js";
    
    // Import menu
    import { initMenu } from "./menu.js";

    // === 2. TẢI GIAO DIỆN CHUNG ===
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

    // === 3. THAM CHIẾU DOM VÀ BIẾN TOÀN CỤC ===
    const notLogged = document.getElementById("notLogged");
    const content   = document.getElementById("pageContent");
    const tbody     = document.querySelector("#dataTable tbody");
    const searchInput = document.getElementById("searchInput");
    const fromInput = document.getElementById("fromDate");
    const toInput = document.getElementById("toDate");
    const yearSelect = document.getElementById("yearSelect");
    const applyFilterBtn = document.getElementById("applyFilter");
    const meterResetFilterInput = document.getElementById("meterResetFilter"); 
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    
    let currentFilter = { from: null, to: null };
    let initialLoad = true;
    let allSearchData = []; // Mảng này giờ sẽ lưu kết quả đã lọc
    let userRole = null;
    
    let lastDoc = null; // Lưu vị trí bản ghi cuối cùng để phân trang
    const LIMIT_PER_PAGE = 15; // Số lượng tải mỗi lần cuộn
    let isFetching = false; // Khóa để tránh tải trùng lặp
    let autoLoadCount = 0; // Bộ đếm số lần tự động cuộn
    const MAX_AUTO_LOADS = 5; // Cuộn tự động tối đa 5 lần (75 dòng) trước khi yêu cầu click thủ công

    // === STATE VÀ HÀM CHO DEEP SEARCH ===
    let isDeepSearchMode = false;
    let deepSearchQuery = "";
    let deepSearchResults = [];
    let searchDebounceTimer = null; // Biến hẹn giờ cho chức năng tìm kiếm tự động
    let savedStartDate = ""; // Lưu lại ngày bắt đầu trước khi tìm kiếm
    let savedEndDate = ""; // Lưu lại ngày kết thúc trước khi tìm kiếm

    // Hàm làm mờ/khóa UI bộ lọc
    function toggleFiltersUI(disable) {
        const filterElements = [fromInput, toInput, yearSelect, applyFilterBtn];
        filterElements.forEach(el => {
            if (el) {
                el.disabled = disable;
                // Làm mờ cả thẻ label chứa nó nếu có
                if (el.parentElement && el.parentElement.tagName === "LABEL") {
                    el.parentElement.style.opacity = disable ? "0.4" : "1";
                } else {
                    el.style.opacity = disable ? "0.4" : "1";
                }
                el.style.cursor = disable ? "not-allowed" : "";
            }
        });
    }

    // Trình thông dịch ngày tháng
    function buildReportSearchString(item) {
        const fields = [
            item.createdBy, item.company, item.ghi_chu, item.ngay_ghi, item.chi_so ? item.chi_so.toString() : ""
        ];
        return fields.map(field => {
            if (!field) return "";
            const str = field.toString();
            const dateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (dateMatch) {
                const y = dateMatch[1], m = dateMatch[2], d = dateMatch[3];
                const ms = parseInt(m, 10).toString(), ds = parseInt(d, 10).toString();
                return `${str} ${d}/${m}/${y} ${d}/${m} ${d}-${m}-${y} ${d}-${m} ${ds}/${ms}/${y} ${ds}/${ms} ${ds}-${ms}-${y} ${ds}-${ms} ${ds}/${m} ${d}/${ms} ${ds}-${m} ${d}-${ms} ${y}/${m}/${d} ${y}/${ms}/${ds} ${y}-${ms}-${ds}`.toLowerCase();
            }
            return str.toLowerCase();
        }).join(" ");
    }

    async function performDeepSearch(queryText) {
        if (isFetching) return;
        isFetching = true;
        
        isDeepSearchMode = true;
        deepSearchQuery = queryText;
        
        try {
            // 1. Đồng bộ Tombstone (Dữ liệu bị xóa)
            const lastSync = await getLastSyncTime("reports_1");
            if (lastSync > 0) {
                const qDel = query(collection(db, "sync_deletes"), 
                    where("deletedAt", ">", new Date(lastSync))
                );
                const snapDel = await getDocs(qDel);
                if (!snapDel.empty) {
                    const idsToDelete = snapDel.docs
                        .map(d => d.data())
                        .filter(data => data.collectionName === "reports_1")
                        .map(data => data.docId);
                    if (idsToDelete.length > 0) {
                        await deleteFromLocalDB("reports_1", idsToDelete);
                    }
                }
            }

            // 2. Đồng bộ Upserts (Dữ liệu Mới/Sửa)
            let newRecords = [];
            if (lastSync === 0) {
                // Lần đầu tải toàn bộ
                const qAll = query(collection(db, "reports_1"));
                const snapAll = await getDocs(qAll);
                newRecords = snapAll.docs.map(doc => ({id: doc.id, ...doc.data()}));
            } else {
                // Tải dữ liệu thay đổi. Dùng song song 2 truy vấn để bắt cả mới và sửa
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
            }
            await setLastSyncTime("reports_1", Date.now());

            // 3. Nạp dữ liệu lên RAM và tìm kiếm
            const allLocalData = await getAllFromLocalDB("reports_1");
            // Sắp xếp ngày ghi mới nhất lên đầu
            allLocalData.sort((a, b) => new Date(b.ngay_ghi || 0).getTime() - new Date(a.ngay_ghi || 0).getTime());

            const lowerCaseQuery = queryText.toLowerCase().trim();
            deepSearchResults = allLocalData.filter(item => {
                // Cắt lọc theo từ khóa
                if (lowerCaseQuery !== "" && !buildReportSearchString(item).includes(lowerCaseQuery)) return false;
                
                // Lọc theo checkbox Chỉ số Đặc biệt (nếu có check)
                const isMeterResetFilterActive = meterResetFilterInput ? meterResetFilterInput.checked : false;
                if (isMeterResetFilterActive) {
                    const isReset = item.isMeterReset === true;
                    const isAutoInit = item.ghi_chu === "Chi so khoi tao tu dong (Auto-Init)";
                    if (!isReset && !isAutoInit) return false;
                }
                return true;
            });

            // 4. Cập nhật giao diện tự động (Khóa UI Thời gian)
            if (deepSearchResults.length > 0) {
                const newestDate = deepSearchResults[0].ngay_ghi;
                const oldestDate = deepSearchResults[deepSearchResults.length - 1].ngay_ghi;
                if (fromInput) { fromInput.value = oldestDate; toggleFiltersUI(true); }
                if (toInput) { toInput.value = newestDate; toggleFiltersUI(true); }
            } else {
                toggleFiltersUI(true);
            }

            allSearchData = deepSearchResults;
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            filterAndRenderData(allSearchData, deepSearchQuery);
            
        } catch (err) {
            console.error("Lỗi tìm kiếm sâu:", err);
            showSwal('error', 'Lỗi tìm kiếm', 'Không thể tải dữ liệu: ' + err.message);
            isDeepSearchMode = false;
            toggleFiltersUI(false);
        } finally {
            isFetching = false;
        }
    }

    // === 4. CÁC HÀM TIỆN ÍCH (Giữ nguyên) ===
    function formatISODate(d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    function getRecordDate(record) {
        return record.ngay_ghi;
    }
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return "";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '/');
    };
    
    // === 5. CÁC HÀM RENDER VÀ SỰ KIỆN (Giữ nguyên) ===
    const attachDeleteEventListeners = () => {
      document.querySelectorAll(".delBtn").forEach(btn => {
          btn.addEventListener("click", async () => {
              const id = btn.dataset.id;
              const isConfirmed = await showConfirmSwal(
                  "Xác nhận xóa báo cáo",
                  "Bạn có chắc muốn **Xóa vĩnh viễn** không? Hành động này không thể hoàn tác.",
                  "Có, xóa báo cáo", "Không, hủy bỏ", "error"
              );
              if (isConfirmed) {
                  showLoading("Đang xóa dữ liệu...");
                  try {
                      await deleteReport("reports_1", id);
                      showSwal("success", "Đã xóa báo cáo!");
                      // Tải lại dữ liệu sau khi xóa
                      await fetchAndRenderData(false); 
                  } catch (err) {
                      console.error("Lỗi khi xóa báo cáo:", err);
                      showSwal("error", "Lỗi khi xóa", "Không thể xóa báo cáo. Vui lòng thử lại.");
                  } finally {
                      hideLoading();
                  }
              }
          });
      });
    };

    // Hàm render
    const filterAndRenderData = (data, queryText) => {
        const isMeterResetFilterActive = meterResetFilterInput ? meterResetFilterInput.checked : false;
        let fromDate = null;
        let toDate = null;
        const now = new Date();
        const currentYearStart = formatISODate(new Date(now.getFullYear(), 0, 1)); 
        if (currentFilter.from) fromDate = new Date(currentFilter.from); 
        else fromDate = new Date(currentYearStart); 
        if (currentFilter.to) toDate = new Date(currentFilter.to);
        else toDate = now; 
        toDate.setHours(23,59,59,999);
        
        // Lưu ý: filterByDate chỉ chạy trên mảng data đã được lọc bởi Firebase
        let filteredByDate = data.filter(r => {
            const dateString = getRecordDate(r);
            if (!dateString) return false; 
            const d = new Date(dateString);
            if (isNaN(d)) return false; 
            // LỌC BỔ SUNG: Kiểm tra trạng thái Chỉ số đặc biệt (ĐÃ MỞ RỘNG)
            if (isMeterResetFilterActive) {
                // Kiểm tra xem bản ghi này có "đặc biệt" hay không
                const isReset = r.isMeterReset === true;
                const isAutoInit = r.ghi_chu === "Chi so khoi tao tu dong (Auto-Init)";

                // Nếu nó KHÔNG phải là 'Reset' VÀ KHÔNG phải là 'Auto-Init', thì ẩn nó đi
                if (!isReset && !isAutoInit) {
                    return false; 
                }
                // Nếu nó là 1 trong 2 (hoặc cả 2), nó sẽ vượt qua bộ lọc và được hiển thị
            }
            // Việc lọc ngày đã được Firebase làm, nhưng kiểm tra này vẫn tốt
            return d >= fromDate && d <= toDate; 
        });
        
        const lowerCaseQuery = queryText.toLowerCase().trim();
        const isAdmin = userRole === "admin";

        const filteredData = filteredByDate.filter(item => { 
            return buildReportSearchString(item).includes(lowerCaseQuery);
        });
        
        // Sắp xếp đã được Firebase orderBy lo, nhưng sort lại an toàn
        filteredData.sort((a, b) => {
            const dateA = new Date(getRecordDate(a) || 0);
            const dateB = new Date(getRecordDate(b) || 0);
            return dateB - dateA; // Mới nhất lên đầu
        });
        
        let finalData = filteredData;
        // ⭐️ BỎ LOGIC slice VÌ ĐÃ LIMIT Ở FIREBASE
        // Hiển thị tất cả data đã được Firebase limit

        tbody.innerHTML = ""; // ⭐️ Xóa nội dung cũ trước khi render

        if (finalData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="9" style="text-align: center; color: #888; font-style: italic; padding: 20px;">
                Không tìm thấy dữ liệu nào khớp với từ khóa của bạn.
            </td>`;
            tbody.appendChild(tr);
            
            return;
        }

        let sttCounter = 1; 
        const fragment = document.createDocumentFragment();
        finalData.forEach(r => {
            const fileLink = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank">Link</a>` : "";
            const formattedTime = formatTimestamp(r.updatedAt || r.createdAt);
            let combinedGhiChu = r.ghi_chu || "";
            let displayGhiChu = combinedGhiChu; // Nội dung hiển thị trên bảng (1 dòng)
            
            if (r.isMeterReset) {
                // Cho popup (giữ xuống dòng)
                combinedGhiChu += `<br><b>(Chỉ số ĐB: ${r.ngay_ghi})</b>`; 
                // Cho bảng (thay xuống dòng bằng khoảng trắng)
                displayGhiChu += ` (Chỉ số ĐB: ${r.ngay_ghi})`;
            }
            
            // Xử lý loại bỏ thẻ <br> để hiển thị 1 dòng trên bảng
            displayGhiChu = displayGhiChu.replace(/<br\s*\/?>/gi, " | ");
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                    <td>${sttCounter++}</td> 
                    <td class="admin-only">${r.createdBy || ""}</td> 
                    <td>${r.company || ""}</td>                     
                    <td>${r.chi_so != null ? r.chi_so.toLocaleString('vi-VN') : 0}</td>                      
                    <td>${r.ngay_ghi || ""}</td>                   
                    <td><div class="clickable-cell" title="Nhấn xem chi tiết">${displayGhiChu}</div></td>                      
                    <td>${fileLink}</td>                           
                    <td class="admin-only">${formattedTime}</td>     
                    <td class="admin-only"><button type="button" data-id="${r.id}" class="delBtn">Xóa</button></td>`;
            
            // Gắn sự kiện click cho ô Ghi chú
            const noteCell = tr.querySelector('.clickable-cell');
            if (noteCell) {
                noteCell._fullContent = combinedGhiChu || "Không có ghi chú";
                noteCell._previewContent = displayGhiChu;

                noteCell.addEventListener('click', function(e) {
                    const currentDiv = e.currentTarget;
                    const isExpanded = currentDiv.classList.contains('expanded');

                    // 1. Thu gọn tất cả các dòng khác đang mở
                    document.querySelectorAll('.clickable-cell.expanded').forEach(div => {
                        if (div !== currentDiv) {
                            div.classList.remove('expanded');
                            div.innerHTML = div._previewContent;
                            div.title = "Nhấn xem chi tiết";
                        }
                    });

                    // 2. Toggle dòng hiện tại
                    if (isExpanded) {
                        currentDiv.classList.remove('expanded');
                        currentDiv.innerHTML = currentDiv._previewContent;
                        currentDiv.title = "Nhấn xem chi tiết";
                    } else {
                        currentDiv.classList.add('expanded');
                        currentDiv.innerHTML = currentDiv._fullContent;
                        currentDiv.title = "Nhấn để thu gọn";
                    }
                });
            }
            
            fragment.appendChild(tr);
        });
        
        tbody.appendChild(fragment);
        attachDeleteEventListeners();
        document.querySelectorAll("#dataTable th.admin-only, #dataTable td.admin-only").forEach(el => {
            el.style.display = isAdmin ? "table-cell" : "none";
        });
    };

    // === 6. HÀM TẢI DỮ LIỆU MỚI (Từ lần trước) ===
    async function fetchAndRenderData(isLoadMore = false) {
        if (isFetching) return;
        isFetching = true;
        
        // Tự động điền ngày mặc định nếu trống và không chọn năm
        if (!yearSelect.value) {
            if (!fromInput.value) {
                const currentYear = new Date().getFullYear();
                fromInput.value = `${currentYear}-01-01`;
            }
            if (!toInput.value) {
                const now = new Date();
                toInput.value = formatISODate(now);
            }
        }

        // 2. Lấy ngày từ bộ lọc
        const fromVal = fromInput.value;
        const toVal = toInput.value;
        const yearVal = yearSelect.value;
        
        let startDate, endDate;
        const todayISO = formatISODate(new Date());
        const currentYearStart = new Date().getFullYear() + '-01-01';

        if (yearVal) {
            startDate = `${yearVal}-01-01`;
            const currentYear = new Date().getFullYear();
            if (parseInt(yearVal) === currentYear) {
                endDate = todayISO;
            } else {
                endDate = `${yearVal}-12-31`;
            }
            // Cập nhật biến global filter
            currentFilter.from = startDate;
            currentFilter.to = endDate;
            // Cập nhật UI
            fromInput.value = startDate;
            toInput.value = endDate;
        } else if (fromVal && toVal) {
            startDate = fromVal;
            endDate = toVal;
            currentFilter.from = startDate;
            currentFilter.to = endDate;
        } else if (toVal) {
            startDate = currentYearStart;
            endDate = toVal;
            currentFilter.from = startDate;
            currentFilter.to = endDate;
        } else if (fromVal) {
            startDate = fromVal;
            endDate = todayISO;
            currentFilter.from = startDate;
            currentFilter.to = endDate;
        } else {
            // Nếu không có gì được chọn, dùng mặc định
            startDate = currentFilter.from || currentYearStart;
            endDate = currentFilter.to || todayISO;
        }

        if (!isLoadMore) {
            lastDoc = null; // Reset con trỏ Firebase nếu đây là đợt tải (lọc) mới
            autoLoadCount = 0; // Reset lại bộ đếm cuộn tự động
        }

        if (loadMoreBtn && isLoadMore) {
            loadMoreBtn.textContent = "⏳ Đang tải...";
        }
        
        try {
            let q = query(
                collection(db, "reports_1"),
                where("ngay_ghi", ">=", startDate),
                where("ngay_ghi", "<=", endDate),
                orderBy("ngay_ghi", "desc"),
                limit(LIMIT_PER_PAGE)
            );
            
            if (isLoadMore && lastDoc) {
                q = query(q, startAfter(lastDoc));
            }
            
            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                if (loadMoreBtn) loadMoreBtn.style.display = 'none';
                if (!isLoadMore) {
                    allSearchData = [];
                    filterAndRenderData(allSearchData, searchInput.value);
                }
                return;
            }

            // Lưu document cuối cùng làm mốc (cursor) cho lần tải sau
            lastDoc = snapshot.docs[snapshot.docs.length - 1];
            const newReports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            if (isLoadMore) {
                allSearchData = [...allSearchData, ...newReports]; // Nối mảng
            } else {
                allSearchData = newReports; // Tải mới
            }
            
            if (loadMoreBtn) {
                loadMoreBtn.style.background = "var(--primary-color)"; // Reset màu gốc
                if (snapshot.docs.length < LIMIT_PER_PAGE) {
                    loadMoreBtn.style.display = 'none'; // Hết dữ liệu thì ẩn nút
                } else {
                    loadMoreBtn.style.display = 'inline-block';
                    loadMoreBtn.textContent = "⬇️ Cuộn để tải thêm...";
                }
            }
            
            filterAndRenderData(allSearchData, searchInput.value);
        } catch (err) {
            console.error("Lỗi khi tải báo cáo:", err);
            showSwal("error", "Lỗi tải dữ liệu", err.message);
        } finally {
            isFetching = false; // Mở khóa
        }
    }
    
    // === 7. BỘ XỬ LÝ SỰ KIỆN LỌC (ĐÃ SỬA) ===
    function resetYearSelectIfEditingDates() {
      if (yearSelect && yearSelect.value !== "") yearSelect.value = "";
    }
    [fromInput, toInput].forEach(el => {
      if (!el) return;
      el.addEventListener("focus", resetYearSelectIfEditingDates);
      el.addEventListener("input", resetYearSelectIfEditingDates);
      el.addEventListener("change", resetYearSelectIfEditingDates);
    });

    const handleFilterChange = (e) => {
        if (e) e.preventDefault();
        const q = searchInput.value.trim();
        const isSpecialChecked = meterResetFilterInput ? meterResetFilterInput.checked : false;
        
        if (q !== "" || isSpecialChecked) {
            // Có từ khóa HOẶC chọn lọc đặc biệt -> Quét RAM luôn toàn bộ lịch sử
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #3498db; font-style: italic; padding: 20px;">⏳ Đang lọc dữ liệu...</td></tr>`;
            performDeepSearch(q);
        } else {
            // Không có từ khóa -> Lấy dữ liệu mặc định theo Filter
            isDeepSearchMode = false;
            toggleFiltersUI(false);
            fetchAndRenderData(false);
        }
    };

    if(applyFilterBtn) {
        applyFilterBtn.addEventListener("click", () => {
            searchInput.value = ""; // Xóa từ khóa khi bấm Lọc thủ công
            handleFilterChange();
        });
    }

    if(yearSelect) yearSelect.addEventListener("change", () => {
        searchInput.value = ""; // Xóa từ khóa khi đổi năm
        handleFilterChange();
    });

    if (meterResetFilterInput) {
        meterResetFilterInput.addEventListener("change", () => {
            handleFilterChange();
        });
    }

    // === 8. HÀM ON AUTH (ĐÃ SỬA LỖI TRUY VẤN - PHIÊN BẢN CUỐI) ===
    onAuth(async (user) => {
        if (user) {
            notLogged.style.display = "none";
            // (content.style.display = "none" - Mặc định ẩn)
            
            try {
                // 1. Cài đặt UI Admin
                userRole = await getRole(user.email);
                const isAdmin = userRole === "admin";
                
                document.querySelectorAll("#dataTable th.admin-only").forEach(th => {
                    th.style.display = isAdmin ? "table-cell" : "none";
                });

                // --- 2. TẢI DANH SÁCH NĂM (ĐÃ TỐI ƯU - TỐN 2 LƯỢT ĐỌC) ---
                showLoading("Đang tải danh sách năm..."); 

                // ⭐️ SỬA LỖI: Quay lại dùng 2 truy vấn limit(1) ⭐️
                const newestReportQuery = query(
                    collection(db, "reports_1"),
                    orderBy("ngay_ghi", "desc"), 
                    limit(1) // Chỉ lấy 1 bản ghi mới nhất
                );
                const oldestReportQuery = query(
                    collection(db, "reports_1"),
                    orderBy("ngay_ghi", "asc"),  
                    limit(1) // Chỉ lấy 1 bản ghi cũ nhất
                );

                const [newestSnapshot, oldestSnapshot] = await Promise.all([
                    getDocs(newestReportQuery),
                    getDocs(oldestReportQuery)
                ]);
                // --- KẾT THÚC SỬA LỖI ---

                let years = []; 

                if (!newestSnapshot.empty && !oldestSnapshot.empty) {
                    const newestDateStr = newestSnapshot.docs[0].data().ngay_ghi;
                    const oldestDateStr = oldestSnapshot.docs[0].data().ngay_ghi;

                    const newestYear = parseInt(newestDateStr.substring(0, 4));
                    const oldestYear = parseInt(oldestDateStr.substring(0, 4));

                    for (let y = newestYear; y >= oldestYear; y--) {
                        years.push(y.toString());
                    }
                } else {
                     console.log("Không có dữ liệu trong 'reports_1' để tạo danh sách năm.");
                }
                
                const ys = document.getElementById("yearSelect");
                if(ys) {
                  ys.innerHTML = `<option value="">--Chọn năm--</option>`;
                  years.forEach(y => ys.innerHTML += `<option value="${y}">${y}</option>`);
                }

                // 3. Thiết lập bộ lọc mặc định (Giữ nguyên)
                if(initialLoad) {
                    const currentYear = new Date().getFullYear().toString();
                    if (years.includes(currentYear) && ys) {
                      const todayISO = formatISODate(new Date());
                      const currentYearStart = currentYear + '-01-01';
                      fromInput.value = currentYearStart;
                      toInput.value = todayISO;
                      currentFilter.from = currentYearStart;
                      currentFilter.to = todayISO; 
                      ys.value = currentYear;
                    } else if (years.length > 0) {
                        fromInput.value = `${years[0]}-01-01`;
                        toInput.value = `${years[0]}-12-31`;
                        currentFilter.from = `${years[0]}-01-01`;
                        currentFilter.to = `${years[0]}-12-31`;
                        ys.value = years[0];
                    }
                    initialLoad = false;
                }

                // 4. Tải dữ liệu chính (Lần đầu)
                await fetchAndRenderData(false); 
                
                // 5. HIỂN THỊ NỘI DUNG (Chống giật)
                content.style.display = "flex"; 
                hideLoading(); // Ẩn loading sau khi đã render

            } catch (err) {
                 showSwal("error", "Lỗi tải dữ liệu", err.message);
                 console.error("Lỗi onAuth:", err); // Thêm log lỗi chi tiết
                 hideLoading(); 
            }
            
            searchInput.addEventListener("input", () => {
                const q = searchInput.value.trim();
                const isSpecialChecked = meterResetFilterInput ? meterResetFilterInput.checked : false;
                if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

                if (q === "" && !isSpecialChecked) {
                    const wasDeepSearch = isDeepSearchMode;
                    isDeepSearchMode = false;
                    toggleFiltersUI(false);
                    
                    if (wasDeepSearch) {
                        if (fromInput) fromInput.value = savedStartDate;
                        if (toInput) toInput.value = savedEndDate;
                        fetchAndRenderData(false); // Reload gốc
                    } else {
                        if (loadMoreBtn && lastDoc) {
                            loadMoreBtn.style.display = 'inline-block';
                            loadMoreBtn.textContent = "⬇️ Cuộn để tải thêm...";
                        }
                        filterAndRenderData(allSearchData, q);
                    }
                } else {
                    if (!isDeepSearchMode) {
                        savedStartDate = fromInput ? fromInput.value : "";
                        savedEndDate = toInput ? toInput.value : "";
                    }
                    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #3498db; font-style: italic; padding: 20px;">⏳ Đang tìm kiếm toàn bộ dữ liệu...</td></tr>`;
                    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
                    
                    searchDebounceTimer = setTimeout(() => performDeepSearch(q), 500);
                }
            });
                
                // MỚI: Xử lý click nút tải thêm (phòng khi Intersection Observer không nhạy)
                if (loadMoreBtn) {
                    loadMoreBtn.addEventListener('click', () => {
                        autoLoadCount = 0; // Reset lại bộ đếm, cấp "quota" cho 5 lần cuộn tự động tiếp theo
                        loadMoreBtn.style.background = "var(--primary-color)";
                        if (!isDeepSearchMode) fetchAndRenderData(true);
                    });
                }
    
                // MỚI: Intersection Observer cho Infinite Scroll (Cuộn tới đâu tải tới đó)
                if (loadMoreBtn) {
                    const handleIntersection = (entries) => {
                        // Nếu nút xuất hiện trên màn hình và không phải đang tải dở
                        if (entries[0].isIntersecting && !isFetching && loadMoreBtn.style.display !== 'none') {
                            if (autoLoadCount < MAX_AUTO_LOADS) {
                                autoLoadCount++;
                                if (!isDeepSearchMode) fetchAndRenderData(true); // Gửi cờ 'true' để nối thêm data
                            } else {
                                loadMoreBtn.textContent = "⚠️ Bạn đã xem khá nhiều. Bấm để tải tiếp...";
                                loadMoreBtn.style.background = "#d35400"; // Đổi sang màu cam cảnh báo
                            }
                        }
                    };
                    
                    // Theo dõi cuộn trong vùng chứa bảng (Desktop)
                    const observer = new IntersectionObserver(handleIntersection, { root: document.querySelector('.table-container'), rootMargin: "100px", threshold: 0.1 });
                    observer.observe(loadMoreBtn);
                    
                    // Theo dõi cuộn toàn trang (Mobile)
                    const windowObserver = new IntersectionObserver(handleIntersection, { root: null, rootMargin: "100px", threshold: 0.1 });
                    windowObserver.observe(loadMoreBtn);
                }

        } else {
            notLogged.style.display = "flex";
            content.style.display = "none";
            hideLoading(); 
        }
    });