/**
 * build/build-single.js — 将项目内联为单个 HTML 文件（零依赖，node 直接运行）
 *
 * 用法:  node build/build-single.js
 * 输出:  dist/seat-arranger-single.html （可单独拷贝/发送，双击即用）
 *
 * 依赖: 仅 node 内置模块（fs/path），无需 npm install。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

// 与 index.html 底部的 <script> 顺序保持一致（依赖顺序）
const scripts = [
  'lib/xlsx.full.min.js',
  'js/storage.js',
  'js/layout.js',
  'js/roster.js',
  'js/parser.js',
  'js/rules.js',
  'js/cost.js',
  'js/anneal.js',
  'js/render.js',
  'js/drag.js',
  'js/export.js',
  'js/app.js'
];

let out = html.replace(
  '<link rel="stylesheet" href="css/style.css">',
  '<style>\n' + css + '\n</style>'
);

for (const rel of scripts) {
  const src = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const code = fs
    .readFileSync(path.join(root, rel), 'utf8')
    .replace(/<\/script/gi, '<\\/script'); // 防止内联内容提前闭合 script 标签
  const re = new RegExp('<script src="' + src + '"></script>');
  if (!re.test(out)) {
    console.error('[ERROR] 未找到 script 标签: ' + rel);
    process.exit(1);
  }
  out = out.replace(re, '<script>\n' + code + '\n</script>');
}

const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const dest = path.join(distDir, 'seat-arranger-single.html');
fs.writeFileSync(dest, out);

const kb = (out.length / 1024).toFixed(0);
console.log('[OK] 生成单文件版: ' + dest + '  (' + kb + ' KB)');
