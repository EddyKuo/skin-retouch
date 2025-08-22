const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveImage: (data) => ipcRenderer.send('save-image', data),
});