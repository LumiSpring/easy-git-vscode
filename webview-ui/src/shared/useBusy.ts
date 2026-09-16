import { useCallback, useState } from "react";

export type ToastKind = "info" | "warning" | "error";

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

const SILENT_LABELS = new Set(["Show Diff", "Git Log", "Refresh"]);

export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const text = message.trim();
      if (!text) {
        return;
      }
      const id = crypto.randomUUID();
      setToasts((list) => [...list, { id, message: text, kind }]);
      window.setTimeout(() => {
        setToasts((list) => list.filter((item) => item.id !== id));
      }, 4200);
    },
    [],
  );

  const run = useCallback(
    async (key: string, label: string, task: () => Promise<unknown>) => {
      setBusy(key);
      try {
        const data = await task();
        const notice = readNotice(data, label);
        if (notice) {
          notify(notice.message, notice.kind);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), "error");
      } finally {
        setBusy(null);
      }
    },
    [notify],
  );

  return { busy, run, locked: busy !== null, toasts, dismiss, notify };
}

function readNotice(data: unknown, label: string): { message: string; kind: ToastKind } | undefined {
  if (data && typeof data === "object") {
    const record = data as { silent?: boolean; message?: unknown; kind?: ToastKind };
    if (record.silent) {
      return undefined;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return { message: record.message.trim(), kind: record.kind ?? "info" };
    }
  }
  if (SILENT_LABELS.has(label)) {
    return undefined;
  }
  return { message: `${label} completed`, kind: "info" };
}
