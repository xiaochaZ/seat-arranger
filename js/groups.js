/**
 * groups.js — 学生「小组」数据模型与 CRUD
 * 小组存在班级数据里：data[classId].groups = [{ id:'g_xx', name:'第一组', memberIds:['s_xx', ...] }]
 * 用途：规则里可引用小组（「小组」规则：组内成员两两保持距离，或整组聚成一块），成员随小组变动自动同步
 * 全局命名空间：Seat.Groups
 */
(function (global) {
  'use strict';

  /** 当前班级的小组数组（无班级时返回 []） */
  function groupsOf(state) {
    const d = global.Seat.Storage.currentData(state);
    if (!d) return [];
    if (!Array.isArray(d.groups)) d.groups = [];
    return d.groups;
  }

  function find(groups, id) {
    return (groups || []).find(function (g) { return g.id === id; }) || null;
  }

  /** 新建小组；memberIds 会先去重 */
  function add(state, name, memberIds) {
    const groups = groupsOf(state);
    const g = {
      id: global.Seat.Storage.uid('g'),
      name: name || ('小组' + (groups.length + 1)),
      memberIds: uniq(memberIds)
    };
    groups.push(g);
    return g;
  }

  function rename(groups, id, name) {
    const g = find(groups, id);
    if (g) g.name = name;
  }

  function remove(groups, id) {
    const i = (groups || []).findIndex(function (g) { return g.id === id; });
    if (i >= 0) groups.splice(i, 1);
  }

  /** 整体设置成员（去重、去空白） */
  function setMembers(groups, id, memberIds) {
    const g = find(groups, id);
    if (!g) return null;
    g.memberIds = uniq(memberIds);
    return g;
  }

  function hasMember(groups, id, studentId) {
    const g = find(groups, id);
    return !!g && g.memberIds.indexOf(studentId) >= 0;
  }

  /** 切换某学生的成员身份，返回切换后的状态 */
  function toggleMember(groups, id, studentId) {
    const g = find(groups, id);
    if (!g || !studentId) return false;
    const i = g.memberIds.indexOf(studentId);
    if (i >= 0) g.memberIds.splice(i, 1);
    else g.memberIds.push(studentId);
    return i < 0;
  }

  /** 组员 id 列表（过滤空值） */
  function membersOf(group) {
    return (group && Array.isArray(group.memberIds) ? group.memberIds : []).filter(Boolean);
  }

  /** 学生 id → 所在小组 id 列表 */
  function groupsOfStudent(groups, studentId) {
    return (groups || []).filter(function (g) { return membersOf(g).indexOf(studentId) >= 0; });
  }

  /** 组内两两组合（i<j），返回 [ [idA, idB], ... ] */
  function pairs(group) {
    const ids = membersOf(group);
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
    }
    return out;
  }

  /** 剔除已删除的学生；无成员的小组一并删除。返回是否有改动 */
  function cleanup(state) {
    const d = global.Seat.Storage.currentData(state);
    if (!d || !Array.isArray(d.groups)) return false;
    const valid = {};
    ((global.Seat.Storage.currentClass(state) || {}).students || []).forEach(function (s) { valid[s.id] = true; });
    let changed = false;
    d.groups.forEach(function (g) {
      const before = membersOf(g).length;
      g.memberIds = membersOf(g).filter(function (id) { return valid[id]; });
      if (g.memberIds.length !== before) changed = true;
    });
    const beforeCount = d.groups.length;
    d.groups = d.groups.filter(function (g) { return g.memberIds.length > 0; });
    if (d.groups.length !== beforeCount) changed = true;
    return changed;
  }

  /** 删除小组，同时移除引用它的小组规则；返回被移除的规则条数 */
  function removeWithRules(state, groupId) {
    const d = global.Seat.Storage.currentData(state);
    if (!d) return 0;
    remove(d.groups, groupId);
    const before = (d.rules || []).length;
    d.rules = (d.rules || []).filter(function (r) { return !(r.type === 'group' && r.groupId === groupId); });
    return before - d.rules.length;
  }

  /** 引用某小组的规则条数 */
  function ruleRefCount(state, groupId) {
    const d = global.Seat.Storage.currentData(state);
    if (!d) return 0;
    return (d.rules || []).filter(function (r) { return r.type === 'group' && r.groupId === groupId; }).length;
  }

  /** 中文描述：第一组（8 人） */
  function describe(group, students) {
    if (!group) return '?';
    const n = membersOf(group).length;
    return group.name + '（' + n + ' 人）';
  }

  /** 小组名称查重（重名时自动加序号），用于新建时的默认名 */
  function uniqueName(groups, base) {
    const used = {};
    (groups || []).forEach(function (g) { used[g.name] = true; });
    if (!used[base]) return base;
    let i = 2;
    while (used[base + i]) i++;
    return base + i;
  }

  function uniq(ids) {
    const seen = {};
    const out = [];
    (ids || []).forEach(function (id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  global.Seat = global.Seat || {};
  global.Seat.Groups = {
    groupsOf, find, add, rename, remove, setMembers, hasMember, toggleMember,
    membersOf, groupsOfStudent, pairs, cleanup, removeWithRules, ruleRefCount, describe, uniqueName
  };
})(typeof window !== 'undefined' ? window : globalThis);
