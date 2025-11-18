// script.js
// Firebase core
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";


// Firebase Auth
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// Firebase Firestore
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  where,
  limit 
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";



// 🚀 Firebase config (public - được bảo vệ bởi Firebase Security Rules)
const firebaseConfig = {
  apiKey: "AIzaSyB_OQlcgAsq7-W3fX1nv5nQQmpHl0pIzg0",
  authDomain: "kcnthotnot25.firebaseapp.com",
  projectId: "kcnthotnot25",
  storageBucket: "kcnthotnot25.firebasestorage.app",
  messagingSenderId: "456384727251",
  appId: "1:456384727251:web:ac452826d113ca1902ac26",
  measurementId: "G-GJDQ0R29EC"
};

export let config = { defaultHolidays: {} };
// ====== Firebase khởi tạo ======
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ====== AUTH ======
export function onAuth(callback) {
  onAuthStateChanged(auth, callback);
}

export function logout() {
  const userEmail = auth.currentUser?.email || "unknown";
  // ⭐️ BỔ SUNG LOG ⭐️
  addLog("logout", { email: userEmail, status: "success" });
  return signOut(auth);
}

// ====== ROLE ======
export async function getRole(email) {
  try {
    const snap = await getDoc(doc(db, "roles", email));
    const role = snap.exists() ? snap.data().role : "user";
    // addLog("getRole", { email, role }); // (Tùy chọn) 
    return role || "user";
  } catch (err) {
    console.error("Lỗi getRole:", err);
    return "user";
  }
}

// ================== AUTH - HÀM XÁC THỰC LẠI (RE-AUTHENTICATION) ==================

/**
 * Hiển thị hộp thoại SweetAlert2 để yêu cầu nhập mật khẩu xác thực lại.
 * @returns {Promise<boolean>} Trả về true nếu xác thực thành công.
 */
export async function promptForReAuth() {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  if (!user || !user.email) {
    showSwal("error", "Vui lòng đăng nhập lại trước.");
    return false;
  }

  const { value: password } = await Swal.fire({
    title: "Xác thực hành động",
    input: "password",
    inputPlaceholder: "Nhập mật khẩu...",
    showConfirmButton: false,   // bỏ nút xác nhận
    showCancelButton: false,    // bỏ nút hủy
    allowOutsideClick: true,    // click ra ngoài để thoát
    allowEscapeKey: true,       // nhấn ESC để thoát
    inputAttributes: {
    autocapitalize: "off",
    autocomplete: "new-password",  // 🚀 báo trình duyệt không lưu
    style: "background:#fff; color:#000; border-radius:6px; padding:8px; width:450px; text-align:center;"
    },
    background: "rgba(255, 255, 255, 0.9)",   // 🚀 nền đen mờ 90%
    didOpen: () => {
      const input = Swal.getInput();
      if (input) {
        input.focus();
        // Khi nhấn Enter thì đóng Swal
        input.addEventListener("keyup", async (e) => {
          if (e.key === "Enter") {
            Swal.close();
          }
        });
      }
    }
  });

  if (!password) {
    console.log("[ReAuth] Người dùng đã thoát hoặc không nhập mật khẩu.");
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("reAuth_dismissed", { email: userEmail, status: "canceled" });
    return false;
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("reAuth_success", { email: userEmail, status: "success" });
    return true;
  } catch (err) {
    console.error("[ReAuth] Lỗi xác thực:", err);
    showSwal("error", "Mật khẩu không chính xác.");
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("reAuth_failure", { email: userEmail, status: "error", error: err.code });
    return false;
  }
}

//
// Thêm hàm load config (thường được gọi trong onAuth hoặc khi trang load)
export async function loadConfig() {
    try {
        const ref = doc(db, "settings", "reportConfig");
        const snap = await getDoc(ref);
        if (snap.exists()) {
            config = snap.data();
            console.log("Config loaded:", config);
        } else {
            console.log("Config document not found. Using default.");
        }
    } catch (e) {
        console.error("Error loading config:", e);
    }
}


// ====== LOG ======
export async function addLog(action, data = {}) {
  try {
    await addDoc(collection(db, "logs"), {
      action,
      ...data,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Lỗi addLog:", err);
  }
}

// ====== Google Drive API ======
const DRIVE_API_URL = "https://script.google.com/macros/s/AKfycbwuNTOBpbG2Zla8V6MLRLVY_xoRPhqZS6DT6YImnw9YCOZhJARQ1mSrNLEPZvM33PwqaA/exec"; // 🔗 thay link Apps Script

// Sửa đổi: Thêm tham số folderId, formId, và data
async function uploadFileToDrive(file, company, folderId, formId, data) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  if (!user) throw new Error("Chưa đăng nhập");

  const idToken = await user.getIdToken();
  const base64 = await toBase64(file);

  const body = new URLSearchParams();
  body.append("idToken", idToken);
  body.append("action", "upload");
  body.append("file", base64);
  body.append("name", file.name);
  body.append("type", file.type);
  body.append("company", company);
  body.append("folderId", folderId); // Thêm ID thư mục
  body.append("formId", formId);     // Thêm ID form
  body.append("data", JSON.stringify(data)); // Gửi toàn bộ dữ liệu form

  const res = await fetch(DRIVE_API_URL, { method: "POST", body });
  const result = await res.json();
  if (result.error) {
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("drive_upload_failure", { email: userEmail, file: file.name, error: result.error });
    throw new Error(result.error);
  }
  
  // ⭐️ BỔ SUNG LOG ⭐️
  addLog("drive_upload_success", { email: userEmail, file: file.name, fileId: result.id, url: result.link });
  return { url: result.link, id: result.id };
}

async function deleteFileFromDrive(fileId) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";
  
  if (!user) {
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("drive_delete_unauthorized", { fileId, status: "error" });
      throw new Error("Chưa đăng nhập");
  }

  const idToken = await user.getIdToken();

  const body = new URLSearchParams();
  body.append("idToken", idToken);
  body.append("action", "delete");
  body.append("fileId", fileId);

  const res = await fetch(DRIVE_API_URL, { method: "POST", body });
  const data = await res.json();
  if (data.error) {
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("drive_delete_failure", { email: userEmail, fileId, error: data.error });
      throw new Error(data.error);
  }
  
  // ⭐️ BỔ SUNG LOG ⭐️
  addLog("drive_delete_success", { email: userEmail, fileId, status: "success" });
  return data;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (error) => reject(error);
  });
}

// ====== REPORTS ======

// ⭐️ BỔ SUNG: HÀM LƯU FIRESTORE ĐƠN LẺ ⭐️
/**
 * Thêm một bản ghi duy nhất vào Firestore.
 */
async function addReportDoc(data = {}, collectionName) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  if (!user) {
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("addDoc_unauthorized", { collection: collectionName });
      throw new Error("Chưa đăng nhập"); 
  }
  
  const record = {
    ...data,
    createdBy: userEmail,
    createdAt: serverTimestamp(),
  };

  try {
      const docRef = await addDoc(collection(db, collectionName), record);
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("addDoc_success", { collection: collectionName, docId: docRef.id, email: userEmail, company: data.company });
      return docRef;
  } catch (err) {
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("addDoc_failure", { collection: collectionName, email: userEmail, error: err.message, data: data });
      throw err; // Ném lỗi để luồng chính có thể bắt được
  }
}

// ================== HÀM XỬ LÝ FORM CHUNG ==================
// Sửa đổi: Thêm tham số folderId
export async function submitForm(e, formId, collectionName, folderId) {
  e.preventDefault();
  const form = document.getElementById(formId);
  showLoading("Đang kiểm tra dữ liệu..."); // Di chuyển showLoading lên đầu
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

// --- KIỂM TRA KÍCH THƯỚC FILE ---
  const fileInput = form.file?.files?.[0]; // Sử dụng optional chaining để tránh lỗi nếu không có form.file
  const MAX_FILE_SIZE_BYTES = 5242880; // 5MB

  if (fileInput) {
    if (fileInput.size > MAX_FILE_SIZE_BYTES) {
      hideLoading();
      showSwal("error", "Kích thước file vượt quá 5MB. Vui lòng chọn file nhỏ hơn.");
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("file_size_error", { email: userEmail, formId, fileName: fileInput.name, sizeBytes: fileInput.size });
      return; // Ngăn chặn việc gửi form
    }
  }
// ------------------------------------------
  let data = {};
  let file = null;

// 1. Tùy theo formId mà build object data và lấy file
  switch (formId) {
    case "registrationForm_1":
      let chiSoStr = form.chi_so.value.trim();

      // Bỏ dấu chấm phân cách nghìn
      chiSoStr = chiSoStr.replace(/\./g, "");

      // Chuyển thành số
      let chiSoNum = parseFloat(chiSoStr);

      data = {
        company: form.c_ty.value.trim(),
        chi_so: chiSoNum,   // ✅ luôn là Number
        ngay_ghi: form.ngay_ghi.value.trim(),
        ghi_chu: form.ghi_chu.value.trim(),
      };
      file = form.file?.files?.[0];
      break;

    case "registrationForm_2":  // Form kiểu khác
      data = {
        company: form.c_ty.value.trim(),
        ngay_nghi: form.ngay_nghi.value.trim(),
        ngay_lam_db: form.ngay_lam_db.value.trim(),
        ghi_chu: form.ghi_chu.value.trim(),
      };
      file = form.file?.files?.[0];
      
      // ✅ KIỂM TRA DỮ LIỆU BẮT BUỘC CHO FORM 2
      if (!data.ngay_nghi && !data.ngay_lam_db) {
        hideLoading();
        showSwal("error", "Vui lòng nhập Ngày nghỉ HOẶC Ngày làm đặc biệt.");
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("form2_validation_error", { email: userEmail, error: "Missing both ngay_nghi and ngay_lam_db" });
        return;
      }
      if (data.ngay_nghi && data.ngay_lam_db) {
        hideLoading();
        showSwal("error", "Vui lòng chỉ chọn Ngày nghỉ HOẶC Ngày làm đặc biệt.");
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("form2_validation_error", { email: userEmail, error: "Both ngay_nghi and ngay_lam_db submitted" });
        return;
      }
      break;
    // sau này thêm form khác thì thêm case mới
    default:
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("form_unknown_id", { email: userEmail, formId });
        break;
  }

  // --- LOGIC MỚI: KIỂM TRA FILE ĐÍNH KÈM VÀ YÊU CẦU XÁC NHẬN ---
  // Đã kiểm tra kích thước file, bây giờ kiểm tra việc đính kèm.
  hideLoading(); // Ẩn loading kiểm tra dữ liệu trước khi hiện confirm
    // BƯỚC 1: Lấy đúng input file cho form hiện tại
      const currentForm = document.getElementById(formId);
      // Tìm input file có id="file" HOẶC id="file_2" bên trong form
      const filesInput = currentForm.querySelector('#file, #file_2'); 

    // BƯỚC 2: Kiểm tra thiếu file (ĐÃ BỎ ĐIỀU KIỆN LOẠI TRỪ TRƯỚC ĐÓ)
    if (filesInput && filesInput.files.length === 0) { 
        const isConfirmed = await showConfirmSwal(
            "Thiếu File Đính Kèm",
            "Bạn chưa đính kèm thông báo. Bạn có chắc chắn muốn gửi báo cáo này không?",
            "Có, tôi chắc chắn gửi",
            "Không, tôi sẽ đính kèm"
        );


      if (isConfirmed) {
          // Tiếp tục gửi báo cáo
          showLoading("Đang xử lý báo cáo..."); // Hiện loading lại khi bắt đầu xử lý
          await handleSubmit(form, data, file, collectionName, folderId, formId);
      } else {
          showSwal("info", "Đã hủy gửi báo cáo.", "Vui lòng kiểm tra lại thông báo.");
          // ⭐️ BỔ SUNG LOG ⭐️
          addLog("form_submit_canceled", { email: userEmail, formId, reason: "No file confirmation" });
      }
  } else {
    // Nếu CÓ file đính kèm, tiến hành gửi ngay lập tức
    showLoading("Đang xử lý báo cáo..."); // Hiện loading lại khi bắt đầu xử lý
    await handleSubmit(form, data, file, collectionName, folderId, formId);
  }
}
window.submitForm = submitForm;

// ================== HÀM LƯU FIRESTORE/DRIVE (Bỏ qua vì đã dùng addReportDoc) ==================
export async function addReport(data = {}, file = null, collectionName, folderId, formId) {
  // Hàm này bị bỏ qua trong logic mới của handleSubmit
  // Giữ lại vì có thể có code khác dùng đến nó.
  const user = auth.currentUser;
  if (!user) throw new Error("Bạn phải đăng nhập để gửi báo cáo");

  let fileUrl = "";
  let fileId = "";

  if (file) {
    const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
    fileUrl = uploaded.url;
    fileId = uploaded.id;
  }

  const record = {
    ...data,
    createdBy: user.email,
    createdAt: serverTimestamp(),
    fileUrl,
    fileId,
  };

  await addLog("addReport", { ...data, email: user.email, fileUrl, fileId});
  await addDoc(collection(db, collectionName), record);
}

// ================== HÀM XỬ LÝ LƯU TRỮ VÀ GHI ĐÈ CHUNG (ĐÃ SỬA LỖI TRY/CATCH VÀ UNDEFINED) ==================
export async function handleSubmit(form, data, file = null, collectionName, folderId, formId) {
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  try {
    if (!user) throw new Error("Bạn phải đăng nhập để gửi báo cáo");

    let fileUrl = "";
    let fileId = "";

    // --- BƯỚC 1: Xử lý Form 2 (Ngày nghỉ/Ngày làm đặc biệt) ---
// --- BƯỚC 1: Xử lý Form 2 (Ngày nghỉ/Ngày làm đặc biệt) ---
if (formId === "registrationForm_2" && (data.ngay_nghi || data.ngay_lam_db)) {

    const dateStr = data.ngay_nghi || data.ngay_lam_db;
    const isSpecialWorkdaySubmission = !!data.ngay_lam_db;
    const submissionType = isSpecialWorkdaySubmission ? "Ngày làm Đặc biệt" : "Ngày nghỉ";
    
    // Tách chuỗi ngày thành mảng các ngày (YYYY-MM-DD)
    const dates = dateStr.split(',').map(d => d.trim()).filter(d => d.length > 0);

    const baseData = { ...data };
    delete baseData.ngay_nghi; 
    delete baseData.ngay_lam_db; 

    // 1) Tải File Lên Drive (Chỉ 1 lần) - nếu có file
    if (file) {
      const uploaded = await uploadFileToDrive(file, baseData.company || "NoCompany", folderId, formId, data);
      fileUrl = uploaded.url;
      fileId = uploaded.id;
    }

    // 2) Thêm/Ghi đè từng ngày (TUẦN TỰ)
    let addedCount = 0;
    let skipped = 0;
    let errorList = []; // Khởi tạo danh sách lỗi
    
    // ⭐️ TỐI ƯU HÓA: ĐỌC TẤT CẢ DỮ LIỆU 1 LẦN (Thay vì N lần)
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    
    const [allHolidaysSnap, allSpecialSnap] = await Promise.all([
        getDocs(query(
            collection(db, collectionName),
            where("company", "==", baseData.company),
            where("ngay_nghi", ">=", minDate),
            where("ngay_nghi", "<=", maxDate)
        )),
        getDocs(query(
            collection(db, collectionName),
            where("company", "==", baseData.company),
            where("ngay_lam_db", ">=", minDate),
            where("ngay_lam_db", "<=", maxDate)
        ))
    ]);
    
    // Tạo Map để tra cứu nhanh O(1)
    const holidayMap = new Map(
        allHolidaysSnap.docs.map(doc => [doc.data().ngay_nghi, doc])
    );
    const specialMap = new Map(
        allSpecialSnap.docs.map(doc => [doc.data().ngay_lam_db, doc])
    );

    for (const singleDate of dates) {
        // 2a) TÌM BẢN GHI TRÙNG - ⭐️ TRA CỨU TRONG MAP (Không đọc Firebase)
        const existingHoliday = holidayMap.get(singleDate);
        const existingSpecial = specialMap.get(singleDate);
        
        let existingDoc = existingHoliday || existingSpecial || null;
        let existingData = existingDoc?.data() || null;

        // 2b) CHUẨN BỊ DỮ LIỆU MỚI
        const newRecordData = {
            ...baseData,
            isSpecialWorkday: isSpecialWorkdaySubmission,
            ghi_chu: baseData.ghi_chu || (isSpecialWorkdaySubmission ? "Ngày làm đặc biệt" : "N/A"),
            fileUrl,
            fileId,
        };

        if (isSpecialWorkdaySubmission) {
            newRecordData.ngay_lam_db = singleDate;
            // Đảm bảo không có trường 'ngay_nghi' khi là NLĐB
            delete newRecordData.ngay_nghi; 
        } else {
            newRecordData.ngay_nghi = singleDate;
            // Đảm bảo không có trường 'ngay_lam_db' khi là Ngày nghỉ
            delete newRecordData.ngay_lam_db;
        }

        // 2c) XỬ LÝ XUNG ĐỘT HOẶC THÊM MỚI
        
        // --- LOGIC ĐẶC BIỆT CHO NGÀY LÀM VIỆC ĐẶC BIỆT (Kiểm tra các trường hợp cần BỎ QUA hoặc GHI ĐÈ ĐẶC BIỆT) ---
        if (isSpecialWorkdaySubmission) {
            const isDefaultHoliday = isDateADefaultHoliday(singleDate, baseData.company, config);
            
            if (!isDefaultHoliday) {
                // 1. Trường hợp T2-T6 (Không phải Ngày nghỉ Mặc định)
                
                if (!existingDoc) {
                      // 1.1. T2-T6 KHÔNG TRÙNG & KHÔNG PHẢI NGÀY NGHỈ MẶC ĐỊNH: Bản ghi vô nghĩa
                      hideLoading();
                      
                      // ⭐️ SỬA LỖI: Dùng await Swal.fire() để chặn luồng và chờ người dùng nhấn OK ⭐️
                      // (Giả định bạn sử dụng SweetAlert2, thư viện được đề cập trong file HTML)
                      await Swal.fire({
                          icon: "info",
                          title: "Bản ghi dư!",
                          html: `Ngày (${singleDate}) là ngày làm việc bình thường nên KHÔNG cần bản ghi này.`,
                          confirmButtonText: "Đã hiểu",
                          allowOutsideClick: false,
                          allowEscapeKey: false,
                      });
                      
                      addLog("form2_special_workday_meaningless", { email: userEmail, company: baseData.company, date: singleDate });
                      skipped++;
                      continue; // 🛑 BỎ QUA NGÀY VÀ CHUYỂN SANG NGÀY TIẾP THEO
                      
                  } else if (!existingData.isSpecialWorkday) {
                    // 1.2. T2-T6 TRÙNG VỚI TB NGHỈ THỦ CÔNG: Yêu cầu ghi đè (Thay thế TB nghỉ)
                    hideLoading();
                    let isConfirmed = await showConfirmSwal(
                        "Xác nhận Ghi Đè Bản Ghi", // Tiêu đề (Bạn nên đặt)
                        `[THÔNG BÁO NGHỈ THỦ CÔNG] Ngày ${singleDate} của ${baseData.company} hiện đang là **Thông báo nghỉ** thủ công. Bạn có muốn GHI ĐÈ bằng **Thông báo hủy bỏ** không?`, // Nội dung động
                        "Có, Ghi đè", // Text nút Yes
                        "Không, Bỏ qua" // Text nút No
                    );

                    if (isConfirmed) {
                      showLoading("Đang ghi đè dữ liệu...");
                        try {
                            // Ghi chú mới: Thay thế TB nghỉ
                            newRecordData.ghi_chu = "Thay thế TB nghỉ.";
                            
                            // Xóa và dọn dẹp file cũ 
                            const fileIdToDelete = existingData.fileId; 
                            if (fileIdToDelete) {
                                const qRemaining = query(collection(db, collectionName), where("fileId", "==", fileIdToDelete), where("__name__", "!=", existingDoc.id));
                                const snapRemaining = await getDocs(qRemaining);
                                if (snapRemaining.empty) {
                                    await deleteFileFromDrive(fileIdToDelete).catch(e => console.warn(`[CleanUp Error] Lỗi xóa File ID: ${fileIdToDelete} khỏi Drive:`, e));
                                    addLog("drive_cleanup_success", { email: userEmail, fileId: fileIdToDelete, reason: "overwrite_manual_no_ref" });
                                } else {
                                    console.log(`[CleanUp] File ID: ${fileIdToDelete} vẫn còn ${snapRemaining.size} bản ghi tham chiếu.`);
                                }
                            }
                            
                            // Thực thi ghi đè
                            await deleteDoc(doc(db, collectionName, existingDoc.id));
                            await addReportDoc(newRecordData, collectionName);
                            
                            addLog("overwrite_manual_holiday_success", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, oldId: existingDoc.id, newType: submissionType });
                            addedCount++;
                        } catch (e) {
                            showSwal("error", `Lỗi ghi đè ngày ${singleDate}: ${e.message}`);
                            errorList.push(`Ngày ${singleDate} (Ghi đè T2-T6) - ${e.message}`);
                            addLog("overwrite_manual_holiday_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, error: e.message });
                        }
                    } else {
                        skipped++;
                        addLog("overwrite_manual_holiday_skipped", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, type: submissionType });
                    }
                    continue; // 🛑 CHUYỂN SANG NGÀY TIẾP THEO
                    
                } 
                // 1.3. T2-T6 TRÙNG VỚI NLĐB cũ: FALL THROUGH để xử lý ghi đè chung
                
            } else {
                // 2. Trường hợp T7/CN (Ngày nghỉ Mặc định)
                if (!existingDoc) {
                    // 2.1. T7/CN KHÔNG TRÙNG & KHÔNG CÓ BẢN GHI: Thêm mới (Ghi chú: Ngày làm đặc biệt)
                    newRecordData.ghi_chu = baseData.ghi_chu || "Ngày làm đặc biệt";
                    try {
                        await addReportDoc(newRecordData, collectionName);
                        addedCount++;
                    } catch (e) {
                        console.error(`Lỗi thêm mới ngày ${singleDate}:`, e);
                        errorList.push(`Ngày ${singleDate} (Thêm mới T7/CN) - ${e.message}`);
                        addLog("add_holiday_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, error: e.message });
                    }
                    continue; // 🛑 CHUYỂN SANG NGÀY TIẾP THEO
                } 
                // 2.2. T7/CN TRÙNG VỚI TB NGHỈ/NLĐB: FALL THROUGH để xử lý ghi đè chung
            }
        }
        // --- HẾT LOGIC ĐẶC BIỆT CHO NGÀY LÀM VIỆC ĐẶC BIỆT ---
        

        // --- LOGIC GHI ĐÈ CHUNG HOẶC THÊM MỚI NGÀY NGHỈ THƯỜNG ---
        
        if (existingDoc) {
            // PHÁT HIỆN TRÙNG -> Yêu cầu xác nhận ghi đè (Dùng cho các trường hợp NLĐB fall-through và Ngày nghỉ thường)
            
            // ⭐️ CẬP NHẬT GHI CHÚ THÔNG MINH CHO GHI ĐÈ NLĐB ⭐️
            if (isSpecialWorkdaySubmission) { 
                // Nếu là NLĐB (và đã fall-through)
                const existingType = existingData.isSpecialWorkday ? "Ngày làm ĐB cũ" : (isDateADefaultHoliday(singleDate, baseData.company, config) ? "Ngày nghỉ Mặc định" : "Ngày nghỉ Thủ công");
                const originalGhiChu = existingData.ghi_chu || 'Không có ghi chú cũ';
                const userGhiChu = baseData.ghi_chu || "Ngày làm đặc biệt";
                
                newRecordData.ghi_chu = `${userGhiChu}. Ghi đè lên: ${existingType}. (Ghi chú cũ: ${originalGhiChu})`;
                // Thuộc tính ngay_nghi đã được xóa ở 2b
            }

            hideLoading();
            let confirmationMessage;
            // Sử dụng hàm kiểm tra ngày nghỉ mặc định cho việc hiển thị loại cũ chính xác
            const existingTypeDisplay = existingData.isSpecialWorkday 
                ? "Ngày làm Đặc biệt" 
                : (isDateADefaultHoliday(singleDate, baseData.company, config) 
                    ? "Ngày nghỉ Mặc định" 
                    : "Ngày nghỉ Thủ công");
                    
            const submissionTypeDisplay = isSpecialWorkdaySubmission ? "Ngày làm Đặc biệt" : "Ngày nghỉ";
            
            confirmationMessage = `Ngày ${singleDate} của ${baseData.company} đã tồn tại (loại: ${existingTypeDisplay}). Bạn có muốn GHI ĐÈ bằng **${submissionTypeDisplay}** không?`;

            
            let isConfirmed = await showConfirmSwal(
                "Xác nhận Ghi Đè Bản Ghi",
                confirmationMessage, // Sử dụng biến message động của bạn
                "Có, Ghi đè",
                "Không, Bỏ qua"
            );
            
            if (isConfirmed) {
              showLoading("Đang ghi đè dữ liệu...");              
                // Ghi đè
              try {
                          const fileIdToDelete = existingData.fileId; 
                          
                          // ⭐️ BƯỚC 1: KIỂM TRA VÀ DỌN DẸP FILE ĐÍNH KÈM CŨ ⭐️
                          if (fileIdToDelete) {
                              
                              const qRemaining = query(
                                  collection(db, collectionName),
                                  where("fileId", "==", fileIdToDelete),
                                  where("__name__", "!=", existingDoc.id) 
                              );
                              const snapRemaining = await getDocs(qRemaining);

                              if (snapRemaining.empty) {
                                  try {
                                      await deleteFileFromDrive(fileIdToDelete); 
                                      addLog("drive_cleanup_success", { email: userEmail, fileId: fileIdToDelete, reason: "overwrite_no_ref" });
                                  } catch(e) {
                                      console.warn(`[CleanUp Error] Lỗi xóa File ID: ${fileIdToDelete} khỏi Drive:`, e);
                                      addLog("drive_cleanup_fail", { email: userEmail, fileId: fileIdToDelete, error: e.message, reason: "overwrite" });
                                  }
                              } else {
                                  console.log(`[CleanUp] File ID: ${fileIdToDelete} vẫn còn ${snapRemaining.size} bản ghi tham chiếu.`);
                              }
                          }
                          
                          // ⭐️ BƯỚC 2: THỰC THI GIAO DỊCH GHI ĐÈ BẢN GHI TRÊN FIRESTORE ⭐️
                          await deleteDoc(doc(db, collectionName, existingDoc.id));
                          await addReportDoc(newRecordData, collectionName);
                          
                          addLog("overwrite_success", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, oldId: existingDoc.id, newType: submissionTypeDisplay });

                          addedCount++;
                      } catch (e) {
                          showSwal("error", `Lỗi ghi đè ngày ${singleDate}: ${e.message}`);
                          errorList.push(`Ngày ${singleDate} (Ghi đè) - ${e.message}`);
                          addLog("overwrite_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, error: e.message });
                      }
            } else {
                // Bỏ qua bản ghi này
                skipped++;
                addLog("overwrite_skipped", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, type: submissionTypeDisplay });
            }
        } 
        
        // --- LOGIC THÊM MỚI NGÀY NGHỈ THƯỜNG ---
        else if (!isSpecialWorkdaySubmission) { 
            // KHÔNG TRÙNG VÀ LÀ NGÀY NGHỈ THƯỜNG -> Thêm mới
            try {
                await addReportDoc(newRecordData, collectionName); 
                addedCount++;
            } catch (e) {
                console.error(`Lỗi thêm mới ngày ${singleDate}:`, e);
                errorList.push(`Ngày ${singleDate} (Thêm mới) - ${e.message}`);
                addLog("add_holiday_error", { email: userEmail, collection: collectionName, company: baseData.company, date: singleDate, error: e.message });
            }
        }
        // --- HẾT LOGIC THÊM MỚI NGÀY NGHỈ THƯỜNG ---
    } // KẾT THÚC VÒNG LẶP


    // Thông báo kết quả TỔNG HỢP VÀ CHÍNH XÁC
    hideLoading();
    if (errorList.length > 0) {
      let errorMsg = `THẤT BẠI một phần: Đã gửi thành công ${addedCount} bản ghi, bỏ qua ${skipped} ngày (do trùng lặp hoặc vô nghĩa).`;
      errorMsg += "\n\n**Các lỗi xảy ra:**\n";
      errorList.forEach(err => errorMsg += `- ${err}\n`);

      showSwal("warning", "Gửi báo cáo hoàn tất (Có lỗi)", errorMsg);
      addLog("form2_submit_partial_error", { email: userEmail, company: baseData.company, added: addedCount, skipped: skipped, errors: errorList.length });

    } else if (addedCount > 0) {
        const successMsg = `HOÀN TẤT: Đã thêm/ghi đè thành công ${addedCount} ngày, bỏ qua ${skipped} ngày.`;
        showSwal("success", "Gửi báo cáo thành công!", successMsg);
        addLog("form2_submit_success", { email: userEmail, company: baseData.company, added: addedCount, skipped: skipped });

    } else if (skipped > 0) {
        showSwal("info", "Gửi báo cáo hoàn tất (Bị bỏ qua)", `Không có ngày nào được thêm mới. Đã bỏ qua ${skipped} ngày (do trùng lặp hoặc vô nghĩa).`);
        addLog("form2_submit_skipped_only", { email: userEmail, company: baseData.company, skipped: skipped });
    } else {
        showSwal("error", "Lỗi dữ liệu", "Không có ngày hợp lệ nào được tìm thấy để xử lý.");
        addLog("form2_submit_no_dates", { email: userEmail, company: baseData.company });
    }



      // reset form và thoát
      form.reset();

      form.ngay_nghi.value = "";
      form.ngay_lam_db.value = "";
      return; 
    }

    
    // --- BƯỚC 2: Xử lý Single-Date hoặc form khác (Chỉ áp dụng cho registrationForm_1) ---

if (formId === "registrationForm_1") {
    
    showLoading("Đang kiểm tra dữ liệu và trùng lặp...");
    
    // Lấy dữ liệu cần kiểm tra
    const { company, ngay_ghi, chi_so } = data;
    const newChiSo = parseFloat(chi_so);

// --- ⭐️ TỐI ƯU: KẾT HỢP 2 QUERY THÀNH 1 ---
const qSameDay = query(
  collection(db, collectionName),
  where("company", "==", company),
  where("ngay_ghi", "==", ngay_ghi)
);
const snapSameDay = await getDocs(qSameDay);

// ⭐️ TÌM EXACT MATCH TRONG MEMORY (Không query thêm)
const exactMatchDoc = snapSameDay.docs.find(
  doc => parseFloat(doc.data().chi_so) === newChiSo
);

if (!snapSameDay.empty) {
  let existingDoc = snapSameDay.docs[0];
  if (snapSameDay.size > 1) {
    existingDoc = snapSameDay.docs.reduce((a, b) => {
      const aTime = a.data().createdAt?.toMillis?.() || 0;
      const bTime = b.data().createdAt?.toMillis?.() || 0;
      return bTime > aTime ? b : a;
    });
  }
  const existingData = existingDoc.data();
  const existingChi = parseFloat(existingData.chi_so);

  if (!isNaN(existingChi) && !isNaN(newChiSo) && newChiSo < existingChi) {
    const alreadyReset = snapSameDay.docs.some(d => d.data().isMeterReset === true);
    hideLoading();

    const swalResult = await Swal.fire({
      icon: 'warning',
      title: 'Chỉ số mới nhỏ hơn bản ghi cùng ngày',
      html: `
        <p>Chỉ số cũ: <b>${existingChi.toLocaleString('vi-VN')}</b>&emsp;&emsp;Chỉ số mới: <b>${newChiSo.toLocaleString('vi-VN')}</b></p>
        <label style="display:flex;align-items:center;margin-top:10px;">
          <input id="swal-checkbox-reset" type="checkbox" style="margin-right:8px;">
          Tôi xác nhận đây là trường hợp Reset (thay đồng hồ)
        </label>
        <input id="swal-input-reason" class="swal2-input" placeholder="Lý do (bắt buộc)">
      `,
      showCancelButton: true,
      showDenyButton: !alreadyReset,
      confirmButtonText: alreadyReset
          ? 'Cập nhật bản reset hiện có'
          : 'Ghi đè bản ghi cùng ngày',
      denyButtonText: 'Thêm bản ghi mới',
      cancelButtonText: 'Hủy',
      preConfirm: () => {
        const cb = document.getElementById('swal-checkbox-reset').checked;
        const reason = document.getElementById('swal-input-reason').value.trim();
        if (!cb) { Swal.showValidationMessage('Bạn phải tích xác nhận.'); return false; }
        if (!reason) { Swal.showValidationMessage('Bạn phải nhập lý do.'); return false; }
        return { reason, action: 'overwrite' };
      },
      preDeny: () => {
        const cb = document.getElementById('swal-checkbox-reset').checked;
        const reason = document.getElementById('swal-input-reason').value.trim();
        if (!cb) { Swal.showValidationMessage('Bạn phải tích xác nhận.'); return false; }
        if (!reason) { Swal.showValidationMessage('Bạn phải nhập lý do.'); return false; }
        return { reason, action: 'append' };
      }
    });

    if (swalResult.isDismissed) {
      hideLoading();
      showSwal("info", "Đã hủy gửi báo cáo.");
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("meter_reset_canceled_sameday", { email: userEmail, company, ngay_ghi, newChiSo, reason: "dismissed" });
      return;
    }

    const reason = swalResult.value?.reason || "";

    // --- Người dùng chọn GHI ĐÈ ---
    if (swalResult.isConfirmed) {
      try {
        let fileUrl = existingData.fileUrl || "";
        let fileId = existingData.fileId || "";

        if (file) {
          const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
          // xóa file cũ nếu không còn tham chiếu
          if (existingData.fileId && existingData.fileId !== uploaded.id) {
            const qRemaining = query(
              collection(db, collectionName),
              where("fileId", "==", existingData.fileId),
              where("__name__", "!=", existingDoc.id)
            );
            const snapRemaining = await getDocs(qRemaining);
            if (snapRemaining.empty) {
              await deleteFileFromDrive(existingData.fileId).catch(err => {
                console.warn("Không thể xóa file cũ:", err);
                // ⭐️ BỔ SUNG LOG ⭐️
                addLog("drive_cleanup_fail", { email: userEmail, fileId: existingData.fileId, error: err.message, reason: "sameday_overwrite" });
              });
            }
          }
          fileUrl = uploaded.url;
          fileId = uploaded.id;
        }

        const updatedRecord = {
          ...existingData,
          ...data,
          chi_so: newChiSo,
          fileUrl,
          fileId,
          isMeterReset: true,
          ghi_chu: (existingData.ghi_chu ? existingData.ghi_chu + " | " : "") + `[CS GIẢM ĐẶC BIỆT CÙNG NGÀY: ${reason}]`,
          updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, collectionName, existingDoc.id), updatedRecord, { merge: true });
        // Log cũ đã có: addLog("updateReport", { id: existingDoc.id, collection: collectionName, reason, newChiSo });

        hideLoading();
        showSwal("success", "Đã ghi đè bản ghi reset.");
        form.reset();
        return;
      } catch (e) {
        console.error("Lỗi khi ghi đè cùng ngày:", e);
        hideLoading();
        showSwal("error", "Lỗi ghi đè: " + e.message);
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("overwrite_sameday_error", { email: userEmail, collection: collectionName, company, ngay_ghi, error: e.message });
        return;
      }
    }

    // --- Người dùng chọn THÊM MỚI ---
    if (swalResult.isDenied) {
      try {
        if (file) {
          const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
          data.fileUrl = uploaded.url;
          data.fileId = uploaded.id;
        } else {
          data.fileUrl = "";
          data.fileId = "";
        }

        data.isMeterReset = true;
        data.ghi_chu = (data.ghi_chu ? data.ghi_chu + " | " : "") + `[CS GIẢM ĐẶC BIỆT CÙNG NGÀY (THÊM MỚI): ${reason}]`;

        // Sẽ gọi addDoc_success trong addReportDoc
        await addReportDoc(data, collectionName);
        // Log cũ đã có: addLog("addReport (special)", { collection: collectionName, reason, newChiSo });

        hideLoading();
        showSwal("success", "Đã thêm bản ghi reset mới.");
        form.reset();
        return;
      } catch (e) {
        console.error("Lỗi khi thêm mới cùng ngày:", e);
        hideLoading();
        showSwal("error", "Lỗi thêm báo cáo: " + e.message);
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("add_sameday_error", { email: userEmail, collection: collectionName, company, ngay_ghi, error: e.message });
        return;
      }
    }
  } // end if new<existing
} // end if same-day exists

    
    // ===============================================
    // 1. ⭐️ KIỂM TRA TRÙNG LẶP (SỬ DỤNG KẾT QUẢ ĐÃ TÌM TRƯỚC ĐÓ)
    // ===============================================
if (exactMatchDoc) {
  const exactDoc = exactMatchDoc;
  const exactData = exactDoc.data();  // Trường hợp 1: Cũ KHÔNG có file
  if (!exactData.fileUrl) {
    if (!file) {
      // Bản mới cũng không có file → coi là trùng, bỏ qua
      hideLoading();
      showSwal("info", "Bản ghi đã tồn tại, không cần gửi lại.");
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("report_skipped_exact_match", { email: userEmail, collection: collectionName, company, ngay_ghi, chi_so: newChiSo, reason: "No file & exact match" });
      return;
    } else {
      // Bản mới có file → cập nhật (ghi đè)
      const uploaded = await uploadFileToDrive(file, company, folderId, formId, data);
      const updatedRecord = {
        ...exactData,
        ...data,
        chi_so: newChiSo,
        fileUrl: uploaded.url,
        fileId: uploaded.id,
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, collectionName, exactDoc.id), updatedRecord, { merge: true });
      await addLog("updateFile", { id: exactDoc.id, collection: collectionName, newFile: uploaded.id });
      hideLoading();
      showSwal("success", "Đã cập nhật file cho bản ghi.");
      form.reset();
      return;
    }
  }

  // Trường hợp 2: Cũ CÓ file
  else {
    if (!file) {
      // Bản mới không có file → trùng hoàn toàn, bỏ qua
      hideLoading();
      showSwal("info", "Bản ghi đã tồn tại, không cần gửi lại.");
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("report_skipped_exact_match", { email: userEmail, collection: collectionName, company, ngay_ghi, chi_so: newChiSo, reason: "File exists & exact match" });
      return;
    } else {
      // Bản mới có file → hỏi xác nhận
      hideLoading(); // Ẩn loading trước khi hỏi
      const result = await Swal.fire({
        icon: "question",
        title: "Bản ghi đã tồn tại kèm file",
        text: "Bạn có muốn thay thế file cũ bằng file mới không?",
        showCancelButton: true,
        confirmButtonText: "Có, thay thế",
        cancelButtonText: "Không"
      });
      showLoading("Đang xử lý báo cáo..."); // Hiện loading lại

      if (result.isConfirmed) {
        const uploaded = await uploadFileToDrive(file, company, folderId, formId, data);

        // Nếu file cũ còn → xóa nếu không ai dùng
        if (exactData.fileId) {
          const qRemaining = query(
            collection(db, collectionName),
            where("fileId", "==", exactData.fileId),
            where("__name__", "!=", exactDoc.id)
          );
          const snapRemaining = await getDocs(qRemaining);
          if (snapRemaining.empty) {
            await deleteFileFromDrive(exactData.fileId).catch(err => {
              console.warn("Không thể xóa file cũ:", err);
              // ⭐️ BỔ SUNG LOG ⭐️
              addLog("drive_cleanup_fail", { email: userEmail, fileId: exactData.fileId, error: err.message, reason: "exact_match_replace" });
            });
          }
        }

        const updatedRecord = {
          ...exactData,
          ...data,
          chi_so: newChiSo,
          fileUrl: uploaded.url,
          fileId: uploaded.id,
          updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, collectionName, exactDoc.id), updatedRecord, { merge: true });
        await addLog("updateFile", { id: exactDoc.id, collection: collectionName, newFile: uploaded.id, oldFile: exactData.fileId, action: "replace" });
        hideLoading();
        showSwal("success", "Đã thay thế file cho bản ghi.");
        form.reset();
        return;
      } else {
        hideLoading();
        showSwal("info", "Đã hủy gửi báo cáo.");
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("form_submit_canceled", { email: userEmail, formId, reason: "File replace confirmation" });
        return;
      }
    }
  }
}

    
    // ===============================================
    // 2. KIỂM TRA CHỈ SỐ GIẢM (VÀ XÁC NHẬN BẮT BUỘC) - VỚI BẢN GHI TRƯỚC ĐÓ
    // ===============================================

    // Chỉ kiểm tra nếu chi_so là số hợp lệ
    if (!isNaN(newChiSo)) {
        
        // Lấy bản ghi mới nhất của công ty này TRƯỚC ngày hiện tại (hoặc cùng ngày nhưng tạo sớm hơn)
        const qLatest = query(
            collection(db, collectionName),
            where("company", "==", company),
            // Sẽ cần logic phức tạp hơn để so sánh ngày và giờ tạo.
            // Để đơn giản, ta chỉ lấy bản ghi mới nhất theo ngày ghi
            where("ngay_ghi", "<=", ngay_ghi), // So sánh theo chuỗi YYYY-MM-DD
            orderBy("ngay_ghi", "desc"),
            orderBy("createdAt", "desc"), 
            limit(1)
        );
        
        const snapLatest = await getDocs(qLatest);
        const latestDoc = snapLatest.docs[0];

        if (!snapLatest.empty && (latestDoc.data().ngay_ghi !== ngay_ghi)) { // Loại trừ trường hợp trùng ngày (đã xử lý ở trên)
            const latestData = latestDoc.data();
            const latestChiSo = parseFloat(latestData.chi_so);

            if (!isNaN(latestChiSo) && newChiSo < latestChiSo) {
                hideLoading();

                const result = await Swal.fire({
                    icon: 'error', 
                    title: '❌ DỮ LIỆU ĐẶC BIỆT: Chỉ Số Đang Giảm!',
                    html: `
                        <p style="text-align: center; color: #cc0000; font-weight: bold; font-size: 1.1em; margin-bottom: 10px;">
                            Chỉ số mới (${newChiSo}) < Chỉ số trước đó (${latestChiSo} ngày ${latestData.ngay_ghi}).
                        </p>
                        <p style="text-align: left; margin-bottom: 15px;">
                            Điều này chỉ xảy ra khi **đồng hồ bị thay thế/reset**. Vui lòng **xác nhận** và **ghi rõ lý do** để hệ thống thống kê chính xác.
                        </p>
                        <div style="border: 2px solid #ff4d4d; padding: 12px; margin-top: 15px; background-color: #ffe6e6; border-radius: 8px;">
                            <label for="swal-checkbox-reset" style="font-weight: bold; color: #a30000; display: flex; align-items: center; cursor: pointer;">
                                <input type="checkbox" id="swal-checkbox-reset" style="margin-right: 10px; width: 20px; height: 20px; min-width: 20px;">
                                <span>TÔI XÁC NHẬN đây là trường hợp đặc biệt và đồng ý lưu.</span>
                            </label>
                        </div>
                        <input id="swal-input-reason" class="swal2-input" placeholder="Lý do chi tiết (BẮT BUỘC)" style="margin-top: 20px;">
                    `,
                    focusConfirm: false,
                    showCancelButton: true,
                    confirmButtonText: '✅ Gửi Dữ Liệu Đặc Biệt',
                    cancelButtonText: '❌ Hủy & Quay Lại Sửa',
                    allowOutsideClick: false, 
                    allowEscapeKey: false,
                    
                    preConfirm: () => {
                        const checkbox = document.getElementById('swal-checkbox-reset');
                        const reason = document.getElementById('swal-input-reason').value.trim();

                        if (!checkbox.checked) {
                            Swal.showValidationMessage('Bạn PHẢI xác nhận bằng cách chọn hộp kiểm.');
                            return false;
                        }
                        if (!reason) {
                            Swal.showValidationMessage('Lý do là BẮT BUỘC để gửi dữ liệu đặc biệt này.');
                            return false;
                        }
                        return { reason: reason };
                    }
                });

                if (result.isConfirmed) {
                    // Người dùng đã xác nhận
                    data.isMeterReset = true; // Thêm cờ đặc biệt
                    
                    // Cập nhật trường ghi chú
                    data.ghi_chu = (data.ghi_chu ? data.ghi_chu + " | " : "") + `[CS GIẢM ĐẶC BIỆT: ${result.value.reason}]`; 
                    
                    showSwal("warning", "Đã xác nhận gửi chỉ số thấp kèm lý do. Đang xử lý...");
                    showLoading("Đang xử lý báo cáo đặc biệt..."); 
                    // ⭐️ BỔ SUNG LOG ⭐️
                    addLog("meter_reset_confirmed", { email: userEmail, company, ngay_ghi, newChiSo, oldChiSo: latestChiSo, reason: result.value.reason });

                } else {
                    // Người dùng nhấn Hủy Bỏ
                    showSwal("info", "Đã hủy gửi báo cáo. Vui lòng kiểm tra lại chỉ số.");
                    form.reset();
                    // ⭐️ BỔ SUNG LOG ⭐️
                    addLog("meter_reset_canceled", { email: userEmail, company, ngay_ghi, newChiSo, oldChiSo: latestChiSo });
                    return; 
                }
            }
        }
    }

    // ===============================================
    // 3. ⭐️ KIỂM TRA TRÙNG 2 TRƯỜNG (SỬ DỤNG snapSameDay ĐÃ CÓ)
    // ===============================================
    if (snapSameDay.docs.length > 0) {
        hideLoading();
        // Trùng 2 thông tin -> Hiện Confirm Ghi thêm
        let isConfirmed = await showConfirmSwal(
            "Dữ liệu đã tồn tại", // Tiêu đề Swal.fire (nên có)
            `Ngày ${ngay_ghi} của ${company} đã có báo cáo. Bạn muốn GHI THÊM DỮ LIỆU MỚI (${chi_so}) cùng ngày không?`,
            "OK",           // Thay thế 'Có' bằng 'OK'
            "Hủy bỏ",       // Thay thế 'Không' bằng 'Hủy bỏ'
            "info"          // Sử dụng icon info vì đây là hành động ghi thêm, không phải lỗi
        );

        if (!isConfirmed) {
            showSwal("info", "Đã hủy gửi báo cáo.");
            form.reset();
            // ⭐️ BỔ SUNG LOG ⭐️
            addLog("form_submit_canceled", { email: userEmail, formId, reason: "Duplicate date confirmation" });
            return; 
        }
        showLoading("Đang xử lý báo cáo..."); 
        // ⭐️ BỔ SUNG LOG ⭐️
        addLog("duplicate_date_accepted", { email: userEmail, company, ngay_ghi, newChiSo });
    }
    


    // ===============================================
    // 4. LƯU TRỮ DỮ LIỆU SAU KHI VƯỢT QUA CÁC BƯỚC KIỂM TRA
    // ===============================================

    let fileUrl = "";
    let fileId = "";

    if (file) {
        const uploaded = await uploadFileToDrive(file, data.company || "NoCompany", folderId, formId, data);
        fileUrl = uploaded.url;
        fileId = uploaded.id;
    }
    
    // Cập nhật lại data với thông tin file trước khi lưu
    data.fileUrl = fileUrl;
    data.fileId = fileId;
    
    // LƯU VÀO FIRESTORE (data đã có isMeterReset: true nếu chỉ số giảm)
    // Sẽ gọi addDoc_success trong addReportDoc
    const docRef = await addReportDoc(data, collectionName); 

    showSwal("success", "Thành công", "Báo cáo đã được gửi!");
    form.reset();
}

// ... (các khối xử lý form khác và khối finally) ...
  } catch (err) {
    // Bắt các lỗi cấp cao (lỗi đăng nhập, lỗi upload file Drive, lỗi Form 1)
    console.error(`❌ Lỗi khi submit ${formId}:`, err);
    showSwal("error", "Thất bại", err.message);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("form_submit_fatal_error", { email: userEmail, formId, error: err.message, collection: collectionName });
    hideLoading(); 
  } finally {
    hideLoading(); 
  }

}

//
export function listenReports(collectionName, callback) {
  // ⭐️ GIỚI HẠN CHỈ 50 BẢN GHI MỚI NHẤT để giảm chi phí đọc
  const q = query(
    collection(db, collectionName), 
    orderBy("createdAt", "desc"),
    limit(50) // ← Thêm giới hạn
  );
  return onSnapshot(q, (snapshot) => {
    const reports = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(reports);
  });
}
//
/**
 * (HÀM MỚI) Tải báo cáo trong một khoảng ngày cụ thể.
 * Hàm này không lắng nghe real-time, chỉ tải 1 lần (getDocs).
 * @param {string} collectionName - Tên collection (vd: "reports_1")
 * @param {string} dateField - Tên trường chứa ngày (vd: "ngay_ghi")
 * @param {string} startDate - Ngày bắt đầu (YYYY-MM-DD)
 * @param {string} endDate - Ngày kết thúc (YYYY-MM-DD)
 * @returns {Promise<Array>} Mảng các báo cáo
 */
export async function getReportsByDate(collectionName, dateField, startDate, endDate, limitCount = null) {
  // Validate đầu vào
  if (!collectionName || !dateField || !startDate || !endDate) {
    showSwal("error", "Lỗi truy vấn", "Thiếu thông tin để tải dữ liệu.");
    return [];
  }

  showLoading("Đang tải dữ liệu theo ngày...");
  try {
    // ⭐️ Thêm limit nếu có
    let q = query(
      collection(db, collectionName),
      where(dateField, ">=", startDate),
      where(dateField, "<=", endDate),
      orderBy(dateField, "desc") // Sắp xếp theo ngày (mới nhất trước)
    );
    
    if (limitCount && limitCount !== "all") {
      q = query(q, limit(parseInt(limitCount)));
    }
    
    const snapshot = await getDocs(q);
    const reports = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    
    hideLoading();
    return reports; // Trả về mảng dữ liệu đã lọc

  } catch (err) {
    console.error("Lỗi getReportsByDate:", err);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("getReportsByDate_failure", { 
        collection: collectionName, 
        error: err.message, 
        startDate, 
        endDate,
        limit: limitCount 
    });
    hideLoading();
    showSwal("error", "Lỗi tải dữ liệu", err.message);
    return []; // Trả về mảng rỗng nếu lỗi
  }
}
//
// Dùng riêng cho Master List (không orderBy createdAt) - ⭐️ GIỚI HẠN 50
export function listenCollection(collectionName, callback) {
  const q = query(collection(db, collectionName), limit(50));
  return onSnapshot(q, (snapshot) => {
    const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(docs);
  });
}

// Sửa đổi hàm deleteReport để xóa cả file và bản ghi
export async function deleteReport(collectionName, id) {
  const docRef = doc(db, collectionName, id);
  const user = auth.currentUser;
  const userEmail = user?.email || "unknown";

  try {
    // Bước 1: Lấy bản ghi từ Firestore trước khi xóa
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      // ⭐️ BỔ SUNG LOG ⭐️
      addLog("deleteReport_not_found", { id, collection: collectionName, email: userEmail });
      throw new Error("Không tìm thấy bản ghi để xóa.");
    }
    const reportData = docSnap.data();

    // Bước 2: Ghi log chi tiết bản ghi trước khi xóa (Log cũ đã có)
    await addLog("deleteReport", {
      ...reportData, 
      id,
      collection: collectionName,
      email: userEmail
    });
    
    // Bước 3: Nếu có file đính kèm, gọi hàm xóa file từ Google Drive
    const fileId = reportData.fileId;
    if (fileId) {
        // Cần kiểm tra xem còn bản ghi nào khác tham chiếu đến file này không
        const qRemaining = query(
            collection(db, collectionName),
            where("fileId", "==", fileId),
            where("__name__", "!=", id),
            limit(1)
        );
        const snapRemaining = await getDocs(qRemaining);

        if (snapRemaining.empty) {
            // Chỉ xóa file nếu không còn bản ghi nào khác tham chiếu
            try {
                await deleteFileFromDrive(fileId);
                // log drive_delete_success sẽ được gọi bên trong deleteFileFromDrive
            } catch(e) {
                 // log drive_delete_failure sẽ được gọi bên trong deleteFileFromDrive
                 console.warn(`[Drive Delete Error] Không thể xóa file ${fileId} khi xóa báo cáo ${id}:`, e);
            }
        } else {
             // ⭐️ BỔ SUNG LOG ⭐️
             addLog("deleteReport_file_skipped", { id, collection: collectionName, fileId, remainingRefs: snapRemaining.size });
        }
    }

    // Bước 4: Xóa bản ghi khỏi Firestore
    await deleteDoc(docRef);

  } catch (err) {
    console.error("Lỗi khi xóa báo cáo:", err);
    // ⭐️ BỔ SUNG LOG ⭐️
    addLog("deleteReport_failure", { id, collection: collectionName, email: userEmail, error: err.message });
    throw err;
  }
}

// Thêm vào cuối file, trước các hàm showSwal/showConfirm
/**
 * Kiểm tra xem một ngày (YYYY-MM-DD) có phải là ngày nghỉ mặc định (T7, CN) hay không.
 * @param {string} isoDate - Ngày theo định dạng ISO (YYYY-MM-DD).
 * @param {string} company - Tên công ty (chưa dùng nhưng giữ lại để mở rộng).
 * @param {object} config - Cấu hình hệ thống (chứa quy tắc nghỉ cuối tuần).
 * @returns {boolean} True nếu là ngày nghỉ mặc định.
 */
export function isDateADefaultHoliday(isoDate, company, config) {
    if (!isoDate) return false;

    // Lấy ngày trong tuần: 0=CN, 1=T2, ..., 6=T7
    const date = new Date(isoDate);
    const dayOfWeek = date.getDay(); 

    // Kiểm tra cấu hình nghỉ T7/CN của công ty
    const defaultHolidaySetting = config?.defaultHolidays?.[company];
    
    if (defaultHolidaySetting === 'sat_sun' || defaultHolidaySetting === undefined) {
        // Mặc định: nghỉ T7 & CN
        return dayOfWeek === 0 || dayOfWeek === 6; 
    } else if (defaultHolidaySetting === 'sun_only') {
        // Chỉ nghỉ CN
        return dayOfWeek === 0; 
    }
    // Nếu là 'none' hoặc các trường hợp khác (T2-T6)
    return false;
}
// Hiện modal loading
export function showLoading(msg = "Đang xử lý, vui lòng chờ...") {
  const modal = document.getElementById("loadingModal");
  if (modal) {
    modal.style.display = "flex";
    modal.querySelector("p").textContent = msg;
  }
}

// Ẩn modal loading
export function hideLoading() {
  const modal = document.getElementById("loadingModal");
  if (modal) {
    modal.style.display = "none";
  }
}

// Alert thông báo (Giữ nguyên)
let alertTimeout;

export function showAlert(type, title, message) {
  const modal = document.getElementById("alertModal");
  const alertTitle = document.getElementById("alertTitle");
  const alertMessage = document.getElementById("alertMessage");
  const okBtn = document.getElementById("alertOkBtn");

  if (!modal) return;

  alertTitle.textContent = title;
  alertMessage.textContent = message;

  modal.querySelector(".alert-box").classList.remove("alert-success", "alert-error");
  modal.querySelector(".alert-box").classList.add(type === "success" ? "alert-success" : "alert-error");

  modal.style.display = "flex";

  okBtn.onclick = () => hideAlert();

  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    hideAlert();
  }, 5000);
}

// Ẩn alert
export function hideAlert() {
  const modal = document.getElementById("alertModal");
  if (modal) {
    modal.style.display = "none";
  }
}

//SweetAlert2 (Giữ nguyên)

export function showSwal(type, title, options = {}) { // Đổi 'message' thành 'title'
  window.Swal.fire({
    toast: true,
    position: options.position || 'top-end',
    icon: type,
    title: title, // Dùng title (Tiêu đề)
    
    html: options.html || null, 

    width: options.width || '400px',
    showConfirmButton: options.showConfirmButton || false,
    timer: options.timer || 2500, // Tăng mặc định lên 2,5 giây
    timerProgressBar: true,    
    showClass: { popup: '' }
  });
}
//Confirm SweetAlert2.
/**
 * Hiển thị hộp thoại xác nhận (Có/Không) bằng SweetAlert2.
 * @param {string} title - Tiêu đề của hộp thoại (nên đặt).
 * @param {string} htmlMessage - Nội dung thông báo (có thể chứa HTML).
 * @param {string} confirmText - Văn bản cho nút Đồng ý/Xác nhận (mặc định là 'Có').
 * @param {string} cancelText - Văn bản cho nút Hủy (mặc định là 'Không').
 * @param {string} [icon='warning'] - Icon hiển thị (warning, info, question, error, success).
 * @returns {Promise<boolean>} Trả về true nếu người dùng nhấn nút xác nhận (confirm).
 */
export async function showConfirmSwal(
    title, 
    htmlMessage, 
    confirmText = 'Có', 
    cancelText = 'Không',
    icon = 'warning' 
) {
    const result = await Swal.fire({
        title: title,
        html: htmlMessage,
        icon: icon,
        showCancelButton: true, // Hiển thị nút Hủy
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: confirmText, // Tên nút Đồng ý tùy chỉnh
        cancelButtonText: cancelText,   // Tên nút Hủy tùy chỉnh
        allowOutsideClick: false,
        allowEscapeKey: false,
    });
    
    return result.isConfirmed; // Trả về true nếu nút confirm (OK/Có) được nhấn
}


//
// ===================================================================
// 🔹 Các hàm hỗ trợ riêng cho trang sắp lịch.html (có thể thêm ở cuối file)
// ===================================================================

/**
 * Đọc cấu hình tuần từ Firestore tại đường dẫn "config/reportConfig"
 * Trả về dữ liệu gốc (object chứa weekDayStart, yearDayStart, v.v.)
 */
export async function fetchWeekConfig() {
  try {
    console.log("📡 Đang đọc config/reportConfig ...");
    const docRef = doc(db, "config", "reportConfig");
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log("✅ Cấu hình reportConfig đã đọc:", data);
      return data;
    } else {
      console.warn("⚠️ Không tìm thấy document config/reportConfig, dùng mặc định.");
      return { weekDayStart: 1 }; // Thứ 2 mặc định
    }
  } catch (error) {
    console.error("❌ Lỗi khi đọc reportConfig:", error);
    return { weekDayStart: 1 }; // fallback an toàn
  }
}

/**
 * Đọc giá trị weekDayStart và trả về số (0=CN, 1=T2, ..., 6=T7)
 */
export async function getWeekDayStart() {
  const config = await fetchWeekConfig();
  const value = parseInt(config?.weekDayStart);

  if (!isNaN(value) && value >= 0 && value <= 6) {
    console.log(`🗓️ weekDayStart = ${value} (0=CN, 1=T2...)`);
    return value;
  } else {
    console.warn("⚠️ Giá trị weekDayStart không hợp lệ, dùng mặc định (1)");
    return 1;
  }
}

/**
 * Xuất: Lưu quy tắc công việc mới vào Firestore.
 * @param {object} ruleData - Dữ liệu quy tắc (ruleType, value, jobName).
 * @param {string} userEmail - Email người dùng thực hiện hành động.
 */
export async function saveRule(ruleData) {
  const user = auth.currentUser;
  if (!user || !user.email) { showSwal("error","Vui lòng đăng nhập."); return; }

  const { content, dayOfWeek, dayOfMonth } = ruleData;

  const safeDayOfWeek = (dayOfWeek !== "" && !Number.isNaN(parseInt(dayOfWeek,10)))
                        ? parseInt(dayOfWeek,10) : null;
  const safeDayOfMonth = (dayOfMonth !== "" && !Number.isNaN(parseInt(dayOfMonth,10)))
                        ? parseInt(dayOfMonth,10) : null;

  await addDoc(collection(db, "job"), {
    content,
    dayOfWeek: safeDayOfWeek,
    dayOfMonth: safeDayOfMonth,
    createdBy: user.email,
    createdAt: serverTimestamp()
  });
}

/**
 * Xuất: Lấy danh sách tất cả người dùng từ collection 'users'.
 */
export async function fetchAllUsers() { // <<< Bắt buộc phải có 'export'
    try {
        const usersCol = collection(db, "users");
        const userSnapshot = await getDocs(usersCol);
        const userList = userSnapshot.docs.map(doc => ({
            id: doc.id,
            email: doc.id, // Giả định email là document ID
            ...doc.data()
        }));
        console.log("✅ Đã tải danh sách người dùng:", userList);
        return userList;
    } catch (error) {
        console.error("❌ Lỗi khi tải danh sách người dùng:", error);
        // Trả về mảng rỗng thay vì ném lỗi để không làm sập giao diện
        return []; 
    }
}

/**
 * Xuất: Thiết lập Listener thời gian thực (onSnapshot) cho một collection.
 * * @param {string} collectionName - Tên collection (ví dụ: "job").
 * @param {function} callback - Hàm sẽ được gọi mỗi khi dữ liệu thay đổi.
 * @returns {function} Hàm unsubscribe để ngừng lắng nghe.
 */
export function listenJobData(collectionName, callback) { 
    // Bắt buộc phải có 'export'
    
    // Lấy tham chiếu đến collection
    const colRef = collection(db, collectionName);

    // Tạo query: Lấy tất cả document, sắp xếp theo thời gian tạo (giả định có trường 'createdAt')
    // Nếu bạn không cần sắp xếp, bạn có thể chỉ dùng: const q = colRef;
    const q = query(colRef, orderBy("createdAt", "desc")); 

    // Thiết lập listener thời gian thực
    const unsubscribe = onSnapshot(q, (snapshot) => {
        // Ánh xạ (map) các document thành một mảng đối tượng JavaScript
        const documents = snapshot.docs.map(doc => ({
            id: doc.id, // Giữ lại ID của document
            ...doc.data()
        }));
        
        console.log(`✅ ${documents.length} document đã tải từ ${collectionName} (Real-time).`);
        
        // Gọi lại (callback) hàm trong h.html với dữ liệu đã tải
        callback(documents);
        
    }, (error) => {
        console.error(`❌ Lỗi khi lắng nghe collection ${collectionName}:`, error);
        // Có thể thêm logic xử lý lỗi khác ở đây
    });

    return unsubscribe; // Rất quan trọng, cho phép ngắt kết nối khi cần
}

//
// 🟠 Xóa quy tắc công việc
export async function deleteRule(id) {
  const docRef = doc(db, "job", id);
  await deleteDoc(docRef);
  console.log("Đã xóa rule:", id);
}

//
export async function getAllRules() {
  const rules = [];
  try {
    const snapshot = await getDocs(collection(db, "job"));
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      rules.push({
        id: docSnap.id,
        content: data.content || "",
        dayOfWeek: data.dayOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        createdBy: data.createdBy || "",
        createdAt: data.createdAt || null
      });
    });
    return rules;
  } catch (err) {
    console.error("Lỗi getAllRules:", err);
    return [];
  }
}

//
export function listenRulesRealtime(callback) {
  const q = query(collection(db, "job"), orderBy("createdAt", "desc"));
  let firstSnapshotLoaded = false;

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const rules = snapshot.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        content: data.content || "",
        dayOfWeek: data.dayOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        createdBy: data.createdBy || "",
        createdAt: data.createdAt || null,
      };
    });

    // tránh ghi đè khi snapshot đầu tiên rỗng
    if (!firstSnapshotLoaded && rules.length === 0) {
      console.log("[listenRulesRealtime] Bỏ qua snapshot trống đầu tiên");
      firstSnapshotLoaded = true;
      return;
    }

    firstSnapshotLoaded = true;
    console.log("[listenRulesRealtime] cập nhật", rules.length, "quy tắc");
    callback(rules);
  });

  // Hàm này trả về một hàm để hủy lắng nghe khi cần
  return unsubscribe;
}

// Trong file script.js
export function getCurrentUserEmail() {
  return auth.currentUser?.email || "unknown_user";
}
// Export thêm các hàm Firestore cần thiết cho chatbot
export { query, orderBy, limit, where, getDocs, collection };
