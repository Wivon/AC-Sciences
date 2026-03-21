/**
 * Conversions — standalone unit conversion workspace.
 * Supports many physical and chemical unit families.
 */

class Conversions {
  constructor() {
    this._categoryList = document.getElementById('conv-category-list');
    this._categoryDescription = document.getElementById('conv-category-description');
    this._inputFrom = document.getElementById('conv-input-from');
    this._inputTo = document.getElementById('conv-input-to');
    this._unitFrom = document.getElementById('conv-unit-from');
    this._unitTo = document.getElementById('conv-unit-to');
    this._swapBtn = document.getElementById('conv-swap-btn');
    this._formula = document.getElementById('conv-formula');

    this._categories = this._buildCategories();
    this._activeCategoryId = this._categories.length ? this._categories[0].id : '';
    this._lastEdited = 'from'; // from | to

    if (!this._categoryList || !this._inputFrom || !this._inputTo || !this._unitFrom || !this._unitTo || !this._swapBtn) {
      return;
    }

    this._renderCategoryButtons();
    this._bindEvents();
    this._setCategory(this._activeCategoryId, { emitChange: false });
  }

  _buildCategories() {
    const avogadro = 6.02214076e23;
    return [
      {
        id: 'length',
        label: 'Distances',
        description: 'Longueur, distance et echelles.',
        units: [
          { id: 'm', name: 'Metre', symbol: 'm', factor: 1 },
          { id: 'km', name: 'Kilometre', symbol: 'km', factor: 1000 },
          { id: 'cm', name: 'Centimetre', symbol: 'cm', factor: 0.01 },
          { id: 'mm', name: 'Millimetre', symbol: 'mm', factor: 0.001 },
          { id: 'um', name: 'Micrometre', symbol: 'um', factor: 1e-6 },
          { id: 'nm', name: 'Nanometre', symbol: 'nm', factor: 1e-9 },
          { id: 'in', name: 'Inch', symbol: 'in', factor: 0.0254 },
          { id: 'ft', name: 'Foot', symbol: 'ft', factor: 0.3048 },
          { id: 'yd', name: 'Yard', symbol: 'yd', factor: 0.9144 },
          { id: 'mi', name: 'Mile', symbol: 'mi', factor: 1609.344 },
          { id: 'nmi', name: 'Mile nautique', symbol: 'nmi', factor: 1852 }
        ]
      },
      {
        id: 'time',
        label: 'Temps',
        description: 'Durees et periodes.',
        units: [
          { id: 's', name: 'Seconde', symbol: 's', factor: 1 },
          { id: 'ms', name: 'Milliseconde', symbol: 'ms', factor: 1e-3 },
          { id: 'us', name: 'Microseconde', symbol: 'us', factor: 1e-6 },
          { id: 'min', name: 'Minute', symbol: 'min', factor: 60 },
          { id: 'h', name: 'Heure', symbol: 'h', factor: 3600 },
          { id: 'day', name: 'Jour', symbol: 'j', factor: 86400 },
          { id: 'week', name: 'Semaine', symbol: 'sem', factor: 604800 },
          { id: 'year', name: 'Annee', symbol: 'a', factor: 31557600 }
        ]
      },
      {
        id: 'speed',
        label: 'Vitesses',
        description: 'Vitesses lineaires usuelles.',
        units: [
          { id: 'mps', name: 'Metre par seconde', symbol: 'm/s', factor: 1 },
          { id: 'kmh', name: 'Kilometre par heure', symbol: 'km/h', factor: 0.2777777777778 },
          { id: 'mph', name: 'Mile par heure', symbol: 'mph', factor: 0.44704 },
          { id: 'knot', name: 'Noeud', symbol: 'kn', factor: 0.5144444444444 },
          { id: 'ftps', name: 'Foot par seconde', symbol: 'ft/s', factor: 0.3048 }
        ]
      },
      {
        id: 'mass',
        label: 'Masses',
        description: 'Masse et quantite de matiere inerte.',
        units: [
          { id: 'kg', name: 'Kilogramme', symbol: 'kg', factor: 1 },
          { id: 'g', name: 'Gramme', symbol: 'g', factor: 1e-3 },
          { id: 'mg', name: 'Milligramme', symbol: 'mg', factor: 1e-6 },
          { id: 'ug', name: 'Microgramme', symbol: 'ug', factor: 1e-9 },
          { id: 't', name: 'Tonne', symbol: 't', factor: 1000 },
          { id: 'lb', name: 'Pound', symbol: 'lb', factor: 0.45359237 },
          { id: 'oz', name: 'Ounce', symbol: 'oz', factor: 0.028349523125 }
        ]
      },
      {
        id: 'temperature',
        label: 'Temperatures',
        description: 'Conversions avec decalage (C, F, K).',
        units: [
          { id: 'c', name: 'Celsius', symbol: 'deg C', toBase: (v) => v + 273.15, fromBase: (k) => k - 273.15 },
          { id: 'f', name: 'Fahrenheit', symbol: 'deg F', toBase: (v) => (v + 459.67) * 5 / 9, fromBase: (k) => k * 9 / 5 - 459.67 },
          { id: 'k', name: 'Kelvin', symbol: 'K', toBase: (v) => v, fromBase: (k) => k }
        ]
      },
      {
        id: 'pressure',
        label: 'Pressions',
        description: 'Pression, vide et statique des fluides.',
        units: [
          { id: 'pa', name: 'Pascal', symbol: 'Pa', factor: 1 },
          { id: 'kpa', name: 'Kilopascal', symbol: 'kPa', factor: 1e3 },
          { id: 'mpa', name: 'Megapascal', symbol: 'MPa', factor: 1e6 },
          { id: 'bar', name: 'Bar', symbol: 'bar', factor: 1e5 },
          { id: 'mbar', name: 'Millibar', symbol: 'mbar', factor: 100 },
          { id: 'atm', name: 'Atmosphere', symbol: 'atm', factor: 101325 },
          { id: 'torr', name: 'Torr', symbol: 'Torr', factor: 133.3223684211 },
          { id: 'psi', name: 'Pound per square inch', symbol: 'psi', factor: 6894.757293168 }
        ]
      },
      {
        id: 'energy',
        label: 'Energies',
        description: 'Travail, chaleur et energie stockee.',
        units: [
          { id: 'j', name: 'Joule', symbol: 'J', factor: 1 },
          { id: 'kj', name: 'Kilojoule', symbol: 'kJ', factor: 1e3 },
          { id: 'mj', name: 'Megajoule', symbol: 'MJ', factor: 1e6 },
          { id: 'cal', name: 'Calorie', symbol: 'cal', factor: 4.184 },
          { id: 'kcal', name: 'Kilocalorie', symbol: 'kcal', factor: 4184 },
          { id: 'wh', name: 'Watt-heure', symbol: 'Wh', factor: 3600 },
          { id: 'kwh', name: 'Kilowatt-heure', symbol: 'kWh', factor: 3.6e6 },
          { id: 'ev', name: 'Electron-volt', symbol: 'eV', factor: 1.602176634e-19 }
        ]
      },
      {
        id: 'power',
        label: 'Puissances',
        description: 'Debit d energie dans le temps.',
        units: [
          { id: 'w', name: 'Watt', symbol: 'W', factor: 1 },
          { id: 'kw', name: 'Kilowatt', symbol: 'kW', factor: 1e3 },
          { id: 'mw', name: 'Megawatt', symbol: 'MW', factor: 1e6 },
          { id: 'mw_small', name: 'Milliwatt', symbol: 'mW', factor: 1e-3 },
          { id: 'hp', name: 'Horsepower', symbol: 'hp', factor: 745.6998715823 }
        ]
      },
      {
        id: 'area',
        label: 'Surfaces',
        description: 'Aires, parcelles, sections.',
        units: [
          { id: 'm2', name: 'Metre carre', symbol: 'm2', factor: 1 },
          { id: 'cm2', name: 'Centimetre carre', symbol: 'cm2', factor: 1e-4 },
          { id: 'mm2', name: 'Millimetre carre', symbol: 'mm2', factor: 1e-6 },
          { id: 'km2', name: 'Kilometre carre', symbol: 'km2', factor: 1e6 },
          { id: 'ha', name: 'Hectare', symbol: 'ha', factor: 1e4 },
          { id: 'in2', name: 'Inch carre', symbol: 'in2', factor: 0.00064516 },
          { id: 'ft2', name: 'Foot carre', symbol: 'ft2', factor: 0.09290304 },
          { id: 'acre', name: 'Acre', symbol: 'acre', factor: 4046.8564224 }
        ]
      },
      {
        id: 'volume',
        label: 'Volumes',
        description: 'Capacites et volumes geometriques.',
        units: [
          { id: 'm3', name: 'Metre cube', symbol: 'm3', factor: 1 },
          { id: 'l', name: 'Litre', symbol: 'L', factor: 1e-3 },
          { id: 'ml', name: 'Millilitre', symbol: 'mL', factor: 1e-6 },
          { id: 'cm3', name: 'Centimetre cube', symbol: 'cm3', factor: 1e-6 },
          { id: 'ft3', name: 'Foot cube', symbol: 'ft3', factor: 0.028316846592 },
          { id: 'in3', name: 'Inch cube', symbol: 'in3', factor: 1.6387064e-5 },
          { id: 'gal_us', name: 'Gallon US', symbol: 'gal US', factor: 0.003785411784 },
          { id: 'qt_us', name: 'Quart US', symbol: 'qt US', factor: 0.000946352946 }
        ]
      },
      {
        id: 'force',
        label: 'Forces',
        description: 'Force mecanique et dynamique.',
        units: [
          { id: 'n', name: 'Newton', symbol: 'N', factor: 1 },
          { id: 'kn', name: 'Kilonewton', symbol: 'kN', factor: 1e3 },
          { id: 'dyn', name: 'Dyne', symbol: 'dyn', factor: 1e-5 },
          { id: 'lbf', name: 'Pound-force', symbol: 'lbf', factor: 4.4482216152605 }
        ]
      },
      {
        id: 'frequency',
        label: 'Frequences',
        description: 'Frequences et vitesses de rotation.',
        units: [
          { id: 'hz', name: 'Hertz', symbol: 'Hz', factor: 1 },
          { id: 'khz', name: 'Kilohertz', symbol: 'kHz', factor: 1e3 },
          { id: 'mhz', name: 'Megahertz', symbol: 'MHz', factor: 1e6 },
          { id: 'ghz', name: 'Gigahertz', symbol: 'GHz', factor: 1e9 },
          { id: 'rpm', name: 'Tour par minute', symbol: 'rpm', factor: 1 / 60 }
        ]
      },
      {
        id: 'amount',
        label: 'Chimie: quantite',
        description: 'Quantite de matiere (mol) et entites.',
        units: [
          { id: 'mol', name: 'Mole', symbol: 'mol', factor: 1 },
          { id: 'mmol', name: 'Millimole', symbol: 'mmol', factor: 1e-3 },
          { id: 'umol', name: 'Micromole', symbol: 'umol', factor: 1e-6 },
          { id: 'kmol', name: 'Kilomole', symbol: 'kmol', factor: 1e3 },
          { id: 'molecule', name: 'Molecule', symbol: 'molecule', factor: 1 / avogadro }
        ]
      },
      {
        id: 'molar_concentration',
        label: 'Chimie: concentration molaire',
        description: 'Concentrations exprimees en quantite de matiere.',
        units: [
          { id: 'mol_m3', name: 'Mole par m3', symbol: 'mol/m3', factor: 1 },
          { id: 'mol_l', name: 'Mole par litre', symbol: 'mol/L', factor: 1000 },
          { id: 'mmol_l', name: 'Millimole par litre', symbol: 'mmol/L', factor: 1 },
          { id: 'umol_l', name: 'Micromole par litre', symbol: 'umol/L', factor: 1e-3 }
        ]
      },
      {
        id: 'mass_concentration',
        label: 'Chimie: concentration massique',
        description: 'Concentrations en masse par volume.',
        units: [
          { id: 'kg_m3', name: 'Kilogramme par m3', symbol: 'kg/m3', factor: 1 },
          { id: 'g_l', name: 'Gramme par litre', symbol: 'g/L', factor: 1 },
          { id: 'mg_l', name: 'Milligramme par litre', symbol: 'mg/L', factor: 1e-3 },
          { id: 'ug_l', name: 'Microgramme par litre', symbol: 'ug/L', factor: 1e-6 },
          { id: 'g_m3', name: 'Gramme par m3', symbol: 'g/m3', factor: 1e-3 },
          { id: 'mg_m3', name: 'Milligramme par m3', symbol: 'mg/m3', factor: 1e-6 }
        ]
      }
    ];
  }

  _bindEvents() {
    this._inputFrom.addEventListener('input', () => {
      this._lastEdited = 'from';
      this._recomputeFromSource();
      this._emitChange();
    });
    this._inputTo.addEventListener('input', () => {
      this._lastEdited = 'to';
      this._recomputeFromTarget();
      this._emitChange();
    });
    this._unitFrom.addEventListener('change', () => {
      this._recomputeActiveSide();
      this._emitChange();
    });
    this._unitTo.addEventListener('change', () => {
      this._recomputeActiveSide();
      this._emitChange();
    });
    this._swapBtn.addEventListener('click', () => {
      const fromUnit = this._unitFrom.value;
      const toUnit = this._unitTo.value;
      const fromValue = this._inputFrom.value;
      const toValue = this._inputTo.value;
      this._unitFrom.value = toUnit;
      this._unitTo.value = fromUnit;
      this._inputFrom.value = toValue || fromValue;
      this._inputTo.value = fromValue;
      this._lastEdited = 'from';
      this._recomputeFromSource();
      this._emitChange();
    });
  }

  _renderCategoryButtons() {
    this._categoryList.innerHTML = '';
    this._categories.forEach((category) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'conv-cat-btn' + (category.id === this._activeCategoryId ? ' selected' : '');
      btn.textContent = category.label;
      btn.dataset.categoryId = category.id;
      btn.addEventListener('click', () => this._setCategory(category.id, { emitChange: true }));
      this._categoryList.appendChild(btn);
    });
  }

  _setCategory(categoryId, { emitChange = true } = {}) {
    const category = this._getCategory(categoryId);
    if (!category) return;

    const prevFrom = this._unitFrom.value;
    const prevTo = this._unitTo.value;

    this._activeCategoryId = category.id;
    this._renderCategoryButtons();
    this._populateUnitSelects(category, prevFrom, prevTo);
    if (this._categoryDescription) {
      this._categoryDescription.textContent = category.description;
    }
    this._recomputeActiveSide();
    if (emitChange) this._emitChange();
  }

  _populateUnitSelects(category, preferredFrom, preferredTo) {
    this._unitFrom.innerHTML = '';
    this._unitTo.innerHTML = '';
    category.units.forEach((unit) => {
      const label = `${unit.name} (${unit.symbol})`;
      const optFrom = document.createElement('option');
      optFrom.value = unit.id;
      optFrom.textContent = label;
      this._unitFrom.appendChild(optFrom);

      const optTo = document.createElement('option');
      optTo.value = unit.id;
      optTo.textContent = label;
      this._unitTo.appendChild(optTo);
    });

    const unitIds = new Set(category.units.map(u => u.id));
    const defaultFrom = unitIds.has(preferredFrom) ? preferredFrom : category.units[0].id;
    let defaultTo = unitIds.has(preferredTo) ? preferredTo : (category.units[1] ? category.units[1].id : category.units[0].id);
    if (defaultTo === defaultFrom && category.units[1]) defaultTo = category.units[1].id;

    this._unitFrom.value = defaultFrom;
    this._unitTo.value = defaultTo;
  }

  _getCategory(categoryId = this._activeCategoryId) {
    return this._categories.find(c => c.id === categoryId) || null;
  }

  _getUnit(category, unitId) {
    if (!category) return null;
    return category.units.find(u => u.id === unitId) || null;
  }

  _parseNumber(raw) {
    const text = String(raw || '').trim().replace(',', '.');
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  _formatNumber(value) {
    if (!Number.isFinite(value)) return '';
    const abs = Math.abs(value);
    if (abs >= 1e7 || (abs > 0 && abs < 1e-6)) return value.toExponential(8);
    return String(parseFloat(value.toPrecision(12)));
  }

  _toBase(category, unit, value) {
    if (!category || !unit || !Number.isFinite(value)) return null;
    if (typeof unit.toBase === 'function') return unit.toBase(value);
    if (!Number.isFinite(unit.factor)) return null;
    return value * unit.factor;
  }

  _fromBase(category, unit, baseValue) {
    if (!category || !unit || !Number.isFinite(baseValue)) return null;
    if (typeof unit.fromBase === 'function') return unit.fromBase(baseValue);
    if (!Number.isFinite(unit.factor) || Math.abs(unit.factor) < 1e-20) return null;
    return baseValue / unit.factor;
  }

  _convertValue(value, fromUnitId, toUnitId) {
    const category = this._getCategory();
    const fromUnit = this._getUnit(category, fromUnitId);
    const toUnit = this._getUnit(category, toUnitId);
    if (!category || !fromUnit || !toUnit || !Number.isFinite(value)) return null;
    const baseValue = this._toBase(category, fromUnit, value);
    if (!Number.isFinite(baseValue)) return null;
    const converted = this._fromBase(category, toUnit, baseValue);
    return Number.isFinite(converted) ? converted : null;
  }

  _recomputeActiveSide() {
    if (this._lastEdited === 'to') this._recomputeFromTarget();
    else this._recomputeFromSource();
  }

  _recomputeFromSource() {
    const sourceValue = this._parseNumber(this._inputFrom.value);
    if (sourceValue === null) {
      this._inputTo.value = '';
      this._updateFormula();
      return;
    }
    const converted = this._convertValue(sourceValue, this._unitFrom.value, this._unitTo.value);
    this._inputTo.value = converted === null ? '' : this._formatNumber(converted);
    this._updateFormula();
  }

  _recomputeFromTarget() {
    const targetValue = this._parseNumber(this._inputTo.value);
    if (targetValue === null) {
      this._inputFrom.value = '';
      this._updateFormula();
      return;
    }
    const converted = this._convertValue(targetValue, this._unitTo.value, this._unitFrom.value);
    this._inputFrom.value = converted === null ? '' : this._formatNumber(converted);
    this._updateFormula();
  }

  _updateFormula() {
    if (!this._formula) return;
    const category = this._getCategory();
    const fromUnit = this._getUnit(category, this._unitFrom.value);
    const toUnit = this._getUnit(category, this._unitTo.value);
    if (!category || !fromUnit || !toUnit) {
      this._formula.textContent = '—';
      return;
    }
    const one = this._convertValue(1, fromUnit.id, toUnit.id);
    if (one === null) {
      this._formula.textContent = 'Conversion indisponible pour cette combinaison.';
      return;
    }
    this._formula.textContent = `1 ${fromUnit.symbol} = ${this._formatNumber(one)} ${toUnit.symbol}`;
  }

  loadFromData(data = {}) {
    const categoryId = data && data.categoryId ? String(data.categoryId) : this._activeCategoryId;
    this._setCategory(categoryId, { emitChange: false });

    const category = this._getCategory();
    const unitIds = new Set(category.units.map(u => u.id));
    if (data && unitIds.has(data.fromUnitId)) this._unitFrom.value = data.fromUnitId;
    if (data && unitIds.has(data.toUnitId)) this._unitTo.value = data.toUnitId;

    if (data && (data.lastEdited === 'to' || data.lastEdited === 'from')) this._lastEdited = data.lastEdited;
    if (data && data.fromValue !== undefined) this._inputFrom.value = String(data.fromValue);
    if (data && data.toValue !== undefined) this._inputTo.value = String(data.toValue);

    this._recomputeActiveSide();
  }

  toData() {
    return {
      categoryId: this._activeCategoryId,
      fromUnitId: this._unitFrom.value,
      toUnitId: this._unitTo.value,
      fromValue: this._inputFrom.value,
      toValue: this._inputTo.value,
      lastEdited: this._lastEdited
    };
  }

  _emitChange() {
    document.dispatchEvent(new CustomEvent('conversions-data-changed', { detail: this.toData() }));
  }
}
