# LuminaHDR 🌟

[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Docker-brightgreen.svg)]()
[![Display](https://img.shields.io/badge/Display-True%20HDR%20%7C%20WebGPU%2016--bit%20Float-blueviolet.svg)]()
[![Sync](https://img.shields.io/badge/Layout%20Sync-LuminaSaver-blue.svg)]()

**LuminaHDR** is a lightweight, cross-platform photo viewing application engineered to display modern High Dynamic Range (HDR) photos at their maximum capacity, correct bit depth, and precise color space specifications across **Windows**, **macOS**, **Linux**, and **Docker**.

Built as a dedicated HDR sister project to [**LuminaSaver**](https://github.com/benhayashi/lumina-saver), it adapts LuminaSaver's elegant translucent glassmorphic HUD media layout while upgrading the underlying pipeline to a **WebGPU 16-bit Float (`rgba16float`, `display-p3`, `extended` toneMapping) & Direct Hardware HDR swapchain**.

---

## ✨ Key Features

- **🌈 Maximum HDR Capacity & Bit Depth**:
  - **Windows**: Seamless integration with Windows Advanced Color (scRGB 16-bit float / HDR10).
  - **macOS**: Full Extended Dynamic Range (EDR) support for Apple Liquid Retina XDR & Studio Displays up to 1,600 nits.
  - **Linux**: Wayland `frog-color-management` & `wp_color_management_v1` support.
  - **Docker**: Standalone container streaming master-quality HDR photos to any HDR client display over local network.
- **📸 Modern HDR Formats**:
  - **JPEG XL (`.jxl`)**: Native PQ, HLG, Linear Float, and Rec.2020/Display P3 gamuts.
  - **Ultra HDR (`.jpg`, `.jpeg`)**: Full ISO 21496-1 and Adobe/Apple Gain Map reconstruction.
  - **AVIF (`.avif`)**: 10-bit / 12-bit AV1 with cICP / NCLX (BT.2020 PQ / HLG).
  - **Apple HDR / ProRAW (`.heic`)**: Apple HDR Gain Map parsing.
  - **OpenEXR (`.exr`)**: 16-bit Half Float and 32-bit Float Linear light.
  - **Radiance HDR (`.hdr`, `.pic`)**: 32-bit RGBE decoded directly to WebGPU FP16 floating-point textures.
  - **TIFF (`.tif`, `.tiff`)**: 16-bit integer / 32-bit float with wide-gamut ICC profiles.
- **🔄 LuminaSaver Layout Sync Bridge (`npm run sync:lumina`)**:
  - Automatically pulls and parses layout changes, glassmorphic styling, and keyboard maps from `benhayashi/lumina-saver` on GitHub or local checkout.
- **🚀 High-Performance SQLite WAL Indexing**:
  - Sub-second recursive scanning and incremental change tracking for 60,000+ photo collections.
- **🔬 Deep Color & Exposure Inspection**:
  - Real-time **Exposure Compensation** (`[` / `]` for $\pm$ EV linear boost/cut).
  - **🔀 SDR vs. HDR Split Wipe Comparison (`S`)**: Swipe across the screen to see SDR clipping vs true HDR highlight expansion.
  - **🔥 False-Color HDR Luminance Heatmap (`H`)**: Color-codes pixel nits (SDR gray, green 200–500 nits, orange 500–1000 nits, magenta >1000 nits).
  - **🔍 Deep Zoom & Pan**: Mouse wheel zoom centered on cursor, click-drag pan.
  - **⊞ Grid / Thumbnail Browser (`G`)**: Fast library navigation with "HDR Only" filtering.

---

## 🎮 Keyboard Controls (LuminaSaver Parity)

| Key | Action |
| :--- | :--- |
| `Right Arrow` / `N` | Next photo |
| `Left Arrow` / `P` | Previous photo |
| `Space` | Pause / Resume Slideshow |
| `O` | Cycle Overlay Mode (`Full` $\rightarrow$ `Minimal` $\rightarrow$ `Off`) |
| `F` | Toggle Fullscreen |
| `G` | Toggle Thumbnail Grid Browser |
| `S` | Toggle SDR / HDR Split Wipe Comparison |
| `H` | Toggle False-Color HDR Luminance Heatmap |
| `[` / `]` | Adjust Exposure ($\pm$ 0.5 EV) |
| `0` / `KeyR` | Reset Zoom, Pan, and Exposure |
| `Esc` / `Q` | Close Grid / Exit Fullscreen |

---

## 📦 Quick Start

### Prerequisites
- Node.js 20+ (Node 22 recommended)
- A modern browser with HDR support (Google Chrome, Microsoft Edge, Brave, or Apple Safari)

### 1. Run Standalone on Device (Windows / macOS / Linux)

```bash
# Clone the repository
git clone https://github.com/benhayashi/lumina-hdr.git
cd lumina-hdr

# Run directly pointing to any folder
./run.sh /path/to/my/photos

# On Windows:
run.bat C:\Users\Username\Pictures
```

### 2. Run with Docker

Mount any host folder containing your photos to `/photos`:

```bash
# Using docker run
docker run -d \
  --name lumina-hdr \
  -p 8080:8080 \
  -v /path/to/my/photos:/photos:ro \
  -v ./data:/app/data \
  ghcr.io/benhayashi/lumina-hdr:latest

# Or using docker compose
PHOTOS_DIR=/path/to/my/photos docker compose up -d
```

Open `http://localhost:8080` (or `http://<server-ip>:8080` from your HDR TV, PC, or Mac).

---

## 🔄 LuminaSaver Synchronization Bridge

Whenever you update styles, card dimensions, or hotkeys in **LuminaSaver** on GitHub:

```bash
npm run sync:lumina
```

The sync bridge automatically:
1. Locates your local `LuminaSaver` repository or fetches the latest commit from `benhayashi/lumina-saver` on GitHub.
2. Extracts `GlassCard` CSS properties, typography, layout hierarchies, and hotkeys from `ui_overlay.py`.
3. Updates `src/client/css/lumina-theme.css` and `src/client/js/lumina-layout-config.js` instantaneously.

---

## 🖥️ HDR Display Setup

### Windows 10 / 11
1. Open **Windows Settings** $\rightarrow$ **System** $\rightarrow$ **Display**.
2. Toggle **Use HDR** to **On**.
3. Launch LuminaHDR in Google Chrome or Microsoft Edge.
4. LuminaHDR will display `✨ HDR Active: 1,000 nits` in the top-right HUD badge.

### macOS (Apple Silicon / XDR)
1. Supported natively on MacBook Pro Liquid Retina XDR displays and Apple Studio / Pro Display XDR.
2. Open LuminaHDR in Safari or Chrome.
3. Specular highlights will automatically utilize full EDR headroom (up to 1,600 nits).

---

## 🧪 Testing

Run the automated test suite:

```bash
npm test
```

---

## 📜 License

GPL-3.0 License. See [LICENSE](LICENSE) for details.
