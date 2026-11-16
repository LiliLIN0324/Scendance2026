// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutdoorCloudRecover } from "./outdoor-cloud-recover";
import type { AdoptableActivity } from "../lib/outdoor-plan-adoption";

afterEach(cleanup);

const activities: AdoptableActivity[] = [
  { activityId: "a-1", name: "湖滨夜集", revision: 4, updatedAt: "2026-11-17T02:00:00.000Z", localActivityId: "default-outdoor" },
  { activityId: "a-2", name: "园区市集", revision: 1, updatedAt: "2026-11-16T02:00:00.000Z", localActivityId: "cloud-a-2" },
];

describe("找回云端活动", () => {
  it("没有可找回的活动时不占位", () => {
    const { container } = render(
      <OutdoorCloudRecover activities={[]} onPick={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("列出活动名、版本和更新时间，点「打开」把这一条交出去", () => {
    const onPick = vi.fn();
    render(<OutdoorCloudRecover activities={activities} onPick={onPick} onDismiss={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "找回云端活动" })).toBeTruthy();
    expect(screen.getByText("湖滨夜集")).toBeTruthy();
    const rows = screen.getAllByTestId("outdoor-cloud-recover-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("版本 4");
    fireEvent.click(screen.getAllByTestId("outdoor-cloud-recover-open")[0]!);
    expect(onPick).toHaveBeenCalledWith(activities[0]);
  });

  it("正在打开的那条按钮变「打开中…」且不可点", () => {
    render(
      <OutdoorCloudRecover activities={activities} busyId="a-1" onPick={vi.fn()} onDismiss={vi.fn()} />,
    );
    const buttons = screen.getAllByTestId("outdoor-cloud-recover-open") as HTMLButtonElement[];
    expect(buttons[0]!.textContent).toBe("打开中…");
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
  });

  it("「先不用」只是关掉，不选任何一份", () => {
    const onDismiss = vi.fn();
    const onPick = vi.fn();
    render(<OutdoorCloudRecover activities={activities} onPick={onPick} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("outdoor-cloud-recover-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });
});
