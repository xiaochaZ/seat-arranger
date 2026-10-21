/**
 * cost.js — 代价函数：评估一份座位表（assignment）对规则的满足程度
 * assignment: { 座位key: 学生id }
 * 违规量化：代价 = Σ(权重 × 违规量)；硬约束违规 → 方案无效（totalCost = BIG）
 * 全局命名空间：Seat.Cost
 */
(function (global) {
  'use strict';

  const BIG = 1e9;

  /** 构建 studentId → seatKey 映射（O(n)），供规则评估 O(1) 查座 */
  function buildSeatMap(assignment) {
    const m = {};
    for (const k in assignment) m[assignment[k]] = k;
    return m;
  }

  /** 单条规则违规评估 → { violated: bool, amount: number, desc: string } */
  function ruleViolation(rule, assignment, ctx, seatMap) {
    const S = global.Seat;
    const layout = ctx.layout, students = ctx.students;
    const sm = seatMap || buildSeatMap(assignment);
    const seatOf = function (sid) { return sm[sid] || null; };
    const nameOf = function (sid) { return S.Rules.studentName(students, sid); };
    const label = function (key) { return S.Layout.seatLabel(layout, key); };

    switch (rule.type) {
      case 'pair': {
        // 支持 2 人或 3 人同桌（连排）
        const ids = [rule.aId, rule.bId];
        if (rule.cId) ids.push(rule.cId);
        const seats = ids.map(function (sid) { return seatOf(sid); });
        if (seats.some(function (s) { return !s; })) {
          return {
            violated: true, amount: 1,
            desc: ids.map(nameOf).join('、') + ' 未同桌（有人未排座）'
          };
        }
        if (S.Layout.sameDeskN(layout, seats)) return { violated: false, amount: 0, desc: '' };
        const parts = ids.map(function (sid, i) { return nameOf(sid) + '（' + label(seats[i]) + '）'; });
        return {
          violated: true, amount: 1,
          desc: parts.join('、') + ' 未连排同桌'
        };
      }
      case 'separate': {
        const ka = seatOf(rule.aId), kb = seatOf(rule.bId);
        if (!ka || !kb) return { violated: true, amount: 1, desc: nameOf(rule.aId) + ' 与 ' + nameOf(rule.bId) + ' 有人未排座' };
        if (rule.mode === 'desk') {
          if (!S.Layout.sameDesk(layout, ka, kb)) return { violated: false, amount: 0, desc: '' };
          return {
            violated: true, amount: 1,
            desc: nameOf(rule.aId) + ' 与 ' + nameOf(rule.bId) + ' 仍是同桌'
          };
        }
        if (rule.mode === 'hv') {
          // 任一方向达标即可：只有两个启用方向的间距都小于要求才算不满足（填 0 的方向不参与判定）
          const d = S.Layout.seatDistance(ka, kb);
          const lack = hvLack(d, rule.minRows || 0, rule.minCols || 0);
          if (!lack) return { violated: false, amount: 0, desc: '' };
          return {
            violated: true, amount: lack,
            desc: nameOf(rule.aId) + ' 与 ' + nameOf(rule.bId) + ' ' +
              S.Rules.hvNeedText(rule.minRows || 0, rule.minCols || 0) +
              '，实际竖向隔 ' + d.dr + ' 排、横向隔 ' + d.dc + ' 列'
          };
        }
        // 曼哈顿距离 = |Δ排| + |Δ列|（过道不计入；含旧 mode='distance' 兼容）
        const d = S.Layout.manhattanDistance(layout, ka, kb);
        const need = rule.minDist || 0;
        if (d >= need) return { violated: false, amount: 0, desc: '' };
        const amount = Math.max(1, need - d);
        return {
          violated: true, amount: amount,
          desc: nameOf(rule.aId) + ' 与 ' + nameOf(rule.bId) + ' 需相距至少 ' + need + ' 格（曼哈顿距离），实际仅 ' + d + ' 格'
        };
      }
      case 'area': {
        const ka = seatOf(rule.aId);
        if (!ka) return { violated: true, amount: 1, desc: nameOf(rule.aId) + ' 未排座' };
        const area = layout ? S.Layout.findArea(layout, rule.areaId) : null;
        if (area && area.seats.indexOf(ka) >= 0) return { violated: false, amount: 0, desc: '' };
        return {
          violated: true, amount: 1,
          desc: nameOf(rule.aId) + ' 应在区域「' + (area ? area.name : '?') + '」，实际在 ' + label(ka)
        };
      }
      case 'ban': {
        const ka = seatOf(rule.aId);
        if (!ka) return { violated: false, amount: 0, desc: '' }; // 未排座不算违反禁坐
        if (rule.seat && ka === rule.seat) {
          return { violated: true, amount: 1, desc: nameOf(rule.aId) + ' 坐在禁坐座位 ' + label(ka) };
        }
        if (rule.areaId) {
          const area = layout ? S.Layout.findArea(layout, rule.areaId) : null;
          if (area && area.seats.indexOf(ka) >= 0) {
            return { violated: true, amount: 1, desc: nameOf(rule.aId) + ' 坐在禁坐区域「' + area.name + '」' };
          }
        }
        return { violated: false, amount: 0, desc: '' };
      }
      case 'group': {
        // 小组关系：组内成员由「名单」页的小组维护，随时同步
        const g = S.Groups.find(ctx.groups, rule.groupId);
        if (!g) return { violated: false, amount: 0, desc: '' };
        const all = S.Groups.membersOf(g);
        const ids = all.filter(function (sid) { return !!seatOf(sid); });
        if (ids.length < 2) return { violated: false, amount: 0, desc: '' }; // 未排座由全局惩罚负责
        if (ids.length < all.length) {
          // 有组员未排座：单独提示（全局「未排座」惩罚同时计入）
          return {
            violated: true, amount: 1,
            desc: '「' + g.name + '」有 ' + (all.length - ids.length) + ' 名成员未排座'
          };
        }
        if (rule.mode === 'block') return groupBlockViolation(rule, g, ids, seatOf, ctx);
        const useDesk = rule.mode === 'desk';
        const useHv = rule.mode === 'hv';
        const need = rule.minDist || 0;
        const needR = rule.minRows || 0, needC = rule.minCols || 0;
        if (!useDesk && !useHv && need <= 0) return { violated: false, amount: 0, desc: '' };
        let amount = 0, pairCount = 0;
        const details = [];
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const ka = seatOf(ids[i]), kb = seatOf(ids[j]);
            const pairName = nameOf(ids[i]) + '–' + nameOf(ids[j]);
            if (useDesk) {
              if (!S.Layout.sameDesk(layout, ka, kb)) continue;
              amount += 1; pairCount++;
              if (details.length < 3) details.push(pairName);
              continue;
            }
            if (useHv) {
              // 与两人隔离同语义：任一方向达标即可
              const d = S.Layout.seatDistance(ka, kb);
              const lack = hvLack(d, needR, needC);
              if (!lack) continue;
              amount += Math.max(1, lack); pairCount++;
              if (details.length < 3) details.push(pairName + ' 仅隔 ' + d.dr + ' 排 / ' + d.dc + ' 列');
              continue;
            }
            const d = S.Layout.manhattanDistance(layout, ka, kb);
            if (d >= need) continue;
            amount += Math.max(1, need - d); pairCount++;
            if (details.length < 3) details.push(pairName + ' 仅 ' + d + ' 格');
          }
        }
        if (!amount) return { violated: false, amount: 0, desc: '' };
        return {
          violated: true, amount: amount,
          desc: '「' + g.name + '」有 ' + pairCount + ' 对成员' + distanceWord(rule) + '：' +
            details.join('；') + (pairCount > details.length ? ' 等' : '')
        };
      }
      case 'fixed': {
        if (!rule.seat) return { violated: false, amount: 0, desc: '' };
        // 座位已失效（布局变更/被标记不可用）→ 锁定不生效，与退火预置逻辑保持一致
        if (!S.Layout.isSeatAvailable(layout, rule.seat)) return { violated: false, amount: 0, desc: '' };
        const ka = seatOf(rule.aId);
        if (!ka) {
          return { violated: true, amount: 1, desc: nameOf(rule.aId) + ' 未排座（应固定在 ' + label(rule.seat) + '）' };
        }
        if (ka === rule.seat) return { violated: false, amount: 0, desc: '' };
        return {
          violated: true, amount: 1,
          desc: nameOf(rule.aId) + ' 应固定在 ' + label(rule.seat) + '，实际在 ' + label(ka)
        };
      }
      default:
        return { violated: false, amount: 0, desc: '' };
    }
  }

  /** 小组「保持距离」违规描述里的距离用词 */
  function distanceWord(rule) {
    if (rule.mode === 'desk') return '同桌';
    if (rule.mode === 'hv') return '间距不达标';
    return '距离不达标';
  }

  /**
   * 「小组聚成一块」违规评估（mode='block'）
   *   硬要求：组员两两同桌（奇数人允许落单 1 人）＋ 全组在同一（或指定）区域
   *   软偏好：座位包围盒尽量填满（越接近矩形越紧凑）—— 按用户语义是"尽可能"，
   *           所以只有它不达标时标记 soft，不会让硬约束判失败，但仍参与代价优化
   * → { violated, amount, desc, soft? }
   */
  function groupBlockViolation(rule, group, ids, seatOf, ctx) {
    const S = global.Seat;
    const layout = ctx.layout;
    const seats = ids.map(function (sid) { return seatOf(sid); });

    // 1) 同桌成对（贪心配对：同一张桌且同桌未被占用）
    const paired = {};
    let pairCount = 0;
    for (let i = 0; i < ids.length; i++) {
      if (paired[ids[i]]) continue;
      for (let j = i + 1; j < ids.length; j++) {
        if (paired[ids[j]]) continue;
        if (!S.Layout.sameDesk(layout, seats[i], seats[j])) continue;
        paired[ids[i]] = true; paired[ids[j]] = true; pairCount++;
        break;
      }
    }
    const alone = ids.length - pairCount * 2;
    const pairPenalty = Math.max(0, alone - (ids.length % 2));  // 奇数人允许 1 人落单

    // 2) 包围盒紧凑度：只统计"可容纳"的格子（指定区域时＝区域内的座位）
    const area = rule.areaId ? S.Layout.findArea(layout, rule.areaId) : null;
    const admissible = function (key) {
      if (!S.Layout.isSeatAvailable(layout, key)) return false;
      return !area || area.seats.indexOf(key) >= 0;
    };
    let rmin = 99, rmax = -1, cmin = 99, cmax = -1;
    const placed = [];
    for (let i = 0; i < seats.length; i++) {
      const p = S.Layout.parseSeatKey(seats[i]);
      if (!p) continue;
      placed.push(p);
      if (p.row < rmin) rmin = p.row;
      if (p.row > rmax) rmax = p.row;
      if (p.col < cmin) cmin = p.col;
      if (p.col > cmax) cmax = p.col;
    }
    let boxCells = 0;
    for (let r = rmin; r <= rmax; r++) {
      for (let c = cmin; c <= cmax; c++) {
        if (admissible(S.Layout.seatKey(r, c))) boxCells++;
      }
    }
    // 理论最紧凑的矩形块面积（受可用空间跨度限制）
    let maxRows = layout.rows, maxCols = layout.cols;
    if (area) {
      let ar = 0, ac = 0, arMin = 99, acMin = 99;
      area.seats.forEach(function (key) {
        const p = S.Layout.parseSeatKey(key);
        if (!p) return;
        ar = Math.max(ar, p.row); ac = Math.max(ac, p.col);
        arMin = Math.min(arMin, p.row); acMin = Math.min(acMin, p.col);
      });
      if (ar) { maxRows = ar - arMin + 1; maxCols = ac - acMin + 1; }
    }
    let minBox = Infinity;
    for (let a = 1; a <= Math.min(maxRows, ids.length); a++) {
      for (let b = 1; b <= Math.min(maxCols, ids.length); b++) {
        if (a * b >= ids.length && a * b < minBox) minBox = a * b;
      }
    }
    if (!isFinite(minBox)) minBox = ids.length;
    const holes = Math.max(0, boxCells - Math.max(ids.length, minBox));

    // 3) 同一区域（未指定区域时：全组落在同一个区域内即可）
    const areas = layout.areas || [];
    let areaPenalty = 0, areaDesc = '';
    if (area) {
      const outside = seats.filter(function (k) { return area.seats.indexOf(k) < 0; }).length;
      if (outside > 0) {
        areaPenalty = outside;
        areaDesc = outside + ' 人不在指定区域「' + area.name + '」内';
      }
    } else if (areas.length) {
      const count = {};
      seats.forEach(function (k) {
        const i = S.Layout.areaIndexOfSeat(layout, k);
        const key = i >= 0 ? String(i) : 'none';
        count[key] = (count[key] || 0) + 1;
      });
      let best = 0;
      for (const key in count) if (count[key] > best) best = count[key];
      areaPenalty = ids.length - best;
      if (areaPenalty > 0) areaDesc = '组员分散在 ' + Object.keys(count).length + ' 处（未落在同一区域）';
    }

    const hardPart = pairPenalty + areaPenalty;
    if (hardPart === 0 && holes === 0) return { violated: false, amount: 0, desc: '' };
    const parts = [];
    if (pairPenalty > 0) parts.push(pairPenalty + ' 人没和组员同桌');
    if (areaPenalty > 0) parts.push(areaDesc || (areaPenalty + ' 人不在同一区域'));
    if (holes > 0) parts.push('座位块内有 ' + holes + ' 个空位，还不够紧凑');
    const desc = '「' + group.name + '」' + ids.length + ' 人未聚成一块：' + parts.join('；');
    if (hardPart === 0) return { violated: true, amount: holes, desc: desc, soft: true };
    return { violated: true, amount: hardPart + holes, desc: desc };
  }

  /**
   * hv 模式（周围范围）判定
   * 禁坐区 = 以对方为中心、**前后 minRows 排 × 左右 minCols 座**的矩形（含边界）：
   *   横1竖1 → 周围 3×3 的 8 个邻座都不行（同桌也不行）
   *   横1竖0 → 只看同一排的左右各 1 座；前后不限（0 = 只判定同一排/列，不是"不限"）
   *   竖2横0 → 只看同一列的前后各 2 排
   * → null = 达标；否则返回"走出禁坐区还差几步"（≥1，给退火一个梯度）
   */
  function hvLack(d, needR, needC) {
    const R = needR || 0, C = needC || 0;
    if (R === 0 && C === 0) return null;          // 只剩"同一座位"，无实际约束 → 不判定
    if (d.dr > R || d.dc > C) return null;        // 已在禁坐区外 → 达标
    return Math.min(R + 1 - d.dr, C + 1 - d.dc);  // 走出禁坐区还差的步数
  }

  /**
   * 违规的计价权重
   * 硬约束 → BIG（方案判无效）；硬约束里的「偏好型」违规（v.soft，如小组"不够紧凑"）
   * 降级为普通权重，只拉优化、不判失败
   */
  function violationWeight(rule, v) {
    if (!rule.hard) return rule.weight || 0;
    if (v && v.soft) return rule.weight || 50;
    return BIG;
  }

  /**
   * 评估整套座位表
   * → { totalCost, violations: [{rule, ruleId, desc, amount, hard, soft}], hardFailed: bool }
   */
  function evaluate(assignment, rules, ctx) {
    const violations = [];
    let cost = 0;
    let hardFailed = false;
    const seatMap = buildSeatMap(assignment);
    (rules || []).forEach(function (rule) {
      const v = ruleViolation(rule, assignment, ctx, seatMap);
      if (!v.violated) return;
      cost += violationWeight(rule, v) * v.amount;
      if (rule.hard && !v.soft) hardFailed = true;
      violations.push({ rule: rule, desc: v.desc, amount: v.amount, hard: rule.hard, soft: !!v.soft });
    });
    // 未排座的学生（人数 < 可用座位时会留空座，全部学生都应排上）：
    const placed = {};
    Object.keys(assignment).forEach(function (k) { placed[assignment[k]] = true; });
    (ctx.students || []).forEach(function (s) {
      if (!placed[s.id]) {
        cost += 1000; // 硬性惩罚：有学生没座位
        violations.push({ rule: null, desc: s.name + ' 未排到座位', amount: 1, hard: true });
        hardFailed = true;
      }
    });
    return { totalCost: cost, violations: violations, hardFailed: hardFailed };
  }

  /**
   * 增量评估器：交换两个学生时只重算涉及他们的规则（O(受影响规则)），
   * 供模拟退火热循环使用。总代价/硬违规/违规学生集合均增量维护。
   */
  function createIncremental(assignment, rules, ctx) {
    const seatMap = buildSeatMap(assignment);
    // 每条规则涉及的学生（小组规则涉及全部组员：任一成员换座都要重算该规则）
    const related = (rules || []).map(function (r) {
      const ids = [];
      if (r.aId) ids.push(r.aId);
      if (r.bId) ids.push(r.bId);
      if (r.type === 'group') {
        const g = global.Seat.Groups.find(ctx.groups, r.groupId);
        if (g) global.Seat.Groups.membersOf(g).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
      }
      return ids;
    });
    const byStudent = {}; // studentId → [规则下标]
    related.forEach(function (ids, i) {
      ids.forEach(function (sid) {
        (byStudent[sid] = byStudent[sid] || []).push(i);
      });
    });

    const ruleStates = (rules || []).map(function (r) { return ruleViolation(r, assignment, ctx, seatMap); });
    let totalCost = 0;
    let hardViolCount = 0;
    const violCount = {}; // studentId → 违规贡献计数
    ruleStates.forEach(function (rs, i) {
      if (!rs.violated) return;
      const r = rules[i];
      totalCost += violationWeight(r, rs) * rs.amount;
      if (r.hard && !rs.soft) hardViolCount++;
      related[i].forEach(function (sid) { violCount[sid] = (violCount[sid] || 0) + 1; });
    });
    // 未排座惩罚（交换不改变排座集合，预计算一次）
    const placed = {};
    Object.keys(assignment).forEach(function (k) { placed[assignment[k]] = true; });
    (ctx.students || []).forEach(function (s) {
      if (!placed[s.id]) { totalCost += 1000; hardViolCount++; }
    });

    /** 重算受影响规则（交换/搬移共用） */
    function applyChanges(ids) {
      const affected = {};
      ids.forEach(function (sid) {
        (byStudent[sid] || []).forEach(function (i) { affected[i] = true; });
      });
      for (const i in affected) {
        const idx = +i;
        const r = rules[idx];
        const oldS = ruleStates[idx];
        const newS = ruleViolation(r, assignment, ctx, seatMap);
        totalCost += (newS.violated ? violationWeight(r, newS) * newS.amount : 0) -
          (oldS.violated ? violationWeight(r, oldS) * oldS.amount : 0);
        if (r.hard) {
          hardViolCount += (newS.violated && !newS.soft ? 1 : 0) - (oldS.violated && !oldS.soft ? 1 : 0);
        }
        related[idx].forEach(function (sid) {
          violCount[sid] = (violCount[sid] || 0) + (newS.violated ? 1 : 0) - (oldS.violated ? 1 : 0);
          if (violCount[sid] <= 0) delete violCount[sid];
        });
        ruleStates[idx] = newS;
      }
    }

    /** 交换两个学生的座位；返回是否成功 */
    function swap(aId, bId) {
      const ka = seatMap[aId], kb = seatMap[bId];
      if (!ka || !kb) return false;
      assignment[ka] = bId; assignment[kb] = aId;
      seatMap[aId] = kb; seatMap[bId] = ka;
      applyChanges([aId, bId]);
      return true;
    }

    /** 把学生搬到空座位（key 必须是空位）；返回是否成功 */
    function move(aId, key) {
      const from = seatMap[aId];
      if (!from || from === key) return false;
      if (assignment[key] !== undefined) return false;
      assignment[key] = aId;
      delete assignment[from];
      seatMap[aId] = key;
      applyChanges([aId]);
      return true;
    }

    /** 全量结果（用于最终输出） */
    function fullEvaluate() {
      const violations = [];
      ruleStates.forEach(function (rs, i) {
        if (!rs.violated) return;
        violations.push({ rule: rules[i], desc: rs.desc, amount: rs.amount, hard: rules[i].hard, soft: !!rs.soft });
      });
      const placedAll = {};
      Object.keys(assignment).forEach(function (k) { placedAll[assignment[k]] = true; });
      (ctx.students || []).forEach(function (s) {
        if (!placedAll[s.id]) {
          violations.push({ rule: null, desc: s.name + ' 未排到座位', amount: 1, hard: true });
        }
      });
      return { totalCost: totalCost, violations: violations, hardFailed: hardViolCount > 0 };
    }

    return {
      get totalCost() { return totalCost; },
      get hardFailed() { return hardViolCount > 0; },
      get violStudents() { return Object.keys(violCount); },
      seatOf: function (sid) { return seatMap[sid] || null; },
      swap: swap,
      move: move,
      fullEvaluate: fullEvaluate
    };
  }

  global.Seat = global.Seat || {};
  global.Seat.Cost = { BIG, ruleViolation, evaluate, buildSeatMap, createIncremental };
})(typeof window !== 'undefined' ? window : globalThis);
