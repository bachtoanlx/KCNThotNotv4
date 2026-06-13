// === 1. IMPORT ===
    import { auth, onAuth, deleteReport, getRole, showLoading, hideLoading, showSwal, showConfirmSwal, 
             getReportsByDate, db } from "./script.js";
    import { collection, query, where, orderBy, getDocs, limit, doc, getDoc, onSnapshot, startAfter } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
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
    const footer = document.getElementById("footer-placeholder");
    const tbody     = document.querySelector("#dataTable tbody");
    const searchInput = document.getElementById("searchInput");
    const fromInput = document.getElementById("fromDate");
    const toInput = document.getElementById("toDate");
    const yearSelect = document.getElementById("yearSelect");
    const applyFilterBtn = document.getElementById("applyFilter");
    const specialWorkdayFilterInput = document.getElementById("specialWorkdayFilter"); 
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    
    let currentFilter = { from: null, to: null };
    let initialLoad = true;
    let allSearchData = [];
    let userRole = null;
    let highlightTimeout = null; // Biến debounce cho highlight
    
    let lastDoc1 = null; // Lưu vị trí bản ghi cuối cùng của truy vấn 1
    let lastDoc2 = null; // Lưu vị trí bản ghi cuối cùng của truy vấn 2
    let hasMore1 = true;
    let hasMore2 = true;
    const LIMIT_PER_PAGE = 15; // Số lượng tải mỗi lần cuộn
    let isFetching = false; // Khóa để tránh tải trùng lặp
    let autoLoadCount = 0; // Bộ đếm số lần tự động cuộn
    const MAX_AUTO_LOADS = 5; // Cuộn tự động tối đa 5 lần (75 dòng) trước khi yêu cầu click thủ công

    // === 4. CÁC HÀM TIỆN ÍCH ===
    function formatISODate(d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    function getRecordDate(record) {
        return record.ngay_nghi || record.ngay_lam_db;
    }
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return "";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '/');
    };
    
    // === 5. CÁC HÀM RENDER VÀ SỰ KIỆN ===
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
                      await deleteReport("reports_2", id); 
                      showSwal("success", "Đã xóa báo cáo!");
                      await fetchAndRenderData(false); // Tải lại data sau khi xóa
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

    const filterAndRenderData = (data, query) => {
        const isSpecialWorkdayFilterActive = specialWorkdayFilterInput ? specialWorkdayFilterInput.checked : false;
        let fromDate = null;
        let toDate = null;
        const now = new Date();
        const currentYearStart = formatISODate(new Date(now.getFullYear(), 0, 1)); 
        if (currentFilter.from) fromDate = new Date(currentFilter.from); 
        else fromDate = new Date(currentYearStart); 
        if (currentFilter.to) toDate = new Date(currentFilter.to);
        else toDate = now; 
        toDate.setHours(23,59,59,999);
        
        // Lọc theo checkbox
        let filteredByDate = data.filter(r => {
            const dateString = getRecordDate(r); 
            if (!dateString) return false; 
            const d = new Date(dateString);
            if (isNaN(d)) return false; 
            
            if (isSpecialWorkdayFilterActive && !r.isSpecialWorkday) {
                return false;
            }
            // (Lọc theo ngày đã được Firebase xử lý, không cần lọc lại)
            return true;
        });
        
        // Lọc theo tìm kiếm
        const lowerCaseQuery = query.toLowerCase().trim();
        const isAdmin = userRole === "admin";
        const filteredData = filteredByDate.filter(item => { 
            const searchString = [
                item.createdBy, item.company, item.ghi_chu, getRecordDate(item)
            ].map(field => field ? field.toString().toLowerCase() : "").join(" ");
            return searchString.includes(lowerCaseQuery);
        });
        
        // Sắp xếp
        filteredData.sort((a, b) => {
            const dateA = new Date(getRecordDate(a) || 0);
            const dateB = new Date(getRecordDate(b) || 0);
            return dateB - dateA; // Mới nhất lên đầu
        });
        
        // ⭐️ BỎ LOGIC slice VÌ ĐÃ LIMIT Ở FIREBASE
        let finalData = filteredData;

        // Render
        tbody.innerHTML = ""; // ⭐️ Xóa nội dung cũ trước khi render

        // Xóa timeout cũ nếu có (debounce)
        if (highlightTimeout) {
            clearTimeout(highlightTimeout);
            highlightTimeout = null;
        }
        // Xóa class highlight cũ nếu đang chạy dở
        document.querySelectorAll('.highlight-area').forEach(el => el.classList.remove('highlight-area'));
        
        if (finalData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="8" style="text-align: center; color: #cc0000; font-style: italic; padding: 20px;">
                Dữ liệu đang tìm không có hoặc nằm ngoài vùng hiển thị, hãy điều chỉnh để có kết quả tìm chính xác hơn.
            </td>`;
            tbody.appendChild(tr);
            
            // Hiệu ứng nhắc nhở người dùng
            highlightTimeout = setTimeout(() => {
                const filterBox = document.querySelector('.filter-box');
                if (filterBox) {
                    filterBox.classList.add('highlight-area');
                    setTimeout(() => {
                        filterBox.classList.remove('highlight-area');
                        if (loadMoreBtn) {
                            loadMoreBtn.classList.add('highlight-area');
                            setTimeout(() => loadMoreBtn.classList.remove('highlight-area'), 2000);
                        }
                    }, 2000);
                }
            }, 1500); // Đợi 1.5s sau khi dừng gõ mới nháy
            return;
        }

        let sttCounter = 1; 
        const fragment = document.createDocumentFragment();
        finalData.forEach(r => {
            const fileLink = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank">Link</a>` : "";
            const formattedTime = formatTimestamp(r.updatedAt || r.createdAt);
            let combinedGhiChu = r.ghi_chu || "";
            let displayGhiChu = combinedGhiChu;
            
            if (r.ngay_lam_db) {
                combinedGhiChu += `<br><b>(Ngày làm ĐB: ${r.ngay_lam_db})</b>`; 
                displayGhiChu += ` (Ngày làm ĐB: ${r.ngay_lam_db})`;
            }
            
            // Xử lý loại bỏ thẻ <br> để hiển thị 1 dòng trên bảng
            displayGhiChu = displayGhiChu.replace(/<br\s*\/?>/gi, " | ");

            const displayDate = r.ngay_nghi || ""; 

            const tr = document.createElement('tr');
            tr.innerHTML = `
                    <td>${sttCounter++}</td> 
                    <td class="admin-only">${r.createdBy || ""}</td>
                    <td>${r.company || ""}</td>
                    <td>${displayDate}</td> 
                    <td><div class="clickable-cell" title="Nhấn xem chi tiết">${displayGhiChu}</div></td> 
                    <td>${fileLink}</td>
                    <td class="admin-only">${formattedTime}</td>
                    <td class="admin-only"><button type="button" data-id="${r.id}" class="delBtn">Xóa</button></td>`;
            
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

    // === 6. HÀM TẢI DỮ LIỆU MỚI ===
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

        // 1. Lấy ngày
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
            startDate = currentFilter.from || currentYearStart;
            endDate = currentFilter.to || todayISO;
            // Cập nhật lại filter toàn cục
            currentFilter.from = startDate;
            currentFilter.to = endDate;
        }
        
        if (!isLoadMore) {
            lastDoc1 = null; 
            lastDoc2 = null; 
            hasMore1 = true;
            hasMore2 = true;
            autoLoadCount = 0; 
        }

        if (loadMoreBtn && isLoadMore) {
            loadMoreBtn.textContent = "⏳ Đang tải...";
        }

        if (!isLoadMore) showLoading("Đang tải dữ liệu...");
        
        try {
            let promises = [];
            let snap1 = null, snap2 = null;

            if (hasMore1) {
                let q1 = query(collection(db, "reports_2"), where("ngay_nghi", ">=", startDate), where("ngay_nghi", "<=", endDate), orderBy("ngay_nghi", "desc"), limit(LIMIT_PER_PAGE));
                if (isLoadMore && lastDoc1) q1 = query(q1, startAfter(lastDoc1));
                promises.push(getDocs(q1).then(s => { snap1 = s; }));
            }

            if (hasMore2) {
                let q2 = query(collection(db, "reports_2"), where("ngay_lam_db", ">=", startDate), where("ngay_lam_db", "<=", endDate), orderBy("ngay_lam_db", "desc"), limit(LIMIT_PER_PAGE));
                if (isLoadMore && lastDoc2) q2 = query(q2, startAfter(lastDoc2));
                promises.push(getDocs(q2).then(s => { snap2 = s; }));
            }
            
            await Promise.all(promises);

            let newReports = [];

            if (snap1) {
                if (snap1.empty) {
                    hasMore1 = false;
                } else {
                    lastDoc1 = snap1.docs[snap1.docs.length - 1];
                    newReports.push(...snap1.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                    if (snap1.docs.length < LIMIT_PER_PAGE) hasMore1 = false;
                }
            }

            if (snap2) {
                if (snap2.empty) {
                    hasMore2 = false;
                } else {
                    lastDoc2 = snap2.docs[snap2.docs.length - 1];
                    newReports.push(...snap2.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                    if (snap2.docs.length < LIMIT_PER_PAGE) hasMore2 = false;
                }
            }

            if (isLoadMore) {
                const combinedMap = new Map();
                allSearchData.forEach(item => combinedMap.set(item.id, item));
                newReports.forEach(item => combinedMap.set(item.id, item));
                allSearchData = Array.from(combinedMap.values());
            } else {
                const combinedMap = new Map();
                newReports.forEach(item => combinedMap.set(item.id, item));
                allSearchData = Array.from(combinedMap.values());
            }

            if (loadMoreBtn) {
                loadMoreBtn.style.background = "var(--primary-color)"; // Reset màu gốc
                if (!hasMore1 && !hasMore2) {
                    loadMoreBtn.style.display = 'none';
                } else {
                    loadMoreBtn.style.display = 'inline-block';
                    loadMoreBtn.textContent = "⬇️ Cuộn để tải thêm...";
                }
            }
            
            filterAndRenderData(allSearchData, searchInput.value);
        } catch (err) {
             console.error("Lỗi khi tải reports_2:", err);
             showSwal("error", "Lỗi tải dữ liệu", err.message);
             if (!isLoadMore) allSearchData = [];
        } finally {
             if (!isLoadMore) hideLoading();
             isFetching = false; 
        }
    }
    
    // === 7. BỘ XỬ LÝ SỰ KIỆN LỌC ===
    function resetYearSelectIfEditingDates() {
      if (yearSelect && yearSelect.value !== "") yearSelect.value = "";
    }
    [fromInput, toInput].forEach(el => {
      if (!el) return;
      el.addEventListener("focus", resetYearSelectIfEditingDates);
      el.addEventListener("input", resetYearSelectIfEditingDates);
      el.addEventListener("change", resetYearSelectIfEditingDates);
    });

    if(applyFilterBtn) {
        applyFilterBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            await fetchAndRenderData(false);
            hideLoading();
        });
    }

    if(yearSelect) {
        yearSelect.addEventListener("change", async (e) => {
            await fetchAndRenderData(false);
            hideLoading(); 
        });
    }

    if (specialWorkdayFilterInput) {
        specialWorkdayFilterInput.addEventListener("change", () => {
            // Chỉ render lại, không tải lại
            filterAndRenderData(allSearchData, searchInput.value);
        });
    }

    // === 8. HÀM ON AUTH (ĐÃ SỬA LỖI FOOTER VÀ TẢI NĂM) ===
    onAuth(async (user) => {
        if (user) {
            notLogged.style.display = "none";
            
            showLoading("Đang tải cấu hình..."); 
            
            try {
                // 1. Cài đặt UI Admin
                userRole = await getRole(user.email);
                const isAdmin = userRole === "admin";
                document.querySelectorAll("#dataTable th.admin-only").forEach(th => {
                    th.style.display = isAdmin ? "table-cell" : "none";
                });

                // --- 2. TẢI DANH SÁCH NĂM TỰ ĐỘNG (CÁCH ĐƠN GIẢN HƠN) ---
                let years = [];
                // ⭐️ TỐI ƯU HÓA: Tạo danh sách năm tự động từ 2024 đến năm hiện tại (0 Lượt đọc)
                const currentYear = new Date().getFullYear();
                for (let y = currentYear; y >= 2024; y--) {
                    years.push(y.toString());
                }
                
                const ys = document.getElementById("yearSelect");
                if(ys) {
                    ys.innerHTML = `<option value="">--Chọn năm--</option>`;
                    years.forEach(y => {
                        ys.innerHTML += `<option value="${y}">${y}</option>`;
                    });
                }
                // --- KẾT THÚC TẢI NĂM ---

                // 3. Thiết lập bộ lọc mặc định
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
                // (Hàm này sẽ bật loading, nhưng không tắt nó)
                await fetchAndRenderData(); 
                
                // 5. HIỂN THỊ NỘI DUNG VÀ FOOTER
                content.style.display = "flex"; 
                if (footer) footer.style.display = "block";

            } catch (err) {
                 showSwal("error", "Lỗi tải dữ liệu", err.message);
                 console.error("Lỗi onAuth:", err); 
                 if (footer) footer.style.display = "block";
            } finally {
                // 6. Luôn tắt loading TỔNG ở cuối cùng
                hideLoading(); 
            }
            
            // 7. Gắn listener
            searchInput.addEventListener("input", () => {
                filterAndRenderData(allSearchData, searchInput.value);
            });
            
            // MỚI: Xử lý click nút tải thêm (phòng khi Intersection Observer không nhạy)
            if (loadMoreBtn) {
                loadMoreBtn.addEventListener('click', () => {
                    autoLoadCount = 0; // Reset lại bộ đếm, cấp "quota" cho 5 lần cuộn tự động tiếp theo
                    loadMoreBtn.style.background = "var(--primary-color)";
                    fetchAndRenderData(true);
                });
            }

            // MỚI: Intersection Observer cho Infinite Scroll (Cuộn tới đâu tải tới đó)
            if (loadMoreBtn) {
                const handleIntersection = (entries) => {
                    // Nếu nút xuất hiện trên màn hình và không phải đang tải dở
                    if (entries[0].isIntersecting && !isFetching && loadMoreBtn.style.display !== 'none') {
                        if (autoLoadCount < MAX_AUTO_LOADS) {
                            autoLoadCount++;
                            fetchAndRenderData(true); // Gửi cờ 'true' để nối thêm data
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
            notLogged.style.display = "flex"; /* Đổi từ block sang flex để căn giữa dọc/ngang */
            content.style.display = "none";
            if (footer) footer.style.display = "block"; /* Cho phép Footer hiện ra ở màn báo lỗi */
            hideLoading(); 
        }
    });