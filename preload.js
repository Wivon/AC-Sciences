const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (filePath, data) => ipcRenderer.invoke('save-file', { filePath, data }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_e) {
      return '';
    }
  },
  transcodeVideo: (inputPath) => ipcRenderer.invoke('transcode-video', { inputPath }),
  setTitle: (name) => ipcRenderer.send('set-title', name),
  onMenuNew: (callback) => ipcRenderer.on('menu-new', callback),
  onMenuOpen: (callback) => ipcRenderer.on('menu-open', callback),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onMenuSaveAs: (callback) => ipcRenderer.on('menu-save-as', callback),
  onMenuExportCsv: (callback) => ipcRenderer.on('menu-export-csv', callback),
  onAppClosing: (callback) => ipcRenderer.on('app-closing', (_e) => callback()),
  confirmClose: () => ipcRenderer.send('confirm-close')
});
