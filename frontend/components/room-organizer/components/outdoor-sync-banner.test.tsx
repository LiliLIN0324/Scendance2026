// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutdoorSyncBanner } from "./outdoor-sync-banner";

afterEach(cleanup);

describe("云端副本状态条", () => {
  it("没有提示也没有冲突时不占位", () => {
    const { container } = render(<OutdoorSyncBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("普通提示只是一句话，没有按钮", () => {
    render(<OutdoorSyncBanner note="本机已保存；云端副本这次没传上去。" />);
    expect(screen.getByTestId("outdoor-sync-banner").textContent).toContain("没传上去");
    expect(screen.queryByTestId("outdoor-sync-use-mine")).toBeNull();
  });

  it("冲突时给二选一，并把服务器版本号和代价说清", () => {    const onUseMine = vi.fn();
    const onUseRemote = vi.fn();
    render(
      <OutdoorSyncBanner
        conflict={{ revision: 4, name: "另一台设备的版本" }}
        onUseMine={onUseMine}
        onUseRemote={onUseRemote}
      />,
    );
    expect(screen.getByTestId("outdoor-sync-banner").textContent).toContain("版本 4");
    expect(screen.getByTestId("outdoor-sync-banner").textContent).toContain("会覆盖服务器");
    fireEvent.click(screen.getByTestId("outdoor-sync-use-mine"));
    fireEvent.click(screen.getByTestId("outdoor-sync-use-remote"));
    expect(onUseMine).toHaveBeenCalledOnce();
    expect(onUseRemote).toHaveBeenCalledOnce();
  });

  it("冲突 + 一句结果提示同时出现（比如点完才没传上去）", () => {
    render(
      <OutdoorSyncBanner
        note="这次没传上去，本机这版还在，稍后再试。"
        conflict={{ revision: 6, name: "x" }}
        onUseMine={vi.fn()}
        onUseRemote={vi.fn()}
      />,
    );
    expect(screen.getByTestId("outdoor-sync-note").textContent).toContain("没传上去");
    expect(screen.getByTestId("outdoor-sync-use-mine")).toBeTruthy();
  });

  it("正在上传时两个按钮都不可点（防连点写两次）", () => {
    render(
      <OutdoorSyncBanner conflict={{ revision: 4, name: "x" }} busy onUseMine={vi.fn()} onUseRemote={vi.fn()} />,
    );
    expect((screen.getByTestId("outdoor-sync-use-mine") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("outdoor-sync-use-remote") as HTMLButtonElement).disabled).toBe(true);
  });
});
