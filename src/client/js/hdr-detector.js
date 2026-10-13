/**
 * LuminaHDR Display & Color Capability Detector
 * Inspects OS / Monitor HDR support, color gamut, and display brightness headroom
 */

export class DisplayHDRDetector {
  static async detect() {
    const info = {
      hdrSupported: false,
      colorGamut: 'sRGB',
      headroom: 1.0,
      estimatedPeakNits: 250,
      webgpuAvailable: false,
      webgpuHDRExtended: false,
      colorDepth: window.screen.colorDepth || 24,
      pixelDepth: window.screen.pixelDepth || 24,
    };

    // 1. CSS Media Queries for Dynamic Range
    const hdrQuery = window.matchMedia('(dynamic-range: high)');
    const videoHdrQuery = window.matchMedia('(video-dynamic-range: high)');
    info.hdrSupported = hdrQuery.matches || videoHdrQuery.matches;

    // 2. CSS Media Queries for Color Gamut
    if (window.matchMedia('(color-gamut: rec2020)').matches) {
      info.colorGamut = 'Rec.2020';
    } else if (window.matchMedia('(color-gamut: p3)').matches) {
      info.colorGamut = 'Display P3';
    } else {
      info.colorGamut = 'sRGB';
    }

    // 3. WebGPU Extended Tone Mapping Check
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          info.webgpuAvailable = true;
          // Check if rgba16float and extended tone mapping are supported
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('webgpu');
          if (ctx) {
            const device = await adapter.requestDevice();
            try {
              ctx.configure({
                device,
                format: 'rgba16float',
                colorSpace: info.colorGamut === 'Rec.2020' ? 'display-p3' : 'display-p3',
                toneMapping: { mode: 'extended' }
              });
              info.webgpuHDRExtended = true;
            } catch (e) {
              // Extended mode unsupported or fallback
            }
          }
        }
      } catch (e) {
        // WebGPU adapter request error
      }
    }

    // 4. Calculate display headroom multiplier
    // In macOS / Windows HDR, colorDepth is typically >= 30 bit
    if (info.hdrSupported) {
      // Modern HDR displays typically have between 2.0x (500 nits) to 6.0x (1500 nits) headroom above 203 nits SDR white
      // On Apple Silicon XDR displays, headroom is commonly 4.0 - 8.0
      info.headroom = 4.0;
      info.estimatedPeakNits = 1000;
    } else {
      info.headroom = 1.0;
      info.estimatedPeakNits = 250;
    }

    return info;
  }
}
