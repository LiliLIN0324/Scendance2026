'use client';
import { STYLE_CAPABILITY_PREFILL } from '../lib/style-bundles';

import { Map as MapIcon, MapPin, Palette } from '@/components/solid-icons';
import { useRoomEditor } from '../contexts';
import { useAgent } from './agent-panel';
import { PlanThumb } from './plan-thumb';
import './capability-suggestion-cards.css';

const THUMB_WIDTH = 88;
const THUMB_HEIGHT = 62;

export interface CapabilitySuggestionCardsProps {
  /** 点卡片主体：把一句可直接发送的指令预填进输入框（不发送），由父级聚焦输入框。 */
  onPrefill(text: string): void;
}

/**
 * 「你可以做什么」建议卡（petitmaker 风）：缩略图 + 落点虚线圈 + 一句话。
 * 点卡片主体 = 预填一句人话指令到 composer；卡内小次按钮保留原 picker 动作。
 */
export function CapabilitySuggestionCards({ onPrefill }: CapabilitySuggestionCardsProps): JSX.Element | null {
  const agent = useAgent();
  const { layout, activeFloor } = useRoomEditor();
  if (agent.callbacks.workbenchMode !== 'layout') return null;
  const hasVenue = agent.venueUp;

  const cards = [
    {
      id: 'map',
      title: '地图选址',
      desc: '先圈出真实场地范围',
      prefill: '先帮我看看这块场地能放什么',
      actionLabel: agent.mapPickerOpen ? '收起地图圈地' : '打开地图圈地',
      action: agent.startMapVenuePicker,
      active: agent.mapPickerOpen,
      icon: <MapIcon size={13} aria-hidden="true"/>,
      emptyIcon: <MapPin size={20} aria-hidden="true"/>,
      ringClass: '',
    },
    {
      id: 'style',
      title: '按风格配一套',
      desc: '按场地气质配现成风格',
      prefill: STYLE_CAPABILITY_PREFILL,
      actionLabel: agent.stylePickerOpen ? '收起风格套' : '选风格',
      action: () => { if (agent.stylePickerOpen) agent.closeStylePicker(); else agent.startStylePicker(); },
      active: agent.stylePickerOpen,
      icon: <Palette size={13} aria-hidden="true"/>,
      emptyIcon: <Palette size={20} aria-hidden="true"/>,
      ringClass: 'cs-thumb-ring--offset',
    },
  ];

  return (
    <div className="cs-card-row" role="group" aria-label="你可以做什么">
      {cards.map(card => (
        <div
          key={card.id}
          className="cs-card"
          role="button"
          tabIndex={0}
          aria-label={`${card.title}：预填一句指令到输入框`}
          onClick={() => onPrefill(card.prefill)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onPrefill(card.prefill);
          }}
        >
          <span className="cs-thumb" aria-hidden="true">
            {hasVenue
              ? <PlanThumb layout={layout} floor={activeFloor} width={THUMB_WIDTH} height={THUMB_HEIGHT} eager />
              : <span className="cs-thumb-empty">{card.emptyIcon}</span>}
            <span className={card.ringClass ? `cs-thumb-ring ${card.ringClass}` : 'cs-thumb-ring'}/>
          </span>
          <span className="cs-card-body">
            <span className="cs-card-title">{card.icon}{card.title}</span>
            <span className="cs-card-desc">{card.desc}</span>
          </span>
          <button
            type="button"
            className={card.active ? 'cs-card-action is-on' : 'cs-card-action'}
            aria-pressed={card.active}
            onClick={event => { event.stopPropagation(); card.action(); }}
          >{card.actionLabel}</button>
        </div>
      ))}
    </div>
  );
}
