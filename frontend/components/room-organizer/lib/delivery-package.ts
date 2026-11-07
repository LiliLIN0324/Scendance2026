/**
 * MP-DEL 一键交付包（SC-12）——把「效果图 ×3 / 平面 DXF / 物料 CSV / 分享链接」
 * 按 docs/36 §2 装进一个 zip，并写 manifest.json + README.txt。
 *
 * 三条硬规则：
 * 1. 只打「确认版」：版本号、快照号、内容指纹均由调用方从确认记录带进来；
 *    打包前用当前布局重算指纹，不一致直接拒绝——不让草案冒充正式版。
 * 2. 逐产物可定位：单件失败按 §6 归码进 missing[]，其余照常打包，整体标 incomplete。
 * 3. 同版字节可比对：zip 用固定时间戳（delivery-zip），manifest 之外的文件
 *    同内容同字节；重复打包只应差 generatedAt。
 *
 * 打图走调用方注入的 captureImage（与效果图册同一条渲染路径），本模块不碰 three。
 */
import { contentFingerprintOfLayout, snapshotIdFor } from './delivery-version';
import {
  DELIVERY_ARTIFACTS,
  DELIVERY_PACKAGE_FORMAT,
  DELIVERY_PACKAGE_VERSION,
  DELIVERY_RETRY,
  DELIVERY_SCENE_FORMAT,
  DELIVERY_SCENE_FORMAT_VERSION,
  deliveryArtifactPath,
  deliveryPackageRoot,
  isRetryableDeliveryCode,
  type DeliveryArtifactKind,
  type DeliveryArtifactSpec,
  type DeliveryFailureCode,
  type DeliveryManifest,
  type DeliveryManifestEntry,
} from './delivery-package-spec';
import { zipStore, type ZipEntry } from './delivery-zip';
import { layoutToDxf } from './plan-export/dxf';
import { encodeShareUrl, isShareUrlReasonablySized } from './share';
import { deliveryScene, sceneDeliveryCsv } from './scene-delivery';
import { reviewShareHref } from '../../review-share-page/load-plan';
import type { CameraPreset, RoomLayout } from './types';

/** 三个机位与效果图册同源，取前三张：整体、俯视、正面。 */
const HERO_VIEWS: ReadonlyArray<{ view: CameraPreset; label: string }> = [
  { view: 'iso', label: '整体' },
  { view: 'top', label: '俯视' },
  { view: 'front', label: '正面' },
];

export type DeliveryCapture = (view: CameraPreset) => Promise<string | null>;

export interface DeliveryPackageIdentity {
  deliveryVersion: string;
  snapshotId: string;
  contentFingerprint: string;
  status: 'confirmed';
}

export interface DeliveryReusedArtifact {
  sha256: string;
  bytes: Uint8Array;
}

export interface DeliveryRetryReceipt {
  path: string;
  attempt: number;
  code: DeliveryFailureCode;
  detail: string;
  waitedMs: number;
}

export interface DeliveryPackageFile extends Omit<DeliveryManifestEntry, 'bytes'> {
  bytes: Uint8Array;
}

export interface DeliveryPackageResult {
  /** 包根目录名：幕景_<项目>_v<主>.<次> */
  root: string;
  /** 下载文件名（root + .zip） */
  fileName: string;
  zip: Uint8Array;
  manifest: DeliveryManifest;
  /** 包内全部文件（含 manifest.json / README.txt），顺序即 zip 写入顺序。 */
  files: DeliveryPackageFile[];
  missing: DeliveryManifest['missing'];
  retries: DeliveryRetryReceipt[];
  /** 每个产物实际尝试次数；重试证据从这里读。 */
  attempts: Record<string, number>;
  shareUrl: string | null;
}

export interface DeliveryPackageInput {
  layout: RoomLayout;
  identity: DeliveryPackageIdentity;
  generatedAt: string;
  /**
   * 这一版被确认的时间（B1 记录里的 confirmedAt）。物料 CSV 的「生成时间」写它，
   * 不写本次打包时间——同一版重复打包时 CSV 才能逐字节复现，manifest 也只差时间戳。
   */
  confirmedAt?: string | undefined;
  /** 评审链接的前缀，例如 window.location.origin。 */
  shareOrigin: string;
  captureImage?: DeliveryCapture | undefined;
  /** 续跑：上次成功的产物（按相对路径），sha256 命中即复用，不重新渲染。 */
  reuse?: ReadonlyMap<string, DeliveryReusedArtifact> | undefined;
  /** 测试/证据可替换；默认真实等待退避。 */
  wait?: ((ms: number) => Promise<void>) | undefined;
  onProgress?: ((stage: string) => void) | undefined;
}

export class DeliveryArtifactError extends Error {
  constructor(public readonly code: DeliveryFailureCode, message: string) {
    super(message);
    this.name = 'DeliveryArtifactError';
  }
}

/** 按 docs/36 §6 归码。先认自己抛的码，再按错误文案兜底，最后落 render-failed。 */
export function classifyDeliveryFailure(error: unknown): { code: DeliveryFailureCode; detail: string } {
  if (error instanceof DeliveryArtifactError) return { code: error.code, detail: error.message };
  const detail = error instanceof Error ? error.message : String(error ?? '');
  if (/完整场景预设/.test(detail)) return { code: 'preset-unsupported', detail };
  if (/建筑入口/.test(detail)) return { code: 'entrance-unsupported', detail };
  if (/多层方案|MULTI_FLOOR/.test(detail)) return { code: 'preset-unsupported', detail };
  if (/没有楼层|no floor/i.test(detail)) return { code: 'no-floor', detail };
  if (/超过.*字符|链接过长|超预算|over budget/i.test(detail)) return { code: 'share-over-budget', detail };
  if (/内存|OOM|out of memory|Array buffer allocation/i.test(detail)) return { code: 'memory', detail };
  if (/超时|timeout|timed out/i.test(detail)) return { code: 'timeout', detail };
  if (/Failed to fetch|NetworkError|Load failed|网络|fetch/i.test(detail)) return { code: 'network', detail };
  if (/模型尚未|资产|贴图|纹理/.test(detail)) return { code: 'asset-fetch', detail };
  return { code: 'render-failed', detail: detail || '未知错误' };
}

export function defaultDeliveryWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function specOf(kind: DeliveryArtifactKind): DeliveryArtifactSpec {
  const spec = DELIVERY_ARTIFACTS.find((entry) => entry.kind === kind);
  if (!spec) throw new Error(`交付包规格缺少 ${kind}。`);
  return spec;
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const prefix = 'data:image/png;base64,';
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith(prefix) || comma < 0) throw new DeliveryArtifactError('render-failed', '效果图不是 PNG，未打包。');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new DeliveryArtifactError('render-failed', '效果图内容不是有效 PNG，未打包。');
  }
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('交付包需要安全连接或本机浏览器。');
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface ArtifactOutcome {
  path: string;
  ok: boolean;
  bytes?: Uint8Array;
  sha256?: string;
  code?: DeliveryFailureCode;
  detail?: string;
}

type KindedOutcome = ArtifactOutcome & { kind: DeliveryArtifactKind };

export async function buildDeliveryPackage(input: DeliveryPackageInput): Promise<DeliveryPackageResult> {
  const { layout, identity } = input;
  if (!globalThis.crypto?.subtle) throw new Error('交付包需要安全连接或本机浏览器。');
  const fingerprint = await contentFingerprintOfLayout(layout);
  if (fingerprint !== identity.contentFingerprint) throw new Error('当前方案与确认版不一致，请重新确认这一版再打包。');
  if (snapshotIdFor(fingerprint) !== identity.snapshotId) throw new Error('快照号与内容指纹对不上，请重新确认这一版。');
  const root = deliveryPackageRoot(layout.name, identity.deliveryVersion);
  const generatedAt = input.generatedAt;
  const wait = input.wait ?? defaultDeliveryWait;
  const retries: DeliveryRetryReceipt[] = [];
  const attempts: Record<string, number> = {};

  const run = async (path: string, task: () => Promise<Uint8Array>): Promise<ArtifactOutcome> => {
    const reused = input.reuse?.get(path);
    if (reused) {
      const sha256 = await sha256Hex(reused.bytes);
      if (sha256 === reused.sha256) {
        attempts[path] = 0;
        input.onProgress?.(`复用 ${path}`);
        return { path, ok: true, bytes: reused.bytes, sha256 };
      }
    }
    let count = 0;
    for (;;) {
      count++;
      try {
        const bytes = await task();
        attempts[path] = count;
        const sha256 = await sha256Hex(bytes);
        return { path, ok: true, bytes, sha256 };
      } catch (error) {
        const { code, detail } = classifyDeliveryFailure(error);
        if (!isRetryableDeliveryCode(code) || count >= DELIVERY_RETRY.maxAttempts) {
          attempts[path] = count;
          return { path, ok: false, code, detail };
        }
        const waitedMs = DELIVERY_RETRY.backoffMs[count - 1] ?? DELIVERY_RETRY.backoffMs[DELIVERY_RETRY.backoffMs.length - 1] ?? 4000;
        retries.push({ path, attempt: count, code, detail, waitedMs });
        input.onProgress?.(`${path} 失败（${detail}），${Math.round(waitedMs / 1000)} 秒后重试`);
        await wait(waitedMs);
      }
    }
  };

  const heroSpec = specOf('hero');
  const heroes: KindedOutcome[] = [];
  // 顺序取图：captureRenderImage 会临时改 renderer 尺寸，并发会把画面搅乱。
  for (const [index, { view, label }] of HERO_VIEWS.entries()) {
    const path = deliveryArtifactPath(heroSpec, index + 1);
    input.onProgress?.(`效果图 ${index + 1}/3 · ${label}`);
    const outcome = await run(path, async () => {
      const capture = input.captureImage;
      if (!capture) throw new DeliveryArtifactError('render-failed', '当前工作台没有可用的渲染画布，取不到效果图。');
      const dataUrl = await capture(view);
      if (!dataUrl) throw new DeliveryArtifactError('render-failed', `${label}机位没有取到画面。`);
      return dataUrlBytes(dataUrl);
    });
    heroes.push({ ...outcome, kind: 'hero' });
  }
  const floorSpec = specOf('floor');
  const floor = layout.floors[0];
  const floorPath = deliveryArtifactPath(floorSpec, 1, floor?.name);
  input.onProgress?.('平面图');
  const floorOutcome = await run(floorPath, async () => {
    if (!floor) throw new DeliveryArtifactError('no-floor', '当前方案没有楼层，出不了平面图。');
    // 与物料/场景共用同一道交付门槛：多层、完整场景预设、建筑入口都在这里统一拒绝。
    deliveryScene(layout);
    return textBytes(layoutToDxf(layout, floor));
  });

  const materialsSpec = specOf('materials');
  const materialsPath = deliveryArtifactPath(materialsSpec, 1);
  input.onProgress?.('物料清单');
  const materialsOutcome = await run(materialsPath, async () => {
    if (!layout.floors.length) throw new DeliveryArtifactError('no-floor', '当前方案没有楼层，无法生成物料清单。');
    return textBytes(sceneDeliveryCsv(layout, { id: identity.snapshotId, generatedAt: input.confirmedAt ?? generatedAt }));
  });

  const shareSpec = specOf('share');
  const sharePath = deliveryArtifactPath(shareSpec, 1);
  input.onProgress?.('分享链接');
  let shareUrl: string | null = null;
  const shareOutcome = await run(sharePath, async () => {
    const encoded = await encodeShareUrl(layout, input.shareOrigin);
    const url = reviewShareHref(input.shareOrigin, new URL(encoded.url).hash);
    if (!url) throw new DeliveryArtifactError('render-failed', '评审链接没有生成。');
    if (!isShareUrlReasonablySized(url)) {
      throw new DeliveryArtifactError('share-over-budget', `分享链接 ${url.length} 字符，超过离线链接预算，未打进包。`);
    }
    if (encoded.identity.snapshotId !== identity.snapshotId || encoded.identity.contentFingerprint !== identity.contentFingerprint) {
      throw new DeliveryArtifactError('render-failed', '分享身份与确认版不一致，请重新确认这一版。');
    }
    shareUrl = url;
    return textBytes(shareText({ layout, identity, url }));
  });

  const outcomes: KindedOutcome[] = [
    ...heroes,
    { ...floorOutcome, kind: 'floor' },
    { ...materialsOutcome, kind: 'materials' },
    { ...shareOutcome, kind: 'share' },
  ];
  const missing: DeliveryManifest['missing'] = outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => ({ kind: outcome.kind, code: outcome.code!, detail: outcome.detail ?? '' }));

  const files: DeliveryPackageFile[] = outcomes
    .filter((outcome) => outcome.ok)
    .map((outcome) => ({ kind: outcome.kind, path: outcome.path, bytes: outcome.bytes!, sha256: outcome.sha256! }));
  const writeOrder = [...files.map((file) => file.path)];

  const readmeText = deliveryReadme({ layout, identity, missing, shareUrl, root });
  const readmeBytes = textBytes(readmeText);
  const readmeSha = await sha256Hex(readmeBytes);
  files.push({ kind: 'readme', path: 'README.txt', bytes: readmeBytes, sha256: readmeSha });

  const manifest: DeliveryManifest = {
    format: DELIVERY_PACKAGE_FORMAT,
    packageVersion: DELIVERY_PACKAGE_VERSION,
    deliveryVersion: identity.deliveryVersion,
    snapshotId: identity.snapshotId,
    layoutId: layout.id ?? null,
    projectName: layout.name,
    generatedAt,
    sceneFormat: { format: DELIVERY_SCENE_FORMAT, version: DELIVERY_SCENE_FORMAT_VERSION },
    contentFingerprint: identity.contentFingerprint,
    status: missing.length ? 'incomplete' : 'complete',
    files: files.map(({ kind, path, bytes, sha256 }) => ({ kind, path, bytes: bytes.length, sha256 })),
    missing,
    share: shareUrl ? { url: shareUrl } : null,
  };
  const manifestBytes = textBytes(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha = await sha256Hex(manifestBytes);
  files.push({ kind: 'manifest', path: 'manifest.json', bytes: manifestBytes, sha256: manifestSha });
  // 写入顺序跟 DELIVERY_ARTIFACTS 一致：manifest 在 README 之前；两者内容都已算完。
  writeOrder.push('manifest.json', 'README.txt');

  const byPath = new Map(files.map((file) => [file.path, file]));
  const zipEntries: ZipEntry[] = writeOrder.map((path) => {
    const file = byPath.get(path)!;
    return { path: `${root}/${path}`, data: file.bytes };
  });
  const orderedFiles = writeOrder.map((path) => byPath.get(path)!);
  return {
    root,
    fileName: `${root}.zip`,
    zip: zipStore(zipEntries),
    manifest,
    files: orderedFiles,
    missing,
    retries,
    attempts,
    shareUrl,
  };
}

function shareText(input: {
  layout: RoomLayout;
  identity: DeliveryPackageIdentity;
  url: string;
}): string {
  return [
    '幕景 Scendance · 分享链接',
    `项目：${input.layout.name}`,
    `版本：${input.identity.deliveryVersion}（快照 ${input.identity.snapshotId}）`,
    '',
    '打开方式：把下面这行完整复制到浏览器地址栏，无需安装，手机也能看。',
    '',
    input.url,
    '',
    '说明：链接里是这一版方案的只读快照，之后在编辑器里改动不会自动更新它；',
    '需要新版请重新导出交付包，旧链接仍打开原来那一版。',
    '',
  ].join('\n');
}

function deliveryReadme(input: {
  layout: RoomLayout;
  identity: DeliveryPackageIdentity;
  missing: DeliveryManifest['missing'];
  shareUrl: string | null;
  root: string;
}): string {
  const floorName = input.layout.floors[0]?.name || '1F';
  const missingLines = input.missing.length
    ? input.missing.map((entry) => `- ${entry.kind}：${entry.detail}（${entry.code}）`)
    : [];
  return [
    `幕景 Scendance · 交付包`,
    `项目：${input.layout.name}`,
    `版本：${input.identity.deliveryVersion}`,
    `快照：${input.identity.snapshotId}`,
    `包根：${input.root}`,
    '',
    '这个包里有什么',
    '01-效果图/  3 张：整体、俯视、正面，1920×1080 PNG。给客户看效果，也用于内部对光。',
    `02-平面图/  1 张：${floorName} 平面 DXF，按真实米制绘制；在 CAD 里可直接量尺寸、排施工。`,
    '03-物料清单/  1 份：名称、尺寸、颜色、数量、采购状态；单价、损耗与报价尚未进包。',
    '04-分享/  1 份：只读评审链接，对方不用安装即可打开；链接与包内文件同属一个快照。',
    'manifest.json  机器可读清单：文件、字节数、sha256、版本身份与缺件原因。',
    '',
    '仍需人工确认',
    '- 采购规格、价格与损耗以最终确认为准；本包不含报价。',
    '- 效果图为布置示意，非实测；实物规格与颜色以最终确认为准。',
    '- 打印 PDF 请在编辑器的「打开按比例打印」里另存，本包只附 DXF。',
    ...(input.missing.length ? ['', '本包不完整，缺以下内容', ...missingLines] : []),
    '',
  ].join('\n');
}
