// kho.js
import { db, onAuth, getRole, showSwal, showLoading, hideLoading, addLog, auth, loadTemplate, uploadFileToDrive, deleteFileFromDrive, promptForReAuth } from "./script.js";
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
  getDocs,
  where,
  query,
  orderBy,
  limit,
  increment,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initMenu } from "./menu.js";

// === Tải menu và footer ===
loadTemplate("menu-placeholder", "menu.html", () => {
  if (typeof initMenu === "function") initMenu();
});
loadTemplate("loading-placeholder", "modal.html");
loadTemplate("footer-placeholder", "footer.html");


const notLogged = document.getElementById("notLogged");
const pageContent = document.getElementById("pageContent");
const adminImportCard = document.getElementById("admin-import-card");
const importForm = document.getElementById("importForm");
// chemicalSelect and newChemicalGroup are replaced by dynamic rows class selectors
const stockGrid = document.getElementById("stock-grid");
const receiptsTbody = document.getElementById("receipts-tbody");

let userRole = "user";
let unsubscribeHistory = null;

// Khởi tạo ngày nhập mặc định là hôm nay
document.addEventListener("DOMContentLoaded", () => {
  const dateInput = document.getElementById("import-date");
  if (dateInput) {
    const today = new Date();
    dateInput.value = today.toISOString().split('T')[0];
  }

  // Khởi tạo tháng đối soát mặc định là tháng hiện tại
  const reconcileMonthInput = document.getElementById("reconcile-month");
  if (reconcileMonthInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    reconcileMonthInput.value = `${yyyy}-${mm}`;
    reconcileMonthInput.addEventListener("change", (e) => {
      generateReconciliationReport(e.target.value);
    });
  }

  // Lắng nghe thay đổi của tháng xem nhật ký
  const historyMonthInput = document.getElementById("history-month");
  if (historyMonthInput) {
    historyMonthInput.addEventListener("change", (e) => {
      loadImportHistory(e.target.value);
    });
  }

  // Cấu hình chuyển Tab
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.dataset.tab;

      tabButtons.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      const targetContent = document.getElementById(targetTab);
      if (targetContent) {
        targetContent.classList.add("active");
      }

      if (targetTab === "reconciliation-tab") {
        const selectedMonth = document.getElementById("reconcile-month").value;
        if (selectedMonth) {
          generateReconciliationReport(selectedMonth);
        }
      } else if (targetTab === "history-tab") {
        const selectedMonth = document.getElementById("history-month").value;
        if (selectedMonth) {
          loadImportHistory(selectedMonth);
        }
      }
    });
  });

  // Thiết lập điều khiển ảnh đính kèm thông minh
  const uploadTriggerBtn = document.getElementById("upload-trigger-btn");
  const fileInput = document.getElementById("import-file");
  const importDocLinkInput = document.getElementById("import-doc-link");
  const fileSelectedInfo = document.getElementById("file-selected-info");
  const selectedFileName = document.getElementById("selected-file-name");
  const clearSelectedFile = document.getElementById("clear-selected-file");

  if (uploadTriggerBtn && fileInput && importDocLinkInput && fileSelectedInfo) {
    uploadTriggerBtn.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        if (files.length === 1) {
          selectedFileName.textContent = files[0].name;
          importDocLinkInput.value = `[Đã chọn tệp: ${files[0].name}]`;
        } else {
          selectedFileName.textContent = `Đã chọn ${files.length} tệp`;
          importDocLinkInput.value = `[Đã chọn ${files.length} tệp: ${files.map(f => f.name).join(", ")}]`;
        }
        fileSelectedInfo.style.display = "flex";
        importDocLinkInput.readOnly = true;

        // Tự động đổi biểu tượng tương ứng với định dạng tệp
        const fileIconSpan = document.getElementById("selected-file-icon");
        if (fileIconSpan) {
          if (files.length > 1) {
            fileIconSpan.textContent = "🗂️"; // Nhiều file
          } else {
            const file = files[0];
            if (file.type.startsWith("image/")) {
              fileIconSpan.textContent = "📸";
            } else if (file.type === "application/pdf") {
              fileIconSpan.textContent = "📕";
            } else if (file.name.endsWith(".xls") || file.name.endsWith(".xlsx")) {
              fileIconSpan.textContent = "📊";
            } else if (file.name.endsWith(".doc") || file.name.endsWith(".docx")) {
              fileIconSpan.textContent = "📝";
            } else {
              fileIconSpan.textContent = "📄";
            }
          }
        }
      }
    });

    clearSelectedFile.addEventListener("click", () => {
      fileInput.value = "";
      importDocLinkInput.value = "";
      importDocLinkInput.readOnly = false;
      fileSelectedInfo.style.display = "none";
    });
  }
});

// === QUẢN LÝ THÊM/BỚT DÒNG HÓA CHẤT ĐỘNG ===
function addChemicalRow() {
  const container = document.getElementById("chemical-rows-container");
  if (!container) return;

  const newRow = document.createElement("div");
  newRow.className = "chemical-row";
  newRow.style.cssText = "background: #f8fafc; border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 12px; position: relative;";
  newRow.innerHTML = `
    <div class="form-group form-field">
      <label style="font-weight: 500;">Tên Hóa chất:</label>
      <select class="form-control row-chemical-name" required>
        <option value="" disabled selected>- Chọn hóa chất -</option>
        <option value="Polymer Anion">Polymer Anion</option>
        <option value="PAC">PAC</option>
        <option value="Chlorine">Chlorine</option>
        <option value="Polymer Cation">Polymer Cation</option>
        <option value="Javen">Javen</option>
        <option value="Phèn sắt">Phèn sắt</option>
        <option value="Phèn nhôm">Phèn nhôm</option>
        <option value="Xút (NaOH)">Xút (NaOH)</option>
        <option value="Axit Sunfuric (H2SO4)">Axit Sunfuric (H2SO4)</option>
        <option value="new_chemical">- Thêm hóa chất khác... -</option>
      </select>
    </div>

    <!-- Ô nhập hóa chất mới (Ẩn mặc định, chỉ hiện khi chọn hóa chất khác) -->
    <div class="form-group form-field row-new-chemical-group" style="display: none;">
      <label style="font-weight: 500;">Tên hóa chất mới:</label>
      <input type="text" class="form-control row-new-chemical-name" placeholder="Nhập tên hóa chất...">
    </div>

    <div style="display: flex; gap: 10px;">
      <div class="form-group form-field" style="flex: 1; margin-bottom: 0;">
        <label style="font-weight: 500;">Số lượng nhập (kg):</label>
        <input type="number" class="form-control row-amount" min="1" placeholder="Nhập số lượng..." required>
      </div>
      <div class="form-group form-field" style="flex: 1; margin-bottom: 0;">
        <label style="font-weight: 500;">Ngưỡng báo động (kg):</label>
        <input type="number" class="form-control row-threshold" min="0" placeholder="Ngưỡng..." value="100">
      </div>
    </div>
    
    <button type="button" class="remove-row-btn" style="display: none;" title="Xóa dòng này">
      ✕
    </button>
  `;
  container.appendChild(newRow);
  updateRemoveButtons();
}

function updateRemoveButtons() {
  const container = document.getElementById("chemical-rows-container");
  if (!container) return;
  const rows = container.querySelectorAll(".chemical-row");
  const showBtn = rows.length > 1;
  rows.forEach(row => {
    const btn = row.querySelector(".remove-row-btn");
    if (btn) btn.style.display = showBtn ? "block" : "none";
  });
}

// Đăng ký sự kiện quản lý dòng
document.addEventListener("DOMContentLoaded", () => {
  const addRowBtn = document.getElementById("add-chemical-row-btn");
  if (addRowBtn) {
    addRowBtn.addEventListener("click", addChemicalRow);
  }

  const rowsContainer = document.getElementById("chemical-rows-container");
  if (rowsContainer) {
    // 1. Lắng nghe thay đổi chọn hóa chất
    rowsContainer.addEventListener("change", (e) => {
      if (e.target.classList.contains("row-chemical-name")) {
        const row = e.target.closest(".chemical-row");
        const newGroup = row.querySelector(".row-new-chemical-group");
        const newInput = row.querySelector(".row-new-chemical-name");
        if (e.target.value === "new_chemical") {
          newGroup.style.display = "block";
          newInput.setAttribute("required", "true");
        } else {
          newGroup.style.display = "none";
          newInput.removeAttribute("required");
        }
      }
    });

    // 2. Lắng nghe sự kiện xóa hàng
    rowsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-row-btn") || e.target.closest(".remove-row-btn")) {
        const row = e.target.closest(".chemical-row");
        row.remove();
        updateRemoveButtons();
      }
    });
  }
});

// Theo dõi đăng nhập & phân quyền hiển thị
onAuth(async (user) => {
  if (!user) {
    notLogged.style.display = "block";
    pageContent.style.display = "none";
    return;
  }

  notLogged.style.display = "none";
  pageContent.style.display = "block";

  showLoading("Đang tải dữ liệu...");
  try {
    userRole = await getRole(user.email);

    // Nếu là admin, hiển thị form nhập kho và cột sidebar bên trái
    const adminSidebar = document.getElementById("admin-sidebar");
    if (userRole === "admin") {
      if (adminSidebar) adminSidebar.style.display = "block";
      adminImportCard.style.display = "block";
    } else {
      if (adminSidebar) adminSidebar.style.display = "none";
      adminImportCard.style.display = "none";
    }

    // Bắt đầu lắng nghe dữ liệu kho
    startInventoryListeners();

    // Khởi tạo danh sách tháng trong dropdown từ Firestore, mặc định chọn tháng mới nhất có dữ liệu
    await initHistoryMonthOptions();
    const historyMonthVal = document.getElementById("history-month")?.value || "all";
    loadImportHistory(historyMonthVal);
  } catch (error) {
    console.error("Lỗi khởi tạo kho:", error);
    showSwal("error", "Lỗi khởi tạo", error.message);
  } finally {
    hideLoading();
  }
});

// Lắng nghe Firestore Real-time
function startInventoryListeners() {
  // 1. Lắng nghe tồn kho
  onSnapshot(collection(db, "chemical_inventory"), (snapshot) => {
    stockGrid.innerHTML = "";
    if (snapshot.empty) {
      stockGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #64748b;">
        Chưa có hóa chất nào trong kho.
      </div>`;
      return;
    }

    const items = [];
    snapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });

    // Sắp xếp Alphabet theo tên hóa chất
    items.sort((a, b) => a.chemicalName.localeCompare(b.chemicalName));

    items.forEach(item => {
      const card = createStockCard(item);
      stockGrid.appendChild(card);
    });
  });
}

// Tạo thẻ hiển thị tồn kho hóa chất
function createStockCard(item) {
  const current = item.currentStock || 0;
  const min = item.minimumThreshold || 0;
  const name = item.chemicalName || item.id;
  const unit = item.unit || "kg";

  // Xác định trạng thái tồn kho
  let statusText = "An toàn";
  let statusClass = "badge-safe";
  let fillClass = "fill-safe";

  if (current <= 0) {
    statusText = "Hết hàng";
    statusClass = "badge-danger";
    fillClass = "fill-danger";
  } else if (current <= min) {
    statusText = "Sắp hết";
    statusClass = "badge-warning";
    fillClass = "fill-warning";
  }

  // Tính phần trăm cho thanh progress bar
  // Dùng capacity làm mốc 100% để hiển thị (capacity lớn hơn min * 3 hoặc current)
  const capacity = Math.max(current, min * 3, 500);
  const percent = Math.min(100, Math.max(0, (current / capacity) * 100));

  // Định dạng ngày cập nhật gần nhất
  let updateTimeText = "Chưa cập nhật";
  if (item.lastUpdated) {
    const d = item.lastUpdated.toDate ? item.lastUpdated.toDate() : new Date(item.lastUpdated);
    updateTimeText = d.toLocaleString("vi-VN", { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

  const div = document.createElement("div");
  div.className = "stock-card";
  div.innerHTML = `
    <div>
      <div class="stock-card-header">
        <span class="stock-title">${name}</span>
        <span class="stock-badge ${statusClass}">${statusText}</span>
      </div>
      
      <div class="stock-value-container">
        <span class="stock-large-value">${current.toLocaleString("vi-VN")}</span>
        <span class="stock-unit">${unit}</span>
        <div class="stock-min-label">Ngưỡng báo động: <b>${min.toLocaleString("vi-VN")} ${unit}</b></div>
      </div>

      <!-- Thanh progress bar -->
      <div class="progress-bar-container">
        <div class="progress-bar-fill ${fillClass}" style="width: ${percent}%"></div>
      </div>
    </div>

    <div class="stock-card-footer">
      Cập nhật: <b>${updateTimeText}</b><br>
      Bởi: <i>${item.lastUpdatedBy || "Hệ thống"}</i>
    </div>
  `;
  return div;
}

// Xử lý gửi form nhập kho
if (importForm) {
  importForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (userRole !== "admin") {
      showSwal("error", "Quyền hạn", "Chỉ có quản trị viên mới được phép nhập kho.");
      return;
    }

    // 1. Thu thập danh sách hóa chất từ các dòng
    const rowElements = document.querySelectorAll(".chemical-row");
    const chemicalItems = [];

    for (const row of rowElements) {
      let chemName = row.querySelector(".row-chemical-name").value;
      if (chemName === "new_chemical") {
        chemName = row.querySelector(".row-new-chemical-name").value.trim();
      }
      const amount = parseFloat(row.querySelector(".row-amount").value);
      const threshold = parseFloat(row.querySelector(".row-threshold").value) || 0;

      if (!chemName || isNaN(amount) || amount <= 0) {
        showSwal("error", "Dữ liệu lỗi", "Vui lòng kiểm tra lại thông tin các hóa chất nhập kho.");
        return;
      }
      chemicalItems.push({ chemicalName: chemName, amount, threshold });
    }

    if (chemicalItems.length === 0) {
      showSwal("error", "Dữ liệu lỗi", "Vui lòng thêm ít nhất một hóa chất.");
      return;
    }

    const supplier = document.getElementById("import-supplier").value.trim();
    const date = document.getElementById("import-date").value;
    const note = document.getElementById("import-note").value.trim();
    const docLink = document.getElementById("import-doc-link") ? document.getElementById("import-doc-link").value.trim() : "";

    // Đọc các file đính kèm (nếu có)
    const fileInput = document.getElementById("import-file");
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];

    if (!date) {
      showSwal("error", "Dữ liệu lỗi", "Vui lòng nhập ngày nhập kho.");
      return;
    }

    let finalDocLink = docLink;
    let docFileId = "";
    let docLinks = [];
    let docFileIds = [];

    showLoading("Đang xử lý nhập kho...");
    try {
      // Nếu có chọn tệp chứng từ, thực hiện upload lên Google Drive qua GAS
      if (files.length > 0) {
        showLoading(`Đang tải ${files.length} tệp chứng từ lên Google Drive...`);
        // Lấy tên hóa chất đại diện cho tên file
        const chemNamesStr = chemicalItems.map(item => item.chemicalName).join("-");
        const totalAmountStr = chemicalItems.reduce((acc, item) => acc + item.amount, 0) + "kg";
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          showLoading(`Đang tải tệp ${i + 1}/${files.length}: ${file.name}...`);
          const uploaded = await uploadFileToDrive(file, "KCN Thốt Nốt", "", "chemical_receipts", {
            chemicalName: chemNamesStr,
            amount: totalAmountStr,
            receiptDate: date
          });
          docLinks.push(uploaded.url);
          docFileIds.push(uploaded.id);
        }
        finalDocLink = docLinks[0]; // Link tệp đầu tiên cho tương thích dữ liệu cũ
        docFileId = docFileIds[0];   // File ID đầu tiên cho tương thích dữ liệu cũ
      } else if (docLink) {
        // Nếu dán link trực tiếp
        docLinks.push(docLink);
      }

      showLoading("Đang ghi nhận dữ liệu vào cơ sở dữ liệu...");

      // Tạo một mã đợt nhập duy nhất (batchId)
      const batchId = "BATCH-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7).toUpperCase();

      // Lưu chi tiết từng hóa chất và cập nhật tồn kho
      for (const item of chemicalItems) {
        // 1. Lưu hóa đơn nhập kho
        await addDoc(collection(db, "chemical_receipts"), {
          chemicalName: item.chemicalName,
          amount: item.amount,
          supplier,
          receiptDate: date,
          note,
          docLink: finalDocLink,
          docFileId: docFileId,
          docLinks: docLinks,
          docFileIds: docFileIds,
          batchId: batchId,
          addedBy: auth.currentUser.email,
          createdAt: serverTimestamp()
        });

        // 2. Cập nhật tồn kho hóa chất
        const docRef = doc(db, "chemical_inventory", item.chemicalName);
        const docSnap = await getDoc(docRef);
        const payload = {
          chemicalName: item.chemicalName,
          currentStock: increment(item.amount),
          minimumThreshold: item.threshold,
          lastUpdated: serverTimestamp(),
          lastUpdatedBy: auth.currentUser.email
        };

        if (!docSnap.exists()) {
          payload.unit = "kg"; // Mặc định là kg khi tạo hóa chất mới
        }

        await setDoc(docRef, payload, { merge: true });

        // 3. Ghi nhật ký logs
        await addLog("chemical_import_success", {
          chemicalName: item.chemicalName,
          amount: item.amount,
          supplier,
          date,
          batchId: batchId,
          email: auth.currentUser.email
        });
      }

      showSwal("success", "Nhập kho thành công!", `Đã nhập thành công ${chemicalItems.length} hóa chất vào kho theo đợt.`);

      // Reset form nhập kho và các trạng thái chọn file
      importForm.reset();
      
      // Xóa tất cả các hàng hóa chất động, chỉ giữ lại dòng đầu tiên
      const container = document.getElementById("chemical-rows-container");
      if (container) {
        container.innerHTML = "";
      }
      addChemicalRow(); // Thêm lại 1 dòng mặc định ban đầu

      const fileInfo = document.getElementById("file-selected-info");
      if (fileInfo) fileInfo.style.display = "none";
      const docLinkInput = document.getElementById("import-doc-link");
      if (docLinkInput) docLinkInput.readOnly = false;

      // Đặt lại ngày mặc định là hôm nay
      document.getElementById("import-date").value = new Date().toISOString().split('T')[0];

    } catch (error) {
      console.error("Lỗi khi nhập kho:", error);
      showSwal("error", "Nhập kho thất bại", error.message);
    } finally {
      hideLoading();
    }
  });
}

// === HÀM TẠO BÁO CÁO ĐỐI SOÁT XUẤT - NHẬP - TỒN THEO THÁNG ===
async function generateReconciliationReport(monthStr) {
  const tbody = document.getElementById("reconciliation-tbody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; padding: 30px; color: #64748b;">
        <span class="spinner" style="display: inline-block; width: 18px; height: 18px; border: 2px solid #ccc; border-top-color: var(--primary-color); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; vertical-align: middle;"></span>
        Đang tính toán dữ liệu đối soát...
      </td>
    </tr>
  `;

  try {
    const [year, month] = monthStr.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const startOfMonthStr = `${monthStr}-01`;
    const endOfMonthStr = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

    // Lấy chuỗi tháng hiện tại của hệ thống để so sánh
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const isCurrentMonth = (monthStr === currentMonthStr);

    // 1. Tải danh sách tồn kho hiện tại
    const inventorySnap = await getDocs(collection(db, "chemical_inventory"));
    const chemicalsMap = new Map();
    inventorySnap.forEach(d => {
      const data = d.data();
      chemicalsMap.set(d.id, {
        chemicalName: data.chemicalName || d.id,
        currentStock: data.currentStock || 0,
        unit: data.unit || "kg",
        totalImportInMonth: 0,
        totalImportSinceStart: 0,
        totalConsumptionInMonth: 0,
        totalConsumptionSinceStart: 0
      });
    });

    const getOrCreateChem = (name) => {
      const trimmed = name.trim();
      if (!chemicalsMap.has(trimmed)) {
        chemicalsMap.set(trimmed, {
          chemicalName: trimmed,
          currentStock: 0,
          unit: "kg",
          totalImportInMonth: 0,
          totalImportSinceStart: 0,
          totalConsumptionInMonth: 0,
          totalConsumptionSinceStart: 0
        });
      }
      return chemicalsMap.get(trimmed);
    };

    // 2. Truy vấn hóa đơn nhập kho từ đầu tháng đối soát tới nay
    const qReceipts = query(
      collection(db, "chemical_receipts"),
      where("receiptDate", ">=", startOfMonthStr)
    );
    const receiptsSnap = await getDocs(qReceipts);
    receiptsSnap.forEach(d => {
      const data = d.data();
      const name = data.chemicalName;
      if (!name) return;
      const amount = parseFloat(data.amount) || 0;
      const chem = getOrCreateChem(name);

      chem.totalImportSinceStart += amount;
      if (data.receiptDate <= endOfMonthStr) {
        chem.totalImportInMonth += amount;
      }
    });

    // 3. Truy vấn các báo cáo ca từ đầu tháng đối soát tới nay
    const qReports = query(
      collection(db, "shift_reports"),
      where("reportDate", ">=", startOfMonthStr)
    );
    const reportsSnap = await getDocs(qReports);

    // Hàm phụ trợ parse lượng tiêu hao an toàn
    const parseQuantity = (val) => {
      if (val === undefined || val === null) return 0;
      if (typeof val === 'number') return val;
      const clean = val.toString().replace(/,/g, '.').replace(/\s/g, '');
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    };

    reportsSnap.forEach(d => {
      const data = d.data();
      const date = data.reportDate;
      if (!date || !data.chemicals || !Array.isArray(data.chemicals)) return;
      data.chemicals.forEach(c => {
        const name = c.chemicalName;
        if (!name) return;
        const qty = parseQuantity(c.quantity);
        const chem = getOrCreateChem(name);

        chem.totalConsumptionSinceStart += qty;
        if (date <= endOfMonthStr) {
          chem.totalConsumptionInMonth += qty;
        }
      });
    });

    // 4. Render các dòng dữ liệu đối soát
    tbody.innerHTML = "";
    if (chemicalsMap.size === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 20px; color: #64748b;">
            Không tìm thấy dữ liệu hóa chất nào.
          </td>
        </tr>
      `;
      return;
    }

    // Sắp xếp Alphabet theo tên hóa chất
    const sortedChems = Array.from(chemicalsMap.values()).sort((a, b) => a.chemicalName.localeCompare(b.chemicalName));

    sortedChems.forEach(chem => {
      // Công thức tính ngược tồn đầu kỳ: Đầu kỳ = Hiện tại - Tổng nhập(từ đầu tháng đến nay) + Tổng dùng(từ đầu tháng đến nay)
      const beginningStock = chem.currentStock - chem.totalImportSinceStart + chem.totalConsumptionSinceStart;
      const theoreticalStock = beginningStock + chem.totalImportInMonth - chem.totalConsumptionInMonth;

      let actualStock = 0;
      if (isCurrentMonth) {
        actualStock = chem.currentStock;
      } else {
        // Tồn thực tế cuối kỳ của tháng cũ = Hiện tại - Nhập(sau tháng đó đến nay) + Tiêu hao(sau tháng đó đến nay)
        const importsAfterMonth = chem.totalImportSinceStart - chem.totalImportInMonth;
        const consumptionAfterMonth = chem.totalConsumptionSinceStart - chem.totalConsumptionInMonth;
        actualStock = chem.currentStock - importsAfterMonth + consumptionAfterMonth;
      }

      const discrepancy = actualStock - theoreticalStock;

      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border-color)";
      tr.dataset.chemicalName = chem.chemicalName;

      // Chuẩn bị HTML các ô cột
      const tdName = `<td style="padding: 12px 8px; font-weight: 500; color: var(--primary-color);">${chem.chemicalName}</td>`;
      const tdBeginning = `<td style="padding: 12px 8px; text-align: right;">${beginningStock.toLocaleString("vi-VN")} ${chem.unit}</td>`;
      const tdImport = `<td style="padding: 12px 8px; text-align: right; font-weight: bold; color: #27ae60;">+${chem.totalImportInMonth.toLocaleString("vi-VN")} ${chem.unit}</td>`;
      const tdConsume = `<td style="padding: 12px 8px; text-align: right; font-weight: bold; color: #e74c3c;">-${chem.totalConsumptionInMonth.toLocaleString("vi-VN")} ${chem.unit}</td>`;
      const tdTheoretical = `<td style="padding: 12px 8px; text-align: right; font-weight: bold; background-color: #f8fafc;">${theoreticalStock.toLocaleString("vi-VN")} ${chem.unit}</td>`;

      let tdActual = "";
      let tdAction = "";

      if (isCurrentMonth) {
        const isEditable = (userRole === "admin");
        tdActual = `
          <td style="padding: 12px 8px; text-align: right;">
            <div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
              <input type="number" step="any" class="actual-stock-input form-control" value="${actualStock}" 
                     style="width: 100px; text-align: right; padding: 4px 8px; border: 1px solid var(--border-input); border-radius: 4px; font-weight: bold;"
                     data-theoretical="${theoreticalStock}"
                     ${isEditable ? '' : 'disabled'}>
              <span style="font-size: 0.85rem; color: #64748b;">${chem.unit}</span>
            </div>
          </td>
        `;

        if (isEditable) {
          tdAction = `
            <td style="padding: 12px 8px; text-align: center;">
              <button class="update-stock-btn" style="background-color: var(--success-color); color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; cursor: pointer; transition: background-color 0.2s;" disabled>
                💾 Lưu
              </button>
            </td>
          `;
        } else {
          tdAction = `<td style="padding: 12px 8px; text-align: center; color: #94a3b8; font-style: italic; font-size: 0.8rem;">🔒 Chỉ Admin</td>`;
        }
      } else {
        tdActual = `<td style="padding: 12px 8px; text-align: right; font-weight: bold;">${actualStock.toLocaleString("vi-VN")} ${chem.unit}</td>`;
        tdAction = `<td style="padding: 12px 8px; text-align: center; color: #94a3b8; font-style: italic; font-size: 0.8rem;">🔒 Đã khóa</td>`;
      }

      // Xử lý cột chênh lệch màu sắc
      let discrepancyColor = "#64748b";
      let discrepancyText = discrepancy === 0 ? "0" : (discrepancy > 0 ? `+${discrepancy.toLocaleString("vi-VN")}` : discrepancy.toLocaleString("vi-VN"));
      if (discrepancy > 0) discrepancyColor = "#27ae60";
      else if (discrepancy < 0) discrepancyColor = "#e74c3c";

      const tdDiscrepancy = `<td class="discrepancy-cell" style="padding: 12px 8px; text-align: right; font-weight: bold; color: ${discrepancyColor};">${discrepancyText} ${chem.unit}</td>`;

      tr.innerHTML = tdName + tdBeginning + tdImport + tdConsume + tdTheoretical + tdActual + tdDiscrepancy + tdAction;
      tbody.appendChild(tr);
    });

    // Thêm lắng nghe sự kiện thay đổi dữ liệu đầu vào cho admin
    if (isCurrentMonth && userRole === "admin") {
      const inputs = tbody.querySelectorAll(".actual-stock-input");
      inputs.forEach(input => {
        const tr = input.closest("tr");
        const btn = tr.querySelector(".update-stock-btn");
        const discrepancyCell = tr.querySelector(".discrepancy-cell");
        const chemName = tr.dataset.chemicalName;
        const theoretical = parseFloat(input.dataset.theoretical) || 0;
        const unit = chemicalsMap.get(chemName).unit;

        input.addEventListener("input", (e) => {
          const val = parseFloat(e.target.value);
          if (isNaN(val) || val < 0) {
            btn.disabled = true;
            discrepancyCell.textContent = "Lỗi";
            discrepancyCell.style.color = "var(--danger-color)";
            return;
          }

          btn.disabled = false;
          const diff = val - theoretical;
          let diffColor = "#64748b";
          let diffText = diff === 0 ? "0" : (diff > 0 ? `+${diff.toLocaleString("vi-VN")}` : diff.toLocaleString("vi-VN"));
          if (diff > 0) diffColor = "#27ae60";
          else if (diff < 0) diffColor = "var(--danger-color)";

          discrepancyCell.textContent = `${diffText} ${unit}`;
          discrepancyCell.style.color = diffColor;
        });

        btn.addEventListener("click", async () => {
          const val = parseFloat(input.value);
          if (isNaN(val) || val < 0) return;

          showLoading(`Đang cập nhật tồn thực tế cho ${chemName}...`);
          try {
            const docRef = doc(db, "chemical_inventory", chemName);
            await setDoc(docRef, {
              currentStock: val,
              lastUpdated: serverTimestamp(),
              lastUpdatedBy: auth.currentUser?.email || "system"
            }, { merge: true });

            await addLog("chemical_stock_adjust", {
              chemicalName: chemName,
              oldStock: theoretical,
              newStock: val,
              difference: val - theoretical,
              email: auth.currentUser.email
            });

            btn.disabled = true;
            showSwal("success", "Đã cập nhật!", `Đã cập nhật tồn thực tế của ${chemName} thành ${val.toLocaleString("vi-VN")} ${unit}.`);

            // Tải lại báo cáo đối soát để tính toán lại đồng bộ các ô
            generateReconciliationReport(monthStr);
          } catch (err) {
            console.error("Lỗi cập nhật tồn thực tế:", err);
            showSwal("error", "Lỗi", err.message);
          } finally {
            hideLoading();
          }
        });
      });
    }

  } catch (err) {
    console.error("Lỗi tạo báo cáo đối soát:", err);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 30px; color: var(--danger-color); font-weight: bold;">
          Lỗi: ${err.message}
        </td>
      </tr>
    `;
  }
}

// === HÀM TẢI NHẬT KÝ NHẬP KHO THEO THÁNG (REALTIME) ===
function loadImportHistory(monthStr) {
  const tbody = document.getElementById("receipts-tbody");
  if (!tbody) return;

  // Hủy lắng nghe sự kiện cũ nếu có để tránh rò rỉ bộ nhớ
  if (unsubscribeHistory) {
    unsubscribeHistory();
    unsubscribeHistory = null;
  }

  let qReceipts;
  let loadingText = "";

  if (monthStr === "all") {
    loadingText = "Đang tải toàn bộ nhật ký nhập kho...";
    qReceipts = query(
      collection(db, "chemical_receipts"),
      orderBy("receiptDate", "desc"),
      orderBy("createdAt", "desc")
    );
  } else {
    const [year, month] = monthStr.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const startOfMonthStr = `${monthStr}-01`;
    const endOfMonthStr = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

    loadingText = `Đang tải nhật ký nhập kho tháng ${month}/${year}...`;
    qReceipts = query(
      collection(db, "chemical_receipts"),
      where("receiptDate", ">=", startOfMonthStr),
      where("receiptDate", "<=", endOfMonthStr),
      orderBy("receiptDate", "desc")
    );
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align: center; padding: 30px; color: #64748b;">
        <span class="spinner" style="display: inline-block; width: 18px; height: 18px; border: 2px solid #ccc; border-top-color: var(--primary-color); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; vertical-align: middle;"></span>
        ${loadingText}
      </td>
    </tr>
  `;

  unsubscribeHistory = onSnapshot(qReceipts, (snapshot) => {
    tbody.innerHTML = "";
    if (snapshot.empty) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 30px; color: #64748b;">
            Không có giao dịch nhập kho nào trong thời gian này.
          </td>
        </tr>
      `;
      return;
    }

    // 1. Chuyển đổi dữ liệu và sắp xếp
    const receipts = [];
    snapshot.forEach(docDoc => {
      receipts.push({ id: docDoc.id, ...docDoc.data() });
    });

    // Sắp xếp: Ngày nhập giảm dần, sau đó gom nhóm theo batchId (nếu có), cuối cùng theo thời gian tạo giảm dần
    receipts.sort((a, b) => {
      const dateA = a.receiptDate || "";
      const dateB = b.receiptDate || "";
      if (dateA !== dateB) return dateB.localeCompare(dateA);

      const batchA = a.batchId || "";
      const batchB = b.batchId || "";
      if (batchA !== batchB) {
        if (!batchA) return 1;  // Không có batchId đẩy xuống dưới
        if (!batchB) return -1; // Không có batchId đẩy xuống dưới
        return batchA.localeCompare(batchB);
      }

      const timeA = a.createdAt?.seconds || 0;
      const timeB = b.createdAt?.seconds || 0;
      return timeB - timeA;
    });

    // 2. Tính số lượng dòng của từng batchId để gộp ô (rowspan)
    const batchCounts = {};
    receipts.forEach(item => {
      if (item.batchId) {
        batchCounts[item.batchId] = (batchCounts[item.batchId] || 0) + 1;
      }
    });

    const renderedBatches = new Set();

    // 3. Render các hàng
    receipts.forEach(data => {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border-color)";

      // Định dạng ngày hiển thị dd/MM/yyyy
      let displayDate = data.receiptDate || "N/A";
      const parts = displayDate.split("-");
      if (parts.length === 3) {
        displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }

      // Tạo hiển thị ở cột chứng từ
      let docLinkHtml = '<span style="color: #cbd5e1;">-</span>';
      if (data.docLinks && Array.isArray(data.docLinks) && data.docLinks.length > 0) {
        docLinkHtml = `
          <div style="display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap;">
            ${data.docLinks.map((link, idx) => `
              <a href="${link}" target="_blank" title="Xem chứng từ ${idx + 1}" style="text-decoration: none; font-size: 1rem; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #e8f4fd; border-radius: 50%; color: var(--primary-color);">
                📄
              </a>
            `).join('')}
          </div>
        `;
      } else if (data.docLink) {
        // Tương thích dữ liệu cũ
        docLinkHtml = `
          <a href="${data.docLink}" target="_blank" title="Xem chứng từ" style="text-decoration: none; font-size: 1.1rem; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #e8f4fd; border-radius: 50%; color: var(--primary-color);">
            📄
          </a>
        `;
      }

      // Tạo hiển thị ở cột hành động
      let actionHtml = '<span style="color: #cbd5e1; font-size: 0.85rem;">-</span>';
      if (userRole === "admin") {
        actionHtml = `
          <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
            <button class="edit-btn" style="background: var(--info-color); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 4px;" title="Sửa đợt nhập">✏️ Sửa</button>
            <button class="delete-btn" style="background: var(--danger-color); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 4px;" title="Xóa đợt nhập">❌ Xóa</button>
          </div>
        `;
      }

      // Gom nhóm cột (Ngày nhập, Nhà cung cấp, Chứng từ, Hành động) cho các dòng chung batchId
      if (data.batchId) {
        const count = batchCounts[data.batchId];
        if (!renderedBatches.has(data.batchId)) {
          // Dòng đầu tiên của đợt nhập này -> Render đủ 6 cột, gộp ô bằng rowspan
          renderedBatches.add(data.batchId);
          tr.innerHTML = `
            <td rowspan="${count}" style="padding: 12px 8px; text-align: center; font-weight: bold; color: var(--primary-color); vertical-align: middle; background-color: #fafbfc; border-right: 1px solid var(--border-color);">${displayDate}</td>
            <td style="padding: 12px 8px; font-weight: 500;">${data.chemicalName}</td>
            <td style="padding: 12px 8px; text-align: right; font-weight: bold; color: #27ae60;">+${(data.amount || 0).toLocaleString("vi-VN")} kg</td>
            <td rowspan="${count}" style="padding: 12px 8px; color: #64748b; font-style: italic; vertical-align: middle; text-align: center; background-color: #fafbfc; border-left: 1px solid var(--border-color); border-right: 1px solid var(--border-color);">${data.supplier || "-"}</td>
            <td rowspan="${count}" style="padding: 12px 8px; text-align: center; vertical-align: middle; background-color: #fafbfc; border-right: 1px solid var(--border-color);">${docLinkHtml}</td>
            <td rowspan="${count}" style="padding: 12px 8px; text-align: center; vertical-align: middle; background-color: #fafbfc;">${actionHtml}</td>
          `;
        } else {
          // Các dòng sau của đợt nhập này -> Chỉ render Tên hóa chất và Số lượng
          tr.innerHTML = `
            <td style="padding: 12px 8px; font-weight: 500;">${data.chemicalName}</td>
            <td style="padding: 12px 8px; text-align: right; font-weight: bold; color: #27ae60;">+${(data.amount || 0).toLocaleString("vi-VN")} kg</td>
          `;
        }
      } else {
        // Bản ghi cũ không có batchId -> Render đủ 6 cột bình thường (rowspan = 1)
        tr.innerHTML = `
          <td style="padding: 12px 8px; text-align: center; font-weight: bold; color: var(--primary-color);">${displayDate}</td>
          <td style="padding: 12px 8px; font-weight: 500;">${data.chemicalName}</td>
          <td style="padding: 12px 8px; text-align: right; font-weight: bold; color: #27ae60;">+${(data.amount || 0).toLocaleString("vi-VN")} kg</td>
          <td style="padding: 12px 8px; color: #64748b; font-style: italic;">${data.supplier || "-"}</td>
          <td style="padding: 12px 8px; text-align: center;">${docLinkHtml}</td>
          <td style="padding: 12px 8px; text-align: center;">${actionHtml}</td>
        `;
      }

      if (userRole === "admin") {
        const editBtn = tr.querySelector(".edit-btn");
        const deleteBtn = tr.querySelector(".delete-btn");
        if (editBtn) {
          editBtn.addEventListener("click", () => {
            const batchItems = data.batchId ? receipts.filter(item => item.batchId === data.batchId) : [data];
            editReceipt(data.id, batchItems);
          });
        }
        if (deleteBtn) {
          deleteBtn.addEventListener("click", () => {
            const batchItems = data.batchId ? receipts.filter(item => item.batchId === data.batchId) : [data];
            deleteReceipt(data.id, batchItems);
          });
        }
      }

      tbody.appendChild(tr);
    });
  }, (error) => {
    console.error("Lỗi khi tải lịch sử nhập kho:", error);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 30px; color: var(--danger-color); font-weight: bold;">
          Lỗi: ${error.message}
        </td>
      </tr>
    `;
  });
}

// === HÀM KHỞI TẠO TÙY CHỌN BỘ LỌC THÁNG CHO NHẬT KÝ ===
async function initHistoryMonthOptions() {
  const select = document.getElementById("history-month");
  if (!select) return;

  try {
    // Truy vấn tất cả phiếu nhập kho để lấy các tháng duy nhất có dữ liệu
    const q = query(
      collection(db, "chemical_receipts"),
      orderBy("receiptDate", "desc")
    );
    const snap = await getDocs(q);

    const monthsSet = new Set();
    snap.forEach(d => {
      const data = d.data();
      const date = data.receiptDate;
      if (date && date.length >= 7) {
        monthsSet.add(date.slice(0, 7)); // Định dạng YYYY-MM
      }
    });

    const uniqueMonths = Array.from(monthsSet).sort().reverse(); // Từ mới nhất tới cũ nhất

    select.innerHTML = "";

    // Tùy chọn xem tất cả
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "Xem tất cả";
    select.appendChild(optAll);

    // Điền các tháng có dữ liệu thực tế
    uniqueMonths.forEach(m => {
      const [yyyy, mm] = m.split("-");
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = `Tháng ${mm}/${yyyy}`;
      select.appendChild(opt);
    });

    // Mặc định chọn tháng gần nhất có dữ liệu, nếu không có thì chọn "Xem tất cả"
    if (uniqueMonths.length > 0) {
      select.value = uniqueMonths[0];
    } else {
      select.value = "all";
    }

  } catch (err) {
    console.error("Lỗi khi tạo danh mục tháng lịch sử:", err);
    select.innerHTML = `
      <option value="all">Xem tất cả</option>
      <option value="${new Date().toISOString().slice(0, 7)}">Tháng hiện tại</option>
    `;
    select.value = "all";
  }
}

// === HÀM SỬA PHIẾU NHẬP KHO (Dành cho Admin) ===
// === HÀM SỬA PHIẾU NHẬP KHO (Dành cho Admin) ===
async function editReceipt(receiptId, batchItems) {
  if (userRole !== "admin") return;

  // Yêu cầu xác thực mật khẩu tài khoản trước khi thực hiện hành động chỉnh sửa dữ liệu
  const isAuthenticated = await promptForReAuth();
  if (!isAuthenticated) return;

  // Xây dựng giao diện sửa lượng hóa chất động
  let chemicalsHtml = "";
  batchItems.forEach((item, index) => {
    chemicalsHtml += `
      <div style="margin-bottom: 12px; padding: 10px; background: #f8fafc; border: 1px solid var(--border-color); border-radius: 6px;">
        <div style="font-weight: bold; margin-bottom: 6px; color: var(--primary-color);">${item.chemicalName}</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-size: 0.85rem; color: #64748b; white-space: nowrap; margin-bottom: 0;">Số lượng (kg):</label>
          <input id="edit-amount-${index}" type="number" step="any" class="swal2-input" value="${item.amount}" style="margin: 0; width: 100%; box-sizing: border-box; height: 34px; padding: 6px;">
        </div>
      </div>
    `;
  });

  const { value: formValues } = await Swal.fire({
    title: 'Chỉnh sửa Đợt Nhập Kho',
    html: `
      <div style="text-align: left; font-family: inherit; max-height: 450px; overflow-y: auto; padding-right: 8px;">
        <div style="margin-bottom: 12px; font-weight: bold; font-size: 0.95rem; border-bottom: 1px solid var(--border-color); padding-bottom: 6px; color: var(--primary-color);">
          Danh sách hóa chất trong đợt:
        </div>
        ${chemicalsHtml}
        
        <div style="margin-bottom: 12px; font-weight: bold; font-size: 0.95rem; border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin-top: 15px; color: var(--primary-color);">
          Thông tin chung đợt nhập:
        </div>
        <div style="margin-bottom: 12px;">
          <label style="font-weight: 600; font-size: 0.9rem; color: var(--primary-color);">Nhà cung cấp / Đối tác:</label>
          <input id="edit-supplier" class="swal2-input" value="${batchItems[0].supplier || ''}" style="margin: 5px 0; width: 100%; box-sizing: border-box;">
        </div>
        
        <div style="margin-bottom: 12px;">
          <label style="font-weight: 600; font-size: 0.9rem; color: var(--primary-color);">Ngày nhập:</label>
          <input id="edit-date" type="date" class="swal2-input" value="${batchItems[0].receiptDate}" style="margin: 5px 0; width: 100%; box-sizing: border-box;">
        </div>
        
        <div style="margin-bottom: 12px;">
          <label style="font-weight: 600; font-size: 0.9rem; color: var(--primary-color);">Ghi chú:</label>
          <input id="edit-note" class="swal2-input" value="${batchItems[0].note || ''}" style="margin: 5px 0; width: 100%; box-sizing: border-box;">
        </div>
        
        <div style="margin-bottom: 12px;">
          <label style="font-weight: 600; font-size: 0.9rem; color: var(--primary-color);">Liên kết chứng từ (Cách nhau bằng dấu phẩy nếu có nhiều link):</label>
          <input id="edit-doclink" class="swal2-input" value="${Array.isArray(batchItems[0].docLinks) ? batchItems[0].docLinks.join(', ') : (batchItems[0].docLink || '')}" style="margin: 5px 0; width: 100%; box-sizing: border-box;">
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '💾 Lưu thay đổi',
    cancelButtonText: 'Hủy',
    preConfirm: () => {
      const supplier = document.getElementById('edit-supplier').value.trim();
      const date = document.getElementById('edit-date').value;
      const note = document.getElementById('edit-note').value.trim();
      const docLinkInput = document.getElementById('edit-doclink').value.trim();

      if (!date) {
        Swal.showValidationMessage('Vui lòng nhập ngày nhập kho!');
        return false;
      }

      // Đọc số lượng sửa đổi
      const itemsUpdate = [];
      for (let i = 0; i < batchItems.length; i++) {
        const amtInput = document.getElementById(`edit-amount-${i}`);
        const amount = parseFloat(amtInput.value);
        if (isNaN(amount) || amount <= 0) {
          Swal.showValidationMessage(`Vui lòng nhập số lượng hợp lệ cho ${batchItems[i].chemicalName}!`);
          return false;
        }
        itemsUpdate.push({
          id: batchItems[i].id,
          chemicalName: batchItems[i].chemicalName,
          oldAmount: batchItems[i].amount,
          amount: amount
        });
      }

      let docLinks = [];
      if (docLinkInput) {
        docLinks = docLinkInput.split(',').map(s => s.trim()).filter(Boolean);
      }
      const docLink = docLinks[0] || "";

      return { supplier, date, note, docLink, docLinks, itemsUpdate };
    }
  });

  if (formValues) {
    showLoading("Đang cập nhật phiếu nhập kho...");
    try {
      // Cập nhật từng hóa chất
      for (const item of formValues.itemsUpdate) {
        const diff = item.amount - item.oldAmount;

        // 1. Cập nhật tồn kho hóa chất (nếu có thay đổi)
        if (diff !== 0) {
          const invRef = doc(db, "chemical_inventory", item.chemicalName);
          await setDoc(invRef, {
            currentStock: increment(diff),
            lastUpdated: serverTimestamp(),
            lastUpdatedBy: auth.currentUser.email
          }, { merge: true });
        }

        // 2. Cập nhật phiếu nhập
        const receiptRef = doc(db, "chemical_receipts", item.id);
        await setDoc(receiptRef, {
          amount: item.amount,
          supplier: formValues.supplier,
          receiptDate: formValues.date,
          note: formValues.note,
          docLink: formValues.docLink,
          docLinks: formValues.docLinks,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser.email
        }, { merge: true });

        // 3. Ghi nhật ký logs
        await addLog("chemical_receipt_edit", {
          receiptId: item.id,
          chemicalName: item.chemicalName,
          oldAmount: item.oldAmount,
          newAmount: item.amount,
          email: auth.currentUser.email
        });
      }

      showSwal("success", "Cập nhật thành công", "Phiếu nhập kho đã được chỉnh sửa và tồn kho đã cập nhật tương ứng.");
    } catch (error) {
      console.error("Lỗi khi chỉnh sửa phiếu nhập:", error);
      showSwal("error", "Lỗi cập nhật", error.message);
    } finally {
      hideLoading();
    }
  }
}

// === HÀM XÓA PHIẾU NHẬP KHO (Dành cho Admin) ===
// === HÀM XÓA PHIẾU NHẬP KHO (Dành cho Admin) ===
async function deleteReceipt(receiptId, batchItems) {
  if (userRole !== "admin") return;

  // Yêu cầu xác thực mật khẩu tài khoản trước khi thực hiện hành động xóa nguy hiểm
  const isAuthenticated = await promptForReAuth();
  if (!isAuthenticated) return;

  const chemNames = batchItems.map(item => `${item.chemicalName} (${item.amount} kg)`).join(", ");
  const receiptDate = batchItems[0].receiptDate;
  const isBatch = batchItems.length > 1;

  const confirm = await Swal.fire({
    title: isBatch ? 'Xóa Đợt Nhập Kho?' : 'Xóa Phiếu Nhập Kho?',
    text: isBatch 
      ? `Bạn có chắc chắn muốn xóa toàn bộ đợt nhập kho ngày ${receiptDate} gồm các hóa chất: ${chemNames}? Tồn kho hiện tại của tất cả hóa chất này sẽ bị giảm đi tương ứng.`
      : `Bạn có chắc chắn muốn xóa phiếu nhập kho của ${batchItems[0].chemicalName} (${batchItems[0].amount} kg) vào ngày ${receiptDate}? Tồn kho hiện tại sẽ bị giảm đi tương ứng.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#e74c3c',
    cancelButtonColor: '#95a5a6',
    confirmButtonText: '❌ Đồng ý xóa',
    cancelButtonText: 'Hủy'
  });

  if (confirm.isConfirmed) {
    showLoading("Đang xóa phiếu nhập kho...");
    try {
      // 1. Thu thập tất cả các fileId đính kèm để xóa trên Drive (tránh trùng lặp)
      const fileIdsToDelete = new Set();
      batchItems.forEach(item => {
        if (Array.isArray(item.docFileIds)) {
          item.docFileIds.forEach(id => { if (id) fileIdsToDelete.add(id); });
        } else if (item.docFileId) {
          fileIdsToDelete.add(item.docFileId);
        }
      });

      // Xóa các file trên Google Drive
      for (const fId of fileIdsToDelete) {
        try {
          await deleteFileFromDrive(fId);
        } catch (driveErr) {
          console.warn(`Lỗi khi xóa tệp đính kèm ${fId} trên Google Drive:`, driveErr);
        }
      }

      // 2. Lặp qua từng item trong đợt để giảm trừ tồn kho và xóa document trong Firestore
      for (const item of batchItems) {
        // Giảm trừ tồn kho tương ứng
        const invRef = doc(db, "chemical_inventory", item.chemicalName);
        await setDoc(invRef, {
          currentStock: increment(-item.amount),
          lastUpdated: serverTimestamp(),
          lastUpdatedBy: auth.currentUser.email
        }, { merge: true });

        // Xóa document phiếu nhập
        const receiptRef = doc(db, "chemical_receipts", item.id);
        await deleteDoc(receiptRef);

        // Ghi logs
        await addLog("chemical_receipt_delete", {
          receiptId: item.id,
          chemicalName: item.chemicalName,
          amount: item.amount,
          batchId: item.batchId || "",
          email: auth.currentUser.email
        });
      }

      showSwal("success", "Đã xóa thành công", isBatch ? "Đợt nhập kho đã được xóa sạch khỏi hệ thống." : "Phiếu nhập đã được gỡ bỏ khỏi hệ thống.");
    } catch (error) {
      console.error("Lỗi khi xóa phiếu nhập:", error);
      showSwal("error", "Xóa thất bại", error.message);
    } finally {
      hideLoading();
    }
  }
}
