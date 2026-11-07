/**
 * 最小 ZIP 写入器（只存储、不压缩）——交付包要字节可比对。
 *
 * 不引第三方库的原因：现成库默认把 mtime 写成 `Date.now()`，同一版打两次包
 * 字节就不一样；这里把时间戳固定成 1980-01-01 00:00（ZIP 纪元），条目按传入
 * 顺序写、不带 extra/comment，同一份输入必然得到同一串字节。
 * 效果图本身就是 PNG（已压缩），DXF/CSV/JSON 体积很小，不压缩的代价可以接受。
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const VERSION = 20;
/** bit 11 = UTF-8 名称；中文目录名三端解包都不乱码。 */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
/** DOS 时间：1980-01-01 00:00。 */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

export interface ZipEntry {
  /** 包内路径，用 `/` 分隔；不得以 `/` 开头。 */
  path: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = crc32Table();
  let value = 0xffffffff;
  for (let index = 0; index < data.length; index++) value = table[(value ^ data[index]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

class Writer {
  private readonly bytes: Uint8Array;
  private offset = 0;
  constructor(size: number) { this.bytes = new Uint8Array(size); }
  u16(value: number): void {
    this.bytes[this.offset++] = value & 0xff;
    this.bytes[this.offset++] = (value >>> 8) & 0xff;
  }
  u32(value: number): void {
    this.bytes[this.offset++] = value & 0xff;
    this.bytes[this.offset++] = (value >>> 8) & 0xff;
    this.bytes[this.offset++] = (value >>> 16) & 0xff;
    this.bytes[this.offset++] = (value >>> 24) & 0xff;
  }
  raw(chunk: Uint8Array): void {
    this.bytes.set(chunk, this.offset);
    this.offset += chunk.length;
  }
  get position(): number { return this.offset; }
  finish(): Uint8Array { return this.bytes; }
}

export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  if (!entries.length) throw new Error('交付包没有任何文件。');
  if (entries.length > MAX_ENTRIES) throw new Error('交付包文件过多，超出 ZIP 上限。');
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    if (!entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..')) {
      throw new Error(`交付包路径不合法：${entry.path}`);
    }
    const name = encoder.encode(entry.path);
    const data = entry.data;
    if (data.length > MAX_UINT32) throw new Error(`“${entry.path}”超过 4 GB，ZIP 无法写入。`);
    return { name, data, crc: crc32(data) };
  });
  const seen = new Set<string>();
  for (const entry of prepared) {
    const key = new TextDecoder().decode(entry.name);
    if (seen.has(key)) throw new Error(`交付包路径重复：${key}`);
    seen.add(key);
  }
  const localSize = prepared.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = prepared.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const writer = new Writer(localSize + centralSize + 22);
  const offsets: number[] = [];
  for (const entry of prepared) {
    offsets.push(writer.position);
    writer.u32(LOCAL_HEADER);
    writer.u16(VERSION);
    writer.u16(FLAG_UTF8);
    writer.u16(METHOD_STORE);
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(entry.crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(entry.name.length);
    writer.u16(0);
    writer.raw(entry.name);
    writer.raw(entry.data);
  }
  const centralOffset = writer.position;
  prepared.forEach((entry, index) => {
    writer.u32(CENTRAL_HEADER);
    writer.u16(VERSION);
    writer.u16(VERSION);
    writer.u16(FLAG_UTF8);
    writer.u16(METHOD_STORE);
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(entry.crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(entry.name.length);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(offsets[index]);
    writer.raw(entry.name);
  });
  if (writer.position > MAX_UINT32) throw new Error('交付包超过 4 GB，ZIP 无法写入。');
  const centralBytes = writer.position - centralOffset;
  writer.u32(END_OF_CENTRAL);
  writer.u16(0);
  writer.u16(0);
  writer.u16(prepared.length);
  writer.u16(prepared.length);
  writer.u32(centralBytes);
  writer.u32(centralOffset);
  writer.u16(0);
  return writer.finish();
}
