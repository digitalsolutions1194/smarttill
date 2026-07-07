const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion:       () => ipcRenderer.invoke('get-version'),
  getUserDataPath:  () => ipcRenderer.invoke('get-userdata-path'),
  platform:         process.platform,
  setFullscreen:    (flag) => ipcRenderer.invoke('set-fullscreen', flag),

  // ── Update: called by SmartTill's in-app update banner ──
  applyUpdate:      (html, mainJs, preloadJs) => ipcRenderer.invoke('apply-update', html, mainJs, preloadJs),
  restartApp:       () => ipcRenderer.invoke('restart-app'),
  openUpdateWindow: (url) => ipcRenderer.invoke('open-update-window', url),

  // ── Update notifications from main process → renderer ──
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, info) => cb(info)),

  // ── Auto backup ──
  saveBackup:   (filename, data, cycleStart) => ipcRenderer.invoke('save-backup', filename, data, cycleStart),
  backupExists: (filename) => ipcRenderer.invoke('backup-exists', filename),
});
