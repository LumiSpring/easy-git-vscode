import { useCallback, useRef, useState } from "react";

export interface HintState {
  text: string;
  left: number;
  top: number;
}

export function useDelayedHint(delayMs = 500) {
  const [hint, setHint] = useState<HintState | undefined>();
  const timer = useRef(0);

  const show = useCallback(
    (text: string, target: HTMLElement, place: "right" | "below" = "below") => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const rect = target.getBoundingClientRect();
        if (place === "below") {
          setHint({
            text,
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)),
            top: Math.min(rect.bottom + 6, window.innerHeight - 88),
          });
          return;
        }
        setHint({
          text,
          left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 280)),
          top: Math.max(8, Math.min(rect.top, window.innerHeight - 88)),
        });
      }, delayMs);
    },
    [delayMs],
  );

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setHint(undefined);
  }, []);

  return { hint, show, hide };
}

export function HintBubble({ hint }: { hint?: HintState }) {
  if (!hint) {
    return null;
  }
  return (
    <div className="ctx-hint" style={{ left: hint.left, top: hint.top }}>
      {hint.text}
    </div>
  );
}
