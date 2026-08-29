/**
 * anneal.js — 模拟退火排座算法
 * 输入：学生、布局、规则 → 输出：座位表方案（assignment + 代价）
 * 多次独立运行生成多套方案，按总代价升序、去重
 * 全局命名空间：Seat.Anneal
 */
(function (global) {
  'use strict';

  const PARAMS = { T0: 80, TEnd: 0.5, alpha: 0.992 };

  /** 洗牌 */
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 生成一套方案
   * 热循环使用增量评估器（只重算被交换学生涉及的规则），大幅提速
   * → { assignment, totalCost, violations, hardFailed }
   */
  function generate(students, layout, rules, opts) {
    opts = opts || {};
    const S = global.Seat;
    const ctx = { layout: layout, students: students };
    const n = students.length;
    const seats = S.Layout.availableSeats(layout);
    if (seats.length < n) {
      return { assignment: {}, totalCost: S.Cost.BIG, violations: [{ desc: '可用座位不足：需要 ' + n + ' 个，只有 ' + seats.length + ' 个' }], hardFailed: true };
    }
    const rng = opts.rng || Math.random;

    // 随机初始分配：洗牌座位，前 n 个给学生
    const shuffled = shuffle(seats.slice(), rng);
    const assignment = {};
    for (let i = 0; i < n; i++) assignment[shuffled[i]] = students[i].id;

    let inc = S.Cost.createIncremental(assignment, rules, ctx);
    let bestAssignment = Object.assign({}, assignment);
    let bestCost = inc.totalCost;
    let currentCost = inc.totalCost;

    const T0 = PARAMS.T0, TEnd = PARAMS.TEnd, alpha = PARAMS.alpha;
    const iterPerTemp = Math.max(80, n * 4);

    // 选择一对要交换的学生：优先让违规者参与，加速硬约束收敛
    const pickPair = function (violStudents) {
      if (violStudents.length && rng() < 0.6) {
        const ia = students.findIndex(function (s) { return s.id === violStudents[Math.floor(rng() * violStudents.length)]; });
        if (ia >= 0) {
          let ib = Math.floor(rng() * n);
          if (ib === ia) ib = (ib + 1) % n;
          return [ia, ib];
        }
      }
      const ia = Math.floor(rng() * n);
      let ib = Math.floor(rng() * n);
      if (ib === ia) ib = (ib + 1) % n;
      return [ia, ib];
    };

    // 一次试探交换：返回是否接受新状态
    const trySwap = function (aId, bId, T, acceptOnlyImprove) {
      if (aId === bId) return false;
      const before = currentCost;
      if (!inc.swap(aId, bId)) return false;
      const delta = inc.totalCost - before;
      if (delta <= 0 || (!acceptOnlyImprove && rng() < Math.exp(-delta / T))) {
        currentCost = inc.totalCost;
        if (inc.totalCost < bestCost) {
          bestCost = inc.totalCost;
          bestAssignment = Object.assign({}, assignment);
        }
        return true;
      }
      inc.swap(bId, aId); // 还原
      return false;
    };

    let T = T0;
    while (T > TEnd) {
      for (let it = 0; it < iterPerTemp; it++) {
        const p = pickPair(inc.violStudents);
        trySwap(students[p[0]].id, students[p[1]].id, T, false);
      }
      T *= alpha;
    }

    // 贪心收尾：只接受改善
    for (let g = 0; g < n * 30; g++) {
      const p = pickPair(inc.violStudents);
      trySwap(students[p[0]].id, students[p[1]].id, 0.001, true);
    }

    // 定向修复：对未满足的硬约束同桌规则做启发式修复（最多 5 轮，支持 2/3 人）
    const deskPartner = function (key) {
      const p = S.Layout.parseSeatKey(key);
      if (!p) return null;
      const gi = S.Layout.groupIndexOf(layout, p.col);
      const cands = [];
      if (S.Layout.groupIndexOf(layout, p.col - 1) === gi) cands.push(p.col - 1);
      if (S.Layout.groupIndexOf(layout, p.col + 1) === gi) cands.push(p.col + 1);
      if (!cands.length) return null;
      return S.Layout.seatKey(p.row, cands[Math.floor(rng() * cands.length)]);
    };
    const seatMap = S.Cost.buildSeatMap(assignment);
    // 把学生搬到目标座位（被占则交换），并维护 seatMap
    const moveTo = function (sid, targetKey) {
      const cur = seatMap[sid];
      if (!cur || cur === targetKey) return;
      const occ = assignment[targetKey];
      if (occ === undefined) {
        assignment[targetKey] = sid;
        delete assignment[cur];
        seatMap[sid] = targetKey;
      } else {
        assignment[targetKey] = sid;
        assignment[cur] = occ;
        seatMap[sid] = targetKey;
        seatMap[occ] = cur;
      }
    };
    for (let round = 0; round < 8; round++) {
      const ev = S.Cost.evaluate(assignment, rules, ctx);
      if (!ev.hardFailed) break;
      let improved = false;
      ev.violations.forEach(function (v) {
        if (improved || !v.rule || v.rule.type !== 'pair' || !v.rule.hard) return;
        const aId = v.rule.aId, bId = v.rule.bId;
        if (v.rule.cId) {
          // 3 人同桌：把三人搬到同排同组的一个 3 连块；尝试所有排，取最优
          const cId = v.rule.cId;
          const trioSeats = [aId, bId, cId].map(function (id) { return seatMap[id]; });
          if (trioSeats.some(function (s) { return !s; })) return;
          const groups = S.Layout.columnGroups(layout);
          // 候选组：优先选"三人中有人已坐在"的 3 列组；否则任意 3 列组
          let target = null;
          groups.forEach(function (g) {
            if (target || g[1] - g[0] + 1 < 3) return;
            const anyHere = trioSeats.some(function (k) {
              const p = S.Layout.parseSeatKey(k);
              return p && p.col >= g[0] && p.col <= g[1];
            });
            if (anyHere) target = g;
          });
          if (!target) {
            groups.forEach(function (g) { if (!target && g[1] - g[0] + 1 >= 3) target = g; });
          }
          if (!target) return; // 布局没有任何 ≥3 列的组
          const x = target[0];
          // 完整回滚（moveTo 可能新增/删除 key，必须整体还原）
          const restoreAss = function (backup) {
            Object.keys(assignment).forEach(function (k) { delete assignment[k]; });
            Object.assign(assignment, backup);
          };
          const restoreMap = function (backup) {
            Object.keys(seatMap).forEach(function (k) { delete seatMap[k]; });
            Object.assign(seatMap, backup);
          };
          const hardCount = function (ev) {
            return ev.violations.filter(function (v) { return v.hard; }).length;
          };
          let bestTry = null;
          for (let rr = 1; rr <= layout.rows; rr++) {
            const backupAss = Object.assign({}, assignment);
            const backupMap = Object.assign({}, seatMap);
            moveTo(bId, S.Layout.seatKey(rr, x + 1));
            moveTo(cId, S.Layout.seatKey(rr, x + 2));
            moveTo(aId, S.Layout.seatKey(rr, x));
            const ev2 = S.Cost.evaluate(assignment, rules, ctx);
            const score = { hard: hardCount(ev2), cost: ev2.totalCost };
            if (!bestTry || score.hard < bestTry.score.hard || (score.hard === bestTry.score.hard && score.cost < bestTry.score.cost)) {
              bestTry = { ass: Object.assign({}, assignment), map: Object.assign({}, seatMap), score: score };
            }
            restoreAss(backupAss);
            restoreMap(backupMap);
          }
          if (bestTry && bestTry.score.hard < hardCount(ev)) {
            restoreAss(bestTry.ass);
            restoreMap(bestTry.map);
            improved = true;
          }
          return;
        }
        const ka = seatMap[aId], kb = seatMap[bId];
        if (!ka || !kb) return;
        const partner = deskPartner(kb);
        if (!partner) return;
        moveTo(aId, partner);
        improved = true;
      });
      if (!improved) break;
    }
    inc = S.Cost.createIncremental(assignment, rules, ctx);
    if (inc.totalCost <= bestCost) {
      bestCost = inc.totalCost;
      bestAssignment = Object.assign({}, assignment);
    }

    const final = S.Cost.evaluate(bestAssignment, rules, ctx);
    return { assignment: bestAssignment, totalCost: final.totalCost, violations: final.violations, hardFailed: final.hardFailed };
  }

  /** assignment 指纹（按座位 key 排序后学生 id 序列），用于去重 */
  function fingerprint(assignment) {
    const keys = Object.keys(assignment).sort();
    return keys.map(function (k) { return assignment[k]; }).join(',');
  }

  /**
   * 生成 count 套方案
   * → [{ id, name, createdAt, assignment, totalCost, violations, hardFailed }]（按 totalCost 升序）
   * onProgress(done, total) 可选回调
   */
  function generateMany(students, layout, rules, count, onProgress) {
    count = Math.max(1, Math.min(20, count | 0));
    const out = [];
    const seen = {};
    let attempts = 0;
    const maxAttempts = count * 6;
    while (out.length < count && attempts < maxAttempts) {
      attempts++;
      const r = generate(students, layout, rules, { rng: Math.random });
      const fp = fingerprint(r.assignment);
      if (seen[fp]) continue;
      seen[fp] = true;
      out.push({
        id: global.Seat.Storage.uid('p'),
        name: '方案 ' + (out.length + 1),
        createdAt: Date.now(),
        assignment: r.assignment,
        totalCost: r.totalCost,
        hardFailed: r.hardFailed
      });
      if (onProgress) onProgress(out.length, count);
    }
    out.sort(function (a, b) {
      if (a.hardFailed !== b.hardFailed) return a.hardFailed ? 1 : -1;
      return a.totalCost - b.totalCost;
    });
    return out;
  }

  global.Seat = global.Seat || {};
  global.Seat.Anneal = { PARAMS, generate, generateMany, fingerprint };
})(typeof window !== 'undefined' ? window : globalThis);
