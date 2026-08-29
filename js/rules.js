/**
 * rules.js — 规则数据模型与 CRUD
 * 规则结构：
 *   { id, type: 'pair'|'separate'|'area'|'ban',
 *     aId, bId,                 // pair/separate
 *     mode: 'desk'|'manhattan'|'hv',  // separate：'desk'=不同桌；'manhattan'=曼哈顿距离至少 N 格；'hv'=横向/竖向分别至少 N 列/排
 *     minDist,                  // separate(mode='manhattan')：最小曼哈顿距离（|Δ排|+|Δ列|，含过道）
 *     minRows, minCols,         // separate(mode='hv')：竖向至少隔 N 排、横向至少隔 N 列
 *     areaId,                   // area/ban（区域）
 *     seat,                     // ban（具体座位）
 *     weight: 0~100, hard: bool }
 * 全局命名空间：Seat.Rules
 */
(function (global) {
  'use strict';

  const TYPE_NAMES = { pair: '同桌', separate: '隔离', area: '区域', ban: '禁坐' };

  function defaultRule(type) {
    return {
      id: global.Seat.Storage.uid('r'),
      type: type || 'pair',
      aId: null, bId: null, cId: null,
      mode: 'manhattan',
      minDist: 2, minRows: 1, minCols: 1,
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

  /** 生成规则的中文描述 */
  function describeRule(rule, students, layout) {
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
        if (rule.mode === 'desk') return a + ' 与 ' + b + ' 不能同桌';
        if (rule.mode === 'hv') {
          const parts = [];
          if ((rule.minRows || 0) > 0) parts.push('竖向至少隔 ' + rule.minRows + ' 排');
          if ((rule.minCols || 0) > 0) parts.push('横向至少隔 ' + rule.minCols + ' 列');
          return a + ' 与 ' + b + ' 需' + (parts.join('、') || '保持距离');
        }
        return a + ' 与 ' + b + ' 需相距至少 ' + (rule.minDist || 0) + ' 格（曼哈顿距离）';
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

  global.Seat = global.Seat || {};
  global.Seat.Rules = {
    TYPE_NAMES, defaultRule, rulesOf, addRule, updateRule, removeRule, studentName, describeRule
  };
})(typeof window !== 'undefined' ? window : globalThis);
