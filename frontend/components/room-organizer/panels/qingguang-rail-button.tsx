/**
 * 原「布置」图标那一格。只放晴光头像，打开旁边的对话面板，不切换模式。
 * 评审、执行不占这一轨。
 */
export const QINGGUANG_RAIL_MASCOT = '/assets/assistant/qingguang-3d-40.png';

export function QingguangRailButton({ open, onOpen }: { open: boolean; onOpen(): void }): JSX.Element {
  return (
    <button
      type="button"
      className={`sc-rail-qingguang${open ? ' is-active' : ''}`}
      aria-expanded={open}
      aria-label="晴光"
      data-tip="晴光"
      title="晴光"
      onClick={onOpen}
    >
      <img src={QINGGUANG_RAIL_MASCOT} alt="" width={28} height={28} draggable={false} />
      <span className="sc-rail-qingguang-dot" aria-hidden="true" />
    </button>
  );
}
