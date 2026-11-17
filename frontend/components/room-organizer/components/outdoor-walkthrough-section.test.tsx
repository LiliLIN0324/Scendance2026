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
