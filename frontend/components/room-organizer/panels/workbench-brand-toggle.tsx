import { BrandMark } from '../../brand-mark';
import { navToggleLabel } from '../lib/nav-chrome';

/**
 * 工作台 logo。点一下收起或展开左侧导航。
 * 品牌只保留左窄轨锁标；展开左列时不再在对话顶重复「幕景」二字。
 */
export function WorkbenchBrandToggle({ expanded, onToggle }: {
  expanded: boolean;
  onToggle(): void;
}): JSX.Element {
  const label = navToggleLabel(expanded);
  return (
    <button
      type="button"
      className="sc-nav-brand is-mark"
      aria-expanded={expanded}
      aria-controls="workbench-nav-column"
      aria-label={label}
      data-tip={label}
      title={label}
      onClick={onToggle}
    >
      <span className="sc-brand-mark"><BrandMark size={28} /></span>
    </button>
  );
}
