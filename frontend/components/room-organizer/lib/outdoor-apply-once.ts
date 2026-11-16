/**
 * 应用回执的一次性票号（M5 切片，2026-11-16）。
 *
 * 用户双击「应用」、或浏览器把同一次点击重放两遍时，`confirmZoneProposal` 会被连续叫两次：
 * 第一次已经写进画布，第二次读到的还是同一个 `proposal` 与同一份基准版本，于是会再写一遍，
 * 画布上就出现两套同编号的分区。这里把「这一版预览只允许落一次」这件事抽成一个可测的小对象：
 * 第一次 `take` 返回 true，之后同一个 key 一律 false，调用方据此直接 return。
 *
 * key 由「任务 epoch + 基准版本」组成：换了预览或场地变了就是另一个 key，不会被旧票挡住。
 * 纯逻辑，不读 DOM、不发请求。
 */

export class ApplyOnce {
  private readonly taken = new Set<string>();

  /** 记下发出去的票号；同一 key 第二次起返回 false（表示这次不该再写）。 */
  take(key: string | null | undefined, limit = 64): boolean {
    if (!key) return false;
    if (this.taken.has(key)) return false;
    this.taken.add(key);
    // 长时间会话里票号会越积越多；只留最近的若干张，避免无界增长。
    if (this.taken.size > limit) {
      const oldest = this.taken.values().next();
      if (!oldest.done) this.taken.delete(oldest.value);
    }
    return true;
  }

  /** 画布被切换/撤销后，允许同一版预览重新投票。 */
  release(key: string | null | undefined): void {
    if (key) this.taken.delete(key);
  }

  clear(): void {
    this.taken.clear();
  }

  get size(): number {
    return this.taken.size;
  }
}

/** 票号口径：同一任务、同一基准版本算同一张票。 */
export function applyTicketKey(epoch: string | null | undefined, baseVersion: string | null | undefined): string | null {
  if (!epoch || !baseVersion) return null;
  return `${epoch}::${baseVersion}`;
}
