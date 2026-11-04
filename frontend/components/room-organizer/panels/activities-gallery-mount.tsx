'use client';

/**
 * S1.1 活动开场画廊的挂载桥：
 * 活动脸（AgentPanel）里只放一行条件渲染，取数与 props 穿洞都收在本文件。
 * 直接复用 CreativeStudioProvider 的本地备份 actions，与 creative-studio 测试 harness 同一接法，
 * 不新增存储键、不碰 onApplyCreative 三道门。
 */
import { useRoomEditor } from '../contexts';
import { useLocalProjectBackup } from './creative-studio';
import { LocalActivitiesPanel } from './local-activities-panel';

export function ActivitiesGalleryMount(): JSX.Element | null {
  const studio = useLocalProjectBackup();
  const { layout } = useRoomEditor();
  // 正常壳内 StudioProvider 必在；脱离 Provider 的渲染（如孤立测试）静默不挂，不抛错。
  if (!studio) return null;
  return <LocalActivitiesPanel mode="list" layout={layout} actions={studio}/>;
}
