/**
 * app.js — 主控：初始化、状态管理、四步向导、全部页面交互
 * 全局命名空间：Seat.App
 */
(function (global) {
  'use strict';

  const S = function () { return global.Seat; };

  /* ── roundRect polyfill（老浏览器兼容） ── */
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  let state = null;
  const ui = { step: 1, selectedAreaId: null, genTimer: null, picked: {}, editingGroupId: null };

  /* ─────────── 工具 ─────────── */

  function $(id) { return document.getElementById(id); }

  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }

  function openModal(title, bodyHtml) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    $('modalOverlay').classList.remove('hidden');
  }
  function closeModal() { $('modalOverlay').classList.add('hidden'); }

  /** 通用输入弹窗（替代原生 prompt） */
  function inputModal(title, placeholder, onSubmit) {
    openModal(title, '' +
      '<div class="form-row"><input type="text" id="inputModalVal" placeholder="' + placeholder + '" style="width:100%" maxlength="30"></div>' +
      '<div class="form-actions"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确定</button></div>');
    const body = $('modalBody');
    body.querySelector('[data-act="cancel"]').onclick = closeModal;
    const doSubmit = function () {
      const v = body.querySelector('#inputModalVal').value.trim();
      if (!v) { toast('输入不能为空', 'err'); return; }
      onSubmit(v);
      closeModal();
    };
    body.querySelector('[data-act="ok"]').onclick = doSubmit;
    body.querySelector('#inputModalVal').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
    });
    setTimeout(function () { body.querySelector('#inputModalVal').focus(); }, 60);
  }

  /** 通用确认弹窗（替代原生 confirm） */
  function confirmModal(message, onOk) {
    openModal('确认操作', '' +
      '<div class="form-row" style="font-size:14px">' + message + '</div>' +
      '<div class="form-actions"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" style="background:#dc2626;border-color:#dc2626" data-act="ok">确定</button></div>');
    const body = $('modalBody');
    body.querySelector('[data-act="cancel"]').onclick = closeModal;
    body.querySelector('[data-act="ok"]').onclick = function () { closeModal(); onOk(); };
  }

  function saveAndRender() {
    refreshSolutionCosts();
    S().Storage.save(state);
    renderAll();
  }

  /** 规则/小组变动后，按当前规则重算已生成方案的代价与硬失败标记（方案列表数字才不会过期） */
  function refreshSolutionCosts() {
    const d = S().Storage.currentData(state);
    const cls = S().Storage.currentClass(state);
    if (!d || !cls || !d.solutions.length) return;
    const ctx = { layout: d.layout, students: cls.students, groups: d.groups || [] };
    d.solutions.forEach(function (sol) {
      const ev = S().Cost.evaluate(sol.assignment, d.rules, ctx);
      sol.totalCost = ev.totalCost;
      sol.hardFailed = ev.hardFailed;
    });
  }

  /* ─────────── 班级 ─────────── */

  function renderClassSelect() {
    const sel = $('classSelect');
    sel.innerHTML = '';
    state.classes.forEach(function (c) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = state.currentClassId || '';
  }

  function newClass() {
    inputModal('新建班级', '请输入班级名称（如：高一3班）', function (name) {
      const cls = S().Storage.addClass(state, name);
      S().Storage.save(state);
      ui.selectedAreaId = null;
      ui.picked = {};
      ui.editingGroupId = null;
      renderAll();
      toast('已创建班级「' + cls.name + '」', 'ok');
    });
  }

  /* ─────────── 名单页 ─────────── */

  function renderRosterArea() {
    const body = $('rosterBody');
    const n = S().Render.renderRoster(state, body, ui.picked);
    $('rosterStats').textContent = state.currentClassId
      ? '共 ' + n + ' 名学生（可用座位 ' + S().Layout.availableSeats((S().Storage.currentData(state) || {}).layout || S().Layout.defaultLayout()).length + ' 个）'
      : '请先新建或选择班级';
    $('rosterEmpty').classList.toggle('hidden', n > 0);
    $('rosterTableWrap').classList.toggle('hidden', n === 0);
    const all = $('rosterPickAll');
    if (all) {
      const picked = pickedIds().length;
      all.checked = n > 0 && picked === n;
      all.indeterminate = picked > 0 && picked < n;
    }
    renderGroupBar();
  }

  /* ── 学生小组（勾选名单 → 建组；规则里可引用小组） ── */

  function pickedIds() {
    const ids = [];
    S().Roster.students(state).forEach(function (s) { if (ui.picked[s.id]) ids.push(s.id); });
    return ids;
  }

  function renderGroupBar() {
    const bar = $('groupBar');
    if (!bar) return;
    const d = S().Storage.currentData(state);
    if (!d) { bar.innerHTML = ''; return; }
    if (!Array.isArray(d.groups)) d.groups = [];
    const editing = S().Groups.find(d.groups, ui.editingGroupId);
    const nPicked = pickedIds().length;
    const chips = d.groups.length
      ? d.groups.map(function (g) {
        const n = S().Groups.membersOf(g).length;
        const refs = S().Groups.ruleRefCount(state, g.id);
        const act = g.id === ui.editingGroupId ? ' active' : '';
        return '<span class="group-chip' + act + '" data-group="' + g.id + '" title="点击编辑成员' +
          (refs ? '（被 ' + refs + ' 条规则引用）' : '') + '">' +
          S().Render.esc(g.name) + ' · ' + n + ' 人' +
          '<span class="del" data-groupdel="' + g.id + '" title="删除小组">✕</span></span>';
      }).join('')
      : '<span class="muted">还没有小组。勾选左侧复选框后点「＋ 建小组」。</span>';
    const hint = editing
      ? '<span class="tool-hint editing">正在编辑「' + S().Render.esc(editing.name) + '」：勾选/取消勾选即时保存成员</span>'
      : '<span class="tool-hint">勾选学生 → 建小组；小组可在「③ 规则」里用作「小组」</span>';
    bar.innerHTML =
      '<span class="tool-label">学生小组：</span>' +
      '<span class="group-chips">' + chips + '</span>' +
      (editing
        ? '<button id="btnRenameGroup" class="btn btn-sm">✏️ 重命名</button>' +
          '<button id="btnExitGroupEdit" class="btn btn-sm btn-primary">✅ 完成编辑</button>'
        : '<button id="btnNewGroup" class="btn btn-sm"' + (nPicked ? '' : ' disabled') + '>＋ 用勾选的 ' + nPicked + ' 人建小组</button>') +
      hint;
  }

  /** 小组成员变化后：重算方案代价并刷新受影响的区块（名单表本身由调用方重绘，避免打断勾选） */
  function afterGroupChange() {
    refreshSolutionCosts();
    S().Storage.save(state);
    renderRuleArea();
    renderResultArea();
  }

  function togglePick(id, checked) {
    if (checked) ui.picked[id] = true;
    else delete ui.picked[id];
    // 编辑态下勾选即改成员
    if (ui.editingGroupId) {
      const d = S().Storage.currentData(state);
      const g = d && S().Groups.find(d.groups, ui.editingGroupId);
      if (g) {
        const ids = S().Groups.membersOf(g).filter(function (x) { return x !== id; });
        if (checked) ids.push(id);
        S().Groups.setMembers(d.groups, g.id, ids);
        afterGroupChange();
      }
    }
    renderRosterArea();
  }

  function setAllPicked(checked) {
    ui.picked = {};
    if (checked) S().Roster.students(state).forEach(function (s) { ui.picked[s.id] = true; });
    if (ui.editingGroupId) {
      const d = S().Storage.currentData(state);
      if (d && S().Groups.find(d.groups, ui.editingGroupId)) {
        S().Groups.setMembers(d.groups, ui.editingGroupId, pickedIds());
        afterGroupChange();
      }
    }
    renderRosterArea();
  }

  function newGroupFromPicked() {
    const ids = pickedIds();
    if (!ids.length) { toast('请先勾选学生', 'err'); return; }
    const d = S().Storage.currentData(state);
    if (!d) return;
    const base = S().Groups.uniqueName(d.groups, '小组' + (d.groups.length + 1));
    inputModal('新建学生小组', '小组名称（如：第一组、需要分开的 8 人）', function (name) {
      const g = S().Groups.add(state, name, ids);
      ui.editingGroupId = g.id;
      saveAndRender();
      toast('已创建小组「' + g.name + '」（' + ids.length + ' 人）', 'ok');
    });
    const el = $('inputModalVal');
    if (el) el.value = base;
  }

  function renameGroup(id) {
    const d = S().Storage.currentData(state);
    const g = d && S().Groups.find(d.groups, id);
    if (!g) return;
    inputModal('重命名小组', '小组名称', function (name) {
      S().Groups.rename(d.groups, id, name);
      saveAndRender();
    });
    const el = $('inputModalVal');
    if (el) el.value = g.name;
  }

  function delGroup(id) {
    const d = S().Storage.currentData(state);
    const g = d && S().Groups.find(d.groups, id);
    if (!g) return;
    const refs = S().Groups.ruleRefCount(state, id);
    confirmModal('删除小组「' + g.name + '」？' +
      (refs ? '<br><span class="muted">有 ' + refs + ' 条规则引用它，将一并删除。</span>' : ''), function () {
      const removed = S().Groups.removeWithRules(state, id);
      if (ui.editingGroupId === id) { ui.editingGroupId = null; ui.picked = {}; }
      saveAndRender();
      toast('小组已删除' + (removed ? '，同时移除 ' + removed + ' 条相关规则' : ''), 'ok');
    });
  }

  function editGroup(id) {
    const d = S().Storage.currentData(state);
    const g = d && S().Groups.find(d.groups, id);
    if (!g) return;
    ui.editingGroupId = id;
    ui.picked = {};
    S().Groups.membersOf(g).forEach(function (sid) { ui.picked[sid] = true; });
    renderRosterArea();
  }

  function exitGroupEdit() {
    ui.editingGroupId = null;
    ui.picked = {};
    renderRosterArea();
    renderRuleArea();
    toast('小组编辑已完成', 'ok');
  }

  function openAddStudentModal() {
    openModal('添加学生', '' +
      '<div class="form-row"><label>姓名 *</label><input type="text" id="f_name" placeholder="学生姓名"></div>' +
      '<div class="form-row"><label>学号</label><input type="text" id="f_no" placeholder="可选"></div>' +
      '<div class="form-row"><label>性别</label><input type="text" id="f_gender" placeholder="男 / 女"></div>' +
      '<div class="form-row"><label>身高(cm)</label><input type="text" id="f_height" placeholder="如 165"></div>' +
      '<div class="form-row"><label>备注</label><input type="text" id="f_note" placeholder="如：近视、班干部"></div>' +
      '<div class="form-actions"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">添加</button></div>');
    $('modalBody').querySelector('[data-act="ok"]').onclick = function () {
      const s = S().Roster.addStudent(state, {
        name: $('f_name').value, studentNo: $('f_no').value,
        gender: $('f_gender').value, height: $('f_height').value, note: $('f_note').value
      });
      if (!s) { toast('姓名不能为空', 'err'); return; }
      closeModal();
      saveAndRender();
    };
    $('modalBody').querySelector('[data-act="cancel"]').onclick = closeModal;
  }

  function openPasteModal() {
    openModal('粘贴导入名单', '' +
      '<div class="form-row"><label>每行一个姓名（自动去重；支持"序号+姓名"格式）</label>' +
      '<textarea id="pasteText" rows="10" style="width:100%" placeholder="张三&#10;李四&#10;王五"></textarea></div>' +
      '<div class="form-actions"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">导入</button></div>');
    $('modalBody').querySelector('[data-act="ok"]').onclick = function () {
      const names = S().Roster.parseText($('pasteText').value);
      if (!names.length) { toast('没有解析到姓名', 'err'); return; }
      const res = S().Roster.addMany(state, names);
      closeModal();
      saveAndRender();
      toast('新增 ' + res.added + ' 人' + (res.skipped.length ? '，跳过重复：' + res.skipped.join('、') : ''), 'ok');
    };
    $('modalBody').querySelector('[data-act="cancel"]').onclick = closeModal;
  }

  function importFile(file) {
    const name = (file.name || '').toLowerCase();
    // JSON 备份恢复
    if (name.endsWith('.json')) {
      S().Storage.importJSON(file).then(function (newState) {
        state = newState;
        ui.selectedAreaId = null;
        ui.picked = {};
        ui.editingGroupId = null;
        S().Storage.save(state);
        renderAll();
        toast('备份已恢复：' + state.classes.length + ' 个班级' + (state.currentClassId ? '，当前「' + (S().Storage.currentClass(state) || {}).name + '」' : ''), 'ok');
      }).catch(function (e) {
        toast('备份恢复失败：' + e.message, 'err');
      });
      return;
    }
    S().Parser.importFile(file).then(function (res) {
      if (!state.currentClassId) S().Storage.addClass(state, file.name.replace(/\.[^.]+$/, ''));
      const r = S().Roster.addMany(state, res.students.map(function (s) { return s.name; }));
      if (res.headerUsed) toast('导入完成：新增 ' + r.added + ' 人' + (r.skipped.length ? '，跳过重复 ' + r.skipped.length + ' 人' : ''), 'ok');
      else toast('导入完成：新增 ' + r.added + ' 人（未识别表头，默认第一列为姓名）' + (r.skipped.length ? '，跳过重复 ' + r.skipped.length + ' 人' : ''), 'ok');
      saveAndRender();
    }).catch(function (e) {
      toast(e.message || '导入失败', 'err');
    });
  }

  /* ─────────── 布局页 ─────────── */

  function renderLayoutArea() {
    const d = S().Storage.currentData(state);
    if (!d) { $('layoutGrid').innerHTML = ''; return; }
    const layout = d.layout;
    $('layoutRows').value = layout.rows;
    $('layoutCols').value = layout.cols;
    $('layoutAisles').value = (layout.aisles || []).join(',');
    $('layoutDoor').value = layout.doorSide === 'right' ? 'right' : 'left';
    renderAreaSelect();
    S().Render.renderLayoutEditor($('layoutGrid'), layout, ui.selectedAreaId);
    // 区域高亮：非选中区域变浅（CSS 已按 zone 色区分；选中区域用边框强调）
    if (ui.selectedAreaId) {
      const area = S().Layout.findArea(layout, ui.selectedAreaId);
      if (area) {
        $('layoutGrid').querySelectorAll('.seat').forEach(function (el) {
          if (area.seats.indexOf(el.dataset.key) >= 0) el.style.outline = '2px solid #2563eb';
        });
      }
    }
    // 座位统计：总座位 / 可用座位 / 班级人数 / 差值
    const total = layout.rows * layout.cols;
    const avail = S().Layout.availableSeats(layout).length;
    const unavail = total - avail;
    const people = S().Roster.students(state).length;
    const diff = avail - people;
    let diffHtml;
    if (diff > 0) diffHtml = '还可容纳 <b>' + diff + '</b> 人';
    else if (diff === 0) diffHtml = '座位刚好够';
    else diffHtml = '还差 <b>' + (-diff) + '</b> 个座位';
    const el = $('layoutStats');
    el.innerHTML =
      '<span class="stat">🗑 总座位 <b>' + total + '</b></span>' +
      '<span class="stat">🪑 可用座位 <b>' + avail + '</b>' + (unavail > 0 ? '（' + unavail + ' 个不可用）' : '') + '</span>' +
      '<span class="stat">👥 班级人数 <b>' + people + '</b></span>' +
      '<span class="stat' + (diff < 0 ? ' warn' : '') + '">' + diffHtml + '</span>';
  }

  function renderAreaSelect() {
    const d = S().Storage.currentData(state);
    const sel = $('areaSelect');
    sel.innerHTML = '';
    if (!d || !d.layout.areas.length) {
      sel.innerHTML = '<option value="">（还没有区域，请先新建）</option>';
      ui.selectedAreaId = null;
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    d.layout.areas.forEach(function (a) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + '（' + a.seats.length + ' 座）';
      sel.appendChild(opt);
    });
    if (!ui.selectedAreaId || !d.layout.areas.some(function (a) { return a.id === ui.selectedAreaId; })) {
      ui.selectedAreaId = d.layout.areas[0].id;
    }
    sel.value = ui.selectedAreaId;
  }

  /** 应用布局数值（实时与按钮共用）：更新 layout、清理越界、清空旧方案 */
  function applyLayoutValues() {
    const d = S().Storage.currentData(state);
    if (!d) return null;
    const rows = Math.max(1, Math.min(12, parseInt($('layoutRows').value) || 6));
    const cols = Math.max(2, Math.min(16, parseInt($('layoutCols').value) || 8));
    // 过道位置：逗号/空格分隔的列号，如 "2,4,6"（xx|xx|xx|xx）
    const rawAisles = ($('layoutAisles').value || '').split(/[,，、\s]+/).map(function (s) { return parseInt(s, 10); })
      .filter(function (n) { return !isNaN(n); });
    const aisles = S().Layout.normalizeAisles(rawAisles, cols);
    const doorSide = $('layoutDoor').value === 'right' ? 'right' : 'left';
    const old = d.layout;
    const inBounds = function (k) {
      const p = S().Layout.parseSeatKey(k);
      return p && p.row >= 1 && p.row <= rows && p.col >= 1 && p.col <= cols;
    };
    const nl = { rows: rows, cols: cols, aisles: aisles, doorSide: doorSide, unavailable: [], areas: [] };
    (old.areas || []).forEach(function (a) {
      nl.areas.push({ id: a.id, name: a.name, seats: a.seats.filter(inBounds) });
    });
    nl.unavailable = (old.unavailable || []).filter(inBounds);
    d.layout = nl;
    d.solutions = [];
    d.currentSolutionId = null;
    ui.selectedAreaId = nl.areas.length ? nl.areas[0].id : null;
    saveAndRender();
    return nl;
  }

  function newArea() {
    const d = S().Storage.currentData(state);
    if (!d) return;
    inputModal('新建区域', '区域名称（如：前排、靠窗、中间）', function (name) {
      const area = S().Layout.addArea(d.layout, name);
      ui.selectedAreaId = area.id;
      saveAndRender();
    });
  }

  function delArea() {
    const d = S().Storage.currentData(state);
    if (!d || !ui.selectedAreaId) return;
    const area = S().Layout.findArea(d.layout, ui.selectedAreaId);
    if (!area) return;
    confirmModal('删除区域「' + area.name + '」？', function () {
      S().Layout.removeArea(d.layout, ui.selectedAreaId);
      ui.selectedAreaId = d.layout.areas.length ? d.layout.areas[0].id : null;
      saveAndRender();
    });
  }

  /* ─────────── 规则页 ─────────── */

  function renderRuleArea() {
    const n = S().Render.renderRuleList(state, $('ruleList'));
    $('ruleCount').textContent = n ? '（' + n + ' 条）' : '';
    $('ruleEmpty').classList.toggle('hidden', n > 0);
  }

  function openRuleModal(existing) {
    const d = S().Storage.currentData(state);
    const students = S().Roster.students(state);
    if (!students.length) { toast('请先添加学生', 'err'); return; }
    const r = existing || S().Rules.defaultRule('pair');
    const areas = d.layout.areas;
    const groups = d.groups || [];
    const areaOpts = areas.length
      ? areas.map(function (a) { return '<option value="' + a.id + '"' + (r.areaId === a.id ? ' selected' : '') + '>' + S().Render.esc(a.name) + '</option>'; }).join('')
      : '<option value="">（暂无区域，请先到「布局」页新建）</option>';
    const groupOpts = groups.length
      ? groups.map(function (g) {
        const n = S().Groups.membersOf(g).length;
        return '<option value="' + g.id + '"' + (r.groupId === g.id ? ' selected' : '') + (n < 2 ? ' disabled' : '') + '>' +
          S().Render.esc(g.name) + '（' + n + ' 人）' + (n < 2 ? ' — 成员不足' : '') + '</option>';
      }).join('')
      : '<option value="">（暂无小组，请先到「名单」页勾选学生后建组）</option>';
    const stuOpts = function (sel) {
      return '<option value="">— 请选择 —</option>' + students.map(function (s) {
        return '<option value="' + s.id + '"' + (sel === s.id ? ' selected' : '') + '>' + S().Render.esc(s.name) + '</option>';
      }).join('');
    };
    const seatOpts = S().Layout.availableSeats(d.layout).map(function (k) {
      return '<option value="' + k + '"' + (r.seat === k ? ' selected' : '') + '>' + S().Render.esc(S().Layout.seatLabel(d.layout, k)) + '</option>';
    }).join('');

    openModal(existing ? '编辑规则' : '添加规则', '' +
      '<div class="form-row"><label>规则类型</label>' +
      '<select id="r_type">' +
      '<option value="pair"' + (r.type === 'pair' ? ' selected' : '') + '>同桌：2~3 人连排同桌</option>' +
      '<option value="separate"' + (r.type === 'separate' ? ' selected' : '') + '>隔离：两人必须远离</option>' +
      '<option value="group"' + (r.type === 'group' ? ' selected' : '') + '>小组：组内保持距离 / 聚在一起</option>' +
      '<option value="fixed"' + (r.type === 'fixed' ? ' selected' : '') + '>固定座位：某人锁定在某座位</option>' +
      '<option value="area"' + (r.type === 'area' ? ' selected' : '') + '>区域：某人必须坐在某区域</option>' +
      '<option value="ban"' + (r.type === 'ban' ? ' selected' : '') + '>禁坐：某人禁止坐在某处</option>' +
      '</select></div>' +
      '<div class="form-row only-pair only-separate only-area only-ban only-fixed"><label id="lb_a">学生 A</label><select id="r_a">' + stuOpts(r.aId) + '</select></div>' +
      '<div class="form-row only-pair only-separate"><label>学生 B</label><select id="r_b">' + stuOpts(r.bId) + '</select></div>' +
      '<div class="form-row only-pair"><label>第三人（可选，3 人连排同桌）</label><select id="r_c">' + stuOpts(r.cId) + '</select>' +
      '<div class="hint">3 人同桌需要布局中有 ≥3 列的组（如 xx|xxx|xx 设过道为 2,5,7）；否则无法满足</div></div>' +
      '<div class="form-row only-separate only-group"><label>关系</label>' +
      '<select id="r_mode">' +
      '<option value="desk"' + (r.mode === 'desk' ? ' selected' : '') + '>保持距离：不能同桌</option>' +
      '<option value="manhattan"' + ((r.mode === 'manhattan' || r.mode === 'distance') ? ' selected' : '') + '>保持距离：曼哈顿距离至少 N 格</option>' +
      '<option value="hv"' + (r.mode === 'hv' ? ' selected' : '') + '>保持距离：周围范围（前后 N 排、左右 N 座内避开）</option>' +
      '<option value="block"' + (r.mode === 'block' ? ' selected' : '') + '>聚在一起：组员两两同桌、座位拼成矩形、整组同一区域</option>' +
      '</select></div>' +
      '<div class="form-row only-separate only-group" id="distRow" ' + ((r.mode === 'manhattan' || r.mode === 'distance') ? '' : 'style="display:none"') + '>' +
      '<label>最小距离（格）</label>' +
      '<input type="number" id="r_minDist" min="0" max="24" style="width:80px" value="' + (r.minDist != null ? r.minDist : ((r.minRows || 0) + (r.minCols || 0))) + '">' +
      '<div class="hint">曼哈顿距离 = 行差 + 列差（过道占一格）。如"相距至少 3 格"：同行隔 3 列、或隔 1 排 2 列等</div></div>' +
      '<div class="form-row only-separate only-group" id="hvRow" ' + (r.mode === 'hv' ? '' : 'style="display:none"') + '>' +
      '<label>周围范围</label>' +
      '对方前后 <input type="number" id="r_minRows" min="0" max="12" style="width:64px" value="' + (r.minRows || 0) + '"> 排内、' +
      '左右 <input type="number" id="r_minCols" min="0" max="15" style="width:64px" value="' + (r.minCols || 0) + '"> 座内都不能坐' +
      '<div class="hint">禁坐区＝以对方为中心 <b>前后 N 排 × 左右 M 座</b> 的矩形（<b>同桌也会被判违规</b>）：<br>' +
      '· 前后 <b>1</b> / 左右 <b>1</b> → 对方周围 3×3 的<b>八个邻座</b>都不能坐；<br>' +
      '· 前后 <b>0</b> / 左右 <b>1</b> → 只看同一排的<b>左右各 1 座</b>，前后不限；<br>' +
      '· 前后 <b>2</b> / 左右 <b>0</b> → 只看同一列的<b>前后各 2 排</b>；<br>' +
      '· 填 <b>0</b> 表示该方向只看"正同一排/列"，两个都填 0 则无实际约束</div></div>' +
      '<div class="form-row only-group"><label>学生小组</label><select id="r_group">' + groupOpts + '</select>' +
      '<div class="hint">小组在「① 名单」页勾选学生后创建；成员随时可改，规则自动跟随</div></div>' +
      '<div class="form-row only-group" id="blockRow" ' + (r.mode === 'block' ? '' : 'style="display:none"') + '>' +
      '<label>聚到区域（可选）</label>' +
      '<select id="r_blockArea"><option value="">（任意：全组落在同一区域即可）</option>' + areaOpts + '</select>' +
      '<div class="hint">区域在「② 布局」页框选；布局里没有区域时"同一区域"这一项自动跳过。判定标准：组员两两同桌（奇数人可落单 1 人）＋ 座位包围盒尽量填满（越紧凑越接近矩形）</div></div>' +
      '<div class="form-row only-fixed"><label>锁定座位</label><select id="r_fixSeat"><option value="">— 选择座位 —</option>' + seatOpts + '</select>' +
      '<div class="hint">勾选下方「硬约束」时：生成会先把这个学生预置到该座位，且拖拽也移不动他；布局改动导致该座位不可用时锁定自动暂停</div></div>' +
      '<div class="form-row only-area"><label>目标区域</label><select id="r_area">' + areaOpts + '</select>' +
      '<div class="hint">区域需先在「布局」页框选</div></div>' +
      '<div class="form-row only-ban"><label>禁坐范围</label>' +
      '<select id="r_banType">' +
      '<option value="area"' + (r.seat ? '' : ' selected') + '>某个区域</option>' +
      '<option value="seat"' + (r.seat ? ' selected' : '') + '>某个具体座位</option>' +
      '</select></div>' +
      '<div class="form-row only-ban" id="banAreaRow"><select id="r_banArea">' + areaOpts + '</select></div>' +
      '<div class="form-row only-ban" id="banSeatRow" ' + (r.seat ? '' : 'style="display:none"') + '>' +
      '<select id="r_banSeat"><option value="">— 选择座位 —</option>' + seatOpts + '</select></div>' +
      '<div class="form-row"><label>权重（越高越优先满足）</label>' +
      '<input type="range" id="r_weight" min="0" max="100" value="' + (r.weight == null ? 50 : r.weight) + '" style="width:100%">' +
      '<span class="muted">当前权重：<b id="r_weightVal">' + (r.weight == null ? 50 : r.weight) + '</b></span></div>' +
      '<div class="form-row"><label class="hard-check" style="font-size:13px"><input type="checkbox" id="r_hard"' + (r.hard ? ' checked' : '') + '> 硬约束（必须满足，无法满足时方案判为无效）</label></div>' +
      '<div class="form-actions"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button></div>');

    const body = $('modalBody');
    body.querySelector('[data-act="cancel"]').onclick = closeModal;

    // 类型切换显隐
    const typeSel = body.querySelector('#r_type');
    const modeSel = body.querySelector('#r_mode');
    /** 关系模式的二级显隐（距离/双阈值/聚块三选一；非 separate/group 类型下全隐藏） */
    const applyModeUI = function () {
      const t = typeSel.value, v = modeSel.value;
      const relevant = (t === 'separate' || t === 'group');
      body.querySelector('#distRow').style.display = relevant && (v === 'manhattan' || v === 'distance') ? '' : 'none';
      body.querySelector('#hvRow').style.display = relevant && v === 'hv' ? '' : 'none';
      body.querySelector('#blockRow').style.display = relevant && v === 'block' ? '' : 'none';
    };
    const applyTypeUI = function () {
      const t = typeSel.value;
      body.querySelectorAll('.only-pair,.only-separate,.only-group,.only-area,.only-ban,.only-fixed').forEach(function (el) {
        el.style.display = el.classList.contains('only-' + t) ? '' : 'none';
      });
      body.querySelector('#lb_a').textContent =
        t === 'area' ? '学生（必须坐进区域）' : t === 'fixed' ? '学生（要锁定的学生）' : '学生 A';
      // 固定座位默认按硬约束处理（需要时老师可手动取消）
      if (t === 'fixed' && !existing) body.querySelector('#r_hard').checked = true;
      applyModeUI();
    };
    typeSel.onchange = applyTypeUI;
    applyTypeUI();
    modeSel.onchange = applyModeUI;
    body.querySelector('#r_banType').onchange = function () {
      body.querySelector('#banAreaRow').style.display = this.value === 'area' ? '' : 'none';
      body.querySelector('#banSeatRow').style.display = this.value === 'seat' ? '' : 'none';
    };
    body.querySelector('#r_weight').oninput = function () {
      body.querySelector('#r_weightVal').textContent = this.value;
    };

    body.querySelector('[data-act="ok"]').onclick = function () {
      const t = typeSel.value;
      const rule = existing || S().Rules.defaultRule(t);
      rule.type = t;
      rule.aId = body.querySelector('#r_a').value || null;
      rule.bId = body.querySelector('#r_b').value || null;
      rule.cId = body.querySelector('#r_c') ? body.querySelector('#r_c').value || null : null;
      rule.mode = body.querySelector('#r_mode').value;
      if (rule.mode === 'hv') {
        rule.minRows = Math.max(0, parseInt(body.querySelector('#r_minRows').value) || 0);
        rule.minCols = Math.max(0, parseInt(body.querySelector('#r_minCols').value) || 0);
        delete rule.minDist;
      } else {
        rule.minDist = Math.max(0, parseInt(body.querySelector('#r_minDist').value) || 0);
        delete rule.minRows; delete rule.minCols;
      }
      // 各类型专属字段：清掉不属于当前类型的残留值，避免编辑类型后留下脏数据
      rule.groupId = t === 'group' ? (body.querySelector('#r_group').value || null) : null;
      if (t === 'group') { rule.aId = null; rule.bId = null; rule.cId = null; }
      if (t === 'fixed') {
        rule.seat = body.querySelector('#r_fixSeat').value || null;
        rule.areaId = null;
      } else if (t === 'ban') {
        const bt = body.querySelector('#r_banType').value;
        rule.areaId = bt === 'area' ? (body.querySelector('#r_banArea').value || null) : null;
        rule.seat = bt === 'seat' ? (body.querySelector('#r_banSeat').value || null) : null;
      } else if (t === 'area') {
        rule.areaId = body.querySelector('#r_area').value || null;
        rule.seat = null;
      } else if (t === 'group') {
        // 「聚在一起」可选指定聚到哪个区域；其余模式不用 areaId
        rule.areaId = rule.mode === 'block' ? (body.querySelector('#r_blockArea').value || null) : null;
        rule.seat = null;
      } else {
        rule.areaId = null;
        rule.seat = null;
      }
      rule.weight = parseInt(body.querySelector('#r_weight').value) || 0;
      rule.hard = body.querySelector('#r_hard').checked;

      // 校验
      if (t !== 'group' && !rule.aId) { toast('请选择学生', 'err'); return; }
      if ((t === 'pair' || t === 'separate') && (!rule.bId || rule.bId === rule.aId)) { toast('请选择另一位学生', 'err'); return; }
      if (t === 'pair' && rule.cId) {
        if (rule.cId === rule.aId || rule.cId === rule.bId) { toast('第三人不能与 A/B 重复', 'err'); return; }
        const groups2 = S().Layout.columnGroups((S().Storage.currentData(state) || {}).layout || { rows: 6, cols: 8 });
        const maxW = Math.max.apply(null, groups2.map(function (g) { return g[1] - g[0] + 1; }));
        if (maxW < 3) toast('提示：当前布局各组最多 ' + maxW + ' 列，3 人同桌可能无法满足，建议过道改为含 3 列的组（如 2,5,7）', 'err');
      }
      if (t === 'group') {
        if (!rule.groupId) { toast('请选择学生小组（需先在「① 名单」页勾选学生建组）', 'err'); return; }
        const g = S().Groups.find(groups, rule.groupId);
        if (!g || S().Groups.membersOf(g).length < 2) { toast('该小组成员不足 2 人，无法设置组内关系', 'err'); return; }
        if (rule.mode === 'block') {
          const need = S().Groups.membersOf(g).length;
          const area = rule.areaId ? S().Layout.findArea(d.layout, rule.areaId) : null;
          if (area && area.seats.length < need) {
            toast('区域「' + area.name + '」只有 ' + area.seats.length + ' 个座位，装不下 ' + need + ' 人', 'err');
            return;
          }
          if (need > S().Layout.availableSeats(d.layout).length) {
            toast('可用座位不足，装不下 ' + need + ' 人', 'err');
            return;
          }
        }
      }
      if (t === 'fixed') {
        if (!rule.seat) { toast('请选择要锁定的座位', 'err'); return; }
        if (!S().Layout.isSeatAvailable(d.layout, rule.seat)) { toast('该座位当前不可用，请换一个座位', 'err'); return; }
        const clash = S().Rules.rulesOf(state).filter(function (x) {
          return x.id !== rule.id && x.type === 'fixed' && x.hard && rule.hard &&
            (x.aId === rule.aId || x.seat === rule.seat);
        })[0];
        if (clash) {
          toast('与已有固定座位规则冲突：' + S().Rules.describeRule(clash, students, d.layout, groups) +
            '（同一个学生或同一个座位只能硬锁定一次）', 'err');
          return;
        }
      }
      if (t === 'area' && !rule.areaId) { toast('请选择目标区域（需先在布局页创建区域）', 'err'); return; }
      if (t === 'ban') {
        const bt = body.querySelector('#r_banType').value;
        if (bt === 'seat' && !rule.seat) { toast('请选择禁坐座位', 'err'); return; }
        if (bt === 'area' && !rule.areaId) { toast('请选择禁坐区域', 'err'); return; }
      }

      if (existing) S().Rules.updateRule(state, existing.id, rule);
      else S().Rules.addRule(state, rule);
      closeModal();
      saveAndRender();
      toast(existing ? '规则已更新' : '规则已添加', 'ok');
    };
  }

  /* ─────────── 排座页 ─────────── */

  function showGenOverlay() {
    $('genOverlay').classList.remove('hidden');
    $('genBar').style.width = '8%';
    let p = 8;
    clearInterval(ui.genTimer);
    ui.genTimer = setInterval(function () {
      p = Math.min(92, p + Math.random() * 12);
      $('genBar').style.width = p + '%';
    }, 120);
  }
  function hideGenOverlay() {
    clearInterval(ui.genTimer);
    ui.genTimer = null;
    $('genBar').style.width = '100%';
    setTimeout(function () { $('genOverlay').classList.add('hidden'); }, 150);
  }

  function doGenerate() {
    const d = S().Storage.currentData(state);
    const cls = S().Storage.currentClass(state);
    if (!cls || !cls.students.length) { toast('请先添加学生名单', 'err'); return; }
    const students = cls.students;
    const cap = S().Layout.canGenerate(d.layout, students.length);
    if (!cap.ok) { toast('可用座位不足：需要 ' + cap.need + ' 个，当前只有 ' + cap.avail + ' 个。请到「布局」页调整', 'err'); return; }
    // 过滤引用已删除学生的规则、以及引用了已消失小组的小组规则
    const validIds = {};
    students.forEach(function (s) { validIds[s.id] = true; });
    const badRules = d.rules.filter(function (r) {
      if (r.type === 'group') {
        const g = S().Groups.find(d.groups, r.groupId);
        return !g || S().Groups.membersOf(g).length < 2;
      }
      return (r.aId && !validIds[r.aId]) || (r.bId && !validIds[r.bId]) || (r.cId && !validIds[r.cId]);
    });
    if (badRules.length) {
      d.rules = d.rules.filter(function (r) { return badRules.indexOf(r) < 0; });
      S().Storage.save(state);
      toast('已自动移除 ' + badRules.length + ' 条失效规则（引用了已删除的学生或小组）', 'err');
    }
    // 固定座位的座位若已不可用（布局改动/标记不可用），生成结果里一并提示"已暂停"
    const pausedPins = d.rules.filter(function (r) {
      return r.type === 'fixed' && r.seat && !S().Layout.isSeatAvailable(d.layout, r.seat);
    });
    const pinWarn = pausedPins.length
      ? '；有 ' + pausedPins.length + ' 条固定座位规则因座位不可用已暂停'
      : '';
    const count = Math.max(1, Math.min(20, parseInt($('genCount').value) || 10));
    showGenOverlay();
    setTimeout(function () {
      let solutions;
      try {
        solutions = S().Anneal.generateMany(students, d.layout, d.rules, count, null, d.groups || []);
      } catch (e) {
        console.error(e);
        hideGenOverlay();
        toast('生成失败：' + e.message, 'err');
        return;
      }
      d.solutions = solutions;
      d.currentSolutionId = solutions.length ? solutions[0].id : null;
      S().Storage.save(state);
      hideGenOverlay();
      renderAll();
      const hard = solutions.filter(function (s) { return s.hardFailed; }).length;
      toast('已生成 ' + solutions.length + ' 套方案' + (hard ? '，其中 ' + hard + ' 套未满足硬约束' : '') + pinWarn, hard ? 'err' : 'ok');
    }, 40);
  }

  function saveCurrentSolution() {
    const d = S().Storage.currentData(state);
    if (!d) return;
    const cur = d.solutions.find(function (s) { return s.id === d.currentSolutionId; });
    if (!cur) { toast('当前没有可保存的方案', 'err'); return; }
    const copy = {
      id: S().Storage.uid('p'),
      name: cur.name + ' 副本',
      createdAt: Date.now(),
      assignment: Object.assign({}, cur.assignment),
      totalCost: cur.totalCost,
      hardFailed: cur.hardFailed
    };
    d.solutions.push(copy);
    d.currentSolutionId = copy.id;
    saveAndRender();
    toast('已保存方案「' + copy.name + '」，生成新方案后可回来对比', 'ok');
  }

  function renderResultArea() {
    const d = S().Storage.currentData(state);
    const cls = S().Storage.currentClass(state);
    const grid = $('resultGrid');
    if (!d || !cls || !d.solutions.length || !d.currentSolutionId) {
      grid.innerHTML = '';
      $('violationList').innerHTML = '';
      $('solutionList').innerHTML = '';
      $('solutionInfo').textContent = '';
      $('solutionSide').classList.add('hidden');
      $('resultEmpty').classList.remove('hidden');
      return;
    }
    $('resultEmpty').classList.add('hidden');
    $('solutionSide').classList.remove('hidden');
    const cur = d.solutions.find(function (s) { return s.id === d.currentSolutionId; });
    if (!cur) { grid.innerHTML = ''; return; }
    const evalResult = S().Render.renderResultGrid(grid, d.layout, cls.students, cur.assignment, d.rules, d.groups || []);
    S().Render.renderViolations(evalResult.violations, $('violationList'), d.layout, cur.assignment);
    S().Render.renderSolutions(state, $('solutionList'), $('solutionInfo'));
    const ruleCount = S().Render.renderResultRules($('resultRules'), d.rules, cls.students, d.layout, evalResult, d.groups || []);
    $('resultRuleCount').textContent = ruleCount ? '（' + ruleCount + ' 条）' : '';
  }

  function flashSeat(key) {
    const el = $('resultGrid').querySelector('.seat[data-key="' + key + '"]');
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  /* ─────────── 初始化与事件绑定 ─────────── */

  function renderAll() {
    renderClassSelect();
    renderRosterArea();
    renderLayoutArea();
    renderRuleArea();
    renderResultArea();
  }

  function bindEvents() {
    // 步骤导航
    document.querySelectorAll('.step-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ui.step = +btn.dataset.step;
        document.querySelectorAll('.step-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.step-panel').forEach(function (p) {
          p.classList.toggle('active', p.id === 'step-' + ui.step);
        });
      });
    });

    // 班级
    $('btnAddClass').onclick = newClass;
    $('classSelect').addEventListener('change', function () {
      state.currentClassId = this.value || null;
      ui.selectedAreaId = null;
      ui.picked = {};
      ui.editingGroupId = null;
      saveAndRender();
    });

    // 名单
    $('btnAddStudent').onclick = openAddStudentModal;
    $('btnPaste').onclick = openPasteModal;
    // 导入：先弹格式说明，再选文件
    $('btnImportFile').onclick = function () {
      openModal('导入名单 — 格式要求', '' +
        '<div class="form-row" style="font-size:13px;line-height:1.8">' +
        '<p>✅ 支持 <b>Excel(.xlsx/.xls)</b>、<b>CSV</b>、<b>文本(.txt)</b></p>' +
        '<p>📌 <b>第一列必须是学生姓名</b>（必需）</p>' +
        '<p>📌 可选列（有表头时自动识别）：<b>学号、性别、身高、备注</b></p>' +
        '<p>📌 表头行不必在第一行：首行是"XX班名单"标题、第二行才是表头，也能正确识别</p>' +
        '<p>📌 没有表头时，默认把第一列当姓名</p>' +
        '<p>📌 重复姓名会自动跳过；导入是<b>追加</b>到当前名单</p>' +
        '<p class="muted">示例：<br>姓名,学号,性别,身高,备注<br>张三,0501,男,172,近视</p>' +
        '</div>' +
        '<div class="form-actions"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">选择文件…</button></div>');
      const body = $('modalBody');
      body.querySelector('[data-act="cancel"]').onclick = closeModal;
      body.querySelector('[data-act="ok"]').onclick = function () {
        closeModal();
        $('fileInput').click();
      };
    };
    // 清空名单（带确认；同时清空已生成方案与引用失效规则的提示）
    $('btnClearRoster').onclick = function () {
      const n = S().Roster.students(state).length;
      if (!n) { toast('名单已经是空的', 'err'); return; }
      confirmModal('确定清空当前班级的 ' + n + ' 名学生？<br><span class="muted">已生成的方案、学生小组也会一并清空；引用这些学生的规则将失效。</span>', function () {
        S().Roster.clearStudents(state);
        const d = S().Storage.currentData(state);
        if (d) { d.solutions = []; d.currentSolutionId = null; d.groups = []; }
        ui.picked = {};
        ui.editingGroupId = null;
        saveAndRender();
        toast('名单已清空', 'ok');
      });
    };
    $('fileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) importFile(this.files[0]);
      this.value = '';
    });
    $('rosterBody').addEventListener('change', function (e) {
      const input = e.target.closest('input');
      if (!input) return;
      const tr = input.closest('tr');
      if (!tr) return;
      // 勾选框：用于组建/编辑小组
      if (input.dataset.pick !== undefined) {
        togglePick(input.dataset.pick, input.checked);
        return;
      }
      if (input.dataset.f === undefined) return;
      S().Roster.updateStudent(state, tr.dataset.id, { [input.dataset.f]: input.value });
      S().Storage.save(state);
      renderRosterArea();
    });
    $('rosterBody').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      confirmModal('删除该学生？', function () {
        S().Roster.removeStudent(state, btn.dataset.del);
        delete ui.picked[btn.dataset.del];
        S().Groups.cleanup(state);
        saveAndRender();
      });
    });
    // 全选/取消全选（用于批量建组）
    $('rosterPickAll').addEventListener('change', function () { setAllPicked(this.checked); });
    // 小组工具条（事件委托：chip 选中/删除、建组、重命名、完成编辑）
    $('groupBar').addEventListener('click', function (e) {
      const del = e.target.closest('[data-groupdel]');
      if (del) { e.stopPropagation(); delGroup(del.dataset.groupdel); return; }
      const chip = e.target.closest('[data-group]');
      if (chip) { editGroup(chip.dataset.group); return; }
      if (e.target.closest('#btnNewGroup')) { newGroupFromPicked(); return; }
      if (e.target.closest('#btnRenameGroup')) { renameGroup(ui.editingGroupId); return; }
      if (e.target.closest('#btnExitGroupEdit')) { exitGroupEdit(); return; }
    });

    // 布局
    // 排数/列数/过道位置实时生效（输入完成即重绘网格，清空旧方案）
    ['layoutRows', 'layoutCols', 'layoutAisles'].forEach(function (id) {
      $(id).addEventListener('change', function () { applyLayoutValues(); });
    });
    // 门方向实时生效（只影响显示，不清空方案）
    $('layoutDoor').addEventListener('change', function () {
      const d = S().Storage.currentData(state);
      if (!d) return;
      d.layout.doorSide = this.value === 'right' ? 'right' : 'left';
      saveAndRender();
    });
    $('btnNewArea').onclick = newArea;
    $('btnDelArea').onclick = delArea;
    $('areaSelect').addEventListener('change', function () {
      ui.selectedAreaId = this.value || null;
      renderLayoutArea();
    });
    $('layoutGrid').addEventListener('click', function (e) {
      const seat = e.target.closest('.seat');
      if (!seat || seat.classList.contains('unavailable')) return;
      const d = S().Storage.currentData(state);
      if (!d || !ui.selectedAreaId) { toast('请先在左侧新建并选中一个区域，再点击座位', 'err'); return; }
      S().Layout.toggleAreaSeat(d.layout, ui.selectedAreaId, seat.dataset.key);
      saveAndRender();
    });
    $('layoutGrid').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      const seat = e.target.closest('.seat');
      if (!seat) return;
      const d = S().Storage.currentData(state);
      if (!d) return;
      const key = seat.dataset.key;
      const i = d.layout.unavailable.indexOf(key);
      if (i >= 0) d.layout.unavailable.splice(i, 1);
      else d.layout.unavailable.push(key);
      saveAndRender();
    });

    // 规则
    $('btnAddRule').onclick = function () { openRuleModal(null); };
    $('ruleList').addEventListener('click', function (e) {
      const del = e.target.closest('[data-del]');
      const edit = e.target.closest('[data-edit]');
      if (del) {
        confirmModal('删除这条规则？', function () {
          S().Rules.removeRule(state, del.dataset.del);
          saveAndRender();
        });
      } else if (edit) {
        const r = S().Rules.rulesOf(state).find(function (x) { return x.id === edit.dataset.edit; });
        if (r) openRuleModal(r);
      }
    });
    $('ruleList').addEventListener('change', function (e) {
      const el = e.target;
      const card = el.closest('.rule-card');
      if (!card) return;
      const id = card.dataset.id;
      if (el.dataset.weight !== undefined) {
        S().Rules.updateRule(state, id, { weight: +el.value });
        card.querySelector('.w-val').textContent = el.value;
        S().Storage.save(state);
      } else if (el.dataset.hard !== undefined) {
        S().Rules.updateRule(state, id, { hard: el.checked });
        S().Storage.save(state);
      }
    });

    // 排座
    $('btnGenerate').onclick = doGenerate;
    $('btnSaveSolution').onclick = saveCurrentSolution;
    $('solutionList').addEventListener('click', function (e) {
      const del = e.target.closest('[data-soldel]');
      const chip = e.target.closest('[data-sol]');
      const d = S().Storage.currentData(state);
      if (!d) return;
      if (del) {
        e.stopPropagation();
        confirmModal('删除该方案？', function () {
          const id = del.dataset.soldel;
          d.solutions = d.solutions.filter(function (s) { return s.id !== id; });
          if (d.currentSolutionId === id) d.currentSolutionId = d.solutions.length ? d.solutions[d.solutions.length - 1].id : null;
          saveAndRender();
        });
        return;
      }
      if (chip) {
        d.currentSolutionId = chip.dataset.sol;
        saveAndRender();
      }
    });
    $('violationList').addEventListener('click', function (e) {
      const item = e.target.closest('.vio-item');
      if (!item || !item.dataset.keys) return;
      item.dataset.keys.split(',').forEach(flashSeat);
    });
    $('btnExportPNG').onclick = function () {
      const d = S().Storage.currentData(state);
      const cls = S().Storage.currentClass(state);
      if (!d || !cls) return;
      const cur = d.solutions.find(function (s) { return s.id === d.currentSolutionId; });
      if (!cur) { toast('请先生成方案', 'err'); return; }
      S().Export.exportPNG(cls.name + ' 座位表', d.layout, cls.students, cur.assignment, d.rules);
    };
    $('btnExportExcel').onclick = function () {
      const d = S().Storage.currentData(state);
      const cls = S().Storage.currentClass(state);
      if (!d || !cls) return;
      const cur = d.solutions.find(function (s) { return s.id === d.currentSolutionId; });
      if (!cur) { toast('请先生成方案', 'err'); return; }
      S().Export.exportExcel(cls.name + ' 座位表', d.layout, cls.students, cur.assignment, d.rules);
    };
    $('btnExportJSON').onclick = function () {
      if (!state.classes.length) { toast('还没有可备份的数据', 'err'); return; }
      S().Storage.exportJSON(state);
      toast('备份文件已导出，请妥善保存（换电脑时可导入恢复）', 'ok');
    };

    // Modal 通用关闭
    $('modalClose').onclick = closeModal;
    $('modalOverlay').addEventListener('mousedown', function (e) {
      if (e.target === this) closeModal();
    });

    // 拖拽（结果网格）
    S().Drag.bind($('resultGrid'), state, function () { renderResultArea(); });
  }

  function init() {
    state = S().Storage.load();
    // 修补：无班级时自动建一个并持久化
    if (!state.classes.length) {
      S().Storage.addClass(state, '示例班级');
      S().Storage.save(state);
    }
    bindEvents();
    renderAll();
  }

  global.Seat = global.Seat || {};
  global.Seat.App = { init };
})(typeof window !== 'undefined' ? window : globalThis);

// 页面就绪后启动
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Seat.App.init(); });
  } else {
    Seat.App.init();
  }
}
