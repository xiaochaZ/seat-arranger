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
require(path.join(JS_DIR, 'groups.js'));
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
test('隔离规则：周围范围（mode=hv，禁止坐在对方前后 N 排 × 左右 M 座内）', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 8, cols: 4, aisles: [] });
  const ctx = { layout: L, students: students };
  // 前后 1 排 / 左右 1 座 → 对方周围 3×3 的八个邻座都不能坐（同桌也不行）
  const r11 = { id: 'r1', type: 'separate', mode: 'hv', aId: 's1', bId: 's2', minRows: 1, minCols: 1, weight: 40, hard: false };
  const check = function (rule, key2) {
    return S.Cost.evaluate(makeAssignment({ 0: 'r3c2', 1: key2 }), [rule], ctx);
  };
  assert.ok(check(r11, 'r3c1').totalCost > 0, '左邻座 → 违规');
  assert.ok(check(r11, 'r3c3').totalCost > 0, '右邻座 → 违规');
  assert.ok(check(r11, 'r2c2').totalCost > 0, '前排同列 → 违规');
  assert.ok(check(r11, 'r4c2').totalCost > 0, '后排同列 → 违规');
  assert.ok(check(r11, 'r2c1').totalCost > 0, '斜前左 → 违规');
  assert.ok(check(r11, 'r4c3').totalCost > 0, '斜后右 → 违规');
  assert.strictEqual(check(r11, 'r3c4').totalCost, 0, '同排隔 2 座 → 达标');
  assert.strictEqual(check(r11, 'r5c2').totalCost, 0, '隔 2 排同列 → 达标');
  assert.strictEqual(check(r11, 'r8c1').totalCost, 0, '隔 7 排、同列 → 达标（用户原例）');
  // 前后 2 排 / 左右 1 座：范围变大
  const r21 = { id: 'r2', type: 'separate', mode: 'hv', aId: 's1', bId: 's2', minRows: 2, minCols: 1, weight: 40, hard: false };
  assert.ok(check(r21, 'r4c3').totalCost > 0, '斜后右（前后 2 内）→ 违规');
  assert.strictEqual(check(r21, 'r6c2').totalCost, 0, '隔 3 排 → 达标');
  assert.strictEqual(check(r21, 'r3c4').totalCost, 0, '同排左右 2 座外 → 达标');
});
test('隔离规则：hv 填 0 的方向只看"正同一排/列"（不是"不限"）', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 8, cols: 6, aisles: [] });
  const ctx = { layout: L, students: students };
  const check = function (rule, key2) {
    return S.Cost.evaluate(makeAssignment({ 0: 'r4c3', 1: key2 }), [rule], ctx);
  };
  // 左右 1 座（前后 0）：只有同一排的左右邻座不行，前后不限
  const onlyCols = { id: 'r1', type: 'separate', mode: 'hv', aId: 's1', bId: 's2', minRows: 0, minCols: 1, weight: 40, hard: false };
  assert.ok(check(onlyCols, 'r4c2').totalCost > 0, '同排左邻 → 违规');
  assert.ok(check(onlyCols, 'r4c4').totalCost > 0, '同排右邻 → 违规');
  assert.strictEqual(check(onlyCols, 'r3c3').totalCost, 0, '正前方同列 → 达标（前后不限）');
  assert.strictEqual(check(onlyCols, 'r8c3').totalCost, 0, '正后方同列 → 达标');
  assert.strictEqual(check(onlyCols, 'r4c1').totalCost, 0, '同排隔 2 座 → 达标');
  assert.strictEqual(check(onlyCols, 'r3c4').totalCost, 0, '斜前（不同排）→ 达标');
  // 前后 2 排（左右 0）：只有同一列的前后 2 排不行
  const onlyRows = { id: 'r2', type: 'separate', mode: 'hv', aId: 's1', bId: 's2', minRows: 2, minCols: 0, weight: 40, hard: false };
  assert.ok(check(onlyRows, 'r3c3').totalCost > 0, '同一列前一排 → 违规');
  assert.ok(check(onlyRows, 'r6c3').totalCost > 0, '同一列后两排 → 违规');
  assert.strictEqual(check(onlyRows, 'r7c3').totalCost, 0, '同一列隔 3 排 → 达标');
  assert.strictEqual(check(onlyRows, 'r4c5').totalCost, 0, '同排（不同列）→ 达标');
  assert.strictEqual(check(onlyRows, 'r3c4').totalCost, 0, '斜前（不同列）→ 达标');
  // 两个都为 0 → 无实际约束
  const none = { id: 'r3', type: 'separate', mode: 'hv', aId: 's1', bId: 's2', minRows: 0, minCols: 0, weight: 40, hard: false };
  assert.strictEqual(check(none, 'r4c4').totalCost, 0);
});
test('曼哈顿距离：过道不计入（隔着过道也是相邻 1 格）', function () {
  const L = makeLayout({ rows: 3, cols: 6, aisles: [3] });
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c1', 'r1c2'), 1, '同组相邻 1 格');
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c3', 'r1c4'), 1, '跨过道相邻仍是 1 格（过道不算一格）');
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c2', 'r1c4'), 2, '隔 1 列（跨过道）也是 2 格');
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c3', 'r2c4'), 2, '行差1 + 列差1 = 2');
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c1', 'r1c6'), 5, '列差按座位列数，不叠加过道');
  // 与 seatDistance 的列差一致（同一套几何，避免两处算法打架）
  const p = S.Layout.seatDistance('r1c2', 'r1c3');
  assert.strictEqual(S.Layout.manhattanDistance(L, 'r1c2', 'r1c3'), p.dr + p.dc, '与 seatDistance 一致');
});
test('隔离规则（曼哈顿）：跨过道相邻只算 1 格 → 仍违规', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 3, cols: 6, aisles: [3] });
  const ctx = { layout: L, students: students };
  const rule = { id: 'r1', type: 'separate', mode: 'manhattan', aId: 's1', bId: 's2', minDist: 2, weight: 40, hard: false };
  // 隔着过道的左右邻座：距离 1 → 差 1 → 1×40（旧算法会算成 2 而误判满足）
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c3', 1: 'r1c4' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 40, '跨过道相邻只算 1 格 → 违规');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c3', 1: 'r1c5' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '同排隔 2 列 → 距离 2 → 满足');
});
test('讲台方位：只影响显示（visualRow 映射）', function () {
  const top = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6] });
  assert.strictEqual(S.Layout.podiumSide(top), 'top', '默认讲台在上');
  assert.strictEqual(S.Layout.visualRow(top, 1), 1, '讲台在上：r1 在最上行');
  assert.strictEqual(S.Layout.visualRow(top, 6), 6, '讲台在上：r6 在最下行');
  const bottom = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6], podiumSide: 'bottom' });
  assert.strictEqual(S.Layout.podiumSide(bottom), 'bottom');
  assert.strictEqual(S.Layout.visualRow(bottom, 1), 6, '讲台在下：r1 在最下行（靠讲台）');
  assert.strictEqual(S.Layout.visualRow(bottom, 6), 1, '讲台在下：r6 在最上行（靠后门）');
  // 与算法无关：同样两个座位的距离/同桌判定不因讲台方位变化
  assert.strictEqual(S.Layout.manhattanDistance(bottom, 'r1c1', 'r2c2'), 2);
  assert.ok(S.Layout.sameDesk(bottom, 'r1c1', 'r1c2'), '同桌判定不受讲台方位影响');
});
test('座位显示坐标：(列,排)，列号从门那侧数', function () {
  const L = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6] });
  assert.strictEqual(S.Layout.seatLabel(L, 'r5c3'), '(3,5)', '第3列第5排应显示 (3,5)');
  assert.strictEqual(S.Layout.seatLabel(L, 'r1c1'), '(1,1)');
  assert.strictEqual(S.Layout.seatLabel(L, 'r6c8'), '(8,6)');
  // 门在右 → 列号镜像（从门那侧数），仍是列在前
  const R = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6], doorSide: 'right' });
  assert.strictEqual(S.Layout.displayCol(R, 3), 6);
  assert.strictEqual(S.Layout.seatLabel(R, 'r5c3'), '(6,5)', '门在右时同一座位显示为第 6 列');
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
test('退火：隔离+区域软约束全部满足（且不劣于随机）', function () {
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
  // 三条软约束可以同时满足 → 退火应稳定收敛到 0 代价（旧断言 "优于随机" 会因随机基线偶尔恰好为 0 而误报）
  assert.strictEqual(r.totalCost, 0, '软约束应全部满足，实际代价 ' + r.totalCost + '：' +
    JSON.stringify(r.violations.map(function (v) { return v.desc; })));
  assert.ok(r.totalCost <= randomCost, '退火代价不应高于随机（退火 ' + r.totalCost + ' vs 随机 ' + randomCost + '）');
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

/* ── 学生小组 ── */
console.log('— 学生小组（Groups）—');
test('Groups：建组去重 / 查重名 / 成员与配对', function () {
  const state = {
    version: 1,
    classes: [{ id: 'c1', name: '甲班', students: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }],
    currentClassId: 'c1',
    data: { c1: { layout: S.Layout.defaultLayout(), rules: [], groups: [], solutions: [], currentSolutionId: null } }
  };
  const g = S.Groups.add(state, '第一组', ['s1', 's2', 's2']);
  assert.strictEqual(g.memberIds.length, 2, '成员应去重');
  const g2 = S.Groups.add(state, '第二组', ['s3']);
  assert.strictEqual(S.Groups.groupsOf(state).length, 2);
  assert.strictEqual(S.Groups.uniqueName(S.Groups.groupsOf(state), '第一组'), '第一组2');
  assert.strictEqual(S.Groups.pairs(g).length, 1, '2 人组只有 1 对');
  assert.strictEqual(S.Groups.pairs(g2).length, 0);
  assert.ok(S.Groups.hasMember(S.Groups.groupsOf(state), g.id, 's1'));
  assert.strictEqual(S.Groups.toggleMember(S.Groups.groupsOf(state), g.id, 's3'), true, '加入新成员返回 true');
  assert.strictEqual(S.Groups.toggleMember(S.Groups.groupsOf(state), g.id, 's3'), false, '再点一次移出');
  assert.strictEqual(S.Groups.describe(g, state.classes[0].students), '第一组（2 人）');
});
test('Groups：清理失效成员 / 删除小组连带删除引用它的规则', function () {
  const state = {
    version: 1,
    classes: [{ id: 'c1', name: '甲班', students: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }],
    currentClassId: 'c1',
    data: { c1: { layout: S.Layout.defaultLayout(), rules: [], groups: [], solutions: [], currentSolutionId: null } }
  };
  const g = S.Groups.add(state, '第一组', ['s1', 's2']);
  S.Groups.add(state, '第二组', ['s3']);
  state.classes[0].students = [{ id: 's1' }];       // s2、s3 被删除
  assert.strictEqual(S.Groups.cleanup(state), true);
  assert.strictEqual(S.Groups.groupsOf(state).length, 1, '只剩有成员的组');
  assert.deepStrictEqual(S.Groups.groupsOf(state)[0].memberIds, ['s1']);
  state.data.c1.rules = [
    { id: 'r1', type: 'group', groupId: g.id },
    { id: 'r2', type: 'pair', aId: 's1', bId: 's1' }
  ];
  assert.strictEqual(S.Groups.ruleRefCount(state, g.id), 1);
  assert.strictEqual(S.Groups.removeWithRules(state, g.id), 1, '应连带移除 1 条规则');
  assert.strictEqual(S.Groups.groupsOf(state).length, 0);
  assert.strictEqual(state.data.c1.rules.length, 1);
});

/* ── 新规则：小组保持距离 / 固定座位 ── */
console.log('— 规则：小组保持距离 / 固定座位 —');
test('小组规则：曼哈顿距离（组内两两判定）', function () {
  const students = makeStudents(['A', 'B', 'C', 'D']);
  const L = makeLayout({ rows: 4, cols: 5, aisles: [] });
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const rule = { id: 'r1', type: 'group', groupId: 'g1', mode: 'manhattan', minDist: 3, weight: 50, hard: false };
  // s1(1,1)–s2(1,4)=3 ✓；s1–s3(3,4)=5 ✓；s2–s3=2 ✗（差 1 格）
  const r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c4', 2: 'r3c4', 3: 'r4c5' }), [rule], ctx);
  assert.strictEqual(r.violations.length, 1, '只有一对不达标');
  assert.strictEqual(r.totalCost, 50 * 1, '违规量 = 差 1 格 → 权重×1');
  // 全部达标：s1(1,1) s2(4,1)=3 ✓、s1–s3(2,4)=4 ✓、s2–s3=5 ✓
  const ok = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r4c1', 2: 'r2c4', 3: 'r3c3' }), [rule], ctx);
  assert.strictEqual(ok.totalCost, 0);
});
test('小组规则：不能同桌 / 横向竖向双阈值', function () {
  const students = makeStudents(['A', 'B', 'C', 'D']);
  const L = makeLayout({ rows: 3, cols: 4, aisles: [] });
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const deskRule = { id: 'r1', type: 'group', groupId: 'g1', mode: 'desk', weight: 40, hard: false };
  // s1(1,1) 与 s2(1,2) 同桌 → 1 对违规
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1', 3: 'r2c2' }), [deskRule], ctx);
  assert.strictEqual(r.totalCost, 40);
  // s1(1,1) 与 s2(3,1) 不同排但隔过道…此处无过道 → 不算同桌
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r3c1', 2: 'r2c2', 3: 'r2c3' }), [deskRule], ctx);
  assert.strictEqual(r.totalCost, 0);
  const hvRule = { id: 'r2', type: 'group', groupId: 'g1', mode: 'hv', minRows: 2, minCols: 0, weight: 30, hard: false };
  // 前后 2 排（只看同一列）：s1(1,1) s2(3,1) 仍算违规（正好卡在边界内）；s3(2,1) 与两者都在范围内
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r3c1', 2: 'r2c1', 3: 'r3c4' }), [hvRule], ctx);
  assert.strictEqual(r.totalCost, 30 * 3, '同列三对都在前后 2 排范围内 → 3 对违规');
  // 组内 hv 同样是"周围范围"：前后 2 / 左右 2 时，同排隔 3 座是不行的
  const hvBoth = { id: 'r3', type: 'group', groupId: 'g1', mode: 'hv', minRows: 2, minCols: 2, weight: 30, hard: false };
  const L2 = makeLayout({ rows: 6, cols: 6, aisles: [] });
  const ctx2 = { layout: L2, students: students, groups: groups };
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c4', 2: 'r6c4', 3: 'r6c6' }), [hvBoth], ctx2);
  assert.strictEqual(r.totalCost, 0, '横向隔 3 座、竖向隔 5 排 → 都超出范围 → 达标');
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c2', 2: 'r5c1', 3: 'r6c6' }), [hvBoth], ctx2);
  assert.strictEqual(r.totalCost, 30 * 2, '斜邻（前后1/左右1，在 5×5 范围内）→ 1 对违规，走出范围还差 2 步');
});
test('小组规则：小组不存在 / 成员不足 / 未排座', function () {
  const students = makeStudents(['A', 'B', 'C']);
  const L = makeLayout({ rows: 2, cols: 4, aisles: [] });
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const miss = { id: 'r0', type: 'group', groupId: 'nope', mode: 'desk', weight: 50, hard: true };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1' }), [miss], ctx);
  assert.strictEqual(r.totalCost, 0, '小组不存在 → 规则不生效，不应产生硬违规');
  assert.strictEqual(r.hardFailed, false);
  const one = { id: 'r1', type: 'group', groupId: 'g1', mode: 'desk', weight: 50, hard: false };
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1' }), [one], ctx);
  assert.strictEqual(r.totalCost, 0, '成员不足 2 人 → 不判定');
});
test('固定座位规则：满足 / 违反 / 座位失效暂停', function () {
  const students = makeStudents(['A', 'B']);
  const L = makeLayout({ rows: 2, cols: 2, aisles: [] });
  const ctx = { layout: L, students: students, groups: [] };
  const rule = { id: 'r1', type: 'fixed', aId: 's1', seat: 'r1c1', weight: 50, hard: true };
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0);
  assert.strictEqual(r.hardFailed, false);
  r = S.Cost.evaluate(makeAssignment({ 0: 'r2c2', 1: 'r1c1' }), [rule], ctx);
  assert.strictEqual(r.totalCost, S.Cost.BIG);
  assert.strictEqual(r.hardFailed, true);
  // 座位被标记不可用 → 锁定暂停（不产生代价，也不判硬失败）
  const L2 = makeLayout({ rows: 2, cols: 2, aisles: [], unavailable: ['r1c1'] });
  r = S.Cost.evaluate(makeAssignment({ 0: 'r2c2', 1: 'r2c1' }), [rule], { layout: L2, students: students, groups: [] });
  assert.strictEqual(r.totalCost, 0);
  assert.strictEqual(r.hardFailed, false);
});
test('pinsOf：只收硬约束，冲突先到先得，失效座位忽略', function () {
  const L = makeLayout({ rows: 3, cols: 3, aisles: [], unavailable: ['r3c3'] });
  const rules = [
    { id: 'r1', type: 'fixed', aId: 's1', seat: 'r1c1', hard: true },
    { id: 'r2', type: 'fixed', aId: 's2', seat: 'r2c2', hard: false },
    { id: 'r3', type: 'fixed', aId: 's1', seat: 'r3c1', hard: true },
    { id: 'r4', type: 'fixed', aId: 's3', seat: 'r1c1', hard: true },
    { id: 'r5', type: 'fixed', aId: 's4', seat: 'r3c3', hard: true }
  ];
  const pins = S.Rules.pinsOf(rules, L);
  assert.deepStrictEqual(Object.keys(pins.byStudent), ['s1']);
  assert.strictEqual(pins.byStudent.s1, 'r1c1');
  assert.deepStrictEqual(Object.keys(pins.bySeat), ['r1c1']);
});
test('规则描述与类型名：小组 / 固定座位', function () {
  const students = makeStudents(['张三', '李四']);
  const L = makeLayout({ rows: 3, cols: 3, aisles: [] });
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2'] }];
  assert.strictEqual(S.Rules.TYPE_NAMES.group, '小组');
  assert.strictEqual(S.Rules.TYPE_NAMES.fixed, '固定座位');
  const gd = S.Rules.describeRule({ type: 'group', groupId: 'g1', mode: 'manhattan', minDist: 3 }, students, L, groups);
  assert.ok(gd.indexOf('第一组') >= 0 && gd.indexOf('3 格') >= 0, gd);
  const fd = S.Rules.describeRule({ type: 'fixed', aId: 's1', seat: 'r2c2' }, students, L, groups);
  assert.ok(fd.indexOf('张三') >= 0 && fd.indexOf('(2,2)') >= 0, fd);
  // 座位不可用时描述给出提示
  const L2 = makeLayout({ rows: 3, cols: 3, aisles: [], unavailable: ['r2c2'] });
  assert.ok(S.Rules.describeRule({ type: 'fixed', aId: 's1', seat: 'r2c2' }, students, L2, groups).indexOf('不可用') >= 0);
});

/* ── 新增规则的退火与增量一致性 ── */
console.log('— 退火/增量：固定座位与小组 —');
test('退火：硬锁定固定座位必被满足，且全员有座', function () {
  const students = makeStudents(['甲', '乙', '丙', '丁', '戊', '己']);
  const L = makeLayout({ rows: 3, cols: 4, aisles: [] });
  const rules = [
    { id: 'r1', type: 'fixed', aId: 's3', seat: 'r2c3', weight: 60, hard: true },
    { id: 'r2', type: 'fixed', aId: 's1', seat: 'r1c4', weight: 60, hard: true },
    { id: 'r3', type: 'pair', aId: 's5', bId: 's6', weight: 90, hard: true }
  ];
  for (let i = 0; i < 5; i++) {
    const r = S.Anneal.generate(students, L, rules, { rng: Math.random });
    assert.strictEqual(r.assignment['r2c3'], 's3', '锁定学生必须在锁定座位');
    assert.strictEqual(r.assignment['r1c4'], 's1', '第二个锁定学生也要就位');
    assert.strictEqual(Object.keys(r.assignment).length, students.length, '每人都有座位');
    assert.strictEqual(r.hardFailed, false,
      '硬约束应满足：' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
  }
});
test('退火：小组硬隔离（4 人两两相距≥3格）可满足', function () {
  const students = makeStudents(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  const L = makeLayout({ rows: 6, cols: 8, aisles: [2, 4, 6] });
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3', 's4'] }];
  const rules = [{ id: 'r1', type: 'group', groupId: 'g1', mode: 'manhattan', minDist: 3, weight: 90, hard: true }];
  const r = S.Anneal.generate(students, L, rules, { rng: Math.random, groups: groups });
  assert.strictEqual(r.hardFailed, false,
    '小组硬隔离应满足：' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
});
test('退火：软约束固定座位倾向满足（权重高时）', function () {
  const students = makeStudents(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛']);
  const L = makeLayout({ rows: 4, cols: 4, aisles: [] });
  const rules = [{ id: 'r1', type: 'fixed', aId: 's4', seat: 'r3c3', weight: 100, hard: false }];
  const r = S.Anneal.generate(students, L, rules, { rng: Math.random });
  assert.strictEqual(r.assignment['r3c3'], 's4', '软固定座位在高权重下也应落到目标座位');
  assert.strictEqual(r.hardFailed, false);
});
test('增量评估器：含小组与固定座位规则时与全量一致', function () {
  const students = [];
  for (let i = 1; i <= 18; i++) students.push({ id: 's' + i, name: '学' + i });
  const L = makeLayout({ rows: 4, cols: 9, aisles: [2, 5, 7] });
  const groups = [
    { id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3', 's4'] },
    { id: 'g2', name: '第二组', memberIds: ['s5', 's6'] }
  ];
  const ctx = { layout: L, students: students, groups: groups };
  const rules = [
    { id: 'r1', type: 'group', groupId: 'g1', mode: 'manhattan', minDist: 3, weight: 70, hard: false },
    { id: 'r2', type: 'group', groupId: 'g2', mode: 'desk', weight: 50, hard: false },
    { id: 'r3', type: 'group', groupId: 'g1', mode: 'hv', minRows: 1, minCols: 2, weight: 20, hard: false },
    { id: 'r4', type: 'fixed', aId: 's10', seat: 'r4c9', weight: 40, hard: false },
    { id: 'r5', type: 'fixed', aId: 's11', seat: 'r1c1', weight: 40, hard: true }
  ];
  const seats = S.Layout.availableSeats(L);
  const assignment = {};
  const order = seats.slice().sort(function () { return Math.random() - .5; });
  students.forEach(function (s, i) { assignment[order[i]] = s.id; });
  const inc = S.Cost.createIncremental(assignment, rules, ctx);
  for (let step = 0; step < 400; step++) {
    const a = students[Math.floor(Math.random() * students.length)];
    let b = students[Math.floor(Math.random() * students.length)];
    if (b.id === a.id) b = students[(students.indexOf(b) + 1) % students.length];
    inc.swap(a.id, b.id);
    if (step % 40 === 0) {
      const full = S.Cost.evaluate(assignment, rules, ctx);
      assert.strictEqual(inc.totalCost, full.totalCost,
        '第' + step + '次交换后增量代价 ' + inc.totalCost + ' ≠ 全量 ' + full.totalCost);
      assert.strictEqual(inc.hardFailed, full.hardFailed, 'hardFailed 不一致');
      assert.strictEqual(inc.fullEvaluate().violations.length, full.violations.length, '违规条数不一致');
    }
  }
});

/* ── 小组「聚成一块」（block） ── */
console.log('— 规则：小组聚成一块 —');
test('小组聚块：2×2 同桌矩形 → 满足；分散 → 违规', function () {
  const students = makeStudents(['A', 'B', 'C', 'D', 'E']);
  const L = makeLayout({ rows: 4, cols: 6, aisles: [2, 4] });   // 组 [1,2][3,4][5,6]
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3', 's4'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const rule = { id: 'r1', type: 'group', groupId: 'g1', mode: 'block', weight: 50, hard: false };
  // 2×2 同桌块（r1c1-r1c2 同桌、r2c1-r2c2 同桌，包围盒 2×2 无空位）
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1', 3: 'r2c2', 4: 'r4c6' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '紧凑同桌矩形应满足：' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
  // 四个人各占一排一列 → 同桌 0 对、包围盒 4×4=16 格空 12 格
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r2c4', 2: 'r3c6', 3: 'r4c2', 4: 'r1c6' }), [rule], ctx);
  assert.ok(r.totalCost > 0, '分散应违规');
  assert.ok(r.violations[0].desc.indexOf('未聚成一块') >= 0, r.violations[0].desc);
});
test('小组聚块：同桌但拉成一长条 → 按空位计罚（软性，不判硬失败）', function () {
  const students = makeStudents(['A', 'B', 'C', 'D']);
  const L = makeLayout({ rows: 5, cols: 4, aisles: [2] });      // 组 [1,2][3,4]
  const groups = [{ id: 'g1', name: 'G', memberIds: ['s1', 's2', 's3', 's4'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const rule = { id: 'r1', type: 'group', groupId: 'g1', mode: 'block', weight: 10, hard: false };
  // 两对同桌但分处第 1 排和第 4 排 → 包围盒 4×2=8 格，4 人占 4、理论最紧凑 4 → 计罚 4
  const r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r4c1', 3: 'r4c2' }), [rule], ctx);
  assert.strictEqual(r.violations.length, 1);
  assert.strictEqual(r.violations[0].amount, 4, '包围盒多出 4 格 → 违规量 4');
  assert.strictEqual(r.totalCost, 40);
  assert.strictEqual(r.violations[0].soft, true, '"够不够紧凑"属于偏好项');
  // 换成硬约束：同样只有紧凑度不达标 → 不判失败，但仍按权重拉优化
  const hardRule = { id: 'r2', type: 'group', groupId: 'g1', mode: 'block', weight: 20, hard: true };
  const rh = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r4c1', 3: 'r4c2' }), [hardRule], ctx);
  assert.strictEqual(rh.hardFailed, false, '微调项不应让硬约束判失败');
  assert.strictEqual(rh.totalCost, 20 * 4, '硬约束的偏好项按普通权重计价');
  // 但"没和组员同桌"是硬要求 → 必须判失败
  const rp = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r3c1', 2: 'r5c3', 3: 'r5c4' }), [hardRule], ctx);
  assert.strictEqual(rp.hardFailed, true, '同桌是硬要求');
  assert.strictEqual(rp.totalCost >= S.Cost.BIG, true);
});
test('小组聚块：区域恰好等于组员数时也算聚块成功（空间受限不再误判）', function () {
  const students = makeStudents(['A', 'B', 'C', 'D', 'E', 'F']);
  const L = makeLayout({ rows: 4, cols: 6, aisles: [2, 4] });
  // 区域 2 排 × 4 列中恰好 6 个座位：6 人全坐进去，同桌成对即可，不该因为"包围盒 8 格"判失败
  L.areas = [{ id: 'a1', name: '前排', seats: ['r1c1', 'r1c2', 'r1c3', 'r1c4', 'r2c1', 'r2c2'] }];
  const groups = [{ id: 'g1', name: 'G', memberIds: ['s1', 's2', 's3', 's4', 's5', 's6'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const rule = { id: 'r1', type: 'group', groupId: 'g1', mode: 'block', areaId: 'a1', weight: 80, hard: true };
  const r = S.Cost.evaluate(
    makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r1c3', 3: 'r1c4', 4: 'r2c1', 5: 'r2c2' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0, '应满足：' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
  assert.strictEqual(r.hardFailed, false);
});

test('小组聚块：奇数人允许 1 人落单', function () {
  const students = makeStudents(['A', 'B', 'C']);
  const L = makeLayout({ rows: 3, cols: 4, aisles: [] });
  const groups = [{ id: 'g1', name: 'G', memberIds: ['s1', 's2', 's3'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const rule = { id: 'r1', type: 'group', groupId: 'g1', mode: 'block', weight: 10, hard: true };
  // 1×3 一行：两人同桌 + 1 人落单 → 可满足
  const r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r1c3' }), [rule], ctx);
  assert.strictEqual(r.totalCost, 0);
  assert.strictEqual(r.hardFailed, false);
});
test('小组聚块：同一区域要求（未指定区域时按众数区域判定）', function () {
  const students = makeStudents(['A', 'B', 'C', 'D']);
  const L = makeLayout({
    rows: 4, cols: 4, aisles: [],
    areas: [
      { id: 'a1', name: '前排', seats: ['r1c1', 'r1c2', 'r2c1', 'r2c2'] },
      { id: 'a2', name: '后排', seats: ['r3c1', 'r3c2', 'r4c1', 'r4c2'] }
    ]
  });
  const groups = [{ id: 'g1', name: 'G', memberIds: ['s1', 's2', 's3', 's4'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const anyArea = { id: 'r1', type: 'group', groupId: 'g1', mode: 'block', weight: 10, hard: false };
  // 全在前排 2×2 → 满足
  let r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1', 3: 'r2c2' }), [anyArea], ctx);
  assert.strictEqual(r.totalCost, 0, JSON.stringify(r.violations.map(function (v) { return v.desc; })));
  // 一半前排一半后排 → 区域子项罚 2（另加包围盒空位）
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1', 3: 'r2c2' }), [anyArea], ctx);
  const split = S.Cost.evaluate(makeAssignment({ 0: 'r2c1', 1: 'r2c2', 2: 'r3c1', 3: 'r3c2' }), [anyArea], ctx);
  assert.ok(split.violations[0].desc.indexOf('未落在同一区域') >= 0, split.violations[0].desc);
  // 指定区域：全在后排 → 满足
  const target = { id: 'r2', type: 'group', groupId: 'g1', mode: 'block', areaId: 'a2', weight: 10, hard: false };
  r = S.Cost.evaluate(makeAssignment({ 0: 'r3c1', 1: 'r3c2', 2: 'r4c1', 3: 'r4c2' }), [target], ctx);
  assert.strictEqual(r.totalCost, 0);
  // 指定区域：坐在前排 → 区域子项罚 4（不在指定区域内）
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1', 3: 'r2c2' }), [target], ctx);
  assert.ok(r.violations[0].desc.indexOf('后排') >= 0, r.violations[0].desc);
  assert.strictEqual(r.hardFailed, false, '区域未达成属于硬要求，但此处规则为软约束');
  const hardTarget = { id: 'r3', type: 'group', groupId: 'g1', mode: 'block', areaId: 'a2', weight: 10, hard: true };
  r = S.Cost.evaluate(makeAssignment({ 0: 'r1c1', 1: 'r1c2', 2: 'r2c1', 3: 'r2c2' }), [hardTarget], ctx);
  assert.strictEqual(r.hardFailed, true, '硬约束下"不在指定区域"必须判失败');
});
test('退火：硬约束「聚成一块」能把 6 人拼成矩形', function () {
  const students = makeStudents(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  const L = makeLayout({ rows: 5, cols: 8, aisles: [2, 4, 6] });
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3', 's4', 's5', 's6'] }];
  const rules = [{ id: 'r1', type: 'group', groupId: 'g1', mode: 'block', weight: 90, hard: true }];
  for (let i = 0; i < 5; i++) {
    const r = S.Anneal.generate(students, L, rules, { rng: Math.random, groups: groups });
    assert.strictEqual(r.hardFailed, false,
      '聚块硬约束应满足：' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
    // 6 人应落在 3×2 或 2×3 这类紧密块里：包围盒 ≤ 8 格
    const seats = groups[0].memberIds.map(function (sid) { return S.Cost.buildSeatMap(r.assignment)[sid]; });
    const ps = seats.map(S.Layout.parseSeatKey);
    const rs = ps.map(function (p) { return p.row; }), cs = ps.map(function (p) { return p.col; });
    const box = (Math.max.apply(null, rs) - Math.min.apply(null, rs) + 1) * (Math.max.apply(null, cs) - Math.min.apply(null, cs) + 1);
    assert.ok(box <= 8, '包围盒应紧凑，实际 ' + box + ' 格：' + JSON.stringify(seats));
  }
});
test('退火：硬约束「聚块 + 指定区域」在区域内成块', function () {
  const students = makeStudents(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  const L = makeLayout({ rows: 4, cols: 6, aisles: [2, 4] });
  L.areas = [{ id: 'a1', name: '前排', seats: ['r1c1', 'r1c2', 'r1c3', 'r1c4', 'r2c1', 'r2c2', 'r2c3', 'r2c4'] }];
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3', 's4'] }];
  const rules = [{ id: 'r1', type: 'group', groupId: 'g1', mode: 'block', areaId: 'a1', weight: 90, hard: true }];
  for (let i = 0; i < 5; i++) {
    const r = S.Anneal.generate(students, L, rules, { rng: Math.random, groups: groups });
    assert.strictEqual(r.hardFailed, false,
      '区域内聚块应满足：' + JSON.stringify(r.violations.map(function (v) { return v.desc; })));
    const map = S.Cost.buildSeatMap(r.assignment);
    groups[0].memberIds.forEach(function (sid) {
      assert.ok(L.areas[0].seats.indexOf(map[sid]) >= 0, sid + ' 应在「前排」内，实际 ' + map[sid]);
    });
  }
});
test('增量评估器：聚块规则与全量一致', function () {
  const students = [];
  for (let i = 1; i <= 16; i++) students.push({ id: 's' + i, name: '学' + i });
  const L = makeLayout({ rows: 4, cols: 8, aisles: [2, 4, 6] });
  const groups = [{ id: 'g1', name: 'G1', memberIds: ['s1', 's2', 's3', 's4', 's5'] }];
  const ctx = { layout: L, students: students, groups: groups };
  const rules = [
    { id: 'r1', type: 'group', groupId: 'g1', mode: 'block', weight: 70, hard: false },
    { id: 'r2', type: 'separate', mode: 'manhattan', aId: 's8', bId: 's9', minDist: 2, weight: 30, hard: false }
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
    if (step % 30 === 0) {
      const full = S.Cost.evaluate(assignment, rules, ctx);
      assert.strictEqual(inc.totalCost, full.totalCost,
        '第' + step + '次交换后增量 ' + inc.totalCost + ' ≠ 全量 ' + full.totalCost);
      assert.strictEqual(inc.hardFailed, full.hardFailed);
    }
  }
});
test('规则描述：聚块模式给出同桌/矩形/区域含义', function () {
  const students = makeStudents(['A', 'B', 'C', 'D']);
  const L = makeLayout({ rows: 3, cols: 4, aisles: [], areas: [{ id: 'a1', name: '前排', seats: ['r1c1'] }] });
  const groups = [{ id: 'g1', name: '第一组', memberIds: ['s1', 's2', 's3', 's4'] }];
  const d1 = S.Rules.describeRule({ type: 'group', groupId: 'g1', mode: 'block' }, students, L, groups);
  assert.ok(d1.indexOf('聚成一块') >= 0 && d1.indexOf('矩形') >= 0 && d1.indexOf('同一区域') >= 0, d1);
  const d2 = S.Rules.describeRule({ type: 'group', groupId: 'g1', mode: 'block', areaId: 'a1' }, students, L, groups);
  assert.ok(d2.indexOf('前排') >= 0, d2);
  assert.strictEqual(S.Rules.TYPE_NAMES.group, '小组');
});

console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
