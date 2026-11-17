// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCEPTANCE_RULES } from "../lib/outdoor-acceptance-selfcheck";
import { CASE_IDS } from "../lib/outdoor-release-status-card";
import { emptyBook, markSeen } from "../lib/outdoor-walkthrough-book";
import { OutdoorWalkthroughBoard } from "./outdoor-walkthrough-board";

/**
 * 走查面板（轮次 75）：11 行 × 3 键，标的是“看过哪几条”，不是“能不能发布”。
 */

afterEach(cleanup);

describe("走查记录面板", () => {
  it("11 条用例各一行、各三个按钮，行标题取自验收规则", () => {
    render(<OutdoorWalkthroughBoard book={emptyBook()} onMark={vi.fn()} />);
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(CASE_IDS.length);
    expect(within(groups[0]!).getAllByRole("button")).toHaveLength(3);
    const firstTitle = ACCEPTANCE_RULES[0]!.title;
    expect(screen.getByText(firstTitle)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(CASE_IDS.length * 3);
  });

  it("没标过的行停在「未看」，不给任何一条默认通过", () => {
    render(<OutdoorWalkthroughBoard book={emptyBook()} onMark={vi.fn()} />);
    const groups = screen.getAllByRole("group");
    for (const group of groups) {
      const pressed = within(group)
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") === "true");
      expect(pressed).toHaveLength(1);
      expect(pressed[0]!.textContent).toBe("未看");
    }
  });

  it("点「看过」把编号和状态交给外层，不自己改记录本", () => {
    const onMark = vi.fn();
    render(<OutdoorWalkthroughBoard book={emptyBook()} onMark={onMark} />);
    const group = screen.getAllByRole("group")[2]!;
    fireEvent.click(within(group).getByText("看过"));
    expect(onMark).toHaveBeenCalledWith(3, "pass");
    // 受控：外层没回传新记录本，按压态不该变。
    const pressed = within(screen.getAllByRole("group")[2]!)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed[0]!.textContent).toBe("未看");
  });

  it("记录本里标过的行，对应按钮才是按下态", () => {
    const book = markSeen(markSeen(emptyBook(), 4, "pass"), 9, "partial");
    render(<OutdoorWalkthroughBoard book={book} onMark={vi.fn()} />);
    const groups = screen.getAllByRole("group");
    const pressedOf = (index: number) =>
      within(groups[index]!)
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.textContent);
    expect(pressedOf(3)).toEqual(["看过"]);
    expect(pressedOf(8)).toEqual(["不构成通过"]);
    expect(pressedOf(0)).toEqual(["未看"]);
  });

  it("进度行写「已看 N/11」，且整块不出现「可发布（」这种结论", () => {
    const book = markSeen(emptyBook(), 1, "pass");
    const { container } = render(<OutdoorWalkthroughBoard book={book} onMark={vi.fn()} />);
    expect(screen.getByText(/已看 1\/11/)).toBeTruthy();
    expect(container.textContent).not.toContain("可发布（");
    expect(container.textContent).toContain("真实云端");
  });
});
