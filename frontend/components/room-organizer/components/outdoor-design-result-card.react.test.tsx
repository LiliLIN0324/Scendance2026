// @vitest-environment jsdom
/**
 * 方案结果卡的展示与动作派发：卡片只负责"讲清 + 把动作交出去"，
 * 不自己改坐标。这里断言按钮语义与文案，不重复验证 hook 的写盘逻辑。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutdoorDesignResultCard, type DesignResultCardModel } from "./outdoor-design-result-card";
import type { DesignSummary } from "../lib/outdoor-design-summary";

const summary = (patch: Partial<DesignSummary> = {}): DesignSummary => ({
  title: "60 人户外婚礼 · 仪式优先",
  strategyLabel: "仪式优先",
  reasons: ["仪式区朝北，背靠树阵", "宴席区紧邻通道，上菜动线最短"],
  capacity: {
    target: 60,
    ceremonySeats: 60,
    banquetSeats: 60,
    tables: 6,
    placedTotal: 132,
    requestedTotal: 132,
    placeholders: 0,
    reusedMaterials: 0,
  },
  assumptions: ["宴席按 10 人一桌", "场地东侧可停车"],
  issues: [],
  zones: [
    { id: "zone-ceremony", name: "仪式区", facilityCount: 60 },
    { id: "zone-banquet", name: "宴席区", facilityCount: 66 },
  ],
  zoneFacilities: { "zone-ceremony": ["c1"], "zone-banquet": ["t1"] },
  ...patch,
});

const base = (patch: Partial<DesignResultCardModel> = {}): DesignResultCardModel => ({
  title: "60 人户外婚礼",
  summary: summary(),
  state: "applied",
  ...patch,
});

describe("方案结果卡", () => {
  afterEach(() => cleanup());
  it("讲清推荐理由、实际席位与关键假设", () => {
    render(<OutdoorDesignResultCard model={base()} />);
    expect(screen.getByText("仪式区朝北，背靠树阵")).toBeTruthy();
    expect(screen.getAllByText("60").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/关键假设 · 2/)).toBeTruthy();
    expect(screen.getByText("已应用 · 可撤销")).toBeTruthy();
  });

  it("点分区把 id 交回调用方（不自己改镜头）", () => {
    const onLocateZone = vi.fn();
    render(<OutdoorDesignResultCard model={base()} actions={{ onLocateZone }} />);
    fireEvent.click(screen.getByRole("button", { name: /定位到宴席区/ }));
    expect(onLocateZone).toHaveBeenCalledWith("zone-banquet");
  });

  it("选中对象作为可见上下文，可清除也可取回", () => {
    const onClearSelection = vi.fn();
    const onLocateSelection = vi.fn();
    const { rerender } = render(
      <OutdoorDesignResultCard
        model={base({ selection: { count: 12, labels: ["宴席 1 桌"], detached: false } })}
        actions={{ onClearSelection, onLocateSelection }}
      />,
    );
    expect(screen.getByText(/已选 12 件：宴席 1 桌/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除引用" }));
    expect(onClearSelection).toHaveBeenCalled();

    rerender(
      <OutdoorDesignResultCard
        model={base({ selection: { count: 12, labels: [], detached: true } })}
        actions={{ onClearSelection, onLocateSelection }}
      />,
    );
    expect(screen.getByText("已清除引用，下一句不会改这组")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新取回" }));
    expect(onLocateSelection).toHaveBeenCalled();
  });

  it("已应用时给出本次变化与唯一的撤销入口", () => {
    const onUndo = vi.fn();
    render(
      <OutdoorDesignResultCard
        model={base({ change: { headline: "新增 66 件、移动 0 件", details: ["新增 6 张宴席圆桌"] } })}
        actions={{ onUndo }}
      />,
    );
    expect(screen.getByText("新增 66 件、移动 0 件")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "撤销这次" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("严格档待确认时只给一次确认，不直接声称已写入", () => {
    const onConfirmPending = vi.fn();
    const onUndo = vi.fn();
    render(
      <OutdoorDesignResultCard
        model={base({
          state: "proposal",
          pending: { why: "严格档：这次改动要先确认。" },
          change: { headline: "移动 3 件", details: [] },
        })}
        actions={{ onConfirmPending, onUndo }}
      />,
    );
    expect(screen.getByText("尚未写入画布")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "撤销这次" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    expect(onConfirmPending).toHaveBeenCalledTimes(1);
  });

  it("候选 A/B 同视图对比：切换只看不写，采用是唯一主动作", () => {
    const onSelectCandidate = vi.fn();
    const onAdoptCandidate = vi.fn();
    const onCloseCompare = vi.fn();
    render(
      <OutdoorDesignResultCard
        model={base({
          compare: {
            activeId: "A",
            candidates: [
              { id: "A", label: "仪式优先", seats: "观礼 60 · 宴席 60", tradeoff: "通道更宽" },
              { id: "B", label: "宴席优先", seats: "观礼 60 · 宴席 60", tradeoff: "备桌更多" },
            ],
          },
          compareNote: "画布已改动，这一版候选不再覆盖你的修改。",
        })}
        actions={{ onSelectCandidate, onAdoptCandidate, onCloseCompare }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /B · 宴席优先/ }));
    expect(onSelectCandidate).toHaveBeenCalledWith("B");
    expect(onAdoptCandidate).not.toHaveBeenCalled();
    expect(screen.getByText("画布已改动，这一版候选不再覆盖你的修改。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "采用这一版" }));
    expect(onAdoptCandidate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "结束比较" }));
    expect(onCloseCompare).toHaveBeenCalledTimes(1);
  });
});
