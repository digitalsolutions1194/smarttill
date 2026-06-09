const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const https = require('https');

let mainWindow;
let updateWindow = null;

// ── Update config ──
const RELEASES_URL = 'https://api.github.com/repos/digitalsolutions1194/smarttill/releases/latest';
let _updateInfo = null;

// ── Resolve the writable index.html path ──
// app.asar is a read-only archive, so we always write to app.asar.unpacked
function getIndexPath(){
  const appPath = app.getAppPath();
  const unpackedPath = path.join(
    appPath.replace('app.asar', 'app.asar.unpacked'), 'index.html'
  );
  const asarPath = path.join(appPath, 'index.html');
  return { load: fs.existsSync(unpackedPath) ? unpackedPath : asarPath, write: unpackedPath };
}

function getUnpackedPath(filename){
  const appPath = app.getAppPath();
  return path.join(appPath.replace('app.asar', 'app.asar.unpacked'), filename);
}

// Download a single file from URL, return promise resolving to string content
function fetchText(url){
  return new Promise((resolve, reject) => {
    function doFetch(u){
      https.get(u, { headers: { 'User-Agent': 'SmartTill-App' } }, (res) => {
        if(res.statusCode === 301 || res.statusCode === 302){
          doFetch(res.headers.location); return;
        }
        if(res.statusCode !== 200){ reject(new Error('HTTP ' + res.statusCode)); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    }
    doFetch(url);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'SmartTill',
    icon: path.join(__dirname, 'build', 'icon.png'),
    frame: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0d0d10',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,                          // required for preload contextBridge
      webSecurity: false,
      session: session.defaultSession,
      preload: path.join(__dirname, 'preload.js'),     // wire in preload
    }
  });

  const { load: loadPath } = getIndexPath();
  mainWindow.loadURL(url.format({ pathname: loadPath, protocol: 'file:', slashes: true }));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show();
    mainWindow.maximize();
    if(RELEASES_URL) setTimeout(checkForElectronUpdate, 5000);
  });

  mainWindow.webContents.on('did-fail-load', () => {
    const { load } = getIndexPath();
    if(fs.existsSync(load)){
      mainWindow.loadURL(url.format({ pathname: load, protocol: 'file:', slashes: true }));
    }
  });

  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    const allowed = [
      'file://', 'https://firestore.googleapis.com', 'https://www.googleapis.com',
      'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com',
      'https://fonts.googleapis.com', 'https://fonts.gstatic.com',
      'https://cdn.jsdelivr.net', 'https://www.gstatic.com', 'https://api.groq.com'
    ];
    if(!allowed.some(p => navUrl.startsWith(p))){
      event.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: winUrl }) => {
    shell.openExternal(winUrl);
    return { action: 'deny' };
  });

  buildMenu();
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ══════════════════════════════════════════════
// AUTO-UPDATER (GitHub Releases — HTML swap)
// ══════════════════════════════════════════════

function checkForElectronUpdate(){
  if(!RELEASES_URL) return;
  https.get(RELEASES_URL, { headers: { 'User-Agent': 'SmartTill-App' } }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try{
        const release = JSON.parse(data);
        const latest  = release.tag_name?.replace('v','') || '';
        const current = app.getVersion();
        const notes   = release.body || 'New features and improvements.';

        if(latest && isNewerVersion(latest, current)){
          // Look for the index.html asset in the release
          const asset = (release.assets || []).find(a => a.name === 'index.html');
          _updateInfo = { version: latest, notes, asset };
          buildMenu(true);
          if(mainWindow){
            mainWindow.webContents.send('update-available', { version: latest, notes });
          }
        }
      }catch(e){ console.log('Update check parse error:', e.message); }
    });
  }).on('error', e => console.log('Update check failed:', e.message));
}

function isNewerVersion(a, b){
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for(let i=0;i<3;i++){
    if((pa[i]||0) > (pb[i]||0)) return true;
    if((pa[i]||0) < (pb[i]||0)) return false;
  }
  return false;
}

function showUpdateWindow(){
  if(updateWindow){ updateWindow.focus(); return; }

  updateWindow = new BrowserWindow({
    width: 420,
    height: 320,
    title: 'SmartTill Update',
    icon: path.join(__dirname, 'build', 'icon.png'),
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow,
    modal: false,
    show: true,
    backgroundColor: '#0d0d10',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  const info = _updateInfo || { version: '?', notes: '' };

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:#0d0d10;color:#f0f0f5;padding:24px;user-select:none}
  h2{font-size:16px;font-weight:800;margin-bottom:6px}
  .ver{font-size:12px;color:#22a05a;font-weight:700;margin-bottom:10px}
  .notes{font-size:12.5px;color:#a0a0b0;line-height:1.65;
    background:#141418;border-radius:8px;padding:11px 13px;margin-bottom:16px;
    max-height:80px;overflow-y:auto}
  .progress-wrap{background:#1a1a20;border-radius:99px;height:8px;
    margin-bottom:8px;overflow:hidden;display:none}
  .progress-bar{height:100%;background:linear-gradient(90deg,#22a05a,#6ee9a8);
    border-radius:99px;width:0%;transition:width .3s}
  .status{font-size:12px;color:#808090;margin-bottom:14px;min-height:18px}
  .btns{display:flex;gap:8px}
  .btn-dl{background:linear-gradient(135deg,#22a05a,#1a7a45);border:none;
    border-radius:8px;color:#fff;font-size:13px;font-weight:700;
    padding:10px 20px;cursor:pointer;flex:1}
  .btn-dl:disabled{opacity:.5;cursor:not-allowed}
  .btn-later{background:none;border:1px solid #2a2a35;border-radius:8px;
    color:#808090;font-size:13px;padding:10px 16px;cursor:pointer}
  .btn-later:hover{background:#1a1a20}
</style>
</head>
<body>
  <h2>🆕 Update Available</h2>
  <div class="ver">v${info.version} — SmartTill</div>
  <div class="notes">${info.notes}</div>
  <div class="progress-wrap" id="prog-wrap">
    <div class="progress-bar" id="prog-bar"></div>
  </div>
  <div class="status" id="status"></div>
  <div class="btns">
    <button class="btn-dl" id="dl-btn" onclick="startUpdate()">Update & Restart</button>
    <button class="btn-later" onclick="window.close()">Later</button>
  </div>
<script>
  const { ipcRenderer } = require('electron');

  ipcRenderer.on('html-update-progress', (e, pct) => {
    document.getElementById('prog-wrap').style.display = 'block';
    document.getElementById('prog-bar').style.width = pct + '%';
    document.getElementById('status').textContent = 'Downloading… ' + pct + '%';
  });

  ipcRenderer.on('html-update-done', () => {
    document.getElementById('prog-bar').style.width = '100%';
    document.getElementById('status').textContent = '✓ Installing update…';
    document.getElementById('dl-btn').disabled = true;
  });

  ipcRenderer.on('html-update-error', (e, msg) => {
    document.getElementById('prog-bar').style.background = '#e03e3e';
    document.getElementById('status').style.color = '#e03e3e';
    document.getElementById('status').textContent = '✕ ' + msg;
    document.getElementById('dl-btn').disabled = false;
    document.getElementById('dl-btn').textContent = 'Retry';
  });

  function startUpdate(){
    document.getElementById('dl-btn').disabled = true;
    document.getElementById('dl-btn').textContent = 'Updating…';
    document.getElementById('status').textContent = 'Starting download…';
    ipcRenderer.send('start-html-update');
  }
<\/script>
</body>
</html>`;

  updateWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  updateWindow.setMenuBarVisibility(false);
  updateWindow.on('closed', () => { updateWindow = null; });
}

// ── IPC: HTML-swap update ──
ipcMain.on('start-html-update', () => {
  if(!_updateInfo || !_updateInfo.asset){
    // Fallback: download index.html directly from GitHub Pages
    downloadHtmlUpdate('https://digitalsolutions1194.github.io/smarttill/index.html');
    return;
  }
  downloadHtmlUpdate(_updateInfo.asset.browser_download_url);
});

function downloadHtmlUpdate(downloadUrl){
  let downloaded = 0;

  // Derive base URL for sibling files (main.js, preload.js)
  const baseUrl = downloadUrl.substring(0, downloadUrl.lastIndexOf('/') + 1);
  const mainJsUrl    = baseUrl + 'main.js';
  const preloadJsUrl = baseUrl + 'preload.js';

  function doDownload(url){
    https.get(url, { headers: { 'User-Agent': 'SmartTill-App' } }, (res) => {
      // Follow redirects
      if(res.statusCode === 301 || res.statusCode === 302){
        doDownload(res.headers.location);
        return;
      }
      if(res.statusCode !== 200){
        if(updateWindow) updateWindow.webContents.send('html-update-error', 'Download failed: HTTP ' + res.statusCode);
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0');
      const chunks = [];
      res.on('data', chunk => {
        chunks.push(chunk);
        downloaded += chunk.length;
        if(total > 0){
          const pct = Math.round((downloaded / total) * 100);
          if(updateWindow) updateWindow.webContents.send('html-update-progress', pct);
        }
      });
      res.on('end', () => {
        try{
          const newHtml = Buffer.concat(chunks).toString('utf8');
          // Write index.html
          const { write: writePath } = getIndexPath();
          const dir = path.dirname(writePath);
          if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(writePath, newHtml, 'utf8');

          // Also fetch and write main.js and preload.js — silent, non-fatal
          Promise.allSettled([
            fetchText(mainJsUrl).then(c => {
              const p = getUnpackedPath('main.js');
              fs.mkdirSync(path.dirname(p), { recursive: true });
              fs.writeFileSync(p, c, 'utf8');
              console.log('main.js updated');
            }).catch(e => console.log('main.js fetch skipped:', e.message)),
            fetchText(preloadJsUrl).then(c => {
              const p = getUnpackedPath('preload.js');
              fs.mkdirSync(path.dirname(p), { recursive: true });
              fs.writeFileSync(p, c, 'utf8');
              console.log('preload.js updated');
            }).catch(e => console.log('preload.js fetch skipped:', e.message))
          ]).then(() => {
            if(updateWindow) updateWindow.webContents.send('html-update-done');
            setTimeout(() => { app.relaunch(); app.exit(0); }, 1200);
          });
        }catch(e){
          if(updateWindow) updateWindow.webContents.send('html-update-error', 'Write failed: ' + e.message);
        }
      });
      res.on('error', err => {
        if(updateWindow) updateWindow.webContents.send('html-update-error', err.message);
      });
    }).on('error', err => {
      if(updateWindow) updateWindow.webContents.send('html-update-error', err.message);
    });
  }

  doDownload(downloadUrl);
}

// ── IPC: apply-update from renderer (SmartTill in-app banner) ──
// SmartTill's own update banner calls window.electronAPI.applyUpdate(htmlContent, mainJs, preloadJs)
// We write all files to disk and restart
ipcMain.handle('apply-update', async (event, htmlContent, mainJsContent, preloadJsContent) => {
  try{
    const { write: writePath } = getIndexPath();
    const dir = path.dirname(writePath);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(writePath, htmlContent, 'utf8');

    // Write main.js and preload.js if provided
    if(mainJsContent){
      const p = getUnpackedPath('main.js');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, mainJsContent, 'utf8');
    }
    if(preloadJsContent){
      const p = getUnpackedPath('preload.js');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, preloadJsContent, 'utf8');
    }

    setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
    return { ok: true };
  }catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('restart-app', async () => {
  app.relaunch();
  app.exit(0);
});

// ══════════════════════════════════════════════
// MENU
// ══════════════════════════════════════════════

function buildMenu(updateAvailable = false){
  const menu = Menu.buildFromTemplate([
    {
      label: 'SmartTill',
      submenu: [
        { label: 'Toggle Fullscreen', accelerator: 'F11',
          click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { type: 'separator' },
        { label: 'Reload App', accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload() },
        { type: 'separator' },
        { label: 'Quit SmartTill', accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit() }
      ]
    },
    {
      label: updateAvailable ? '⬆ Update Available' : 'Help',
      submenu: [
        ...(updateAvailable ? [{
          label: `⬆ Install v${_updateInfo?.version || 'update'} now`,
          click: () => showUpdateWindow()
        }, { type: 'separator' }] : []),
        {
          label: 'Check for Updates',
          click: () => {
            checkForElectronUpdate();
            notify('Checking for updates…');
          }
        },
        {
          label: 'About SmartTill',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info', title: 'About SmartTill',
              message: 'SmartTill POS',
              detail: `Version ${app.getVersion()}\n\nPowered by Digital Solutions\n\nData stored in:\n${app.getPath('userData')}\n\nSupport:\n+260 978 739 708\n+260 965 871 588\ndigitalsolutions1194@gmail.com`,
              buttons: ['OK']
            });
          }
        },
        { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        {
          label: 'Diagnostics',
          click: () => {
            const { load, write } = getIndexPath();
            dialog.showMessageBox(mainWindow, {
              type: 'info', title: 'Diagnostics',
              message: 'App Information',
              detail: `Version: ${app.getVersion()}\nLoad path: ${load}\nWrite path: ${write}\nUser Data: ${app.getPath('userData')}`,
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function notify(msg){
  if(mainWindow) mainWindow.webContents.executeJavaScript(
    `if(typeof notify==='function') notify(${JSON.stringify(msg)})`
  );
}

// ══════════════════════════════════════════════
// IPC HANDLERS
// ══════════════════════════════════════════════
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('get-userdata-path', () => app.getPath('userData'));

// ── IPC: open receipt in a dedicated print window ──
ipcMain.handle('open-receipt', (event, receiptHtml) => {
  const receiptWin = new BrowserWindow({
    width: 420,
    height: 620,
    title: 'Receipt',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  receiptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptHtml));
  receiptWin.setMenuBarVisibility(false);
  receiptWin.webContents.on('did-finish-load', () => receiptWin.show());
  receiptWin.on('closed', () => {});
});
ipcMain.handle('set-fullscreen', (event, flag) => {
  if(mainWindow) mainWindow.setFullScreen(flag);
});
ipcMain.handle('save-logo', (event, dataUrl) => {
  try{
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromDataURL(dataUrl);
    if(!img.isEmpty()) mainWindow.setIcon(img);
    return true;
  }catch(e){ return false; }
});

// ══════════════════════════════════════════════
// APP LIFECYCLE
// ══════════════════════════════════════════════
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if(process.platform !== 'darwin') app.quit();
});
