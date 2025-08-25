const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveImage: (data) => ipcRenderer.send('save-image', data),
  // Batch processing
  openFolderDialog: () => ipcRenderer.send('open-folder-dialog'),
  saveBatchImage: (data) => ipcRenderer.send('save-batch-image', data),
  onFolderSelected: (callback) => ipcRenderer.on('folder-selected', (event, files) => callback(files)),
  onImageSaved: (callback) => ipcRenderer.on('image-saved', (event, filePath) => callback(filePath)),
  onBatchError: (callback) => ipcRenderer.on('batch-error', (event, message) => callback(message)),
});