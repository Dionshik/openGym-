/* Picture files built by hand for the photo-store tests. No image library is involved on either
   side — the store never decodes a picture, it reads the container: which segments a JPEG has,
   which chunks a WebP has. So a fixture only has to be a faithful container, and building it
   here means a test can say exactly which metadata it put in and check that it came out. */

const u16 = n => Buffer.from([n >> 8, n & 0xff]);
export const seg = (marker, payload) => {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'latin1');
  return Buffer.concat([Buffer.from([0xff, marker]), u16(p.length + 2), p]);
};

export const GPS = 'GPS 55.7558N 37.6173E';
export const JFIF = seg(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0');
export const SCAN = Buffer.concat([seg(0xda, Buffer.from([1, 2, 3])), Buffer.from('scan-data-\xff\x00-with-a-stuffed-byte', 'latin1'), Buffer.from([0xff, 0xd9])]);

/** A JPEG container: JFIF, optional EXIF (with a position in it), IPTC and a comment, a table, the scan. */
export function jpeg({ exif = true, iptc = true, comment = true, fill = 0, body = 64 } = {}) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    JFIF,
    ...(exif ? [seg(0xe1, 'Exif\0\0' + GPS + ' iPhone 15 2026:10:01 08:15:00')] : []),
    ...(iptc ? [seg(0xed, 'Photoshop 3.0\x008BIM city=Moscow')] : []),
    ...(comment ? [seg(0xfe, 'shot at home')] : []),
    Buffer.alloc(fill, 0xff),                       // fill bytes some encoders put before a marker
    seg(0xdb, Buffer.alloc(body, 7)),
    SCAN
  ]);
}

const chunk = (tag, payload) => {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'latin1');
  const head = Buffer.alloc(8);
  head.write(tag, 0, 'latin1'); head.writeUInt32LE(p.length, 4);
  return Buffer.concat([head, p, Buffer.alloc(p.length & 1)]);
};
/** A WebP container: the extended header, the picture chunk, and optionally EXIF and XMP chunks. */
export function webp({ exif = true, xmp = true, body = 61 } = {}) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = (exif ? 0x08 : 0) | (xmp ? 0x04 : 0) | 0x10;        // 0x10: alpha — a flag that must survive
  const chunks = Buffer.concat([
    chunk('VP8X', vp8x),
    chunk('VP8 ', Buffer.alloc(body, 9)),
    ...(exif ? [chunk('EXIF', 'Exif\0\0' + GPS)] : []),
    ...(xmp ? [chunk('XMP ', '<x:xmpmeta>home</x:xmpmeta>')] : [])
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + chunks.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, chunks]);
}

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
export const b64 = buf => buf.toString('base64');
