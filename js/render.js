/**
 * render.js — 各视图的 DOM 渲染（名单表格/布局网格/结果网格/方案列表/违规面板/规则列表）
 * 全局命名空间：Seat.Render
 */
(function (global) {
  'use strict';

  const S = function () { return global.Seat; };

  /** 转义 HTML */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 网格容器上设置 grid-template-columns（每个过道一个 26px 轨道，与 CSS .aisle-gap 一致） */
  function applyGridColumns(el, layout) {
    let template = '';
    for (let c = 1; c <= layout.cols; c++) {
      if (layout.aisles && layout.aisles.indexOf(c - 1) >= 0) template += ' 26px'; // 过道在第 c-1 列后
      template += ' minmax(84px, 1fr)';
    }
    el.style.gridTemplateColumns = template;
  }

  /** 渲染讲台 + 网格结构（编辑或结果共用骨架）
   *  全部显式 grid 定位（讲台第1行、每个过道占独立列轨道、座位从第2行起），
   *  不依赖 auto-placement，避免过道元素错位/重叠 */
  function renderSeatGrid(el, layout, seatRenderer) {
    const S = global.Seat;
    el.innerHTML = '';
    applyGridColumns(el, layout);
    const podium = document.createElement('div');
    podium.className = 'podium';
    podium.textContent = '讲 台';
    podium.style.gridColumn = '1 / -1';
    podium.style.gridRow = '1';
    el.appendChild(podium);
    // 每个过道一个条带元素，占据对应轨道，从第 2 行跨到最后一行
    (layout.aisles || []).forEach(function (a) {
      const gap = document.createElement('div');
      gap.className = 'aisle-gap';
      gap.style.gridColumn = String(S.Layout.gridAisleIndex(layout, a));
      gap.style.gridRow = '2 / ' + (layout.rows + 2);
      el.appendChild(gap);
    });
    for (let r = 1; r <= layout.rows; r++) {
      for (let c = 1; c <= layout.cols; c++) {
        const seat = seatRenderer(layout, r, c);
        seat.style.gridColumn = String(S.Layout.gridColIndex(layout, c));
        seat.style.gridRow = String(r + 1);
        el.appendChild(seat);
      }
    }
    // 门标记：前门 + 后门（都在门那一侧，分别靠近第 1 排和最后一排）
    ['front', 'back'].forEach(function (which) {
      const door = document.createElement('div');
      door.className = 'door-mark ' + which + ' ' + (layout.doorSide === 'right' ? 'right' : 'left');
      door.textContent = which === 'front' ? '前门' : '后门';
      el.appendChild(door);
    });
  }

  /* ── 布局编辑网格 ── */
  function renderLayoutEditor(container, layout, selectedAreaId) {
    const S = global.Seat;
    renderSeatGrid(container, layout, function (layout, r, c) {
      const key = S.Layout.seatKey(r, c);
      const div = document.createElement('div');
      div.className = 'seat';
      div.dataset.key = key;
      const unavailable = layout.unavailable.indexOf(key) >= 0;
      const areaIdx = S.Layout.areaIndexOfSeat(layout, key);
      if (unavailable) div.classList.add('unavailable');
      else if (areaIdx >= 0) div.classList.add('zone-' + (areaIdx % S.Layout.ZONE_COLORS.length));
      div.innerHTML =
        '<div class="seat-no">' + esc(S.Layout.seatLabel(layout, key)) + '</div>' +
        '<div class="seat-name">' + (unavailable ? '✕ 不可用' : (areaIdx >= 0 ? '区域' : '·')) + '</div>';
      return div;
    });
  }

  /* ── 结果网格 ── */
  function renderResultGrid(container, layout, students, assignment, rules) {
    const S = global.Seat;
    const ctx = { layout: layout, students: students };
    const evalResult = S.Cost.evaluate(assignment, rules, ctx);
    const violationKeys = {}; // 座位key → 违规条数
    evalResult.violations.forEach(function (v) {
      if (!v.rule) return;
      // 找涉及座位
      if (v.rule.type === 'pair' || v.rule.type === 'separate') {
        [v.rule.aId, v.rule.bId].forEach(function (sid) {
          for (const k in assignment) if (assignment[k] === sid) {
            violationKeys[k] = (violationKeys[k] || 0) + 1;
          }
        });
      } else if (v.rule.aId) {
        for (const k in assignment) if (assignment[k] === v.rule.aId) {
          violationKeys[k] = (violationKeys[k] || 0) + 1;
        }
      }
    });
    // 满足的同桌规则 → 同色底色/边框（2 人或 3 人）
    const pairColors = {}; // studentId → 'pair-N'
    let pi = 0;
    (rules || []).forEach(function (rule) {
      if (rule.type !== 'pair') return;
      const kv = S.Cost.ruleViolation(rule, assignment, ctx);
      if (!kv.violated) {
        pi = Math.min(pi + 1, 3);
        [rule.aId, rule.bId].forEach(function (id) { pairColors[id] = 'pair-' + pi; });
        if (rule.cId) pairColors[rule.cId] = 'pair-' + pi;
      }
    });
    const nameOf = {};
    students.forEach(function (s) { nameOf[s.id] = s.name; });

    renderSeatGrid(container, layout, function (layout, r, c) {
      const key = S.Layout.seatKey(r, c);
      const div = document.createElement('div');
      div.className = 'seat';
      div.dataset.key = key;
      const unavailable = layout.unavailable.indexOf(key) >= 0;
      const areaIdx = S.Layout.areaIndexOfSeat(layout, key);
      if (unavailable) div.classList.add('unavailable');
      else if (areaIdx >= 0) div.classList.add('zone-' + (areaIdx % S.Layout.ZONE_COLORS.length));
      const sid = assignment[key];
      const badCount = violationKeys[key] || 0;
      if (badCount > 0) div.classList.add('violate');
      if (sid) {
        const pc = pairColors[sid];
        if (pc) div.classList.add(pc);
        div.innerHTML =
          '<div class="seat-no">' + esc(S.Layout.seatLabel(layout, key)) + '</div>' +
          '<div class="seat-name">' + esc(nameOf[sid] || '?') + '</div>' +
          (badCount > 0 ? '<span class="badge">' + badCount + '</span>' : '');
      } else {
        div.classList.add('empty-seat');
        div.innerHTML = '<div class="seat-no">' + esc(S.Layout.seatLabel(layout, key)) + '</div><div class="seat-name">空</div>';
      }
      div.draggable = !unavailable && !!sid;
      return div;
    });
    return evalResult;
  }

  /* ── 名单表格 ── */
  function renderRoster(state, bodyEl) {
    const S = global.Seat;
    const students = S.Roster.students(state);
    if (!students.length) {
      bodyEl.innerHTML = '';
      return 0;
    }
    bodyEl.innerHTML = students.map(function (s) {
      return '<tr data-id="' + s.id + '">' +
        '<td><input data-f="name" value="' + esc(s.name) + '"></td>' +
        '<td><input data-f="studentNo" value="' + esc(s.studentNo) + '"></td>' +
        '<td><input data-f="gender" value="' + esc(s.gender) + '"></td>' +
        '<td><input data-f="height" value="' + esc(s.height) + '"></td>' +
        '<td><input data-f="note" value="' + esc(s.note) + '"></td>' +
        '<td class="col-op"><button class="icon-btn" data-del="' + s.id + '" title="删除">🗑</button></td>' +
        '</tr>';
    }).join('');
    return students.length;
  }

  /* ── 规则列表 ── */
  function renderRuleList(state, container) {
    const S = global.Seat;
    const rules = S.Rules.rulesOf(state);
    const students = S.Roster.students(state);
    const layout = (S.Storage.currentData(state) || {}).layout;
    if (!rules.length) { container.innerHTML = ''; return 0; }
    container.innerHTML = rules.map(function (r) {
      return '<div class="rule-card" data-id="' + r.id + '">' +
        '<span class="rule-type t-' + r.type + '">' + S.Rules.TYPE_NAMES[r.type] + '</span>' +
        '<div class="rule-desc">' + esc(S.Rules.describeRule(r, students, layout)) +
          (r.hard ? '<span class="hard-tag">【硬约束】</span>' : '') + '</div>' +
        '<label class="hard-check"><input type="checkbox" data-hard="1"' + (r.hard ? ' checked' : '') + '>硬约束</label>' +
        '<span class="rule-weight">权重 <input type="range" data-weight="1" min="0" max="100" value="' + r.weight + '">' +
          '<span class="w-val">' + r.weight + '</span></span>' +
        '<span class="rule-actions">' +
          '<button class="icon-btn" data-edit="' + r.id + '" title="编辑">✏️</button>' +
          '<button class="icon-btn" data-del="' + r.id + '" title="删除">🗑</button>' +
        '</span></div>';
    }).join('');
    return rules.length;
  }

  /* ── 方案列表 ── */
  function renderSolutions(state, container, infoEl) {
    const S = global.Seat;
    const d = S.Storage.currentData(state);
    const solutions = d ? d.solutions : [];
    if (!solutions.length) { container.innerHTML = ''; if (infoEl) infoEl.textContent = ''; return; }
    container.innerHTML = solutions.map(function (sol) {
      const act = sol.id === d.currentSolutionId ? ' active' : '';
      const tag = sol.hardFailed ? ' ⚠️' : '';
      return '<span class="sol-chip' + act + '" data-sol="' + sol.id + '">' +
        esc(sol.name) + ' · ' + sol.totalCost + tag +
        '<span class="del" data-soldel="' + sol.id + '" title="删除方案">✕</span></span>';
    }).join('');
    if (infoEl) {
      const cur = solutions.find(function (x) { return x.id === d.currentSolutionId; });
      if (cur) {
        infoEl.textContent = cur.hardFailed
          ? '⚠️ 此方案未满足硬约束，请调整规则后重新生成'
          : '当前方案总代价：' + cur.totalCost + '（越低越好）';
        infoEl.style.color = cur.hardFailed ? '#dc2626' : '';
      }
    }
  }

  /* ── 违规面板（点击条目可定位到涉及座位） ── */
  function renderViolations(violations, container, layout, assignment) {
    container.innerHTML = '';
    if (!Array.isArray(violations) || !violations.length) {
      container.innerHTML = '<div class="vio-ok"><span class="big">✅</span>全部规则已满足</div>';
      return;
    }
    violations.forEach(function (v) {
      const item = document.createElement('div');
      item.className = 'vio-item';
      // 收集涉及座位 key
      const keys = [];
      if (v.rule && layout && assignment) {
        const ids = (v.rule.type === 'pair' || v.rule.type === 'separate')
          ? [v.rule.aId, v.rule.bId]
          : (v.rule.aId ? [v.rule.aId] : []);
        ids.forEach(function (sid) {
          for (const k in assignment) if (assignment[k] === sid) keys.push(k);
        });
      }
      item.dataset.keys = keys.join(',');
      item.innerHTML =
        '<span class="vio-w">' + (v.hard ? '🔒' : v.amount) + '</span>' +
        '<span>' + esc(v.desc) + '</span>';
      container.appendChild(item);
    });
  }

  /* ── 结果页规则列表（所有规则 + 当前方案满足状态） ── */
  function renderResultRules(container, rules, students, layout, evalResult) {
    container.innerHTML = '';
    if (!rules || !rules.length) {
      container.innerHTML = '<div class="empty-tip">暂无规则，可到「③ 规则」页添加</div>';
      return 0;
    }
    const badIds = {};
    (evalResult.violations || []).forEach(function (v) {
      if (v.rule) badIds[v.rule.id] = true;
    });
    rules.forEach(function (r) {
      const item = document.createElement('div');
      const bad = !!badIds[r.id];
      item.className = 'rule-mini ' + (bad ? 'bad' : 'ok');
      item.innerHTML =
        '<span class="st">' + (bad ? '✗' : '✓') + '</span>' +
        '<span>' + esc(global.Seat.Rules.describeRule(r, students, layout)) +
          (r.hard ? ' <b>🔒</b>' : '') + '</span>' +
        '<span class="rw">' + (r.hard ? '硬' : '权' + r.weight) + '</span>';
      container.appendChild(item);
    });
    return rules.length;
  }

  global.Seat = global.Seat || {};
  global.Seat.Render = {
    esc, applyGridColumns, renderSeatGrid, renderLayoutEditor, renderResultGrid,
    renderRoster, renderRuleList, renderSolutions, renderViolations, renderResultRules
  };
})(typeof window !== 'undefined' ? window : globalThis);
