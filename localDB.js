// localDB.js
const DB_NAME = 'KCN_LocalDB';
const DB_VERSION = 3; // Tăng phiên bản để cập nhật cấu trúc DB

// Khởi tạo DB
export function initLocalDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('logs')) {
                db.createObjectStore('logs', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('sync_info')) {
                db.createObjectStore('sync_info', { keyPath: 'collection' });
            }
            if (!db.objectStoreNames.contains('reports_1')) {
                db.createObjectStore('reports_1', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('reports_2')) {
                db.createObjectStore('reports_2', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('shift_reports')) {
                db.createObjectStore('shift_reports', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function saveToLocalDB(storeName, dataArray) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        dataArray.forEach(item => store.put(item));
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}

export async function getAllFromLocalDB(storeName) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function setLastSyncTime(collectionName, timestamp) {
    await saveToLocalDB('sync_info', [{ collection: collectionName, lastSync: timestamp }]);
}

export async function getLastSyncTime(collectionName) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('sync_info', 'readonly');
        const store = transaction.objectStore('sync_info');
        const request = store.get(collectionName);
        request.onsuccess = () => resolve(request.result ? request.result.lastSync : 0);
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function deleteFromLocalDB(storeName, idsArray) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
        if (!idsArray || idsArray.length === 0) return resolve();
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        idsArray.forEach(id => store.delete(id));
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}