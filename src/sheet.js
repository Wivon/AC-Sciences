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
    this._activeFormulaInput = null; // input element currently editing a formula
    this._fillDrag = null;           // active fill-drag state

    // Fill handle element — moved to the selected td
    this._fillHandle = document.createElement('div');
    this._fillHandle.className = 'fill-handle';
    this._fillHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this._selectedColId !== null && this._selectedRow !== null) {
        this._startFillDrag(this._selectedColId, this._selectedRow);
      }
    });

    this._selectionRange = null; // { colIdxStart, rowStart, colIdxEnd, rowEnd }
    this._dragSelect = null;     // active drag-select state

    this._tableEl = document.getElementById('sheet-table');
    this._headerRow = document.getElementById('sheet-header-row');
    this._unitRow = document.getElementById('sheet-unit-row');
    this._tbody = document.getElementById('sheet-body');
    this._formulaInput = formulaBarEl;
    this._formulaCellRef = formulaCellRefEl;
    this._angleMode = 'rad'; // rad | deg
    this._angleModeSwitch = document.getElementById('angle-mode-switch');
    this._angleModeDegBtn = document.getElementById('angle-mode-deg-btn');
    this._angleModeRadBtn = document.getElementById('angle-mode-rad-btn');

    // Del / Backspace clears selected cells when not editing an input
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          this._clearSelectedCells();
          e.preventDefault();
        }
      }
    });

    this._formulaInput.addEventListener('focus', () => {
      this._trackFormulaMode(this._formulaInput);
    });
    this._formulaInput.addEventListener('input', () => {
      this._trackFormulaMode(this._formulaInput);
      this._onFormulaBarInput();
    });
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
    this._formulaInput.addEventListener('blur', () => {
      // Delay so mousedown on column headers fires first
      setTimeout(() => {
        if (this._activeFormulaInput === this._formulaInput) {
          this._activeFormulaInput = null;
        }
      }, 150);
      this._commitFormulaBar();
    });

    if (this._angleModeDegBtn) {
      this._angleModeDegBtn.addEventListener('click', () => this._setAngleMode('deg', { reEval: true, emitChange: true }));
    }
    if (this._angleModeRadBtn) {
      this._angleModeRadBtn.addEventListener('click', () => this._setAngleMode('rad', { reEval: true, emitChange: true }));
    }
    this._syncAngleModeUI();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  _syncAngleModeUI() {
    if (!this._angleModeSwitch) return;
    const isDeg = this._angleMode === 'deg';
    if (this._angleModeDegBtn) this._angleModeDegBtn.classList.toggle('selected', isDeg);
    if (this._angleModeRadBtn) this._angleModeRadBtn.classList.toggle('selected', !isDeg);
  }

  _setAngleMode(mode, { reEval = false, emitChange = false } = {}) {
    const next = mode === 'deg' ? 'deg' : 'rad';
    if (this._angleMode === next) return;
    this._angleMode = next;
    this._syncAngleModeUI();
    if (reEval) this._reEvalAll();
    if (emitChange) this._emitChange();
  }

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
    this._setAngleMode(sheetData && sheetData.angleMode === 'deg' ? 'deg' : 'rad');
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
      rowCount: this._rowCount,
      angleMode: this._angleMode
    };
  }

  getColumns() {
    return this._columns.map(c => ({ id: c.id, name: c.name, unit: c.unit }));
  }

  /** Returns evaluated numeric data for graphing */
  getColumnValues(colId) {
    const col = this._columns.find(c => c.id === colId);
    if (!col) return [];
    return col.cells.map((_, rowIdx) => {
      const v = this._evalCell(colId, rowIdx);
      return typeof v === 'number' && isFinite(v) ? v : null;
    });
  }

  /**
   * Replace values of one or more columns by name.
   * - Creates missing columns.
   * - Expands row count to fit provided data.
   * - Clears remaining cells in targeted columns.
   * @param {Object<string, Array<number|string|null|undefined>>} valuesByName
   * @param {Object<string, string>} unitsByName
   * @param {Object} options
   */
  setColumnsByName(valuesByName, unitsByName = {}, options = {}) {
    if (!valuesByName || typeof valuesByName !== 'object') return;

    const columnNames = Object.keys(valuesByName).filter(name => String(name).trim() !== '');
    if (columnNames.length === 0) return;
    const insertAfterName = (options && typeof options.insertAfterName === 'string')
      ? options.insertAfterName.trim()
      : '';
    const insertAfterKey = insertAfterName.toLowerCase();
    const reorderAfterAnchor = !!(options && options.reorderAfterAnchor);
    let insertionCursor = null;
    if (insertAfterKey) {
      const anchorIdx = this._columns.findIndex(c => c.name.trim().toLowerCase() === insertAfterKey);
      if (anchorIdx >= 0) insertionCursor = anchorIdx + 1;
    }

    let changed = false;
    let structureChanged = false;

    const maxLen = columnNames.reduce((m, name) => {
      const arr = Array.isArray(valuesByName[name]) ? valuesByName[name] : [];
      return Math.max(m, arr.length);
    }, 0);

    if (maxLen > this._rowCount) {
      const oldRowCount = this._rowCount;
      this._rowCount = maxLen;
      this._columns.forEach(col => {
        while (col.cells.length < this._rowCount) col.cells.push('');
      });
      structureChanged = this._rowCount !== oldRowCount;
    }

    columnNames.forEach(rawName => {
      const name = String(rawName).trim();
      if (!name) return;
      let col = this._findColumnByName(name);
      if (!col) {
        col = {
          id: 'col_' + Math.random().toString(36).slice(2, 9),
          name,
          unit: '',
          cells: Array(this._rowCount).fill('')
        };
        if (insertionCursor !== null) {
          this._columns.splice(insertionCursor, 0, col);
          insertionCursor += 1;
        } else {
          this._columns.push(col);
        }
        structureChanged = true;
      } else {
        while (col.cells.length < this._rowCount) col.cells.push('');
      }

      const nextUnit = Object.prototype.hasOwnProperty.call(unitsByName, name)
        ? String(unitsByName[name] || '')
        : col.unit;
      if (nextUnit !== col.unit) {
        col.unit = nextUnit;
        changed = true;
      }

      const arr = Array.isArray(valuesByName[rawName]) ? valuesByName[rawName] : [];
      for (let r = 0; r < this._rowCount; r++) {
        const v = arr[r];
        let cell = '';
        if (v !== null && v !== undefined && v !== '') {
          if (typeof v === 'number') {
            cell = isFinite(v) ? String(parseFloat(v.toPrecision(12))) : '';
          } else {
            cell = String(v);
          }
        }
        if (col.cells[r] !== cell) {
          col.cells[r] = cell;
          changed = true;
        }
      }
    });

    if (reorderAfterAnchor && insertAfterKey) {
      const anchorIdx = this._columns.findIndex(c => c.name.trim().toLowerCase() === insertAfterKey);
      if (anchorIdx >= 0) {
        const beforeOrder = this._columns.map(c => c.id).join('|');
        const moveIds = [];
        columnNames.forEach(rawName => {
          const name = String(rawName).trim();
          if (!name || name.toLowerCase() === insertAfterKey) return;
          const col = this._findColumnByName(name);
          if (!col || moveIds.includes(col.id)) return;
          moveIds.push(col.id);
        });

        if (moveIds.length > 0) {
          const moveSet = new Set(moveIds);
          const movingCols = moveIds
            .map(id => this._columns.find(c => c.id === id))
            .filter(Boolean);
          this._columns = this._columns.filter(c => !moveSet.has(c.id));
          const anchorIdxNow = this._columns.findIndex(c => c.name.trim().toLowerCase() === insertAfterKey);
          const insertIdx = anchorIdxNow >= 0 ? anchorIdxNow + 1 : this._columns.length;
          this._columns.splice(insertIdx, 0, ...movingCols);

          const afterOrder = this._columns.map(c => c.id).join('|');
          if (afterOrder !== beforeOrder) structureChanged = true;
        }
      }
    }

    if (!changed && !structureChanged) return;
    this._render();
    this._emitChange();
  }

  addColumn() {
    const id = 'col_' + Math.random().toString(36).slice(2, 9);
    const col = { id, name: 'Column', unit: '', cells: Array(this._rowCount).fill('') };
    this._columns.push(col);
    this._render();
    this._emitChange();
  }

  addColumnWithValues(name, values) {
    const id = 'col_' + Math.random().toString(36).slice(2, 9);
    const cells = Array.from({ length: this._rowCount }, (_, i) => {
      const v = values[i];
      return (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) ? '' : String(parseFloat(v.toPrecision(8)));
    });
    this._columns.push({ id, name, unit: '', cells });
    this._render();
    this._emitChange();
    return id;
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

  // ─── Formula Edit Mode ───────────────────────────────────────────────────────

  /** Track whether the given input is actively editing a formula (starts with =) */
  _trackFormulaMode(input) {
    if (input.value.startsWith('=')) {
      this._activeFormulaInput = input;
    } else if (this._activeFormulaInput === input) {
      this._activeFormulaInput = null;
    }
  }

  /**
   * Insert a column reference at the cursor position of the active formula input.
   * @param {string} colName  - column name
   * @param {number|null} row - 0-indexed row; if provided inserts ColName[N] (1-indexed),
   *                            otherwise inserts [ColName] (current-row relative).
   */
  _insertColumnRef(colName, row = null) {
    const input = this._activeFormulaInput;
    if (!input) return;
    const ref = row !== null ? `${colName}[${row + 1}]` : `[${colName}]`;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.slice(0, start) + ref + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + ref.length;
    input.dispatchEvent(new Event('input'));
    input.focus();
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
      th.title = `Click to insert [${col.name}] in formula`;

      // When in formula edit mode, clicking the header inserts [colName]
      th.addEventListener('mousedown', (e) => {
        if (this._activeFormulaInput) {
          e.preventDefault();
          this._insertColumnRef(col.name);
        }
      });

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
      this._columns.forEach((col, colIdx) => {
        const td = this._createCell(col.id, r, colIdx);
        tr.appendChild(td);
      });

      this._tbody.appendChild(tr);
    }
  }

  _createCell(colId, row, colIdx = 0) {
    const col = this._columns.find(c => c.id === colId);
    const rawVal = col ? col.cells[row] || '' : '';
    const isFormula = rawVal.startsWith('=');

    const td = document.createElement('td');
    td.className = 'data-cell' + (isFormula ? ' is-formula' : '');
    td.dataset.colId = colId;
    td.dataset.row = row;
    td.dataset.colIdx = colIdx;

    const display = document.createElement('span');
    display.className = 'cell-display';

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

    // Mousedown: start drag-select or insert column ref in formula mode
    td.addEventListener('mousedown', (e) => {
      if (this._activeFormulaInput && this._activeFormulaInput !== input
          && colId !== this._selectedColId) {
        e.preventDefault();
        this._insertColumnRef(col.name, row);
        return;
      }
      if (!this._activeFormulaInput) {
        e.preventDefault();
        this._startDragSelect(colIdx, row, e.shiftKey);
      }
    });

    td.addEventListener('dblclick', () => this._startEditing(colId, row, td, input));

    input.addEventListener('focus', () => {
      this._trackFormulaMode(input);
      this._selectCell(colId, row);
    });
    input.addEventListener('input', () => {
      this._trackFormulaMode(input);
    });
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
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (this._activeFormulaInput === input) this._activeFormulaInput = null;
      }, 150);
      this._commitCellInput(colId, row, td, input);
    });

    td.appendChild(display);
    td.appendChild(input);
    return td;
  }

  // ─── Cell Selection & Editing ─────────────────────────────────────────────

  _selectCell(colId, row) {
    this._clearSelectionHighlight();
    this._selectionRange = null;

    this._tbody.querySelectorAll('td.data-cell.selected').forEach(el => el.classList.remove('selected'));

    this._selectedColId = colId;
    this._selectedRow = row;

    const td = this._getCellEl(colId, row);
    if (td) {
      td.classList.add('selected');
      td.appendChild(this._fillHandle);
    }

    this._updateFormulaBar(colId, row);
  }

  _startDragSelect(anchorColIdx, anchorRow, shift = false) {
    if (shift && this._selectedColId !== null && this._selectedRow !== null) {
      // Extend existing selection
      const anchorCI = this._columns.findIndex(c => c.id === this._selectedColId);
      this._selectionRange = {
        colIdxStart: anchorCI, rowStart: this._selectedRow,
        colIdxEnd: anchorColIdx, rowEnd: anchorRow
      };
      this._applySelectionHighlight();
      return;
    }

    // Start fresh
    const col = this._columns[anchorColIdx];
    if (col) this._selectCell(col.id, anchorRow);

    this._dragSelect = { anchorColIdx, anchorRow };

    const onMove = (e) => {
      if (!this._dragSelect) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el && el.closest('td[data-col-idx][data-row]');
      if (!td) return;
      const ci = parseInt(td.dataset.colIdx, 10);
      const r  = parseInt(td.dataset.row, 10);
      const { anchorColIdx: aci, anchorRow: ar } = this._dragSelect;
      if (ci === aci && r === ar) {
        // Back to single cell
        this._clearSelectionHighlight();
        this._selectionRange = null;
        return;
      }
      this._selectionRange = { colIdxStart: aci, rowStart: ar, colIdxEnd: ci, rowEnd: r };
      this._applySelectionHighlight();
    };

    const onUp = () => {
      this._dragSelect = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _applySelectionHighlight() {
    this._clearSelectionHighlight();
    if (!this._selectionRange) return;
    const { colIdxStart, rowStart, colIdxEnd, rowEnd } = this._selectionRange;
    const colLo = Math.min(colIdxStart, colIdxEnd);
    const colHi = Math.max(colIdxStart, colIdxEnd);
    const rowLo = Math.min(rowStart, rowEnd);
    const rowHi = Math.max(rowStart, rowEnd);
    for (let ci = colLo; ci <= colHi; ci++) {
      const col = this._columns[ci];
      if (!col) continue;
      for (let r = rowLo; r <= rowHi; r++) {
        const td = this._getCellEl(col.id, r);
        if (td) td.classList.add('in-selection');
      }
    }
  }

  _clearSelectionHighlight() {
    this._tbody.querySelectorAll('td.in-selection').forEach(el => el.classList.remove('in-selection'));
  }

  _startEditing(colId, row, td, input) {
    const col = this._columns.find(c => c.id === colId);
    if (!col) return;
    const rawVal = col.cells[row] || '';

    if (td.classList.contains('is-formula')) {
      td.classList.add('editing');
      input.value = rawVal;
      input.style.display = ''; // let CSS handle it via .is-formula.editing
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
    this._formulaCellRef.textContent = col ? `${col.name}[${row + 1}]` : '?';

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
    if (input) input.style.display = ''; // clear any stale inline style

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
      if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) {
        return v.toExponential(4);
      }
      const rounded = parseFloat(v.toPrecision(10));
      return String(rounded);
    }
    return String(v);
  }

  // ─── Formula Evaluation ───────────────────────────────────────────────────

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
    let js = expr;

    // ColName[N] — specific row reference, 1-indexed (e.g. Time[3], t[1])
    // Run BEFORE _normalizeKeywords so original column-name case is preserved.
    js = js.replace(/([A-Za-z][A-Za-z0-9_']*)\[(\d+)\]/g, (_, colName, rowStr) => {
      const targetRow = parseInt(rowStr, 10) - 1; // 1-indexed → 0-indexed
      if (targetRow < 0 || targetRow >= this._rowCount) return 'NaN';
      const col = this._findColumnByName(colName);
      if (!col) return 'NaN';
      const v = this._evalCell(col.id, targetRow);
      return (typeof v === 'number' && isFinite(v)) ? String(v) : 'NaN';
    });

    js = this._normalizeKeywords(js);

    // Replace aggregate functions: SUM([col]), AVG([col]), MIN([col]), MAX([col]), COUNT([col])
    const aggregateFns = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'];
    aggregateFns.forEach(fn => {
      const regex = new RegExp(`${fn}\\s*\\(\\s*\\[([^\\]]+)\\]\\s*\\)`, 'g');
      js = js.replace(regex, (_, colName) => {
        const vals = this._getColumnNumericValues(colName);
        switch (fn) {
          case 'SUM':   return vals.reduce((a, b) => a + b, 0);
          case 'AVG':   return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          case 'MIN':   return vals.length ? Math.min(...vals) : 0;
          case 'MAX':   return vals.length ? Math.max(...vals) : 0;
          case 'COUNT': return vals.length;
          default:      return 0;
        }
      });
    });

    // Replace PREV([ColName]) → value at row-1
    js = js.replace(/PREV\s*\(\s*\[([^\]]+)\]\s*\)/g, (_, colName) => {
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

    // PI constant
    js = js.replace(/\bPI\b/g, 'Math.PI');

    // Math functions
    const mathFns = ['SQRT', 'ABS', 'LN', 'LOG', 'EXP'];
    mathFns.forEach(fn => {
      const jsFn = fn === 'LN' ? 'Math.log' : fn === 'LOG' ? 'Math.log10' : `Math.${fn.toLowerCase()}`;
      js = js.replace(new RegExp(`\\b${fn}\\s*\\(`, 'g'), `${jsFn}(`);
    });
    js = js.replace(/\bSIN\s*\(/g, '__SIN__(');
    js = js.replace(/\bCOS\s*\(/g, '__COS__(');
    js = js.replace(/\bTAN\s*\(/g, '__TAN__(');

    // Exponentiation
    js = js.replace(/\^/g, '**');

    const angleFactor = this._angleMode === 'deg' ? (Math.PI / 180) : 1;
    const sinFn = (v) => Math.sin(v * angleFactor);
    const cosFn = (v) => Math.cos(v * angleFactor);
    const tanFn = (v) => Math.tan(v * angleFactor);
    const result = new Function('__SIN__', '__COS__', '__TAN__', `"use strict"; return (${js});`)(sinFn, cosFn, tanFn);
    return typeof result === 'number' ? result : null;
  }

  /**
   * Normalize French aliases and English case variants to the canonical
   * uppercase English keywords used by _evalFormula.
   */
  _normalizeKeywords(expr) {
    const aliases = {
      // French → English
      'MOYENNE':    'AVG',
      'SOMME':      'SUM',
      'NB':         'COUNT',
      'NOMBRE':     'COUNT',
      'NBVAL':      'COUNT',
      'COMPTER':    'COUNT',
      'RACINE':     'SQRT',
      'RACINE_CARR': 'SQRT',
      'PREC':       'PREV',
      'PRECEDENT':  'PREV',
      'SINUS':      'SIN',
      'COSINUS':    'COS',
      'TANGENTE':   'TAN',
      'LN':         'LN',
      // English case variants
      'AVERAGE':    'AVG',
      'SUM':        'SUM',
      'MIN':        'MIN',
      'MAX':        'MAX',
      'COUNT':      'COUNT',
      'SQRT':       'SQRT',
      'ABS':        'ABS',
      'LOG':        'LOG',
      'SIN':        'SIN',
      'COS':        'COS',
      'TAN':        'TAN',
      'EXP':        'EXP',
      'PREV':       'PREV',
      'AVG':        'AVG',
    };

    // Process outside of [...] brackets — replace each alias (case-insensitive)
    // We split on bracket groups to avoid mangling column names
    return expr.replace(/(\[[^\]]*\])|([A-Za-z_][A-Za-z0-9_]*)/g, (_match, bracket, word) => {
      if (bracket) return bracket; // preserve [ColName] as-is
      const upper = word.toUpperCase();
      return aliases[upper] || upper; // normalize to uppercase; apply alias if any
    });
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

  // ─── Fill Handle ──────────────────────────────────────────────────────────

  _startFillDrag(colId, startRow) {
    this._fillDrag = { colId, startRow, endRow: startRow };

    const onMove = (e) => {
      if (!this._fillDrag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el && el.closest('td[data-row][data-col-id]');
      if (td && td.dataset.colId === this._fillDrag.colId) {
        const newEnd = parseInt(td.dataset.row, 10);
        if (newEnd !== this._fillDrag.endRow) {
          this._clearFillHighlight();
          this._fillDrag.endRow = newEnd;
          this._applyFillHighlight();
        }
      }
    };

    const onUp = () => {
      this._endFillDrag();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _applyFillHighlight() {
    if (!this._fillDrag) return;
    const { colId, startRow, endRow } = this._fillDrag;
    const lo = Math.min(startRow, endRow);
    const hi = Math.max(startRow, endRow);
    for (let r = lo; r <= hi; r++) {
      if (r === startRow) continue;
      const td = this._getCellEl(colId, r);
      if (td) td.classList.add('fill-preview');
    }
  }

  _clearFillHighlight() {
    this._tbody.querySelectorAll('td.fill-preview').forEach(td => td.classList.remove('fill-preview'));
  }

  _endFillDrag() {
    if (!this._fillDrag) return;
    const { colId, startRow, endRow } = this._fillDrag;

    if (startRow !== endRow) {
      const col = this._columns.find(c => c.id === colId);
      if (col) {
        const sourceVal = col.cells[startRow] || '';
        const lo = Math.min(startRow, endRow);
        const hi = Math.max(startRow, endRow);
        for (let r = lo; r <= hi; r++) {
          if (r === startRow) continue;
          col.cells[r] = this._adjustFormula(sourceVal, r - startRow);
          this._refreshCell(colId, r);
        }
        this._reEvalDependents(colId);
        this._emitChange();
      }
    }

    this._clearFillHighlight();
    this._fillDrag = null;
  }

  /** Clear content of selected cell(s) */
  _clearSelectedCells() {
    let changed = false;

    if (this._selectionRange) {
      const { colIdxStart, rowStart, colIdxEnd, rowEnd } = this._selectionRange;
      const colLo = Math.min(colIdxStart, colIdxEnd);
      const colHi = Math.max(colIdxStart, colIdxEnd);
      const rowLo = Math.min(rowStart, rowEnd);
      const rowHi = Math.max(rowStart, rowEnd);
      for (let ci = colLo; ci <= colHi; ci++) {
        const col = this._columns[ci];
        if (!col) continue;
        for (let r = rowLo; r <= rowHi; r++) {
          if (col.cells[r] !== '') { col.cells[r] = ''; changed = true; }
          this._refreshCell(col.id, r);
        }
        if (changed) this._reEvalDependents(col.id);
      }
    } else {
      if (this._selectedColId === null || this._selectedRow === null) return;
      const col = this._columns.find(c => c.id === this._selectedColId);
      if (!col || col.cells[this._selectedRow] === '') return;
      col.cells[this._selectedRow] = '';
      this._refreshCell(this._selectedColId, this._selectedRow);
      this._reEvalDependents(this._selectedColId);
      this._updateFormulaBar(this._selectedColId, this._selectedRow);
      changed = true;
    }

    if (changed) this._emitChange();
  }

  /**
   * Adjust a cell value by rowOffset.
   * - Formulas: increments ColName[N] row indices (=Time[1]*4 → =Time[2]*4 one row down).
   * - Plain numbers: increments by step * rowOffset, where step = the original value
   *   (so 1 → 2, 3, 4… and 0.1 → 0.2, 0.3, 0.4…).
   */
  _adjustFormula(formula, rowOffset) {
    if (rowOffset === 0) return formula;
    if (formula.startsWith('=')) {
      return '=' + formula.slice(1).replace(/([A-Za-z][A-Za-z0-9_']*)\[(\d+)\]/g, (_, colName, rowStr) => {
        const newRow = Math.max(1, parseInt(rowStr, 10) + rowOffset);
        return `${colName}[${newRow}]`;
      });
    }
    // Plain numeric value: increment by (value * rowOffset)
    const num = parseFloat(formula);
    if (!isNaN(num) && formula.trim() !== '') {
      const result = num + num * rowOffset;
      return String(parseFloat(result.toPrecision(10)));
    }
    return formula;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  _emitChange() {
    document.dispatchEvent(new CustomEvent('sheet-data-changed', { detail: this.toData() }));
  }
}
