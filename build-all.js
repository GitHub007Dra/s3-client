#!/usr/bin/env node

/**
 * S3 Client 多平台多架构构建脚本
 *
 * 支持构建以下 6 个安装包：
 * - macOS: x64 (Intel), arm64 (Apple Silicon)
 * - Windows: x64, arm64
 * - Linux: x64, arm64
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 需要排除的临时目录（构建其他平台时产生的）
const TEMP_DIRS_TO_CLEAN = ['mac', 'mac-arm64', 'win-unpacked', 'win-arm64-unpacked'];

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  step: (msg) => console.log(`\n${colors.cyan}${colors.bright}▶ ${msg}${colors.reset}`)
};

// 解析命令行参数
const args = process.argv.slice(2);
const platforms = [];
const shouldClean = args.includes('--clean') || args.includes('-c');

if (args.includes('--mac') || args.includes('-m')) platforms.push('mac');
if (args.includes('--win') || args.includes('-w')) platforms.push('win');
if (args.includes('--linux') || args.includes('-l')) platforms.push('linux');

// 如果没有指定平台，默认构建当前主机支持的所有平台
const buildAll = platforms.length === 0;

/**
 * 执行命令并处理错误
 */
function exec(command, options = {}) {
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: __dirname,
      ...options
    });
    return true;
  } catch (error) {
    log.error(`命令执行失败: ${command}`);
    return false;
  }
}

/**
 * 清理构建目录
 */
function clean() {
  log.step('清理构建目录...');
  
  const dirsToClean = ['dist'];
  
  for (const dir of dirsToClean) {
    const dirPath = path.join(__dirname, dir);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      log.info(`已清理: ${dir}`);
    }
  }
  
  log.success('清理完成');
}

/**
 * 构建渲染进程 (Vite)
 */
function buildRenderer() {
  log.step('构建渲染进程 (Vite)...');
  
  if (!exec('npx vite build')) {
    throw new Error('渲染进程构建失败');
  }
  
  log.success('渲染进程构建完成');
}

/**
 * 构建主进程 (esbuild)
 */
function buildMain() {
  log.step('构建主进程 (esbuild)...');
  
  if (!exec('node build.js')) {
    throw new Error('主进程构建失败');
  }
  
  log.success('主进程构建完成');
}

/**
 * 清理其他平台的临时目录，避免被打包
 */
function cleanTempDirs(excludePlatform) {
  const distPath = path.join(__dirname, 'dist');
  
  for (const dir of TEMP_DIRS_TO_CLEAN) {
    // 跳过当前正在构建的平台目录
    if (excludePlatform === 'mac' && (dir === 'mac' || dir === 'mac-arm64')) continue;
    if (excludePlatform === 'win' && (dir === 'win-unpacked' || dir === 'win-arm64-unpacked')) continue;
    
    const dirPath = path.join(distPath, dir);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      log.info(`已清理临时目录: ${dir}`);
    }
  }
}

/**
 * 构建特定平台的安装包
 */
function buildPlatform(platform) {
  log.step(`构建 ${platform.toUpperCase()} 平台安装包...`);
  
  // 清理其他平台的临时目录
  cleanTempDirs(platform);
  
  let command;
  
  switch (platform) {
    case 'mac':
      command = 'npx electron-builder --mac --config electron-builder.json';
      break;
    case 'win':
      command = 'npx electron-builder --win --config electron-builder.json';
      break;
    case 'linux':
      command = 'npx electron-builder --linux --config electron-builder.json';
      break;
    default:
      throw new Error(`未知的平台: ${platform}`);
  }
  
  if (!exec(command)) {
    log.warn(`${platform.toUpperCase()} 平台构建可能遇到问题`);
    return false;
  }
  
  return true;
}

/**
 * 列出构建产物
 */
function listArtifacts() {
  log.step('构建产物列表');
  
  const distPath = path.join(__dirname, 'dist');
  
  if (!fs.existsSync(distPath)) {
    log.warn('dist 目录不存在');
    return;
  }
  
  const files = fs.readdirSync(distPath);
  const artifacts = files.filter(f => 
    f.endsWith('.dmg') || 
    f.endsWith('.exe') || 
    f.endsWith('.AppImage') ||
    f.endsWith('.deb') ||
    f.endsWith('.rpm') ||
    f.endsWith('.zip')
  );
  
  if (artifacts.length === 0) {
    log.warn('未找到构建产物');
    return;
  }
  
  console.log('');
  artifacts.forEach(file => {
    const filePath = path.join(distPath, file);
    const stats = fs.statSync(filePath);
    const size = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`  ${colors.green}•${colors.reset} ${file} (${size} MB)`);
  });
  console.log('');
  log.success(`共生成 ${artifacts.length} 个安装包`);
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
${colors.bright}S3 Client 多平台构建脚本${colors.reset}

${colors.bright}用法:${colors.reset}
  node build-all.js [选项]

${colors.bright}选项:${colors.reset}
  --mac, -m       仅构建 macOS 平台 (x64, arm64)
  --win, -w       仅构建 Windows 平台 (x64, arm64)
  --linux, -l     仅构建 Linux 平台 (x64, arm64)
  --clean, -c     清理构建目录后重新构建
  --help, -h      显示帮助信息

${colors.bright}示例:${colors.reset}
  node build-all.js              # 构建所有平台
  node build-all.js --mac        # 仅构建 macOS
  node build-all.js --win --clean # 清理后构建 Windows
  node build-all.js -m -w        # 构建 macOS 和 Windows

${colors.bright}注意:${colors.reset}
  • macOS 应用只能在 macOS 系统上构建
  • 跨平台构建可能需要额外的依赖
`);
}

/**
 * 主函数
 */
async function main() {
  // 显示帮助
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }
  
  console.log(`\n${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║     S3 Client 多平台构建脚本           ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);
  
  // 清理
  if (shouldClean) {
    clean();
  }
  
  // 构建渲染进程和主进程
  try {
    buildRenderer();
    buildMain();
  } catch (error) {
    log.error(error.message);
    process.exit(1);
  }
  
  // 构建平台安装包
  const platformsToBuild = buildAll ? ['mac', 'win', 'linux'] : platforms;
  const results = {};
  
  for (const platform of platformsToBuild) {
    results[platform] = buildPlatform(platform);
  }
  
  // 总结
  console.log(`\n${colors.bright}═══════════════════════════════════════════${colors.reset}`);
  log.success('构建流程执行完毕');
  
  // 列出构建产物
  listArtifacts();
  
  // 显示各平台构建状态
  console.log(`${colors.bright}各平台构建状态:${colors.reset}`);
  Object.entries(results).forEach(([platform, success]) => {
    const status = success 
      ? `${colors.green}✓ 成功${colors.reset}` 
      : `${colors.red}✗ 失败${colors.reset}`;
    console.log(`  ${platform.toUpperCase()}: ${status}`);
  });
  
  console.log('');
}

main().catch(error => {
  log.error(`构建失败: ${error.message}`);
  process.exit(1);
});
