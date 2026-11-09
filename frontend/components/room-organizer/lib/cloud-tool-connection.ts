/**
 * 自由对话里的云端方案 / 群核入口：说清现在走哪条，能开就开真界面。
 *
 * 云端方案的工具时间线只在 `connection === '项目已连接'` 且云端运行写出步骤后出现。
 * 未到这一步时，本机仍会出预览，不能写成整条链路断了。
 *
 * 智能理解是另一道编译期开关：`NEXT_PUBLIC_AGENT_ENABLED==='1'` 才走模型。
 * 把近期对话发给模型还要 `NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED` 或
 * `NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED` 为 `'1'`。仓库示例这三项都是 `0`，
 * 正式包是否在构建时改成 `1`，仓库里没有记录。群核任务还要服务端配置密钥与条款后，
 * 能力接口才会广告文生 / 图生。本模块不读密钥。
 */

export function understandingLine(modelReady: boolean): string {
  return modelReady ? '输入文字可能发送至模型服务。' : '文字识别按本机规则处理。';
}

/** 方案生成这一行。本地预览在未连接时仍然可用。 */
export function planGenerationLine(connection: string | null | undefined): string {
  if (connection === '项目已连接') return '云端生成会发送当前场景及部分对话上下文。';
  if (connection === '正在准备工作台') return '正在连接云端方案生成，完成后可重试。当前仍用本机规则出预览。';
  if (connection === '功能已开放') return '当前用本机规则出预览。登录并取得编辑权后，可改为云端生成。';
  return '当前用本机规则出预览；连接云项目后可云端生成。';
}

export type AholoAskKind = 'text' | 'world' | 'recon';

export interface AholoAvailability {
  /** 场地生成面板已挂上（生成轨开着，且能打开）。 */
  spaceEntry: boolean;
  /** 已登录云项目，或本机直连通道可用。确认额度后才会真正提交。 */
  materialReady: boolean;
}

export interface AholoChatStep {
  text: string;
  /** 缺省表示这次开不了，文案里已经给出下一步。 */
  start?: 'space-world' | 'space-recon' | 'material';
}

/** 一句话：能开就说明正在打开；不能开就说明原因和下一步。不出现工具内部名字。 */
export function aholoChatStep(kind: AholoAskKind, available: AholoAvailability, photo = false): AholoChatStep {
  if (kind === 'world' || kind === 'recon') {
    if (!available.spaceEntry) return { text: '场地生成这次开不了：入口未开放。请联系管理员打开后再说一次。' };
    return kind === 'recon'
      ? { start: 'space-recon', text: '已打开场地重建。选好照片并确认额度后才会提交。' }
      : { start: 'space-world', text: '已打开场地生成，并带上你这句话。确认额度后才会提交。' };
  }
  if (!available.materialReady) return { text: '物件生成这次还不能提交。请先登录并连接云项目，再到物料里用描述或图片生成。' };
  return photo
    ? { start: 'material', text: '已打开物料生成。请选一张照片，确认额度后才会提交。' }
    : { start: 'material', text: '已打开物料生成，并带上你这句话。确认额度后才会提交。' };
}
