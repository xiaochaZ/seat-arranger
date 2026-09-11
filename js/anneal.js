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
   * 硬锁定的「固定座位」学生：开局预置到目标座位，且全程不参与交换
   * → { assignment, totalCost, violations, hardFailed }
   */
  function generate(students, layout, rules, opts) {
    opts = opts || {};
    const S = global.Seat;
    const ctx = { layout: layout, students: students, groups: opts.groups || [] };
    const n = students.length;
    const seats = S.Layout.availableSeats(layout);
    if (seats.length < n) {
      return { assignment: {}, totalCost: S.Cost.BIG, violations: [{ desc: '可用座位不足：需要 ' + n + ' 个，只有 ' + seats.length + ' 个' }], hardFailed: true };
    }
    const rng = opts.rng || Math.random;

    // 硬锁定座位：只认目标座位仍可用的锁定；冲突（同座/同人）先到先得
    const pins = S.Rules.pinsOf(rules, layout);
    const pinnedSeat = {};   // 学生id → 座位key
    const reserved = {};     // 已被锁定占用的座位key
    students.forEach(function (s) {
      const k = pins.byStudent[s.id];
      if (!k || reserved[k] || seats.indexOf(k) < 0) return;
      pinnedSeat[s.id] = k;
      reserved[k] = true;
    });
    const pool = students.filter(function (s) { return !pinnedSeat[s.id]; }); // 可自由交换的学生
    const m = pool.length;
    const freeSeats = seats.filter(function (k) { return !reserved[k]; });

    // 初始分配：锁定学生先入座，其余学生随机洗牌填入剩余座位
    const assignment = {};
    Object.keys(pinnedSeat).forEach(function (sid) { assignment[pinnedSeat[sid]] = sid; });
    const shuffled = shuffle(freeSeats.slice(), rng);
    for (let i = 0; i < m; i++) assignment[shuffled[i]] = pool[i].id;

    let inc = S.Cost.createIncremental(assignment, rules, ctx);
    let bestAssignment = Object.assign({}, assignment);
    let bestCost = inc.totalCost;
    let currentCost = inc.totalCost;

    const T0 = PARAMS.T0, TEnd = PARAMS.TEnd, alpha = PARAMS.alpha;
    const iterPerTemp = Math.max(80, n * 4);

    // 选择一对要交换的学生：优先让违规者参与，加速硬约束收敛（锁定的学生不参与）
    const pickPair = function (violStudents) {
      if (m < 2) return null;
      if (violStudents.length && rng() < 0.6) {
        const hit = [];
        for (let i = 0; i < m; i++) if (violStudents.indexOf(pool[i].id) >= 0) hit.push(i);
        if (hit.length) {
          const ia = hit[Math.floor(rng() * hit.length)];
          let ib = Math.floor(rng() * m);
          if (ib === ia) ib = (ib + 1) % m;
          return [ia, ib];
        }
      }
      const ia = Math.floor(rng() * m);
      let ib = Math.floor(rng() * m);
      if (ib === ia) ib = (ib + 1) % m;
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
        if (p) trySwap(pool[p[0]].id, pool[p[1]].id, T, false);
      }
      T *= alpha;
    }

    // 贪心收尾：只接受改善
    for (let g = 0; g < m * 30; g++) {
      const p = pickPair(inc.violStudents);
      if (p) trySwap(pool[p[0]].id, pool[p[1]].id, 0.001, true);
    }

    // 空位搬移：把仍在违规的学生搬进空座位（只接受改善）
    // 场景：座位比学生多时，软固定座位/区域规则的目标座位可能是空位，只靠交换永远到不了
    for (let round = 0; round < 3; round++) {
      const emptyKeys = freeSeats.filter(function (k) { return assignment[k] === undefined; });
      if (!emptyKeys.length) break;
      const viols = inc.violStudents.slice();
      if (!viols.length) break;
      let anyMoved = false;
      viols.forEach(function (sid) {
        if (pinnedSeat[sid]) return;
        for (let i = 0; i < emptyKeys.length; i++) {
          const key = emptyKeys[i];
          if (assignment[key] !== undefined) continue;
          const from = inc.seatOf(sid);
          if (!from || from === key) continue;
          const before = inc.totalCost;
          if (!inc.move(sid, key)) continue;
          if (inc.totalCost < before) {
            emptyKeys.splice(i, 1);
            emptyKeys.push(from);
            anyMoved = true;
            break;
          }
          inc.move(sid, from); // 无改善 → 撤回
        }
      });
      if (!anyMoved) break;
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
    // 目标座位若被「硬锁定学生」占用则拒绝移动（锁定座位不可被挤走）
    const moveTo = function (sid, targetKey) {
      const cur = seatMap[sid];
      if (!cur || cur === targetKey) return true;
      const occ = assignment[targetKey];
      if (occ !== undefined && pinnedSeat[occ]) return false;
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
      return true;
    };
    // 完整回滚（moveTo 会增删 key，必须整体还原）
    const restoreAss = function (backup) {
      Object.keys(assignment).forEach(function (k) { delete assignment[k]; });
      Object.assign(assignment, backup);
    };
    const restoreMap = function (backup) {
      Object.keys(seatMap).forEach(function (k) { delete seatMap[k]; });
      Object.assign(seatMap, backup);
    };
    const hardCount = function (ev) {
      // 「偏好型」违规（soft，如小组不够紧凑）不算硬失败
      return ev.violations.filter(function (v) { return v.hard && !v.soft; }).length;
    };
    /**
     * 硬约束「小组聚成一块」定向修复：枚举候选矩形座位块（宽 2/4/6 列 × 若干排），
     * 把全组成员按行优先搬进去，取（硬违规数, 代价）最优者。
     * 也用于"同桌已满足但不够紧凑"的偏好型违规——紧凑化必须整组一起挪，
     * 单人交换会拆散同桌（硬违规），光靠贪心收尾走不动。
     */
    const repairGroupBlock = function (rule, baseEv) {
      const g = S.Groups.find(ctx.groups, rule.groupId);
      if (!g) return false;
      const ids = S.Groups.membersOf(g);
      const k = ids.length;
      if (k < 2) return false;
      // 锁定学生搬不动 / 有人未排座 → 放弃该修复
      for (let i = 0; i < k; i++) {
        if (!seatMap[ids[i]] || pinnedSeat[ids[i]]) return false;
      }
      const area = rule.areaId ? S.Layout.findArea(layout, rule.areaId) : null;
      const baseHard = hardCount(baseEv);
      // 候选块宽：2/4/6 列（标准双人桌对齐）＋ 恰好一排 k 座
      const widths = [2, 4, 6, k].filter(function (b, i, arr) {
        return b >= 2 && b <= layout.cols && arr.indexOf(b) === i;
      });
      let best = null, evals = 0;
      // 尝试一组目标座位：把全组按顺序搬进去，记录（硬违规数, 代价）最优解
      const tryCells = function (cells) {
        if (!cells || cells.length < k) return;
        if (evals++ > 200) return;
        const backupAss = Object.assign({}, assignment);
        const backupMap = Object.assign({}, seatMap);
        let moved = true;
        for (let i = 0; i < k && moved; i++) moved = moveTo(ids[i], cells[i]);
        const ev2 = moved ? S.Cost.evaluate(assignment, rules, ctx) : null;
        if (ev2) {
          const h = hardCount(ev2);
          if (!best || h < best.hard || (h === best.hard && ev2.totalCost < best.cost)) {
            best = { hard: h, cost: ev2.totalCost, ass: Object.assign({}, assignment), map: Object.assign({}, seatMap) };
          }
        }
        restoreAss(backupAss);
        restoreMap(backupMap);
      };
      // ① 指定了「聚到区域」时，先试"把区域里最靠前的 k 个座位填满"（异形/窄区域里没有完美矩形）
      if (area) {
        const sorted = area.seats.filter(function (key) {
          return S.Layout.isSeatAvailable(layout, key);
        }).sort(function (x, y) {
          const a = S.Layout.parseSeatKey(x), b = S.Layout.parseSeatKey(y);
          return (a.row - b.row) || (a.col - b.col);
        });
        tryCells(sorted.slice(0, k));
      }
      // ② 枚举矩形座位块
      for (let wi = 0; wi < widths.length; wi++) {
        const b = widths[wi];
        const a = Math.ceil(k / b);
        for (let rr = 1; rr + a - 1 <= layout.rows; rr++) {
          for (let cc = 1; cc + b - 1 <= layout.cols; cc++) {
            const cells = [];
            let ok = true;
            for (let r = rr; r < rr + a && ok; r++) {
              for (let c = cc; c < cc + b; c++) {
                const key = S.Layout.seatKey(r, c);
                if (!S.Layout.isSeatAvailable(layout, key) || (area && area.seats.indexOf(key) < 0)) {
                  ok = false; break;
                }
                cells.push(key);
              }
            }
            if (!ok) continue;
            tryCells(cells);
          }
        }
      }
      if (!best) return false;
      // 硬违规更少，或硬违规相同但代价更低（更紧凑）→ 采纳
      const better = best.hard < baseHard || (best.hard === baseHard && best.cost < baseEv.totalCost);
      if (!better) return false;
      restoreAss(best.ass);
      restoreMap(best.map);
      return true;
    };
    for (let round = 0; round < 8; round++) {
      const ev = S.Cost.evaluate(assignment, rules, ctx);
      // 需要整组重塑的情形：硬失败，或小组聚块的（硬约束下的偏好项 / 纯软约束）未达标
      const blockWork = ev.violations.some(function (v) {
        return v.rule && v.rule.type === 'group' && v.rule.mode === 'block' && (v.soft || !v.rule.hard);
      });
      if (!ev.hardFailed && !blockWork) break;
      let improved = false;
      ev.violations.forEach(function (v) {
        if (improved || !v.rule) return;
        // 小组聚块：整组搬进候选矩形块（比其他规则优先，一次跳到位）
        if (v.rule.type === 'group' && v.rule.mode === 'block') {
          if (repairGroupBlock(v.rule, ev)) improved = true;
          return;
        }
        if (v.rule.type !== 'pair' || !v.rule.hard) return;
        const aId = v.rule.aId, bId = v.rule.bId;
        if (v.rule.cId) {
          // 3 人同桌：把三人搬到同排同组的一个 3 连块；尝试所有排，取最优
          const cId = v.rule.cId;
          if (pinnedSeat[aId] || pinnedSeat[bId] || pinnedSeat[cId]) return; // 锁定的学生搬不动
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
          let bestTry = null;
          for (let rr = 1; rr <= layout.rows; rr++) {
            const backupAss = Object.assign({}, assignment);
            const backupMap = Object.assign({}, seatMap);
            const moved = moveTo(bId, S.Layout.seatKey(rr, x + 1)) &&
              moveTo(cId, S.Layout.seatKey(rr, x + 2)) &&
              moveTo(aId, S.Layout.seatKey(rr, x));
            const ev2 = moved ? S.Cost.evaluate(assignment, rules, ctx) : ev;
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
        if (pinnedSeat[aId]) return; // 被锁定的学生不能挪动
        const ka = seatMap[aId], kb = seatMap[bId];
        if (!ka || !kb) return;
        const partner = deskPartner(kb);
        if (!partner) return;
        if (moveTo(aId, partner)) improved = true;
      });
      if (!improved) break;
    }

    // 定向修复可能挤走被锁定的学生 → 收尾钉回锁定座位
    const enforcePins = function (ass) {
      const sids = Object.keys(pinnedSeat);
      if (!sids.length) return;
      const spare = [];
      sids.forEach(function (sid) {
        for (const k in ass) {
          if (ass[k] === sid) { delete ass[k]; spare.push(k); break; }
        }
      });
      sids.forEach(function (sid) {
        const key = pinnedSeat[sid];
        const occ = ass[key];
        if (occ !== undefined) {
          const fk = spare.pop();
          if (fk !== undefined) ass[fk] = occ;
          else delete ass[key];
        }
        ass[key] = sid;
      });
    };
    enforcePins(assignment);
    inc = S.Cost.createIncremental(assignment, rules, ctx);
    if (inc.totalCost <= bestCost) {
      bestCost = inc.totalCost;
      bestAssignment = Object.assign({}, assignment);
    }
    enforcePins(bestAssignment);

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
   * onProgress(done, total) 可选回调；groups 可选（小组规则需要）
   */
  function generateMany(students, layout, rules, count, onProgress, groups) {
    count = Math.max(1, Math.min(20, count | 0));
    const out = [];
    const seen = {};
    let attempts = 0;
    const maxAttempts = count * 6;
    while (out.length < count && attempts < maxAttempts) {
      attempts++;
      const r = generate(students, layout, rules, { rng: Math.random, groups: groups });
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
