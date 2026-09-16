import type { ToastItem } from "./useBusy";

export function ProgressBreath({ active }: { active: boolean }) {
  if (!active) {
    return null;
  }
  return <div className="progress-breath" role="progressbar" aria-busy="true" />;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) {
    return null;
  }
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast-${toast.kind}`}
          onClick={() => onDismiss(toast.id)}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.kind === "info" ? "i" : "!"}
          </span>
          <span className="toast-text">{toast.message}</span>
        </button>
      ))}
    </div>
  );
}
