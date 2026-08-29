/**
 * algorithm.test.js — 算法模块单测（node 内置 assert，零依赖）
 * 运行：node test/algorithm.test.js
 */
const assert = require('assert');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'js');
require(path.join(JS_DIR, 'storage.js'));
require(path.join(JS_DIR, 'layout.js'));
require(path.join(JS_DIR, 'roster.js'));
require(path.join(JS_DIR, 'rules.js'));
require(path.join(JS_DIR, 'cost.js'));
require(path.join(JS_DIR, 'anneal.js'));

const S = globalThis.Seat;

function makeStudents(names) {
  return names.map(function (n, i) { return { id: 's' + (i + 1), name: n }; });
}
function makeLayout(over) {
  const base = S.Layout.defaultLayout();
  // 默认无过道，测试自行指定
  base.aisles = [];
  return Object.assign(base, over || {});
}
/** { 学生序号(从0): 座位key } → assignment */
function makeAssignment(map) {
  const a = {};
  for (const k in map) a[map[k]] = 's' + (+k + 1);
  return a;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

/* ── 布局：多过道 / 同桌 / 桌号 ── */
console.log('— 布局（多过道/同桌/桌号）—');
test('columnGroups：多过道分组（xx|xx|xx|xx）', function () {
  const L = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6] });
  const g = S.Layout.columnGroups(L);
  assert.deepStrictEqual(g, [[1, 2], [3, 4], [5, 6], [7, 8]]);
});
test('columnGroups：3 列组（xx|xxx|xx|xx）', function () {
  const L = makeLayout({ rows: 6, cols: 9, aisles: [2, 5, 7] });
  const g = S.Layout.columnGroups(L);
  assert.deepStrictEqual(g, [[1, 2], [3, 5], [6, 7], [8, 9]]);
});
test('columnGroups：无过道', function () {
  const L = makeLayout({ rows: 3, cols: 6, aisles: [] });
  assert.deepStrictEqual(S.Layout.columnGroups(L), [[1, 6]]);
});
test('sameDesk：多过道下相邻跨组不算同桌', function () {
  const L = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6] });
  assert.ok(S.Layout.sameDesk(L, 'r1c1', 'r1c2'), 'c1-c2 同桌');
  assert.ok(S.Layout.sameDesk(L, 'r1c3', 'r1c4'), 'c3-c4 同桌');
  assert.ok(!S.Layout.sameDesk(L, 'r1c2', 'r1c3'), '跨过道不成同桌');
  assert.ok(!S.Layout.sameDesk(L, 'r1c4', 'r1c5'), '跨过道不成同桌');
  assert.ok(S.Layout.sameDesk(L, 'r1c7', 'r1c8'), 'c7-c8 同桌');
  assert.ok(!S.Layout.sameDesk(L, 'r1c1', 'r2c1'), '不同排不成同桌');
});
test('deskNo：多过道桌号全局递增', function () {
  const L = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6] });
  assert.strictEqual(S.Layout.deskNo(L, 1, 1), 1);
  assert.strictEqual(S.Layout.deskNo(L, 1, 2), 1);
  assert.strictEqual(S.Layout.deskNo(L, 1, 3), 2);
  assert.strictEqual(S.Layout.deskNo(L, 1, 4), 2);
  assert.strictEqual(S.Layout.deskNo(L, 1, 5), 3);
  assert.strictEqual(S.Layout.deskNo(L, 1, 8), 4);
});
test('sameDeskN：3 人连排判定', function () {
  const L = makeLayout({ rows: 6, cols: 9, aisles: [2, 5, 7] });
  assert.ok(S.Layout.sameDeskN(L, ['r1c3', 'r1c4', 'r1c5']), '组内 3 连应满足');
  assert.ok(!S.Layout.sameDeskN(L, ['r1c2', 'r1c3', 'r1c4']), '跨过道不成');
  assert.ok(!S.Layout.sameDeskN(L, ['r1c3', 'r1c5', 'r1c6']), '不连续不成');
  assert.ok(!S.Layout.sameDeskN(L, ['r1c3', 'r1c4', 'r2c5']), '不同排不成');
  assert.ok(S.Layout.sameDeskN(L, ['r1c1', 'r1c2']), '2 人组内相邻也满足');
});
test('availableSeats：排除不可用座位', function () {
  const L = makeLayout({ rows: 2, cols: 4, aisles: [], unavailable: ['r1c1'] });
  const av = S.Layout.availableSeats(L);
  assert.strictEqual(av.length, 7);
  assert.ok(av.indexOf('r1c1') < 0);
});
test('normalizeAisles：清洗排序去重', function () {
  assert.deepStrictEqual(S.Layout.normalizeAisles(['6', 2, 'x', 4, 2, 9], 8), [2, 4, 6]);
  assert.deepStrictEqual(S.Layout.normalizeAisles([], 8), []);
});

/* ── 代价函数 ── */
console.log('— 代价函数 —');
test('同桌规则（2 人）：满足与违反', function () {
  const students = makeStudents(['张三', '李四', '王五']);
  const L = makeLayout({ rows: 2, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'pair', aId: 's1', bId: 's2', weight: 50, hard: false };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '同桌满足应为 0 代价');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c1', 2: 'r1c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 50, '同桌违反代价 = 权重 50');
});
test('同桌规则（3 人）：满足与违反', function () {
  const students = makeStudents(['张三', '李四', '王五', '赵六']);
  const L = makeLayout({ rows: 6, cols: 9, aisles: [2, 5, 7] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'pair', aId: 's1', bId: 's2', cId: 's3', weight: 70, hard: false };
  // 组内 3 连 r1c3-r1c5 满足
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c3', 1: 'r1c4', 2: 'r1c5', 3: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '3 人连排应满足');
  // 跨过道不连续 → 违反
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c2', 1: 'r1c3', 2: 'r1c4', 3: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 70, '跨过道 3 人违反');
  // 不连续
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c3', 1: 'r1c4', 2: 'r1c6', 3: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 70, '不连续违反');
});
test('隔离规则：不同桌模式', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 2, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'separate', mode: 'desk', aId: 's1', bId: 's2', weight: 60, hard: false };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 60, '同桌 → 隔离违规');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '不同桌 → 满足');
});
test('隔离规则：曼哈顿距离且违规量随差距量化', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 6, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'separate', mode: 'manhattan', aId: 's1', bId: 's2', minDist: 3, weight: 40, hard: false };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 80, '同行隔1列 → 曼哈顿1 → 差2 → 2×40');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 80, '隔1排 → 曼哈顿1 → 差2 → 2×40');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 40, '对角隔1排1列 → 曼哈顿2 → 差1 → 1×40');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r4c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '隔3排 → 曼哈顿3 → 满足');
});
test('隔离规则：旧 mode=distance 按曼哈顿兼容', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 6, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'separate', mode: 'distance', aId: 's1', bId: 's2', minDist: 2, weight: 40, hard: false };
  const r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 40, 'distance 别名按曼哈顿：距离1 < 2 → 违规');
});
test('隔离规则：横向+竖向双阈值（mode=hv）', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 6, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'separate', mode: 'hv', aId: 's1', bId: 's2', minRows: 2, minCols: 1, weight: 40, hard: false };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 80, '竖向差0<2 → 违规量2 → 2×40');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 40, '竖向差1<2 → 违规量1');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c3' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 40, '横向达标但竖向差1<2 → 仍违规');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r3c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '竖向差2且横向差1 → 满足');
});
test('曼哈顿距离：过道计入距离', function () {
  const L = makeLayout({ rows: 3, cols: 6, aisles: [3] });
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c1', 'r1c2'), 1, '同组相邻 1 格');
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c3', 'r1c4'), 2, '跨过道相邻算 2 格');
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c3', 'r2c4'), 3, '行差1 + 列差2 = 3');
});
test('区域规则：在区域内满足，不在则违规', function () {
  const students = makeStudents(['张三']);
  const L = makeLayout({ rows: 3, cols: 4, aisles: [], areas: [{ id: 'a1', name: '前排', seats: ['r1c1', 'r1c2'] }] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'area', aId: 's1', areaId: 'a1', weight: 70, hard: false };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0);
  r = S.Cost.evaluate(makeAssignment({ 0: 'r2c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 70);
});
test('禁坐规则：具体座位与区域', function () {
  const students = makeStudents(['张三']);
  const L = makeLayout({ rows: 2, cols: 4, aisles: [], areas: [{ id: 'a1', name: '靠窗', seats: ['r1c4'] }] });
  const ctx = { layout: L, students: students };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1' }), [
    { id: 'r1', type: 'ban', aId: 's1', seat: 'r1c1', weight: 80, hard: false }
  ], ctx);
  assert.strictEqual(r.totalCost, 80, '坐在禁坐座位 → 违规');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1' }), [
    { id: 'r2', type: 'ban', aId: 's1', areaId: 'a1', weight: 80, hard: false }
  ], ctx);
  assert.strictEqual(r.totalCost, 0, '不在禁坐区域 → 满足');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c4' }), [
    { id: 'r2', type: 'ban', aId: 's1', areaId: 'a1', weight: 80, hard: false }
  ], ctx);
  assert.strictEqual(r.totalCost, 80, '坐在禁坐区域 → 违规');
});
test('硬约束：违规则方案判无效（BIG）', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 2, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'pair', aId: 's1', bId: 's2', weight: 10, hard: true };
  const r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c1' }), [rule], ctx);
  assert.ok(r.hardFailed);
  assert.strictEqual(r.totalCost, S.Cost.BIG);
});
test('增量评估器：随机交换后与全量评估一致（含 3 人同桌）', function () {
  const students = makeStudents([]);
  for (let i = 1; i <= 16; i++) students.push({ id: 's' + i, name: '学' + i });
  const L = makeLayout({ rows: 4, cols: 9, aisles: [2, 5, 7], areas: [{ id: 'a1', name: '前排', seats: ['r1c1', 'r1c2', 'r1c3'] }] });
  const ctx = { layout: L, students: students };
  const rules = [
    { id: 'r1', type: 'pair', aId: 's1', bId: 's2', cId: 's3', weight: 80, hard: true },
    { id: 'r2', type: 'separate', mode: 'manhattan', aId: 's4', bId: 's5', minDist: 3, weight: 50, hard: false },
    { id: 'r3', type: 'area', aId: 's6', areaId: 'a1', weight: 60, hard: false },
    { id: 'r4', type: 'ban', aId: 's7', seat: 'r4c9', weight: 40, hard: false },
    { id: 'r5', type: 'separate', mode: 'desk', aId: 's8', bId: 's9', weight: 30, hard: false }
  ];
  const seats = S.Layout.availableSeats(L);
  const assignment = {};
  const order = seats.slice().sort(function () { return Math.random() - .5; });
  students.forEach(function (s, i) { assignment[order[i]] = s.id; });
  const inc = S.Cost.createIncremental(assignment, rules, ctx);
  for (let step = 0; step < 300; step++) {
    const a = students[Math.floor(Math.random() * students.length)];
    let b = students[Math.floor(Math.random() * students.length)];
    if (b.id === a.id) b = students[(students.indexOf(b) + 1) % students.length];
    inc.swap(a.id, b.id);
    if (step % 25 === 0) {
      const full = S.Cost.evaluate(assignment, rules, ctx);
      assert.strictEqual(inc.totalCost, full.totalCost,
        '第' + step + '次交换后增量代价 ' + inc.totalCost + ' ≠ 全量 ' + full.totalCost);
      assert.strictEqual(inc.hardFailed, full.hardFailed, 'hardFailed 不一致');
      assert.strictEqual(inc.fullEvaluate().totalCost, full.totalCost);
    }
  }
});
test('权重叠加：多条违规代价累加', function () {
  const students = makeStudents(['张三', '李四', '王五', '赵六']);
  const L = makeLayout({ rows: 2, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  const rules = [
    { id: 'r1', type: 'pair', aId: 's1', bId: 's2', weight: 30, hard: false },
    { id: 'r2', type: 'pair', aId: 's3', bId: 's4', weight: 70, hard: false }
  ];
  const r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c3', 2: 'r1c2', 3: 'r1c4' }), rules, ctx);
  assert.strictEqual(r.totalCost, 100, '两对均未同桌 → 30+70');
});

/* ── 模拟退火 ── */
console.log('— 模拟退火 —');
test('退火：多过道下 2 人硬约束同桌全部满足', function () {
  const students = makeStudents(['张1', '张2', '张3', '张4', '张5', '张6', '张7', '张8']);
  const L = makeLayout({ rows: 4, cols: 8, aisles: [2, 4, 6] });
  const rules = [
    { id: 'r1', type: 'pair', aId: 's1', bId: 's2', weight: 90, hard: true },
    { id: 'r2', type: 'pair', aId: 's3', bId: 's4', weight: 90, hard: true },
    { id: 'r3', type: 'pair', aId: 's5', bId: 's6', weight: 90, hard: true },
    { id: 'r4', type: 'pair', aId: 's7', bId: 's8', weight: 90, hard: true }
  ];
  const r = S.Anneal.generate(students, L, rules, { rng: Math.random });
  assert.strictEqual(r.hardFailed, false, '硬约束应全部满足，实际违规: ' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
  assert.strictEqual(r.totalCost, 0);
});
test('退火：3 人硬约束同桌满足（3 列组布局）', function () {
  const students = makeStudents(['甲1', '甲2', '甲3', '乙1', '乙2', '乙3', '丙1', '丙2', '丙3']);
  const L = makeLayout({ rows: 5, cols: 9, aisles: [2, 5, 7] }); // 2+3+2+2
  const rules = [
    { id: 'r1', type: 'pair', aId: 's1', bId: 's2', cId: 's3', weight: 90, hard: true },
    { id: 'r2', type: 'pair', aId: 's4', bId: 's5', cId: 's6', weight: 90, hard: true }
  ];
  const r = S.Anneal.generate(students, L, rules, { rng: Math.random });
  assert.strictEqual(r.hardFailed, false, '3 人硬约束应满足，实际违规: ' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
});
test('退火：隔离+区域软约束显著优于随机', function () {
  const students = makeStudents([]);
  for (let i = 1; i <= 24; i++) students.push({ id: 's' + i, name: '学' + i });
  const L = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6] });
  const rules = [
    { id: 'r1', type: 'separate', mode: 'desk', aId: 's1', bId: 's2', weight: 80, hard: false },
    { id: 'r2', type: 'separate', mode: 'hv', aId: 's3', bId: 's4', minRows: 2, minCols: 1, weight: 60, hard: false },
    { id: 'r3', type: 'area', aId: 's5', areaId: 'a1', weight: 70, hard: false }
  ];
  L.areas = [{ id: 'a1', name: '前排', seats: ['r1c1', 'r1c2', 'r1c3', 'r1c4', 'r1c5', 'r1c6', 'r1c7', 'r1c8'] }];
  const ctx = { layout: L, students: students };
  const shuffled = students.slice().sort(function () { return Math.random() - .5; });
  const seats = S.Layout.availableSeats(L);
  const randomAss = {};
  shuffled.forEach(function (s, i) { randomAss[seats[i]] = s.id; });
  const randomCost = S.Cost.evaluate(randomAss, rules, ctx).totalCost;
  const r = S.Anneal.generate(students, L, rules, { rng: Math.random });
  assert.ok(r.totalCost < randomCost, '退火代价 ' + r.totalCost + ' 应低于随机 ' + randomCost);
  assert.strictEqual(Object.keys(r.assignment).length, students.length, '所有学生都应排上座');
});
test('generateMany：数量、去重、升序', function () {
  const students = makeStudents([]);
  for (let i = 1; i <= 12; i++) students.push({ id: 's' + i, name: '学' + i });
  const L = makeLayout({ rows: 3, cols: 8, aisles: [2, 4, 6] });
  const rules = [{ id: 'r1', type: 'pair', aId: 's1', bId: 's2', weight: 80, hard: false }];
  const sols = S.Anneal.generateMany(students, L, rules, 5);
  assert.strictEqual(sols.length, 5);
  const fps = sols.map(function (s) { return S.Anneal.fingerprint(s.assignment); });
  assert.strictEqual(new Set(fps).size, 5, '方案应互不相同');
  for (let i = 1; i < sols.length; i++) {
    assert.ok(sols[i - 1].totalCost <= sols[i].totalCost, '应按代价升序');
  }
});
test('generateMany：硬约束无解时标记 hardFailed', function () {
  const students = makeStudents(['A', 'B', 'C']);
  const L = makeLayout({ rows: 1, cols: 2, aisles: [] });
  // 2 列 3 人：A 不可能同时与 B、C 同桌 → 无解
  const rules = [
    { id: 'r1', type: 'pair', aId: 's1', bId: 's2', weight: 90, hard: true },
    { id: 'r2', type: 'pair', aId: 's1', bId: 's3', weight: 90, hard: true }
  ];
  const sols = S.Anneal.generateMany(students, L, rules, 3);
  sols.forEach(function (s) {
    assert.ok(s.hardFailed, '无解场景应标记 hardFailed');
  });
});

console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
