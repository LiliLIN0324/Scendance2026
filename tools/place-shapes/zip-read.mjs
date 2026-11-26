/**
 * 最小 zip 读取器（无依赖）。
 *
 * Geofabrik 的 `*-free.shp.zip` 是普通 deflate 打包、条目平铺、无加密，
 * 只需要「按名字取一条」这一种能力——不值得为它加一条根依赖或调外部解压。
 *
 * 上限：单条目解压后 < 2 GB（readUInt32 字段），不支持 ZIP64/分卷/加密。
 * Geofabrik 现有省份包每个条目最大约 110 MB，余量充足。
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocd(buf) {
  // 注释最长 65535，从尾部往前找签名。
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function listEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 zip：找不到中央目录');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CENTRAL_SIG) {
      throw new Error('zip 中央目录损坏');
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, compSize, uncompSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const { method, compSize, localOff } = entry;
  if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOCAL_SIG) {
    throw new Error('zip 本地头损坏');
  }
  const nameLen = buf.readUInt16LE(localOff + 26);
  const extraLen = buf.readUInt16LE(localOff + 28);
  const start = localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + compSize);
  if (method === 0) return Buffer.from(raw);
  if (method === 8) return inflateRawSync(raw);
  throw new Error(`不支持的 zip 压缩方式 ${method}`);
}

/**
 * 打开一个 zip：条目名是平铺的（无目录前缀），但按 `/后缀` 兜底一次，
 * 万一以后换成带目录的包也能用。
 */
export function openZip(path) {
  const buf = readFileSync(path);
  const entries = listEntries(buf);
  const resolve = (name) => {
    if (entries.has(name)) return name;
    const tail = `/${name}`;
    for (const key of entries.keys()) if (key.endsWith(tail)) return key;
    return null;
  };
  return {
    path,
    names: [...entries.keys()],
    has: (name) => resolve(name) !== null,
    read(name) {
      const key = resolve(name);
      return key === null ? null : readEntry(buf, entries.get(key));
    },
    /** 读纯文本条目（README 里带快照时间戳）。 */
    readText(name) {
      const data = this.read(name);
      return data ? data.toString('utf8') : null;
    },
  };
}

/** README 里的 `data as of 2026-02-10T21:21:11Z` → 时间戳字符串。 */
export function snapshotFromReadme(text) {
  const hit = /as of (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(String(text ?? ''));
  return hit ? hit[1] : null;
}