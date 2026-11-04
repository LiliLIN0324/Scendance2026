import { useEffect, useState } from 'react';

const STORAGE_KEY = 'scendance.f3-coach-seen';

function readSeen(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface UseF3CoachBubbleResult {
  shouldShow: boolean;
  dismiss: () => void;
}

/**
 * F3 智能吸附首次教练气泡：localStorage 记录是否已读过。
 * 默认未读；dismiss() 写入并立即收起。
 */
export function useF3CoachBubble(): UseF3CoachBubbleResult {
  const [shouldShow, setShouldShow] = useState<boolean>(() => !readSeen());

  useEffect(() => {
    // 水合后再读一次，避免 SSR/首次渲染与真实 localStorage 不一致。
    setShouldShow(!readSeen());
  }, []);

  const dismiss = () => {
    setShouldShow(false);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, '1');
      }
    } catch {
      // 隐私模式下写不进也不阻塞交互。
    }
  };

  return { shouldShow, dismiss };
}
