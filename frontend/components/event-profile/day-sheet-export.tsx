import { useState } from 'react';
import type { RoomLayout } from '../room-organizer/lib/types';
import type { Roster } from '../../lib/event-roster';
import type { SupplierLedger } from '../../lib/supplier-declarations';
import { planTimeZone, renderDaySheet, zoneCalendarDate } from '../../lib/event-day-sheet';

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
}

export function DaySheetExport({ layout, roster, suppliers, save, now = new Date().toISOString() }: DaySheetExportProps) {
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  return (
    <div className="sc-operation-export">
      <button className="sc-button" type="button" onClick={() => {
        try {
          const html = renderDaySheet({ layout, roster, suppliers, generatedAt: now });
          const date = zoneCalendarDate(now, planTimeZone(layout));
          save(`${(layout.name || '未命名活动').replace(/[\\/:*?"<>|]/g, '-')}-当天执行包-${date}.html`, html);
          setMessage({ kind: 'ok', text: '已生成当天执行包，可离线打开或打印。' });
        } catch (error) {
          setMessage({ kind: 'error', text: error instanceof Error ? error.message : '当天执行包未生成，请重试。' });
        }
      }}>下载当天执行包</button>
      {message ? <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
    </div>
  );
}
