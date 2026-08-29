/**
 * bench.js — 性能压测：50 人 + 混合规则 + 10 套方案（模拟真实使用场景）
 * 运行：node test/bench.js
 */
const path = require('path');
const JS_DIR = path.join(__dirname, '..', 'js');
require(path.join(JS_DIR, 'storage.js'));
require(path.join(JS_DIR, 'layout.js'));
require(path.join(JS_DIR, 'roster.js'));
require(path.join(JS_DIR, 'rules.js'));
require(path.join(JS_DIR, 'cost.js'));
require(path.join(JS_DIR, 'anneal.js'));
const S = globalThis.Seat;

// 50 名学生
const students = [];
for (let i = 1; i <= 50; i++) students.push({ id: 's' + i, name: '学生' + i });

// 7排×8列，3 个过道 → xx|xx|xx|xx（56 座）
const layout = S.Layout.defaultLayout();
layout.rows = 7; layout.cols = 8; layout.aisles = [2, 4, 6];

// 前排区域（前2排）
const frontSeats = [];
for (let r = 1; r <= 2; r++) for (let c = 1; c <= 8; c++) frontSeats.push(S.Layout.seatKey(r, c));
layout.areas.push({ id: 'a1', name: '前排', seats: frontSeats });

// 20 条混合规则：10 对同桌（3 硬约束）+ 5 隔离 + 3 区域 + 2 禁坐
const rules = [];
for (let i = 0; i < 10; i++) {
  rules.push({
    id: 'r_pair' + i, type: 'pair',
    aId: 's' + (i * 2 + 1), bId: 's' + (i * 2 + 2),
    weight: 50 + i * 5, hard: i < 3
  });
}
for (let i = 0; i < 5; i++) {
  rules.push({
    id: 'r_sep' + i, type: 'separate', mode: 'desk',
    aId: 's' + (20 + i * 2), bId: 's' + (20 + i * 2 + 1),
    weight: 60, hard: false
  });
}
for (let i = 0; i < 3; i++) {
  rules.push({ id: 'r_area' + i, type: 'area', aId: 's' + (30 + i), areaId: 'a1', weight: 70, hard: false });
}
rules.push({ id: 'r_ban1', type: 'ban', aId: 's40', seat: 'r7c8', weight: 80, hard: false });
rules.push({ id: 'r_ban2', type: 'ban', aId: 's41', areaId: 'a1', weight: 80, hard: false });

// 检查硬约束可满足性
const ctx = { layout, students };
const evalInit = S.Cost.evaluate({}, rules, ctx);
console.log('规则数:', rules.length, '| 学生:', students.length, '| 座位:', S.Layout.availableSeats(layout).length);

const t0 = Date.now();
const sols = S.Anneal.generateMany(students, layout, rules, 10);
const t1 = Date.now();

console.log('生成 10 套耗时:', (t1 - t0) + 'ms');
console.log('方案代价:', sols.map(s => s.totalCost).join(', '));
console.log('硬约束失败:', sols.filter(s => s.hardFailed).length, '套');

const best = sols[0];
console.log('\n最优方案违规明细:');
S.Cost.evaluate(best.assignment, rules, ctx).violations.forEach(v => console.log('  -', v.desc, v.hard ? '[硬]' : ''));
