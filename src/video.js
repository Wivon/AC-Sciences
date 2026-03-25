/**
 * VideoTracker — chronophotography workspace for manual frame-by-frame tracking.
 * Workflow: import video, set origin, set scale, pick start frame, click tracked object.
 */

class VideoTracker {
  constructor(sheet) {
    this._sheet = sheet;
    this._debug = true;

    this._fileInput = document.getElementById('video-file-input');
    this._meta = document.getElementById('video-meta');
    this._setOriginBtn = document.getElementById('video-set-origin-btn');
    this._originDisplay = document.getElementById('video-origin-display');
    this._setScaleBtn = document.getElementById('video-set-scale-btn');
    this._scaleInput = document.getElementById('video-scale-input');
    this._scaleDisplay = document.getElementById('video-scale-display');
    this._startFrameInput = document.getElementById('video-start-frame-input');
    this._startFrameValue = document.getElementById('video-start-frame-value');
    this._frameFirstBtn = document.getElementById('video-frame-first-btn');
    this._framePrevBtn = document.getElementById('video-frame-prev-btn');
    this._frameNextBtn = document.getElementById('video-frame-next-btn');
    this._frameLastBtn = document.getElementById('video-frame-last-btn');
    this._trackBtn = document.getElementById('video-track-btn');
    this._undoBtn = document.getElementById('video-undo-btn');
    this._resetBtn = document.getElementById('video-reset-btn');
    this._trackStatus = document.getElementById('video-track-status');
    this._currentFrameEl = document.getElementById('video-current-frame');
    this._currentTimeEl = document.getElementById('video-current-time');
    this._canvasWrap = document.getElementById('video-canvas-wrap');
    this._canvas = document.getElementById('video-canvas');
    this._placeholder = document.getElementById('video-placeholder');
    this._video = document.getElementById('video-element');

    this._ctx = this._canvas.getContext('2d');

    this._videoObjectUrl = null;
    this._transcodedOutputPath = '';
    this._sourceKind = 'none'; // none | original | transcoded
    this._inputVideoPath = '';
    this._aviFallbackTried = false;
    this._videoName = '';
    this._videoLoaded = false;
    this._duration = 0;
    this._fps = 30;
    this._fpsEstimated = false;
    this._frameCount = 1;
    this._currentFrame = 0;
    this._startFrame = 0;
    this._busySeeking = false;
    this._startFrameSeekToken = 0;

    this._originPx = null; // {x, y} in video pixels
    this._scale = null;    // {from, to, pixels, meters, metersPerPx}
    this._samples = [];    // [{frame, time, x, y, videoX, videoY}]

    this._mode = 'idle';   // idle | set-origin | set-scale | tracking
    this._scaleDrag = null;
    this._skipNextClick = false;
    this._hoverVideoPoint = null;

    this._bindEvents();
    this._resizeCanvas();
    this._updateStatusUI();
    this._render();
  }

  onShown() {
    this._resizeCanvas();
    this._render();
  }

  toData() {
    return {
      startFrame: this._startFrame,
      fps: this._fps,
      fpsEstimated: this._fpsEstimated,
      originPx: this._originPx ? { x: this._originPx.x, y: this._originPx.y } : null,
      scale: this._scale ? {
        from: this._scale.from,
        to: this._scale.to,
        pixels: this._scale.pixels,
        meters: this._scale.meters,
        metersPerPx: this._scale.metersPerPx
      } : null,
      samples: this._samples.map(s => ({
        frame: s.frame,
        time: s.time,
        x: s.x,
        y: s.y,
        videoX: s.videoX,
        videoY: s.videoY
      }))
    };
  }

  loadFromData(data) {
    const safe = data && typeof data === 'object' ? data : {};
    this._startFrame = this._clampFrame(parseInt(safe.startFrame, 10) || 0);
    this._startFrameInput.value = String(this._startFrame);
    this._updateStartFrameDisplay();
    this._fps = (typeof safe.fps === 'number' && isFinite(safe.fps) && safe.fps > 0) ? safe.fps : this._fps;
    this._fpsEstimated = !!safe.fpsEstimated;

    this._originPx = (safe.originPx && typeof safe.originPx.x === 'number' && typeof safe.originPx.y === 'number')
      ? { x: safe.originPx.x, y: safe.originPx.y }
      : null;

    if (safe.scale && typeof safe.scale === 'object'
        && typeof safe.scale.pixels === 'number' && safe.scale.pixels > 0
        && typeof safe.scale.metersPerPx === 'number' && safe.scale.metersPerPx > 0) {
      this._scale = {
        from: safe.scale.from || null,
        to: safe.scale.to || null,
        pixels: safe.scale.pixels,
        meters: safe.scale.meters || (safe.scale.pixels * safe.scale.metersPerPx),
        metersPerPx: safe.scale.metersPerPx
      };
    } else {
      this._scale = null;
    }

    this._samples = Array.isArray(safe.samples)
      ? safe.samples
        .filter(s => s && typeof s.frame === 'number' && typeof s.videoX === 'number' && typeof s.videoY === 'number')
        .map(s => ({
          frame: s.frame,
          time: typeof s.time === 'number' ? s.time : 0,
          x: typeof s.x === 'number' ? s.x : 0,
          y: typeof s.y === 'number' ? s.y : 0,
          videoX: s.videoX,
          videoY: s.videoY
        }))
        .sort((a, b) => a.frame - b.frame)
      : [];

    this._updateStatusUI();
    this._render();
  }

  // ─── Event Wiring ───────────────────────────────────────────────────────────

  _bindEvents() {
    this._fileInput.addEventListener('change', () => this._onFileSelected());
    this._video.addEventListener('loadedmetadata', () => this._onVideoMetadataLoaded());
    this._video.addEventListener('loadstart', () => this._debugState('video:loadstart'));
    this._video.addEventListener('loadeddata', () => this._debugState('video:loadeddata'));
    this._video.addEventListener('canplay', () => this._debugState('video:canplay'));
    this._video.addEventListener('stalled', () => this._debugState('video:stalled'));
    this._video.addEventListener('suspend', () => this._debugState('video:suspend'));
    this._video.addEventListener('abort', () => this._debugState('video:abort'));
    this._video.addEventListener('emptied', () => this._debugState('video:emptied'));
    this._video.addEventListener('error', () => this._onVideoError());

    this._setOriginBtn.addEventListener('click', () => this._toggleMode('set-origin'));
    this._setScaleBtn.addEventListener('click', () => this._toggleMode('set-scale'));
    this._scaleInput.addEventListener('input', () => this._onScaleInputChanged());
    this._scaleInput.addEventListener('change', () => this._onScaleInputChanged());
    this._trackBtn.addEventListener('click', () => this._toggleTracking());
    this._startFrameInput.addEventListener('input', () => this._goToStartFrame());
    this._startFrameInput.addEventListener('change', () => this._goToStartFrame());
    this._frameFirstBtn.addEventListener('click', () => this._moveStartFrame('first'));
    this._framePrevBtn.addEventListener('click', () => this._moveStartFrame(-1));
    this._frameNextBtn.addEventListener('click', () => this._moveStartFrame(1));
    this._frameLastBtn.addEventListener('click', () => this._moveStartFrame('last'));
    this._undoBtn.addEventListener('click', () => this._undoLastSample());
    this._resetBtn.addEventListener('click', () => this._resetTracking());

    this._canvas.addEventListener('mousedown', (e) => this._onCanvasMouseDown(e));
    this._canvas.addEventListener('mousemove', (e) => this._onCanvasMouseMove(e));
    this._canvas.addEventListener('mouseup', (e) => this._onCanvasMouseUp(e));
    this._canvas.addEventListener('mouseleave', () => this._onCanvasMouseLeave());
    this._canvas.addEventListener('click', (e) => this._onCanvasClick(e));

    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this._render();
    });
    window.addEventListener('beforeunload', () => {
      if (this._videoObjectUrl) URL.revokeObjectURL(this._videoObjectUrl);
    });
  }

  // ─── Video Import ───────────────────────────────────────────────────────────

  async _onVideoError() {
    this._debugState('video:error');
    const err = this._mediaErrorInfo();
    const isAvi = /\.avi$/i.test(this._videoName);
    const canFallback = isAvi
      && !this._aviFallbackTried
      && this._sourceKind === 'original'
      && !!this._inputVideoPath
      && !!(window.electronAPI && typeof window.electronAPI.transcodeVideo === 'function');

    if (canFallback) {
      await this._tryAviFallbackTranscode();
      return;
    }

    let hint = '';
    if (isAvi && err.code === 4) {
      hint = '\nCe codec AVI n\'est pas decode par Chromium/Electron.';
    }
    alert(`Impossible de lire cette vidéo (code ${err.code} - ${err.reason}).${hint}\nVoir la console pour le détail.`);
    this._resetVideo(false);
  }

  async _tryAviFallbackTranscode() {
    this._aviFallbackTried = true;
    this._meta.innerHTML = '<div>AVI non lisible directement. Conversion en MP4 en cours…</div>';
    this._debugLog('video:fallback-transcode:start', {
      inputPath: this._inputVideoPath
    });

    try {
      const result = await window.electronAPI.transcodeVideo(this._inputVideoPath);
      this._debugLog('video:fallback-transcode:result', result);

      if (!result || !result.success || !result.outputUrl) {
        const reason = result && result.error ? result.error : 'unknown';
        const details = result && result.stderr ? `\n${result.stderr}` : '';
        const extra = reason === 'ffmpeg-unavailable'
          ? '\nLe binaire ffmpeg n\'est pas disponible dans l\'application.'
          : (reason === 'ffmpeg-missing' && result && result.path
            ? `\nChemin ffmpeg introuvable: ${result.path}`
            : '');
        alert(`Conversion AVI -> MP4 impossible (${reason}).${extra}${details ? '\nVoir console pour les détails.' : ''}`);
        if (result && result.diagnostics) {
          console.warn('[VideoTracker] ffmpeg diagnostics', result.diagnostics);
        }
        this._resetVideo(false);
        return;
      }

      if (this._videoObjectUrl) {
        URL.revokeObjectURL(this._videoObjectUrl);
        this._videoObjectUrl = null;
      }

      this._sourceKind = 'transcoded';
      this._transcodedOutputPath = result.outputPath || '';
      this._video.src = result.outputUrl;
      this._video.load();
      this._debugState('video:fallback-transcode:load-requested', {
        outputPath: this._transcodedOutputPath,
        outputUrl: result.outputUrl
      });
    } catch (e) {
      this._debugLog('video:fallback-transcode:error', {
        message: e && e.message ? e.message : String(e)
      });
      alert('Conversion AVI -> MP4 impossible (erreur inattendue). Voir console.');
      this._resetVideo(false);
    }
  }

  _onFileSelected() {
    const file = this._fileInput.files && this._fileInput.files[0];
    if (!file) return;

    const name = file.name || '';
    const filePath = (window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
      ? (window.electronAPI.getPathForFile(file) || '')
      : (file.path || '');
    const canPlayType = {
      mp4: this._video.canPlayType('video/mp4'),
      mp4_h264: this._video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
      avi: this._video.canPlayType('video/x-msvideo'),
      avi_alt: this._video.canPlayType('video/avi')
    };
    this._debugLog('video:file-selected', {
      name: file.name,
      type: file.type || '(vide)',
      sizeBytes: file.size,
      path: filePath || '(not-exposed)',
      canPlayType
    });
    if (/\.avi$/i.test(name) && !filePath) {
      console.warn('[VideoTracker] Aucun chemin local detecte pour ce fichier AVI. La conversion de secours ffmpeg ne pourra pas demarrer.');
    }
    if (!/\.(mp4|avi)$/i.test(name)) {
      alert('Formats supportés: .mp4 et .avi');
      this._fileInput.value = '';
      return;
    }
    if (/\.avi$/i.test(name) && !canPlayType.avi && !canPlayType.avi_alt) {
      console.warn('[VideoTracker] AVI detecte mais non annonce comme supporte par Chromium canPlayType().');
    }

    this._resetVideo(true);
    this._videoName = name;
    this._inputVideoPath = filePath;
    this._aviFallbackTried = false;
    this._sourceKind = 'original';
    this._videoObjectUrl = URL.createObjectURL(file);
    this._video.src = this._videoObjectUrl;
    this._video.load();
    this._debugState('video:load-requested', {
      objectUrlPrefix: this._videoObjectUrl.slice(0, 32) + '...'
    });
    this._meta.innerHTML = '<div>Chargement des métadonnées…</div>';
    this._placeholder.classList.remove('hidden');
  }

  async _onVideoMetadataLoaded() {
    this._debugState('video:loadedmetadata');
    this._videoLoaded = true;
    this._duration = isFinite(this._video.duration) ? this._video.duration : 0;
    this._fps = 30;
    this._fpsEstimated = false;

    const estimatedFps = await this._estimateFps();
    if (estimatedFps && estimatedFps > 1 && estimatedFps < 240) {
      this._fps = estimatedFps;
      this._fpsEstimated = true;
    }

    this._frameCount = Math.max(1, Math.round(this._duration * this._fps));
    this._startFrameInput.min = '0';
    this._startFrameInput.max = String(Math.max(0, this._frameCount - 1));
    await this._goToStartFrame(false);

    this._updateMetadataUI();
    this._updateStatusUI();
    this._placeholder.classList.add('hidden');
    this._emitChange();
  }

  _resetVideo(keepCalibration) {
    this._videoLoaded = false;
    this._duration = 0;
    this._frameCount = 1;
    this._currentFrame = 0;
    this._busySeeking = false;
    this._startFrameSeekToken++;
    this._setMode('idle');

    if (!keepCalibration) {
      this._originPx = null;
      this._scale = null;
      this._samples = [];
    }

    if (this._videoObjectUrl) {
      URL.revokeObjectURL(this._videoObjectUrl);
      this._videoObjectUrl = null;
    }
    this._sourceKind = 'none';
    this._inputVideoPath = '';
    this._aviFallbackTried = false;
    this._transcodedOutputPath = '';
    this._videoName = '';
    this._startFrame = 0;
    this._startFrameInput.min = '0';
    this._startFrameInput.max = '0';
    this._startFrameInput.value = '0';
    this._updateStartFrameDisplay();
    this._video.removeAttribute('src');
    this._video.load();
    this._updateMetadataUI();
    this._updateStatusUI();
    this._render();
  }

  _updateMetadataUI() {
    const durationStr = this._duration > 0 ? `${this._duration.toFixed(3)} s` : '—';
    const fpsStr = this._fps ? `${this._fps.toFixed(3)}${this._fpsEstimated ? ' (estimé)' : ''}` : '—';
    const resolution = (this._video.videoWidth && this._video.videoHeight)
      ? `${this._video.videoWidth} × ${this._video.videoHeight}`
      : '—';
    const source = this._sourceKind === 'transcoded'
      ? 'AVI converti en MP4'
      : (this._sourceKind === 'original' ? 'Original' : '—');
    const name = this._videoName || '—';
    this._meta.innerHTML = `
      <div>Fichier: ${name}</div>
      <div>Source: ${source}</div>
      <div>Résolution: ${resolution}</div>
      <div>Durée: ${durationStr}</div>
      <div>FPS: ${fpsStr}</div>
    `;
  }

  // ─── Modes & UI ─────────────────────────────────────────────────────────────

  _toggleMode(mode) {
    if (!this._videoLoaded) return;
    this._setMode(this._mode === mode ? 'idle' : mode);
  }

  _setMode(mode) {
    this._mode = mode;
    this._scaleDrag = null;
    this._hoverVideoPoint = null;
    this._setOriginBtn.classList.toggle('active', this._mode === 'set-origin');
    this._setScaleBtn.classList.toggle('active', this._mode === 'set-scale');
    this._trackBtn.classList.toggle('active', this._mode === 'tracking');
    this._trackBtn.textContent = this._mode === 'tracking'
      ? '4. Arrêter le pointage'
      : '4. Démarrer le pointage';
    this._render();
  }

  _updateStartFrameDisplay() {
    if (!this._startFrameValue) return;
    this._startFrameValue.textContent = `Frame de départ: ${this._startFrame}`;
    this._updateFrameNavButtons();
  }

  _updateFrameNavButtons() {
    if (!this._frameFirstBtn || !this._framePrevBtn || !this._frameNextBtn || !this._frameLastBtn) return;
    const maxFrame = Math.max(0, this._frameCount - 1);
    const atStart = this._startFrame <= 0;
    const atEnd = this._startFrame >= maxFrame;
    const disabled = !this._videoLoaded;

    this._frameFirstBtn.disabled = disabled || atStart;
    this._framePrevBtn.disabled = disabled || atStart;
    this._frameNextBtn.disabled = disabled || atEnd;
    this._frameLastBtn.disabled = disabled || atEnd;
  }

  _updateStatusUI() {
    this._originDisplay.textContent = this._originPx
      ? `Origine: (${this._originPx.x.toFixed(1)}, ${this._originPx.y.toFixed(1)}) px`
      : 'Origine: —';

    this._scaleDisplay.textContent = this._scale
      ? `Échelle: ${(this._scale.metersPerPx).toExponential(4)} m/px`
      : 'Échelle: —';

    this._trackStatus.textContent = `Points: ${this._samples.length}`;
    this._currentFrameEl.textContent = this._videoLoaded ? `Frame: ${this._currentFrame}` : 'Frame: —';
    this._currentTimeEl.textContent = this._videoLoaded ? `t: ${this._frameTime(this._currentFrame).toFixed(4)} s` : 't: —';
  }

  // ─── Canvas Interaction ─────────────────────────────────────────────────────

  _onCanvasMouseDown(e) {
    if (!this._videoLoaded) return;
    if (this._mode !== 'set-scale') return;
    const canvasPoint = this._eventToCanvasPoint(e);
    const videoPoint = this._canvasToVideoPoint(canvasPoint);
    if (!videoPoint) return;
    this._scaleDrag = { start: videoPoint, end: videoPoint };
    this._canvas.style.cursor = 'crosshair';
    e.preventDefault();
  }

  _onCanvasMouseMove(e) {
    if (!this._videoLoaded) return;
    if (this._scaleDrag) {
      const videoPoint = this._canvasToVideoPoint(this._eventToCanvasPoint(e));
      if (videoPoint) {
        this._scaleDrag.end = videoPoint;
        this._render();
      }
      return;
    }

    if (this._mode === 'tracking') {
      const videoPoint = this._canvasToVideoPoint(this._eventToCanvasPoint(e));
      this._hoverVideoPoint = videoPoint || null;
      this._render();
    } else {
      this._hoverVideoPoint = null;
    }

    if (this._mode === 'set-origin' || this._mode === 'set-scale' || this._mode === 'tracking') {
      this._canvas.style.cursor = 'crosshair';
    } else {
      this._canvas.style.cursor = 'default';
    }
  }

  _onCanvasMouseUp(e) {
    if (!this._scaleDrag) return;
    const end = this._canvasToVideoPoint(this._eventToCanvasPoint(e));
    if (end) this._scaleDrag.end = end;
    this._finalizeScaleDrag();
    this._skipNextClick = true;
  }

  _onCanvasMouseLeave() {
    if (!this._scaleDrag) this._canvas.style.cursor = 'default';
    if (this._hoverVideoPoint) {
      this._hoverVideoPoint = null;
      this._render();
    }
  }

  async _onCanvasClick(e) {
    if (!this._videoLoaded) return;
    if (this._skipNextClick) {
      this._skipNextClick = false;
      return;
    }

    const videoPoint = this._canvasToVideoPoint(this._eventToCanvasPoint(e));
    if (!videoPoint) return;

    if (this._mode === 'set-origin') {
      this._originPx = videoPoint;
      this._setMode('idle');
      this._updateStatusUI();
      this._emitChange();
      return;
    }

    if (this._mode === 'tracking') {
      await this._recordTrackingPoint(videoPoint);
    }
  }

  _finalizeScaleDrag() {
    if (!this._scaleDrag) return;
    const start = this._scaleDrag.start;
    const end = this._scaleDrag.end;
    this._scaleDrag = null;

    const pixels = this._distance(start, end);
    if (!isFinite(pixels) || pixels < 2) {
      this._render();
      return;
    }

    const parsed = this._parseDistanceInput(this._scaleInput.value);
    if (!parsed) {
      alert('Distance invalide. Exemple: "1 m" ou "25 cm".');
      this._render();
      return;
    }

    this._scale = {
      from: start,
      to: end,
      pixels,
      meters: parsed.meters,
      metersPerPx: parsed.meters / pixels
    };

    this._setMode('idle');
    this._updateStatusUI();
    this._emitChange();
  }

  _onScaleInputChanged() {
    if (!this._scale || !isFinite(this._scale.pixels) || this._scale.pixels <= 0) return;
    const parsed = this._parseDistanceInput(this._scaleInput.value);
    if (!parsed) return;
    this._scale = {
      ...this._scale,
      meters: parsed.meters,
      metersPerPx: parsed.meters / this._scale.pixels
    };
    this._updateStatusUI();
    this._emitChange();
    this._render();
  }

  // ─── Tracking ───────────────────────────────────────────────────────────────

  async _goToStartFrame(emitChange = true) {
    const value = parseInt(this._startFrameInput.value, 10);
    this._startFrame = this._clampFrame(isFinite(value) ? value : 0);
    this._startFrameInput.value = String(this._startFrame);
    this._updateStartFrameDisplay();

    if (!this._videoLoaded) return;

    const seekToken = ++this._startFrameSeekToken;
    await this._seekToFrame(this._startFrame);
    if (seekToken !== this._startFrameSeekToken) return;

    if (emitChange) this._emitChange();
  }

  async _moveStartFrame(direction) {
    const current = parseInt(this._startFrameInput.value, 10);
    const base = isFinite(current) ? current : this._startFrame;
    const maxFrame = Math.max(0, this._frameCount - 1);

    let next = base;
    if (direction === 'first') next = 0;
    else if (direction === 'last') next = maxFrame;
    else next = base + (direction > 0 ? 1 : -1);

    this._startFrameInput.value = String(this._clampFrame(next));
    await this._goToStartFrame();
  }

  _toggleTracking() {
    if (!this._videoLoaded) return;
    if (!this._originPx) {
      alert("Définissez d'abord l'origine (étape 1).");
      return;
    }
    if (!this._scale || !isFinite(this._scale.metersPerPx) || this._scale.metersPerPx <= 0) {
      alert("Définissez d'abord l'échelle (étape 2).");
      return;
    }

    if (this._mode === 'tracking') {
      this._setMode('idle');
    } else {
      this._setMode('tracking');
    }
  }

  async _recordTrackingPoint(videoPoint) {
    if (this._busySeeking) return;
    if (!this._originPx || !this._scale) return;

    const frame = this._currentFrame;
    const x = (videoPoint.x - this._originPx.x) * this._scale.metersPerPx;
    const y = (this._originPx.y - videoPoint.y) * this._scale.metersPerPx;
    const time = (frame - this._startFrame) / this._fps;

    const sample = { frame, time, x, y, videoX: videoPoint.x, videoY: videoPoint.y };
    const idx = this._samples.findIndex(s => s.frame === frame);
    if (idx >= 0) this._samples[idx] = sample;
    else this._samples.push(sample);
    this._samples.sort((a, b) => a.frame - b.frame);

    this._syncSamplesToSheet();
    this._updateStatusUI();
    this._emitChange();
    this._render();

    if (frame < this._frameCount - 1) {
      await this._seekToFrame(frame + 1);
    } else if (this._mode === 'tracking') {
      // Auto-stop pointage when the last frame has been annotated.
      this._setMode('idle');
    }
  }

  _undoLastSample() {
    if (this._samples.length === 0) return;
    this._samples.pop();
    this._syncSamplesToSheet();
    this._updateStatusUI();
    this._emitChange();
    this._render();
  }

  _resetTracking() {
    this._samples = [];
    this._syncSamplesToSheet();
    this._updateStatusUI();
    this._emitChange();
    this._render();
  }

  _syncSamplesToSheet() {
    const sorted = [...this._samples].sort((a, b) => a.frame - b.frame);
    this._sheet.setColumnsByName(
      {
        t: sorted.map(s => s.time),
        X: sorted.map(s => s.x),
        Y: sorted.map(s => s.y)
      },
      { t: 's', X: 'm', Y: 'm' },
      { insertAfterName: 't', reorderAfterAnchor: true }
    );
  }

  // ─── Frame & Timing ─────────────────────────────────────────────────────────

  _frameTime(frame) {
    return frame / this._fps;
  }

  _clampFrame(frame) {
    const max = Math.max(0, this._frameCount - 1);
    return Math.max(0, Math.min(max, frame));
  }

  async _seekToFrame(frame) {
    if (!this._videoLoaded) return;
    const nextFrame = this._clampFrame(frame);
    const t = Math.min(this._duration || 0, this._frameTime(nextFrame));
    this._busySeeking = true;
    await this._seekToTime(t);
    this._busySeeking = false;
    this._currentFrame = nextFrame;
    this._updateStatusUI();
    this._render();
  }

  _seekToTime(seconds) {
    return new Promise(resolve => {
      if (Math.abs((this._video.currentTime || 0) - seconds) < 1e-6) {
        resolve();
        return;
      }
      const onSeeked = () => {
        this._video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      this._video.addEventListener('seeked', onSeeked);
      this._video.currentTime = Math.max(0, Math.min(seconds, this._duration || seconds));
    });
  }

  async _estimateFps() {
    if (typeof this._video.requestVideoFrameCallback !== 'function') return null;
    if (!isFinite(this._duration) || this._duration <= 0) return null;

    const video = this._video;
    const originalTime = video.currentTime || 0;
    const originalRate = video.playbackRate || 1;
    const wasPaused = video.paused;
    const wasMuted = video.muted;

    let timeoutId = null;
    let finished = false;

    return new Promise(resolve => {
      const finish = (fps) => {
        if (finished) return;
        finished = true;
        if (timeoutId) clearTimeout(timeoutId);
        video.pause();
        video.playbackRate = originalRate;
        video.muted = wasMuted;

        if (Math.abs((video.currentTime || 0) - originalTime) < 1e-6) {
          if (!wasPaused) video.play().catch(() => {});
          resolve(fps);
          return;
        }

        const restore = () => {
          video.removeEventListener('seeked', restore);
          if (!wasPaused) video.play().catch(() => {});
          resolve(fps);
        };
        video.addEventListener('seeked', restore);
        video.currentTime = originalTime;
      };

      const mediaTimes = [];
      const onVideoFrame = (_now, metadata) => {
        if (finished) return;
        if (typeof metadata.mediaTime === 'number') {
          mediaTimes.push(metadata.mediaTime);
        }

        if (mediaTimes.length >= 20) {
          const diffs = [];
          for (let i = 1; i < mediaTimes.length; i++) {
            const d = mediaTimes[i] - mediaTimes[i - 1];
            if (d > 0.001 && d < 0.2) diffs.push(d);
          }
          if (diffs.length < 5) {
            finish(null);
            return;
          }
          diffs.sort((a, b) => a - b);
          const median = diffs[Math.floor(diffs.length / 2)];
          const fps = median > 0 ? 1 / median : null;
          finish(fps && isFinite(fps) ? fps : null);
          return;
        }
        video.requestVideoFrameCallback(onVideoFrame);
      };

      const startCapture = async () => {
        video.playbackRate = 1;
        video.muted = true;
        try {
          await video.play();
        } catch (_e) {
          finish(null);
          return;
        }
        video.requestVideoFrameCallback(onVideoFrame);
      };

      timeoutId = setTimeout(() => finish(null), 3000);
      const sampleStart = Math.min(Math.max(0, originalTime), Math.max(0, this._duration - 0.5));
      if (Math.abs((video.currentTime || 0) - sampleStart) < 1e-6) {
        startCapture();
        return;
      }
      const onStartSeek = () => {
        video.removeEventListener('seeked', onStartSeek);
        startCapture();
      };
      video.addEventListener('seeked', onStartSeek);
      video.currentTime = sampleStart;
    });
  }

  // ─── Geometry & Drawing ─────────────────────────────────────────────────────

  _resizeCanvas() {
    const rect = this._canvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
  }

  _eventToCanvasPoint(e) {
    const rect = this._canvas.getBoundingClientRect();
    const sx = this._canvas.width / rect.width;
    const sy = this._canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy
    };
  }

  _getDrawRect() {
    if (!this._videoLoaded || !this._video.videoWidth || !this._video.videoHeight) return null;
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    const vr = this._video.videoWidth / this._video.videoHeight;
    let w = cw;
    let h = w / vr;
    if (h > ch) {
      h = ch;
      w = h * vr;
    }
    return {
      x: (cw - w) / 2,
      y: (ch - h) / 2,
      w,
      h
    };
  }

  _canvasToVideoPoint(canvasPoint) {
    const rect = this._getDrawRect();
    if (!rect) return null;
    if (canvasPoint.x < rect.x || canvasPoint.x > rect.x + rect.w || canvasPoint.y < rect.y || canvasPoint.y > rect.y + rect.h) {
      return null;
    }
    return {
      x: ((canvasPoint.x - rect.x) / rect.w) * this._video.videoWidth,
      y: ((canvasPoint.y - rect.y) / rect.h) * this._video.videoHeight
    };
  }

  _videoToCanvasPoint(videoPoint) {
    const rect = this._getDrawRect();
    if (!rect) return null;
    return {
      x: rect.x + (videoPoint.x / this._video.videoWidth) * rect.w,
      y: rect.y + (videoPoint.y / this._video.videoHeight) * rect.h
    };
  }

  _distance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _parseDistanceInput(rawValue) {
    const raw = String(rawValue || '').trim().replace(/,/g, '.');
    const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]*)$/);
    if (!m) return null;
    const value = parseFloat(m[1]);
    if (!isFinite(value) || value <= 0) return null;
    const unit = (m[2] || 'm').toLowerCase();
    const factors = { m: 1, cm: 0.01, mm: 0.001, km: 1000 };
    const factor = factors[unit] || null;
    if (!factor) return null;
    return { meters: value * factor, unit };
  }

  _drawCross(point, color) {
    const p = this._videoToCanvasPoint(point);
    if (!p) return;
    const ctx = this._ctx;
    const arm = 12;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x - arm, p.y);
    ctx.lineTo(p.x + arm, p.y);
    ctx.moveTo(p.x, p.y - arm);
    ctx.lineTo(p.x, p.y + arm);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawAxes(originVideo) {
    const rect = this._getDrawRect();
    const origin = this._videoToCanvasPoint(originVideo);
    if (!rect || !origin) return;

    const ctx = this._ctx;
    const color = 'rgba(250,204,21,0.9)';
    const xEnd = rect.x + rect.w;
    const yTop = rect.y;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(rect.x, origin.y);
    ctx.lineTo(xEnd, origin.y);
    ctx.moveTo(origin.x, rect.y + rect.h);
    ctx.lineTo(origin.x, yTop);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowheads for +X (right) and +Y (up).
    ctx.beginPath();
    ctx.moveTo(xEnd, origin.y);
    ctx.lineTo(xEnd - 10, origin.y - 5);
    ctx.lineTo(xEnd - 10, origin.y + 5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(origin.x, yTop);
    ctx.lineTo(origin.x - 5, yTop + 10);
    ctx.lineTo(origin.x + 5, yTop + 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawArrow(fromVideo, toVideo, color) {
    const from = this._videoToCanvasPoint(fromVideo);
    const to = this._videoToCanvasPoint(toVideo);
    if (!from || !to) return;

    const ctx = this._ctx;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = 12;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 7), to.y - headLen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 7), to.y - headLen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawMagnifier(videoPoint, rect) {
    if (!videoPoint || !rect) return;
    const zoom = 12;
    const size = 450;
    const srcSize = size / zoom;
    const videoW = this._video.videoWidth || 0;
    const videoH = this._video.videoHeight || 0;
    if (!videoW || !videoH) return;

    let sx = videoPoint.x - srcSize / 2;
    let sy = videoPoint.y - srcSize / 2;
    sx = Math.max(0, Math.min(videoW - srcSize, sx));
    sy = Math.max(0, Math.min(videoH - srcSize, sy));

    let dx = rect.x + rect.w - size - 10;
    let dy = rect.y + 10;
    if (dx < rect.x + 6) dx = rect.x + 6;
    if (dy + size > rect.y + rect.h - 6) dy = rect.y + rect.h - size - 6;

    const ctx = this._ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(dx - 4, dy - 4, size + 8, size + 8);
    ctx.drawImage(this._video, sx, sy, srcSize, srcSize, dx, dy, size, size);
    ctx.strokeStyle = 'rgba(148,163,184,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dx, dy, size, size);

    const cx = dx + size / 2;
    const cy = dy + size / 2;
    ctx.strokeStyle = 'rgba(248,250,252,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.restore();
  }

  _render() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    const rect = this._getDrawRect();
    if (!rect) {
      this._placeholder.classList.remove('hidden');
      this._updateStatusUI();
      return;
    }

    this._placeholder.classList.add('hidden');
    ctx.drawImage(this._video, rect.x, rect.y, rect.w, rect.h);

    if (this._originPx) {
      this._drawAxes(this._originPx);
    }

    // Existing tracked points
    this._samples.forEach((s) => {
      if (s.frame > this._currentFrame) return;
      const p = this._videoToCanvasPoint({ x: s.videoX, y: s.videoY });
      if (!p) return;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(220,38,38,0.92)';
      ctx.arc(p.x, p.y, 6.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });

    if (this._originPx) {
      this._drawCross(this._originPx, 'rgba(250,204,21,0.95)');
    }

    if (this._scale && this._scale.from && this._scale.to) {
      this._drawArrow(this._scale.from, this._scale.to, 'rgba(56,189,248,0.95)');
    }
    if (this._scaleDrag) {
      this._drawArrow(this._scaleDrag.start, this._scaleDrag.end, 'rgba(56,189,248,0.95)');
    }

    // Small legend in top-left corner
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.72)';
    ctx.fillRect(rect.x + 8, rect.y + 8, 250, 56);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.fillText(`Frame ${this._currentFrame} / ${Math.max(0, this._frameCount - 1)}`, rect.x + 14, rect.y + 28);
    ctx.fillText(`t = ${this._frameTime(this._currentFrame).toFixed(4)} s`, rect.x + 14, rect.y + 46);
    ctx.restore();

    if (this._mode === 'tracking' && this._hoverVideoPoint) {
      this._drawMagnifier(this._hoverVideoPoint, rect);
    }

    this._updateStatusUI();
  }

  _emitChange() {
    document.dispatchEvent(new CustomEvent('video-data-changed', { detail: this.toData() }));
  }

  _mediaErrorInfo() {
    const err = this._video && this._video.error ? this._video.error : null;
    if (!err) return { code: 0, reason: 'none' };
    const reasons = {
      1: 'MEDIA_ERR_ABORTED',
      2: 'MEDIA_ERR_NETWORK',
      3: 'MEDIA_ERR_DECODE',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    };
    return {
      code: err.code || 0,
      reason: reasons[err.code] || 'unknown',
      message: err.message || ''
    };
  }

  _debugState(label, extra = {}) {
    if (!this._debug) return;
    const err = this._mediaErrorInfo();
    this._debugLog(label, {
      currentSrc: this._video.currentSrc || '',
      readyState: this._video.readyState,
      readyStateLabel: this._readyStateLabel(this._video.readyState),
      networkState: this._video.networkState,
      networkStateLabel: this._networkStateLabel(this._video.networkState),
      paused: this._video.paused,
      duration: this._video.duration,
      videoWidth: this._video.videoWidth,
      videoHeight: this._video.videoHeight,
      mediaError: err,
      ...extra
    });
  }

  _debugLog(label, payload) {
    if (!this._debug) return;
    console.groupCollapsed(`[VideoTracker] ${label}`);
    console.log(payload);
    console.groupEnd();
  }

  _readyStateLabel(state) {
    const labels = {
      0: 'HAVE_NOTHING',
      1: 'HAVE_METADATA',
      2: 'HAVE_CURRENT_DATA',
      3: 'HAVE_FUTURE_DATA',
      4: 'HAVE_ENOUGH_DATA'
    };
    return labels[state] || 'unknown';
  }

  _networkStateLabel(state) {
    const labels = {
      0: 'NETWORK_EMPTY',
      1: 'NETWORK_IDLE',
      2: 'NETWORK_LOADING',
      3: 'NETWORK_NO_SOURCE'
    };
    return labels[state] || 'unknown';
  }
}
