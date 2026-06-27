// kho.js
import { db, onAuth, getRole, showSwal, showLoading, hideLoading, addLog, auth, loadTemplate } from "./script.js";
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  doc, 
  serverTimestamp, 
  setDoc, 
  getDoc, 
  query, 
  orderBy, 
  limit, 
  increment 
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
const chemicalSelect = document.getElementById("import-chemical-name");
const newChemicalGroup = document.getElementById("new-chemical-group");
const stockGrid = document.getElementById("stock-grid");
const receiptsTbody = document.getElementById("receipts-tbody");

let userRole = "user";

// Khởi tạo ngày nhập mặc định là hôm nay
document.addEventListener("DOMContentLoaded", () => {
  const dateInput = document.getElementById("import-date");
  if (dateInput) {
    const today = new Date();
    dateInput.value = today.toISOString().split('T')[0];
  }
});

// Lắng nghe trạng thái chọn hóa chất
if (chemicalSelect) {
  chemicalSelect.addEventListener("change", (e) => {
    if (e.target.value === "new_chemical") {
      newChemicalGroup.style.display = "block";
      document.getElementById("new-chemical-name").setAttribute("required", "true");
    } else {
      newChemicalGroup.style.display = "none";
      document.getElementById("new-chemical-name").removeAttribute("required");
    }
  });
}

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
    
    // Nếu là admin, hiển thị form nhập kho
    if (userRole === "admin") {
      adminImportCard.style.display = "block";
    } else {
      adminImportCard.style.display = "none";
    }

    // Bắt đầu lắng nghe dữ liệu kho và lịch sử nhập kho
    startInventoryListeners();
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

  // 2. Lắng nghe lịch sử nhập kho (Chỉ lấy 15 giao dịch mới nhất)
  const qReceipts = query(
    collection(db, "chemical_receipts"),
    orderBy("receiptDate", "desc"),
    orderBy("createdAt", "desc"),
    limit(15)
  );

  onSnapshot(qReceipts, (snapshot) => {
    receiptsTbody.innerHTML = "";
    if (snapshot.empty) {
      receiptsTbody.innerHTML = `<tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: #64748b;">
          Chưa có giao dịch nhập kho nào.
        </td>
      </tr>`;
      return;
    }

    snapshot.forEach(docDoc => {
      const data = docDoc.data();
      const tr = document.createElement("tr");

      // Định dạng ngày hiển thị dd/MM/yyyy
      let displayDate = data.receiptDate || "N/A";
      const parts = displayDate.split("-");
      if (parts.length === 3) {
        displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }

      tr.innerHTML = `
        <td style="text-align: center; font-weight: bold; color: var(--primary-color);">${displayDate}</td>
        <td style="font-weight: 500;">${data.chemicalName}</td>
        <td style="text-align: right; font-weight: bold; color: #27ae60;">+${(data.amount || 0).toLocaleString("vi-VN")} kg</td>
        <td style="color: #64748b; font-style: italic;">${data.supplier || "-"}</td>
      `;
      receiptsTbody.appendChild(tr);
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

    let chemicalName = chemicalSelect.value;
    if (chemicalName === "new_chemical") {
      chemicalName = document.getElementById("new-chemical-name").value.trim();
    }

    const amount = parseFloat(document.getElementById("import-amount").value);
    const threshold = parseFloat(document.getElementById("import-threshold").value) || 0;
    const supplier = document.getElementById("import-supplier").value.trim();
    const date = document.getElementById("import-date").value;
    const note = document.getElementById("import-note").value.trim();

    if (!chemicalName || isNaN(amount) || amount <= 0 || !date) {
      showSwal("error", "Dữ liệu lỗi", "Vui lòng điền đầy đủ các thông tin hợp lệ.");
      return;
    }

    showLoading("Đang thực hiện nhập kho...");
    try {
      // 1. Lưu hóa đơn nhập kho
      await addDoc(collection(db, "chemical_receipts"), {
        chemicalName,
        amount,
        supplier,
        receiptDate: date,
        note,
        addedBy: auth.currentUser.email,
        createdAt: serverTimestamp()
      });

      // 2. Cập nhật tồn kho hóa chất (Nếu chưa có sẽ tự tạo doc mới nhờ merge: true)
      const docRef = doc(db, "chemical_inventory", chemicalName);
      
      // Kiểm tra xem đã có sẵn trong kho chưa để set unit và tên
      const docSnap = await getDoc(docRef);
      const payload = {
        chemicalName,
        currentStock: increment(amount),
        minimumThreshold: threshold,
        lastUpdated: serverTimestamp(),
        lastUpdatedBy: auth.currentUser.email
      };

      if (!docSnap.exists()) {
        payload.unit = "kg"; // Mặc định là kg khi tạo hóa chất mới
      }

      await setDoc(docRef, payload, { merge: true });

      // 3. Ghi nhật ký logs
      await addLog("chemical_import_success", {
        chemicalName,
        amount,
        supplier,
        date,
        email: auth.currentUser.email
      });

      showSwal("success", "Nhập kho thành công!", `Đã cộng thêm ${amount.toLocaleString("vi-VN")} kg ${chemicalName} vào kho.`);
      
      // Reset form nhập kho
      importForm.reset();
      newChemicalGroup.style.display = "none";
      document.getElementById("new-chemical-name").removeAttribute("required");
      
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
