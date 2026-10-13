/**
 * LuminaHDR Metadata & Color Specification Parser
 * Extracts EXIF, XMP (Ultra HDR / ISO 21496-1 Gain Map), ICC, and cICP/NCLX metadata
 */

import fs from 'node:fs';
import path from 'node:path';
import ExifReader from 'exifreader';

export class HDRMetadataParser {
  /**
   * Fast header and metadata inspection for HDR photos
   * @param {string} filePath
   * @returns {Promise<Object>}
   */
  static async extract(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const stats = await fs.promises.stat(filePath);

    const result = {
      filePath,
      fileName: path.basename(filePath),
      folderName: path.basename(path.dirname(filePath)),
      fileSize: stats.size,
      mtime: stats.mtimeMs,
      width: 0,
      height: 0,
      dimensions: '0 × 0',
      dateTaken: null,
      camera: null,
      exposure: null,
      colorGamut: 'sRGB',          // 'Rec.2020', 'Display P3', 'sRGB', etc.
      transferFunction: 'sRGB',     // 'SMPTE ST 2084 (PQ)', 'HLG', 'ISO 21496-1 Gain Map', 'Linear'
      bitDepth: '8-bit integer',   // '10-bit integer', '16-bit float', etc.
      hdrType: 'standard_sdr',     // 'gain_map', 'pq_hdr', 'hlg_hdr', 'linear_float', 'standard_sdr'
      isHDR: false,
      maxCLL: null,                // Max Content Light Level (nits)
      gainMap: null                // Gain map parameters if present
    };

    // Radiance HDR format (.hdr / .pic)
    if (ext === '.hdr' || ext === '.pic') {
      return this.parseRadianceHeader(filePath, result);
    }

    // OpenEXR format (.exr)
    if (ext === '.exr') {
      return this.parseEXRHeader(filePath, result);
    }

    // Standard & modern containers: JPEG, JXL, AVIF, HEIC, TIFF, PNG, WebP
    try {
      // Read initial 256KB for fast header/EXIF/XMP parsing
      const fd = await fs.promises.open(filePath, 'r');
      const headerBufferSize = Math.min(stats.size, 512 * 1024);
      const buffer = Buffer.alloc(headerBufferSize);
      await fd.read(buffer, 0, headerBufferSize, 0);
      await fd.close();

      const tags = ExifReader.load(buffer, { expanded: true });

      // Dimensions
      if (tags.file && tags.file['Image Width'] && tags.file['Image Height']) {
        result.width = tags.file['Image Width'].value;
        result.height = tags.file['Image Height'].value;
      } else if (tags.exif && tags.exif.PixelXDimension && tags.exif.PixelYDimension) {
        result.width = tags.exif.PixelXDimension.value;
        result.height = tags.exif.PixelYDimension.value;
      }

      // Check EXIF Orientation
      const orientation = tags.exif?.Orientation?.value;
      if (orientation && [5, 6, 7, 8].includes(orientation)) {
        const tmp = result.width;
        result.width = result.height;
        result.height = tmp;
      }
      if (result.width && result.height) {
        result.dimensions = `${result.width} × ${result.height}`;
      }

      // Camera Make & Model
      const make = tags.exif?.Make?.description?.trim() || '';
      const model = tags.exif?.Model?.description?.trim() || '';
      if (model) {
        result.camera = model.startsWith(make) ? model : `${make} ${model}`.trim();
      } else if (make) {
        result.camera = make;
      }

      // Date Taken
      const dateTag = tags.exif?.DateTimeOriginal || tags.exif?.DateTimeDigitized || tags.exif?.DateTime;
      if (dateTag && dateTag.description) {
        const rawDate = dateTag.description.trim();
        const parts = rawDate.split(' ');
        if (parts.length >= 2) {
          const ymd = parts[0].replace(/:/g, '-');
          const hm = parts[1].split(':').slice(0, 2).join(':');
          result.dateTaken = `${ymd} ${hm}`;
        } else {
          result.dateTaken = rawDate;
        }
      }

      // Exposure Settings (ISO, FNumber, Shutter, Focal Length)
      const expParts = [];
      if (tags.exif?.ISOSpeedRatings?.description) {
        expParts.push(`ISO ${tags.exif.ISOSpeedRatings.description}`);
      }
      if (tags.exif?.FNumber?.description) {
        expParts.push(tags.exif.FNumber.description.replace('f/', 'f/').replace('F', 'f/'));
      }
      if (tags.exif?.ExposureTime?.description) {
        expParts.push(`${tags.exif.ExposureTime.description}s`);
      }
      if (tags.exif?.FocalLength?.description) {
        expParts.push(tags.exif.FocalLength.description);
      }
      if (expParts.length > 0) {
        result.exposure = expParts.join(', ');
      }

      // Bit depth inspection
      if (tags.file?.['Bits Per Sample']) {
        const bits = tags.file['Bits Per Sample'].value;
        const b = Array.isArray(bits) ? bits[0] : bits;
        if (b > 8) {
          result.bitDepth = `${b}-bit integer`;
        }
      }

      // Inspect XMP for ISO 21496-1 / Ultra HDR / Apple / Adobe Gain Maps
      this.inspectGainMap(tags, result, buffer);

      // Inspect cICP / NCLX chunks (AVIF, JXL, PNG)
      this.inspectCICP(tags, result, buffer, ext);

      // Inspect ICC Profile
      this.inspectICC(tags, result);

    } catch (e) {
      // Fallback: file might still be decodable
    }

    return result;
  }

  /**
   * Inspects XMP and binary markers for HDR gain maps
   */
  static inspectGainMap(tags, result, buffer) {
    const xmp = tags.xmp;
    if (!xmp) return;

    // ISO 21496-1 / Google Ultra HDR / Adobe Gain Map metadata
    // Tags like hdrgm:Version, hdrgm:GainMapMin, hdrgm:GainMapMax, hdrgm:HDRCapacityMax
    let hasGainMap = false;
    let minBoost = 1.0;
    let maxBoost = 4.0;
    let gamma = 1.0;
    let hdrCapacityMin = 1.0;
    let hdrCapacityMax = 4.0;

    for (const key of Object.keys(xmp)) {
      const lower = key.toLowerCase();
      if (lower.includes('gainmap') || lower.includes('hdrgm') || lower.includes('hdrgainmap')) {
        hasGainMap = true;
        const val = parseFloat(xmp[key].value || xmp[key].description);

        if (lower.includes('gainmapmax')) maxBoost = Math.pow(2, val);
        if (lower.includes('gainmapmin')) minBoost = Math.pow(2, val);
        if (lower.includes('gamma')) gamma = val;
        if (lower.includes('hdrcapacitymax')) hdrCapacityMax = Math.pow(2, val);
        if (lower.includes('hdrcapacitymin')) hdrCapacityMin = Math.pow(2, val);
      }
    }

    // Also check raw buffer string for Apple HDR gain map or ISO 21496-1 markers
    if (!hasGainMap) {
      const bufStr = buffer.toString('binary');
      if (bufStr.includes('urn:iso:std:iso:ts:21496:-1') || bufStr.includes('http://ns.apple.com/HDRGainMap/1.0/')) {
        hasGainMap = true;
        maxBoost = 4.0;
      }
    }

    if (hasGainMap) {
      result.isHDR = true;
      result.hdrType = 'gain_map';
      result.transferFunction = 'ISO 21496-1 Gain Map';
      result.bitDepth = '10-bit equivalent';
      result.gainMap = {
        minBoost: Number(minBoost.toFixed(2)),
        maxBoost: Number(maxBoost.toFixed(2)),
        gamma,
        hdrCapacityMin,
        hdrCapacityMax
      };
      result.maxCLL = Math.round(maxBoost * 250); // Estimated peak nits
    }
  }

  /**
   * Inspects cICP / NCLX chunks (AVIF, JXL, PNG)
   */
  static inspectCICP(tags, result, buffer, ext) {
    // Check extension defaults
    if (ext === '.avif') {
      result.bitDepth = '10-bit integer';
    } else if (ext === '.jxl') {
      result.bitDepth = '16-bit float';
    }

    // Check raw cICP or NCLX bytes in container
    const bufStr = buffer.toString('binary');
    
    // Look for 'colr' box with 'nclx'
    const colrIdx = bufStr.indexOf('colrnclx');
    if (colrIdx !== -1) {
      const pIdx = colrIdx + 8;
      const primaries = buffer.readUInt16BE(pIdx);
      const transfer = buffer.readUInt16BE(pIdx + 2);

      // Primaries
      if (primaries === 9) result.colorGamut = 'Rec.2020';
      else if (primaries === 12) result.colorGamut = 'Display P3';
      else if (primaries === 1) result.colorGamut = 'Rec.709';

      // Transfer
      if (transfer === 16) {
        result.transferFunction = 'SMPTE ST 2084 (PQ)';
        result.hdrType = 'pq_hdr';
        result.isHDR = true;
        result.maxCLL = 1000;
      } else if (transfer === 18) {
        result.transferFunction = 'HLG (BT.2100)';
        result.hdrType = 'hlg_hdr';
        result.isHDR = true;
        result.maxCLL = 1000;
      }
    }
  }

  /**
   * Inspects ICC Profile for Wide Color Gamuts
   */
  static inspectICC(tags, result) {
    if (!tags.icc) return;

    for (const key of Object.keys(tags.icc)) {
      const desc = String(tags.icc[key].description || '').toLowerCase();
      if (desc.includes('display p3') || desc.includes('p3')) {
        result.colorGamut = 'Display P3';
      } else if (desc.includes('rec.2020') || desc.includes('bt.2020') || desc.includes('2020')) {
        result.colorGamut = 'Rec.2020';
      } else if (desc.includes('adobergb') || desc.includes('adobe rgb')) {
        result.colorGamut = 'Adobe RGB';
      } else if (desc.includes('linear')) {
        result.transferFunction = 'Linear Float';
        result.isHDR = true;
      }
    }
  }

  /**
   * Parses Radiance HDR (.hdr / .pic) header
   */
  static async parseRadianceHeader(filePath, result) {
    result.colorGamut = 'sRGB Primaries (Linear)';
    result.transferFunction = 'Linear Radiance';
    result.bitDepth = '32-bit RGBE (Float)';
    result.hdrType = 'linear_float';
    result.isHDR = true;
    result.maxCLL = 4000;

    try {
      const fd = await fs.promises.open(filePath, 'r');
      const buf = Buffer.alloc(1024);
      await fd.read(buf, 0, 1024, 0);
      await fd.close();
      const text = buf.toString('ascii');

      // Look for resolution line: -Y <height> +X <width>
      const resMatch = text.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
      if (resMatch) {
        result.height = parseInt(resMatch[1], 10);
        result.width = parseInt(resMatch[2], 10);
        result.dimensions = `${result.width} × ${result.height}`;
      }
    } catch (e) {}

    return result;
  }

  /**
   * Parses OpenEXR (.exr) header
   */
  static async parseEXRHeader(filePath, result) {
    result.colorGamut = 'ACEScg / Rec.2020 Linear';
    result.transferFunction = 'Linear Float';
    result.bitDepth = '16-bit Half Float';
    result.hdrType = 'linear_float';
    result.isHDR = true;
    result.maxCLL = 4000;

    try {
      const fd = await fs.promises.open(filePath, 'r');
      const buf = Buffer.alloc(2048);
      await fd.read(buf, 0, 2048, 0);
      await fd.close();

      // Check EXR magic number: 0x76, 0x2f, 0x31, 0x01
      if (buf[0] === 0x76 && buf[1] === 0x2f && buf[2] === 0x31 && buf[3] === 0x01) {
        // Search for dataWindow attribute in header
        const str = buf.toString('latin1');
        const dwIdx = str.indexOf('dataWindow');
        if (dwIdx !== -1) {
          const valIdx = dwIdx + 10 + 4 + 4; // name + null + type + size
          const xMin = buf.readInt32LE(valIdx);
          const yMin = buf.readInt32LE(valIdx + 4);
          const xMax = buf.readInt32LE(valIdx + 8);
          const yMax = buf.readInt32LE(valIdx + 12);
          result.width = (xMax - xMin) + 1;
          result.height = (yMax - yMin) + 1;
          result.dimensions = `${result.width} × ${result.height}`;
        }
      }
    } catch (e) {}

    return result;
  }
}
