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

  // ─── DOM References ─────────────────────────────────────────────────────────

  const projectNameDisplay = document.getElementById('project-name-display');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const formulaInput = document.getElementById('formula-input');
  const formulaCellRef = document.getElementById('formula-cell-ref');
  const formulaBar = document.getElementById('formula-bar');
  const saveBtn = document.getElementById('save-btn');

  // ─── Create Sheet & Graph ────────────────────────────────────────────────────

  const sheet = new Sheet(null, formulaInput, formulaCellRef);
  const graph = new Graph(sheet);

  // ─── Project Management ──────────────────────────────────────────────────────

  function newProject() {
    currentFilePath = null;
    isDirty = false;

    const now = new Date().toISOString();
    projectData = {
      version: '1.0',
      name: 'Untitled',
      created: now,
      modified: now,
      sheet: {
        columns: Array.from({ length: 10 }, (_, i) => ({
          id: `col_default_${i}`,
          name: `Column ${i + 1}`,
          unit: '',
          cells: Array(10).fill('')
        })),
        rowCount: 10
      },
      graph: {
        xColumn: '',
        yColumn: '',
        showDerivative: false,
        regressionType: 'none'
      }
    };

    applyProject();
    setTitle('Untitled');
  }

  function applyProject() {
    sheet.loadFromData(projectData.sheet);
    graph.refreshColumns();
    graph.loadFromData(projectData.graph);
    updateProjectNameDisplay(projectData.name);
  }

  function collectProjectData() {
    projectData.modified = new Date().toISOString();
    projectData.sheet = sheet.toData();
    projectData.graph = graph.toData();
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
    document.title = `AC Sciences — ${name}`;
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
          { name: 'AC Sciences Project', extensions: ['lab'] },
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

  async function openProject() {
    if (!window.electronAPI) return;

    const { canceled, filePaths } = await window.electronAPI.showOpenDialog({
      title: 'Open Project',
      filters: [
        { name: 'AC Sciences Project', extensions: ['lab'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (canceled || !filePaths || filePaths.length === 0) return;

    const filePath = filePaths[0];
    const result = await window.electronAPI.readFile(filePath);
    if (!result.success) {
      alert('Failed to open: ' + result.error);
      return;
    }

    try {
      const data = JSON.parse(result.data);
      projectData = data;
      currentFilePath = filePath;
      isDirty = false;
      applyProject();
      setTitle(projectData.name || 'Untitled');
    } catch (e) {
      alert('Invalid project file: ' + e.message);
    }
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

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveProject(e.shiftKey);
    }
  });

  // ─── Sheet Change Listener ────────────────────────────────────────────────────

  document.addEventListener('sheet-data-changed', () => {
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
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────────

  // Start with a fresh project
  newProject();

  // Add a couple of default columns to get the user started
  sheet.addColumn();
  sheet.addColumn();
  // Give them reasonable default names
  if (sheet._columns.length >= 2) {
    sheet._columns[0].name = 'Time';
    sheet._columns[0].unit = 's';
    sheet._columns[1].name = 'Value';
    sheet._columns[1].unit = '';
    sheet._render();
  }
  // Add 5 empty rows
  for (let i = 0; i < 5; i++) sheet.addRow();

  // Reset dirty flag after bootstrap
  isDirty = false;
  setTitle('Untitled');

  // Make sheet accessible globally for CSV export (used by exportCSV)
  window._sheet = sheet;

})();
