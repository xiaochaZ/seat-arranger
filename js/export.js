/**
 * export.js — 导出：PNG 座位表图片、Excel 座位表（SheetJS，缺失降级 CSV）
 * 全局命名空间：Seat.Export
 */
(function (global) {
  'use strict';

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /**
   * 导出 PNG：Canvas 绘制座位表（2x 高清）
   */
  function exportPNG(title, layout, students, assignment, rules) {
    const S = global.Seat;
    const ctx = { layout: layout, students: students };
    const evalResult = S.Cost.evaluate(assignment, rules, ctx);
    const violationKeys = {};
    evalResult.violations.forEach(function (v) {
      if (!v.rule) return;
      const ids = (v.rule.type === 'pair' || v.rule.type === 'separate') ? [v.rule.aId, v.rule.bId] : [v.rule.aId];
      ids.forEach(function (sid) {
        for (const k in assignment) if (assignment[k] === sid) violationKeys[k] = true;
      });
    });
    // 满足的同桌规则 → 同桌底色（与网页一致，支持 2/3 人）
    const PAIR_BG = { 1: '#ecfdf5', 2: '#fffbeb', 3: '#f5f3ff' };
    const PAIR_BD = { 1: '#059669', 2: '#d97706', 3: '#7c3aed' };
    const pairColors = {}; // studentId → 1/2/3
    let pi = 0;
    (rules || []).forEach(function (rule) {
      if (rule.type !== 'pair') return;
      if (!S.Cost.ruleViolation(rule, assignment, ctx).violated) {
        pi = Math.min(pi + 1, 3);
        [rule.aId, rule.bId].forEach(function (id) { pairColors[id] = pi; });
        if (rule.cId) pairColors[rule.cId] = pi;
      }
    });

    const nameOf = {};
    students.forEach(function (s) { nameOf[s.id] = s.name; });

    const CELL_W = 130, CELL_H = 72, PODIUM_H = 44, GAP = 10, PAD = 24, AISLE_W = 26;
    const cols = layout.cols, rows = layout.rows;
    const aisles = layout.aisles || [];
    // 列 c 的 x 偏移（每个过道占 AISLE_W + GAP）
    const colOffsetX = function (c) {
      let off = 0;
      aisles.forEach(function (a) { if (a < c) off += AISLE_W + GAP; });
      return off;
    };

    const totalW = PAD * 2 + cols * (CELL_W + GAP) - GAP + aisles.length * (AISLE_W + GAP);
    const totalH = PAD * 2 + PODIUM_H + GAP + rows * (CELL_H + GAP) - GAP + 30;

    const canvas = document.createElement('canvas');
    canvas.width = totalW * 2; canvas.height = totalH * 2;
    const g = canvas.getContext('2d');
    g.scale(2, 2);

    // 背景
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, totalW, totalH);

    // 标题
    g.fillStyle = '#0f172a';
    g.font = 'bold 20px "Microsoft YaHei", sans-serif';
    g.textAlign = 'center';
    g.fillText(title || '班级座位表', totalW / 2, PAD - 4);

    // 讲台
    const podiumY = PAD + 14;
    g.fillStyle = '#eef2ff';
    g.strokeStyle = '#c7d2fe';
    g.setLineDash([5, 4]);
    g.beginPath();
    g.roundRect(totalW / 2 - 120, podiumY, 240, PODIUM_H - 14, 8);
    g.fill(); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#3730a3';
    g.font = '600 14px "Microsoft YaHei", sans-serif';
    g.fillText('讲 台', totalW / 2, podiumY + PODIUM_H / 2);

    // 过道（与网页 .aisle-gap 样式一致：浅底 + 两侧虚线 + 中缝虚线；支持多个）
    const aisleTop = podiumY + PODIUM_H + GAP;
    const aisleH = rows * (CELL_H + GAP) - GAP;
    aisles.forEach(function (a) {
      const ax = PAD + colOffsetX(a) + a * (CELL_W + GAP) + GAP + AISLE_W / 2;
      g.fillStyle = '#f8fafc';
      g.fillRect(ax - AISLE_W / 2, aisleTop, AISLE_W, aisleH);
      g.strokeStyle = '#94a3b8';
      g.lineWidth = 1.5;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(ax - AISLE_W / 2 + 1, aisleTop); g.lineTo(ax - AISLE_W / 2 + 1, aisleTop + aisleH);
      g.moveTo(ax + AISLE_W / 2 - 1, aisleTop); g.lineTo(ax + AISLE_W / 2 - 1, aisleTop + aisleH);
      g.moveTo(ax, aisleTop + 4); g.lineTo(ax, aisleTop + aisleH - 4);
      g.stroke();
      g.setLineDash([]);
    });

    // 座位
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const x = PAD + (c - 1) * (CELL_W + GAP) + colOffsetX(c);
        const y = podiumY + PODIUM_H + GAP + (r - 1) * (CELL_H + GAP);
        const key = S.Layout.seatKey(r, c);
        const unavailable = layout.unavailable.indexOf(key) >= 0;
        const areaIdx = S.Layout.areaIndexOfSeat(layout, key);
        const sid = assignment[key];

        // 底
        if (unavailable) {
          g.fillStyle = '#f1f5f9';
          g.fillRect(x, y, CELL_W, CELL_H);
          g.strokeStyle = '#cbd5e1';
          g.setLineDash([4, 3]);
        } else {
          const pColor = sid ? pairColors[sid] : null;
          g.fillStyle = pColor ? PAIR_BG[pColor] : (areaIdx >= 0 ? S.Layout.ZONE_COLORS[areaIdx % S.Layout.ZONE_COLORS.length] : '#ffffff');
          g.fillRect(x, y, CELL_W, CELL_H);
          g.strokeStyle = violationKeys[key] ? '#dc2626' : (pColor ? PAIR_BD[pColor] : '#cbd5e1');
          g.lineWidth = violationKeys[key] ? 2.5 : (pColor ? 3 : 1.2);
        }
        g.beginPath();
        g.roundRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2, 8);
        g.fill(); g.stroke();
        g.setLineDash([]);
        g.lineWidth = 1;

        // 座位号
        g.fillStyle = '#94a3b8';
        g.font = '11px "Microsoft YaHei", sans-serif';
        g.textAlign = 'center';
        g.fillText(S.Layout.seatLabel(layout, key), x + CELL_W / 2, y + 16);

        // 姓名
        if (sid && !unavailable) {
          g.fillStyle = '#0f172a';
          g.font = '600 15px "Microsoft YaHei", sans-serif';
          g.fillText(nameOf[sid] || '?', x + CELL_W / 2, y + CELL_H / 2 + 6);
          if (violationKeys[key]) {
            g.fillStyle = '#dc2626';
            g.font = 'bold 11px sans-serif';
            g.beginPath();
            g.arc(x + CELL_W - 10, y + 10, 8, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#fff';
            g.fillText('!', x + CELL_W - 10, y + 14);
          }
        } else if (!unavailable) {
          g.fillStyle = '#cbd5e1';
          g.font = '13px "Microsoft YaHei", sans-serif';
          g.fillText('空', x + CELL_W / 2, y + CELL_H / 2 + 5);
        }
      }
    }

    // 门标记（前门 + 后门，都在门那一侧；与网页一致：门形 + 竖排文字 + 把手）
    {
      const doorW = 15, doorH = 58;
      const doorX = layout.doorSide === 'right' ? totalW - PAD - doorW - 4 : PAD - doorW - 2;
      const drawDoor = function (dy, label) {
        g.fillStyle = '#fef3c7';
        g.strokeStyle = '#b45309';
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(doorX, dy, doorW, doorH, 7);
        g.fill(); g.stroke();
        g.fillStyle = '#92400e';
        g.font = '700 11px "Microsoft YaHei", sans-serif';
        g.textAlign = 'center';
        if (label.length > 1) { // 竖排两字
          g.fillText(label[0], doorX + doorW / 2, dy + doorH / 2 - 2);
          g.fillText(label[1], doorX + doorW / 2, dy + doorH / 2 + 13);
        } else {
          g.fillText(label, doorX + doorW / 2, dy + doorH / 2 + 4);
        }
        g.beginPath();
        g.arc(doorX + doorW - 4, dy + doorH / 2 - 4, 2, 0, Math.PI * 2);
        g.fill();
      };
      drawDoor(aisleTop + aisleH * 0.14, '前门');
      drawDoor(aisleTop + aisleH * 0.86 - doorH, '后门');
    }

    // 脚注
    g.fillStyle = '#94a3b8';
    g.font = '11px "Microsoft YaHei", sans-serif';
    g.fillText('生成时间：' + new Date().toLocaleString('zh-CN') + '　·　违规 ' + evalResult.violations.length + ' 条', totalW / 2, totalH - 12);

    // 用同步 toDataURL 而非异步 toBlob：避免失去用户手势导致下载被浏览器拦截
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = (title || '座位表').replace(/[\\/:*?"<>|]/g, '_') + '.png';
      a.click();
    } catch (e) {
      const t = document.getElementById('toast');
      if (t) { t.textContent = '图片导出失败：' + e.message; t.className = 'toast err'; setTimeout(function () { t.classList.add('hidden'); }, 2600); }
    }
  }

  /**
   * 导出 Excel 座位表（xlsx）；SheetJS 缺失时降级为 CSV（UTF-8 BOM，Excel 可打开）
   */
  function exportExcel(title, layout, students, assignment, rules) {
    const S = global.Seat;
    const rowsData = [];
    rowsData.push(['排', '桌', '列', '姓名', '备注']);
    for (let r = 1; r <= layout.rows; r++) {
      for (let c = 1; c <= layout.cols; c++) {
        const key = S.Layout.seatKey(r, c);
        if (layout.unavailable.indexOf(key) >= 0) {
          rowsData.push([r, '', c, '（不可用）', '']);
          continue;
        }
        const sid = assignment[key];
        const st = sid ? students.find(function (x) { return x.id === sid; }) : null;
        const desk = S.Layout.deskNo(layout, r, c);
        rowsData.push([r, desk || '', c, st ? st.name : '', st ? st.note : '']);
      }
    }
    const fname = (title || '座位表').replace(/[\\/:*?"<>|]/g, '_');

    if (typeof XLSX !== 'undefined') {
      const ws = XLSX.utils.aoa_to_sheet(rowsData);
      ws['!cols'] = [{ wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 12 }, { wch: 20 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '座位表');
      XLSX.writeFile(wb, fname + '.xlsx');
      return;
    }
    // 降级 CSV（带 BOM）
    const csv = '\uFEFF' + rowsData.map(function (row) {
      return row.map(function (cell) {
        const s = String(cell == null ? '' : cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fname + '.csv');
  }

  global.Seat = global.Seat || {};
  global.Seat.Export = { downloadBlob, exportPNG, exportExcel };
})(typeof window !== 'undefined' ? window : globalThis);
