// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationGuide } from './annotation-guide';

describe('场地规划引导', () => {
  it('shows the steps and provides explicit tools, area types and a finish action', () => {
    const onModeChange = vi.fn(), onZoneTypeChange = vi.fn(), onFinish = vi.fn();
    const view = render(<AnnotationGuide mode="zone" zoneType="roundtable" onModeChange={onModeChange} onZoneTypeChange={onZoneTypeChange} onFinish={onFinish} />);
    expect(screen.getByText(/按住拖出范围/)).toBeTruthy();
    expect(screen.getByText(/右上角查看方案/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '画路线' }));
    expect(onModeChange).toHaveBeenCalledWith('route');
    fireEvent.click(screen.getByRole('button', { name: '签到区' }));
    expect(onZoneTypeChange).toHaveBeenCalledWith('checkin');
    fireEvent.click(screen.getByRole('button', { name: '完成绘制' }));
    expect(onFinish).toHaveBeenCalledOnce();
    view.rerender(<AnnotationGuide mode="route" zoneType="roundtable" onModeChange={onModeChange} onZoneTypeChange={onZoneTypeChange} onFinish={onFinish} />);
    expect(screen.getByText(/按 Enter 或双击结束/)).toBeTruthy();
    view.rerender(<AnnotationGuide mode="measure" zoneType="roundtable" onModeChange={onModeChange} onZoneTypeChange={onZoneTypeChange} onFinish={onFinish} />);
    expect(screen.getByText(/点击起点和终点/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '标出入口' }));
    expect(onModeChange).toHaveBeenCalledWith('door');
    view.rerender(<AnnotationGuide mode="door" zoneType="roundtable" onModeChange={onModeChange} onZoneTypeChange={onZoneTypeChange} onFinish={onFinish} />);
    expect(screen.getByText(/门宽、开启方向与现场情况仍需核对/)).toBeTruthy();
  });

  it('explains the coverage of each planning path without claiming checks passed', () => {
    const view=render(<AnnotationGuide mode="zone" zoneType="roundtable" onModeChange={vi.fn()} onZoneTypeChange={vi.fn()} onFinish={vi.fn()} />);
    const panel=within(view.container);
    fireEvent.click(panel.getByText('标注如何影响方案'));
    expect(panel.getByText(/画出的区域会影响区域方案/)).toBeTruthy();
    expect(panel.getByText(/部分自动布置暂时不会参考这些区域/)).toBeTruthy();
    expect(panel.getByText(/路线可用于检查是否被物料挡住/)).toBeTruthy();
    expect(panel.getByText(/部分自动布置尚不检查入口净空/)).toBeTruthy();
    expect(panel.getByText(/量距只显示距离/)).toBeTruthy();
    expect(panel.getByText(/具体结果请查看方案检查/)).toBeTruthy();
  });
});
