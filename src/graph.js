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
    this._yStyleByColId = {};
    this._yColorByColId = {};

    this._xSelect = document.getElementById('x-axis-select');
    this._yList   = document.getElementById('y-axis-list');
    this._deriveColSelect  = document.getElementById('derive-col-select');
    this._deriveBtn        = document.getElementById('derive-btn');
    this._regressColSelect = document.getElementById('regress-col-select');
    this._regressionSelect = document.getElementById('regression-type-select');
    this._fitBtn = document.getElementById('fit-curve-btn');
    this._regressionResult = document.getElementById('regression-result');
    this._refreshBtn = document.getElementById('refresh-graph-btn');
    this._canvas = document.getElementById('chart-canvas');
    this._placeholder = document.getElementById('chart-placeholder');

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
    this._xSelect.addEventListener('change', () => this._onAxesChanged());
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
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closeAllSeriesMenus();
    });

    // Listen for sheet changes
    document.addEventListener('sheet-data-changed', () => {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._update(), 300);
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  refreshColumns() {
    const cols = this._sheet.getColumns();
    const xVal = this._xSelect.value;
    const prevYIds = this._getSelectedYIds();
    const selectedYIds = new Set(prevYIds);
    const colIdSet = new Set(cols.map(c => c.id));
    Object.keys(this._yStyleByColId).forEach(colId => {
      if (!colIdSet.has(colId)) delete this._yStyleByColId[colId];
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

    // Rebuild Y list with style context menus
    this._yList.innerHTML = '';
    cols.forEach((col, colIdx) => {
      const label = col.unit ? `${col.name} (${col.unit})` : col.name;
      const style = this._getSeriesStyle(col.id);
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
        if (willOpen) row.classList.add('menu-open');
      });

      const menu = document.createElement('div');
      menu.className = 'y-style-menu';
      [
        { value: 'points', label: 'Points' },
        { value: 'line', label: 'Ligne' },
        { value: 'line_points', label: 'Ligne + points' }
      ].forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'y-style-item' + (style === option.value ? ' selected' : '');
        item.dataset.style = option.value;
        item.textContent = option.label;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this._setSeriesStyle(col.id, option.value);
          menu.querySelectorAll('.y-style-item').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.style === option.value);
          });
          this._closeAllSeriesMenus();
          this._renderChart();
        });
        menu.appendChild(item);
      });

      const divider = document.createElement('div');
      divider.className = 'y-style-divider';
      menu.appendChild(divider);

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

  _getSeriesStyle(colId) {
    const style = this._yStyleByColId[colId];
    return (style === 'line' || style === 'line_points') ? style : 'points';
  }

  _setSeriesStyle(colId, style) {
    if (style === 'line' || style === 'line_points') {
      this._yStyleByColId[colId] = style;
    } else {
      delete this._yStyleByColId[colId];
    }
  }

  _getSeriesColor(colId, fallbackIndex = 0) {
    const saved = this._yColorByColId[colId];
    if (this._isSelectableColor(saved)) return saved;
    return this._palette[fallbackIndex % this._palette.length];
  }

  _setSeriesColor(colId, color) {
    if (!this._isSelectableColor(color)) return;
    this._yColorByColId[colId] = color;
  }

  _isSelectableColor(color) {
    return typeof color === 'string' && this._colorOptions.includes(color);
  }

  _closeAllSeriesMenus() {
    this._yList.querySelectorAll('.y-pill-row.menu-open').forEach(row => row.classList.remove('menu-open'));
  }

  loadFromData(graphData) {
    if (graphData.xColumn) this._xSelect.value = graphData.xColumn;
    this._yStyleByColId = {};
    if (graphData.yStyles && typeof graphData.yStyles === 'object') {
      Object.entries(graphData.yStyles).forEach(([colId, style]) => {
        if (style === 'line' || style === 'line_points') this._yStyleByColId[colId] = style;
      });
    }
    this._yColorByColId = {};
    if (graphData.yColors && typeof graphData.yColors === 'object') {
      Object.entries(graphData.yColors).forEach(([colId, color]) => {
        if (this._isSelectableColor(color)) this._yColorByColId[colId] = color;
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
  }

  toData() {
    const yStyles = {};
    Object.entries(this._yStyleByColId).forEach(([colId, style]) => {
      if (style && style !== 'points') yStyles[colId] = style;
    });
    const yColors = {};
    Object.entries(this._yColorByColId).forEach(([colId, color]) => {
      if (this._isSelectableColor(color)) yColors[colId] = color;
    });
    return {
      xColumn: this._xSelect.value || '',
      yColumns: this._getSelectedYIds(),
      regressionType: this._regressionType,
      yStyles,
      yColors
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _onAxesChanged() {
    this._closeAllSeriesMenus();
    this._regressionCoeffs = null;
    this._regressionResult.classList.remove('visible');
    this._renderChart();
  }

  _update() {
    this.refreshColumns();
    this._renderChart();
  }

  /**
   * Returns array of { colId, label, style, color, points } for selected Y columns.
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
        style: this._getSeriesStyle(yId),
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
      if (this._chart) { this._chart.destroy(); this._chart = null; }
      return;
    }

    this._placeholder.classList.add('hidden');

    const { xLabel } = this._getAxisLabels();
    const datasets = [];

    // 1. Dataset per Y column (style configurable: points, line, line+points)
    allSeries.forEach(({ label, points, style, color }) => {
      const sorted = [...points].sort((a, b) => a.x - b.x);
      const isLine = style === 'line' || style === 'line_points';
      const showPoints = style !== 'line';
      datasets.push({
        label,
        data: sorted,
        type: 'scatter',
        backgroundColor: color,
        borderColor: color,
        borderWidth: isLine ? 2 : 1.5,
        pointRadius: showPoints ? 5 : 0,
        pointHoverRadius: showPoints ? 7 : 0,
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
        grid: { color: 'rgba(0,0,0,0.06)' }
      },
      y: {
        title: { display: true, text: yAxisTitle, font: { size: 12 } },
        grid: { color: 'rgba(0,0,0,0.06)' }
      }
    };

    if (this._chart) {
      this._chart.data.datasets = datasets;
      this._chart.options.scales = scales;
      this._chart.update();
    } else {
      this._chart = new Chart(this._canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: true, position: 'top', labels: { font: { size: 11 }, padding: 10 } },
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
  }

  _fmt(v) {
    if (typeof v !== 'number') return String(v);
    const abs = Math.abs(v);
    if (abs >= 1e5 || (abs < 1e-3 && v !== 0)) return v.toExponential(3);
    return parseFloat(v.toPrecision(6)).toString();
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
      case 'linear':     result = this._fitLinear(sorted); break;
      case 'exponential': result = this._fitExponential(sorted); break;
      case 'parabola':   result = this._fitParabola(sorted); break;
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
      case 'linear':      return a * x + b;
      case 'exponential': return a * Math.exp(b * x);
      case 'parabola':    return a * x * x + b * x + c;
      default: return null;
    }
  }

  _computeR2(points, type, coeffs) {
    const yMean = points.reduce((s, p) => s + p.y, 0) / points.length;
    let ssTot = 0, ssRes = 0;
    points.forEach(({ x, y }) => {
      ssTot += (y - yMean) ** 2;
      const pred = this._evalRegressionWith(x, type, coeffs);
      if (pred !== null) ssRes += (y - pred) ** 2;
    });
    return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  }

  _evalRegressionWith(x, type, coeffs) {
    const { a, b, c } = coeffs;
    switch (type) {
      case 'linear':      return a * x + b;
      case 'exponential': return a * Math.exp(b * x);
      case 'parabola':    return a * x * x + b * x + c;
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
