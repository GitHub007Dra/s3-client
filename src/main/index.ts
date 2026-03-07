const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow: typeof BrowserWindow.prototype | null = null;

function getIndexHtmlPath(): string {
  // 在开发模式下，使用 Vite 开发服务器
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  
  // 在打包模式下，从 asar 内部加载
  return path.join(__dirname, '..', '..', 'dist', 'index.html');
}

function createWindow() {
  // 获取图标路径
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    useContentSize: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexPath = getIndexHtmlPath();
  console.log('Loading index.html from:', indexPath);
  
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(indexPath);
  } else {
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // 设置应用Dock图标（macOS）
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
    app.dock.setIcon(iconPath);
  }
  
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