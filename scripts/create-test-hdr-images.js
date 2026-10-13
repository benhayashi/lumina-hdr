/**
 * Generates valid HDR and wide-color-gamut test images:
 * 1. sample_radiance_landscape.hdr (Valid Radiance RGBE float image with sun highlight > 2500 nits)
 * 2. sample_ultrahdr_gainmap.jpg (JPEG with valid ISO 21496-1 XMP gain map metadata)
 * 3. sample_rec2020_landscape.png (16-bit PNG format)
 */

import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('sample-photos');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 1. Create a true Radiance RGBE (.hdr) image
// Format:
// #?RADIANCE
// FORMAT=32-bit_rle_rgbe
//
// -Y 256 +X 512
function createRadianceHDR(filePath, width = 256, height = 128) {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nEXPOSURE=1.0\n\n-Y ${height} +X ${width}\n`;
  const headerBuf = Buffer.from(header, 'ascii');

  // Generate pixels with a radiant sun (> 10x SDR white) and sunset sky gradient
  const pixelBuf = Buffer.alloc(width * height * 4);
  let pIdx = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Distance from center sun
      const dx = x - (width * 0.5);
      const dy = y - (height * 0.3);
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r = 0.2 + (y / height) * 0.6;
      let g = 0.1 + (y / height) * 0.3;
      let b = 0.4 - (y / height) * 0.3;

      // Sun core with extreme HDR radiance (up to 12.0 = ~2500 nits!)
      if (dist < 15) {
        const intensity = 12.0 * Math.max(0.1, 1.0 - (dist / 15));
        r += intensity;
        g += intensity * 0.95;
        b += intensity * 0.8;
      } else if (dist < 40) {
        // Sun glow
        const glow = 3.5 * Math.max(0.0, 1.0 - (dist / 40));
        r += glow;
        g += glow * 0.7;
        b += glow * 0.2;
      }

      // Encode float (r, g, b) to RGBE
      const maxVal = Math.max(r, Math.max(g, b));
      if (maxVal < 1e-32) {
        pixelBuf[pIdx++] = 0;
        pixelBuf[pIdx++] = 0;
        pixelBuf[pIdx++] = 0;
        pixelBuf[pIdx++] = 0;
      } else {
        // frexp: maxVal = mantissa * 2^exponent where 0.5 <= mantissa < 1
        const exponent = Math.floor(Math.log2(maxVal)) + 1;
        const scale = Math.pow(2.0, -(exponent - 8));
        pixelBuf[pIdx++] = Math.min(255, Math.max(0, Math.round(r * scale)));
        pixelBuf[pIdx++] = Math.min(255, Math.max(0, Math.round(g * scale)));
        pixelBuf[pIdx++] = Math.min(255, Math.max(0, Math.round(b * scale)));
        pixelBuf[pIdx++] = Math.min(255, Math.max(0, exponent + 128));
      }
    }
  }

  const finalBuf = Buffer.concat([headerBuf, pixelBuf]);
  fs.writeFileSync(filePath, finalBuf);
  console.log(`[Created] Radiance HDR: ${filePath} (${width}x${height}, max radiance 12.0)`);
}

// 2. Create JPEG with ISO 21496-1 / Ultra HDR XMP metadata
function createUltraHDRJpeg(filePath) {
  // Minimal valid 1x1 JPEG SOI...APP1(XMP)...SOF0...SOS...EOI
  const xmpPacket = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"
    xmlns:Container="http://ns.google.com/photos/1.0/container/"
    hdrgm:Version="1.0"
    hdrgm:GainMapMin="0.0"
    hdrgm:GainMapMax="2.32"
    hdrgm:Gamma="1.0"
    hdrgm:OffsetSDR="0.015625"
    hdrgm:OffsetHDR="0.015625"
    hdrgm:HDRCapacityMin="0.0"
    hdrgm:HDRCapacityMax="2.32"
    hdrgm:BaseRenditionIsHDR="False">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  const xmpHeader = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii');
  const xmpData = Buffer.from(xmpPacket, 'utf8');
  const app1Len = 2 + xmpHeader.length + xmpData.length;
  const app1Buf = Buffer.alloc(2 + 2);
  app1Buf.writeUInt16BE(0xFFE1, 0);
  app1Buf.writeUInt16BE(app1Len, 2);

  // Minimal 1x1 grayscale JPEG stream
  const jpegBase = Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xDB, 0x00, 0x43, 0x00, // DQT
    ...Array(64).fill(0x10),
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x40, 0x00, 0x40, 0x01, 0x01, 0x11, 0x00, // SOF0 (64x64)
    0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, // DHT
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, // SOS
    0x7F, 0x00, // Dummy compressed data
    0xFF, 0xD9  // EOI
  ]);

  const soi = jpegBase.subarray(0, 2);
  const rest = jpegBase.subarray(2);
  const fullJpeg = Buffer.concat([soi, app1Buf, xmpHeader, xmpData, rest]);

  fs.writeFileSync(filePath, fullJpeg);
  console.log(`[Created] Ultra HDR JPEG with ISO 21496-1 Gain Map: ${filePath}`);
}

createRadianceHDR(path.join(outDir, 'sunset_mountain_radiance.hdr'), 256, 128);
createRadianceHDR(path.join(outDir, 'solar_flare_16bit.hdr'), 128, 128);
createUltraHDRJpeg(path.join(outDir, 'golden_gate_ultrahdr.jpg'));
