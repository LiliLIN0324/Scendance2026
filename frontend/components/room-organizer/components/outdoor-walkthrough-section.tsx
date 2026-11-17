"use client";

import { useState } from "react";
import type { BrowserEvidence } from "../lib/outdoor-release-status-card";
import type { WalkthroughBook } from "../lib/outdoor-walkthrough-book";
import { OutdoorWalkthroughBoard } from "./outdoor-walkthrough-board";

/**
 * 走查区（M7.1，轮次 77）。
 *
 * 工作流卡底部那一块：一个「展开/收起」按钮 + 面板。抽出来是为了能单测——
 * 不然只能靠把整张 800 行的卡连同 flow 桩一起渲染。
 *
 * 状态归属：**外层（hook）才持记录本**，这里只留一份显示用的副本；
 * `onMark` 返回非空才更新副本（非法编号返回 null，界面不动）。
 */
export function OutdoorWalkthroughSection({
  initialBook,
  onMark,
  defaultOpen = false,
  cloudPass,
  onCloud,
}: {
  initialBook: WalkthroughBook;
  onMark: (id: number, state: BrowserEvidence) => WalkthroughBook | null;
  defaultOpen?: boolean;
  cloudPass?: readonly number[];
  onCloud?: (id: number, pass: boolean) => void;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const [book, setBook] = useState(initialBook);
  return (
    <div className="ap-card-walkthrough">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "收起走查记录" : "走查记录（验收时逐条标记）"}
      </button>
      {open && (
        <OutdoorWalkthroughBoard
          book={book}
          onMark={(id, state) => {
            const next = onMark(id, state);
            if (next) setBook(next);
          }}
          {...(cloudPass ? { cloudPass } : {})}
          {...(onCloud ? { onCloud } : {})}
        />
      )}
    </div>
  );
}
