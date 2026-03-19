/**
 * Sheet — spreadsheet component for AC Sciences
 * Handles column/row management, formula evaluation, and DOM rendering.
 */

class Sheet {
  constructor(containerEl, formulaBarEl, formulaCellRefEl) {
    this._columns = [];      // [{ id, name, unit, cells: [string] }]
    this._rowCount = 0;
    this._selectedRow = null;
    this._selectedColId = null;
    this._editingCell = null; // { row, colId }

    this._tableEl = document.getElementById('sheet-table');
    this._headerRow = document.getElementById('sheet-header-row');
    this._unitRow = document.getElementById('sheet-unit-row');
    this._tbody = document.getElementById('sheet-body');
    this._formulaInput = formulaBarEl;
    this._formulaCellRef = formulaCellRefEl;

    this._formulaInput.addEventListener('input', () => this._onFormulaBarInput());
    this._formulaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._commitFormulaBar();
        this._formulaInput.blur();
      }
      if (e.key === 'Escape') {
        this._cancelEdit();
        this._formulaInput.blur();
      }
    });
    this._formulaInput.addEventListener('blur', () => this._commitFormulaBar());
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  loadFromData(sheetData) {
    this._columns = sheetData.columns.map(c => ({
      id: c.id,
      name: c.name,
      unit: c.unit || '',
      cells: c.cells ? [...c.cells] : []
    }));
    this._rowCount = sheetData.rowCount || 0;
    // Ensure all columns have the right number of cells
    this._columns.forEach(col => {
      while (col.cells.length < this._rowCount) col.cells.push('');
      col.cells = col.cells.slice(0, this._rowCount);
    });
    this._render();
  }

  toData() {
    return {
      columns: this._columns.map(c => ({
        id: c.id,
        name: c.name,
        unit: c.unit,
        cells: [...c.cells]
      })),
      rowCount: this._rowCount
    };
  }

  getColumns() {
    return this._columns.map(c => ({ id: c.id, name: c.name, unit: c.unit }));
  }

  /** Returns evaluated numeric data for graphing: [{x, y}] given colId x and y */
  getColumnValues(colId) {
    const col = this._columns.find(c => c.id === colId);
    if (!col) return [];
    return col.cells.map((_, rowIdx) => {
      const v = this._evalCell(colId, rowIdx);
      return typeof v === 'number' && isFinite(v) ? v : null;
    });
  }

  addColumn() {
    const id = 'col_' + Math.random().toString(36).slice(2, 9);
    const col = { id, name: 'Column', unit: '', cells: Array(this._rowCount).fill('') };
    this._columns.push(col);
    this._render();
    this._emitChange();
  }

  addRow() {
    this._rowCount++;
    this._columns.forEach(c => c.cells.push(''));
    this._renderBody();
    this._emitChange();
  }

  deleteColumn(colId) {
    this._columns = this._columns.filter(c => c.id !== colId);
    this._render();
    this._emitChange();
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    this._renderHeader();
    this._renderBody();
  }

  _renderHeader() {
    // Clear existing column headers (keep row-num cell)
    const headerCells = this._headerRow.querySelectorAll('th.col-header');
    headerCells.forEach(th => th.remove());
    const unitCells = this._unitRow.querySelectorAll('th.col-unit-header');
    unitCells.forEach(th => th.remove());

    this._columns.forEach(col => {
      // Name header
      const th = document.createElement('th');
      th.className = 'col-header';
      th.dataset.colId = col.id;

      const inner = document.createElement('div');
      inner.className = 'col-header-inner';

      const top = document.createElement('div');
      top.className = 'col-header-top';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'col-name-input';
      nameInput.value = col.name;
      nameInput.placeholder = 'Name';
      nameInput.addEventListener('change', (e) => {
        col.name = e.target.value.trim() || 'Column';
        this._reEvalAll();
        this._emitChange();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'col-delete-btn';
      delBtn.title = 'Delete column';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => this.deleteColumn(col.id));

      top.appendChild(nameInput);
      top.appendChild(delBtn);
      inner.appendChild(top);
      th.appendChild(inner);
      this._headerRow.appendChild(th);

      // Unit header
      const thUnit = document.createElement('th');
      thUnit.className = 'col-unit-header';
      thUnit.dataset.colId = col.id;

      const unitInput = document.createElement('input');
      unitInput.type = 'text';
      unitInput.className = 'col-unit-input';
      unitInput.value = col.unit;
      unitInput.placeholder = 'unit';
      unitInput.addEventListener('change', (e) => {
        col.unit = e.target.value.trim();
        this._emitChange();
      });

      thUnit.appendChild(unitInput);
      this._unitRow.appendChild(thUnit);
    });
  }

  _renderBody() {
    this._tbody.innerHTML = '';

    for (let r = 0; r < this._rowCount; r++) {
      const tr = document.createElement('tr');
      tr.dataset.row = r;

      // Row number
      const tdNum = document.createElement('td');
      tdNum.className = 'row-num';
      tdNum.textContent = r + 1;
      tr.appendChild(tdNum);

      // Data cells
      this._columns.forEach(col => {
        const td = this._createCell(col.id, r);
        tr.appendChild(td);
      });

      this._tbody.appendChild(tr);
    }
  }

  _createCell(colId, row) {
    const col = this._columns.find(c => c.id === colId);
    const rawVal = col ? col.cells[row] || '' : '';
    const isFormula = rawVal.startsWith('=');

    const td = document.createElement('td');
    td.className = 'data-cell' + (isFormula ? ' is-formula' : '');
    td.dataset.colId = colId;
    td.dataset.row = row;

    // Display span (for formula display mode)
    const display = document.createElement('span');
    display.className = 'cell-display';

    // Input (always present; hidden when formula display mode is active)
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-input';
    input.value = rawVal;
    input.autocomplete = 'off';
    input.spellcheck = false;

    if (isFormula) {
      const evaled = this._evalCell(colId, row);
      display.textContent = evaled === null || evaled === undefined ? '#ERR' : this._formatValue(evaled);
      if (evaled === null || evaled === undefined) td.classList.add('error');
    }

    // Events
    td.addEventListener('click', () => this._selectCell(colId, row));
    td.addEventListener('dblclick', () => this._startEditing(colId, row, td, input));

    input.addEventListener('focus', () => this._selectCell(colId, row));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commitCellInput(colId, row, td, input);
        this._moveSelection(1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this._commitCellInput(colId, row, td, input);
        this._moveSelection(0, 1);
      } else if (e.key === 'Escape') {
        this._cancelEdit();
      }
    });
    input.addEventListener('blur', () => {
      this._commitCellInput(colId, row, td, input);
    });

    td.appendChild(display);
    td.appendChild(input);
    return td;
  }

  // ─── Cell Selection & Editing ─────────────────────────────────────────────

  _selectCell(colId, row) {
    // Deselect previous
    const prev = this._tbody.querySelector('td.data-cell.selected');
    if (prev) prev.classList.remove('selected');

    this._selectedColId = colId;
    this._selectedRow = row;

    const td = this._getCellEl(colId, row);
    if (td) td.classList.add('selected');

    this._updateFormulaBar(colId, row);
  }

  _startEditing(colId, row, td, input) {
    const col = this._columns.find(c => c.id === colId);
    if (!col) return;
    const rawVal = col.cells[row] || '';

    if (td.classList.contains('is-formula')) {
      td.classList.add('editing');
      input.value = rawVal;
      input.style.display = 'block';
    }

    input.focus();
    input.select();
    this._editingCell = { colId, row };
  }

  _commitCellInput(colId, row, td, input) {
    const col = this._columns.find(c => c.id === colId);
    if (!col) return;

    const newVal = input.value;
    const old = col.cells[row];
    if (newVal === old) {
      // Still clean up editing state
      td.classList.remove('editing');
      return;
    }

    col.cells[row] = newVal;
    this._refreshCell(colId, row);
    this._reEvalDependents(colId);
    this._updateFormulaBar(colId, row);
    this._emitChange();
  }

  _cancelEdit() {
    if (this._selectedColId !== null && this._selectedRow !== null) {
      const td = this._getCellEl(this._selectedColId, this._selectedRow);
      if (td) {
        td.classList.remove('editing');
        const input = td.querySelector('.cell-input');
        const col = this._columns.find(c => c.id === this._selectedColId);
        if (input && col) input.value = col.cells[this._selectedRow] || '';
      }
    }
  }

  _moveSelection(dRow, dCol) {
    if (this._selectedRow === null) return;
    const colIdx = this._columns.findIndex(c => c.id === this._selectedColId);
    const newRow = Math.max(0, Math.min(this._rowCount - 1, this._selectedRow + dRow));
    const newColIdx = Math.max(0, Math.min(this._columns.length - 1, colIdx + dCol));
    const newCol = this._columns[newColIdx];
    if (!newCol) return;
    this._selectCell(newCol.id, newRow);
    const td = this._getCellEl(newCol.id, newRow);
    if (td) {
      const input = td.querySelector('.cell-input');
      if (input && !td.classList.contains('is-formula')) input.focus();
    }
  }

  // ─── Formula Bar ─────────────────────────────────────────────────────────

  _updateFormulaBar(colId, row) {
    const col = this._columns.find(c => c.id === colId);
    const colIdx = this._columns.indexOf(col);
    const colLetter = colIdx >= 0 ? String.fromCharCode(65 + colIdx) : '?';
    this._formulaCellRef.textContent = `${colLetter}${row + 1}`;

    if (col) {
      const rawVal = col.cells[row] || '';
      this._formulaInput.value = rawVal;
      this._formulaInput.disabled = false;
    } else {
      this._formulaInput.value = '';
      this._formulaInput.disabled = true;
    }
  }

  _onFormulaBarInput() {
    if (this._selectedColId === null || this._selectedRow === null) return;
    const col = this._columns.find(c => c.id === this._selectedColId);
    if (!col) return;
    // Live update the cell input too
    const td = this._getCellEl(this._selectedColId, this._selectedRow);
    if (td) {
      const input = td.querySelector('.cell-input');
      if (input) input.value = this._formulaInput.value;
    }
  }

  _commitFormulaBar() {
    if (this._selectedColId === null || this._selectedRow === null) return;
    const col = this._columns.find(c => c.id === this._selectedColId);
    if (!col) return;
    const newVal = this._formulaInput.value;
    if (newVal === col.cells[this._selectedRow]) return;
    col.cells[this._selectedRow] = newVal;
    this._refreshCell(this._selectedColId, this._selectedRow);
    this._reEvalDependents(this._selectedColId);
    this._emitChange();
  }

  // ─── Cell Refresh ─────────────────────────────────────────────────────────

  _refreshCell(colId, row) {
    const col = this._columns.find(c => c.id === colId);
    if (!col) return;
    const rawVal = col.cells[row] || '';
    const isFormula = rawVal.startsWith('=');

    const td = this._getCellEl(colId, row);
    if (!td) return;

    const display = td.querySelector('.cell-display');
    const input = td.querySelector('.cell-input');

    td.classList.remove('editing', 'error');

    if (isFormula) {
      td.classList.add('is-formula');
      const evaled = this._evalCell(colId, row);
      if (evaled === null || evaled === undefined || (typeof evaled === 'number' && isNaN(evaled))) {
        display.textContent = '#ERR';
        td.classList.add('error');
      } else {
        display.textContent = this._formatValue(evaled);
      }
      if (input) input.value = rawVal;
    } else {
      td.classList.remove('is-formula');
      display.textContent = '';
      if (input) input.value = rawVal;
    }
  }

  _reEvalAll() {
    this._columns.forEach(col => {
      for (let r = 0; r < this._rowCount; r++) {
        this._refreshCell(col.id, r);
      }
    });
  }

  _reEvalDependents(changedColId) {
    // Re-eval all formula cells in all columns (they may depend on changedColId)
    this._columns.forEach(col => {
      for (let r = 0; r < this._rowCount; r++) {
        const raw = col.cells[r] || '';
        if (raw.startsWith('=')) {
          this._refreshCell(col.id, r);
        }
      }
    });
  }

  _getCellEl(colId, row) {
    return this._tbody.querySelector(`td[data-col-id="${colId}"][data-row="${row}"]`);
  }

  _formatValue(v) {
    if (typeof v === 'number') {
      if (!isFinite(v)) return '#INF';
      // Show up to 6 significant figures, no trailing zeros
      if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) {
        return v.toExponential(4);
      }
      // Round to avoid floating point noise
      const rounded = parseFloat(v.toPrecision(10));
      return String(rounded);
    }
    return String(v);
  }

  // ─── Formula Evaluation ───────────────────────────────────────────────────

  /**
   * Returns the evaluated numeric value (or string) for cell (colId, row).
   * Returns null on error.
   */
  _evalCell(colId, row) {
    const col = this._columns.find(c => c.id === colId);
    if (!col) return null;
    const raw = col.cells[row] || '';
    if (!raw.startsWith('=')) {
      const n = parseFloat(raw);
      return isNaN(n) ? (raw === '' ? '' : raw) : n;
    }
    try {
      return this._evalFormula(raw.slice(1), row);
    } catch (e) {
      return null;
    }
  }

  _evalFormula(expr, row) {
    // We transform the formula expression into a JavaScript expression
    // by replacing column references and special functions, then eval.

    let js = expr;

    // Replace aggregate functions: SUM([col]), AVG([col]), MIN([col]), MAX([col]), COUNT([col])
    const aggregateFns = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'];
    aggregateFns.forEach(fn => {
      const regex = new RegExp(`${fn}\\(\\[([^\\]]+)\\]\\)`, 'g');
      js = js.replace(regex, (_, colName) => {
        const vals = this._getColumnNumericValues(colName);
        switch (fn) {
          case 'SUM': return vals.reduce((a, b) => a + b, 0);
          case 'AVG': return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          case 'MIN': return vals.length ? Math.min(...vals) : 0;
          case 'MAX': return vals.length ? Math.max(...vals) : 0;
          case 'COUNT': return vals.length;
          default: return 0;
        }
      });
    });

    // Replace PREV([ColName]) → value at row-1
    js = js.replace(/PREV\(\[([^\]]+)\]\)/g, (_, colName) => {
      if (row === 0) return 'NaN';
      const col = this._findColumnByName(colName);
      if (!col) return 'NaN';
      const v = this._evalCell(col.id, row - 1);
      return (typeof v === 'number' && isFinite(v)) ? String(v) : 'NaN';
    });

    // Replace [ColName] → value at current row
    js = js.replace(/\[([^\]]+)\]/g, (_, colName) => {
      const col = this._findColumnByName(colName);
      if (!col) return 'NaN';
      const v = this._evalCell(col.id, row);
      return (typeof v === 'number' && isFinite(v)) ? String(v) : 'NaN';
    });

    // Replace PI (without parentheses) → Math.PI
    js = js.replace(/\bPI\b/g, 'Math.PI');

    // Replace math functions
    const mathFns = ['SQRT', 'ABS', 'LN', 'LOG', 'SIN', 'COS', 'TAN', 'EXP'];
    mathFns.forEach(fn => {
      const jsFn = fn === 'LN' ? 'Math.log' : `Math.${fn.toLowerCase()}`;
      const regex = new RegExp(`\\b${fn}\\(`, 'g');
      js = js.replace(regex, `${jsFn}(`);
    });

    // Replace ^ with ** (exponentiation)
    js = js.replace(/\^/g, '**');

    // Evaluate
    // Use Function to avoid direct eval scope issues
    const result = new Function(`"use strict"; return (${js});`)();
    return typeof result === 'number' ? result : null;
  }

  _findColumnByName(name) {
    return this._columns.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase()) || null;
  }

  _getColumnNumericValues(colName) {
    const col = this._findColumnByName(colName);
    if (!col) return [];
    const vals = [];
    for (let r = 0; r < this._rowCount; r++) {
      const v = this._evalCell(col.id, r);
      if (typeof v === 'number' && isFinite(v)) vals.push(v);
    }
    return vals;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  _emitChange() {
    document.dispatchEvent(new CustomEvent('sheet-data-changed', { detail: this.toData() }));
  }
}
