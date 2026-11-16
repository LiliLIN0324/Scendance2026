/**
 * 2026-11-17 云端副本状态条（地图顶部）。
 *
 * 两种形态：
 *  - 普通提示：云端副本没传上去 / 已换成服务器那版——一句话，不挡手；
 *  - **版本冲突**：另一台设备先存过，明确让用户二选一。不自动合并、不后写胜，
 *    点之前不动服务器，点完才写/读。
 */

export interface OutdoorSyncConflict {
  /** 服务器当前版本号。 */
  revision: number;
  /** 服务器那版的活动名（两边名字可能被改过）。 */
  name: string;
}

export interface OutdoorSyncBannerProps {  note?: string;
  conflict?: OutdoorSyncConflict | null;
  busy?: boolean;
  onUseMine?: (() => void) | undefined;
  onUseRemote?: (() => void) | undefined;
}

const shellStyle = {
  position: 'absolute' as const,
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 40,
  maxWidth: 520,
  padding: '8px 12px',
  borderRadius: 12,
  background: 'rgba(20, 20, 22, 0.88)',
  color: '#fff',
  fontSize: 12,
  lineHeight: 1.5,
  boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
};

const buttonStyle = {
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.28)',
  background: 'rgba(255,255,255,0.10)',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
};

export function OutdoorSyncBanner({
  note = '',
  conflict = null,
  busy = false,
  onUseMine,
  onUseRemote,
}: OutdoorSyncBannerProps) {
  if (!conflict && !note) return null;
  if (!conflict) {
    return (
      <div role="status" data-testid="outdoor-sync-banner" style={{ ...shellStyle, pointerEvents: 'none' }}>
        {note}
      </div>
    );
  }
  return (
    <div role="status" data-testid="outdoor-sync-banner" style={shellStyle}>
      {note ? (
        <div data-testid="outdoor-sync-note" style={{ marginBottom: 4, opacity: 0.86 }}>
          {note}
        </div>
      ) : null}
      <div>
        另一台设备已保存这份活动（版本 {conflict.revision}）。以哪一版为准？
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          data-testid="outdoor-sync-use-mine"
          style={buttonStyle}
          disabled={busy}
          onClick={onUseMine}
        >
          用我这版
        </button>
        <button
          type="button"
          data-testid="outdoor-sync-use-remote"
          style={buttonStyle}
          disabled={busy}
          onClick={onUseRemote}
        >
          用服务器那版
        </button>
      </div>
      <div style={{ marginTop: 6, opacity: 0.72 }}>
        「用我这版」会覆盖服务器；「用服务器那版」会丢掉本机这次改动。
      </div>
    </div>
  );
}

export default OutdoorSyncBanner;
