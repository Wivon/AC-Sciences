/**
 * Graph — chart component for AC Sciences
 * Handles column selection, derivative overlay, regression fitting, and Chart.js rendering.
 */

class Graph {
  constructor(sheet) {
    this._sheet = sheet;
    this._chart = null;
    this._debounceTimer = null;
    this._regressionCoeffs = null;
    this._regressionType = 'none';
    this._pendingSelectYId = null;
    this._pendingRegressColId = null;
    this._yLineStyleByColId = {};
    this._yPointStyleByColId = {};
    this._yColorByColId = {};
    this._axisZoom = { x: null, y: null };
    this._axisDrag = null;
    this._cursorMode = 'normal'; // normal | pointer | tangent
    this._pointerState = null;   // { xPx, yPx, xValue, values: [{label,color,y}] }
    this._pointerSeries = [];
    this._pointerXAxisLabel = 'X';
    this._tangentManual = null;
    this._tangentDrag = null;
    this._cursorMenuEl = null;

    this._xSelect = document.getElementById('x-axis-select');
    this._originXInput = document.getElementById('origin-x-input');
    this._originYInput = document.getElementById('origin-y-input');
    this._yList   = document.getElementById('y-axis-list');
    this._yPanel  = document.getElementById('graph-y-panel');
    this._deriveColSelect  = document.getElementById('derive-col-select');
    this._deriveBtn        = document.getElementById('derive-btn');
    this._regressColSelect = document.getElementById('regress-col-select');
    this._regressionSelect = document.getElementById('regression-type-select');
    this._fitBtn = document.getElementById('fit-curve-btn');
    this._regressionResult = document.getElementById('regression-result');
    this._refreshBtn = document.getElementById('refresh-graph-btn');
    this._captureBtn = document.getElementById('capture-graph-btn');
    this._exportBtn = document.getElementById('export-graph-btn');
    this._canvas = document.getElementById('chart-canvas');
    this._placeholder = document.getElementById('chart-placeholder');
    this._buildCursorMenu();

    // Series colors (Google Calendar-like palette)
    this._colorOptions = [
      '#1a73e8',
      '#039be5',
      '#33b679',
      '#0b8043',
      '#f6bf26',
      '#f4511e',
      '#e67c73',
      '#d50000',
      '#8e24aa',
      '#7986cb',
      '#616161',
      '#3c4043'
    ];
    this._palette = this._colorOptions.slice(0, 8);

    this._fitBtn.addEventListener('click', () => this._fitCurve());
    this._deriveBtn.addEventListener('click', () => this._deriveColumn());
    this._refreshBtn.addEventListener('click', () => this._update());
    if (this._captureBtn) this._captureBtn.addEventListener('click', () => this._captureGraph());
    if (this._exportBtn) this._exportBtn.addEventListener('click', () => this._exportGraphCsv());
    this._xSelect.addEventListener('change', () => this._onAxesChanged({ xChanged: true }));
    this._originXInput.addEventListener('change', () => this._onOriginChanged());
    this._originYInput.addEventListener('change', () => this._onOriginChanged());
    this._originXInput.addEventListener('input', () => this._onOriginChanged());
    this._originYInput.addEventListener('input', () => this._onOriginChanged());
    this._regressionSelect.addEventListener('change', () => {
      this._regressionType = this._regressionSelect.value;
      this._regressionCoeffs = null;
      this._regressionResult.classList.remove('visible');
      this._renderChart();
    });
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element) || !target.closest('.y-pill-row')) {
        this._closeAllSeriesMenus();
      }
      if (!(target instanceof Element) || !target.closest('#chart-cursor-menu')) {
        this._hideCursorMenu();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._closeAllSeriesMenus();
        this._hideCursorMenu();
      }
    });
    if (this._yPanel) {
      this._yPanel.addEventListener('scroll', () => this._closeAllSeriesMenus());
    }
    this._canvas.addEventListener('mousedown', (e) => this._onCanvasMouseDown(e));
    this._canvas.addEventListener('mousemove', (e) => this._onCanvasMouseMove(e));
    this._canvas.addEventListener('mouseleave', () => this._onCanvasMouseLeave());
    this._canvas.addEventListener('contextmenu', (e) => this._onCanvasContextMenu(e));
    document.addEventListener('mousemove', (e) => this._onGlobalMouseMove(e));
    document.addEventListener('mouseup', (e) => this._onGlobalMouseUp(e));

    // Listen for sheet changes
    document.addEventListener('sheet-data-changed', () => {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._update(), 300);
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  _buildCursorMenu() {
    if (this._cursorMenuEl) return;
    const menu = document.createElement('div');
    menu.id = 'chart-cursor-menu';
    menu.className = 'chart-context-menu hidden';
    const options = [
      { mode: 'normal', label: 'Normal' },
      { mode: 'pointer', label: 'Pointeur' },
      { mode: 'tangent', label: 'Tangeante manuelle' }
    ];
    options.forEach(({ mode, label }) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'chart-context-item';
      item.dataset.mode = mode;
      item.textContent = label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this._setCursorMode(mode);
        this._hideCursorMenu();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    this._cursorMenuEl = menu;
    this._syncCursorMenuSelection();
  }

  _onCanvasContextMenu(e) {
    e.preventDefault();
    this._showCursorMenu(e.clientX, e.clientY);
  }

  _showCursorMenu(clientX, clientY) {
    if (!this._cursorMenuEl) return;
    this._syncCursorMenuSelection();
    this._cursorMenuEl.classList.remove('hidden');
    this._cursorMenuEl.style.left = '0px';
    this._cursorMenuEl.style.top = '0px';
    const rect = this._cursorMenuEl.getBoundingClientRect();
    const gap = 8;
    const maxX = window.innerWidth - rect.width - gap;
    const maxY = window.innerHeight - rect.height - gap;
    const x = Math.max(gap, Math.min(clientX, maxX));
    const y = Math.max(gap, Math.min(clientY, maxY));
    this._cursorMenuEl.style.left = `${x}px`;
    this._cursorMenuEl.style.top = `${y}px`;
  }

  _hideCursorMenu() {
    if (!this._cursorMenuEl) return;
    this._cursorMenuEl.classList.add('hidden');
  }

  _syncCursorMenuSelection() {
    if (!this._cursorMenuEl) return;
    this._cursorMenuEl.querySelectorAll('.chart-context-item').forEach((item) => {
      item.classList.toggle('selected', item.dataset.mode === this._cursorMode);
    });
  }

  _setCursorMode(mode) {
    const next = (mode === 'pointer' || mode === 'tangent') ? mode : 'normal';
    if (this._cursorMode === next) return;
    this._cursorMode = next;
    this._syncCursorMenuSelection();
    if (next !== 'pointer') {
      this._pointerState = null;
    }
    if (next !== 'tangent') {
      this._tangentDrag = null;
    }
    this._axisDrag = null;
    document.body.style.cursor = '';
    if (this._chart) this._chart.draw();
    if (next === 'pointer' || next === 'tangent') {
      this._canvas.style.cursor = 'crosshair';
    } else {
      this._canvas.style.cursor = 'default';
    }
    if (next === 'tangent') {
      this._ensureManualTangentState();
      if (this._chart) this._chart.draw();
    }
  }

  refreshColumns() {
    const cols = this._sheet.getColumns();
    const xVal = this._xSelect.value;
    const prevYIds = this._getSelectedYIds();
    const selectedYIds = new Set(prevYIds);
    const colIdSet = new Set(cols.map(c => c.id));
    Object.keys(this._yLineStyleByColId).forEach(colId => {
      if (!colIdSet.has(colId)) delete this._yLineStyleByColId[colId];
    });
    Object.keys(this._yPointStyleByColId).forEach(colId => {
      if (!colIdSet.has(colId)) delete this._yPointStyleByColId[colId];
    });
    Object.keys(this._yColorByColId).forEach(colId => {
      if (!colIdSet.has(colId)) delete this._yColorByColId[colId];
    });
    if (this._pendingSelectYId) selectedYIds.add(this._pendingSelectYId);

    const deriveVal   = this._deriveColSelect.value;
    const regressVal  = this._regressColSelect.value;

    // Rebuild X, derive, regress dropdowns
    this._xSelect.innerHTML         = '<option value="">— select —</option>';
    this._deriveColSelect.innerHTML  = '<option value="">— select —</option>';
    this._regressColSelect.innerHTML = '<option value="">— select —</option>';
    cols.forEach(col => {
      const label = col.unit ? `${col.name} (${col.unit})` : col.name;
      const opt = document.createElement('option');
      opt.value = col.id;
      opt.textContent = label;
      this._xSelect.appendChild(opt);
      this._deriveColSelect.appendChild(opt.cloneNode(true));
      this._regressColSelect.appendChild(opt.cloneNode(true));
    });
    if (xVal       && cols.find(c => c.id === xVal))      this._xSelect.value = xVal;
    if (deriveVal  && cols.find(c => c.id === deriveVal))  this._deriveColSelect.value = deriveVal;
    if (this._pendingRegressColId && cols.find(c => c.id === this._pendingRegressColId)) {
      this._regressColSelect.value = this._pendingRegressColId;
    } else if (regressVal && cols.find(c => c.id === regressVal)) {
      this._regressColSelect.value = regressVal;
    }

    const activeXId = this._xSelect.value;
    if (activeXId) selectedYIds.delete(activeXId);

    // Rebuild Y list with style context menus
    this._yList.innerHTML = '';
    cols.forEach((col, colIdx) => {
      if (col.id === activeXId) return;
      const label = col.unit ? `${col.name} (${col.unit})` : col.name;
      const lineStyle = this._getSeriesLineStyle(col.id);
      const pointStyle = this._getSeriesPointStyle(col.id);
      const color = this._getSeriesColor(col.id, colIdx);

      const row = document.createElement('div');
      row.className = 'y-pill-row' + (selectedYIds.has(col.id) ? ' selected' : '');
      row.dataset.colId = col.id;

      const mainBtn = document.createElement('button');
      mainBtn.type = 'button';
      mainBtn.className = 'y-pill-main';
      const colorDot = document.createElement('span');
      colorDot.className = 'y-pill-color-dot';
      colorDot.style.backgroundColor = color;
      const labelText = document.createElement('span');
      labelText.className = 'y-pill-label';
      labelText.textContent = label;
      mainBtn.appendChild(colorDot);
      mainBtn.appendChild(labelText);
      mainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        row.classList.toggle('selected');
        this._onAxesChanged();
      });

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'y-pill-menu-btn';
      menuBtn.textContent = '▾';
      menuBtn.title = 'Options de serie';
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !row.classList.contains('menu-open');
        this._closeAllSeriesMenus();
        if (willOpen) {
          row.classList.add('menu-open');
          this._positionSeriesMenu(row, menu);
        }
      });

      const menu = document.createElement('div');
      menu.className = 'y-style-menu';
      const addSectionDivider = () => {
        const divider = document.createElement('div');
        divider.className = 'y-style-divider';
        menu.appendChild(divider);
      };

      const lineLabel = document.createElement('div');
      lineLabel.className = 'y-style-section-label';
      lineLabel.textContent = 'Ligne';
      menu.appendChild(lineLabel);
      [
        { value: 'none', label: 'Pas de ligne' },
        { value: 'line', label: 'Ligne' },
        { value: 'dotted', label: 'Ligne pointillée' }
      ].forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'y-style-item' + (lineStyle === option.value ? ' selected' : '');
        item.dataset.group = 'line';
        item.dataset.value = option.value;
        item.textContent = option.label;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this._setSeriesLineStyle(col.id, option.value);
          menu.querySelectorAll('.y-style-item[data-group="line"]').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.value === option.value);
          });
          this._renderChart();
        });
        menu.appendChild(item);
      });

      addSectionDivider();

      const pointLabel = document.createElement('div');
      pointLabel.className = 'y-style-section-label';
      pointLabel.textContent = 'Points';
      menu.appendChild(pointLabel);
      [
        { value: 'none', label: 'Aucun' },
        { value: 'dots', label: 'Points' },
        { value: 'cross', label: 'Croix' }
      ].forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'y-style-item' + (pointStyle === option.value ? ' selected' : '');
        item.dataset.group = 'point';
        item.dataset.value = option.value;
        item.textContent = option.label;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this._setSeriesPointStyle(col.id, option.value);
          menu.querySelectorAll('.y-style-item[data-group="point"]').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.value === option.value);
          });
          this._renderChart();
        });
        menu.appendChild(item);
      });

      addSectionDivider();

      const colorLabel = document.createElement('div');
      colorLabel.className = 'y-style-section-label';
      colorLabel.textContent = 'Couleur';
      menu.appendChild(colorLabel);

      const colorGrid = document.createElement('div');
      colorGrid.className = 'y-color-grid';
      this._colorOptions.forEach(optionColor => {
        const colorBtn = document.createElement('button');
        colorBtn.type = 'button';
        colorBtn.className = 'y-color-option' + (optionColor === color ? ' selected' : '');
        colorBtn.dataset.color = optionColor;
        colorBtn.style.backgroundColor = optionColor;
        colorBtn.setAttribute('aria-label', `Couleur ${optionColor}`);
        colorBtn.title = optionColor;
        colorBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._setSeriesColor(col.id, optionColor);
          colorDot.style.backgroundColor = optionColor;
          colorGrid.querySelectorAll('.y-color-option').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.color === optionColor);
          });
          this._renderChart();
        });
        colorGrid.appendChild(colorBtn);
      });
      menu.appendChild(colorGrid);

      const uglyBtn = document.createElement('button');
      uglyBtn.type = 'button';
      uglyBtn.className = 'y-style-item y-style-random-color';
      uglyBtn.textContent = 'Couleur improbable';
      uglyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const randomColor = this._randomUglyColor();
        this._setSeriesColor(col.id, randomColor);
        colorDot.style.backgroundColor = randomColor;
        colorGrid.querySelectorAll('.y-color-option').forEach(btn => {
          btn.classList.remove('selected');
        });
        this._renderChart();
      });
      menu.appendChild(uglyBtn);

      row.appendChild(mainBtn);
      row.appendChild(menuBtn);
      row.appendChild(menu);
      this._yList.appendChild(row);
    });

    this._pendingSelectYId = null;
    this._pendingRegressColId = null;
  }

  /** Returns array of colIds for currently selected Y pills */
  _getSelectedYIds() {
    return Array.from(this._yList.querySelectorAll('.y-pill-row.selected'))
      .map(p => p.dataset.colId);
  }

  _getSeriesLineStyle(colId) {
    const style = this._yLineStyleByColId[colId];
    return (style === 'line' || style === 'dotted') ? style : 'none';
  }

  _setSeriesLineStyle(colId, style) {
    if (style === 'line' || style === 'dotted') {
      this._yLineStyleByColId[colId] = style;
    } else {
      delete this._yLineStyleByColId[colId];
    }
  }

  _getSeriesPointStyle(colId) {
    const style = this._yPointStyleByColId[colId];
    if (style === 'cross' || style === 'none') return style;
    return 'dots';
  }

  _setSeriesPointStyle(colId, style) {
    if (style === 'cross' || style === 'none') {
      this._yPointStyleByColId[colId] = style;
    } else {
      delete this._yPointStyleByColId[colId];
    }
  }

  _getSeriesColor(colId, fallbackIndex = 0) {
    const saved = this._yColorByColId[colId];
    if (this._isColorValue(saved)) return saved;
    return this._palette[fallbackIndex % this._palette.length];
  }

  _setSeriesColor(colId, color) {
    if (!this._isColorValue(color)) return;
    this._yColorByColId[colId] = color;
  }

  _isSelectableColor(color) {
    return typeof color === 'string' && this._colorOptions.includes(color);
  }

  _isColorValue(color) {
    if (typeof color !== 'string') return false;
    return color.trim() !== '';
  }

  _randomUglyColor() {
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const r = rand(200, 240);
    const g = rand(200, 240);
    const b = rand(200, 240);
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  _closeAllSeriesMenus() {
    this._yList.querySelectorAll('.y-pill-row.menu-open').forEach(row => {
      row.classList.remove('menu-open');
      const menu = row.querySelector('.y-style-menu');
      if (menu) {
        menu.style.maxHeight = '';
        menu.style.left = '';
        menu.style.top = '';
      }
    });
  }

  _positionSeriesMenu(row, menu) {
    if (!row || !menu) return;
    menu.style.maxHeight = '';
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const rowRect = row.getBoundingClientRect();
    const gap = 8;

    // Ensure we can measure the rendered size before final placement.
    menu.style.left = '-9999px';
    menu.style.top = '-9999px';
    const measuredRect = menu.getBoundingClientRect();
    const menuW = measuredRect.width || 220;
    const menuH = measuredRect.height || 240;

    // Prefer opening on the left of the Y panel (towards the chart area).
    let x = rowRect.left - menuW - gap;
    if (x < gap) x = rowRect.right + gap;
    if (x + menuW > viewportW - gap) x = Math.max(gap, viewportW - menuW - gap);

    let y = rowRect.top;
    if (y + menuH > viewportH - gap) y = viewportH - menuH - gap;
    y = Math.max(gap, y);

    const maxH = Math.max(80, viewportH - y - gap);
    menu.style.maxHeight = `${Math.min(420, maxH)}px`;
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;
  }

  loadFromData(graphData = {}) {
    this._axisZoom = { x: null, y: null };
    this._axisDrag = null;
    this._pointerState = null;
    this._tangentDrag = null;
    this._tangentManual = null;
    document.body.style.cursor = '';
    const savedCursorMode = graphData && (graphData.cursorMode === 'pointer' || graphData.cursorMode === 'tangent')
      ? graphData.cursorMode
      : 'normal';
    this._setCursorMode(savedCursorMode);
    if (graphData.originX !== undefined && graphData.originX !== null) {
      this._originXInput.value = String(graphData.originX);
    }
    if (graphData.originY !== undefined && graphData.originY !== null) {
      this._originYInput.value = String(graphData.originY);
    }
    if (graphData.xColumn) this._xSelect.value = graphData.xColumn;
    this._yLineStyleByColId = {};
    this._yPointStyleByColId = {};
    if (graphData.yLineStyles && typeof graphData.yLineStyles === 'object') {
      Object.entries(graphData.yLineStyles).forEach(([colId, style]) => {
        if (style === 'line' || style === 'dotted') this._yLineStyleByColId[colId] = style;
      });
    }
    if (graphData.yPointStyles && typeof graphData.yPointStyles === 'object') {
      Object.entries(graphData.yPointStyles).forEach(([colId, style]) => {
        if (style === 'cross' || style === 'none') this._yPointStyleByColId[colId] = style;
      });
    }
    if (graphData.yStyles && typeof graphData.yStyles === 'object') {
      Object.entries(graphData.yStyles).forEach(([colId, style]) => {
        if (style === 'line' || style === 'line_points') {
          this._yLineStyleByColId[colId] = 'line';
          return;
        }
        if (style && typeof style === 'object') {
          if (style.line === 'line' || style.line === 'dotted') this._yLineStyleByColId[colId] = style.line;
          if (style.point === 'cross' || style.point === 'none') this._yPointStyleByColId[colId] = style.point;
        }
      });
    }
    this._yColorByColId = {};
    if (graphData.yColors && typeof graphData.yColors === 'object') {
      Object.entries(graphData.yColors).forEach(([colId, color]) => {
        if (this._isColorValue(color)) this._yColorByColId[colId] = color;
      });
    }
    this.refreshColumns();
    const savedYIds = graphData.yColumns
      ? graphData.yColumns
      : (graphData.yColumn ? [graphData.yColumn] : []);
    this._yList.querySelectorAll('.y-pill-row').forEach(pill => {
      pill.classList.toggle('selected', savedYIds.includes(pill.dataset.colId));
    });
    if (graphData.regressionType) {
      this._regressionType = graphData.regressionType;
      this._regressionSelect.value = graphData.regressionType;
    }
    this._regressionCoeffs = null;
    this._renderChart();
  }

  toData() {
    const yStyles = {};
    Object.keys({ ...this._yLineStyleByColId, ...this._yPointStyleByColId }).forEach(colId => {
      const line = this._getSeriesLineStyle(colId);
      const point = this._getSeriesPointStyle(colId);
      if (line === 'none' && point === 'dots') return;
      if (line === 'line' && point === 'dots') {
        yStyles[colId] = 'line_points';
      } else {
        yStyles[colId] = { line, point };
      }
    });
    const yLineStyles = {};
    Object.entries(this._yLineStyleByColId).forEach(([colId, style]) => {
      if (style === 'line' || style === 'dotted') yLineStyles[colId] = style;
    });
    const yPointStyles = {};
    Object.entries(this._yPointStyleByColId).forEach(([colId, style]) => {
      if (style === 'cross' || style === 'none') yPointStyles[colId] = style;
    });
    const yColors = {};
    Object.entries(this._yColorByColId).forEach(([colId, color]) => {
      if (this._isColorValue(color)) yColors[colId] = color;
    });
    return {
      xColumn: this._xSelect.value || '',
      originX: this._getAxisOriginValue('x', 0),
      originY: this._getAxisOriginValue('y', 0),
      cursorMode: this._cursorMode,
      yColumns: this._getSelectedYIds(),
      regressionType: this._regressionType,
      yLineStyles,
      yPointStyles,
      yStyles,
      yColors
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _onOriginChanged() {
    this._axisDrag = null;
    document.body.style.cursor = '';
    const originX = this._getAxisOriginValue('x');
    const originY = this._getAxisOriginValue('y');
    const chartX = this._chart && this._chart.scales ? this._chart.scales.x : null;
    const chartY = this._chart && this._chart.scales ? this._chart.scales.y : null;
    const rangeX = this._axisZoom.x && this._isValidRange(this._axisZoom.x.min, this._axisZoom.x.max)
      ? this._axisZoom.x.max - this._axisZoom.x.min
      : (chartX && this._isValidRange(chartX.min, chartX.max) ? chartX.max - chartX.min : 1);
    const rangeY = this._axisZoom.y && this._isValidRange(this._axisZoom.y.min, this._axisZoom.y.max)
      ? this._axisZoom.y.max - this._axisZoom.y.min
      : (chartY && this._isValidRange(chartY.min, chartY.max) ? chartY.max - chartY.min : 1);

    this._axisZoom.x = { min: originX, max: originX + Math.max(rangeX, 1e-9) };
    this._axisZoom.y = { min: originY, max: originY + Math.max(rangeY, 1e-9) };

    this._renderChart();
  }

  _onAxesChanged({ xChanged = false } = {}) {
    this._axisZoom = { x: null, y: null };
    this._closeAllSeriesMenus();
    this._pointerState = null;
    this._tangentDrag = null;
    document.body.style.cursor = '';
    this._regressionCoeffs = null;
    this._regressionResult.classList.remove('visible');
    if (xChanged) this.refreshColumns();
    this._renderChart();
  }

  _update() {
    this.refreshColumns();
    this._renderChart();
  }

  /**
   * Returns array of { colId, label, lineStyle, pointStyle, color, points } for selected Y columns.
   * points = [{ x, y }] filtered to rows where both X and Y are valid numbers.
   */
  _getXYData() {
    const xId = this._xSelect.value;
    const yIds = this._getSelectedYIds();
    if (!xId || yIds.length === 0) return null;

    const xVals = this._sheet.getColumnValues(xId);
    const cols = this._sheet.getColumns();

    return yIds.map(yId => {
      const yVals = this._sheet.getColumnValues(yId);
      const col = cols.find(c => c.id === yId);
      const label = col ? (col.unit ? `${col.name} (${col.unit})` : col.name) : yId;
      const points = [];
      const len = Math.min(xVals.length, yVals.length);
      for (let i = 0; i < len; i++) {
        if (xVals[i] !== null && yVals[i] !== null) {
          points.push({ x: xVals[i], y: yVals[i] });
        }
      }
      const fallbackIndex = Math.max(0, cols.findIndex(c => c.id === yId));
      return {
        colId: yId,
        label,
        lineStyle: this._getSeriesLineStyle(yId),
        pointStyle: this._getSeriesPointStyle(yId),
        color: this._getSeriesColor(yId, fallbackIndex),
        points
      };
    }).filter(s => s.points.length > 0);
  }

  /** Returns {points, label} for the column chosen in the regression selector (falls back to first Y). */
  _getRegressData() {
    const xId = this._xSelect.value;
    const yId = this._regressColSelect.value;
    if (!xId || !yId) {
      // fall back to first selected Y pill
      const series = this._getXYData();
      return series && series.length > 0 ? series[0].points : null;
    }
    const xVals = this._sheet.getColumnValues(xId);
    const yVals = this._sheet.getColumnValues(yId);
    const points = [];
    const len = Math.min(xVals.length, yVals.length);
    for (let i = 0; i < len; i++) {
      if (xVals[i] !== null && yVals[i] !== null) points.push({ x: xVals[i], y: yVals[i] });
    }
    return points.length > 0 ? points : null;
  }

  _getAxisLabels() {
    const cols = this._sheet.getColumns();
    const xId = this._xSelect.value;
    const xCol = cols.find(c => c.id === xId);
    const xLabel = xCol ? (xCol.unit ? `${xCol.name} (${xCol.unit})` : xCol.name) : 'X';
    return { xLabel };
  }

  _renderChart() {
    const allSeries = this._getXYData();

    if (!allSeries || allSeries.length === 0) {
      this._placeholder.classList.remove('hidden');
      this._pointerSeries = [];
      this._pointerState = null;
      this._pointerXAxisLabel = this._getAxisLabels().xLabel || 'X';
      if (this._chart) { this._chart.destroy(); this._chart = null; }
      return;
    }

    this._placeholder.classList.add('hidden');
    this._pointerState = null;

    const { xLabel } = this._getAxisLabels();
    this._pointerXAxisLabel = xLabel || 'X';
    const datasets = [];
    this._pointerSeries = allSeries.map(({ label, color, points }) => ({
      label,
      color,
      points: [...points].sort((a, b) => a.x - b.x)
    }));

    // 1. Dataset per Y column (line + point styles configurable)
    allSeries.forEach(({ label, points, lineStyle, pointStyle, color }, idx) => {
      const sorted = this._pointerSeries[idx] ? this._pointerSeries[idx].points : [...points].sort((a, b) => a.x - b.x);
      const isLine = lineStyle === 'line' || lineStyle === 'dotted';
      const showPoints = pointStyle !== 'none';
      datasets.push({
        label,
        data: sorted,
        type: 'scatter',
        backgroundColor: color,
        borderColor: color,
        borderWidth: isLine ? 2 : 1.5,
        borderDash: lineStyle === 'dotted' ? [7, 5] : [],
        pointRadius: showPoints ? 5 : 0,
        pointHoverRadius: showPoints ? 7 : 0,
        pointHitRadius: showPoints ? 6 : 0,
        pointStyle: pointStyle === 'cross' ? 'cross' : 'circle',
        pointBorderWidth: pointStyle === 'cross' ? 2.2 : 1.2,
        showLine: isLine,
        tension: 0.15,
        order: 3
      });
    });

    // 2. Regression curve on the chosen column (or first Y as fallback)
    const regressPts = this._getRegressData();
    const regressSorted = regressPts ? regressPts.slice().sort((a, b) => a.x - b.x) : [];

    if (this._regressionCoeffs && regressSorted.length >= 2) {
      const xMin = regressSorted[0].x;
      const xMax = regressSorted[regressSorted.length - 1].x;
      const step = (xMax - xMin) / 99;
      const curvePts = [];
      for (let i = 0; i < 100; i++) {
        const xi = xMin + i * step;
        const yi = this._evalRegression(xi);
        if (yi !== null && isFinite(yi)) curvePts.push({ x: xi, y: yi });
      }
      datasets.push({
        label: 'Régression',
        data: curvePts,
        type: 'line',
        borderColor: 'rgba(245,158,11,0.95)',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.3,
        order: 1
      });
    }

    const yAxisTitle = allSeries.length === 1 ? allSeries[0].label : 'Y';
    const scales = {
      x: {
        type: 'linear',
        title: { display: true, text: xLabel, font: { size: 12 } },
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: {
          maxTicksLimit: 12
        }
      },
      y: {
        title: { display: true, text: yAxisTitle, font: { size: 12 } },
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: {
          maxTicksLimit: 12
        },
        afterFit: (scale) => {
          // Keep Y-axis label gutter stable so zooming doesn't shift chart origin.
          scale.width = 66;
        }
      }
    };
    this._applyAxisZoomToScales(scales);

    if (this._chart) {
      this._chart.data.datasets = datasets;
      this._chart.options.scales = scales;
      if (this._chart.options.plugins && this._chart.options.plugins.legend) {
        this._chart.options.plugins.legend.display = false;
      }
      this._chart.update();
    } else {
      this._chart = new Chart(this._canvas, {
        type: 'scatter',
        data: { datasets },
        plugins: [{
          id: 'cursor-pointer-overlay',
          afterDatasetsDraw: (chart) => this._drawCursorOverlays(chart)
        }],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ` (${this._fmt(ctx.parsed.x)}, ${this._fmt(ctx.parsed.y)})`
              }
            }
          },
          scales
        }
      });
    }
    if (this._cursorMode === 'tangent') {
      this._ensureManualTangentState();
    }
  }

  _fmt(v) {
    if (typeof v !== 'number') return String(v);
    const abs = Math.abs(v);
    if (abs >= 1e5 || (abs < 1e-3 && v !== 0)) return v.toExponential(3);
    return parseFloat(v.toPrecision(6)).toString();
  }

  _updatePointerStateFromMouseEvent(e) {
    if (this._cursorMode !== 'pointer' || !this._chart || !this._chart.chartArea || !this._chart.scales || !this._chart.scales.x) {
      this._pointerState = null;
      return;
    }
    const rect = this._canvas.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    const area = this._chart.chartArea;
    const inPlot = xPx >= area.left && xPx <= area.right && yPx >= area.top && yPx <= area.bottom;
    if (!inPlot) {
      this._pointerState = null;
      return;
    }

    const xValue = this._chart.scales.x.getValueForPixel(xPx);
    const values = this._pointerSeries.map(series => ({
      label: series.label,
      color: series.color,
      y: this._interpolateYAtX(series.points, xValue)
    }));
    this._pointerState = { xPx, yPx, xValue, values };
  }

  _interpolateYAtX(points, x) {
    if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(x)) return null;
    if (points.length === 1) return Number.isFinite(points[0].y) ? points[0].y : null;
    if (x < points[0].x || x > points[points.length - 1].x) return null;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (!p0 || !p1) continue;
      if (!Number.isFinite(p0.x) || !Number.isFinite(p1.x) || !Number.isFinite(p0.y) || !Number.isFinite(p1.y)) continue;
      if (x < p0.x || x > p1.x) continue;
      if (x === p0.x) return p0.y;
      if (x === p1.x) return p1.y;
      const dx = p1.x - p0.x;
      if (!Number.isFinite(dx) || Math.abs(dx) < 1e-12) return p0.y;
      const t = (x - p0.x) / dx;
      return p0.y + t * (p1.y - p0.y);
    }
    return null;
  }

  _drawCursorOverlays(chart) {
    this._drawManualTangentOverlay(chart);
    this._drawPointerOverlay(chart);
  }

  _drawPointerOverlay(chart) {
    if (this._cursorMode !== 'pointer' || !this._pointerState || !chart || !chart.chartArea) return;
    const area = chart.chartArea;
    const ctx = chart.ctx;
    const x = Math.max(area.left, Math.min(area.right, this._pointerState.xPx));
    const y = Math.max(area.top, Math.min(area.bottom, this._pointerState.yPx));

    ctx.save();
    ctx.strokeStyle = 'rgba(37,99,235,0.65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const rows = [
      { text: `${this._pointerXAxisLabel}: ${this._fmt(this._pointerState.xValue)}`, color: '#f8fafc' },
      ...this._pointerState.values.map(v => ({
        text: `${v.label}: ${v.y === null ? '—' : this._fmt(v.y)}`,
        color: v.color || '#cbd5e1'
      }))
    ];
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    const paddingX = 8;
    const paddingY = 7;
    const lineH = 16;
    const dot = 7;
    const maxTextW = rows.reduce((max, r) => Math.max(max, ctx.measureText(r.text).width), 0);
    const boxW = Math.ceil(maxTextW + paddingX * 2 + dot + 6);
    const boxH = Math.ceil(paddingY * 2 + rows.length * lineH);

    let boxX = x + 12;
    if (boxX + boxW > area.right - 2) boxX = x - boxW - 12;
    boxX = Math.max(area.left + 2, boxX);
    let boxY = y + 12;
    if (boxY + boxH > area.bottom - 2) boxY = y - boxH - 12;
    boxY = Math.max(area.top + 2, boxY);

    ctx.fillStyle = 'rgba(15,23,42,0.88)';
    ctx.strokeStyle = 'rgba(148,163,184,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    rows.forEach((row, idx) => {
      const yy = boxY + paddingY + idx * lineH + 11;
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(boxX + paddingX + dot / 2, yy - 3, dot / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(row.text, boxX + paddingX + dot + 6, yy);
    });
    ctx.restore();
  }

  _drawManualTangentOverlay(chart) {
    if (this._cursorMode !== 'tangent') return;
    if (!chart || !chart.chartArea || !chart.scales || !chart.scales.x || !chart.scales.y) return;
    this._ensureManualTangentState();
    if (!this._tangentManual) return;

    const state = this._tangentManual;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const area = chart.chartArea;
    const ctx = chart.ctx;

    const normal = this._getManualTangentNormal(state.p1, state.p2);
    if (!normal) return;
    const d = state.d || 0;
    const offsets = [0, d / 2, d];
    const xMin = xScale.min;
    const xMax = xScale.max;
    const yMin = yScale.min;
    const yMax = yScale.max;

    const drawLine = (p1, p2, color, width, dash) => {
      let a;
      let b;
      if (Math.abs(p2.x - p1.x) < 1e-12) {
        a = { x: p1.x, y: yMin };
        b = { x: p1.x, y: yMax };
      } else {
        const m = (p2.y - p1.y) / (p2.x - p1.x);
        const yAtMin = p1.y + m * (xMin - p1.x);
        const yAtMax = p1.y + m * (xMax - p1.x);
        a = { x: xMin, y: yAtMin };
        b = { x: xMax, y: yAtMax };
      }
      const ax = xScale.getPixelForValue(a.x);
      const ay = yScale.getPixelForValue(a.y);
      const bx = xScale.getPixelForValue(b.x);
      const by = yScale.getPixelForValue(b.y);
      if (![ax, ay, bx, by].every(Number.isFinite)) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
    ctx.clip();

    offsets.forEach((offset, idx) => {
      const shiftedP1 = { x: state.p1.x + normal.nx * offset, y: state.p1.y + normal.ny * offset };
      const shiftedP2 = { x: state.p2.x + normal.nx * offset, y: state.p2.y + normal.ny * offset };
      const color = idx === 1 ? 'rgba(239,68,68,0.65)' : 'rgba(239,68,68,0.95)';
      const width = idx === 1 ? 1.8 : 2.4;
      const dash = idx === 1 ? [6, 4] : [];
      drawLine(shiftedP1, shiftedP2, color, width, dash);
    });

    const handles = this._getManualTangentHandlePixels(chart);
    if (handles) {
      ctx.fillStyle = 'rgba(239,68,68,0.95)';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.4;
      ['p1', 'p2', 'offset'].forEach((key) => {
        const h = handles[key];
        if (!h) return;
        ctx.beginPath();
        ctx.arc(h.x, h.y, key === 'offset' ? 5.5 : 6.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    ctx.restore();
  }

  _getChartValuePointFromMouseEvent(e, { clampToPlot = false } = {}) {
    if (!this._chart || !this._chart.chartArea || !this._chart.scales || !this._chart.scales.x || !this._chart.scales.y) {
      return null;
    }
    const rect = this._canvas.getBoundingClientRect();
    const area = this._chart.chartArea;
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const inPlot = rawX >= area.left && rawX <= area.right && rawY >= area.top && rawY <= area.bottom;
    if (!inPlot && !clampToPlot) return null;

    const xPx = clampToPlot ? Math.max(area.left, Math.min(area.right, rawX)) : rawX;
    const yPx = clampToPlot ? Math.max(area.top, Math.min(area.bottom, rawY)) : rawY;
    const x = this._chart.scales.x.getValueForPixel(xPx);
    const y = this._chart.scales.y.getValueForPixel(yPx);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return { x, y, xPx, yPx, inPlot };
  }

  _ensureManualTangentState() {
    if (this._tangentManual || !this._chart || !this._chart.scales || !this._chart.scales.x || !this._chart.scales.y) return;
    const xScale = this._chart.scales.x;
    const yScale = this._chart.scales.y;
    const xMin = xScale.min;
    const xMax = xScale.max;
    const yMin = yScale.min;
    const yMax = yScale.max;
    if (!this._isValidRange(xMin, xMax) || !this._isValidRange(yMin, yMax)) return;
    const dx = xMax - xMin;
    const dy = yMax - yMin;
    this._tangentManual = {
      p1: { x: xMin + dx * 0.2, y: yMin + dy * 0.25 },
      p2: { x: xMin + dx * 0.8, y: yMin + dy * 0.55 },
      d: dy * 0.12
    };
  }

  _getManualTangentNormal(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (!isFinite(len) || len < 1e-9) return null;
    return { nx: -dy / len, ny: dx / len };
  }

  _getManualTangentHandlePixels(chart) {
    if (!chart || !this._tangentManual) return null;
    const state = this._tangentManual;
    const normal = this._getManualTangentNormal(state.p1, state.p2);
    if (!normal) return null;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const mid = { x: (state.p1.x + state.p2.x) / 2, y: (state.p1.y + state.p2.y) / 2 };
    const offsetPoint = { x: mid.x + normal.nx * (state.d || 0), y: mid.y + normal.ny * (state.d || 0) };
    const p1 = { x: xScale.getPixelForValue(state.p1.x), y: yScale.getPixelForValue(state.p1.y) };
    const p2 = { x: xScale.getPixelForValue(state.p2.x), y: yScale.getPixelForValue(state.p2.y) };
    const off = { x: xScale.getPixelForValue(offsetPoint.x), y: yScale.getPixelForValue(offsetPoint.y) };
    if (![p1.x, p1.y, p2.x, p2.y, off.x, off.y].every(Number.isFinite)) return null;
    return { p1, p2, offset: off };
  }

  _hitTestManualTangentHandle(e) {
    if (!this._chart || !this._tangentManual) return null;
    const point = this._getChartValuePointFromMouseEvent(e);
    if (!point) return null;
    const handles = this._getManualTangentHandlePixels(this._chart);
    if (!handles) return null;
    const radius = 10;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const cursor = { x: point.xPx, y: point.yPx };
    if (dist(cursor, handles.p1) <= radius) return 'p1';
    if (dist(cursor, handles.p2) <= radius) return 'p2';
    if (dist(cursor, handles.offset) <= radius) return 'offset';
    return null;
  }

  _applyManualTangentDrag(point, handle) {
    if (!this._tangentManual || !point) return;
    const state = this._tangentManual;
    if (handle === 'p1') {
      state.p1 = { x: point.x, y: point.y };
      return;
    }
    if (handle === 'p2') {
      state.p2 = { x: point.x, y: point.y };
      return;
    }
    if (handle === 'offset') {
      const normal = this._getManualTangentNormal(state.p1, state.p2);
      if (!normal) return;
      const dx = point.x - state.p1.x;
      const dy = point.y - state.p1.y;
      state.d = dx * normal.nx + dy * normal.ny;
    }
  }

  _getAxisOriginValue(mode, fallbackValue = 0) {
    const input = mode === 'x' ? this._originXInput : this._originYInput;
    const raw = input ? String(input.value).trim().replace(',', '.') : '';
    const parsed = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(parsed)) return parsed;
    return fallbackValue;
  }

  _onCanvasMouseDown(e) {
    if (e.button !== 0) return;

    if (this._cursorMode === 'tangent') {
      this._ensureManualTangentState();
      const handle = this._hitTestManualTangentHandle(e);
      if (handle) {
        e.preventDefault();
        this._axisDrag = null;
        this._pointerState = null;
        this._tangentDrag = { handle };
        this._canvas.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
        if (this._chart) this._chart.draw();
        return;
      }
    }

    const mode = this._getAxisDragMode(e);
    if (!mode || !this._chart) return;
    const scale = this._chart.scales[mode];
    if (!scale || !this._isValidRange(scale.min, scale.max)) return;
    const origin = this._getAxisOriginValue(mode, scale.min);
    if (!Number.isFinite(origin)) return;

    e.preventDefault();
    this._axisDrag = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin,
      startMin: scale.min,
      startMax: scale.max
    };
    this._pointerState = null;
    const cursor = mode === 'x' ? 'ew-resize' : 'ns-resize';
    this._canvas.style.cursor = cursor;
    document.body.style.cursor = cursor;
  }

  _onCanvasMouseMove(e) {
    if (this._axisDrag) return;
    if (this._cursorMode === 'pointer') {
      this._canvas.style.cursor = 'crosshair';
      this._updatePointerStateFromMouseEvent(e);
      if (this._chart) this._chart.draw();
      return;
    }
    this._pointerState = null;
    if (this._cursorMode === 'tangent') {
      if (this._tangentDrag) {
        this._canvas.style.cursor = 'grabbing';
      } else {
        const handle = this._hitTestManualTangentHandle(e);
        if (handle) {
          this._canvas.style.cursor = 'grab';
        } else {
          const point = this._getChartValuePointFromMouseEvent(e);
          if (point && point.inPlot) {
            this._canvas.style.cursor = 'crosshair';
          } else {
            this._updateAxisCursor(e);
          }
        }
      }
      return;
    }
    this._updateAxisCursor(e);
  }

  _onCanvasMouseLeave() {
    if (this._axisDrag || this._tangentDrag) return;
    this._pointerState = null;
    if (this._chart) this._chart.draw();
    if (this._cursorMode === 'pointer' || this._cursorMode === 'tangent') {
      this._canvas.style.cursor = 'default';
      return;
    }
    this._canvas.style.cursor = 'default';
  }

  _onGlobalMouseMove(e) {
    if (this._tangentDrag) {
      e.preventDefault();
      const point = this._getChartValuePointFromMouseEvent(e, { clampToPlot: true });
      if (!point) return;
      this._applyManualTangentDrag(point, this._tangentDrag.handle);
      if (this._chart) this._chart.draw();
      return;
    }

    if (!this._axisDrag) return;
    e.preventDefault();

    const drag = this._axisDrag;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    const startRange = drag.startMax - drag.origin;
    if (!Number.isFinite(startRange) || startRange <= 0) return;

    // Drag direction controls zoom factor: right/up zooms in, left/down zooms out.
    const dragPx = drag.mode === 'x' ? dx : dy;
    const zoomFactor = drag.mode === 'x'
      ? Math.exp(-dragPx / 180)
      : Math.exp(dragPx / 180);
    const minRange = Math.max(startRange / 500, 1e-12);
    const maxRange = startRange * 200;
    const minFactor = minRange / startRange;
    const maxFactor = maxRange / startRange;
    const clampedFactor = Math.min(maxFactor, Math.max(minFactor, zoomFactor));
    const nextMin = drag.origin;
    const nextMax = drag.origin + startRange * clampedFactor;
    if (!this._isValidRange(nextMin, nextMax)) return;

    if (drag.mode === 'x') {
      this._axisZoom.x = { min: nextMin, max: nextMax };
    } else {
      this._axisZoom.y = { min: nextMin, max: nextMax };
    }
    this._applyAxisZoomToChart();
  }

  _onGlobalMouseUp(e) {
    if (this._tangentDrag) {
      const point = this._getChartValuePointFromMouseEvent(e, { clampToPlot: true });
      if (point) this._applyManualTangentDrag(point, this._tangentDrag.handle);
      this._tangentDrag = null;
      document.body.style.cursor = '';
      if (this._cursorMode === 'pointer') {
        this._canvas.style.cursor = 'crosshair';
      } else if (this._cursorMode === 'tangent') {
        const handle = this._hitTestManualTangentHandle(e);
        this._canvas.style.cursor = handle ? 'grab' : 'crosshair';
      } else {
        this._updateAxisCursor(e);
      }
      if (this._chart) this._chart.draw();
      return;
    }

    if (!this._axisDrag) return;
    this._axisDrag = null;
    document.body.style.cursor = '';
    if (this._cursorMode === 'pointer' || this._cursorMode === 'tangent') {
      this._canvas.style.cursor = 'crosshair';
      return;
    }
    this._updateAxisCursor(e);
  }

  _updateAxisCursor(e) {
    const mode = this._getAxisDragMode(e);
    if (mode === 'x') {
      this._canvas.style.cursor = 'ew-resize';
    } else if (mode === 'y') {
      this._canvas.style.cursor = 'ns-resize';
    } else {
      this._canvas.style.cursor = 'default';
    }
  }

  _getAxisDragMode(e) {
    if (!this._chart || !this._chart.scales || !this._chart.scales.x || !this._chart.scales.y) {
      return null;
    }

    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

    const xScale = this._chart.scales.x;
    const yScale = this._chart.scales.y;
    const inXAxisBand = x >= xScale.left && x <= xScale.right && y >= xScale.top - 10 && y <= xScale.bottom + 18;
    const inYAxisBand = y >= yScale.top && y <= yScale.bottom && x >= yScale.left - 18 && x <= yScale.right + 10;

    if (inXAxisBand && inYAxisBand) {
      const distToXAxis = Math.abs(y - xScale.top);
      const distToYAxis = Math.abs(x - yScale.right);
      return distToXAxis <= distToYAxis ? 'x' : 'y';
    }
    if (inXAxisBand) return 'x';
    if (inYAxisBand) return 'y';
    return null;
  }

  _applyAxisZoomToScales(scales) {
    if (!scales || !scales.x || !scales.y) return;
    const originX = this._getAxisOriginValue('x', 0);
    const originY = this._getAxisOriginValue('y', 0);
    scales.x.min = originX;
    scales.y.min = originY;

    const zoomX = this._axisZoom.x;
    const zoomY = this._axisZoom.y;
    if (zoomX && this._isValidRange(zoomX.min, zoomX.max) && zoomX.max > originX) {
      scales.x.max = zoomX.max;
    }
    if (zoomY && this._isValidRange(zoomY.min, zoomY.max) && zoomY.max > originY) {
      scales.y.max = zoomY.max;
    }
  }

  _applyAxisZoomToChart() {
    if (!this._chart || !this._chart.options) return;
    this._applyAxisZoomToScales(this._chart.options.scales);
    this._chart.update('none');
  }

  async _captureGraph() {
    if (!this._chart || !this._chart.canvas) {
      alert('Aucun graphique à capturer.');
      return;
    }
    if (!window.electronAPI || typeof window.electronAPI.saveBinaryFile !== 'function') return;

    const dataUrl = this._chart.canvas.toDataURL('image/png');
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const { canceled, filePath } = await window.electronAPI.showSaveDialog({
      title: 'Capturer le Graph',
      defaultPath: 'graph.png',
      filters: [
        { name: 'PNG', extensions: ['png'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (canceled || !filePath) return;
    const res = await window.electronAPI.saveBinaryFile(filePath, base64);
    if (!res || !res.success) {
      alert('Capture impossible: ' + (res && res.error ? res.error : 'unknown'));
    }
  }

  async _exportGraphCsv() {
    if (!window.electronAPI) return;
    const xId = this._xSelect.value;
    const yIds = this._getSelectedYIds();
    if (!xId || yIds.length === 0) {
      alert('Sélectionnez un axe X et au moins un axe Y.');
      return;
    }
    const cols = this._sheet.getColumns();
    const colById = new Map(cols.map(c => [c.id, c]));
    const xCol = colById.get(xId);
    const yCols = yIds.map(id => colById.get(id)).filter(Boolean);
    const header = [
      xCol ? (xCol.unit ? `${xCol.name} (${xCol.unit})` : xCol.name) : 'X',
      ...yCols.map(c => (c.unit ? `${c.name} (${c.unit})` : c.name))
    ];

    const xVals = this._sheet.getColumnValues(xId);
    const yVals = yIds.map(id => this._sheet.getColumnValues(id));
    const rowCount = Math.max(xVals.length, ...yVals.map(arr => arr.length));
    const rows = [header.map(h => `"${h}"`).join(',')];

    for (let r = 0; r < rowCount; r++) {
      const row = [xVals[r], ...yVals.map(arr => arr[r])].map(v => {
        if (v === null || v === undefined || v === '') return '';
        return typeof v === 'number' ? String(v) : `"${v}"`;
      });
      rows.push(row.join(','));
    }

    const csv = rows.join('\n');
    const { canceled, filePath } = await window.electronAPI.showSaveDialog({
      title: 'Exporter en Excel (CSV)',
      defaultPath: 'graph.csv',
      filters: [
        { name: 'CSV File', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (canceled || !filePath) return;
    const res = await window.electronAPI.saveFile(filePath, csv);
    if (!res || !res.success) {
      alert('Export CSV impossible: ' + (res && res.error ? res.error : 'unknown'));
    }
  }

  _isValidRange(min, max) {
    return Number.isFinite(min) && Number.isFinite(max) && max > min;
  }

  // ─── Regression ───────────────────────────────────────────────────────────

  _deriveColumn() {
    const xId = this._xSelect.value;
    const yId = this._deriveColSelect.value;
    if (!xId || !yId) { alert('Sélectionnez un axe X et une colonne à dériver.'); return; }

    const xVals = this._sheet.getColumnValues(xId);
    const yVals = this._sheet.getColumnValues(yId);
    const cols  = this._sheet.getColumns();
    const yCol  = cols.find(c => c.id === yId);
    const newName = (yCol ? yCol.name : 'col') + "'";

    const n = Math.min(xVals.length, yVals.length);
    const result = new Array(n).fill(null);

    for (let i = 0; i < n; i++) {
      const xi = xVals[i], yi = yVals[i];
      if (xi === null || yi === null) continue;

      if (i === 0) {
        const x1 = xVals[1], y1 = yVals[1];
        if (x1 !== null && y1 !== null && x1 !== xi) result[i] = (y1 - yi) / (x1 - xi);
      } else if (i === n - 1) {
        const xp = xVals[i - 1], yp = yVals[i - 1];
        if (xp !== null && yp !== null && xi !== xp) result[i] = (yi - yp) / (xi - xp);
      } else {
        const xp = xVals[i - 1], yp = yVals[i - 1];
        const xn = xVals[i + 1], yn = yVals[i + 1];
        if (xp !== null && yp !== null && xn !== null && yn !== null && xn !== xp) {
          result[i] = (yn - yp) / (xn - xp);
        }
      }
    }

    const newColId = this._sheet.addColumnWithValues(newName, result);
    this._pendingSelectYId = newColId;
    this._pendingRegressColId = newColId;
    this._update();
  }

  _fitCurve() {
    const points = this._getRegressData();
    if (!points || points.length < 2) {
      this._showRegressionResult('Not enough data points.');
      return;
    }

    const type = this._regressionSelect.value;
    this._regressionType = type;

    if (type === 'none') {
      this._regressionCoeffs = null;
      this._regressionResult.classList.remove('visible');
      this._renderChart();
      return;
    }

    const sorted = [...points].sort((a, b) => a.x - b.x);
    let result = null;

    switch (type) {
      case 'linear':      result = this._fitLinear(sorted); break;
      case 'exponential': result = this._fitExponential(sorted); break;
      case 'parabola':    result = this._fitParabola(sorted); break;
      case 'logarithmic_ln':    result = this._fitLogarithmicLn(sorted); break;
      case 'logarithmic_log10': result = this._fitLogarithmicLog10(sorted); break;
      case 'inverse':           result = this._fitInverse(sorted); break;
      case 'inverse_square':    result = this._fitInverseSquare(sorted); break;
      case 'power':             result = this._fitPower(sorted); break;
    }

    if (!result) {
      this._showRegressionResult('Could not fit curve (check data validity).');
      return;
    }

    this._regressionCoeffs = result.coeffs;
    const r2 = this._computeR2(sorted, type, result.coeffs);

    const r2Str = isFinite(r2) ? r2.toFixed(4) : 'N/A';
    const eqStr = this._formatEquation(type, result.coeffs);
    this._showRegressionResult(eqStr, r2Str);
    this._renderChart();
  }

  _fitLinear(points) {
    // y = ax + b, least squares
    const n = points.length;
    if (n < 2) return null;
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    points.forEach(({ x, y }) => {
      sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
    });
    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-15) return null;
    const a = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - a * sumX) / n;
    return { coeffs: { a, b } };
  }

  _fitExponential(points) {
    // y = a * e^(bx), linearize: ln(y) = ln(a) + bx
    const valid = points.filter(p => p.y > 0);
    if (valid.length < 2) return null;
    const lnPoints = valid.map(p => ({ x: p.x, y: Math.log(p.y) }));
    const linear = this._fitLinear(lnPoints);
    if (!linear) return null;
    const a = Math.exp(linear.coeffs.b);
    const b = linear.coeffs.a;
    return { coeffs: { a, b } };
  }

  _fitParabola(points) {
    // y = ax^2 + bx + c, normal equations: 3x3 system
    // [sum(x^4) sum(x^3) sum(x^2)] [a]   [sum(x^2*y)]
    // [sum(x^3) sum(x^2) sum(x)  ] [b] = [sum(x*y)  ]
    // [sum(x^2) sum(x)   n       ] [c]   [sum(y)     ]
    const n = points.length;
    if (n < 3) return null;

    let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    let t0 = 0, t1 = 0, t2 = 0;

    points.forEach(({ x, y }) => {
      const x2 = x * x, x3 = x2 * x, x4 = x3 * x;
      s1 += x; s2 += x2; s3 += x3; s4 += x4;
      t0 += y; t1 += x * y; t2 += x2 * y;
    });

    // Solve 3x3 Gaussian elimination
    // Matrix A (rows: 0,1,2), RHS b
    let A = [
      [s4, s3, s2, t2],
      [s3, s2, s1, t1],
      [s2, s1, s0, t0]
    ];

    const result = this._gaussianElim3(A);
    if (!result) return null;
    const [a, b, c] = result;
    return { coeffs: { a, b, c } };
  }

  _fitLogarithmicLn(points) {
    // y = a·ln(x) + b
    const transformed = points
      .filter(p => p.x > 0)
      .map(p => ({ x: Math.log(p.x), y: p.y }));
    const linear = this._fitLinear(transformed);
    if (!linear) return null;
    return { coeffs: { a: linear.coeffs.a, b: linear.coeffs.b } };
  }

  _fitLogarithmicLog10(points) {
    // y = a·log10(x) + b
    const transformed = points
      .filter(p => p.x > 0)
      .map(p => ({ x: Math.log10(p.x), y: p.y }));
    const linear = this._fitLinear(transformed);
    if (!linear) return null;
    return { coeffs: { a: linear.coeffs.a, b: linear.coeffs.b } };
  }

  _fitInverse(points) {
    // y = a/x + b
    const transformed = points
      .filter(p => Math.abs(p.x) > 1e-12)
      .map(p => ({ x: 1 / p.x, y: p.y }));
    const linear = this._fitLinear(transformed);
    if (!linear) return null;
    return { coeffs: { a: linear.coeffs.a, b: linear.coeffs.b } };
  }

  _fitInverseSquare(points) {
    // y = a/x² + b
    const transformed = points
      .filter(p => Math.abs(p.x) > 1e-12)
      .map(p => ({ x: 1 / (p.x * p.x), y: p.y }));
    const linear = this._fitLinear(transformed);
    if (!linear) return null;
    return { coeffs: { a: linear.coeffs.a, b: linear.coeffs.b } };
  }

  _fitPower(points) {
    // y = a·x^b, linearize: ln(y) = ln(a) + b·ln(x)
    const transformed = points
      .filter(p => p.x > 0 && p.y > 0)
      .map(p => ({ x: Math.log(p.x), y: Math.log(p.y) }));
    const linear = this._fitLinear(transformed);
    if (!linear) return null;
    const a = Math.exp(linear.coeffs.b);
    const b = linear.coeffs.a;
    return { coeffs: { a, b } };
  }

  /** Solves a 3x4 augmented matrix (3 equations, 3 unknowns) via Gaussian elimination. */
  _gaussianElim3(aug) {
    const m = aug.map(row => [...row]); // deep copy

    for (let col = 0; col < 3; col++) {
      // Find pivot
      let maxRow = col;
      for (let row = col + 1; row < 3; row++) {
        if (Math.abs(m[row][col]) > Math.abs(m[maxRow][col])) maxRow = row;
      }
      [m[col], m[maxRow]] = [m[maxRow], m[col]];

      if (Math.abs(m[col][col]) < 1e-12) return null;

      for (let row = col + 1; row < 3; row++) {
        const factor = m[row][col] / m[col][col];
        for (let j = col; j <= 3; j++) {
          m[row][j] -= factor * m[col][j];
        }
      }
    }

    // Back substitution
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      x[i] = m[i][3];
      for (let j = i + 1; j < 3; j++) {
        x[i] -= m[i][j] * x[j];
      }
      x[i] /= m[i][i];
    }

    return x;
  }

  _evalRegression(x) {
    if (!this._regressionCoeffs) return null;
    const { a, b, c } = this._regressionCoeffs;
    switch (this._regressionType) {
      case 'linear':            return a * x + b;
      case 'exponential':       return a * Math.exp(b * x);
      case 'parabola':          return a * x * x + b * x + c;
      case 'logarithmic_ln':    return x > 0 ? (a * Math.log(x) + b) : null;
      case 'logarithmic_log10': return x > 0 ? (a * Math.log10(x) + b) : null;
      case 'inverse':           return Math.abs(x) > 1e-12 ? (a / x + b) : null;
      case 'inverse_square':    return Math.abs(x) > 1e-12 ? (a / (x * x) + b) : null;
      case 'power':             return x > 0 ? (a * Math.pow(x, b)) : null;
      default: return null;
    }
  }

  _computeR2(points, type, coeffs) {
    const valid = points
      .map(({ x, y }) => ({ x, y, pred: this._evalRegressionWith(x, type, coeffs) }))
      .filter(p => p.pred !== null && Number.isFinite(p.pred));
    if (valid.length === 0) return NaN;

    const yMean = valid.reduce((s, p) => s + p.y, 0) / valid.length;
    let ssTot = 0;
    let ssRes = 0;
    valid.forEach(({ y, pred }) => {
      ssTot += (y - yMean) ** 2;
      ssRes += (y - pred) ** 2;
    });
    return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  }

  _evalRegressionWith(x, type, coeffs) {
    const { a, b, c } = coeffs;
    switch (type) {
      case 'linear':            return a * x + b;
      case 'exponential':       return a * Math.exp(b * x);
      case 'parabola':          return a * x * x + b * x + c;
      case 'logarithmic_ln':    return x > 0 ? (a * Math.log(x) + b) : null;
      case 'logarithmic_log10': return x > 0 ? (a * Math.log10(x) + b) : null;
      case 'inverse':           return Math.abs(x) > 1e-12 ? (a / x + b) : null;
      case 'inverse_square':    return Math.abs(x) > 1e-12 ? (a / (x * x) + b) : null;
      case 'power':             return x > 0 ? (a * Math.pow(x, b)) : null;
      default: return null;
    }
  }

  _formatEquation(type, coeffs) {
    const { a, b, c } = coeffs;
    const fmt = (v) => {
      if (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0)) return v.toExponential(3);
      return parseFloat(v.toPrecision(5)).toString();
    };
    const sign = (v) => v >= 0 ? `+ ${fmt(v)}` : `− ${fmt(Math.abs(v))}`;

    switch (type) {
      case 'linear':
        return `y = ${fmt(a)}·x ${sign(b)}`;
      case 'exponential':
        return `y = ${fmt(a)}·e^(${fmt(b)}·x)`;
      case 'parabola':
        return `y = ${fmt(a)}·x² ${sign(b)}·x ${sign(c)}`;
      case 'logarithmic_ln':
        return `y = ${fmt(a)}·ln(x) ${sign(b)}`;
      case 'logarithmic_log10':
        return `y = ${fmt(a)}·log10(x) ${sign(b)}`;
      case 'inverse':
        return `y = ${fmt(a)}/x ${sign(b)}`;
      case 'inverse_square':
        return `y = ${fmt(a)}/x² ${sign(b)}`;
      case 'power':
        return `y = ${fmt(a)}·x^${fmt(b)}`;
      default:
        return '';
    }
  }

  _showRegressionResult(eq, r2) {
    this._regressionResult.innerHTML = '';
    const eqLine = document.createElement('div');
    eqLine.className = 'eq-line';
    eqLine.textContent = eq;
    this._regressionResult.appendChild(eqLine);

    if (r2 !== undefined) {
      const r2Line = document.createElement('div');
      r2Line.className = 'r2-line';
      r2Line.textContent = `R² = ${r2}`;
      this._regressionResult.appendChild(r2Line);
    }

    this._regressionResult.classList.add('visible');
  }
}
