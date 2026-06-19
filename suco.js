// suco.js
import { db, onAuth, getRole, showSwal, showLoading, hideLoading, addLog, auth, compressImage, notifyAdmins } from "./script.js";
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  updateDoc, 
  query, 
  orderBy, 
  getDoc,
  where 
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initMenu } from "./menu.js";

// === Tải menu và footer ===
fetch("menu.html").then(r => r.text()).then(h => {
  document.getElementById("menu-placeholder").innerHTML = h;
  if (typeof initMenu === "function") initMenu();
});
fetch("modal.html").then(r => r.text()).then(h => {
  document.getElementById("loading-placeholder").innerHTML = h;
});
fetch("footer.html").then(r => r.text()).then(h => {
  document.getElementById("footer-placeholder").innerHTML = h;
});

const notLogged = document.getElementById("notLogged");
const pageContent = document.getElementById("pageContent");
const deviceSelect = document.getElementById("device-select");
const newDeviceGroup = document.getElementById("new-device-group");
const newDeviceName = document.getElementById("new-device-name");
const incidentForm = document.getElementById("incidentForm");
const fileInput = document.getElementById("file");
const customFileBtn = document.getElementById("customFileBtn");
const customFileName = document.getElementById("customFileName");
const ticketGrid = document.getElementById("ticket-grid");

const filterStatus = document.getElementById("filter-status");
const filterSeverity = document.getElementById("filter-severity");

const DRIVE_API_URL = "https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec";
const INCIDENT_ROOT_FOLDER_ID = "1Q_LmzYCD-NWRtmba02SSqVSzhMEIHEpo"; // Lưu ảnh chung trong thư mục của KCN

let userRole = "user";
let currentImageBase64 = null;
let currentTickets = [];

// Xử lý ẩn hiện ô thiết bị khác
if (deviceSelect) {
  deviceSelect.addEventListener("change", (e) => {
    if (e.target.value === "new_device") {
      newDeviceGroup.style.display = "block";
      newDeviceName.setAttribute("required", "true");
    } else {
      newDeviceGroup.style.display = "none";
      newDeviceName.removeAttribute("required");
    }
  });
}

// Xử lý nút chọn file tùy chỉnh
if (customFileBtn && fileInput) {
  customFileBtn.addEventListener("click", () => fileInput.click());
  
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        currentImageBase64 = e.target.result;
        customFileName.textContent = file.name;
        customFileName.style.color = "#007bff";
        customFileName.style.fontStyle = "normal";
        customFileName.style.fontWeight = "bold";
        customFileName.style.textDecoration = "underline";
        customFileName.style.cursor = "pointer";
        customFileName.title = "Nhấn để xem ảnh";
      };
      reader.readAsDataURL(file);
    } else {
      resetFileSelector();
    }
  });

  customFileName.addEventListener("click", () => {
    if (currentImageBase64) {
      Swal.fire({
        imageUrl: currentImageBase64,
        imageAlt: "Ảnh chụp sự cố",
        showCloseButton: true,
        showConfirmButton: false,
        width: "auto",
        padding: "10px",
        backdrop: `rgba(0,0,0,0.8)`
      });
    }
  });
}

function resetFileSelector() {
  currentImageBase64 = null;
  fileInput.value = "";
  customFileName.textContent = "Không có tệp nào được chọn";
  customFileName.style.color = "#666";
  customFileName.style.fontStyle = "italic";
  customFileName.style.fontWeight = "normal";
  customFileName.style.textDecoration = "none";
  customFileName.style.cursor = "default";
  customFileName.title = "";
}

// Theo dõi đăng nhập & phân quyền
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
    
    // Khởi động lắng nghe sự cố
    startTicketsListener();
    setupFilters();
  } catch (error) {
    console.error("Lỗi khởi tạo:", error);
    showSwal("error", "Lỗi tải dữ liệu", error.message);
  } finally {
    hideLoading();
  }
});

// Setup các bộ lọc
function setupFilters() {
  filterStatus.addEventListener("change", renderTickets);
  filterSeverity.addEventListener("change", renderTickets);
}

// Lắng nghe dữ liệu sự cố thời gian thực
function startTicketsListener() {
  const qTickets = query(
    collection(db, "maintenance_tickets"),
    orderBy("reportedAt", "desc")
  );

  onSnapshot(qTickets, (snapshot) => {
    currentTickets = [];
    snapshot.forEach(docDoc => {
      currentTickets.push({ id: docDoc.id, ...docDoc.data() });
    });
    renderTickets();
  });
}

// Render các thẻ sự cố kèm bộ lọc
function renderTickets() {
  ticketGrid.innerHTML = "";
  const statusFilter = filterStatus.value;
  const severityFilter = filterSeverity.value;

  // Lọc dữ liệu trên client
  const filtered = currentTickets.filter(t => {
    // Lọc trạng thái
    if (statusFilter === "active") {
      if (t.status === "resolved") return false;
    } else if (statusFilter !== "all" && t.status !== statusFilter) {
      return false;
    }

    // Lọc mức độ
    if (severityFilter !== "all" && t.severity !== severityFilter) {
      return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    ticketGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #64748b;">
      Không tìm thấy sự cố nào phù hợp với bộ lọc.
    </div>`;
    return;
  }

  filtered.forEach(ticket => {
    const card = createTicketCard(ticket);
    ticketGrid.appendChild(card);
  });
}

// Helper: Lấy URL ảnh thumbnail Google Drive
function getDriveThumbnailUrl(viewUrl) {
  const match = viewUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w400`;
  }
  return viewUrl;
}

function getDriveDirectUrl(viewUrl) {
  const match = viewUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/uc?id=${match[1]}`;
  }
  return viewUrl;
}

// Tạo thẻ sự cố
function createTicketCard(ticket) {
  const div = document.createElement("div");
  
  // Xác định class cho mức độ nghiêm trọng
  let sevText = "Thấp";
  let sevClass = "badge-low";
  if (ticket.severity === "critical") {
    sevText = "Khẩn cấp";
    sevClass = "badge-crit";
  } else if (ticket.severity === "medium") {
    sevText = "Trung bình";
    sevClass = "badge-med";
  }

  // Xác định class cho trạng thái phiếu
  let statusText = "Đang chờ";
  let statusClass = "status-pending";
  if (ticket.status === "fixing") {
    statusText = "Đang sửa";
    statusClass = "status-fixing";
  } else if (ticket.status === "resolved") {
    statusText = "Đã xong";
    statusClass = "status-resolved";
  }

  // Thêm class nhấp nháy nếu là khẩn cấp chưa xử lý
  div.className = "ticket-card";
  if (ticket.severity === "critical" && ticket.status === "pending") {
    div.classList.add("critical-pending");
  }

  // Định dạng ngày giờ báo lỗi
  let reportTimeText = "Không rõ";
  if (ticket.reportedAt) {
    const d = ticket.reportedAt.toDate ? ticket.reportedAt.toDate() : new Date(ticket.reportedAt);
    reportTimeText = d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  // Xử lý ảnh đính kèm
  let imageHTML = "";
  if (ticket.imageLink) {
    const thumbUrl = getDriveThumbnailUrl(ticket.imageLink);
    imageHTML = `<div class="ticket-image-preview" style="background-image: url('${thumbUrl}');" data-full-url="${ticket.imageLink}"></div>`;
  }

  // Ghi chú sửa chữa của admin
  let notesHTML = "";
  if (ticket.status === "resolved" && ticket.notes) {
    let resolvedTimeText = "";
    if (ticket.resolvedAt) {
      const d = ticket.resolvedAt.toDate ? ticket.resolvedAt.toDate() : new Date(ticket.resolvedAt);
      resolvedTimeText = d.toLocaleDateString("vi-VN");
    }
    notesHTML = `
      <div class="ticket-notes-box">
        <b>Khắc phục:</b> ${ticket.notes}<br>
        <span style="font-size: 0.7rem; color: #64748b;">Bởi: ${ticket.resolvedBy} (${resolvedTimeText})</span>
      </div>
    `;
  }

  // Xử lý các nút tác vụ của admin
  let adminActionsHTML = "";
  if (userRole === "admin") {
    let actionButtons = "";
    if (ticket.status === "pending") {
      actionButtons = `<button class="btn-action btn-primary ticket-admin-btn btn-fixing" data-id="${ticket.id}">🔧 Sửa</button>`;
    } else if (ticket.status === "fixing") {
      actionButtons = `<button class="btn-action btn-success ticket-admin-btn btn-resolved" data-id="${ticket.id}">✅ Xong</button>`;
    }
    adminActionsHTML = `
      <div class="ticket-admin-actions">
        ${actionButtons}
        <button class="btn-action btn-danger ticket-admin-btn btn-delete" data-id="${ticket.id}" data-image-id="${ticket.imageId || ''}" title="Xóa lỗi rác">🗑️</button>
      </div>
    `;
  }

  div.innerHTML = `
    <div>
      <div class="ticket-card-header">
        <span class="ticket-device-title" title="${ticket.deviceName}">${ticket.deviceName}</span>
        <span class="severity-badge ${sevClass}">${sevText}</span>
      </div>
      
      <div class="ticket-desc">${ticket.issueDescription}</div>
      <div class="ticket-meta">Bởi: ${ticket.reportedBy} lúc ${reportTimeText}</div>
      
      ${imageHTML}
      ${notesHTML}
    </div>
    
    <div class="ticket-status-row">
      <span class="status-indicator ${statusClass}">${statusText}</span>
      ${adminActionsHTML}
    </div>
  `;

  // Gắn sự kiện click ảnh phóng to
  const imgPreview = div.querySelector(".ticket-image-preview");
  if (imgPreview) {
    imgPreview.addEventListener("click", () => {
      const fullUrl = imgPreview.dataset.fullUrl;
      const directUrl = getDriveDirectUrl(fullUrl);
      Swal.fire({
        imageUrl: directUrl,
        imageAlt: "Ảnh chụp sự cố thiết bị",
        showConfirmButton: false,
        showCloseButton: true,
        backdrop: `rgba(0,0,0,0.8)`
      });
    });
  }

  // Gắn sự kiện cho các nút hành động của Admin
  const btnFixing = div.querySelector(".btn-fixing");
  if (btnFixing) {
    btnFixing.addEventListener("click", () => handleUpdateStatus(ticket.id, "fixing"));
  }

  const btnResolved = div.querySelector(".btn-resolved");
  if (btnResolved) {
    btnResolved.addEventListener("click", () => handleResolveTicket(ticket.id));
  }

  const btnDelete = div.querySelector(".btn-delete");
  if (btnDelete) {
    btnDelete.addEventListener("click", () => handleDeleteTicket(ticket.id, ticket.imageId));
  }

  return div;
}

// Gửi ảnh sự cố lên Google Drive qua Apps Script Proxy
async function uploadIncidentImage(file) {
  const user = auth.currentUser;
  if (!user) throw new Error("Chưa đăng nhập");
  const idToken = await user.getIdToken();

  const toBase64 = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(f);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (err) => reject(err);
  });

  const base64 = await toBase64(file);

  const body = new URLSearchParams();
  body.append("idToken", idToken);
  body.append("action", "uploadReportImage");
  body.append("file", base64);
  body.append("name", file.name);
  body.append("type", file.type);
  body.append("targetFolderId", INCIDENT_ROOT_FOLDER_ID);

  const res = await fetch(DRIVE_API_URL, { method: "POST", body });
  const result = await res.json();

  if (result.error) {
    throw new Error(result.error);
  }
  return { url: result.link, id: result.id };
}

// Xử lý gửi báo cáo sự cố
if (incidentForm) {
  incidentForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    let deviceNameStr = deviceSelect.value;
    if (deviceNameStr === "new_device") {
      deviceNameStr = newDeviceName.value.trim();
    }

    const issueDescription = document.getElementById("incident-desc").value.trim();
    const severity = document.getElementById("incident-severity").value;
    const file = fileInput.files[0];

    if (!deviceNameStr || !issueDescription || !severity) {
      showSwal("error", "Thiếu thông tin", "Vui lòng nhập đầy đủ các trường bắt buộc.");
      return;
    }

    showLoading("Đang gửi báo cáo sự cố...");
    let imageLink = null;
    let imageId = null;

    try {
      // 1. Tải ảnh đính kèm lên Drive (nếu có)
      if (file) {
        let compressedFile = file;
        try {
          compressedFile = await compressImage(file, 4, 0.9);
        } catch (err) {
          console.warn("Lỗi nén ảnh sự cố:", err);
        }
        const uploadRes = await uploadIncidentImage(compressedFile);
        imageLink = uploadRes.url;
        imageId = uploadRes.id;
      }

      // 2. Tạo document sự cố trên Firestore
      const newTicket = {
        deviceName: deviceNameStr,
        issueDescription,
        severity,
        status: "pending",
        reportedBy: auth.currentUser.email,
        reportedAt: serverTimestamp(),
        imageLink,
        imageId,
        resolvedBy: null,
        resolvedAt: null,
        notes: ""
      };

      await addDoc(collection(db, "maintenance_tickets"), newTicket);

      // 3. Ghi nhật ký bảo mật
      await addLog("incident_report_success", {
        deviceName: deviceNameStr,
        severity,
        email: auth.currentUser.email
      });

      // 4. Bắn FCM thông báo khẩn cấp (nếu là critical)
      if (severity === "critical") {
        try {
          // Gửi thông báo đẩy đến tất cả Admin
          await notifyAdmins(
            "🚨 Báo cáo Sự Cố KHẨN CẤP",
            `Thiết bị: ${deviceNameStr}\nMô tả: ${issueDescription}\nBáo bởi: ${auth.currentUser.email}`
          );
        } catch (fcmErr) {
          console.warn("Lỗi gửi thông báo khẩn cấp:", fcmErr);
        }
      }

      showSwal("success", "Đã gửi sự cố thành công!", "Nhân viên vận hành và Admin sẽ theo dõi ca trực khắc phục.");
      
      // Reset form
      incidentForm.reset();
      newDeviceGroup.style.display = "none";
      newDeviceName.removeAttribute("required");
      resetFileSelector();

    } catch (error) {
      console.error("Lỗi gửi báo cáo sự cố:", error);
      showSwal("error", "Gửi thất bại", error.message);
    } finally {
      hideLoading();
    }
  });
}

// Admin: Cập nhật trạng thái sang "Đang sửa"
async function handleUpdateStatus(ticketId, nextStatus) {
  showLoading("Đang cập nhật trạng thái...");
  try {
    const docRef = doc(db, "maintenance_tickets", ticketId);
    await updateDoc(docRef, {
      status: nextStatus,
      lastUpdatedBy: auth.currentUser.email
    });

    await addLog("incident_status_update", {
      ticketId,
      status: nextStatus,
      email: auth.currentUser.email
    });
  } catch (error) {
    showSwal("error", "Lỗi cập nhật", error.message);
  } finally {
    hideLoading();
  }
}

// Admin: Khắc phục xong sự cố (Đồng thời bắt buộc điền ghi chú sửa chữa)
async function handleResolveTicket(ticketId) {
  const { value: notes } = await Swal.fire({
    title: "Xác nhận Khắc phục Sự cố",
    input: "textarea",
    inputLabel: "Ghi chú sửa chữa (Vật tư thay thế, giải pháp...):",
    inputPlaceholder: "Ví dụ: Đã đấu nối lại cáp điện bị chuột cắn, quấn lại cuộn dây stator...",
    inputAttributes: {
      maxlength: "300"
    },
    showCancelButton: true,
    confirmButtonText: "Xác nhận Xong",
    cancelButtonText: "Hủy",
    confirmButtonColor: "#273668",
    preConfirm: (value) => {
      if (!value || value.trim() === "") {
        Swal.showValidationMessage("Bạn bắt buộc phải nhập ghi chú sửa chữa!");
        return false;
      }
      return value.trim();
    }
  });

  if (!notes) return;

  showLoading("Đang lưu trạng thái khắc phục...");
  try {
    const docRef = doc(db, "maintenance_tickets", ticketId);
    await updateDoc(docRef, {
      status: "resolved",
      notes: notes,
      resolvedBy: auth.currentUser.email,
      resolvedAt: serverTimestamp()
    });

    await addLog("incident_resolve_success", {
      ticketId,
      notes,
      email: auth.currentUser.email
    });
  } catch (error) {
    showSwal("error", "Lỗi cập nhật", error.message);
  } finally {
    hideLoading();
  }
}

// Admin: Xóa sự cố rác (Dọn dẹp ảnh cũ trên Drive nếu có)
async function handleDeleteTicket(ticketId, imageId) {
  const isConfirmed = await Swal.fire({
    title: "Xác nhận Xóa Sự Cố?",
    text: "Mọi hồ sơ và ảnh đính kèm sẽ bị xóa hoàn toàn khỏi cơ sở dữ liệu!",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e74c3c",
    cancelButtonColor: "#95a5a6",
    confirmButtonText: "Vẫn Xóa",
    cancelButtonText: "Hủy"
  });

  if (!isConfirmed.isConfirmed) return;

  showLoading("Đang dọn dẹp và xóa sự cố...");
  try {
    // 1. Xóa ảnh trên Drive qua GAS (nếu có)
    if (imageId) {
      try {
        const body = new URLSearchParams();
        body.append("idToken", await auth.currentUser.getIdToken());
        body.append("action", "delete");
        body.append("fileId", imageId);
        await fetch(DRIVE_API_URL, { method: "POST", body });
      } catch (err) {
        console.warn("Lỗi dọn dẹp ảnh trên Drive khi xóa ticket:", err);
      }
    }

    // 2. Xóa doc trong Firestore
    await deleteDoc(doc(db, "maintenance_tickets", ticketId));

    // 3. Ghi log
    await addLog("incident_delete_success", {
      ticketId,
      email: auth.currentUser.email
    });
  } catch (error) {
    showSwal("error", "Lỗi khi xóa", error.message);
  } finally {
    hideLoading();
  }
}
