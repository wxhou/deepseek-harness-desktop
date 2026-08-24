// 重建带 macOS 安全边距的 icon.icns（修复 #88：Dock 图标比相邻应用大一圈）。
//
// `tauri icon public/favicon.svg` 生成的是全出血（full-bleed）图标：白色圆角方块
// 填满整个画布，无透明边距。macOS Dock 按图标的不透明像素边界缩放，因此这类图标
// 会比带安全边距的相邻图标（如 ChatGPT/Firefox）渲染得更大。
//
// 本脚本在 `npm run icons` 之后执行：把 favicon 图形缩放到画布的 84% 并居中，
// 四周留出透明安全边距，仅重生成 macOS 使用的 icon.icns（Windows/Linux 图标
// 保持全出血不变，见 QwenLM/qwen-code PR #8987 的同类修复）。
//
// 用法：node scripts/rebuild-macos-icon.cjs
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const masterSvg = path.join(__dirname, 'macos-icon-master.svg');
const tmpOut = path.join(root, '.tmp', 'macos-icons');
const targetIcns = path.join(root, 'src-tauri', 'icons', 'icon.icns');

function fail(step, result) {
  const detail = result && result.stderr ? result.stderr.toString() : '';
  console.error(`[rebuild-macos-icon] ${step} failed:\n${detail}`);
  process.exit(1);
}

// 1. 由 favicon.svg 生成安全边距母版（84% 居中 + 透明边距），保证母版始终与源图形同步
const favicon = path.join(root, 'public', 'favicon.svg');
if (!fs.existsSync(favicon)) fail('read public/favicon.svg');
const src = fs.readFileSync(favicon, 'utf8');
const match = src.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
if (!match) fail('parse public/favicon.svg structure');
// 84% of 1024 ≈ 860.16; 64 -> 860.16 = 13.44; centering offset = (1024 - 860.16) / 2 = 81.92
const scale = 13.44;
const translate = 81.92;
const master = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g transform="translate(${translate} ${translate}) scale(${scale})">
${match[1]}
  </g>
</svg>
`;
fs.writeFileSync(masterSvg, master);

// 2. 用 tauri icon 生成整套图标到临时目录（用 .tmp，已在 .gitignore 中）
// 直接跑 CLI 的 JS 入口（node_modules/@tauri-apps/cli/tauri.js），避免 Windows 下
// 通过 shell 展开 .cmd 的转义问题。
fs.rmSync(tmpOut, { recursive: true, force: true });
fs.mkdirSync(tmpOut, { recursive: true });
const cliJs = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const gen = spawnSync(process.execPath, [cliJs, 'icon', masterSvg, '--output', tmpOut], {
  cwd: root,
  stdio: 'inherit',
});
if (gen.status !== 0) fail('tauri icon', gen);

// 3. 只回写 macOS 的 icon.icns（其余平台图标保持不变）
const generatedIcns = path.join(tmpOut, 'icon.icns');
if (!fs.existsSync(generatedIcns)) fail('find generated icon.icns');
fs.copyFileSync(generatedIcns, targetIcns);
console.log(`[rebuild-macos-icon] updated ${path.relative(root, targetIcns)}`);