// suco.js
import { db, onAuth, getRole, showSwal, showLoading, hideLoading, addLog, auth, compressImage, notifyAdmins, loadTemplate } from "./script.js";
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
  getDocs,
  where
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
// Đã ẩn ID thư mục để bảo mật

let userRole = "user";
let selectedFiles = [];   // Mảng lưu các File ảnh đã chọn (tối đa 3)
let allTickets = [];      // Mảng lưu toàn bộ tickets để tra cứu nhanh

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

// Xử lý nút chọn file tùy chỉnh — hỗ trợ tối đa 3 ảnh
const imagePreviewStrip = document.getElementById("imagePreviewStrip");

if (customFileBtn && fileInput) {
  customFileBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (event) => {
    const files = Array.from(event.target.files);
    if (!files.length) { resetFileSelector(); return; }

    // Giới hạn tối đa 3 ảnh
    if (files.length > 3) {
      showSwal("warning", "Quá giới hạn", "Chỉ được chọn tối đa 3 ảnh mỗi lần báo sự cố.");
      fileInput.value = "";
      return;
    }

    selectedFiles = files;
    customFileName.textContent = `Đã chọn ${files.length} ảnh`;
    customFileName.style.color = "#16a34a";
    customFileName.style.fontStyle = "normal";
    customFileName.style.fontWeight = "bold";

    // Render thumbnail preview strip
    if (imagePreviewStrip) {
      imagePreviewStrip.innerHTML = "";
      imagePreviewStrip.style.display = "flex";
      files.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const wrapper = document.createElement("div");
          wrapper.style.cssText = "position:relative; width:72px; height:72px; border-radius:6px; overflow:hidden; border:2px solid #e2e8f0; cursor:pointer;";

          const img = document.createElement("img");
          img.src = e.target.result;
          img.style.cssText = "width:100%; height:100%; object-fit:cover;";
          img.title = file.name;

          // Nút X xóa từng ảnh
          const btnRemove = document.createElement("button");
          btnRemove.type = "button";
          btnRemove.textContent = "✕";
          btnRemove.style.cssText = "position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.55); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:10px; line-height:18px; padding:0; cursor:pointer;";
          btnRemove.addEventListener("click", (ev) => {
            ev.stopPropagation();
            selectedFiles = selectedFiles.filter((_, i) => i !== idx);
            if (selectedFiles.length === 0) { resetFileSelector(); }
            else {
              customFileName.textContent = `Đã chọn ${selectedFiles.length} ảnh`;
              wrapper.remove();
            }
          });

          // Click ảnh để phóng to
          img.addEventListener("click", () => {
            Swal.fire({
              imageUrl: e.target.result,
              imageAlt: file.name,
              showCloseButton: true,
              showConfirmButton: false,
              backdrop: "rgba(0,0,0,0.8)"
            });
          });

          wrapper.appendChild(img);
          wrapper.appendChild(btnRemove);
          imagePreviewStrip.appendChild(wrapper);
        };
        reader.readAsDataURL(file);
      });
    }
  });
}

function resetFileSelector() {
  selectedFiles = [];
  if (fileInput) fileInput.value = "";
  if (customFileName) {
    customFileName.textContent = "Chưa chọn ảnh nào";
    customFileName.style.color = "#666";
    customFileName.style.fontStyle = "italic";
    customFileName.style.fontWeight = "normal";
  }
  if (imagePreviewStrip) {
    imagePreviewStrip.innerHTML = "";
    imagePreviewStrip.style.display = "none";
  }
}

// Tải danh sách thiết bị từ Firestore và đưa vào dropdown
async function loadDevicesToSelect() {
  try {
    const qDevices = query(collection(db, "devices"), orderBy("name", "asc"));
    const snap = await getDocs(qDevices);
    const devicesList = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

    if (deviceSelect) {
      deviceSelect.innerHTML = `<option value="" disabled selected>- Chọn thiết bị hỏng -</option>` +
        devicesList.map(d => {
          const label = d.code ? `${d.name} [${d.code}]` : d.name;
          const val = JSON.stringify({ name: d.name, code: d.code || "" });
          return `<option value='${val}'>${label}</option>`;
        }).join("") +
        `<option value="new_device">Thiết bị Khác...</option>`;
    }
  } catch (err) {
    console.warn("Lỗi tải danh sách thiết bị cho dropdown:", err);
    // Fallback nếu lỗi quyền hoặc lỗi mạng
    if (deviceSelect) {
      deviceSelect.innerHTML = `
        <option value="" disabled selected>- Lỗi tải danh sách thiết bị -</option>
        <option value="new_device">Nhập tay thiết bị...</option>
      `;
    }
  }
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

    // Nạp danh sách thiết bị trước
    await loadDevicesToSelect();

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

// ============================================================
// LIGHTBOX XEM ẢNH PHÓNG TO CÓ ZOOM
// ============================================================
function showImageLightbox(imageUrl) {
  // Tạo overlay
  const overlay = document.createElement("div");
  overlay.id = "imgLightboxOverlay";
  overlay.style.cssText = [
    "position:fixed", "inset:0", "z-index:99999",
    "background:rgba(0,0,0,0.92)",
    "display:flex", "align-items:center", "justify-content:center",
    "cursor:zoom-in", "overflow:hidden", "touch-action:none"
  ].join(";");

  // Nút đóng
  const btnClose = document.createElement("button");
  btnClose.innerHTML = "✕";
  btnClose.style.cssText = [
    "position:fixed", "top:16px", "right:20px",
    "background:rgba(255,255,255,0.15)", "color:#fff",
    "border:none", "border-radius:50%",
    "width:40px", "height:40px",
    "font-size:20px", "cursor:pointer",
    "z-index:100000", "line-height:40px",
    "display:flex", "align-items:center", "justify-content:center",
    "transition:background 0.2s"
  ].join(";");
  btnClose.onmouseenter = () => btnClose.style.background = "rgba(255,255,255,0.3)";
  btnClose.onmouseleave = () => btnClose.style.background = "rgba(255,255,255,0.15)";

  // Hướng dẫn zoom
  const hint = document.createElement("div");
  hint.textContent = "🔍 Cuộn chuột để zoom • Kéo để di chuyển";
  hint.style.cssText = [
    "position:fixed", "bottom:16px", "left:50%", "transform:translateX(-50%)",
    "color:rgba(255,255,255,0.5)", "font-size:12px",
    "pointer-events:none", "z-index:100000"
  ].join(";");

  // Ảnh
  const img = document.createElement("img");
  img.src = imageUrl;
  img.draggable = false;
  img.style.cssText = [
    "max-width:95vw", "max-height:90vh",
    "object-fit:contain",
    "transform-origin:center center",
    "transition:transform 0.1s ease",
    "cursor:grab", "user-select:none",
    "-webkit-user-drag:none",
    "border-radius:4px"
  ].join(";");

  // —— State zoom & pan ——
  let scale = 1;
  let panX = 0, panY = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;

  function applyTransform() {
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in";
    overlay.style.cursor = scale > 1 ? "default" : "zoom-in";
  }

  function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

  function closeLightbox() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    btnClose.remove();
    hint.remove();
  }

  // Mouse wheel zoom
  overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    scale = clamp(scale + delta, 0.5, 8);
    applyTransform();
  }, { passive: false });

  // Double-click reset zoom
  img.addEventListener("dblclick", () => {
    scale = scale > 1 ? 1 : 2;
    panX = 0; panY = 0;
    applyTransform();
  });

  // Mouse drag to pan
  img.addEventListener("mousedown", (e) => {
    if (scale <= 1) return;
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    e.preventDefault();
    applyTransform();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
    applyTransform();
  });
  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    applyTransform();
  });

  // Touch pinch-to-zoom
  let lastTouchDist = 0;
  let lastTouchMidX = 0, lastTouchMidY = 0;
  overlay.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastTouchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    } else if (e.touches.length === 1 && scale > 1) {
      isDragging = true;
      dragStartX = e.touches[0].clientX - panX;
      dragStartY = e.touches[0].clientY - panY;
    }
  }, { passive: true });
  overlay.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / lastTouchDist;
      scale = clamp(scale * ratio, 0.5, 8);
      lastTouchDist = dist;
      applyTransform();
    } else if (e.touches.length === 1 && isDragging) {
      panX = e.touches[0].clientX - dragStartX;
      panY = e.touches[0].clientY - dragStartY;
      applyTransform();
    }
  }, { passive: false });
  overlay.addEventListener("touchend", () => { isDragging = false; });

  // Click overlay (ngoài ảnh) để đóng
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLightbox();
  });
  btnClose.addEventListener("click", closeLightbox);

  // Phím Esc để đóng
  function onKey(e) { if (e.key === "Escape") closeLightbox(); }
  document.addEventListener("keydown", onKey);

  overlay.appendChild(img);
  document.body.appendChild(overlay);
  document.body.appendChild(btnClose);
  document.body.appendChild(hint);
}

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
    allTickets = [];
    snapshot.forEach(docDoc => {
      allTickets.push({ id: docDoc.id, ...docDoc.data() });
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
  const filtered = allTickets.filter(t => {
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

  // Xử lý ảnh đính kèm — hỗ trợ cả mảng imageLinks[] (mới) lẫn imageLink đơn (cũ)
  let imageHTML = "";
  const allImageLinks = (ticket.imageLinks && ticket.imageLinks.length > 0)
    ? ticket.imageLinks
    : (ticket.imageLink ? [ticket.imageLink] : []);
  if (allImageLinks.length > 0) {
    imageHTML = `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">`
      + allImageLinks.map(url => {
        const thumbUrl = getDriveThumbnailUrl(url);
        return `<div class="ticket-image-preview" style="width:72px; height:72px; background-size:cover; background-position:center; border-radius:6px; cursor:pointer; border:1px solid #e2e8f0; background-image:url('${thumbUrl}');" data-full-url="${url}"></div>`;
      }).join("")
      + `</div>`;
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

  const displayDevice = ticket.deviceCode ? `${ticket.deviceName} [${ticket.deviceCode}]` : ticket.deviceName;

  div.innerHTML = `
    <div>
      <div class="ticket-card-header">
        <span class="ticket-device-title" title="${displayDevice}">${displayDevice}</span>
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

  // Gắn sự kiện click ảnh phóng to — sử dụng lightbox có zoom
  div.querySelectorAll(".ticket-image-preview").forEach(imgEl => {
    imgEl.addEventListener("click", () => {
      const fullUrl = imgEl.dataset.fullUrl;
      // Thumbnail khổ lớn nhất (2400px) — Google Drive CDN, không bị chặn CORS
      const largeUrl = getDriveThumbnailUrl(fullUrl).replace("sz=w400", "sz=w2400");
      showImageLightbox(largeUrl);
    });
  });

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
    // Truyền cả mảng imageIds (mới) lẫn imageId đơn (cũ) để xử lý xóa Drive
    const idsToDelete = (ticket.imageIds && ticket.imageIds.length > 0)
      ? ticket.imageIds
      : (ticket.imageId ? [ticket.imageId] : []);
    btnDelete.addEventListener("click", () => handleDeleteTicket(ticket.id, idsToDelete));
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
  body.append("targetFolderId", "");

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

    let deviceNameStr = "";
    let deviceCodeStr = "";

    const selectedVal = deviceSelect.value;
    if (selectedVal === "new_device") {
      deviceNameStr = newDeviceName.value.trim();
    } else if (selectedVal) {
      try {
        const devObj = JSON.parse(selectedVal);
        deviceNameStr = devObj.name;
        deviceCodeStr = devObj.code || "";
      } catch (e) {
        deviceNameStr = selectedVal;
      }
    }

    const issueDescription = document.getElementById("incident-desc").value.trim();
    const severity = document.getElementById("incident-severity").value;

    if (!deviceNameStr || !issueDescription || !severity) {
      showSwal("error", "Thiếu thông tin", "Vui lòng nhập đầy đủ các trường bắt buộc.");
      return;
    }

    showLoading("Đang gửi báo cáo sự cố...");
    let imageLinks = [];
    let imageIds = [];

    try {
      // 1. Nén và tải từng ảnh lên Drive (ngưỡng nén: 1.5MB)
      if (selectedFiles.length > 0) {
        for (const rawFile of selectedFiles) {
          let compressedFile = rawFile;
          try {
            compressedFile = await compressImage(rawFile, 1.5, 0.88);
          } catch (err) {
            console.warn("Lỗi nén ảnh sự cố:", err);
          }
          const uploadRes = await uploadIncidentImage(compressedFile);
          imageLinks.push(uploadRes.url);
          imageIds.push(uploadRes.id);
        }
      }

      // 2. Tạo document sự cố trên Firestore
      const newTicket = {
        deviceName: deviceNameStr,
        deviceCode: deviceCodeStr,
        issueDescription,
        severity,
        status: "pending",
        reportedBy: auth.currentUser.email,
        reportedAt: serverTimestamp(),
        imageLinks,   // Mảng URL ảnh (mới)
        imageIds,     // Mảng ID ảnh trên Drive để xóa sau này
        imageLink: imageLinks[0] || null,   // Giữ compat với dữ liệu cũ
        imageId: imageIds[0] || null,
        resolvedBy: null,
        resolvedAt: null,
        notes: ""
      };

      const newTicketRef = await addDoc(collection(db, "maintenance_tickets"), newTicket);

      // 3. Ghi nhật ký bảo mật
      await addLog("incident_report_success", {
        ticketId: newTicketRef.id,
        deviceName: deviceNameStr,
        deviceCode: deviceCodeStr || "",
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
      await addLog("incident_report_failure", {
        deviceName: deviceNameStr,
        deviceCode: deviceCodeStr || "",
        severity,
        error: error.message,
        email: auth.currentUser.email
      });
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
      deviceName: allTickets.find(t => t.id === ticketId)?.deviceName || "",
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
      deviceName: allTickets.find(t => t.id === ticketId)?.deviceName || "",
      notes,
      email: auth.currentUser.email
    });
  } catch (error) {
    showSwal("error", "Lỗi cập nhật", error.message);
  } finally {
    hideLoading();
  }
}

// Admin: Xóa sự cố rác (Dọn dẹp tất cả ảnh trên Drive nếu có)
async function handleDeleteTicket(ticketId, imageIdsToDelete = []) {
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
    // 1. Xóa tất cả ảnh trên Drive qua GAS
    const idToken = await auth.currentUser.getIdToken();
    const idsArr = Array.isArray(imageIdsToDelete) ? imageIdsToDelete : [imageIdsToDelete].filter(Boolean);
    for (const fid of idsArr) {
      if (!fid) continue;
      try {
        const body = new URLSearchParams();
        body.append("idToken", idToken);
        body.append("action", "delete");
        body.append("fileId", fid);
        await fetch(DRIVE_API_URL, { method: "POST", body });
      } catch (err) {
        console.warn("Lỗi dọn dẹp ảnh trên Drive:", fid, err);
      }
    }

    // 2. Xóa doc trong Firestore
    await deleteDoc(doc(db, "maintenance_tickets", ticketId));

    // 3. Ghi log
    await addLog("incident_delete_success", {
      ticketId,
      deviceName: allTickets.find(t => t.id === ticketId)?.deviceName || "",
      email: auth.currentUser.email
    });
  } catch (error) {
    showSwal("error", "Lỗi khi xóa", error.message);
  } finally {
    hideLoading();
  }
}
