'use client';

import { MANUAL_BRIEF_TEMPLATE } from '../lib/creative-brief';
import { isUntouched } from '../lib/restore-point';
import type { RoomLayout } from '../lib/types';
import type { CreativeBriefState } from './creative-studio';
import './activity-workflow-guide.css';

interface Props { layout:RoomLayout; briefState:CreativeBriefState; onOpenBrief():void }

export function ActivityWorkflowGuide({layout,briefState,onOpenBrief}:Props):JSX.Element {
  const tasks=layout.eventOperations?.tasks??[];
  const items=layout.floors.flatMap(floor=>floor.items);
  const hasText=!!briefState.brief.description.trim();
  const hasTemplate=briefState.brief.description.includes(MANUAL_BRIEF_TEMPLATE);
  const starting=briefState.ready&&!briefState.error&&!hasText&&tasks.length===0;
  const briefSummary=briefState.error?'简报读取或保存遇到问题':!briefState.ready?'正在读取简报':!hasText?'简报未填写':hasTemplate?'简报含待填写提纲':briefState.hasSavedBrief?'已保存简报草稿':'当前简报草稿尚未保存';
  const action=briefState.error?'查看简报提示':!briefState.ready?'等待简报读取':hasText?'核对活动简报':'先填写活动简报';
  const kind=layout.eventOperations?.dataKind==='rehearsal'?'演练记录':layout.eventOperations?.dataKind==='real'?'活动记录':'活动草稿';
  const sceneSummary=isUntouched(layout)?'示例布置，尺寸待核对':`${items.length} 件物料布置记录，现场与尺寸待核对`;
  const evidenceCount=tasks.filter(task=>task.evidenceNote.trim()||task.evidenceUrls.length>0).length;
  return <aside className="awg-guide" aria-label="活动流程与当前记录">
    <div className="awg-start">
      {starting&&<img src="/assets/workflow/activity-planning-v1.png" alt="" width={60} height={60} loading="lazy" decoding="async"/>}
      <div><strong>{starting?'先明确活动，再安排执行':'活动流程与记录'}</strong><p className="awg-route">活动简报 → 场地与物料 → 分工排期 → 验收交接</p></div>
    </div>
    <p className="awg-record">{kind} · {briefSummary} · {sceneSummary} · {tasks.length} 条分工记录{evidenceCount>0?`，${evidenceCount} 条含核对说明或证据`:''}</p>
    <div className="awg-next"><button type="button" disabled={!briefState.ready&&!briefState.error} onClick={onOpenBrief}>{action}</button><small>切换模式只切换工具；目标、时间与现场结果仍需核对。</small></div>
  </aside>;
}
