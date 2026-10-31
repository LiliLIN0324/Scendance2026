import { BrandMark } from '../../brand-mark';
import { navToggleLabel } from '../lib/nav-chrome';

/**
 * 工作台 logo。只住在最左窄轨顶上，点一下收起或展开左侧那一列。
 * 收起和展开都是同一颗锁标，下面带「幕景」小字；不铺成方案会话或对话卡的标题。
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
      className="sc-nav-brand is-mark"
      aria-expanded={expanded}
      aria-controls="workbench-nav-column"
      aria-label={label}
      data-tip={label}
      title={label}
      onClick={onToggle}
    >
      <span className="sc-brand-mark"><BrandMark size={28} /></span>
      <span className="sc-rail-word">幕景</span>
    </button>
  );
}
