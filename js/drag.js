/**
 * drag.js — 结果网格拖拽交换座位
 * 拖拽后即时重算代价并提示新增/消除的违规数
 * 全局命名空间：Seat.Drag
 */
(function (global) {
  'use strict';

  let stateRef = null;
  let onChanged = null; // 交换完成后回调（用于重渲染 + 保存）

  /** 绑定结果网格的拖拽事件（事件委托） */
  function bind(gridEl, state, changedCallback) {
    stateRef = state;
    onChanged = changedCallback;

    gridEl.addEventListener('dragstart', function (e) {
      const seat = e.target.closest('.seat');
      if (!seat || seat.classList.contains('unavailable') || !seat.draggable) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', seat.dataset.key);
      e.dataTransfer.effectAllowed = 'move';
      seat.classList.add('dragging');
    });

    gridEl.addEventListener('dragend', function (e) {
      const seat = e.target.closest('.seat');
      if (seat) seat.classList.remove('dragging');
    });

    gridEl.addEventListener('dragover', function (e) {
      const seat = e.target.closest('.seat');
      if (!seat || seat.classList.contains('unavailable')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    gridEl.addEventListener('dragenter', function (e) {
      const seat = e.target.closest('.seat');
      if (seat && !seat.classList.contains('unavailable')) seat.classList.add('drag-over');
    });

    gridEl.addEventListener('dragleave', function (e) {
      const seat = e.target.closest('.seat');
      if (seat) seat.classList.remove('drag-over');
    });

    gridEl.addEventListener('drop', function (e) {
      e.preventDefault();
      const target = e.target.closest('.seat');
      if (!target || target.classList.contains('unavailable')) return;
      gridEl.querySelectorAll('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });

      const fromKey = e.dataTransfer.getData('text/plain');
      const toKey = target.dataset.key;
      if (!fromKey || fromKey === toKey) return;
      swap(fromKey, toKey);
    });
  }

  /** 执行交换并提示效果 */
  function swap(fromKey, toKey) {
    const S = global.Seat;
    const d = S.Storage.currentData(stateRef);
    if (!d) return;
    const cur = d.solutions.find(function (s) { return s.id === d.currentSolutionId; });
    if (!cur) return;
    const assignment = Object.assign({}, cur.assignment);
    const layout = d.layout;
    const students = (S.Storage.currentClass(stateRef) || { students: [] }).students;
    const ctx = { layout: layout, students: students };
    if (!assignment[fromKey] && !assignment[toKey]) return; // 都是空座

    // 交换（可能涉及空座：人挪到空座）
    const tmp = assignment[fromKey];
    assignment[fromKey] = assignment[toKey];
    assignment[toKey] = tmp;

    const before = S.Cost.evaluate(cur.assignment, d.rules, ctx);
    const after = S.Cost.evaluate(assignment, d.rules, ctx);
    const beforeViolated = before.violations.length;
    const afterViolated = after.violations.length;
    const delta = afterViolated - beforeViolated;

    cur.assignment = assignment;
    cur.totalCost = after.totalCost;
    cur.hardFailed = after.hardFailed;
    S.Storage.save(stateRef);
    if (onChanged) onChanged();

    const msg = delta === 0
      ? '已交换，违规数不变（' + afterViolated + ' 条）'
      : delta > 0
        ? '已交换，但新增了 ' + delta + ' 条违规（共 ' + afterViolated + ' 条）'
        : '已交换，消除了 ' + (-delta) + ' 条违规（剩 ' + afterViolated + ' 条）';
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (delta > 0 ? 'err' : 'ok');
    clearTimeout(swap._t);
    swap._t = setTimeout(function () { el.classList.add('hidden'); }, 2400);
  }

  global.Seat = global.Seat || {};
  global.Seat.Drag = { bind, swap };
})(typeof window !== 'undefined' ? window : globalThis);
