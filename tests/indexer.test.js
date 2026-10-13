import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { HDRMetadataParser } from '../src/server/metadata.js';
import { RadianceHDRDecoder } from '../src/server/decoders/hdr.js';
import { MediaIndexer } from '../src/server/indexer.js';

const SAMPLE_DIR = path.resolve('sample-photos');

test('HDRMetadataParser parses Radiance HDR correctly', async () => {
  const hdrFile = path.join(SAMPLE_DIR, 'sunset_mountain_radiance.hdr');
  const meta = await HDRMetadataParser.extract(hdrFile);

  assert.equal(meta.isHDR, true);
  assert.equal(meta.hdrType, 'linear_float');
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 128);
  assert.equal(meta.dimensions, '256 × 128');
  assert.match(meta.bitDepth, /Float/i);
});

test('HDRMetadataParser parses Ultra HDR Gain Map metadata', async () => {
  const ultraHdrFile = path.join(SAMPLE_DIR, 'golden_gate_ultrahdr.jpg');
  const meta = await HDRMetadataParser.extract(ultraHdrFile);

  assert.equal(meta.isHDR, true);
  assert.equal(meta.hdrType, 'gain_map');
  assert.equal(meta.transferFunction, 'ISO 21496-1 Gain Map');
  assert.ok(meta.gainMap);
  assert.ok(meta.gainMap.maxBoost > 1.0);
  assert.equal(meta.maxCLL, Math.round(meta.gainMap.maxBoost * 250));
});

test('RadianceHDRDecoder decodes floating-point pixels with extreme highlights', async () => {
  const hdrFile = path.join(SAMPLE_DIR, 'solar_flare_16bit.hdr');
  const decoded = await RadianceHDRDecoder.decode(hdrFile);

  assert.equal(decoded.width, 128);
  assert.equal(decoded.height, 128);
  assert.equal(decoded.data.length, 128 * 128 * 4);

  // Find maximum pixel value to verify true HDR values (> 1.0)
  let maxRadiance = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    const r = decoded.data[i];
    const g = decoded.data[i + 1];
    const b = decoded.data[i + 2];
    const maxChannel = Math.max(r, g, b);
    if (maxChannel > maxRadiance) maxRadiance = maxChannel;
  }

  assert.ok(maxRadiance > 5.0, `Expected extreme HDR radiance > 5.0, got ${maxRadiance}`);
});

test('MediaIndexer performs SQLite incremental indexing and filtering', async () => {
  const testDb = path.resolve('tests/test_photohdr.db');
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

  const indexer = new MediaIndexer(testDb);
  const count = await indexer.scanDirectory(SAMPLE_DIR);
  assert.ok(count >= 3);

  const stats = indexer.getStats();
  assert.ok(stats.total >= 3);
  assert.ok(stats.hdrCount >= 2);

  const hdrOnly = indexer.getAll({ hdrOnly: true });
  assert.ok(hdrOnly.every(item => item.is_hdr === true));

  const firstItem = hdrOnly[0];
  const fetched = indexer.getById(firstItem.id);
  assert.equal(fetched.file_name, firstItem.file_name);

  // Test incremental skip: scanning again should be fast and return same count
  const count2 = await indexer.scanDirectory(SAMPLE_DIR);
  assert.equal(count2, count);

  indexer.close();
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  if (fs.existsSync(testDb + '-wal')) fs.unlinkSync(testDb + '-wal');
  if (fs.existsSync(testDb + '-shm')) fs.unlinkSync(testDb + '-shm');
});

test('LuminaSync theme CSS exists and contains LuminaSaver tokens', () => {
  const cssPath = path.resolve('src/client/css/lumina-theme.css');
  assert.ok(fs.existsSync(cssPath));
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(css.includes('--lumina-glass-bg'));
  assert.ok(css.includes('--lumina-accent-blue'));
  assert.ok(css.includes('.glass-card'));
});
