import { useEffect, useRef, useState } from 'react';
import type { RoomLayout } from '../room-organizer/lib/types';
import type { Roster } from '../../lib/event-roster';
import type { SupplierLedger } from '../../lib/supplier-declarations';
import {
  daySheetDateLabel, planTimeZone, renderDaySheet, zoneCalendarDate, type DaySheetDeliveryIdentity,
} from '../../lib/event-day-sheet';

/**
 * 当天执行包下载入口（P1-4 接线）：HTML 由纯函数生成，保存动作可注入。
 * 生成失败不影响现场记录；只提示，不改任何数据。
 */
export interface DaySheetExportProps {
  layout: RoomLayout;
  roster?: Roster | undefined;
  suppliers?: SupplierLedger | undefined;
  save: (fileName: string, text: string) => void;
  now?: string;
  /** 交付版本身份；不传时执行单上不标版本。 */
  delivery?: DaySheetDeliveryIdentity | null | undefined;
}

/**
 * 默认出哪天：活动排期里优先「今天」，否则第一天；完全没有排期就用今天。
 * 生成时间无效时返回空串，交给 renderDaySheet 报「请记录有效的生成时间」。
 */
export function defaultDaySheetDay(layout: RoomLayout, now: string): string {
  try {
    const timeZone = planTimeZone(layout);
    const today = zoneCalendarDate(now, timeZone);
    const days = [...new Set((layout.eventOperations?.tasks ?? [])
      .map(task => task.plannedStartAt ? zoneCalendarDate(task.plannedStartAt, timeZone) : null)
      .filter((day): day is string => day !== null))].sort();
    return days.includes(today) ? today : days[0] ?? today;
  } catch {
    return '';
  }
}

export function DaySheetExport({ layout, roster, suppliers, save, now = new Date().toISOString(), delivery = null }: DaySheetExportProps) {
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [day, setDay] = useState(() => defaultDaySheetDay(layout, now));
  // 换活动才重算默认日期；同一活动里改方案不打断已经选好的那一天。
  const scope = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (scope.current === layout.id) return;
    scope.current = layout.id;
    setDay(defaultDaySheetDay(layout, now));
    setMessage(null);
  }, [layout, now]);
  return (
    <div className="sc-operation-export">
      <label className="sc-operation-export-day">
        <span>执行日期</span>
        <input type="date" value={day} aria-label="执行日期"
          onChange={event => { setDay(event.target.value); setMessage(null); }} />
      </label>
      <button className="sc-button" type="button" onClick={() => {
        try {
          const html = renderDaySheet({ layout, roster, suppliers, generatedAt: now, day, delivery });
          save(`${(layout.name || '未命名活动').replace(/[\\/:*?"<>|]/g, '-')}-当天执行包-${day}.html`, html);
          setMessage({ kind: 'ok', text: `已生成当天执行包 · ${daySheetDateLabel(day)}，可离线打开或打印。` });
        } catch (error) {
          setMessage({ kind: 'error', text: error instanceof Error ? error.message : '当天执行包未生成，请重试。' });
        }
      }}>下载当天执行包</button>
      {message && <p className={message.kind === 'ok' ? 'sc-note' : 'sc-handoff-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
    </div>
  );
}
