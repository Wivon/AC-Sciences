const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

function hasFfmpegInPath() {
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  try {
    const result = spawnSync(exeName, ['-version'], { windowsHide: true });
    return result && result.status === 0;
  } catch (_e) {
    return false;
  }
}

function resolveFfmpegPath() {
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [];

  // Check resources path first (where electron-builder puts it)
  const resources = process.resourcesPath || '';
  if (resources) {
    candidates.push(path.join(resources, 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'node_modules', 'ffmpeg-static', exeName));
  }

  // Then check ffmpeg-static package path
  let pkgPath = null;
  const envPath = typeof process.env.FFMPEG_PATH === 'string' ? process.env.FFMPEG_PATH.trim() : '';
  if (envPath) candidates.push(envPath);
  try {
    pkgPath = require('ffmpeg-static');
  } catch (_e) {
    pkgPath = null;
  }
  if (typeof pkgPath === 'string') {
    candidates.push(pkgPath);
    if (pkgPath.includes('app.asar')) {
      candidates.push(pkgPath.replace('app.asar', 'app.asar.unpacked'));
    }
  }
  const resources = process.resourcesPath || '';
  if (resources) {
    candidates.push(path.join(resources, 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'node_modules', 'ffmpeg-static', exeName));
  }
  const execDir = process.execPath ? path.dirname(process.execPath) : '';
  if (execDir) {
    candidates.push(path.join(execDir, exeName));
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    const normalized = path.normalize(candidate);
    if (fs.existsSync(normalized)) return normalized;
  }
  if (hasFfmpegInPath()) return exeName;
  return null;
}
function getFfmpegDiagnostics() {
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const resources = process.resourcesPath || '';
  const appPath = app.getAppPath ? app.getAppPath() : '';
  const candidates = [];
  const envPath = typeof process.env.FFMPEG_PATH === 'string' ? process.env.FFMPEG_PATH.trim() : '';
  if (envPath) candidates.push(envPath);

  // Check resources path first (where electron-builder puts it)
  if (resources) {
    candidates.push(path.join(resources, 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'node_modules', 'ffmpeg-static', exeName));
  }

  // Then check ffmpeg-static package path
  let pkgPath = null;
  try {
    pkgPath = require('ffmpeg-static');
  } catch (_e) {
    pkgPath = null;
  }
  if (typeof pkgPath === 'string') {
    candidates.push(pkgPath);
    if (pkgPath.includes('app.asar')) {
      candidates.push(pkgPath.replace('app.asar', 'app.asar.unpacked'));
    }
  }
  if (resources) {
    candidates.push(path.join(resources, 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', exeName));
    candidates.push(path.join(resources, 'node_modules', 'ffmpeg-static', exeName));
  }
  const execDir = process.execPath ? path.dirname(process.execPath) : '';
  if (execDir) {
    candidates.push(path.join(execDir, exeName));
  }

  return {
    exeName,
    resources,
    appPath,
    pkgPath,
    ffmpegInPath: hasFfmpegInPath(),
    candidates: candidates.map(p => ({
      path: p,
      exists: !!(p && fs.existsSync(p))
    }))
  };
}

let mainWindow = null;
let currentProjectName = 'Untitled';
let allowClose = false;
let pendingOpenFilePath = null;

function extractLabPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    if (/\.lab$/i.test(arg) && fs.existsSync(arg)) return arg;
  }
  return null;
}

function dispatchOpenFile(filePath) {
  if (!filePath) return;
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('open-file', filePath);
  } else {
    pendingOpenFilePath = filePath;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = extractLabPathFromArgv(argv);
    if (filePath) dispatchOpenFile(filePath);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: `Labo Claveille — ${currentProjectName}`,
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    const initialPath = pendingOpenFilePath || extractLabPathFromArgv(process.argv);
    if (initialPath) {
      pendingOpenFilePath = null;
      dispatchOpenFile(initialPath);
    }
  });

  mainWindow.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      mainWindow.webContents.send('app-closing');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click() {
            mainWindow.webContents.send('menu-new');
          }
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click() {
            mainWindow.webContents.send('menu-open');
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click() {
            mainWindow.webContents.send('menu-save');
          }
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click() {
            mainWindow.webContents.send('menu-save-as');
          }
        },
        { type: 'separator' },
        {
          label: 'Export CSV…',
          click() {
            mainWindow.webContents.send('menu-export-csv');
          }
        },
        { type: 'separator' },
        {
          label: process.platform === 'darwin' ? 'Quitter Labo Claveille' : 'Quitter',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click() {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC handlers

ipcMain.handle('save-file', async (event, { filePath, data }) => {
  try {
    fs.writeFileSync(filePath, data, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-binary-file', async (_event, { filePath, dataBase64 }) => {
  try {
    const buf = Buffer.from(String(dataBase64 || ''), 'base64');
    fs.writeFileSync(filePath, buf);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-file-buffer', async (_event, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return { success: true, data: buf.toString('base64') };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

ipcMain.handle('transcode-video', async (_event, { inputPath }) => {
  try {
    if (!inputPath || typeof inputPath !== 'string') {
      return { success: false, error: 'invalid-input-path' };
    }
    if (!fs.existsSync(inputPath)) {
      return { success: false, error: 'input-file-not-found' };
    }
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) {
      return { success: false, error: 'ffmpeg-unavailable', diagnostics: getFfmpegDiagnostics() };
    }

    const outName = `acsciences-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const outputPath = path.join(app.getPath('temp'), outName);
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-movflags', '+faststart',
      outputPath
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += String(d); });
    proc.stderr.on('data', d => { stderr += String(d); });

    const code = await new Promise((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', resolve);
    });

    if (code !== 0 || !fs.existsSync(outputPath)) {
      return {
        success: false,
        error: 'ffmpeg-failed',
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    }

    return {
      success: true,
      outputPath,
      outputUrl: pathToFileURL(outputPath).toString(),
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.on('confirm-close', () => {
  allowClose = true;
  mainWindow.close();
});

ipcMain.on('set-title', (event, name) => {
  currentProjectName = name;
  if (mainWindow) {
    mainWindow.setTitle(`Labo Claveille — ${name}`);
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  dispatchOpenFile(filePath);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
