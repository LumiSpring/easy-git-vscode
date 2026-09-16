import type { MouseEvent, ReactNode } from "react";

export function IconButton({
  title,
  onClick,
  children,
  className = "icon-btn",
  busy = false,
  disabled = false,
}: {
  title: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  const waiting = busy || disabled;
  return (
    <button
      type="button"
      className={`${className}${busy ? " is-busy" : ""}`}
      title={title}
      aria-label={title}
      aria-busy={busy}
      disabled={waiting}
      onClick={onClick}
    >
      {busy ? <IconSpinner /> : children}
    </button>
  );
}

export function IconSpinner() {
  return (
    <svg className="icon-spinner" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" strokeOpacity="0.28" />
      <path d="M13.2 8A5.2 5.2 0 0 0 8 2.8" />
    </svg>
  );
}

export function IconRefresh() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 8a4.8 4.8 0 0 1 8.2-3.4" />
      <path d="M11.5 2.8v2.6h-2.6" />
      <path d="M12.8 8a4.8 4.8 0 0 1-8.2 3.4" />
      <path d="M4.5 13.2V10.6h2.6" />
    </svg>
  );
}

export function IconFetch() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 2.4v7" />
      <path d="M3.2 7.2 5 9.4l1.8-2.2" />
      <path d="M11 2.4v7" />
      <path d="M9.2 7.2 11 9.4l1.8-2.2" />
      <path d="M2.8 12.8h10.4" />
    </svg>
  );
}

export function IconPull() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 9.4h8v4.2H4z" />
      <path d="M8 2.2v8" />
      <path d="M5.4 7.4 8 10.2l2.6-2.8" />
    </svg>
  );
}

export function IconPush() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 12.6V3.4" />
      <path d="M4.8 6.6 8 3.2l3.2 3.4" />
      <path d="M3.2 13.4h9.6" />
    </svg>
  );
}

export function IconUpdate() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2v7.4" />
      <path d="M5.2 7 8 9.8 10.8 7" />
      <path d="M3 12.2c1.8 2 8.2 2 10 0" />
    </svg>
  );
}

export function IconNewBranch() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.2v9.6" />
      <path d="M3.2 8h9.6" />
    </svg>
  );
}

export function IconAdd() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.2v9.6" />
      <path d="M3.2 8h9.6" />
    </svg>
  );
}

export function IconRollback() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6.8h6.2a2.8 2.8 0 0 1 0 5.6" />
      <path d="M6.6 4.2 4 6.8l2.6 2.6" />
    </svg>
  );
}

export function IconDiff() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.4" y="3" width="6.4" height="8.4" rx="1" />
      <rect x="7.2" y="4.6" width="6.4" height="8.4" rx="1" />
    </svg>
  );
}

export function IconHistory() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" />
      <path d="M8 5.2v3.1l2.1 1.3" />
    </svg>
  );
}

export function IconEye() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.8 8s2.4-4.4 6.2-4.4S14.2 8 14.2 8s-2.4 4.4-6.2 4.4S1.8 8 1.8 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

export function IconShelve() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.6 3.6h10.8v2.4H2.6z" />
      <path d="M3.4 6h9.2v6.6H3.4z" />
      <path d="M3.4 9.2h9.2" />
      <path d="M3.4 11.4h9.2" />
    </svg>
  );
}

export function IconStash() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.6 6.2 8 3.4l5.4 2.8-5.4 2.8-5.4-2.8z" />
      <path d="M2.6 8.6 8 11.4l5.4-2.8" />
      <path d="M2.6 11 8 13.8l5.4-2.8" />
    </svg>
  );
}

export function IconChangelist() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 4.2h9.6" />
      <path d="M3.2 8h9.6" />
      <path d="M3.2 11.8h6.2" />
      <path d="M11.4 10.4v3.2" />
      <path d="M9.8 12h3.2" />
    </svg>
  );
}

export function IconPop() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.2v7.2" />
      <path d="M5.2 7.6 8 10.6l2.8-3" />
      <path d="M3.2 13.2h9.6" />
    </svg>
  );
}

export function MenuIcon({ name }: { name: string }) {
  const icon = menuIconPath(name);
  return (
    <svg className="ctx-icon" viewBox="0 0 16 16" aria-hidden="true">
      {icon}
    </svg>
  );
}

function menuIconPath(name: string) {
  switch (name) {
    case "commit":
      return (
        <>
          <circle cx="8" cy="8" r="5.2" />
          <path d="M5.4 8.1 7.2 10l3.5-4.2" />
        </>
      );
    case "diff":
    case "diff-file":
      return (
        <>
          <rect x="2.4" y="3" width="6.4" height="8.4" rx="1" />
          <rect x="7.2" y="4.6" width="6.4" height="8.4" rx="1" />
        </>
      );
    case "rollback":
    case "revert":
      return (
        <>
          <path d="M4 6.8h6.2a2.8 2.8 0 0 1 0 5.6" />
          <path d="M6.6 4.2 4 6.8l2.6 2.6" />
        </>
      );
    case "ignore":
      return (
        <>
          <circle cx="8" cy="8" r="5.2" />
          <path d="M4.6 4.6 11.4 11.4" />
        </>
      );
    case "ignore-directory":
      return (
        <>
          <path d="M2.4 4.3h4l1.2 1.5h6v6.6H2.4z" />
          <path d="M3.3 12.4 12.7 4" />
        </>
      );
    case "move":
    case "add-to-group":
      return (
        <>
          <path d="M2.6 4.2h4l1.1 1.4h5.7v6.8H2.6z" />
          <path d="M6.4 9.2h5.2" />
          <path d="M9.4 7.2 11.6 9.2 9.4 11.2" />
        </>
      );
    case "shelve":
    case "stash-apply":
      return (
        <>
          <path d="M2.6 6.2 8 3.4l5.4 2.8-5.4 2.8-5.4-2.8z" />
          <path d="M2.6 8.6 8 11.4l5.4-2.8" />
          <path d="M2.6 11 8 13.8l5.4-2.8" />
        </>
      );
    case "track":
      return (
        <>
          <circle cx="8" cy="8" r="5.2" />
          <path d="M8 5.2v5.6" />
          <path d="M5.2 8h5.6" />
        </>
      );
    case "untrack":
      return (
        <>
          <circle cx="8" cy="8" r="5.2" />
          <path d="M5.2 8h5.6" />
        </>
      );
    case "active":
      return (
        <>
          <path d="M8 2.8 9.5 6.2l3.7.4-2.8 2.5.8 3.6L8 10.9l-3.2 1.8.8-3.6-2.8-2.5 3.7-.4z" />
        </>
      );
    case "rename":
    case "rename-branch":
      return (
        <>
          <path d="M3.2 12.6 6 11.8 12.4 5.4a1.3 1.3 0 0 0 0-1.8L11.4 3a1.3 1.3 0 0 0-1.8 0L3.2 9.4z" />
          <path d="M9 4.2 11.4 6.6" />
        </>
      );
    case "delete-cl":
    case "delete-shelf":
    case "delete-branch":
    case "stash-drop":
      return (
        <>
          <path d="M3.2 4.6h9.6" />
          <path d="M6.2 4.6V3.4h3.6v1.2" />
          <path d="M4.6 4.6 5.2 13h5.6l.6-8.4" />
        </>
      );
    case "ours":
      return (
        <>
          <path d="M10.8 8H4.2" />
          <path d="M6.4 5.6 4.2 8l2.2 2.4" />
          <path d="M12.4 4.2v7.6" />
        </>
      );
    case "theirs":
      return (
        <>
          <path d="M5.2 8h6.6" />
          <path d="M9.6 5.6 11.8 8l-2.2 2.4" />
          <path d="M3.6 4.2v7.6" />
        </>
      );
    case "merge":
      return (
        <>
          <circle cx="4.2" cy="3.6" r="1.4" />
          <circle cx="4.2" cy="12.4" r="1.4" />
          <circle cx="11.8" cy="8" r="1.4" />
          <path d="M4.2 5v5.4" />
          <path d="M4.2 8h4.2a2.4 2.4 0 0 1 2.4 2.2" />
        </>
      );
    case "stash-pop":
    case "unshelve":
      return (
        <>
          <path d="M8 3.2v7.2" />
          <path d="M5.2 7.6 8 10.6l2.8-3" />
          <path d="M3.2 13.2h9.6" />
        </>
      );
    case "checkout":
    case "checkout-commit":
      return (
        <>
          <circle cx="4.4" cy="4" r="1.4" />
          <circle cx="4.4" cy="12" r="1.4" />
          <path d="M4.4 5.4v5.2" />
          <path d="M8.2 8.2h5" />
          <path d="M11.2 5.8 13.4 8.2 11.2 10.6" />
        </>
      );
    case "new-branch":
    case "new-branch-from":
      return (
        <>
          <path d="M8 3.2v9.6" />
          <path d="M3.2 8h9.6" />
        </>
      );
    case "push":
    case "push-branch":
      return (
        <>
          <path d="M8 12.6V3.4" />
          <path d="M4.8 6.6 8 3.2l3.2 3.4" />
          <path d="M3.2 13.4h9.6" />
        </>
      );
    case "cherry":
      return (
        <>
          <circle cx="6.2" cy="10.4" r="2.4" />
          <circle cx="10.6" cy="9.2" r="2.2" />
          <path d="M8.4 4.2c1.2 1.6 2.2 2.8 2.2 4.4" />
          <path d="M8.4 4.2c-1 1.8-1.8 3.2-2.2 5" />
        </>
      );
    case "reset":
      return (
        <>
          <path d="M4.2 8h7.6" />
          <path d="M6.4 5.6 4.2 8l2.2 2.4" />
          <path d="M11.8 4.6v6.8" />
        </>
      );
    case "reset-soft":
      return (
        <>
          <path d="M4.2 8h7.6" />
          <path d="M6.4 5.6 4.2 8l2.2 2.4" />
          <path d="M11.8 5.2v5.6" />
        </>
      );
    case "reset-mixed":
      return (
        <>
          <path d="M4.2 8h5.4" />
          <path d="M6.4 5.6 4.2 8l2.2 2.4" />
          <path d="M10.4 4.8v6.4" />
          <path d="M12.6 4.8v6.4" />
        </>
      );
    case "reset-hard":
      return (
        <>
          <path d="M4.2 8h7.6" />
          <path d="M6.4 5.6 4.2 8l2.2 2.4" />
          <path d="M4.8 4.4 11.4 11.6" />
        </>
      );
    case "copy":
      return (
        <>
          <rect x="5.4" y="3.2" width="7" height="8.2" rx="1" />
          <rect x="3.4" y="5.2" width="7" height="8.2" rx="1" />
        </>
      );
    case "rebase":
      return (
        <>
          <circle cx="4.4" cy="3.6" r="1.4" />
          <circle cx="4.4" cy="12.4" r="1.4" />
          <path d="M4.4 5v5.4" />
          <path d="M4.4 8.2h6.4" />
          <path d="M8.6 5.8 11.2 8.2 8.6 10.6" />
        </>
      );
    case "compare":
      return (
        <>
          <rect x="2.6" y="3.2" width="4.6" height="9.6" rx="1" />
          <rect x="8.8" y="3.2" width="4.6" height="9.6" rx="1" />
        </>
      );
    case "add-remote":
      return (
        <>
          <path d="M8 3.2v9.6" />
          <path d="M3.2 8h9.6" />
        </>
      );
    case "active-remote":
      return (
        <>
          <path d="M8 2.8 9.5 6.2l3.7.4-2.8 2.5.8 3.6L8 10.9l-3.2 1.8.8-3.6-2.8-2.5 3.7-.4z" />
        </>
      );
    case "fetch-remote":
      return (
        <>
          <path d="M8 2.4v7" />
          <path d="M5.2 7.2 8 9.4l2.8-2.2" />
          <path d="M2.8 12.8h10.4" />
        </>
      );
    case "open-remote":
      return (
        <>
          <path d="M7.2 4.2H4.2v7.6h7.6V8.8" />
          <path d="M9 3.4h3.6V7" />
          <path d="M8.2 7.8 12.4 3.6" />
        </>
      );
    case "copy-remote":
      return (
        <>
          <rect x="5.4" y="3.2" width="7" height="8.2" rx="1" />
          <rect x="3.4" y="5.2" width="7" height="8.2" rx="1" />
        </>
      );
    case "edit-remote":
      return (
        <>
          <path d="M3.2 12.6 6 11.8 12.4 5.4a1.3 1.3 0 0 0 0-1.8L11.4 3a1.3 1.3 0 0 0-1.8 0L3.2 9.4z" />
          <path d="M9 4.2 11.4 6.6" />
        </>
      );
    case "remove-remote":
      return (
        <>
          <path d="M3.2 4.6h9.6" />
          <path d="M6.2 4.6V3.4h3.6v1.2" />
          <path d="M4.6 4.6 5.2 13h5.6l.6-8.4" />
        </>
      );
    default:
      return <circle cx="8" cy="8" r="1.4" />;
  }
}
