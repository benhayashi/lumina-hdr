#!/usr/bin/env node

/**
 * LuminaHDR Main Server Application
 * Cross-platform HDR Photo Viewer backend with SQLite incremental indexing,
 * high-bit-depth streaming, and real-time WebGPU HDR presentation support.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MediaIndexer } from './indexer.js';
import { RadianceHDRDecoder } from './decoders/hdr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLIENT_DIR = path.resolve(__dirname, '../client');

// CLI Arguments
const args = process.argv.slice(2);
let targetFolder = process.env.PHOTOS_DIR || './sample-photos';
let port = parseInt(process.env.PORT || '8080', 10);
let host = process.env.HOST || '0.0.0.0';
let autoOpen = !args.includes('--no-open') && !process.env.DOCKER;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[++i], 10);
  } else if (args[i] === '--host' && args[i + 1]) {
    host = args[++i];
  } else if (!args[i].startsWith('--')) {
    targetFolder = args[i];
  }
}

targetFolder = path.resolve(targetFolder);

// Ensure photos directory exists
if (!fs.existsSync(targetFolder)) {
  fs.mkdirSync(targetFolder, { recursive: true });
}

// MIME Types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jxl': 'image/jxl',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.hdr': 'application/octet-stream',
  '.pic': 'application/octet-stream',
  '.exr': 'image/x-exr',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.wgsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml'
};

// Initialize SQLite Indexer
const dbPath = path.resolve(PROJECT_ROOT, 'photohdr.db');
const indexer = new MediaIndexer(dbPath);

// Create HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // --- API Routes ---
  if (pathname === '/api/photos') {
    const folder = url.searchParams.get('folder');
    const hdrOnly = url.searchParams.get('hdr') === 'true';
    const sort = url.searchParams.get('sort') || 'filename_asc';
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');

    const photos = indexer.getAll({ folder, hdrOnly, sort, limit, offset });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ photos, total: photos.length }));
    return;
  }

  if (pathname.startsWith('/api/photos/') && pathname.endsWith('/file')) {
    const id = parseInt(pathname.split('/')[3], 10);
    const item = indexer.getById(id);
    if (!item || !fs.existsSync(item.file_path)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Photo not found' }));
      return;
    }

    const ext = path.extname(item.file_path).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(item.file_path);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = (end - start) + 1;
      const stream = fs.createReadStream(item.file_path, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(item.file_path).pipe(res);
    }
    return;
  }

  if (pathname.startsWith('/api/photos/') && pathname.endsWith('/hdr-data')) {
    const id = parseInt(pathname.split('/')[3], 10);
    const item = indexer.getById(id);
    if (!item || !fs.existsSync(item.file_path)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Photo not found' }));
      return;
    }

    const ext = path.extname(item.file_path).toLowerCase();
    if (ext === '.hdr' || ext === '.pic') {
      try {
        const decoded = await RadianceHDRDecoder.decode(item.file_path);
        // Stream float32 binary buffer
        const buf = Buffer.from(decoded.data.buffer);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'X-Image-Width': String(decoded.width),
          'X-Image-Height': String(decoded.height),
          'Content-Length': buf.length
        });
        res.end(buf);
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `HDR decode failed: ${err.message}` }));
        return;
      }
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Format does not require raw float streaming' }));
    return;
  }

  if (pathname.startsWith('/api/photos/') && pathname.split('/').length === 4) {
    const id = parseInt(pathname.split('/')[3], 10);
    const item = indexer.getById(id);
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(item));
    return;
  }

  if (pathname === '/api/stats') {
    const stats = indexer.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...stats, targetFolder }));
    return;
  }

  if (pathname === '/api/scan' && req.method === 'POST') {
    const count = await indexer.scanDirectory(targetFolder);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count }));
    return;
  }

  // --- Static Client Files ---
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(CLIENT_DIR, reqPath);

  // Security check: keep inside CLIENT_DIR
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

// Create WebSocket Server for Live Push Notifications
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', targetFolder }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'client_display_info') {
        // Client reports display headroom, e.g. { hdrSupported: true, headroom: 3.8 }
        console.log(`[Display] Client connected with ${data.hdrSupported ? '✨ HDR Display (' + (data.headroom * 250).toFixed(0) + ' nits)' : '🔆 SDR Display'}`);
      }
    } catch (e) {}
  });
});

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}

// Start Server and Initial Scan
async function start() {
  await indexer.scanDirectory(targetFolder);
  indexer.watch(targetFolder, (change) => {
    broadcast({ type: 'media_changed', change });
  });

  server.listen(port, host, async () => {
    const localUrl = `http://localhost:${port}`;
    const networkUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;

    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   🌟 LuminaHDR Photo Viewer Server Started                           ║
║                                                                      ║
║   📁 Photos Folder:   ${targetFolder.padEnd(43)} ║
║   🌐 Local URL:       ${localUrl.padEnd(43)} ║
║   🚀 Network URL:     ${networkUrl.padEnd(43)} ║
║   ✨ Max Capacity:    True 16-bit Float / WebGPU / Hardware HDR      ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

    if (autoOpen) {
      try {
        // Attempt dynamic import of open or shell launch
        const { default: open } = await import('open').catch(() => ({}));
        if (open) {
          open(localUrl);
        }
      } catch (e) {}
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[LuminaHDR] Shutting down...');
  indexer.close();
  server.close();
  process.exit(0);
});

start().catch(err => {
  console.error('[LuminaHDR] Fatal Startup Error:', err);
  process.exit(1);
});
