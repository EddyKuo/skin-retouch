const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile('index.html');
  // Open the DevTools.
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('save-image', async (event, { data }) => {
  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: 'Save Image',
    defaultPath: `retouched-${Date.now()}.png`,
    filters: [{ name: 'Images', extensions: ['png'] }]
  });

  if (filePath) {
    const buffer = Buffer.from(data, 'base64');
    fs.writeFile(filePath, buffer, (err) => {
      if (err) console.error("Failed to save the image:", err);
    });
  }
});