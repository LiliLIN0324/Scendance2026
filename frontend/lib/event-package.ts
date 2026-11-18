import type { RoomLayout } from '../components/room-organizer/lib/types';
import type { Roster } from './event-roster';
import type { SupplierLedger } from './supplier-declarations';
import type { Retrospective } from './event-retrospective';

/**
 * 活动档案包（P2-5）：先出清单，缺项不占位、不出空文件。
 * 命名「活动名-YYYY-MM-DD」；日期未确认时明确写出来，不拿今天顶替。
 */
export type PackageEntryKind = 'profile' | 'operations' | 'roster' | 'suppliers' | 'retrospective';

export interface PackageEntry {
  kind: PackageEntryKind;
  title: string;
  version: string;
}

export interface EventPackagePlan {
  folderName: string;
  generatedAt: string;
  entries: PackageEntry[];
  index: string[];
  /** 仅用于提示哪些内容没有生成，不进入档案包。 */
  skipped: PackageEntryKind[];
}

const sanitize = (value: string): string => value.replace(/[\\/:*?"<>|]/g, '-').trim();

export function planEventPackage(input: {
  layout: RoomLayout;
  roster?: Roster | undefined;
  suppliers?: SupplierLedger | undefined;
  retrospective?: Retrospective | undefined;
  generatedAt: string;
}): EventPackagePlan {
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error('请记录有效的生成时间。');
  const { layout } = input;
  const date = layout.eventProfile?.date.value ?? '';
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '日期待确认';
  const rawName = layout.name.trim();
  const folderName = `${sanitize(rawName || '未命名活动')}-${dated}`;
  const entries: PackageEntry[] = [];
  const skipped: PackageEntryKind[] = [];

  if (layout.eventProfile) {
    entries.push({ kind: 'profile', title: '活动档案', version: `v${layout.eventProfile.revision}` });
  } else skipped.push('profile');

  const tasks = layout.eventOperations?.tasks ?? [];
  if (tasks.length) {
    entries.push({ kind: 'operations', title: '流程单', version: `${tasks.length} 项 · ${
      layout.eventOperations?.dataKind === 'rehearsal' ? '演练' : layout.eventOperations?.dataKind === 'real' ? '真实' : '未定'}` });
  } else skipped.push('operations');

  const guests = input.roster?.guests.length ?? 0;
  if (guests) entries.push({ kind: 'roster', title: '嘉宾名册', version: `${guests} 位` });
  else skipped.push('roster');

  const declarations = input.suppliers?.declarations.length ?? 0;
  if (declarations) entries.push({ kind: 'suppliers', title: '供应商声明', version: `${declarations} 条` });
  else skipped.push('suppliers');

  if (input.retrospective) {
    entries.push({ kind: 'retrospective', title: '复盘', version: input.retrospective.baseline
      ? `基线 ${input.retrospective.baseline.publishedPackageId}` : '基线待补' });
  } else skipped.push('retrospective');

  const index = [`# ${folderName}`, `生成时间：${input.generatedAt}`,
    ...entries.map(entry => `- ${entry.title} · ${entry.version}`),
    ...(skipped.length ? [`未生成：${skipped.join('、')}（缺项不占位）`] : [])];
  return { folderName, generatedAt: input.generatedAt, entries, index, skipped };
}
