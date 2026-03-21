/**
 * app.js — Main application controller for AC Sciences
 * Manages project state, tab switching, save/load, and wires Sheet + Graph.
 */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

  let currentFilePath = null;
  let isDirty = false;
  let projectData = null;
  let nameCounter = 1;

  // ─── DOM References ─────────────────────────────────────────────────────────

  const projectNameDisplay = document.getElementById('project-name-display');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const formulaInput = document.getElementById('formula-input');
  const formulaCellRef = document.getElementById('formula-cell-ref');
  const formulaBar = document.getElementById('formula-bar');
  const saveBtn = document.getElementById('save-btn');
  const openBtn = document.getElementById('open-btn');
  const logoBtn = document.getElementById('claveille-logo-btn');
  const aboutPopup = document.getElementById('about-popup');
  const aboutPopupBackdrop = document.getElementById('about-popup-backdrop');
  const aboutPopupCard = document.getElementById('about-popup-card');

  // ─── Create Sheet, Graph & Video ─────────────────────────────────────────────

  const sheet = new Sheet(null, formulaInput, formulaCellRef);
  const graph = new Graph(sheet);
  const video = new VideoTracker(sheet);
  const conversions = new Conversions();

  // ─── Project Management ──────────────────────────────────────────────────────

  function newProject() {
    currentFilePath = null;
    isDirty = false;
    nameCounter = 1;

    const now = new Date().toISOString();
    projectData = {
      version: '1.0',
      name: 'Untitled',
      created: now,
      modified: now,
      sheet: {
        columns: Array.from({ length: 5 }, (_, i) => ({
          id: `col_default_${i}`,
          name: i === 0 ? 't' : String.fromCharCode(65 + i), // B, C, D…
          unit: '',
          cells: Array(10).fill('')
        })),
        rowCount: 10
      },
      graph: {
        xColumn: 'col_default_0',
        yColumn: '',
        showDerivative: false,
        regressionType: 'none'
      },
      video: {},
      conversions: {}
    };

    applyProject();
    setTitle('Untitled');
  }

  function applyProject() {
    sheet.loadFromData(projectData.sheet);
    graph.refreshColumns();
    graph.loadFromData(projectData.graph);
    video.loadFromData(projectData.video || {});
    conversions.loadFromData(projectData.conversions || {});
    updateProjectNameDisplay(projectData.name);
  }

  function collectProjectData() {
    projectData.modified = new Date().toISOString();
    projectData.sheet = sheet.toData();
    projectData.graph = graph.toData();
    projectData.video = video.toData();
    projectData.conversions = conversions.toData();
    return projectData;
  }

  function updateProjectNameDisplay(name) {
    projectNameDisplay.textContent = name ? `— ${name}` : '';
  }

  function setTitle(name) {
    updateProjectNameDisplay(name);
    if (window.electronAPI) {
      window.electronAPI.setTitle(name);
    }
    document.title = `Labo Claveille — ${name}`;
  }

  function openAboutPopup() {
    if (aboutPopup) aboutPopup.classList.remove('hidden');
  }

  function closeAboutPopup() {
    if (aboutPopup) aboutPopup.classList.add('hidden');
  }

  function markDirty() {
    if (!isDirty) {
      isDirty = true;
      const name = projectData ? projectData.name : 'Untitled';
      setTitle(`${name} •`);
    }
  }

  // ─── Save / Load ─────────────────────────────────────────────────────────────

  async function saveProject(forceDialog) {
    let filePath = currentFilePath;

    if (!filePath || forceDialog) {
      if (!window.electronAPI) return;
      const { canceled, filePath: chosen } = await window.electronAPI.showSaveDialog({
        title: 'Save Project',
        defaultPath: (projectData.name || 'Untitled') + '.lab',
        filters: [
          { name: 'Labo Claveille Project', extensions: ['lab'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (canceled || !chosen) return;
      filePath = chosen;
      // Extract name from path
      const basename = filePath.split(/[\\/]/).pop().replace(/\.lab$/i, '');
      projectData.name = basename;
      setTitle(basename);
    }

    const data = collectProjectData();
    const json = JSON.stringify(data, null, 2);

    const result = await window.electronAPI.saveFile(filePath, json);
    if (result.success) {
      currentFilePath = filePath;
      isDirty = false;
      setTitle(projectData.name);
    } else {
      alert('Failed to save: ' + result.error);
    }
  }

  function _decodeFileBuffer(base64) {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    let encoding = 'utf-8';
    if (bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      encoding = 'utf-8';
    }
    let text = '';
    try {
      text = new TextDecoder(encoding).decode(bytes);
    } catch (_e) {
      text = new TextDecoder('utf-8').decode(bytes);
    }
    return { text, encoding };
  }

  function _extractLegacyCellBlock(text) {
    const match = text.match(/\[cellules\][\s\S]*?data\s*=\s*"\s*\r?\n([\s\S]*?)\r?\n"\s*/i);
    return match ? match[1] : '';
  }

  function _parseLegacyColumnLabel(label) {
    const trimmed = (label || '').trim();
    if (!trimmed) return { name: '', unit: '' };
    const m = trimmed.match(/^(.*)\s+\(en\s+([^)]+)\)\s*$/i);
    if (m) {
      return { name: m[1].trim(), unit: m[2].trim() };
    }
    return { name: trimmed, unit: '' };
  }

  function _normalizeLegacyValue(raw) {
    let v = (raw || '').trim();
    if (!v) return '';
    if (v.includes('<----')) return '';
    v = v.replace(/×/g, '*').replace(/÷/g, '/');
    v = v.replace(/(\d),(\d)/g, '$1.$2');
    return v;
  }

  function _convertLegacyLab(text, sourcePath) {
    const block = _extractLegacyCellBlock(text);
    if (!block) return null;

    const lines = block.split(/\r?\n/);
    const colsById = new Map();
    const colOrder = [];
    const nameCounts = new Map();
    let maxRow = 0;

    const ensureColumn = (colId, name, unit) => {
      let col = colsById.get(colId);
      if (!col) {
        col = { id: colId, name: '', unit: unit || '', cellsByRow: new Map() };
        colsById.set(colId, col);
        colOrder.push(colId);
      }
      if (name) {
        let finalName = name.trim() || `Col ${nameCounter++}`;
        const key = finalName.toLowerCase();
        const count = nameCounts.get(key) || 0;
        if (count > 0) {
          finalName = `${finalName} ${count + 1}`;
        }
        nameCounts.set(key, count + 1);
        col.name = finalName;
      }
      if (unit && !col.unit) col.unit = unit;
      return col;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const rowIdx = parseInt(m[1], 10);
      const colId = m[2];
      const rest = m[4] || '';
      const tokens = rest.split('|').map(t => t.trim());
      const firstToken = tokens.find(t => t !== '');
      if (!firstToken) continue;

      if (rowIdx === 0) {
        const { name, unit } = _parseLegacyColumnLabel(firstToken);
        ensureColumn(colId, name, unit);
        continue;
      }

      const value = _normalizeLegacyValue(firstToken);
      if (!value) continue;
      const col = ensureColumn(colId, '', '');
      const targetRow = rowIdx - 1;
      col.cellsByRow.set(targetRow, value);
      if (targetRow + 1 > maxRow) maxRow = targetRow + 1;
    }

    if (colOrder.length === 0 || maxRow === 0) return null;

    const columns = colOrder.map((colId, idx) => {
      const col = colsById.get(colId);
      const name = col && col.name ? col.name : `Col ${idx + 1}`;
      const unit = col && col.unit ? col.unit : '';
      const cells = Array.from({ length: maxRow }, () => '');
      if (col && col.cellsByRow) {
        col.cellsByRow.forEach((value, row) => {
          if (row >= 0 && row < maxRow) cells[row] = value;
        });
      }
      return { id: `col_import_${idx}`, name, unit, cells };
    });

    const xColumnName = columns.find(c => c.name.toLowerCase() === 't') ? 't' : (columns[0] ? columns[0].name : '');
    const xCol = columns.find(c => c.name.toLowerCase() === xColumnName.toLowerCase());
    const xColumnId = xCol ? xCol.id : (columns[0] ? columns[0].id : '');

    const basename = sourcePath ? sourcePath.split(/[\\/]/).pop().replace(/\.lab$/i, '') : 'Untitled';
    const now = new Date().toISOString();
    return {
      version: '1.0',
      name: basename,
      created: now,
      modified: now,
      sheet: {
        columns,
        rowCount: maxRow
      },
      graph: {
        xColumn: xColumnId,
        yColumn: '',
        showDerivative: false,
        regressionType: 'none'
      },
      video: {},
      conversions: {}
    };
  }

  function _makeConvertedPath(filePath) {
    const sep = filePath.includes('\\') ? '\\' : '/';
    const idx = filePath.lastIndexOf(sep);
    const dir = idx >= 0 ? filePath.slice(0, idx) : '';
    const base = idx >= 0 ? filePath.slice(idx + 1) : filePath;
    const baseNoExt = base.replace(/\.lab$/i, '');
    const nextName = `${baseNoExt}.new.lab`;
    return dir ? `${dir}${sep}${nextName}` : nextName;
  }

  async function _loadProjectFromPath(filePath) {
    if (!window.electronAPI || !filePath) return;
    const rawRes = await window.electronAPI.readFileBuffer(filePath);
    if (!rawRes.success) {
      alert('Failed to open: ' + rawRes.error);
      return;
    }

    const { text } = _decodeFileBuffer(rawRes.data);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_e) {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.sheet) {
      const converted = _convertLegacyLab(text, filePath);
      if (!converted) {
        alert('Impossible de lire ce fichier .lab.');
        return;
      }
      const newPath = _makeConvertedPath(filePath);
      const json = JSON.stringify(converted, null, 2);
      const saveRes = await window.electronAPI.saveFile(newPath, json);
      if (!saveRes.success) {
        alert('Conversion impossible: ' + saveRes.error);
        return;
      }
      projectData = converted;
      currentFilePath = newPath;
      isDirty = false;
      applyProject();
      setTitle(projectData.name || 'Untitled');
      return;
    }

    projectData = parsed;
    currentFilePath = filePath;
    isDirty = false;
    applyProject();
    setTitle(projectData.name || 'Untitled');
  }

  async function openProject() {
    if (!window.electronAPI) return;

    const { canceled, filePaths } = await window.electronAPI.showOpenDialog({
      title: 'Open Project',
      filters: [
        { name: 'Labo Claveille Project', extensions: ['lab'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (canceled || !filePaths || filePaths.length === 0) return;

    await _loadProjectFromPath(filePaths[0]);
  }

  async function openProjectFromPath(filePath) {
    if (!window.electronAPI || !filePath) return;
    if (isDirty) {
      if (!confirm('Des modifications non sauvegardées seront perdues. Ouvrir quand même ?')) return;
    }
    await _loadProjectFromPath(filePath);
  }

  async function exportCSV() {
    if (!window.electronAPI) return;

    const sheetData = sheet.toData();
    const cols = sheetData.columns;
    if (cols.length === 0) { alert('No data to export.'); return; }

    // Build CSV header
    const headerNames = cols.map(c => c.unit ? `"${c.name} (${c.unit})"` : `"${c.name}"`);
    const rows = [headerNames.join(',')];

    const n = sheetData.rowCount;
    for (let r = 0; r < n; r++) {
      const rowVals = cols.map(col => {
        const v = sheet._evalCell(col.id, r);
        if (v === null || v === undefined || v === '') return '';
        return typeof v === 'number' ? String(v) : `"${v}"`;
      });
      rows.push(rowVals.join(','));
    }

    const csv = rows.join('\n');
    const { canceled, filePath } = await window.electronAPI.showSaveDialog({
      title: 'Export CSV',
      defaultPath: (projectData.name || 'Untitled') + '.csv',
      filters: [
        { name: 'CSV File', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (canceled || !filePath) return;

    const res = await window.electronAPI.saveFile(filePath, csv);
    if (!res.success) alert('Export failed: ' + res.error);
  }

  // ─── Tab Switching ────────────────────────────────────────────────────────────

  function switchTab(tabName) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
      content.classList.toggle('hidden', content.id !== `tab-${tabName}`);
    });

    // Show/hide formula bar
    formulaBar.style.display = tabName === 'sheet' ? '' : 'none';

    if (tabName === 'graph') {
      graph.refreshColumns();
      // Small timeout to ensure canvas has correct dimensions after becoming visible
      setTimeout(() => {
        graph._renderChart();
      }, 50);
    } else if (tabName === 'video') {
      setTimeout(() => {
        video.onShown();
      }, 50);
    }
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ─── Toolbar Buttons ──────────────────────────────────────────────────────────

  document.getElementById('add-col-btn').addEventListener('click', () => {
    sheet.addColumn();
    markDirty();
  });

  document.getElementById('add-row-btn').addEventListener('click', () => {
    sheet.addRow();
    markDirty();
  });

  saveBtn.addEventListener('click', () => saveProject(false));
  openBtn.addEventListener('click', () => openProject());
  if (logoBtn) {
    logoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openAboutPopup();
    });
  }
  if (aboutPopupBackdrop) aboutPopupBackdrop.addEventListener('click', closeAboutPopup);
  if (aboutPopup) {
    aboutPopup.addEventListener('click', (e) => {
      if (e.target === aboutPopup) closeAboutPopup();
    });
  }
  if (aboutPopupCard) {
    aboutPopupCard.addEventListener('click', (e) => e.stopPropagation());
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aboutPopup && !aboutPopup.classList.contains('hidden')) {
      e.preventDefault();
      closeAboutPopup();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveProject(e.shiftKey);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      openProject();
    }
  });

  // ─── Sheet Change Listener ────────────────────────────────────────────────────

  document.addEventListener('sheet-data-changed', () => {
    markDirty();
  });

  document.addEventListener('video-data-changed', () => {
    markDirty();
  });

  document.addEventListener('conversions-data-changed', () => {
    markDirty();
  });

  // ─── Electron Menu Listeners ──────────────────────────────────────────────────

  if (window.electronAPI) {
    window.electronAPI.onMenuNew(() => {
      if (isDirty) {
        if (!confirm('Unsaved changes will be lost. Create new project?')) return;
      }
      newProject();
    });

    window.electronAPI.onMenuOpen(() => {
      if (isDirty) {
        if (!confirm('Unsaved changes will be lost. Open a project?')) return;
      }
      openProject();
    });

    window.electronAPI.onMenuSave(() => saveProject(false));
    window.electronAPI.onMenuSaveAs(() => saveProject(true));
    window.electronAPI.onMenuExportCsv(() => exportCSV());
    window.electronAPI.onOpenFile((filePath) => openProjectFromPath(filePath));

    window.electronAPI.onAppClosing(() => {
      const neverSaved = !currentFilePath;
      const shouldConfirm = isDirty || neverSaved;
      const confirmMessage = neverSaved
        ? "Ce projet n'a jamais ete sauvegarde. Quitter quand meme ?"
        : 'Des modifications non sauvegardees seront perdues. Quitter quand meme ?';

      if (!shouldConfirm || confirm(confirmMessage)) {
        window.electronAPI.confirmClose();
      }
    });
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────────

  // Start with a fresh project
  newProject();


  // Reset dirty flag after bootstrap
  isDirty = false;
  setTitle('Untitled');

  // Make sheet accessible globally for CSV export (used by exportCSV)
  window._sheet = sheet;

})();
