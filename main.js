// 引入 Electron 核心模組
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
// 引入 Node.js 的路徑和檔案系統模組
const path = require('path');
const fs = require('fs');

/**
 * 建立應用程式主視窗
 */
function createWindow () {
  // 建立一個新的瀏覽器視窗
  const win = new BrowserWindow({
    width: 1200, // 視窗寬度
    height: 900, // 視窗高度
    autoHideMenuBar: true, // 自動隱藏菜單欄
    webPreferences: {
      // 指定預載入腳本，用於在渲染程序中安全地暴露 Node.js API
      preload: path.join(__dirname, 'preload.js'),
      // 啟用上下文隔離，增強安全性
      contextIsolation: true,
      // 禁用 Node.js 整合，增強安全性
      nodeIntegration: false,
    }
  });

  // 載入應用的主 HTML 檔案
  win.loadFile('index.html');
  
  // 如果需要，可以取消註解此行以開啟開發者工具
  // win.webContents.openDevTools();
}

// 當 Electron 應用程式準備就緒後執行
app.whenReady().then(() => {
  // 建立主視窗
  createWindow();

  // 監聽 'activate' 事件 (主要用於 macOS)
  // 當點擊 dock 圖示且沒有其他視窗開啟時，重新建立一個視窗
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 監聽 'window-all-closed' 事件
// 當所有視窗都關閉時，退出應用程式 (非 macOS 平台)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC (行程間通訊) 處理 ---

/**
 * 監聽從渲染程序傳來的 'save-image' 事件
 * @param {object} event - IPC 事件對象
 * @param {object} { data } - 包含 base64 影像數據的對象
 */
ipcMain.on('save-image', async (event, { data }) => {
  // 顯示儲存檔案對話方塊
  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: '儲存圖片',
    // 預設檔名
    defaultPath: `retouched-${Date.now()}.png`,
    // 檔案類型過濾器
    filters: [{ name: 'Images', extensions: ['png'] }]
  });

  // 如果使用者選擇了檔案路徑
  if (filePath) {
    // 將 base64 數據轉換為 Buffer
    const buffer = Buffer.from(data, 'base64');
    // 將 Buffer 寫入檔案
    fs.writeFile(filePath, buffer, (err) => {
      if (err) console.error("儲存圖片失敗:", err);
    });
  }
});

// --- 批次處理相關的 IPC 處理 ---

/**
 * 監聽 'open-folder-dialog' 事件，用於開啟選擇多個圖片的對話方塊
 */
ipcMain.on('open-folder-dialog', async (event) => {
  // 顯示開啟檔案對話方塊，允許多選
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }
    ]
  });

  // 如果使用者選擇了檔案
  if (filePaths && filePaths.length > 0) {
    // 將選擇的檔案路徑列表傳回給渲染程序
    event.sender.send('folder-selected', filePaths);
  }
});

/**
 * 監聽 'save-batch-image' 事件，用於儲存批次處理中的單張圖片
 * @param {object} event - IPC 事件對象
 * @param {object} { data, originalPath } - 包含 base64 影像數據和原始路徑的對象
 */
ipcMain.on('save-batch-image', (event, { data, originalPath }) => {
  // 解析原始檔案路徑
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const baseName = path.basename(originalPath, ext);
  // 產生新的檔名，固定為 png 格式並加上 '_rt' 後綴
  const newFilePath = path.join(dir, `${baseName}_rt.png`);

  // 將 base64 數據轉換為 Buffer
  const buffer = Buffer.from(data, 'base64');
  // 將 Buffer 寫入檔案
  fs.writeFile(newFilePath, buffer, (err) => {
    if (err) {
      console.error(`儲存 ${newFilePath} 失敗:`, err);
      // 如果儲存失敗，向渲染程序發送錯誤訊息
      event.sender.send('batch-error', `儲存 ${newFilePath} 失敗.`);
    } else {
      // 如果儲存成功，向渲染程序發送成功訊息
      event.sender.send('image-saved', newFilePath);
    }
  });
});