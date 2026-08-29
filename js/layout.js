/**
 * layout.js — 教室布局数据模型与工具函数
 * 座位坐标格式：'r{排}c{列}'，从 1 开始，如 'r1c2' = 第1排第2列
 * 过道模型：layout.aisles = [2,4,6] 表示过道在第 2、4、6 列后（可任意多个，空数组=无过道）
 *   e.g. 8 列 [2,4,6] → xx|xx|xx|xx（4 组每组 2 列）
 *   e.g. 9 列 [2,5,7] → xx|xxx|xx|xx（含 3 列组，可坐 3 人连排同桌）
 * 同桌：同排、列连续、同一组内（组 = 过道之间的连续列块）
 * 全局命名空间：Seat.Layout
 */
(function (global) {
  'use strict';

  /** 区域配色（与 CSS .seat.zone-N 对应） */
  const ZONE_COLORS = ['#dbeafe', '#dcfce7', '#fef9c3', '#fce7f3', '#ede9fe', '#ffedd5', '#cffafe', '#fecaca'];

  function defaultLayout() {
    return { rows: 6, cols: 8, aisles: [2, 4, 6], doorSide: 'left', unavailable: [], areas: [] };
  }

  /** 清洗过道数组：数字、范围 1..cols-1、去重、升序 */
  function normalizeAisles(aisles, cols) {
    const set = {};
    (aisles || []).forEach(function (a) {
      a = parseInt(a, 10);
      if (a >= 1 && a <= (cols - 1)) set[a] = true;
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  /** 列分组：过道之间的连续列块，如 [2,4,6] → [[1,2],[3,4],[5,6],[7,8]] */
  function columnGroups(layout) {
    const aisles = layout.aisles || [];
    const groups = [];
    let start = 1;
    aisles.forEach(function (a) {
      if (a >= start && a < layout.cols) {
        groups.push([start, a]);
        start = a + 1;
      }
    });
    groups.push([start, layout.cols]);
    return groups;
  }

  /** 列 → 所在组索引（0 起） */
  function groupIndexOf(layout, col) {
    const groups = columnGroups(layout);
    for (let i = 0; i < groups.length; i++) {
      if (col >= groups[i][0] && col <= groups[i][1]) return i;
    }
    return -1;
  }

  /** 座位 key */
  function seatKey(row, col) { return 'r' + row + 'c' + col; }

  /** 解析座位 key → {row, col}，非法返回 null */
  function parseSeatKey(key) {
    const m = /^r(\d+)c(\d+)$/.exec(key || '');
    if (!m) return null;
    return { row: +m[1], col: +m[2] };
  }

  /** 遍历所有座位 key（含不可用） */
  function allSeats(layout) {
    const out = [];
    for (let r = 1; r <= layout.rows; r++) {
      for (let c = 1; c <= layout.cols; c++) out.push(seatKey(r, c));
    }
    return out;
  }

  /** 可用座位（排除不可用） */
  function availableSeats(layout) {
    return allSeats(layout).filter(function (k) { return layout.unavailable.indexOf(k) < 0; });
  }

  /** 桌号：组内按两列一桌编号，桌号全局递增（如 xx|xx|xx|xx → 桌1/2/3/4） */
  function deskNo(layout, row, col) {
    const groups = columnGroups(layout);
    let before = 0;
    for (let i = 0; i < groups.length; i++) {
      const s = groups[i][0], e = groups[i][1];
      if (col >= s && col <= e) {
        const idx = col - s + 1;
        return before + Math.floor((idx - 1) / 2) + 1;
      }
      before += Math.ceil((e - s + 1) / 2);
    }
    return null;
  }

  /** 两个座位是否同桌：同排、相邻列、同一组（之间无过道） */
  function sameDesk(layout, keyA, keyB) {
    const a = parseSeatKey(keyA), b = parseSeatKey(keyB);
    if (!a || !b) return false;
    if (a.row !== b.row) return false;
    if (Math.abs(a.col - b.col) !== 1) return false;
    return groupIndexOf(layout, a.col) === groupIndexOf(layout, b.col);
  }

  /** N 人同桌判定：同排、列连续、同一组（用于 2/3 人同桌规则） */
  function sameDeskN(layout, keys) {
    const ps = keys.map(parseSeatKey);
    if (ps.some(function (p) { return !p; })) return false;
    if (new Set(ps.map(function (p) { return p.row; })).size !== 1) return false; // 同排
    const cols = ps.map(function (p) { return p.col; }).sort(function (a, b) { return a - b; });
    const gi = groupIndexOf(layout, cols[0]);
    for (let i = 0; i < ps.length; i++) {
      if (groupIndexOf(layout, ps[i].col) !== gi) return false; // 同一组
    }
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] !== cols[i - 1] + 1) return false; // 列连续
    }
    return true;
  }

  /** 两座位行距/列距（绝对值） */
  function seatDistance(keyA, keyB) {
    const a = parseSeatKey(keyA), b = parseSeatKey(keyB);
    if (!a || !b) return { dr: 9999, dc: 9999 };
    return { dr: Math.abs(a.row - b.row), dc: Math.abs(a.col - b.col) };
  }

  /** 两座位曼哈顿距离：|Δ排| + |Δ列|，列按含过道的网格坐标计（过道占一轨） */
  function manhattanDistance(layout, keyA, keyB) {
    const a = parseSeatKey(keyA), b = parseSeatKey(keyB);
    if (!a || !b) return 9999;
    return Math.abs(a.row - b.row) + Math.abs(gridColIndex(layout, a.col) - gridColIndex(layout, b.col));
  }

  /** 列 c 在 grid 中的列索引（每个过道占一个额外轨道） */
  function gridColIndex(layout, col) {
    let off = 0;
    (layout.aisles || []).forEach(function (a) { if (a < col) off++; });
    return col + off;
  }

  /** 过道 a（在第 a 列后）在 grid 中的列索引 */
  function gridAisleIndex(layout, a) {
    let off = 0;
    (layout.aisles || []).forEach(function (x) { if (x < a) off++; });
    return a + off + 1;
  }

  /** 座位 → 所在区域 id（第一个匹配；无则 null） */
  function areaOfSeat(layout, key) {
    const areas = layout.areas || [];
    for (let i = 0; i < areas.length; i++) {
      if (areas[i].seats.indexOf(key) >= 0) return areas[i].id;
    }
    return null;
  }

  /** 座位 → 所在区域索引（用于取颜色） */
  function areaIndexOfSeat(layout, key) {
    const areas = layout.areas || [];
    for (let i = 0; i < areas.length; i++) {
      if (areas[i].seats.indexOf(key) >= 0) return i;
    }
    return -1;
  }

  /** 显示列号：列从门那边数（门左 → 原样；门右 → 镜像） */
  function displayCol(layout, col) {
    return layout.doorSide === 'right' ? (layout.cols - col + 1) : col;
  }

  /** 座位显示文案：(排,列) 坐标，列号从门那边数 */
  function seatLabel(layout, key) {
    const p = parseSeatKey(key);
    if (!p) return '';
    return '(' + p.row + ',' + displayCol(layout, p.col) + ')';
  }

  /* ── 区域 CRUD ── */

  function addArea(layout, name) {
    const area = { id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || ('区域' + (layout.areas.length + 1)), seats: [] };
    layout.areas.push(area);
    return area;
  }

  function renameArea(layout, areaId, name) {
    const a = findArea(layout, areaId);
    if (a) a.name = name;
  }

  function removeArea(layout, areaId) {
    layout.areas = layout.areas.filter(function (a) { return a.id !== areaId; });
  }

  function findArea(layout, areaId) {
    return (layout.areas || []).find(function (a) { return a.id === areaId; }) || null;
  }

  /** 切换座位是否属于某区域，返回新状态 */
  function toggleAreaSeat(layout, areaId, key) {
    const a = findArea(layout, areaId);
    if (!a) return false;
    const idx = a.seats.indexOf(key);
    if (idx >= 0) a.seats.splice(idx, 1);
    else a.seats.push(key);
    return true;
  }

  /** 班级是否满足生成条件 */
  function canGenerate(layout, studentCount) {
    const avail = availableSeats(layout).length;
    return { ok: avail >= studentCount, avail: avail, need: studentCount };
  }

  global.Seat = global.Seat || {};
  global.Seat.Layout = {
    ZONE_COLORS, defaultLayout, normalizeAisles, columnGroups, groupIndexOf,
    seatKey, parseSeatKey, allSeats, availableSeats,
    deskNo, sameDesk, sameDeskN, seatDistance, manhattanDistance, gridColIndex, gridAisleIndex, displayCol,
    areaOfSeat, areaIndexOfSeat, seatLabel,
    addArea, renameArea, removeArea, findArea, toggleAreaSeat, canGenerate
  };
})(typeof window !== 'undefined' ? window : globalThis);
