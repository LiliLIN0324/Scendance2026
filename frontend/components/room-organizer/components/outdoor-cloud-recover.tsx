/**
 * 换设备「找回活动」选择框（2026-11-17）。
 *
 * 只在「这台设备没有本机草稿、云端却有活动」时出现；点「打开」才拉回整份活动。
 * 纯展示 + 回调，不自己读后端（读写在 outdoor-plan-adoption.ts）。
 */

import type { AdoptableActivity } from '../lib/outdoor-plan-adoption';

export interface OutdoorCloudRecoverProps {
  activities: AdoptableActivity[];
  /** 正在拉取的那条（按钮 disabled 防连点）。 */
  busyId?: string | null;
  onPick: (activity: AdoptableActivity) => void;
  onDismiss: () => void;
}

function formatWhen(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function OutdoorCloudRecover({ activities, busyId = null, onPick, onDismiss }: OutdoorCloudRecoverProps) {
  if (activities.length === 0) return null;
  return (
    <div
      role="dialog"
      aria-label="找回云端活动"
      data-testid="outdoor-cloud-recover"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(16, 16, 18, 0.38)',
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: 'calc(100vw - 40px)',
          padding: 18,
          borderRadius: 16,
          background: 'var(--sc-surface, #fff)',
          color: 'var(--sc-ink, #141416)',
          boxShadow: '0 18px 48px rgba(0,0,0,0.22)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>云端有你之前的活动</div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.66, lineHeight: 1.6 }}>
          这台设备上没有本机草稿。选一份继续编辑，打开后本机仍会先存一份。
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {activities.map(activity => {
            const busy = busyId === activity.activityId;
            const when = formatWhen(activity.updatedAt);
            return (
              <div
                key={activity.activityId}
                data-testid="outdoor-cloud-recover-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(20,20,22,0.10)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activity.name}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11, opacity: 0.6 }}>
                    版本 {activity.revision}
                    {when ? ` · ${when}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="outdoor-cloud-recover-open"
                  disabled={busy}
                  onClick={() => onPick(activity)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(20,20,22,0.16)',
                    background: 'transparent',
                    color: 'inherit',
                    fontSize: 12,
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  {busy ? '打开中…' : '打开'}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="outdoor-cloud-recover-dismiss"
            onClick={onDismiss}
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              opacity: 0.7,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            先不用
          </button>
        </div>
      </div>
    </div>
  );
}

export default OutdoorCloudRecover;
