/**
 * LuminaHDR Client Controller
 * Orchestrates dual presentation engines (Hardware HDR & WebGPU 16-bit float),
 * LuminaSaver glassmorphic HUD overlays, zoom/pan navigation, and split-screen comparison.
 */

import { LuminaLayoutConfig } from './lumina-layout-config.js';
import { DisplayHDRDetector } from './hdr-detector.js';
import { WebGPUHDRRenderer } from './webgpu-hdr.js';

class LuminaHDRApp {
  constructor() {
    this.photos = [];
    this.currentIndex = 0;
    this.isPaused = true;
    this.slideshowIntervalMs = 6000;
    this.slideshowTimer = null;
    this.progressTimer = null;
    this.slideStartTime = 0;

    // Viewport transform
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    // Display & HDR state
    this.displayInfo = null;
    this.webgpuRenderer = null;
    this.currentExposureEV = 0.0;
    this.isSplitMode = false;
    this.isHeatmapMode = false;
    this.splitRatio = 0.5;

    // Overlay state
    this.overlayModeIndex = 0;
    this.overlayModes = LuminaLayoutConfig.overlayModes || ['full', 'minimal', 'off'];

    this._cacheDOMElements();
    this._init();
  }

  _cacheDOMElements() {
    this.viewport = document.getElementById('viewport');
    this.nativeContainer = document.getElementById('native-container');
    this.nativeImg = document.getElementById('native-img');
    this.webgpuContainer = document.getElementById('webgpu-container');
    this.webgpuCanvas = document.getElementById('webgpu-canvas');
    this.splitDivider = document.getElementById('split-divider');

    this.uiOverlay = document.getElementById('ui-overlay');
    this.lblFolder = document.getElementById('lbl-folder');
    this.lblFilename = document.getElementById('lbl-filename');
    this.badgeHDR = document.getElementById('badge-hdr-type');
    this.lblCounter = document.getElementById('lbl-counter');
    this.lblHDRStatus = document.getElementById('lbl-hdr-status');

    this.cardPaused = document.getElementById('card-paused');
    this.cardToast = document.getElementById('card-toast');
    this.lblToast = document.getElementById('lbl-toast');

    this.lblDate = document.getElementById('lbl-date');
    this.lblExif = document.getElementById('lbl-exif');
    this.rowExif = document.getElementById('row-exif');
    this.lblHDRSpec = document.getElementById('lbl-hdr-spec');
    this.progressFill = document.getElementById('progress-fill');

    // Quick Toolbar
    this.btnPrev = document.getElementById('btn-prev');
    this.btnPlay = document.getElementById('btn-play');
    this.btnNext = document.getElementById('btn-next');
    this.btnGrid = document.getElementById('btn-grid');
    this.btnSplit = document.getElementById('btn-split');
    this.btnHeatmap = document.getElementById('btn-heatmap');
    this.btnEvDown = document.getElementById('btn-ev-down');
    this.btnEvUp = document.getElementById('btn-ev-up');
    this.btnReset = document.getElementById('btn-reset');
    this.btnFullscreen = document.getElementById('btn-fullscreen');

    // Grid Modal
    this.gridModal = document.getElementById('grid-modal');
    this.gridContainer = document.getElementById('grid-container');
    this.gridCount = document.getElementById('grid-count');
    this.btnCloseGrid = document.getElementById('btn-close-grid');
    this.btnFilterAll = document.getElementById('btn-filter-all');
    this.btnFilterHDR = document.getElementById('btn-filter-hdr');
  }

  async _init() {
    console.log('[LuminaHDR] Initializing application...');

    // 1. Detect display HDR capabilities
    this.displayInfo = await DisplayHDRDetector.detect();
    this._updateDisplayHUD();

    // 2. Initialize WebGPU Engine
    this.webgpuRenderer = new WebGPUHDRRenderer(this.webgpuCanvas);
    await this.webgpuRenderer.init();

    // 3. Setup Events & Hotkeys
    this._setupEventListeners();
    this._setupWebSocket();

    // 4. Fetch Photo Library
    await this.loadLibrary();
  }

  _updateDisplayHUD() {
    if (this.displayInfo.hdrSupported) {
      this.lblHDRStatus.className = 'lbl-hdr-status';
      this.lblHDRStatus.innerHTML = `✨ HDR Active (${this.displayInfo.estimatedPeakNits} nits, ${this.displayInfo.colorGamut})`;
    } else {
      this.lblHDRStatus.className = 'lbl-hdr-status sdr';
      this.lblHDRStatus.innerHTML = `🔆 SDR Display (${this.displayInfo.colorGamut})`;
    }
  }

  async loadLibrary(hdrOnly = false) {
    try {
      const url = hdrOnly ? '/api/photos?hdr=true' : '/api/photos';
      const res = await fetch(url);
      const data = await res.json();
      this.photos = data.photos || [];

      if (this.photos.length > 0) {
        this.currentIndex = 0;
        this.displayPhoto(this.currentIndex);
      } else {
        this.lblFilename.textContent = 'No photos found in configured folder';
        this.lblCounter.textContent = '0 / 0';
      }
    } catch (err) {
      console.error('[LuminaHDR] Failed to load photos:', err);
      this.showToast('Failed to connect to photo server');
    }
  }

  async displayPhoto(index) {
    if (index < 0 || index >= this.photos.length) return;
    this.currentIndex = index;
    const photo = this.photos[index];

    // Reset zoom and pan on change
    this.resetZoom();

    // Update LuminaSaver GlassCard HUD
    this.lblFolder.textContent = `📁 ${photo.folder_path || '/'}`;
    this.lblFilename.textContent = photo.file_name;
    this.lblCounter.textContent = `${index + 1:,} / ${this.photos.length:,}`;

    // Format & HDR Badge
    this.badgeHDR.className = 'badge-hdr';
    if (photo.is_hdr) {
      if (photo.hdr_type === 'gain_map') {
        this.badgeHDR.classList.add('gainmap');
        this.badgeHDR.textContent = 'ULTRA HDR';
      } else {
        this.badgeHDR.classList.add('hdr');
        this.badgeHDR.textContent = photo.extension.replace('.', '').toUpperCase();
      }
    } else {
      this.badgeHDR.textContent = photo.extension.replace('.', '').toUpperCase();
    }

    // Tier 1: Date & Dimensions
    let dateStr = photo.date_taken ? `📅 ${photo.date_taken}` : '';
    if (photo.dimensions && photo.dimensions !== '0 × 0') {
      dateStr += `${dateStr ? '   •   ' : ''}📐 ${photo.dimensions}`;
    }
    this.lblDate.textContent = dateStr || '📅 --';

    // Tier 2: Camera & Exposure
    const exifParts = [];
    if (photo.camera) exifParts.push(`📷 ${photo.camera}`);
    if (photo.exposure) exifParts.push(`⚙️ ${photo.exposure}`);
    if (exifParts.length > 0) {
      this.lblExif.textContent = exifParts.join('   |   ');
      this.rowExif.style.display = 'block';
    } else {
      this.rowExif.style.display = 'none';
    }

    // Tier 3: High Dynamic Range Specification Pipeline
    const specParts = [
      `🎨 Gamut: ${photo.color_gamut}`,
      `⚡ Transfer: ${photo.transfer_function}`,
      `Depth: ${photo.bit_depth}`
    ];
    if (photo.max_cll) {
      specParts.push(`Peak: ${photo.max_cll} nits`);
    }
    this.lblHDRSpec.textContent = specParts.join('   •   ');

    // Engine Selection: Radiance HDR (.hdr/.pic) goes through WebGPU float engine
    const ext = photo.extension.toLowerCase();
    if (ext === '.hdr' || ext === '.pic') {
      this.nativeContainer.classList.remove('active');
      this.webgpuContainer.classList.add('active');
      await this._loadWebGPUFloatData(photo.id);
    } else {
      // Modern containers (.avif, .jxl, .jpg Ultra HDR) use native hardware presentation
      this.webgpuContainer.classList.remove('active');
      this.nativeContainer.classList.add('active');
      this.nativeImg.src = `/api/photos/${photo.id}/file`;
    }

    // Restart slideshow timer if active
    if (!this.isPaused) {
      this._startSlideTimer();
    }
  }

  async _loadWebGPUFloatData(id) {
    try {
      const res = await fetch(`/api/photos/${id}/hdr-data`);
      if (!res.ok) throw new Error('Failed to fetch HDR float buffer');

      const width = parseInt(res.headers.get('X-Image-Width'), 10);
      const height = parseInt(res.headers.get('X-Image-Height'), 10);
      const buffer = await res.arrayBuffer();
      const floatData = new Float32Array(buffer);

      this.webgpuRenderer.loadFloatData(width, height, floatData);
    } catch (e) {
      console.warn('[WebGPU] Could not load float data, fallback to image element:', e);
      this.webgpuContainer.classList.remove('active');
      this.nativeContainer.classList.add('active');
      this.nativeImg.src = `/api/photos/${id}/file`;
    }
  }

  nextPhoto() {
    if (this.photos.length === 0) return;
    const nextIdx = (this.currentIndex + 1) % this.photos.length;
    this.displayPhoto(nextIdx);
  }

  prevPhoto() {
    if (this.photos.length === 0) return;
    const prevIdx = (this.currentIndex - 1 + this.photos.length) % this.photos.length;
    this.displayPhoto(prevIdx);
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.cardPaused.style.display = this.isPaused ? 'flex' : 'none';
    this.btnPlay.textContent = this.isPaused ? '▶' : '⏸';

    if (this.isPaused) {
      this._stopSlideTimer();
      this.showToast('Slideshow Paused');
    } else {
      this._startSlideTimer();
      this.showToast('Slideshow Resumed');
    }
  }

  _startSlideTimer() {
    this._stopSlideTimer();
    this.slideStartTime = Date.now();

    this.progressTimer = setInterval(() => {
      const elapsed = Date.now() - this.slideStartTime;
      const pct = Math.min(100, (elapsed / this.slideshowIntervalMs) * 100);
      this.progressFill.style.width = `${pct}%`;
    }, 50);

    this.slideshowTimer = setTimeout(() => {
      this.nextPhoto();
    }, this.slideshowIntervalMs);
  }

  _stopSlideTimer() {
    if (this.slideshowTimer) clearTimeout(this.slideshowTimer);
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressFill.style.width = '0%';
  }

  cycleOverlayMode() {
    this.overlayModeIndex = (this.overlayModeIndex + 1) % this.overlayModes.length;
    const mode = this.overlayModes[this.overlayModeIndex];
    this.uiOverlay.className = `ui-overlay overlay-mode-${mode}`;
    this.showToast(`Overlay: ${mode.toUpperCase()}`);
  }

  setExposureEV(delta) {
    this.currentExposureEV = Math.max(-5.0, Math.min(5.0, this.currentExposureEV + delta));
    const sign = this.currentExposureEV > 0 ? '+' : '';
    this.showToast(`Exposure: ${sign}${this.currentExposureEV.toFixed(1)} EV`);

    if (this.webgpuRenderer) {
      this.webgpuRenderer.setExposure(this.currentExposureEV);
    }
    // For native img: apply subtle brightness filter simulation
    const mult = Math.pow(2.0, this.currentExposureEV);
    this.nativeImg.style.filter = mult !== 1.0 ? `brightness(${mult.toFixed(2)})` : 'none';
  }

  toggleSplitMode() {
    this.isSplitMode = !this.isSplitMode;
    this.btnSplit.classList.toggle('active', this.isSplitMode);
    this.splitDivider.style.display = this.isSplitMode ? 'block' : 'none';

    if (this.isSplitMode) {
      this.showToast('🔀 SDR / HDR Split Wipe Enabled');
      if (this.webgpuRenderer) this.webgpuRenderer.setRenderMode(3);
    } else {
      this.showToast('Split Mode Disabled');
      if (this.webgpuRenderer) this.webgpuRenderer.setRenderMode(this.isHeatmapMode ? 2 : 0);
    }
  }

  toggleHeatmapMode() {
    this.isHeatmapMode = !this.isHeatmapMode;
    this.btnHeatmap.classList.toggle('active', this.isHeatmapMode);

    if (this.isHeatmapMode) {
      this.showToast('🔥 HDR Luminance Heatmap (Nits)');
      if (this.webgpuRenderer) this.webgpuRenderer.setRenderMode(2);
    } else {
      this.showToast('Heatmap Disabled');
      if (this.webgpuRenderer) this.webgpuRenderer.setRenderMode(this.isSplitMode ? 3 : 0);
    }
  }

  resetZoom() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
  }

  _applyTransform() {
    const transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    this.nativeImg.style.transform = transform;
    this.webgpuCanvas.style.transform = transform;
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  toggleGrid() {
    const isVisible = this.gridModal.style.display !== 'none';
    if (isVisible) {
      this.gridModal.style.display = 'none';
    } else {
      this._renderGrid();
      this.gridModal.style.display = 'flex';
    }
  }

  _renderGrid(hdrOnly = false) {
    this.gridContainer.innerHTML = '';
    const filtered = hdrOnly ? this.photos.filter(p => p.is_hdr) : this.photos;
    this.gridCount.textContent = filtered.length;

    filtered.forEach((photo, idx) => {
      const item = document.createElement('div');
      item.className = `grid-item ${this.photos[this.currentIndex]?.id === photo.id ? 'active' : ''}`;
      item.innerHTML = `
        <img src="/api/photos/${photo.id}/file" loading="lazy" alt="${photo.file_name}">
        <div class="grid-item-badge ${photo.is_hdr ? 'hdr' : ''}">${photo.is_hdr ? 'HDR' : 'SDR'}</div>
        <div class="grid-item-label">${photo.file_name}</div>
      `;
      item.addEventListener('click', () => {
        const targetIdx = this.photos.findIndex(p => p.id === photo.id);
        if (targetIdx !== -1) {
          this.displayPhoto(targetIdx);
          this.gridModal.style.display = 'none';
        }
      });
      this.gridContainer.appendChild(item);
    });
  }

  showToast(message, durationMs = 2500) {
    this.lblToast.textContent = message;
    this.cardToast.style.display = 'flex';
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      this.cardToast.style.display = 'none';
    }, durationMs);
  }

  _setupEventListeners() {
    // Keyboard navigation matching LuminaSaver + HDR keys
    window.addEventListener('keydown', (e) => {
      // If modal is open, handle Esc
      if (this.gridModal.style.display !== 'none') {
        if (e.code === 'Escape') {
          this.gridModal.style.display = 'none';
          return;
        }
      }

      switch (e.code) {
        case 'ArrowRight':
        case 'KeyN':
          this.nextPhoto();
          break;
        case 'ArrowLeft':
        case 'KeyP':
          this.prevPhoto();
          break;
        case 'Space':
          e.preventDefault();
          this.togglePause();
          break;
        case 'KeyO':
          this.cycleOverlayMode();
          break;
        case 'KeyF':
          this.toggleFullscreen();
          break;
        case 'KeyG':
          this.toggleGrid();
          break;
        case 'KeyS':
          this.toggleSplitMode();
          break;
        case 'KeyH':
          this.toggleHeatmapMode();
          break;
        case 'BracketLeft':
          this.setExposureEV(-0.5);
          break;
        case 'BracketRight':
          this.setExposureEV(+0.5);
          break;
        case 'Digit0':
        case 'KeyR':
          this.resetZoom();
          this.currentExposureEV = 0.0;
          this.setExposureEV(0.0);
          this.showToast('Reset View & Exposure');
          break;
        case 'Escape':
        case 'KeyQ':
          if (document.fullscreenElement) {
            document.exitFullscreen();
          }
          break;
      }
    });

    // Mouse wheel zoom
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.5, Math.min(8.0, this.scale * zoomFactor));

      if (newScale !== this.scale) {
        this.scale = newScale;
        this._applyTransform();
        this.showToast(`🔍 ${Math.round(this.scale * 100)}%`, 1000);
      }
    }, { passive: false });

    // Drag to Pan
    this.viewport.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isDragging = true;
        this.dragStartX = e.clientX - this.panX;
        this.dragStartY = e.clientY - this.panY;
        this.viewport.classList.add('grabbing');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.panX = e.clientX - this.dragStartX;
        this.panY = e.clientY - this.dragStartY;
        this._applyTransform();
      }

      // Handle split slider wipe on move if split mode enabled
      if (this.isSplitMode) {
        const ratio = Math.max(0.05, Math.min(0.95, e.clientX / window.innerWidth));
        this.splitDivider.style.left = `${ratio * 100}%`;
        if (this.webgpuRenderer) {
          this.webgpuRenderer.setSplitX(ratio);
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.viewport.classList.remove('grabbing');
    });

    // Double click to reset zoom
    this.viewport.addEventListener('dblclick', () => {
      this.resetZoom();
    });

    // Quick Toolbar buttons
    this.btnPrev.addEventListener('click', () => this.prevPhoto());
    this.btnPlay.addEventListener('click', () => this.togglePause());
    this.btnNext.addEventListener('click', () => this.nextPhoto());
    this.btnGrid.addEventListener('click', () => this.toggleGrid());
    this.btnSplit.addEventListener('click', () => this.toggleSplitMode());
    this.btnHeatmap.addEventListener('click', () => this.toggleHeatmapMode());
    this.btnEvDown.addEventListener('click', () => this.setExposureEV(-0.5));
    this.btnEvUp.addEventListener('click', () => this.setExposureEV(+0.5));
    this.btnReset.addEventListener('click', () => {
      this.resetZoom();
      this.setExposureEV(0.0);
    });
    this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

    // Grid Modal Filters
    this.btnCloseGrid.addEventListener('click', () => this.gridModal.style.display = 'none');
    this.btnFilterAll.addEventListener('click', () => {
      this.btnFilterAll.classList.add('active');
      this.btnFilterHDR.classList.remove('active');
      this._renderGrid(false);
    });
    this.btnFilterHDR.addEventListener('click', () => {
      this.btnFilterHDR.classList.add('active');
      this.btnFilterAll.classList.remove('active');
      this._renderGrid(true);
    });
  }

  _setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Report client display info to server
      ws.send(JSON.stringify({
        type: 'client_display_info',
        hdrSupported: this.displayInfo.hdrSupported,
        headroom: this.displayInfo.headroom,
        colorGamut: this.displayInfo.colorGamut
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'media_changed') {
          console.log('[LuminaHDR] Media library updated:', data.change);
          this.loadLibrary();
          this.showToast('📁 Library folder updated');
        }
      } catch (e) {}
    };
  }
}

// Start application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.luminaApp = new LuminaHDRApp();
});
