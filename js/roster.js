/**
 * roster.js — 班级名单管理（学生 CRUD、粘贴解析）
 * 全局命名空间：Seat.Roster
 */
(function (global) {
  'use strict';

  /** 当前班级学生列表（无班级返回 []） */
  function students(state) {
    const cls = global.Seat.Storage.currentClass(state);
    return cls ? cls.students : [];
  }

  function addStudent(state, data) {
    const cls = global.Seat.Storage.currentClass(state);
    if (!cls) return null;
    const s = {
      id: global.Seat.Storage.uid('s'),
      name: (data.name || '').trim(),
      studentNo: (data.studentNo || '').trim(),
      gender: (data.gender || '').trim(),
      height: (data.height || '').trim(),
      note: (data.note || '').trim()
    };
    if (!s.name) return null;
    cls.students.push(s);
    return s;
  }

  function updateStudent(state, id, patch) {
    const cls = global.Seat.Storage.currentClass(state);
    if (!cls) return;
    const s = cls.students.find(function (x) { return x.id === id; });
    if (!s) return;
    Object.keys(patch).forEach(function (k) {
      s[k] = (patch[k] || '').trim();
    });
    if (!s.name) s.name = '未命名';
  }

  function removeStudent(state, id) {
    const cls = global.Seat.Storage.currentClass(state);
    if (!cls) return;
    cls.students = cls.students.filter(function (x) { return x.id !== id; });
  }

  function clearStudents(state) {
    const cls = global.Seat.Storage.currentClass(state);
    if (cls) cls.students = [];
  }

  /** 解析粘贴文本：按行取姓名，自动去除行号/编号前缀，去空去重 */
  function parseText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const names = [];
    const seen = {};
    lines.forEach(function (raw) {
      let line = raw.trim();
      if (!line) return;
      // 去掉常见前缀："1."、"1、"、"1) 张三"、"序号：张三" 等
      line = line.replace(/^\s*(\d+)[\.\、\)\:：]\s*/, '');
      // 若行内包含 tab/逗号/空格分隔的字段，取第一列当姓名（兼容从 Excel 复制的两列数据）
      line = line.split(/\t|[,，;；]\s*/)[0].trim();
      if (!line) return;
      if (!seen[line]) { seen[line] = true; names.push(line); }
    });
    return names;
  }

  /** 批量添加（返回重复被跳过的名字） */
  function addMany(state, names) {
    const cls = global.Seat.Storage.currentClass(state);
    if (!cls) return { added: 0, skipped: [] };
    const existing = {};
    cls.students.forEach(function (s) { existing[s.name] = true; });
    let added = 0;
    const skipped = [];
    names.forEach(function (n) {
      if (existing[n]) { skipped.push(n); return; }
      addStudent(state, { name: n });
      existing[n] = true;
      added++;
    });
    return { added: added, skipped: skipped };
  }

  global.Seat = global.Seat || {};
  global.Seat.Roster = {
    students, addStudent, updateStudent, removeStudent, clearStudents, parseText, addMany
  };
})(typeof window !== 'undefined' ? window : globalThis);
