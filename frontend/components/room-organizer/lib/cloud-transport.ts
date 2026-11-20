/**
 * 云端请求的传输层失败描述（2026-11-20）。
 *
 * 浏览器在网络层失败时只抛 TypeError("Failed to fetch")，不区分「跨域预检被拒」
 * 「域名解析失败」「断网」「服务未部署」；原样把这个字串甩到面板上，等于没交代。
 * 这里把能判定的几类收敛成一句话结论 + 一条处置建议，并带上当前页面来源——
 * 最常见的一种原因是当前访问地址不在云端服务的允许来源里，页面自己看不出来，
 * 但地址一摆出来就能对上。
 */

import { SceneApiError } from '../../../../client/scene-client';

/** 浏览器各内核的网络层失败文案：Chrome/Safari "Failed to fetch" / "Load failed"，Firefox "NetworkError"。 */
const TRANSPORT_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

export type CloudFailureKind = 'unreachable' | 'unauthorized' | 'forbidden' | 'unavailable';

export interface CloudFailureDescription {
  /** 机器可判的类别：页面可以据此换措辞或提示。 */
  kind: CloudFailureKind;
  /** 一句话结论。 */
  message: string;
  /** 下一步该做什么。 */
  hint: string;
}

/** 当前页面来源；非浏览器环境为空串（服务端渲染或脚本里调用）。 */
function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/**
 * 连不上时的处置建议。
 *
 * 云端服务（scene-api）的允许来源是一份固定名单：本机只放行 3000，
 * 线上放行两个正式域名。换端口、换域名、用局域网 IP 打开，跨域预检都会在
 * 正式请求发出之前就被拒——页面照常打开，云端功能却全部失败。
 */
function unreachableHint(): string {
  const origin = currentOrigin();
  const where = origin ? `当前访问地址：${origin}。` : '';
  return `${where}最常见的原因是当前地址不在云端服务的允许来源里，跨域预检在正式请求发出前就被拒了。`
    + '本机开发请用 http://localhost:3000（云端服务只放行这个本机地址）；'
    + '换端口或换域名需要后端把该来源加入允许列表。';
}

/**
 * 判定并描述一次云端请求失败；判不出来时返回 null，由调用方按自己的口径处理。
 * 只覆盖「传输层没打通」和「服务端明确拒绝」两类，不吞掉调用方的业务语义。
 */
export function describeCloudFailure(error: unknown): CloudFailureDescription | null {
  if (error instanceof SceneApiError) {
    if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
      return {
        kind: 'unauthorized',
        message: '登录状态已失效，服务端没有认出这个账号。',
        hint: '重新登录后再打开这个页签。',
      };
    }
    if (error.status === 403) {
      return {
        kind: 'forbidden',
        message: '当前账号没有这个权限。',
        hint: '权限以服务端判定为准；需要更高角色请让管理员在服务端授权。',
      };
    }
    if (error.status === 503 || error.code === 'CLOUD_STORAGE_UNAVAILABLE') {
      return {
        kind: 'unavailable',
        message: '云端服务在这个环境上还没有接通。',
        hint: '后端需要部署对应的 Edge Function 与数据库能力。',
      };
    }
    return null;
  }
  if (error instanceof Error && TRANSPORT_FAILURE.test(error.message)) {
    return { kind: 'unreachable', message: '浏览器没能连上云端服务。', hint: unreachableHint() };
  }
  return null;
}
