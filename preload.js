// 引入 Electron 的 contextBridge 和 ipcRenderer 模組
const { contextBridge, ipcRenderer } = require('electron');

// 使用 contextBridge 在主世界(Main World, 即渲染程序的 window 物件)中暴露一個名為 'electronAPI' 的全域物件
// 這樣做可以確保即使在啟用上下文隔離的情況下，渲染程序也能安全地與主程序通訊
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 發送儲存單張圖片的請求到主程序
   * @param {object} data - 包含 base64 影像數據的對象
   */
  saveImage: (data) => ipcRenderer.send('save-image', data),

  // --- 批次處理相關 API ---

  /**
   * 發送打開資料夾選擇對話方塊的請求到主程序
   */
  openFolderDialog: () => ipcRenderer.send('open-folder-dialog'),

  /**
   * 發送儲存批次處理中單張圖片的請求到主程序
   * @param {object} data - 包含 base64 影像數據和原始路徑的對象
   */
  saveBatchImage: (data) => ipcRenderer.send('save-batch-image', data),

  /**
   * 監聽從主程序傳來的 'folder-selected' 事件
   * @param {function} callback - 當主程序傳回選中的檔案路徑時執行的回呼函式
   */
  onFolderSelected: (callback) => ipcRenderer.on('folder-selected', (event, files) => callback(files)),

  /**
   * 監聽從主程序傳來的 'image-saved' 事件
   * @param {function} callback - 當一張圖片成功儲存後執行的回呼函式
   */
  onImageSaved: (callback) => ipcRenderer.on('image-saved', (event, filePath) => callback(filePath)),

  /**
   * 監聽從主程序傳來的 'batch-error' 事件
   * @param {function} callback - 當批次處理發生錯誤時執行的回呼函式
   */
  onBatchError: (callback) => ipcRenderer.on('batch-error', (event, message) => callback(message)),
});
