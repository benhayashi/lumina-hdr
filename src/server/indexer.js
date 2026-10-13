/**
 * LuminaHDR Media Indexer
 * SQLite-backed incremental scanner inspired by LuminaSaver indexer.py
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HDRMetadataParser } from './metadata.js';

export const SUPPORTED_EXTENSIONS = new Set([
  '.jxl', '.avif', '.jpg', '.jpeg', '.heic', '.heif',
  '.exr', '.hdr', '.pic', '.tif', '.tiff', '.png', '.webp'
]);

export class MediaIndexer {
  constructor(dbPath = './photohdr.db') {
    this.dbPath = dbPath;
    this._initDB();
    this.watchedDirs = new Set();
    this.fsWatchers = [];
    this.onMediaChangedCallback = null;
  }

  _initDB() {
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS media_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        folder_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        extension TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        dimensions TEXT DEFAULT '0 × 0',
        date_taken TEXT,
        camera TEXT,
        exposure TEXT,
        color_gamut TEXT DEFAULT 'sRGB',
        transfer_function TEXT DEFAULT 'sRGB',
        bit_depth TEXT DEFAULT '8-bit integer',
        hdr_type TEXT DEFAULT 'standard_sdr',
        is_hdr INTEGER DEFAULT 0,
        max_cll INTEGER,
        gain_map_json TEXT,
        created_at REAL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_folder ON media_files(folder_path);
      CREATE INDEX IF NOT EXISTS idx_hdr ON media_files(is_hdr);
      CREATE INDEX IF NOT EXISTS idx_mtime ON media_files(mtime);
    `);

    this.stmtGetByPath = this.db.prepare('SELECT id, file_size, mtime FROM media_files WHERE file_path = ?');
    this.stmtInsert = this.db.prepare(`
      INSERT INTO media_files (
        file_path, folder_path, file_name, extension, file_size, mtime,
        width, height, dimensions, date_taken, camera, exposure,
        color_gamut, transfer_function, bit_depth, hdr_type, is_hdr, max_cll, gain_map_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        file_size = excluded.file_size,
        mtime = excluded.mtime,
        width = excluded.width,
        height = excluded.height,
        dimensions = excluded.dimensions,
        date_taken = excluded.date_taken,
        camera = excluded.camera,
        exposure = excluded.exposure,
        color_gamut = excluded.color_gamut,
        transfer_function = excluded.transfer_function,
        bit_depth = excluded.bit_depth,
        hdr_type = excluded.hdr_type,
        is_hdr = excluded.is_hdr,
        max_cll = excluded.max_cll,
        gain_map_json = excluded.gain_map_json;
    `);
    this.stmtDeleteByPath = this.db.prepare('DELETE FROM media_files WHERE file_path = ?');
  }

  /**
   * Scans a directory recursively with incremental checking
   * @param {string} rootDir
   * @param {Function} [progressCallback]
   * @returns {Promise<number>} count of indexed files
   */
  async scanDirectory(rootDir, progressCallback = null) {
    const absRoot = path.resolve(rootDir);
    if (!fs.existsSync(absRoot)) {
      throw new Error(`Directory does not exist: ${absRoot}`);
    }

    console.log(`[Indexer] Scanning directory: ${absRoot}`);
    let count = 0;
    let newOrUpdated = 0;

    const walk = async (currentDir) => {
      let entries;
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch (e) {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories like .git
          if (!entry.name.startsWith('.')) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            count++;
            try {
              const stats = await fs.promises.stat(fullPath);
              const existing = this.stmtGetByPath.get(fullPath);

              // Skip unchanged files (same mtime and size)
              if (existing && existing.file_size === stats.size && Math.abs(existing.mtime - stats.mtimeMs) < 10) {
                continue;
              }

              // Extract metadata
              const meta = await HDRMetadataParser.extract(fullPath);

              this.stmtInsert.run(
                fullPath,
                path.dirname(fullPath),
                entry.name,
                ext,
                stats.size,
                stats.mtimeMs,
                meta.width || 0,
                meta.height || 0,
                meta.dimensions || '0 × 0',
                meta.dateTaken || null,
                meta.camera || null,
                meta.exposure || null,
                meta.colorGamut || 'sRGB',
                meta.transferFunction || 'sRGB',
                meta.bitDepth || '8-bit integer',
                meta.hdrType || 'standard_sdr',
                meta.isHDR ? 1 : 0,
                meta.maxCLL || null,
                meta.gainMap ? JSON.stringify(meta.gainMap) : null
              );
              newOrUpdated++;

              if (progressCallback && newOrUpdated % 25 === 0) {
                progressCallback({ total: count, updated: newOrUpdated });
              }
            } catch (err) {
              console.warn(`[Indexer] Could not parse ${fullPath}:`, err.message);
            }
          }
        }
      }
    };

    await walk(absRoot);
    console.log(`[Indexer] Scan complete: ${count} total files found (${newOrUpdated} newly indexed or updated).`);
    return count;
  }

  /**
   * Returns list of media items with optional filtering and sorting
   */
  getAll(options = {}) {
    let query = 'SELECT * FROM media_files';
    const params = [];
    const conditions = [];

    if (options.folder) {
      conditions.push('folder_path = ?');
      params.push(options.folder);
    }
    if (options.hdrOnly) {
      conditions.push('is_hdr = 1');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const sortOrder = options.sort || 'filename_asc';
    switch (sortOrder) {
      case 'date_desc': query += ' ORDER BY date_taken DESC, file_name ASC'; break;
      case 'date_asc': query += ' ORDER BY date_taken ASC, file_name ASC'; break;
      case 'size_desc': query += ' ORDER BY file_size DESC'; break;
      case 'hdr_first': query += ' ORDER BY is_hdr DESC, file_name ASC'; break;
      case 'filename_desc': query += ' ORDER BY file_name DESC'; break;
      case 'filename_asc':
      default: query += ' ORDER BY file_name ASC'; break;
    }

    if (options.limit) {
      query += ` LIMIT ${parseInt(options.limit, 10)}`;
      if (options.offset) {
        query += ` OFFSET ${parseInt(options.offset, 10)}`;
      }
    }

    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      is_hdr: Boolean(r.is_hdr),
      gain_map: r.gain_map_json ? JSON.parse(r.gain_map_json) : null
    }));
  }

  getById(id) {
    const row = this.db.prepare('SELECT * FROM media_files WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      is_hdr: Boolean(row.is_hdr),
      gain_map: row.gain_map_json ? JSON.parse(row.gain_map_json) : null
    };
  }

  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM media_files').get().count;
    const hdrCount = this.db.prepare('SELECT COUNT(*) as count FROM media_files WHERE is_hdr = 1').get().count;
    const folders = this.db.prepare('SELECT COUNT(DISTINCT folder_path) as count FROM media_files').get().count;
    return { total, hdrCount, sdrCount: total - hdrCount, folders };
  }

  /**
   * Live filesystem watcher for hot reload
   */
  watch(dirPath, onChangeCallback) {
    const absPath = path.resolve(dirPath);
    if (this.watchedDirs.has(absPath)) return;
    this.watchedDirs.add(absPath);
    this.onMediaChangedCallback = onChangeCallback;

    try {
      const watcher = fs.watch(absPath, { recursive: true }, async (eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          const fullPath = path.join(absPath, filename);
          if (fs.existsSync(fullPath)) {
            try {
              const meta = await HDRMetadataParser.extract(fullPath);
              const stats = await fs.promises.stat(fullPath);
              this.stmtInsert.run(
                fullPath,
                path.dirname(fullPath),
                path.basename(fullPath),
                ext,
                stats.size,
                stats.mtimeMs,
                meta.width || 0,
                meta.height || 0,
                meta.dimensions || '0 × 0',
                meta.dateTaken || null,
                meta.camera || null,
                meta.exposure || null,
                meta.colorGamut || 'sRGB',
                meta.transferFunction || 'sRGB',
                meta.bitDepth || '8-bit integer',
                meta.hdrType || 'standard_sdr',
                meta.isHDR ? 1 : 0,
                meta.maxCLL || null,
                meta.gainMap ? JSON.stringify(meta.gainMap) : null
              );
              console.log(`[Watcher] Updated file: ${filename}`);
            } catch (e) {}
          } else {
            this.stmtDeleteByPath.run(fullPath);
            console.log(`[Watcher] Removed file: ${filename}`);
          }
          if (this.onMediaChangedCallback) {
            this.onMediaChangedCallback({ eventType, filename });
          }
        }
      });
      this.fsWatchers.push(watcher);
    } catch (e) {
      console.warn(`[Watcher] Could not watch ${absPath}:`, e.message);
    }
  }

  close() {
    for (const w of this.fsWatchers) {
      try { w.close(); } catch (e) {}
    }
    this.fsWatchers = [];
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      this.db.close();
    } catch (e) {}
  }
}
