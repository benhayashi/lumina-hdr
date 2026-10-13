/**
 * Radiance HDR (.hdr / .pic) RGBE Decoder
 * Unpacks 32-bit RGBE pixels into Float32 linear RGB values
 */

import fs from 'node:fs';

export class RadianceHDRDecoder {
  /**
   * Decodes a .hdr file to linear float RGB pixel data
   * @param {string} filePath
   * @returns {Promise<{width: number, height: number, data: Float32Array}>}
   */
  static async decode(filePath) {
    const buffer = await fs.promises.readFile(filePath);
    let offset = 0;

    // Read header lines until empty line
    let headerStr = '';
    while (offset < buffer.length) {
      const lineEnd = buffer.indexOf(0x0a, offset);
      if (lineEnd === -1) break;
      const line = buffer.toString('ascii', offset, lineEnd).trim();
      offset = lineEnd + 1;
      if (line === '') break; // end of header
      headerStr += line + '\n';
    }

    // Read resolution line, e.g. "-Y 1080 +X 1920"
    const resLineEnd = buffer.indexOf(0x0a, offset);
    const resLine = buffer.toString('ascii', offset, resLineEnd).trim();
    offset = resLineEnd + 1;

    const resMatch = resLine.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
    if (!resMatch) {
      throw new Error(`Invalid HDR resolution string: ${resLine}`);
    }

    const height = parseInt(resMatch[1], 10);
    const width = parseInt(resMatch[2], 10);

    const floatData = new Float32Array(width * height * 4); // RGBA float32

    // Scanline decode
    for (let y = 0; y < height; y++) {
      if (offset >= buffer.length) break;

      // Check for new RLE format: 0x02, 0x02, width_high, width_low
      const r = buffer[offset];
      const g = buffer[offset + 1];
      const b = buffer[offset + 2];
      const e = buffer[offset + 3];

      if (r === 2 && g === 2 && (width < 32768) && ((b << 8) | e) === width) {
        offset += 4;
        const scanline = new Uint8Array(4 * width);

        for (let channel = 0; channel < 4; channel++) {
          let x = 0;
          while (x < width && offset < buffer.length) {
            const count = buffer[offset++];
            if (count > 128) {
              // Run
              const runLength = count - 128;
              const val = buffer[offset++];
              for (let i = 0; i < runLength; i++) {
                scanline[x + i + channel * width] = val;
              }
              x += runLength;
            } else {
              // Non-run
              for (let i = 0; i < count; i++) {
                scanline[x + i + channel * width] = buffer[offset++];
              }
              x += count;
            }
          }
        }

        // Convert scanline RGBE to float
        for (let x = 0; x < width; x++) {
          const sR = scanline[x];
          const sG = scanline[x + width];
          const sB = scanline[x + 2 * width];
          const sE = scanline[x + 3 * width];

          const destIdx = (y * width + x) * 4;
          if (sE === 0) {
            floatData[destIdx] = 0;
            floatData[destIdx + 1] = 0;
            floatData[destIdx + 2] = 0;
            floatData[destIdx + 3] = 1.0;
          } else {
            const exp = Math.pow(2.0, sE - 128.0 - 8.0);
            floatData[destIdx] = sR * exp;
            floatData[destIdx + 1] = sG * exp;
            floatData[destIdx + 2] = sB * exp;
            floatData[destIdx + 3] = 1.0;
          }
        }
      } else {
        // Old uncompressed format for this scanline
        for (let x = 0; x < width; x++) {
          const uR = buffer[offset++];
          const uG = buffer[offset++];
          const uB = buffer[offset++];
          const uE = buffer[offset++];

          const destIdx = (y * width + x) * 4;
          if (uE === 0) {
            floatData[destIdx] = 0;
            floatData[destIdx + 1] = 0;
            floatData[destIdx + 2] = 0;
            floatData[destIdx + 3] = 1.0;
          } else {
            const exp = Math.pow(2.0, uE - 128.0 - 8.0);
            floatData[destIdx] = uR * exp;
            floatData[destIdx + 1] = uG * exp;
            floatData[destIdx + 2] = uB * exp;
            floatData[destIdx + 3] = 1.0;
          }
        }
      }
    }

    return { width, height, data: floatData };
  }
}
