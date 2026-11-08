// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
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
  });
});
