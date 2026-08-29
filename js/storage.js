/**
 * storage.js — 应用状态：localStorage 持久化 + JSON 备份/恢复
 * 全局命名空间：Seat.Storage
 */
(function (global) {
  'use strict';

  const LS_KEY = 'seatplanner.v1';
  const VERSION = 1;

  /** 生成短 id */
  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** 默认布局：6排 × 8列，3 个过道 → xx|xx|xx|xx，门在左 */
  function defaultLayout() {
    return {
      rows: 6,
      cols: 8,
      aisles: [2, 4, 6],       // 过道位置（第 N 列后），可任意多个
      doorSide: 'left',        // 门方位：left = 列号从左数；right = 列号从右数（靠门）
      unavailable: [],         // ['r1c3', ...]
      areas: []                // [{id, name, seats: [...]}]
    };
  }

  /** 每个班级的独立数据 */
  function defaultClassData() {
    return {
      layout: defaultLayout(),
      rules: [],
      solutions: [],          // [{id, name, createdAt, assignment, totalCost}]
      currentSolutionId: null
    };
  }

  /** 空应用状态 */
  function defaultState() {
    return {
      version: VERSION,
      classes: [],            // [{id, name, createdAt, students: [...]}]
      currentClassId: null,
      data: {}                // { [classId]: defaultClassData() }
    };
  }

  /** 当前班级数据（无班级时返回 null） */
  function currentData(state) {
    if (!state.currentClassId) return null;
    return state.data[state.currentClassId] || null;
  }

  /** 当前班级对象 */
  function currentClass(state) {
    if (!state.currentClassId) return null;
    return state.classes.find(function (c) { return c.id === state.currentClassId; }) || null;
  }

  /** 迁移旧版布局数据：aisleAfterCol → aisles（多过道模型）；补 doorSide */
  function migrateLayout(layout) {
    if (!layout) return layout;
    if (layout.aisles === undefined && typeof layout.aisleAfterCol === 'number') {
      layout.aisles = layout.aisleAfterCol > 0 ? [layout.aisleAfterCol] : [];
    }
    if (!Array.isArray(layout.aisles)) layout.aisles = [];
    if (!layout.doorSide) layout.doorSide = 'left';
    return layout;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VERSION) return defaultState();
      // 兼容性修补：确保结构完整
      parsed.classes = parsed.classes || [];
      parsed.data = parsed.data || {};
      Object.keys(parsed.data).forEach(function (cid) {
        const d = parsed.data[cid];
        if (d && d.layout) migrateLayout(d.layout);
      });
      if (!parsed.currentClassId || !parsed.data[parsed.currentClassId]) parsed.currentClassId = null;
      return parsed;
    } catch (e) {
      console.warn('读取本地数据失败，使用空状态', e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('保存本地数据失败', e);
      return false;
    }
  }

  /** 新建班级，返回班级 id 并切换为当前班级 */
  function addClass(state, name) {
    const id = uid('c');
    const cls = { id: id, name: name || ('班级' + (state.classes.length + 1)), createdAt: Date.now(), students: [] };
    state.classes.push(cls);
    state.data[id] = defaultClassData();
    state.currentClassId = id;
    return cls;
  }

  function renameClass(state, classId, name) {
    const cls = state.classes.find(function (c) { return c.id === classId; });
    if (cls) cls.name = name;
  }

  function removeClass(state, classId) {
    const idx = state.classes.findIndex(function (c) { return c.id === classId; });
    if (idx < 0) return;
    state.classes.splice(idx, 1);
    delete state.data[classId];
    if (state.currentClassId === classId) {
      state.currentClassId = state.classes.length ? state.classes[0].id : null;
    }
  }

  /** 导出整套配置为 JSON 文件 */
  function exportJSON(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '排座位备份_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /** 从 JSON 文件恢复配置（异步） */
  function importJSON(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (!parsed || !Array.isArray(parsed.classes)) throw new Error('不是有效的备份文件');
          parsed.version = VERSION;
          parsed.data = parsed.data || {};
          parsed.classes.forEach(function (c) {
            if (!parsed.data[c.id]) parsed.data[c.id] = defaultClassData();
          });
          if (!parsed.currentClassId || !parsed.data[parsed.currentClassId]) {
            parsed.currentClassId = parsed.classes.length ? parsed.classes[0].id : null;
          }
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  global.Seat = global.Seat || {};
  global.Seat.Storage = {
    uid, load, save, defaultState, defaultClassData, currentData, currentClass,
    addClass, renameClass, removeClass, exportJSON, importJSON, LS_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
