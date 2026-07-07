'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const url    = require('url');

// ── GitHub releases URL for auto-update check ──
const RELEASES_URL = 'https://digitalsolutions1194.github.io/smarttill/version.json';

let mainWindow   = null;
let updateWindow = null;

// ── Resolve file paths ──
// index.html, main.js and preload.js are all in asarUnpack — writable at app.asar.unpacked
function getIndexPath(){
  const appPath      = app.getAppPath();
  const unpackedPath = path.join(
    appPath.replace('app.asar', 'app.asar.unpacked'), 'index.html'
  );
  const asarPath = path.join(appPath, 'index.html');
  const loadPath = fs.existsSync(unpackedPath) ? unpackedPath : asarPath;
  return { load: loadPath, write: unpackedPath };
}

function getUnpackedPath(filename){
  // main.js and preload.js are in asarUnpack alongside index.html
  const appPath = app.getAppPath();
  return path.join(appPath.replace('app.asar', 'app.asar.unpacked'), filename);
}

// Fetch a URL and return its text content
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

function createWindow(){
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    show:   false,
    backgroundColor: '#0f0f0f',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
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
    // Allow blob: URLs — used for receipt printing
    if(winUrl.startsWith('blob:')) return { action: 'allow' };
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
        const info = JSON.parse(data);
        if(mainWindow && info.version){
          mainWindow.webContents.send('update-available', info);
        }
      }catch(e){ /* ignore parse errors */ }
    });
  }).on('error', () => { /* ignore network errors */ });
}

function downloadHtmlUpdate(downloadUrl){
  let downloaded = 0;
  const baseUrl = downloadUrl.substring(0, downloadUrl.lastIndexOf('/') + 1);

  function doDownload(urlStr){
    https.get(urlStr, { headers: { 'User-Agent': 'SmartTill-App' } }, (res) => {
      if(res.statusCode === 301 || res.statusCode === 302){
        doDownload(res.headers.location); return;
      }
      if(res.statusCode !== 200){
        if(updateWindow) updateWindow.webContents.send('html-update-error', 'Download failed: HTTP ' + res.statusCode);
        return;
      }
      const total  = parseInt(res.headers['content-length'] || '0');
      const chunks = [];
      res.on('data', chunk => {
        chunks.push(chunk);
        downloaded += chunk.length;
        if(total > 0 && updateWindow){
          updateWindow.webContents.send('html-update-progress', Math.round((downloaded / total) * 100));
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
          // Also update main.js and preload.js — non-fatal if unavailable
          Promise.allSettled([
            fetchText(baseUrl + 'main.js').then(c => {
              const p = getUnpackedPath('main.js');
              fs.mkdirSync(path.dirname(p), { recursive: true });
              fs.writeFileSync(p, c, 'utf8');
              console.log('main.js updated via auto-update');
            }).catch(e => console.log('main.js update skipped:', e.message)),
            fetchText(baseUrl + 'preload.js').then(c => {
              const p = getUnpackedPath('preload.js');
              fs.mkdirSync(path.dirname(p), { recursive: true });
              fs.writeFileSync(p, c, 'utf8');
              console.log('preload.js updated via auto-update');
            }).catch(e => console.log('preload.js update skipped:', e.message))
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
ipcMain.handle('apply-update', async (event, htmlContent, mainJsContent, preloadJsContent) => {
  try{
    // Write index.html
    const { write: writePath } = getIndexPath();
    const dir = path.dirname(writePath);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(writePath, htmlContent, 'utf8');
    // Write main.js and preload.js if provided (in asarUnpack — writable)
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

// ── IPC: restart app ──
ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

// ── IPC: get version ──
ipcMain.handle('get-version', () => app.getVersion());

// ── IPC: get userData path ──
ipcMain.handle('get-userdata-path', () => app.getPath('userData'));

// ── IPC: set fullscreen ──
ipcMain.handle('set-fullscreen', (event, flag) => {
  if(mainWindow) mainWindow.setFullScreen(flag);
});

// ── IPC: open update window ──
ipcMain.handle('open-update-window', (event, downloadUrl) => {
  if(updateWindow){ updateWindow.focus(); return; }
  updateWindow = new BrowserWindow({
    width: 460, height: 320,
    title: 'SmartTill Update',
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow,
    modal: true,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  const updateHtml = `<!DOCTYPE html><html><head><title>Update</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#1a1a2e;color:#e2e8f0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;height:100vh;padding:32px;text-align:center}
    h2{font-size:18px;font-weight:600;margin-bottom:8px;color:#fff}
    p{font-size:13px;color:#94a3b8;margin-bottom:24px}
    .bar-wrap{width:100%;background:#0f0f23;border-radius:8px;height:8px;overflow:hidden;margin-bottom:16px}
    .bar{height:100%;background:linear-gradient(90deg,#7c6df0,#a395f5);width:0%;transition:width .3s;border-radius:8px}
    .status{font-size:12px;color:#64748b}
    .close-btn{margin-top:20px;padding:8px 24px;background:#7c6df0;color:#fff;
      border:none;border-radius:6px;cursor:pointer;font-size:13px}
  </style></head><body>
  <h2>Installing Update</h2>
  <p>Please wait while SmartTill downloads the latest version…</p>
  <div class="bar-wrap"><div class="bar" id="bar"></div></div>
  <div class="status" id="status">Starting download…</div>
  <button class="close-btn" id="closeBtn" style="display:none" onclick="window.close()">Close</button>
  <script>
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('html-update-progress', (e, pct) => {
      document.getElementById('bar').style.width = pct + '%';
      document.getElementById('status').textContent = 'Downloading… ' + pct + '%';
    });
    ipcRenderer.on('html-update-done', () => {
      document.getElementById('bar').style.width = '100%';
      document.getElementById('status').textContent = 'Update installed! Restarting…';
    });
    ipcRenderer.on('html-update-error', (e, msg) => {
      document.getElementById('status').textContent = 'Error: ' + msg;
      document.getElementById('closeBtn').style.display = 'inline-block';
    });
  <\/script></body></html>`;

  updateWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(updateHtml));
  updateWindow.webContents.on('did-finish-load', () => {
    updateWindow.show();
    downloadHtmlUpdate(downloadUrl);
  });
  updateWindow.on('closed', () => { updateWindow = null; });
});


// ══════════════════════════════════════════════
// AUTO BACKUP IPC HANDLERS
// ══════════════════════════════════════════════

ipcMain.handle('save-backup', async (event, filename, data, cycleStart) => {
  try{
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if(!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    // Write today's backup
    fs.writeFileSync(path.join(backupDir, filename), data, 'utf8');

    // Prune backups older than cycle start
    if(cycleStart){
      const files = fs.readdirSync(backupDir);
      files.forEach(f => {
        // filename format: backup_YYYY-MM-DD.json
        const match = f.match(/^backup_(\d{4}-\d{2}-\d{2})\.json$/);
        if(match && match[1] < cycleStart){
          try{ fs.unlinkSync(path.join(backupDir, f)); }catch(e){}
        }
      });
    }
    return { ok: true };
  }catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('backup-exists', async (event, filename) => {
  try{
    const backupDir = path.join(app.getPath('userData'), 'backups');
    return fs.existsSync(path.join(backupDir, filename));
  }catch(e){
    return false;
  }
});

// ══════════════════════════════════════════════
// MENU
// ══════════════════════════════════════════════

function buildMenu(){
  const template = [
    {
      label: 'SmartTill',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R',
          click: () => { if(mainWindow) mainWindow.reload(); } },
        { type: 'separator' },
        { label: 'Quit SmartTill', accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit() }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ══════════════════════════════════════════════
// APP LIFECYCLE
// ══════════════════════════════════════════════

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if(process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if(BrowserWindow.getAllWindows().length === 0) createWindow();
});
