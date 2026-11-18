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

describe("云端声明键（轮次 80）", () => {
  it("不给 onCloud 就没有第四个键（默认界面不变）", () => {
    render(<OutdoorWalkthroughBoard book={emptyBook()} onMark={vi.fn()} />);
    expect(within(screen.getAllByRole("group")[0]!).getAllByRole("button")).toHaveLength(3);
  });

  it("给了 onCloud 每行多一个「云端」键，已声明的才是按下态", () => {
    render(
      <OutdoorWalkthroughBoard book={emptyBook()} onMark={vi.fn()} cloudPass={[2]} onCloud={vi.fn()} />,
    );
    const groups = screen.getAllByRole("group");
    expect(within(groups[0]!).getAllByRole("button")).toHaveLength(4);
    const cloudButton = (index: number) =>
      within(groups[index]!).getByLabelText(/云端是否已跑/) as HTMLButtonElement;
    expect(cloudButton(1).getAttribute("aria-pressed")).toBe("true");
    expect(cloudButton(0).getAttribute("aria-pressed")).toBe("false");
  });

  it("点一下是声明、再点一下是撤回", () => {
    const onCloud = vi.fn();
    render(
      <OutdoorWalkthroughBoard book={emptyBook()} onMark={vi.fn()} cloudPass={[3]} onCloud={onCloud} />,
    );
    const groups = screen.getAllByRole("group");
    fireEvent.click(within(groups[1]!).getByLabelText(/云端是否已跑/));
    expect(onCloud).toHaveBeenCalledWith(2, true);
    fireEvent.click(within(groups[2]!).getByLabelText(/云端是否已跑/));
    expect(onCloud).toHaveBeenCalledWith(3, false);
  });
});

describe("走查日期（轮次 90）", () => {
  it("填了日期就原样写出来，不改写、不本地化", () => {
    render(<OutdoorWalkthroughBoard book={emptyBook("2026-11-18 第三轮")} onMark={() => {}} />);
    expect(screen.getByText("走查日期：2026-11-18 第三轮")).toBeTruthy();
  });

  it("没填就明说未填，不拿今天冒充", () => {
    render(<OutdoorWalkthroughBoard book={emptyBook()} onMark={() => {}} />);
    const line = screen.getByText(/走查日期：/);
    expect(line.textContent).toContain("未填");
    expect(line.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("填走查日期（轮次 91）", () => {
  it("给了 onAsOf 就出现输入框，输入原样回调（不在组件里裁剪）", () => {
    const onAsOf = vi.fn();
    render(<OutdoorWalkthroughBoard book={emptyBook()} onMark={() => {}} onAsOf={onAsOf} />);
    const input = screen.getByLabelText("走查日期") as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "2026-11-19 第三轮" } });
    expect(onAsOf).toHaveBeenCalledWith("2026-11-19 第三轮");
  });

  it("输入框显示当前值；空值时旁边明写未填", () => {
    const { rerender } = render(
      <OutdoorWalkthroughBoard book={emptyBook("2026-11-19")} onMark={() => {}} onAsOf={() => {}} />,
    );
    expect((screen.getByLabelText("走查日期") as HTMLInputElement).value).toBe("2026-11-19");
    rerender(<OutdoorWalkthroughBoard book={emptyBook()} onMark={() => {}} onAsOf={() => {}} />);
    expect(screen.getByText(/未填：卡片会沿用对照表上的日期/)).toBeTruthy();
  });

  it("不给 onAsOf 就没有输入框，只显示一行文字", () => {
    render(<OutdoorWalkthroughBoard book={emptyBook()} onMark={() => {}} />);
    expect(screen.queryByLabelText("走查日期")).toBeNull();
    expect(screen.getByText(/走查日期：未填/)).toBeTruthy();
  });
});
