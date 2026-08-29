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
        const d = S.Layout.seatDistance(ka, kb);
        const lackR = Math.max(0, (rule.minRows || 0) - d.dr);
        const lackC = Math.max(0, (rule.minCols || 0) - d.dc);
        if (lackR === 0 && lackC === 0) return { violated: false, amount: 0, desc: '' };
        const amount = Math.max(1, lackR, lackC);
        const need = [];
        if (rule.minRows > 0) need.push(rule.minRows + '排');
        if (rule.minCols > 0) need.push(rule.minCols + '列');
        return {
          violated: true, amount: amount,
          desc: nameOf(rule.aId) + ' 与 ' + nameOf(rule.bId) + ' 需隔 ' + need.join('、') + '，实际仅隔 ' + d.dr + '排' + d.dc + '列'
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
      default:
        return { violated: false, amount: 0, desc: '' };
    }
  }

  /**
   * 评估整套座位表
   * → { totalCost, violations: [{rule, ruleId, desc, amount, hard}], hardFailed: bool }
   */
  function evaluate(assignment, rules, ctx) {
    const violations = [];
    let cost = 0;
    let hardFailed = false;
    const seatMap = buildSeatMap(assignment);
    (rules || []).forEach(function (rule) {
      const v = ruleViolation(rule, assignment, ctx, seatMap);
      if (!v.violated) return;
      const weight = rule.hard ? BIG : (rule.weight || 0);
      cost += weight * v.amount;
      if (rule.hard) hardFailed = true;
      violations.push({ rule: rule, desc: v.desc, amount: v.amount, hard: rule.hard });
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
    // 每条规则涉及的学生
    const related = (rules || []).map(function (r) {
      const ids = [];
      if (r.aId) ids.push(r.aId);
      if (r.bId) ids.push(r.bId);
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
      totalCost += (r.hard ? BIG : (r.weight || 0)) * rs.amount;
      if (r.hard) hardViolCount++;
      related[i].forEach(function (sid) { violCount[sid] = (violCount[sid] || 0) + 1; });
    });
    // 未排座惩罚（交换不改变排座集合，预计算一次）
    const placed = {};
    Object.keys(assignment).forEach(function (k) { placed[assignment[k]] = true; });
    (ctx.students || []).forEach(function (s) {
      if (!placed[s.id]) { totalCost += 1000; hardViolCount++; }
    });

    /** 交换两个学生的座位；返回是否成功 */
    function swap(aId, bId) {
      const ka = seatMap[aId], kb = seatMap[bId];
      if (!ka || !kb) return false;
      assignment[ka] = bId; assignment[kb] = aId;
      seatMap[aId] = kb; seatMap[bId] = ka;
      const affected = {};
      (byStudent[aId] || []).forEach(function (i) { affected[i] = true; });
      (byStudent[bId] || []).forEach(function (i) { affected[i] = true; });
      for (const i in affected) {
        const idx = +i;
        const r = rules[idx];
        const oldS = ruleStates[idx];
        const newS = ruleViolation(r, assignment, ctx, seatMap);
        const w = r.hard ? BIG : (r.weight || 0);
        totalCost += (newS.violated ? w * newS.amount : 0) - (oldS.violated ? w * oldS.amount : 0);
        if (r.hard) hardViolCount += (newS.violated ? 1 : 0) - (oldS.violated ? 1 : 0);
        related[idx].forEach(function (sid) {
          violCount[sid] = (violCount[sid] || 0) + (newS.violated ? 1 : 0) - (oldS.violated ? 1 : 0);
          if (violCount[sid] <= 0) delete violCount[sid];
        });
        ruleStates[idx] = newS;
      }
      return true;
    }

    /** 全量结果（用于最终输出） */
    function fullEvaluate() {
      const violations = [];
      ruleStates.forEach(function (rs, i) {
        if (!rs.violated) return;
        violations.push({ rule: rules[i], desc: rs.desc, amount: rs.amount, hard: rules[i].hard });
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
      swap: swap,
      fullEvaluate: fullEvaluate
    };
  }

  global.Seat = global.Seat || {};
  global.Seat.Cost = { BIG, ruleViolation, evaluate, buildSeatMap, createIncremental };
})(typeof window !== 'undefined' ? window : globalThis);
