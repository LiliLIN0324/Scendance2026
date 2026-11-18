// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRECT_BASE, findAholoAsset, listAholoAssets } from './aholo-assets';
import {
  EMPTY_SCAN_MESSAGE,
  NOT_SCAN_MESSAGE,
  NOT_SPLAT_MESSAGE,
  PROXY_OFF_MESSAGE,
  SCAN_UPLOAD_MAX_BYTES,
  scanDisplayName,
  splatKindFromHead,
  uploadScanFile,
  validateScanPick,
} from './scan-upload';

const ID = '6f1c2f5a-4a3b-4a4c-9d1d-8ca7e0d61b21';
const GZIP_SPZ = Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
const NGSP = Uint8Array.from([0x4e, 0x47, 0x53, 0x50, 0x02, 0x00, 0x00, 0x00]);
const PLY = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\n');
const JUNK = new TextEncoder().encode('<html>登录页</html>');

function spzFile(name = '新空间 2026-11-9.spz', bytes = GZIP_SPZ): File {
  return new File([bytes, new Uint8Array(64)], name, { type: 'application/octet-stream' });
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe('实景包上传：选文件当刻就能判的规则', () => {
  it('只收 .spz / .ply，其它后缀先说清楚怎么改', () => {
    expect(validateScanPick({ name: '场地.zip', size: 10 })).toBe(NOT_SCAN_MESSAGE);
    expect(validateScanPick({ name: '椅子.glb', size: 10 })).toBe(NOT_SCAN_MESSAGE);
    expect(validateScanPick({ name: '新空间.SPZ', size: 10 })).toBeNull();
    expect(validateScanPick({ name: 'D:/导出/场地.ply', size: 10 })).toBeNull();
  });

  it('空文件和超上限都挡在选择阶段，不白传几个 GB', () => {
    expect(validateScanPick({ name: 'a.spz', size: 0 })).toBe(EMPTY_SCAN_MESSAGE);
    const message = validateScanPick({ name: 'a.ply', size: SCAN_UPLOAD_MAX_BYTES + 1 });
    expect(message).toContain('2048 MB');
  });

  it('名字去掉目录和扩展名，空名有兜底', () => {
    expect(scanDisplayName('C:\\Users\\me\\Downloads\\新空间 2026-11-9.spz')).toBe('新空间 2026-11-9');
    expect(scanDisplayName('.ply')).toBe('上传的实景');
  });

  it('按文件头认类型：gzip 壳 SPZ、裸 SPZ、PLY 都认，网页垃圾不认', () => {
    expect(splatKindFromHead(GZIP_SPZ)).toBe('spz');
    expect(splatKindFromHead(NGSP)).toBe('spz');
    expect(splatKindFromHead(PLY)).toBe('ply');
    expect(splatKindFromHead(JUNK)).toBeNull();
    expect(splatKindFromHead(new Uint8Array([0x70, 0x6c]))).toBeNull();
  });
});

describe('实景包上传：落到本机资产代理并登记', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('字节直传 /asset/upload，回源地址仍是本机 <uuid>.spz', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ assetId: ID, kind: 'spz', bytes: 72, url: `/asset/${ID}.spz` }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const file = spzFile();
    const saved = await uploadScanFile(file, { name: file.name });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${DIRECT_BASE}/asset/upload`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
    expect(saved).toMatchObject({ assetId: ID, kind: 'spz', name: '新空间 2026-11-9', bytes: 72, savedAt: expect.any(Number) });
    // 列表读的是注册表：登记完立刻能在「我的实景扫描」里找到，地址由资产号推出。
    expect(findAholoAsset(ID)?.name).toBe('新空间 2026-11-9');
  });

  it('文件头对不上就在本地拒掉，不发请求也不留垃圾记录', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadScanFile(spzFile('假的.spz', JUNK))).rejects.toThrow(NOT_SPLAT_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listAholoAssets()).toHaveLength(0);
  });

  it('代理拒绝时把它给的原话带出来，不冒充成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: '文件超过 2048 MiB，未上传' }, 413) as unknown as Response));
    await expect(uploadScanFile(spzFile())).rejects.toThrow('文件超过 2048 MiB，未上传');
    expect(listAholoAssets()).toHaveLength(0);
  });

  it('代理认到的格式与文件头不一致时宁可不登记', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ assetId: ID, kind: 'glb', bytes: 72 }) as unknown as Response));
    await expect(uploadScanFile(spzFile())).rejects.toThrow(/认成 glb/);
    expect(findAholoAsset(ID)).toBeUndefined();
  });

  it('代理没起来时给一句能照着跑的提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(uploadScanFile(spzFile())).rejects.toThrow(PROXY_OFF_MESSAGE);
  });

  it('有进度回调时走 XHR，按钮能按百分比回话', async () => {
    const seen: number[] = [];
    class FakeXhr {
      static last: FakeXhr | null = null;
      upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
      status = 200;
      responseText = JSON.stringify({ assetId: ID, kind: 'spz', bytes: 72 });
      onload?: () => void;
      onerror?: () => void;
      ontout?: () => void;
      ontimeout?: () => void;
      onabort?: () => void;
      headers: Record<string, string> = {};
      open(): void {}
      setRequestHeader(name: string, value: string): void { this.headers[name] = value; }
      send(body: Blob): void {
        FakeXhr.last = this;
        // 先报一次 40%，再收尾；真实浏览器就是这个顺序。
        this.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 });
        FakeXhr.last.sent = body;
        queueMicrotask(() => this.onload?.());
      }
      sent?: Blob;
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('fetch', vi.fn());
    const saved = await uploadScanFile(spzFile(), { onProgress: (loaded, total) => seen.push(Math.round((loaded / total) * 100)) });
    expect(seen).toEqual([40]);
    expect(saved.assetId).toBe(ID);
    expect(FakeXhr.last?.headers['Content-Type']).toBe('application/octet-stream');
  });
});
