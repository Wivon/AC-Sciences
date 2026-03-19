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
    this._ySelect = document.getElementById('y-axis-select');
    this._showDerivativeCb = document.getElementById('show-derivative-cb');
    this._regressionSelect = document.getElementById('regression-type-select');
    this._fitBtn = document.getElementById('fit-curve-btn');
    this._regressionResult = document.getElementById('regression-result');
    this._refreshBtn = document.getElementById('refresh-graph-btn');
    this._canvas = document.getElementById('chart-canvas');
    this._placeholder = document.getElementById('chart-placeholder');

    this._fitBtn.addEventListener('click', () => this._fitCurve());
    this._refreshBtn.addEventListener('click', () => this._update());
    this._xSelect.addEventListener('change', () => this._onAxesChanged());
    this._ySelect.addEventListener('change', () => this._onAxesChanged());
    this._showDerivativeCb.addEventListener('change', () => this._renderChart());
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
    const yVal = this._ySelect.value;

    this._xSelect.innerHTML = '<option value="">— select —</option>';
    this._ySelect.innerHTML = '<option value="">— select —</option>';

    cols.forEach(col => {
      const label = col.unit ? `${col.name} (${col.unit})` : col.name;

      const ox = document.createElement('option');
      ox.value = col.id;
      ox.textContent = label;
      this._xSelect.appendChild(ox);

      const oy = document.createElement('option');
      oy.value = col.id;
      oy.textContent = label;
      this._ySelect.appendChild(oy);
    });

    // Restore previous selection if still valid
    if (xVal && cols.find(c => c.id === xVal)) this._xSelect.value = xVal;
    if (yVal && cols.find(c => c.id === yVal)) this._ySelect.value = yVal;
  }

  loadFromData(graphData) {
    if (graphData.xColumn) this._xSelect.value = graphData.xColumn;
    if (graphData.yColumn) this._ySelect.value = graphData.yColumn;
    if (typeof graphData.showDerivative === 'boolean') {
      this._showDerivativeCb.checked = graphData.showDerivative;
    }
    if (graphData.regressionType) {
      this._regressionType = graphData.regressionType;
      this._regressionSelect.value = graphData.regressionType;
    }
    this._regressionCoeffs = null;
  }

  toData() {
    return {
      xColumn: this._xSelect.value || '',
      yColumn: this._ySelect.value || '',
      showDerivative: this._showDerivativeCb.checked,
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

  _getXYData() {
    const xId = this._xSelect.value;
    const yId = this._ySelect.value;
    if (!xId || !yId) return null;

    const xVals = this._sheet.getColumnValues(xId);
    const yVals = this._sheet.getColumnValues(yId);

    const points = [];
    const len = Math.min(xVals.length, yVals.length);
    for (let i = 0; i < len; i++) {
      if (xVals[i] !== null && yVals[i] !== null) {
        points.push({ x: xVals[i], y: yVals[i] });
      }
    }
    return points;
  }

  _computeDerivative(points) {
    if (!points || points.length < 2) return [];
    const deriv = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      let dy, x;
      if (i === 0) {
        // Forward difference
        dy = (points[1].y - points[0].y) / (points[1].x - points[0].x);
        x = points[0].x;
      } else if (i === n - 1) {
        // Backward difference
        dy = (points[n - 1].y - points[n - 2].y) / (points[n - 1].x - points[n - 2].x);
        x = points[n - 1].x;
      } else {
        // Central difference
        dy = (points[i + 1].y - points[i - 1].y) / (points[i + 1].x - points[i - 1].x);
        x = points[i].x;
      }
      if (isFinite(dy)) deriv.push({ x, y: dy });
    }
    return deriv;
  }

  _getAxisLabels() {
    const cols = this._sheet.getColumns();
    const xId = this._xSelect.value;
    const yId = this._ySelect.value;
    const xCol = cols.find(c => c.id === xId);
    const yCol = cols.find(c => c.id === yId);
    const xLabel = xCol ? (xCol.unit ? `${xCol.name} (${xCol.unit})` : xCol.name) : 'X';
    const yLabel = yCol ? (yCol.unit ? `${yCol.name} (${yCol.unit})` : yCol.name) : 'Y';
    return { xLabel, yLabel };
  }

  _renderChart() {
    const points = this._getXYData();

    if (!points || points.length === 0) {
      this._placeholder.classList.remove('hidden');
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
      }
      return;
    }

    this._placeholder.classList.add('hidden');

    const { xLabel, yLabel } = this._getAxisLabels();

    // Sort by x for derivative / regression curve
    const sorted = [...points].sort((a, b) => a.x - b.x);

    const datasets = [];

    // 1. Scatter data
    datasets.push({
      label: yLabel,
      data: sorted.map(p => ({ x: p.x, y: p.y })),
      type: 'scatter',
      backgroundColor: 'rgba(37, 99, 235, 0.7)',
      pointRadius: 5,
      pointHoverRadius: 7,
      showLine: false,
      order: 3
    });

    // 2. Derivative overlay
    if (this._showDerivativeCb.checked) {
      const deriv = this._computeDerivative(sorted);
      if (deriv.length > 0) {
        datasets.push({
          label: 'd/dx ' + yLabel,
          data: deriv.map(p => ({ x: p.x, y: p.y })),
          type: 'line',
          borderColor: 'rgba(16, 185, 129, 0.85)',
          backgroundColor: 'transparent',
          borderDash: [6, 3],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          yAxisID: 'yDeriv',
          order: 2
        });
      }
    }

    // 3. Regression curve
    if (this._regressionCoeffs) {
      const xMin = sorted[0].x;
      const xMax = sorted[sorted.length - 1].x;
      const step = (xMax - xMin) / 99;
      const curvePts = [];
      for (let i = 0; i < 100; i++) {
        const xi = xMin + i * step;
        const yi = this._evalRegression(xi);
        if (yi !== null && isFinite(yi)) curvePts.push({ x: xi, y: yi });
      }
      datasets.push({
        label: 'Regression',
        data: curvePts,
        type: 'line',
        borderColor: 'rgba(245, 158, 11, 0.95)',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.3,
        order: 1
      });
    }

    // Chart options
    const scales = {
      x: {
        type: 'linear',
        title: { display: true, text: xLabel, font: { size: 12 } },
        grid: { color: 'rgba(0,0,0,0.06)' }
      },
      y: {
        title: { display: true, text: yLabel, font: { size: 12 } },
        grid: { color: 'rgba(0,0,0,0.06)' }
      }
    };

    if (this._showDerivativeCb.checked) {
      scales.yDeriv = {
        type: 'linear',
        position: 'right',
        title: { display: true, text: `d${yLabel}/dx`, font: { size: 11 }, color: 'rgba(16,185,129,0.9)' },
        grid: { drawOnChartArea: false },
        ticks: { color: 'rgba(16,185,129,0.9)' }
      };
    }

    if (this._chart) {
      // Update existing chart
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
          animation: { duration: 150 },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { font: { size: 11 }, padding: 10 }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  return ` (${this._fmt(ctx.parsed.x)}, ${this._fmt(ctx.parsed.y)})`;
                }
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

  _fitCurve() {
    const points = this._getXYData();
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
