// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CASE_IDS } from "../lib/outdoor-release-status-card";
import { emptyBook, markSeen } from "../lib/outdoor-walkthrough-book";
import { OutdoorWalkthroughSection } from "./outdoor-walkthrough-section";

/**
 * 走查区（轮次 77）：默认收起，展开才露 11 行；标记由外层接手，非法编号界面不动。
 */

afterEach(cleanup);

const pressedOf = (index: number): string[] =>
  within(screen.getAllByRole("group")[index]!)
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent ?? "");

describe("走查区", () => {
  it("默认收起：按钮 aria-expanded=false，一条用例都不渲染", () => {
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} />);
    expect(screen.getByRole("button", { expanded: false }).textContent).toContain("走查记录");
    expect(screen.queryAllByRole("group")).toHaveLength(0);
  });

  it("展开后出现 11 行，按钮变成「收起」", () => {
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { expanded: true }).textContent).toBe("收起走查记录");
    expect(screen.getAllByRole("group")).toHaveLength(CASE_IDS.length);
  });

  it("点「看过」交给外层，并用外层回传的记录本更新按压态", () => {
    const onMark = vi.fn((id: number, state: "pass" | "partial" | "none") =>
      markSeen(emptyBook(), id, state),
    );
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={onMark} defaultOpen />);
    fireEvent.click(within(screen.getAllByRole("group")[2]!).getByText("看过"));
    expect(onMark).toHaveBeenCalledWith(3, "pass");
    expect(pressedOf(2)).toEqual(["看过"]);
  });

  it("外层返回 null（非法编号）时按压态不变，界面不假装成功", () => {
    const onMark = vi.fn(() => null);
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={onMark} defaultOpen />);
    fireEvent.click(within(screen.getAllByRole("group")[0]!).getByText("看过"));
    expect(onMark).toHaveBeenCalledWith(1, "pass");
    expect(pressedOf(0)).toEqual(["未看"]);
  });

  it("外层带进来的旧记录本会显示成已标状态（刷新后读盘即此路）", () => {
    const book = markSeen(emptyBook(), 5, "partial");
    render(<OutdoorWalkthroughSection initialBook={book} onMark={vi.fn()} defaultOpen />);
    expect(pressedOf(4)).toEqual(["不构成通过"]);
    expect(pressedOf(0)).toEqual(["未看"]);
  });
});


describe("导出 CSV 按钮（轮次 89）", () => {
  it("不传 onExportCsv 就整块不渲染（与云端列同一个规矩）", () => {
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "导出台账 CSV" })).toBeNull();
    expect(screen.queryByText("导出 CSV")).toBeNull();
  });

  it("传了就渲染，点一次回调一次", () => {
    const onExportCsv = vi.fn();
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} onExportCsv={onExportCsv} />);
    fireEvent.click(screen.getByRole("button", { name: "导出台账 CSV" }));
    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });

  it("导出不改变展开状态：收起时点导出，仍旧是收起的", () => {
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} onExportCsv={vi.fn()} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "导出台账 CSV" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "收起走查记录" })).toBeNull();
  });
});

describe("待补清单显示（轮次 90）", () => {
  it("传了 gapsLine 就原样显示，保留换行", () => {
    const gapsLine = "#2 两个同名地点 —— 缺：云端\n共 1 条待补 · 台账 11 条 · 三类全绿 0 条";
    render(
      <OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} defaultOpen gapsLine={gapsLine} />,
    );
    const block = screen.getByLabelText("待补清单");
    expect(block.textContent).toBe(gapsLine);
    expect(block.className).toContain("whitespace-pre-line");
  });

  it("不传就不显示这一块（不渲染空壳）", () => {
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} defaultOpen />);
    expect(screen.queryByLabelText("待补清单")).toBeNull();
  });

  it("收起时不显示待补清单（面板本身都看不见）", () => {
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} gapsLine="#1 缺：云端" />);
    expect(screen.queryByLabelText("待补清单")).toBeNull();
  });
});

describe("日期输入接线（轮次 91）", () => {
  it("外层返回新记录本才更新显示副本；返回 null 则输入框不动", () => {
    let next: ReturnType<typeof emptyBook> | null = emptyBook("2026-11-19 A");
    const onAsOf = vi.fn(() => next);
    render(
      <OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} defaultOpen onAsOf={onAsOf} />,
    );
    const input = screen.getByLabelText("走查日期") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-11-19 A" } });
    expect(onAsOf).toHaveBeenCalledWith("2026-11-19 A");
    expect((screen.getByLabelText("走查日期") as HTMLInputElement).value).toBe("2026-11-19 A");

    next = null;
    fireEvent.change(screen.getByLabelText("走查日期"), { target: { value: "被拒的值" } });
    expect((screen.getByLabelText("走查日期") as HTMLInputElement).value).toBe("2026-11-19 A");
  });
});

describe("报告段落自检显示（轮次 97）", () => {
  it("传了 reportLine 就原样显示在待补清单下面", () => {
    render(
      <OutdoorWalkthroughSection
        initialBook={emptyBook()}
        onMark={vi.fn()}
        defaultOpen
        gapsLine="#2 —— 缺：云端"
        reportLine="报告段落：6/6 段齐（内容对不对仍要人看）"
      />,
    );
    expect(screen.getByLabelText("报告段落自检").textContent).toContain("6/6 段齐");
  });

  it("不传就不渲染空壳", () => {
    render(<OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} defaultOpen />);
    expect(screen.queryByLabelText("报告段落自检")).toBeNull();
  });

  it("收起时不显示（面板本身看不见）", () => {
    render(
      <OutdoorWalkthroughSection initialBook={emptyBook()} onMark={vi.fn()} reportLine="报告段落：2/6 段" />,
    );
    expect(screen.queryByLabelText("报告段落自检")).toBeNull();
  });
});
