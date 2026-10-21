/**
 * rules.js — 规则数据模型与 CRUD
 * 规则结构：
 *   { id, type: 'pair'|'separate'|'area'|'ban'|'group'|'fixed',
 *     aId, bId,                 // pair/separate/area/ban/fixed
 *     mode: 'desk'|'manhattan'|'hv',  // separate/group：'desk'=不同桌；'manhattan'=曼哈顿距离至少 N 格；'hv'=横向/竖向分别至少 N 列/排
 *     minDist,                  // separate/group(mode='manhattan')：最小曼哈顿距离（|Δ排|+|Δ列|，过道不计入）
 *     minRows, minCols,         // separate/group(mode='hv')：竖向至少隔 N 排、横向至少隔 N 列
 *     groupId,                  // group：引用的学生小组（成员在「名单」页维护，规则自动跟随）
 *     areaId,                   // area/ban（区域）
 *     seat,                     // ban/fixed（具体座位）
 *     weight: 0~100, hard: bool }
 * 全局命名空间：Seat.Rules
 */
(function (global) {
  'use strict';

  const TYPE_NAMES = { pair: '同桌', separate: '隔离', group: '小组', area: '区域', ban: '禁坐', fixed: '固定座位' };

  function defaultRule(type) {
    return {
      id: global.Seat.Storage.uid('r'),
      type: type || 'pair',
      aId: null, bId: null, cId: null,
      mode: 'manhattan',
      minDist: 2, minRows: 1, minCols: 1,
      groupId: null,
      areaId: null, seat: null,
      weight: 50, hard: false
    };
  }

  function rulesOf(state) {
    const d = global.Seat.Storage.currentData(state);
    return d ? d.rules : [];
  }

  function addRule(state, rule) {
    const d = global.Seat.Storage.currentData(state);
    if (!d) return null;
    d.rules.push(rule);
    return rule;
  }

  function updateRule(state, id, patch) {
    const d = global.Seat.Storage.currentData(state);
    if (!d) return;
    const r = d.rules.find(function (x) { return x.id === id; });
    if (r) Object.assign(r, patch);
  }

  function removeRule(state, id) {
    const d = global.Seat.Storage.currentData(state);
    if (!d) return;
    d.rules = d.rules.filter(function (x) { return x.id !== id; });
  }

  /** 姓名查找 */
  function studentName(students, id) {
    const s = students.find(function (x) { return x.id === id; });
    return s ? s.name : '?';
  }

  /**
   * hv 模式（周围范围）的要求文案
   * 禁坐区 = 以对方为中心、前后 minRows 排 × 左右 minCols 座的矩形；0 表示该方向只看正同一排/列
   */
  function hvNeedText(needR, needC) {
    const R = needR || 0, C = needC || 0;
    if (R > 0 && C > 0) return '不能坐在对方周围（前后 ' + R + ' 排、左右 ' + C + ' 座）的范围内';
    if (R > 0) return '不能坐在对方前后 ' + R + ' 排内（同一列）';
    if (C > 0) return '不能坐在对方左右 ' + C + ' 座内（同一排）';
    return '（未设置周围范围）';
  }

  /** 隔离/小组规则的「关系」中文短语（不含主语） */
  function distancePhrase(rule) {
    if (rule.mode === 'block') return '需聚成一块（组员两两同桌、座位尽量拼成矩形、整组在同一区域）';
    if (rule.mode === 'desk') return '不能同桌';
    if (rule.mode === 'hv') return hvNeedText(rule.minRows, rule.minCols);
    return '需相距至少 ' + (rule.minDist || 0) + ' 格（曼哈顿距离）';
  }

  /** 生成规则的中文描述（groups 可选：小组规则需要它取小组名） */
  function describeRule(rule, students, layout, groups) {
    const S = global.Seat;
    switch (rule.type) {
      case 'pair': {
        const names = [rule.aId, rule.bId];
        if (rule.cId) names.push(rule.cId);
        const label = names.map(function (id) { return studentName(students, id); });
        return label.join('、') + ' 必须连排同桌' + (names.length > 2 ? '（3 人）' : '');
      }
      case 'separate': {
        const a = studentName(students, rule.aId), b = studentName(students, rule.bId);
        return a + ' 与 ' + b + ' ' + distancePhrase(rule);
      }
      case 'group': {
        const g = S.Groups.find(groups, rule.groupId);
        if (!g) return '「已删除的小组」的规则（不生效）';
        const n = S.Groups.membersOf(g).length;
        if (n < 2) return '「' + g.name + '」（' + n + ' 人）成员不足 2 人，规则不生效';
        if (rule.mode === 'block') {
          const area = layout ? S.Layout.findArea(layout, rule.areaId) : null;
          return '「' + g.name + '」' + n + ' 人需聚成一块：组员两两同桌、座位尽量拼成矩形，' +
            (area ? '全坐在区域「' + area.name + '」' : '整组落在同一区域');
        }
        return '「' + g.name + '」' + n + ' 人之间' + distancePhrase(rule);
      }
      case 'fixed': {
        const who = rule.aId ? studentName(students, rule.aId) : '（未选学生）';
        if (!rule.seat) return who + ' 固定在（未选座位）';
        const label = S.Layout.seatLabel(layout, rule.seat);
        const ok = S.Layout.isSeatAvailable(layout, rule.seat);
        return who + ' 固定在座位 ' + label + (ok ? '' : '（该座位当前不可用，锁定暂不生效）');
      }
      case 'area': {
        const area = layout ? S.Layout.findArea(layout, rule.areaId) : null;
        const who = rule.aId ? studentName(students, rule.aId) : '（按条件筛选的学生）';
        return who + ' 必须坐在区域「' + (area ? area.name : '?') + '」';
      }
      case 'ban': {
        const who = rule.aId ? studentName(students, rule.aId) : '?';
        if (rule.seat) return who + ' 禁止坐在 ' + S.Layout.seatLabel(layout, rule.seat);
        const area = layout ? S.Layout.findArea(layout, rule.areaId) : null;
        return who + ' 禁止坐在区域「' + (area ? area.name : '?') + '」';
      }
      default: return '未知规则';
    }
  }

  /**
   * 硬锁定座位表：只取「硬约束」的固定座位规则（软约束交给退火按权重优化）
   * → { byStudent: {学生id: 座位key}, bySeat: {座位key: 学生id} }
   * 冲突（同一学生/同一座位重复锁定）时先到先得，后者忽略。
   * 传入 layout 时，座位已不可用的锁定一并忽略（与代价函数判定保持一致）。
   */
  function pinsOf(rules, layout) {
    const byStudent = {}, bySeat = {};
    (rules || []).forEach(function (r) {
      if (!r || r.type !== 'fixed' || !r.hard || !r.aId || !r.seat) return;
      if (layout && !global.Seat.Layout.isSeatAvailable(layout, r.seat)) return;
      if (byStudent[r.aId] || bySeat[r.seat]) return;
      byStudent[r.aId] = r.seat;
      bySeat[r.seat] = r.aId;
    });
    return { byStudent: byStudent, bySeat: bySeat };
  }

  global.Seat = global.Seat || {};
  global.Seat.Rules = {
    TYPE_NAMES, defaultRule, rulesOf, addRule, updateRule, removeRule, studentName, describeRule,
    distancePhrase, hvNeedText, pinsOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
