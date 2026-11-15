'use client';

/**
 * 监督档位选择器：严格 / 关键节点 / 自动。
 *
 * 对标谷地工坊的「需要我多久跟你确认一次？」——档位是常驻控件，不是藏进设置页，
 * 因为用户对「AI 会不会乱改我的方案」的放心程度是随场景变的：
 * 出草图时想让它快跑，交付前想每步都过一遍眼。
 *
 * 受控/非受控都支持：传了 value 就完全听父组件，没传就自己记在 localStorage。
 * 存的值认不出来时回落到「关键节点」（normalizeSupervision），比自动更保守。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  SUPERVISION_LEVELS,
  normalizeSupervision,
  supervisionLevelInfo,
  type SupervisionLevel,
} from '../lib/agent-supervision';

const STORAGE_KEY = 'scendance.agent.supervision';

function readStored(): SupervisionLevel {
  if (typeof window === 'undefined') return 'key-points';
  try {
    return normalizeSupervision(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // 隐私模式下 localStorage 会抛：读不到就按默认档，不因为读偏好失败挡住面板。
    return 'key-points';
  }
}

export function AgentSupervisionPicker({ value, onChange, disabled = false }: {
  /** 受控值；不传则自己从 localStorage 起。 */
  value?: SupervisionLevel | undefined;
  onChange?: ((level: SupervisionLevel) => void) | undefined;
  disabled?: boolean | undefined;
}): JSX.Element {
  const controlled = value !== undefined;
  const [stored, setStored] = useState<SupervisionLevel>(readStored);
  const current = controlled ? value! : stored;

  // 外部改了受控值时不回写自己那份，避免两套真值打架；非受控才落盘。
  useEffect(() => {
    if (controlled) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, stored);
    } catch {
      // 存不下就只当次生效，不影响本次选择。
    }
  }, [controlled, stored]);

  const pick = useCallback((level: SupervisionLevel) => {
    if (!controlled) setStored(level);
    onChange?.(level);
  }, [controlled, onChange]);

  const info = supervisionLevelInfo(current);

  return (
    <div className="ap-supervision" data-level={current}>
      <div className="ap-supervision-head">
        <span className="ap-supervision-title">需要我多久跟你确认一次？</span>
        <span className="ap-supervision-current">{info.label}</span>
      </div>
      <div role="group" aria-label="监督档位" className="ap-supervision-options">
        {SUPERVISION_LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            className="ap-supervision-option"
            aria-pressed={current === level.id}
            disabled={disabled}
            title={level.detail}
            onClick={() => pick(level.id)}
          >
            {level.label}
          </button>
        ))}
      </div>
      <p className="ap-supervision-detail">{info.detail}</p>
    </div>
  );
}
