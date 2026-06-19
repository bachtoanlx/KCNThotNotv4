// === 1. IMPORT ===
    import { auth, onAuth, deleteReport, getRole, showLoading, hideLoading, showSwal, showConfirmSwal, 
             getReportsByDate, db } from "./script.js";
    import { collection, query, where, orderBy, getDocs, limit, doc, getDoc, onSnapshot, startAfter } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
    // Import IndexedDB
    import { saveToLocalDB, getAllFromLocalDB, setLastSyncTime, getLastSyncTime, deleteFromLocalDB } from "./localDB.js";
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
    
    let lastDoc1 = null; // Lưu vị trí bản ghi cuối cùng của truy vấn 1
    let lastDoc2 = null; // Lưu vị trí bản ghi cuối cùng của truy vấn 2
    let hasMore1 = true;
    let hasMore2 = true;
    const LIMIT_PER_PAGE = 15; // Số lượng tải mỗi lần cuộn
    let isFetching = false; // Khóa để tránh tải trùng lặp
    let autoLoadCount = 0; // Bộ đếm số lần tự động cuộn
    const MAX_AUTO_LOADS = 5; // Cuộn tự động tối đa 5 lần (75 dòng) trước khi yêu cầu click thủ công

    const copyDocIdToClipboard = (collectionName, docId) => {
        const textToCopy = `${collectionName}:${docId}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
            if (window.Swal) {
                window.Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: `Đã sao chép định danh bản ghi (${collectionName}) vào Clipboard!`,
                    showConfirmButton: false,
                    timer: 2500,
                    timerProgressBar: true
                });
            }
        }).catch(err => {
            console.error('Không thể sao chép:', err);
        });
    };

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

    // Hàm chuẩn hóa tiếng Việt không dấu
    function normalizeForSearch(str) {
        if (!str) return "";
        return str.toString().toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/đ/g, "d")
            .replace(/\s*([/-])\s*/g, "$1");
    }

    // Trình thông dịch ngày tháng
    function buildReportSearchString(item) {
        const fields = [
            item.createdBy, item.company, item.ghi_chu, getRecordDate(item)
        ];
        return fields.map(field => {
            if (!field) return "";
            const str = field.toString();
            let variants = "";
            const dateMatches = str.match(/(\d{4})-(\d{2})-(\d{2})/g);
            if (dateMatches) {
                dateMatches.forEach(match => {
                    const parts = match.match(/(\d{4})-(\d{2})-(\d{2})/);
                    if (parts) {
                        const y = parts[1], m = parts[2], d = parts[3];
                        const ms = parseInt(m, 10).toString(), ds = parseInt(d, 10).toString();
                            const y2 = y.slice(-2);
                            variants += ` ${d}/${m}/${y} ${d}/${m} ${d}-${m}-${y} ${d}-${m} ${ds}/${ms}/${y} ${ds}/${ms} ${ds}-${ms}-${y} ${ds}-${ms} ${ds}/${m} ${d}/${ms} ${ds}-${m} ${d}-${ms} ${y}/${m}/${d} ${y}/${ms}/${ds} ${y}-${ms}-${ds} ${m}/${y} ${ms}/${y} ${m}-${y} ${ms}-${y} ${m}/${y2} ${ms}/${y2} ${m}-${y2} ${ms}-${y2}`;
                    }
                });
            }
            return normalizeForSearch(str + variants);
        }).join(" ");
    }

    let unsubscribeRealtime = null;
    let unsubscribeRealtimeDel = null;

    function startRealtimeSyncReports2(startTime) {
        if (unsubscribeRealtime) unsubscribeRealtime();
        if (unsubscribeRealtimeDel) unsubscribeRealtimeDel();

        const qNew = query(collection(db, "reports_2"), where("updatedAt", ">", startTime));
        unsubscribeRealtime = onSnapshot(qNew, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added" || change.type === "modified") {
                    const data = change.doc.data();
                    const parsed = {
                        id: change.doc.id,
                        ...data,
                        _createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
                        _updatedAtMillis: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : null,
                    };
                    await saveToLocalDB("reports_2", [parsed]);
                    
                    const lastSync = await getLastSyncTime("reports_2");
                    const t = data.updatedAt?.toMillis?.() || data.createdAt?.toMillis?.() || 0;
                    if (t > lastSync) {
                        await setLastSyncTime("reports_2", t);
                    }
                    
                    if (!isDeepSearchMode) {
                        if (searchInput && searchInput.value.trim() === "") {
                            await fetchAndRenderData(false);
                        }
                    } else {
                        if (deepSearchQuery && deepSearchQuery.trim() !== "") {
                            await performDeepSearch(deepSearchQuery);
                        }
                    }
                }
            });
        }, (error) => {
            console.warn("[Realtime Sync Reports 2] Lỗi lắng nghe:", error);
        });

        const qDel = query(collection(db, "sync_deletes"), where("deletedAt", ">", startTime));
        unsubscribeRealtimeDel = onSnapshot(qDel, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added" || change.type === "modified") {
                    const data = change.doc.data();
                    if (data.collectionName === "reports_2") {
                        await deleteFromLocalDB("reports_2", [data.docId]);
                        
                        const t = data.deletedAt?.toMillis?.() || 0;
                        const lastSync = await getLastSyncTime("reports_2");
                        if (t > lastSync) {
                            await setLastSyncTime("reports_2", t);
                        }
                        
                        if (!isDeepSearchMode) {
                            if (searchInput && searchInput.value.trim() === "") {
                                await fetchAndRenderData(false);
                            }
                        } else {
                            if (deepSearchQuery && deepSearchQuery.trim() !== "") {
                                await performDeepSearch(deepSearchQuery);
                            }
                        }
                    }
                }
            });
        }, (error) => {
            console.warn("[Realtime Sync Reports 2 Del] Lỗi lắng nghe xóa:", error);
        });
    }

    async function syncDeltaReports2() {
        try {
            const lastSync = await getLastSyncTime("reports_2");
            let maxTime = lastSync;

            // 1. Đồng bộ Tombstone (Dữ liệu bị xóa)
            if (lastSync > 0) {
                const qDel = query(collection(db, "sync_deletes"), 
                    where("deletedAt", ">", new Date(lastSync))
                );
                const snapDel = await getDocs(qDel);
                if (!snapDel.empty) {
                    const relevantDeletes = snapDel.docs
                        .map(d => d.data())
                        .filter(data => data.collectionName === "reports_2");
                    
                    relevantDeletes.forEach(data => {
                        const t = data.deletedAt?.toMillis?.() || 0;
                        if (t > maxTime) maxTime = t;
                    });

                    const idsToDelete = relevantDeletes.map(data => data.docId);
                    if (idsToDelete.length > 0) {
                        await deleteFromLocalDB("reports_2", idsToDelete);
                    }
                }
            }

            // 2. Đồng bộ Upserts (Dữ liệu Mới/Sửa)
            let newRecords = [];
            if (lastSync === 0) {
                // TỐI ƯU FIREBASE: Lần đầu Deep Search chỉ tải 60 ngày gần nhất
                const sixtyDaysAgo = new Date();
                sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
                const iso60 = formatISODate(sixtyDaysAgo);
                
                const qInit1 = query(collection(db, "reports_2"), where("ngay_nghi", ">=", iso60));
                const qInit2 = query(collection(db, "reports_2"), where("ngay_lam_db", ">=", iso60));
                const [snap1, snap2] = await Promise.all([getDocs(qInit1), getDocs(qInit2)]);
                
                const map = new Map();
                snap1.docs.forEach(doc => map.set(doc.id, {id: doc.id, ...doc.data()}));
                snap2.docs.forEach(doc => map.set(doc.id, {id: doc.id, ...doc.data()}));
                newRecords = Array.from(map.values());
            } else {
                // Tải dữ liệu thay đổi. Dùng song song 2 truy vấn để bắt cả mới và sửa
                const qCreated = query(collection(db, "reports_2"), where("createdAt", ">", new Date(lastSync)));
                const qUpdated = query(collection(db, "reports_2"), where("updatedAt", ">", new Date(lastSync)));
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
                await saveToLocalDB("reports_2", parsedRecords);

                newRecords.forEach(r => {
                    const t = r.updatedAt?.toMillis?.() || r.createdAt?.toMillis?.() || 0;
                    if (t > maxTime) maxTime = t;
                });
            }

            // Cập nhật mốc thời gian đồng bộ sử dụng thời gian của Server (maxTime)
            if (maxTime > lastSync) {
                await setLastSyncTime("reports_2", maxTime);
            }
        } catch (e) {
            console.warn("Lỗi đồng bộ reports_2:", e);
        }
    }

    async function performDeepSearch(queryText) {
        if (isFetching) return;
        isFetching = true;
        
        isDeepSearchMode = true;
        deepSearchQuery = queryText;
        
        try {
            // Chạy đồng bộ tự động dữ liệu trước khi thực hiện tìm kiếm trên IndexedDB
            await syncDeltaReports2();

            // 3. Nạp dữ liệu lên RAM và tìm kiếm
            const allLocalData = await getAllFromLocalDB("reports_2");
            // Sắp xếp ngày ghi mới nhất lên đầu
            allLocalData.sort((a, b) => new Date(getRecordDate(b) || 0).getTime() - new Date(getRecordDate(a) || 0).getTime());

            const lowerCaseQuery = normalizeForSearch(queryText).trim();
            const isSpecialWorkdayFilterActive = specialWorkdayFilterInput ? specialWorkdayFilterInput.checked : false;

            deepSearchResults = allLocalData.filter(item => {
                if (isSpecialWorkdayFilterActive && !item.isSpecialWorkday) return false;
                
                if (lowerCaseQuery !== "") {
                    if (!buildReportSearchString(item).includes(lowerCaseQuery)) return false;
                }
                return true;
            });

            // 4. Cập nhật giao diện tự động (Khóa UI Thời gian)
            if (deepSearchResults.length > 0) {
                const newestDate = getRecordDate(deepSearchResults[0]);
                const oldestDate = getRecordDate(deepSearchResults[deepSearchResults.length - 1]);
                if (fromInput) { fromInput.value = oldestDate; toggleFiltersUI(true); }
                if (toInput) { toInput.value = newestDate; toggleFiltersUI(true); }
                currentFilter.from = oldestDate;
                currentFilter.to = newestDate;
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
        const lowerCaseQuery = normalizeForSearch(query).trim();
        const isAdmin = userRole === "admin";
        const filteredData = filteredByDate.filter(item => { 
            return buildReportSearchString(item).includes(lowerCaseQuery);
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

        if (finalData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="8" style="text-align: center; color: #888; font-style: italic; padding: 20px;">
                Không tìm thấy dữ liệu nào khớp với từ khóa của bạn.
            </td>`;
            tbody.appendChild(tr);
            
            return;
        }

        let sttCounter = 1; 
        const fragment = document.createDocumentFragment();
        finalData.forEach(r => {
            const fileLink = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank">Link</a>` : "";
            const formattedTime = formatTimestamp(r.adminEdited === true ? r.createdAt : (r.updatedAt || r.createdAt));
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
            
            // Gắn sự kiện sao chép ID tài liệu bằng chuột phải hoặc nhấn giữ cho Admin
            if (isAdmin) {
                tr.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    copyDocIdToClipboard('reports_2', r.id);
                });

                let pressTimer;
                tr.addEventListener('touchstart', () => {
                    pressTimer = window.setTimeout(() => {
                        copyDocIdToClipboard('reports_2', r.id);
                    }, 800);
                }, { passive: true });
                tr.addEventListener('touchend', () => clearTimeout(pressTimer));
                tr.addEventListener('touchmove', () => clearTimeout(pressTimer));
            }

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
            autoLoadCount = 1; 
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
                if (!hasMore1 && !hasMore2) {
                    loadMoreBtn.style.display = 'none';
                } else {
                    loadMoreBtn.style.display = 'inline-block';
                    if (autoLoadCount >= MAX_AUTO_LOADS) {
                        loadMoreBtn.style.background = "#d35400";
                        loadMoreBtn.textContent = "⚠️ Bạn đã xem khá nhiều. Bấm để tải tiếp...";
                    } else {
                        loadMoreBtn.style.background = "var(--primary-color)";
                        loadMoreBtn.textContent = "⬇️ Cuộn để tải thêm...";
                    }
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

    const handleFilterChange = (e) => {
        if (e) e.preventDefault();
        const q = searchInput.value.trim();
        const isSpecialChecked = specialWorkdayFilterInput ? specialWorkdayFilterInput.checked : false;
        
        if (q !== "" || isSpecialChecked) {
            // Có từ khóa HOẶC chọn lọc đặc biệt -> Quét RAM luôn toàn bộ lịch sử
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #3498db; font-style: italic; padding: 20px;">⏳ Đang lọc dữ liệu...</td></tr>`;
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

    if (specialWorkdayFilterInput) {
        specialWorkdayFilterInput.addEventListener("change", () => {
            handleFilterChange();
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

                // Tự động đồng bộ các thay đổi mới nhất từ server về IndexedDB cục bộ
                await syncDeltaReports2();

                // Khởi động lắng nghe thời gian thực cho dữ liệu mới phát sinh
                startRealtimeSyncReports2(new Date(Date.now() - 300000));

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
                const q = searchInput.value.trim();
                const isSpecialChecked = specialWorkdayFilterInput ? specialWorkdayFilterInput.checked : false;
                if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

                if (q === "" && !isSpecialChecked) {
                    const wasDeepSearch = isDeepSearchMode;
                    isDeepSearchMode = false;
                    toggleFiltersUI(false);
                    
                    if (wasDeepSearch) {
                        if (fromInput) fromInput.value = savedStartDate;
                        if (toInput) toInput.value = savedEndDate;
                        currentFilter.from = savedStartDate;
                        currentFilter.to = savedEndDate;
                        fetchAndRenderData(false); // Reload gốc
                    } else {
                        if (loadMoreBtn && (lastDoc1 || lastDoc2)) {
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
                    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #3498db; font-style: italic; padding: 20px;">⏳ Đang tìm kiếm toàn bộ dữ liệu...</td></tr>`;
                    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
                    
                    searchDebounceTimer = setTimeout(() => performDeepSearch(q), 500);
                }
            });
            
            // MỚI: Xử lý click nút tải thêm (phòng khi Intersection Observer không nhạy)
            if (loadMoreBtn) {
                loadMoreBtn.addEventListener('click', () => {
                    if (autoLoadCount >= MAX_AUTO_LOADS) {
                        autoLoadCount = 1; // Khởi động mẻ quét mới
                    } else {
                        autoLoadCount++; // Tính luôn click thủ công vào quota
                    }
                    if (!isDeepSearchMode) {
                        loadMoreBtn.textContent = "⏳ Đang tải...";
                        loadMoreBtn.style.background = "var(--primary-color)";
                        fetchAndRenderData(true);
                    }
                });
            }

            // MỚI: Intersection Observer cho Infinite Scroll (Cuộn tới đâu tải tới đó)
            if (loadMoreBtn) {
                const handleIntersection = (entries) => {
                    // Nếu nút xuất hiện trên màn hình và không phải đang tải dở
                    if (entries[0].isIntersecting && !isFetching && loadMoreBtn.style.display !== 'none') {
                        if (autoLoadCount < MAX_AUTO_LOADS) {
                            autoLoadCount++;
                            if (!isDeepSearchMode) {
                                loadMoreBtn.textContent = "⏳ Đang tải...";
                                loadMoreBtn.style.background = "var(--primary-color)";
                                fetchAndRenderData(true); // Gửi cờ 'true' để nối thêm data
                            }
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
            if (unsubscribeRealtime) {
                unsubscribeRealtime();
                unsubscribeRealtime = null;
            }
            if (unsubscribeRealtimeDel) {
                unsubscribeRealtimeDel();
                unsubscribeRealtimeDel = null;
            }
            hideLoading(); 
        }
    });