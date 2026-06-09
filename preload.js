const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion:       () => ipcRenderer.invoke('get-version'),
  getUserDataPath:  () => ipcRenderer.invoke('get-userdata-path'),
  platform:         process.platform,
  setFullscreen:    (flag) => ipcRenderer.invoke('set-fullscreen', flag),
  saveLogo:         (dataUrl) => ipcRenderer.invoke('save-logo', dataUrl),

  // ── Receipt printing ──
  openReceipt:      (html) => ipcRenderer.invoke('open-receipt', html),

  // ── Update: called by SmartTill's in-app update banner ──
  // Passes the downloaded HTML string to main process to write to disk and restart
  applyUpdate:      (htmlContent, mainJsContent, preloadJsContent) => ipcRenderer.invoke('apply-update', htmlContent, mainJsContent, preloadJsContent),
  restartApp:       () => ipcRenderer.invoke('restart-app'),

  // ── Update notifications from main process → renderer ──
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, info) => cb(info)),
});
