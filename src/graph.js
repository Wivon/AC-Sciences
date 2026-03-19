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

    this._xSelect = document.getElementById('x-axis-select');
    this._yList   = document.getElementById('y-axis-list');
    this._deriveColSelect = document.getElementById('derive-col-select');
    this._deriveBtn = document.getElementById('derive-btn');
    this._regressionSelect = document.getElementById('regression-type-select');
    this._fitBtn = document.getElementById('fit-curve-btn');
    this._regressionResult = document.getElementById('regression-result');
    this._refreshBtn = document.getElementById('refresh-graph-btn');
    this._canvas = document.getElementById('chart-canvas');
    this._placeholder = document.getElementById('chart-placeholder');

    // Color palette for multiple Y series
    this._palette = [
      'rgba(37,99,235,0.75)',
      'rgba(239,68,68,0.75)',
      'rgba(16,185,129,0.75)',
      'rgba(245,158,11,0.75)',
      'rgba(139,92,246,0.75)',
      'rgba(236,72,153,0.75)',
      'rgba(20,184,166,0.75)',
      'rgba(249,115,22,0.75)',
    ];

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

    const deriveVal = this._deriveColSelect.value;

    // Rebuild X dropdown
    this._xSelect.innerHTML = '<option value="">— select —</option>';
    this._deriveColSelect.innerHTML = '<option value="">— select —</option>';
    cols.forEach(col => {
      const label = col.unit ? `${col.name} (${col.unit})` : col.name;

      const opt = document.createElement('option');
      opt.value = col.id;
      opt.textContent = label;
      this._xSelect.appendChild(opt);

      const dopt = opt.cloneNode(true);
      this._deriveColSelect.appendChild(dopt);
    });
    if (xVal && cols.find(c => c.id === xVal)) this._xSelect.value = xVal;
    if (deriveVal && cols.find(c => c.id === deriveVal)) this._deriveColSelect.value = deriveVal;

    // Rebuild Y pill toggles
    this._yList.innerHTML = '';
    cols.forEach(col => {
      const label = col.unit ? `${col.name} (${col.unit})` : col.name;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'y-pill' + (prevYIds.includes(col.id) ? ' selected' : '');
      pill.dataset.colId = col.id;
      pill.textContent = label;
      pill.addEventListener('click', () => {
        pill.classList.toggle('selected');
        this._onAxesChanged();
      });
      this._yList.appendChild(pill);
    });
  }

  /** Returns array of colIds for currently selected Y pills */
  _getSelectedYIds() {
    return Array.from(this._yList.querySelectorAll('.y-pill.selected'))
      .map(p => p.dataset.colId);
  }

  loadFromData(graphData) {
    if (graphData.xColumn) this._xSelect.value = graphData.xColumn;
    const savedYIds = graphData.yColumns
      ? graphData.yColumns
      : (graphData.yColumn ? [graphData.yColumn] : []);
    this._yList.querySelectorAll('.y-pill').forEach(pill => {
      pill.classList.toggle('selected', savedYIds.includes(pill.dataset.colId));
    });
    if (graphData.regressionType) {
      this._regressionType = graphData.regressionType;
      this._regressionSelect.value = graphData.regressionType;
    }
    this._regressionCoeffs = null;
  }

  toData() {
    return {
      xColumn: this._xSelect.value || '',
      yColumns: this._getSelectedYIds(),
      regressionType: this._regressionType
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _onAxesChanged() {
    this._regressionCoeffs = null;
    this._regressionResult.classList.remove('visible');
    this._update();
  }

  _update() {
    this.refreshColumns();
    this._renderChart();
  }

  /**
   * Returns array of { colId, label, points } for each selected Y column.
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
      return { colId: yId, label, points };
    }).filter(s => s.points.length > 0);
  }

  /** Returns points for first selected Y column (used by regression/derivative) */
  _getFirstYData() {
    const series = this._getXYData();
    return series && series.length > 0 ? series[0].points : null;
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

    // 1. Scatter dataset per Y column
    allSeries.forEach(({ label, points }, i) => {
      const color = this._palette[i % this._palette.length];
      const sorted = [...points].sort((a, b) => a.x - b.x);
      datasets.push({
        label,
        data: sorted,
        type: 'scatter',
        backgroundColor: color,
        pointRadius: 5,
        pointHoverRadius: 7,
        showLine: false,
        order: 3
      });
    });

    // Regression uses the first selected Y series
    const firstSorted = allSeries[0].points.slice().sort((a, b) => a.x - b.x);
    const firstLabel = allSeries[0].label;

    // 2. Regression curve (on first Y series)
    if (this._regressionCoeffs && firstSorted.length >= 2) {
      const xMin = firstSorted[0].x;
      const xMax = firstSorted[firstSorted.length - 1].x;
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

    const yAxisTitle = allSeries.length === 1 ? firstLabel : 'Y';
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

    this._sheet.addColumnWithValues(newName, result);
    this._update();
  }

  _fitCurve() {
    const points = this._getFirstYData();
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
