import { BrandMark } from '../../brand-mark';
import { navToggleLabel } from '../lib/nav-chrome';

/**
 * 工作台 logo。点一下收起或展开左侧导航。
 * 收起时只放锁标；展开时在左卡顶上排「幕景」和一点绿。
 * 开合本身不在这里记，由调用方用晴光列和工具抽屉两扇门算出来。
 */
export function WorkbenchBrandToggle({ expanded, onToggle }: {
  expanded: boolean;
  onToggle(): void;
}): JSX.Element {
  const label = navToggleLabel(expanded);
  return (
    <button
      type="button"
      className={expanded ? 'sc-nav-brand is-wordmark' : 'sc-nav-brand is-mark'}
      aria-expanded={expanded}
      aria-controls="workbench-nav-column"
      aria-label={label}
      data-tip={label}
      title={label}
      onClick={onToggle}
    >
      <span className="sc-brand-mark"><BrandMark size={28} /></span>
      {expanded && <>
        <strong className="sc-brand-cn">幕景</strong>
        <span className="sc-brand-dot" aria-hidden="true" />
      </>}
    </button>
  );
}
