import { describe, expect, it, vi } from 'vitest';
import { answersPlaceRequest } from './outdoor-place-handover';

describe('answersPlaceRequest — 画布搜地点接进对话', () => {
  it('对话停在「搜索目标地点」时，把地图选中的地名送进对话检索', () => {
    const search = vi.fn();
    expect(answersPlaceRequest('place', ' 杭州湖滨银泰in77 ', search)).toBe(true);
    expect(search).toHaveBeenCalledWith('杭州湖滨银泰in77');
  });

  it.each(['scope', 'zones', 'main-routes', 'objects', 'sub-routes', 'people', 'refine-3d'] as const)(
    '已进入 %s 阶段时，搜地点只做视图辅助，不改对话任务',
    stage => {
      const search = vi.fn();
      expect(answersPlaceRequest(stage, '杭州湖滨银泰in77', search)).toBe(false);
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('没选到具体地名时不发起检索', () => {
    const search = vi.fn();
    expect(answersPlaceRequest('place', '   ', search)).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('还没有工作流状态时不动对话', () => {
    const search = vi.fn();
    expect(answersPlaceRequest(undefined, '杭州湖滨银泰in77', search)).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });
});
