/**
 * Minimal EXIF reader for JPEG files: only the fields CivicLens uses (GPS
 * position, its accuracy, and when the photo was taken). Needed in the
 * browser, where the photo picker returns no EXIF data. The output uses the
 * same keys as the native picker, so geoFixFromExif handles both.
 *
 * Every offset is bounds-checked; malformed data yields undefined fields,
 * never an exception.
 */
export type JpegExif = {
  GPSLatitude?: number[];
  GPSLatitudeRef?: string;
  GPSLongitude?: number[];
  GPSLongitudeRef?: string;
  GPSHPositioningError?: number;
  DateTimeOriginal?: string;
};

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME_ORIGINAL = 0x9003;
const GPS_LAT_REF = 0x01;
const GPS_LAT = 0x02;
const GPS_LON_REF = 0x03;
const GPS_LON = 0x04;
const GPS_H_POSITIONING_ERROR = 0x1f;

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;
const TYPE_FLOAT = 11;
const TYPE_DOUBLE = 12;
const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 };

/** Locates the TIFF block inside the JPEG's APP1 "Exif" segment. */
const findTiff = (bytes: Uint8Array): { start: number; end: number } | undefined => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] as number;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return undefined; // image data or end: no EXIF before it
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers without a length
      continue;
    }
    const length = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return undefined;
    const start = offset + 4;
    if (
      marker === 0xe1 &&
      length >= 8 &&
      bytes[start] === 0x45 && // E
      bytes[start + 1] === 0x78 && // x
      bytes[start + 2] === 0x69 && // i
      bytes[start + 3] === 0x66 && // f
      bytes[start + 4] === 0 &&
      bytes[start + 5] === 0
    ) {
      return { start: start + 6, end };
    }
    offset = end;
  }
  return undefined;
};

interface Entry {
  type: number;
  count: number;
  /** Position of the 4-byte value/offset field. */
  valuePos: number;
}

class Tiff {
  private readonly view: DataView;
  private readonly little: boolean;

  constructor(bytes: Uint8Array, start: number, end: number) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
    const order = this.view.byteLength >= 8 ? this.view.getUint16(0, false) : 0;
    if (order !== 0x4949 && order !== 0x4d4d) throw new Error('not TIFF');
    this.little = order === 0x4949;
    if (this.u16(2) !== 42) throw new Error('not TIFF');
  }

  private fits(pos: number, size: number): boolean {
    return pos >= 0 && size >= 0 && pos + size <= this.view.byteLength;
  }

  u16(pos: number): number {
    return this.fits(pos, 2) ? this.view.getUint16(pos, this.little) : NaN;
  }

  u32(pos: number): number {
    return this.fits(pos, 4) ? this.view.getUint32(pos, this.little) : NaN;
  }

  firstIfd(): number {
    return this.u32(4);
  }

  /** Entries of the IFD at `pos`, keyed by tag. Empty when out of bounds. */
  ifd(pos: number): Map<number, Entry> {
    const entries = new Map<number, Entry>();
    const n = this.u16(pos);
    if (!Number.isFinite(n) || n > 1024 || !this.fits(pos + 2, n * 12)) return entries;
    for (let i = 0; i < n; i++) {
      const at = pos + 2 + i * 12;
      entries.set(this.u16(at), { type: this.u16(at + 2), count: this.u32(at + 4), valuePos: at + 8 });
    }
    return entries;
  }

  /** Where an entry's data lives: inline when it fits in 4 bytes, else at an offset. */
  private dataPos(e: Entry): number | undefined {
    const size = (TYPE_SIZES[e.type] ?? 0) * e.count;
    if (!size || size > 1 << 20) return undefined;
    const pos = size <= 4 ? e.valuePos : this.u32(e.valuePos);
    return this.fits(pos, size) ? pos : undefined;
  }

  ascii(e: Entry | undefined): string | undefined {
    if (!e || e.type !== TYPE_ASCII) return undefined;
    const pos = this.dataPos(e);
    if (pos === undefined) return undefined;
    let s = '';
    for (let i = 0; i < e.count; i++) {
      const c = this.view.getUint8(pos + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim() || undefined;
  }

  offset(e: Entry | undefined): number | undefined {
    if (!e || e.count !== 1) return undefined;
    const v = e.type === TYPE_LONG ? this.u32(e.valuePos) : e.type === TYPE_SHORT ? this.u16(e.valuePos) : NaN;
    return Number.isFinite(v) ? v : undefined;
  }

  /**
   * Numeric values. The EXIF spec uses RATIONAL for GPS fields, but some
   * writers use SHORT, LONG, FLOAT or DOUBLE, so all are accepted.
   */
  numbers(e: Entry | undefined): number[] | undefined {
    if (!e) return undefined;
    const size = TYPE_SIZES[e.type];
    const numeric = [TYPE_SHORT, TYPE_LONG, TYPE_RATIONAL, TYPE_SRATIONAL, TYPE_FLOAT, TYPE_DOUBLE];
    if (!size || !numeric.includes(e.type)) return undefined;
    const pos = this.dataPos(e);
    if (pos === undefined) return undefined;
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) {
      const at = pos + i * size;
      let v: number;
      if (e.type === TYPE_SHORT) v = this.view.getUint16(at, this.little);
      else if (e.type === TYPE_LONG) v = this.view.getUint32(at, this.little);
      else if (e.type === TYPE_FLOAT) v = this.view.getFloat32(at, this.little);
      else if (e.type === TYPE_DOUBLE) v = this.view.getFloat64(at, this.little);
      else {
        const signed = e.type === TYPE_SRATIONAL;
        const num = signed ? this.view.getInt32(at, this.little) : this.view.getUint32(at, this.little);
        const den = signed ? this.view.getInt32(at + 4, this.little) : this.view.getUint32(at + 4, this.little);
        if (den === 0) return undefined;
        v = num / den;
      }
      if (!Number.isFinite(v)) return undefined;
      out.push(v);
    }
    return out;
  }
}

/** Reads GPS and capture time from a JPEG. Returns undefined when the file has no readable EXIF. */
export const readJpegExif = (bytes: Uint8Array): JpegExif | undefined => {
  const block = findTiff(bytes);
  if (!block) return undefined;
  let tiff: Tiff;
  try {
    tiff = new Tiff(bytes, block.start, block.end);
  } catch {
    return undefined;
  }
  const out: JpegExif = {};
  const ifd0 = tiff.ifd(tiff.firstIfd());

  const exifPos = tiff.offset(ifd0.get(TAG_EXIF_IFD));
  if (exifPos !== undefined) {
    const dto = tiff.ascii(tiff.ifd(exifPos).get(TAG_DATETIME_ORIGINAL));
    if (dto) out.DateTimeOriginal = dto;
  }

  const gpsPos = tiff.offset(ifd0.get(TAG_GPS_IFD));
  if (gpsPos !== undefined) {
    const gps = tiff.ifd(gpsPos);
    const lat = tiff.numbers(gps.get(GPS_LAT));
    const lon = tiff.numbers(gps.get(GPS_LON));
    // Both coordinates or neither: half a position is no position.
    if (lat?.length && lon?.length) {
      out.GPSLatitude = lat;
      out.GPSLongitude = lon;
      out.GPSLatitudeRef = tiff.ascii(gps.get(GPS_LAT_REF));
      out.GPSLongitudeRef = tiff.ascii(gps.get(GPS_LON_REF));
      const err = tiff.numbers(gps.get(GPS_H_POSITIONING_ERROR))?.[0];
      if (err !== undefined) out.GPSHPositioningError = err;
    }
  }
  return out;
};

/** EXIF lives in the first 64 KB segment after the file header; this covers it with room to spare. */
const EXIF_SCAN_BYTES = 512 * 1024;

/** Reads EXIF from a photo the browser can fetch (blob:, data: or same-origin URL) or from a File. */
export const readExifFromPhoto = async (uri: string, file?: Blob): Promise<JpegExif | undefined> => {
  try {
    const blob = file ?? (await (await fetch(uri)).blob());
    return readJpegExif(new Uint8Array(await blob.slice(0, EXIF_SCAN_BYTES).arrayBuffer()));
  } catch {
    return undefined;
  }
};
