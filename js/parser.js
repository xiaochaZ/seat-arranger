/**
 * parser.js — 名单文件解析：CSV（含 BOM/分隔符识别）、Excel（SheetJS，缺失时降级）
 * 全局命名空间：Seat.Parser
 */
(function (global) {
  'use strict';

  const hasXLSX = function () {
    return typeof XLSX !== 'undefined' && typeof XLSX.read === 'function';
  };

  /** 文本 → 行数组（处理 BOM、统一换行、去空行） */
  function splitLines(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter(function (l) { return l.trim().length > 0; });
  }

  /** 自动识别分隔符（逗号/制表符/分号），返回 rows 二维数组 */
  function splitRows(text) {
    const lines = splitLines(text);
    if (!lines.length) return [];
    // 用首行判断分隔符
    const first = lines[0];
    let sep = ',';
    if (first.indexOf('\t') >= 0) sep = '\t';
    else if (first.indexOf(';') >= 0 && first.indexOf(';') < first.indexOf(',')) sep = ';';
    return lines.map(function (l) {
      return l.split(sep).map(function (cell) { return cell.trim(); });
    });
  }

  /** 纯文本名单（每行一个姓名）→ 姓名数组 */
  function parseNamesText(text) {
    return global.Seat.Roster.parseText(text);
  }

  /** 读取 CSV/文本文件（异步）→ rows 二维数组 */
  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        let text = String(reader.result);
        if (/^\uFEFF/.test(text)) text = text.slice(1); // 去 BOM
        resolve(splitRows(text));
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** 读取 Excel 文件（异步）→ rows 二维数组；无 SheetJS 时抛错 */
  function readExcelFile(file) {
    return new Promise(function (resolve, reject) {
      if (!hasXLSX()) {
        reject(new Error('Excel 解析组件未加载（lib/xlsx.full.min.js 缺失），请改用 CSV 或文本导入'));
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) { reject(new Error('Excel 文件没有工作表')); return; }
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          resolve(rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).trim(); }); }));
        } catch (e) {
          reject(new Error('Excel 解析失败：' + e.message));
        }
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * rows 二维数组 → 学生列表
   * 表头识别：扫描前 5 行找含"姓名/名字/学生"的表头行（支持首行为标题行的情况，
   * 如首行"高二5班名单"、第二行"新学号|姓名"）；找到则做列映射，找不到按"第一列=姓名"。
   * 返回 { students: [{name, studentNo, gender, height, note}], headerUsed, total }
   */
  function rowsToStudents(rows) {
    const out = { students: [], headerUsed: false, total: rows.length };
    if (!rows.length) return out;
    let start = 0;
    let colMap = { name: 0, studentNo: -1, gender: -1, height: -1, note: -1 };
    // 扫描前 5 行找表头（可能首行是标题/班级名）
    const scanLimit = Math.min(5, rows.length);
    for (let i = 0; i < scanLimit; i++) {
      const row = rows[i].map(function (c) { return String(c == null ? '' : c).trim(); });
      const nameIdx = row.findIndex(function (h) {
        return /姓名|名字|学生/.test(h) || h.toLowerCase() === 'name';
      });
      if (nameIdx >= 0) {
        out.headerUsed = true;
        start = i + 1;
        colMap = { name: nameIdx, studentNo: -1, gender: -1, height: -1, note: -1 };
        row.forEach(function (h, j) {
          if (j === nameIdx) return;
          if (/学号|学籍/.test(h)) colMap.studentNo = j;
          else if (/性别/.test(h)) colMap.gender = j;
          else if (/身高/.test(h)) colMap.height = j;
          else if (/备注|说明/.test(h)) colMap.note = j;
        });
        break;
      }
    }
    const seen = {};
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const name = r[colMap.name >= 0 ? colMap.name : 0];
      if (!name) continue;
      if (seen[name]) continue;
      seen[name] = true;
      out.students.push({
        name: String(name).trim(),
        studentNo: colMap.studentNo >= 0 ? String(r[colMap.studentNo]) : '',
        gender: colMap.gender >= 0 ? String(r[colMap.gender]) : '',
        height: colMap.height >= 0 ? String(r[colMap.height]) : '',
        note: colMap.note >= 0 ? String(r[colMap.note]) : ''
      });
    }
    return out;
  }

  /** 统一入口：根据文件名选择解析器（异步）→ rowsToStudents 的结果 */
  function importFile(file) {
    const name = (file.name || '').toLowerCase();
    const isExcel = /\.(xlsx|xls)$/.test(name);
    const p = isExcel ? readExcelFile(file) : readTextFile(file);
    return p.then(rowsToStudents);
  }

  global.Seat = global.Seat || {};
  global.Seat.Parser = { hasXLSX, splitLines, splitRows, parseNamesText, readTextFile, readExcelFile, rowsToStudents, importFile };
})(typeof window !== 'undefined' ? window : globalThis);
