import { useCallback, useEffect, useMemo, useRef, useState, useActionState } from "react";
import { createRoot } from "react-dom/client";
import type { ChangeViewOptions, CommitViewState, GitFileChange, HostToWebview } from "@ipc";
import { parseLocale, setLocale, t } from "@i18n";
import { ContextMenu, type MenuItem } from "../shared/ContextMenu";
import { dirName, fileName, formatTime } from "../shared/format";
import { FileChangeLabel } from "../shared/FileChangeLabel";
import {
  IconButton,
  IconAdd,
  IconChangelist,
  IconDiff,
  IconEye,
  IconHistory,
  IconPop,
  IconRefresh,
  IconRollback,
  IconShelve,
  IconStash,
} from "../shared/icons";
import { collectNodeFiles, groupChangeFiles, type FileTreeNode } from "./groupFiles";
import { changeViewMenu, DEFAULT_CHANGE_VIEW } from "../shared/changeViewMenu";
import "../shared/styles.css";
import { ProgressBreath, ToastStack } from "../shared/ActionChrome";
import { EmptyRepoSetup } from "../shared/EmptyRepo";
import { HintBubble, useDelayedHint } from "../shared/HoverHint";
import { useBusy } from "../shared/useBusy";
import { consumeResult, ready, request } from "../shared/vscodeApi";

type CommitTab = "commit" | "stashes" | "shelf";
const LONG_PRESS_MS = 320;
const DROP_IDS = new Set(["unversioned", "conflicts"]);

const emptyState: CommitViewState = {
  files: [],
  changelists: [],
  modules: [],
  changeView: DEFAULT_CHANGE_VIEW,
  conflictFiles: [],
  operation: "none",
  stashes: [],
  shelves: [],
  ahead: 0,
  behind: 0,
  language: "zh-cn",
};

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  files: string[];
  extra?: string;
  kind?: "change-view";
}

interface DragState {
  files: string[];
  x: number;
  y: number;
  overId?: string;
}

interface DragSession {
  timer?: number;
  files: string[];
  startX: number;
  startY: number;
  active: boolean;
}

function CommitApp() {
  const [state, setState] = useState<CommitViewState>(emptyState);
  setLocale(parseLocale(state.language));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [menu, setMenu] = useState<MenuState | undefined>();
  const [tab, setTab] = useState<CommitTab>("commit");
  const [messageHeight, setMessageHeight] = useState(72);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const [openStashes, setOpenStashes] = useState<Set<number>>(new Set());
  const [openShelves, setOpenShelves] = useState<Set<string>>(new Set());
  const [collapsedLists, setCollapsedLists] = useState<Set<string>>(new Set());
  const [collapsedTrees, setCollapsedTrees] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const suppressMenuRef = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const { busy, run, locked, toasts, dismiss, notify } = useBusy();
  const tabHint = useDelayedHint();

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const data = event.data;
      if (consumeResult(data)) {
        return;
      }
      if (data.type === "commitState") {
        setState(data.payload);
        setSelected((current) => {
          const known = new Set(data.payload.files.map((file) => file.path));
          return new Set([...current].filter((path) => known.has(path)));
        });
      }
      if (data.type === "dismissUi") {
        setMenu(undefined);
      }
    };
    window.addEventListener("message", onMessage);
    ready("commit");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const dropGroupAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el?.closest("[data-drop-group]")?.getAttribute("data-drop-group") ?? undefined;
    };
    const onMove = (event: PointerEvent) => {
      const session = dragRef.current;
      if (!session) {
        return;
      }
      if (!session.active) {
        const dx = event.clientX - session.startX;
        const dy = event.clientY - session.startY;
        if (dx * dx + dy * dy > 64) {
          window.clearTimeout(session.timer);
          dragRef.current = null;
        }
        return;
      }
      setDrag({ files: session.files, x: event.clientX, y: event.clientY, overId: dropGroupAt(event.clientX, event.clientY) });
    };
    const onUp = (event: PointerEvent) => {
      const session = dragRef.current;
      if (!session) {
        return;
      }
      window.clearTimeout(session.timer);
      if (session.active) {
        suppressMenuRef.current = true;
        window.setTimeout(() => {
          suppressMenuRef.current = false;
        }, 400);
      }
      dragRef.current = null;
      setDrag(null);
      if (!session.active) {
        return;
      }
      const target = dropGroupAt(event.clientX, event.clientY);
      if (!target || DROP_IDS.has(target)) {
        return;
      }
      void request("moveToChangelist", { files: session.files, changelistId: target });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    setMenu((current) => {
      if (!current || current.kind !== "change-view") {
        return current;
      }
      return { ...current, items: changeViewMenu(state.changeView ?? DEFAULT_CHANGE_VIEW) };
    });
  }, [state.changeView]);

  const filesByPath = useMemo(() => {
    const map = new Map<string, GitFileChange[]>();
    for (const file of state.files) {
      const entries = map.get(file.path) ?? [];
      entries.push(file);
      map.set(file.path, entries);
    }
    return map;
  }, [state.files]);

  const fileFor = (filePath: string, listId?: string) => {
    const entries = filesByPath.get(filePath) ?? [];
    if (listId === "unversioned") {
      return entries.find((file) => file.status === "untracked" || file.status === "ignored") ?? entries[0];
    }
    if (listId === "conflicts") {
      return entries.find((file) => file.status === "conflict") ?? entries[0];
    }
    return entries.find((file) => file.status !== "untracked" && file.status !== "conflict" && file.status !== "ignored") ?? entries[0];
  };

  const toggleGroup = (files: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const file of files) {
        if (checked) {
          next.add(file);
        } else {
          next.delete(file);
        }
      }
      return next;
    });
  };

  const selectOnly = (files: string[]) => {
    setSelected(new Set(files));
  };

  const untrackedPaths = (files: string[]) =>
    files.filter((path) => (filesByPath.get(path) ?? []).some((file) => file.status === "untracked"));

  const addToChanges = (files: string[]) => {
    const targets = untrackedPaths(files);
    if (!targets.length) {
      notify(t("select.noneAdd"), "warning");
      return;
    }
    void run("track", "Add", () => request("track", { files: targets }));
  };

  const toggleExpanded = <T,>(current: Set<T>, key: T): Set<T> => {
    const next = new Set(current);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  };

  const startFileDrag = (event: React.PointerEvent, filePath: string) => {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest("input, button")) {
      return;
    }
    const current = selectedRef.current;
    const files = current.has(filePath) && current.size > 1 ? [...current] : [filePath];
    window.clearTimeout(dragRef.current?.timer);
    const startX = event.clientX;
    const startY = event.clientY;
    const timer = window.setTimeout(() => {
      suppressMenuRef.current = true;
      dragRef.current = { files, startX, startY, active: true };
      setSelected(new Set(files));
      setDrag({ files, x: startX, y: startY });
    }, LONG_PRESS_MS);
    dragRef.current = { timer, files, startX, startY, active: false };
  };

  const onMessageResizeDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { startY: event.clientY, startH: messageHeight };
  };

  const onMessageResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeRef.current;
    if (!start) {
      return;
    }
    const next = Math.min(Math.max(start.startH + (start.startY - event.clientY), 72), 420);
    setMessageHeight(next);
  };

  const onMessageResizeUp = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const openMenu = (event: React.MouseEvent, files: string[], groupId?: string) => {
    event.preventDefault();
    if (suppressMenuRef.current || dragRef.current?.active) {
      return;
    }
    const items: MenuItem[] = [];
    if (groupId === "conflicts" || files.some((file) => fileFor(file, groupId)?.status === "conflict")) {
      items.push(
        { id: "ours", label: "Accept Yours" },
        { id: "theirs", label: "Accept Theirs" },
        { id: "merge-editor", label: "Resolve in Merge Editor" },
      );
    }
    items.push(
      { id: "diff", label: "Show Diff" },
      { id: "rollback", label: "Rollback", danger: true },
      { id: "ignore", label: "Ignore" },
      {
        id: "ignore-directory",
        label: "Ignore Directory",
        disabled: !files.some((file) => file.replace(/\\/g, "/").includes("/")),
      },
      groupId === "unversioned"
        ? { id: "add-to-group", label: "Add to ChangeGroup…" }
        : { id: "move", label: "Move to Another ChangeGroup…" },
      { id: "shelve", label: "Shelve" },
    );
    const statuses = files.map((file) => fileFor(file, groupId)?.status);
    if (statuses.every((status) => status === "untracked")) {
      items.unshift({ id: "track", label: "Add" });
    } else if (statuses.some((status) => status && status !== "untracked" && status !== "conflict" && status !== "ignored")) {
      items.push({ id: "untrack", label: "Untrack" });
    }
    items.unshift({ id: "commit", label: "Commit", disabled: files.length === 0 });
    if (!(files.length > 1 && files.every((file) => selected.has(file)))) {
      selectOnly(files);
    }
    setMenu({ x: event.clientX, y: event.clientY, items, files, extra: groupId });
  };

  const onMenu = async (id: string) => {
    const files = menu?.files ?? [];
    if (id === "diff") {
      await request("showDiff", { files });
    } else if (id === "commit") {
      if (!files.length) {
        notify(t("select.noneCommit"), "warning");
        return;
      }
      await run("commit", "Commit", () => request("commit", { message: message.trim(), files, amend: false }));
      setMessage("");
    } else if (id === "rollback") {
      await request("rollback", { files });
    } else if (id === "ignore") {
      await request("ignore", { files });
    } else if (id === "ignore-directory") {
      await request("ignoreFolder", { files });
    } else if (id === "ours") {
      await request("acceptOurs", { files });
    } else if (id === "theirs") {
      await request("acceptTheirs", { files });
    } else if (id === "merge-editor") {
      await request("openMergeEditor", { files });
    } else if (id === "show-conflicts") {
      await request("showConflicts");
    } else if (id === "move") {
      if (!files.length) {
        notify(t("select.noneMove"), "warning");
        return;
      }
      await request("moveToChangelist", { files });
    } else if (id === "add-to-group") {
      if (!files.length) {
        notify(t("select.noneAdd"), "warning");
        return;
      }
      await request("moveToChangelist", { files, mode: "add" });
    } else if (id === "shelve") {
      await request("shelve", { files });
    } else if (id === "track") {
      await request("track", { files });
    } else if (id === "untrack") {
      await request("untrack", { files });
    }
  };

  const submitCommit = async (_prev: string | null, formData: FormData): Promise<string | null> => {
    const intent = String(formData.get("intent") ?? "commit");
    const text = String(formData.get("message") ?? "");
    const amend = formData.get("amend") === "on";
    const files = [...selected];
    try {
      if (intent === "push") {
        const data = await request<{ message?: string }>("commitAndPush", { message: text, files, amend, push: true });
        notify(data?.message || t("toast.committedPushed"));
      } else {
        const data = await request<{ message?: string }>(amend ? "amendCommit" : "commit", { message: text, files, amend });
        notify(data?.message || t("toast.commitDone"));
      }
      setMessage("");
      return null;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      notify(text, "error");
      return text;
    }
  };

  const [error, formAction, pending] = useActionState(submitCommit, null);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    [],
  );

  const applyChangeView = (patch: Partial<ChangeViewOptions>) => {
    const next = { ...(state.changeView ?? DEFAULT_CHANGE_VIEW), ...patch };
    setState((current) => ({ ...current, changeView: next }));
    void request("setChangeView", patch);
  };

  const openChangeViewMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (menu?.kind === "change-view") {
      setMenu(undefined);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const view = state.changeView ?? DEFAULT_CHANGE_VIEW;
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      files: [],
      kind: "change-view",
      items: changeViewMenu(view),
    });
  };

  const renderFileRow = (filePath: string, listId: string, depth: number, hideDir: boolean) => {
    const file = fileFor(filePath, listId);
    if (!file) {
      return null;
    }
    const menuFiles = selected.has(filePath) && selected.size > 1 ? [...selected] : [filePath];
    return (
      <div
        key={filePath}
        className={`file-row status-${file.status} ${selected.has(filePath) ? "selected" : ""} ${drag?.files.includes(filePath) ? "is-dragging" : ""}`}
        style={depth > 0 ? { paddingLeft: 22 + depth * 14 } : undefined}
        onPointerDown={(event) => startFileDrag(event, filePath)}
        onDoubleClick={() =>
          void request(file.status === "conflict" ? "openMergeEditor" : "showDiff", { files: [filePath] })
        }
        onContextMenu={(event) => openMenu(event, menuFiles, listId)}
      >
        <input
          type="checkbox"
          className="check"
          checked={selected.has(filePath)}
          onChange={(event) => toggleGroup([filePath], event.target.checked)}
        />
        <FileChangeLabel
          status={file.status}
          path={filePath}
          oldPath={file.oldPath}
          hideDir={hideDir}
          modules={state.modules}
        />
        {file.status === "untracked" ? (
          <button
            type="button"
            className="file-track plus"
            title="Add"
            disabled={locked}
            onClick={(event) => {
              event.stopPropagation();
              void run(`track-${filePath}`, "Add", () => request("track", { files: [filePath] }));
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            +
          </button>
        ) : file.status !== "conflict" && file.status !== "ignored" ? (
          <button
            type="button"
            className="file-track minus"
            title="Untrack"
            disabled={locked}
            onClick={(event) => {
              event.stopPropagation();
              void run(`untrack-${filePath}`, "Untrack", () => request("untrack", { files: [filePath] }));
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            −
          </button>
        ) : null}
      </div>
    );
  };

  const renderTreeNode = (node: FileTreeNode, listId: string, depth: number, hideDir: boolean): React.ReactNode => {
    const nodeFiles = collectNodeFiles(node);
    const nodeKey = `${listId}:${node.key}`;
    const open = !collapsedTrees.has(nodeKey);
    const checkedCount = nodeFiles.filter((file) => selected.has(file)).length;
    const allChecked = nodeFiles.length > 0 && checkedCount === nodeFiles.length;
    const partial = checkedCount > 0 && !allChecked;
    return (
      <div key={node.key}>
        <div
          className={`group-title tree-group folder-node ${node.kind === "mod" ? "mod-node" : ""} ${checkedCount > 0 ? "has-checked" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          aria-expanded={open}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("input")) {
              return;
            }
            setCollapsedTrees((current) => toggleExpanded(current, nodeKey));
          }}
          onContextMenu={(event) => openMenu(event, nodeFiles, listId)}
        >
          <span className={`tree-toggle ${open ? "open" : ""}`} aria-hidden="true">
            ▸
          </span>
          <input
            type="checkbox"
            className="check"
            checked={allChecked}
            ref={(el) => {
              if (el) {
                el.indeterminate = partial;
              }
            }}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => toggleGroup(nodeFiles, event.target.checked)}
          />
          <span title={node.path || node.name}>{node.name}</span>
          <span className="muted">{nodeFiles.length}</span>
        </div>
        {open && (
          <>
            {node.files.map((filePath) => renderFileRow(filePath, listId, depth + 1, hideDir))}
            {node.children.map((child) => renderTreeNode(child, listId, depth + 1, hideDir))}
          </>
        )}
      </div>
    );
  };

  const renderChangeFiles = (listId: string, files: string[]) => {
    const view = state.changeView ?? DEFAULT_CHANGE_VIEW;
    const bucket = groupChangeFiles(files, view, state.modules ?? []);
    const hideDir = view.groupDirectory;
    return (
      <div className="change-files">
        {bucket.files.map((filePath) => renderFileRow(filePath, listId, 1, hideDir))}
        {bucket.children.map((node) => renderTreeNode(node, listId, 1, hideDir))}
      </div>
    );
  };

  if (!state.repoRoot) {
    return (
      <div className={`app${locked ? " is-busy" : ""}`}>
        <ProgressBreath active={locked} />
        <ToastStack toasts={toasts} onDismiss={dismiss} />
        <EmptyRepoSetup
          folder={state.workspaceFolder}
          busy={busy === "init"}
          disabled={locked}
          onInit={() => void run("init", "Initialize Git", () => request("initRepository"))}
        />
      </div>
    );
  }

  return (
    <div className={`app${locked || pending ? " is-busy" : ""}${drag ? " is-file-dragging" : ""}`}>
      <ProgressBreath active={locked || pending} />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <div className="tabs">
        <button type="button" className={tab === "commit" ? "active" : ""} onClick={() => setTab("commit")}>
          Commit
        </button>
        <button
          type="button"
          className={tab === "stashes" ? "active" : ""}
          onClick={() => setTab("stashes")}
          onMouseEnter={(event) => tabHint.show(t("hint.stashesTab"), event.currentTarget)}
          onMouseLeave={tabHint.hide}
        >
          Stashes
        </button>
        <button
          type="button"
          className={tab === "shelf" ? "active" : ""}
          onClick={() => setTab("shelf")}
          onMouseEnter={(event) => tabHint.show(t("hint.shelfTab"), event.currentTarget)}
          onMouseLeave={tabHint.hide}
        >
          Shelf
        </button>
      </div>
      <HintBubble hint={tabHint.hint} />
      {state.operation !== "none" && (
        <div className="op-banner">
          <span>{t("op.inProgress", { op: state.operation })}</span>
          {state.conflictFiles.length > 0 && (
            <button
              type="button"
              className="apply"
              disabled={locked}
              onClick={() => {
                const conflictSet = new Set(state.conflictFiles);
                const files = [...selected].filter((file) => conflictSet.has(file));
                void run("apply", "Apply", () => request("applyMergeSession", { files }));
              }}
            >
              Apply
            </button>
          )}
          <button type="button" className="primary" disabled={locked} onClick={() => void run("continue", "Continue", () => request("continueOp"))}>
            Continue
          </button>
          <button type="button" className="abort" disabled={locked} onClick={() => void run("abort", "Abort", () => request("abortOp"))}>
            Abort
          </button>
        </div>
      )}
      <div className="toolbar">
        <IconButton title="Refresh" busy={busy === "refresh"} disabled={locked} onClick={() => void run("refresh", "Refresh", () => request("refresh"))}>
          <IconRefresh />
        </IconButton>
        {tab === "commit" && (
          <>
            <IconButton
              title="Add"
              busy={busy === "track"}
              disabled={locked}
              onClick={() => addToChanges([...selected])}
            >
              <IconAdd />
            </IconButton>
            <IconButton
              title="Rollback"
              busy={busy === "rollback"}
              disabled={locked}
              onClick={() => {
                const files = [...selected];
                if (!files.length) {
                  notify(t("select.noneRollback"), "warning");
                  return;
                }
                void run("rollback", "Rollback", () => request("rollback", { files }));
              }}
            >
              <IconRollback />
            </IconButton>
            <IconButton
              title="Show Diff"
              busy={busy === "diff"}
              disabled={locked}
              onClick={() => {
                const files = [...selected];
                if (!files.length) {
                  notify(t("select.noneDiff"), "warning");
                  return;
                }
                void run("diff", "Show Diff", () => request("showDiff", { files }));
              }}
            >
              <IconDiff />
            </IconButton>
            <span className="sep" />
            <IconButton title="Git Log" busy={busy === "log"} disabled={locked} onClick={() => void run("log", "Git Log", () => request("openLog"))}>
              <IconHistory />
            </IconButton>
            <span data-menu-anchor="change-view">
              <IconButton title="Group By" disabled={locked} onClick={openChangeViewMenu}>
                <IconEye />
              </IconButton>
            </span>
            <span className="spacer" />
            <IconButton
              title="New ChangeGroup"
              busy={busy === "changelist"}
              disabled={locked}
              onClick={() =>
                void run("changelist", "New ChangeGroup", () => request("createChangelist", { files: [...selected] }))
              }
            >
              <IconChangelist />
            </IconButton>
            <IconButton
              title="Stash"
              busy={busy === "stash"}
              disabled={locked}
              onClick={() => {
                const files = [...selected];
                if (!files.length) {
                  notify(t("select.noneStash"), "warning");
                  return;
                }
                void run("stash", "Stash", () => request("stashPush", { files }));
              }}
            >
              <IconStash />
            </IconButton>
            <IconButton
              title="Shelve"
              busy={busy === "shelve"}
              disabled={locked}
              onClick={() => {
                const files = [...selected];
                if (!files.length) {
                  notify(t("select.noneShelve"), "warning");
                  return;
                }
                void run("shelve", "Shelve", () => request("shelve", { files }));
              }}
            >
              <IconShelve />
            </IconButton>
          </>
        )}
        {tab === "stashes" && (
          <>
            <span className="spacer" />
            <IconButton
              title="Stash Changes"
              busy={busy === "stash"}
              disabled={locked}
              onClick={() => {
                const files = [...selected];
                if (!files.length) {
                  notify(t("select.noneStash"), "warning");
                  return;
                }
                void run("stash", "Stash", () => request("stashPush", { files }));
              }}
            >
              <IconStash />
            </IconButton>
          </>
        )}
        {tab === "shelf" && (
          <>
            <span className="spacer" />
            <IconButton
              title="Shelve Changes"
              busy={busy === "shelve"}
              disabled={locked}
              onClick={() => {
                const files = [...selected];
                if (!files.length) {
                  notify(t("select.noneShelve"), "warning");
                  return;
                }
                void run("shelve", "Shelve", () => request("shelve", { files }));
              }}
            >
              <IconShelve />
            </IconButton>
          </>
        )}
      </div>
      <div className="scroll">
        {tab === "commit" && state.changelists.map((list) => {
          const files = list.files;
          const checkedCount = files.filter((file) => selected.has(file)).length;
          const allChecked = files.length > 0 && checkedCount === files.length;
          const droppable = !DROP_IDS.has(list.id);
          const open = !collapsedLists.has(list.id);
          return (
            <section
              key={list.id}
              className={`group${drag?.overId === list.id ? " drop-over" : ""}`}
              data-drop-group={droppable ? list.id : undefined}
            >
              <div
                className={`group-title cl-title tree-group ${list.active ? "active-cl" : ""} ${checkedCount > 0 ? "has-checked" : ""}`}
                aria-expanded={open}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("input")) {
                    return;
                  }
                  setCollapsedLists((current) => toggleExpanded(current, list.id));
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  selectOnly(files);
                  setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    files,
                    extra: list.id,
                    items: [
                      ...(list.id === "unversioned"
                        ? [{ id: "track", label: "Add", disabled: files.length === 0 }]
                        : []),
                      ...(list.id === "conflicts" ? [{ id: "show-conflicts", label: "Resolve Conflicts…" }] : []),
                      { id: "commit", label: "Commit", disabled: files.length === 0 },
                      { id: "active", label: "Set Active ChangeGroup", disabled: list.id === "unversioned" || list.id === "conflicts" },
                      { id: "rename", label: "Rename…", disabled: list.id === "changes" || list.id === "unversioned" || list.id === "conflicts" },
                      { id: "delete-cl", label: "Delete ChangeGroup", danger: true, disabled: list.id === "changes" || list.id === "unversioned" || list.id === "conflicts" },
                    ],
                  });
                }}
              >
                <span className={`tree-toggle ${open ? "open" : ""}`} aria-hidden="true">
                  ▸
                </span>
                <input
                  type="checkbox"
                  className="check"
                  checked={allChecked}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => toggleGroup(files, event.target.checked)}
                />
                <span>
                  {list.name}
                  {list.active ? " (active)" : ""}
                </span>
                <span className="muted">{files.length}</span>
                {list.id === "conflicts" && (
                  <button
                    type="button"
                    className="conflict-resolve"
                    onClick={(event) => {
                      event.stopPropagation();
                      void request("showConflicts");
                    }}
                  >
                    Resolve...
                  </button>
                )}
              </div>
              {open && renderChangeFiles(list.id, files)}
            </section>
          );
        })}
        {tab === "stashes" && (
          <section className="group">
            {state.stashes.length === 0 ? (
              <div className="empty">No stashes</div>
            ) : (
              state.stashes.map((stash) => {
                const open = openStashes.has(stash.index);
                const stashFiles = stash.files ?? [];
                return (
                  <div key={stash.name}>
                    <div
                      className="group-title tree-group stash-row"
                      onClick={() => setOpenStashes((current) => toggleExpanded(current, stash.index))}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMenu({
                          x: event.clientX,
                          y: event.clientY,
                          files: [],
                          extra: String(stash.index),
                          items: [
                            { id: "stash-pop", label: "Pop" },
                            { id: "stash-apply", label: "Apply" },
                            { id: "stash-drop", label: "Drop", danger: true },
                          ],
                        });
                      }}
                    >
                      <span className={`tree-toggle ${open ? "open" : ""}`}>▸</span>
                      <span className="path" title={stash.subject}>
                        {stash.name}: {stash.subject}
                      </span>
                      <span className="muted">{formatTime(stash.timestamp)}</span>
                      <span onClick={(event) => event.stopPropagation()}>
                        <IconButton
                          title="Pop"
                          busy={busy === `pop-${stash.index}`}
                          disabled={locked}
                          onClick={() => void run(`pop-${stash.index}`, "Pop", () => request("stashPop", { index: stash.index }))}
                        >
                          <IconPop />
                        </IconButton>
                      </span>
                    </div>
                    <div className={`tree-fold ${open ? "open" : ""}`}>
                      <div className="tree-fold-inner">
                        {stashFiles.length === 0 ? (
                          <div className="file-row nested muted">No files</div>
                        ) : (
                          stashFiles.map((file) => (
                            <div
                              key={`${stash.index}-${file.path}`}
                              className={`file-row nested status-${file.status}`}
                              onDoubleClick={() =>
                                void request("showDiff", {
                                  files: [file.path],
                                  hash: `stash@{${stash.index}}`,
                                  status: file.status,
                                })
                              }
                            >
                              <FileChangeLabel status={file.status} path={file.path} oldPath={file.oldPath} />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}
        {tab === "shelf" && (
          <section className="group">
            {state.shelves.length === 0 ? (
              <div className="empty">No shelves</div>
            ) : (
              state.shelves.map((shelf) => {
                const open = openShelves.has(shelf.id);
                return (
                  <div key={shelf.id}>
                    <div
                      className="group-title tree-group stash-row"
                      onClick={() => setOpenShelves((current) => toggleExpanded(current, shelf.id))}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMenu({
                          x: event.clientX,
                          y: event.clientY,
                          files: [],
                          extra: shelf.id,
                          items: [
                            { id: "unshelve", label: "Unshelve" },
                            { id: "delete-shelf", label: "Delete", danger: true },
                          ],
                        });
                      }}
                    >
                      <span className={`tree-toggle ${open ? "open" : ""}`}>▸</span>
                      <span className="path" title={shelf.name}>
                        {shelf.name}
                      </span>
                      <span className="muted">
                        {formatTime(shelf.createdAt)}
                        {shelf.files.length ? ` · ${shelf.files.length} files` : ""}
                      </span>
                      <span onClick={(event) => event.stopPropagation()}>
                        <IconButton
                          title="Unshelve"
                          busy={busy === `unshelve-${shelf.id}`}
                          disabled={locked}
                          onClick={() => void run(`unshelve-${shelf.id}`, "Unshelve", () => request("unshelve", { id: shelf.id }))}
                        >
                          <IconPop />
                        </IconButton>
                      </span>
                    </div>
                    <div className={`tree-fold ${open ? "open" : ""}`}>
                      <div className="tree-fold-inner">
                        {shelf.files.length === 0 ? (
                          <div className="file-row nested muted">No files</div>
                        ) : (
                          shelf.files.map((filePath) => (
                            <div
                              key={`${shelf.id}-${filePath}`}
                              className="file-row nested"
                              onDoubleClick={() => void request("showShelfDiff", { id: shelf.id, file: filePath })}
                            >
                              <span className="path" title={filePath}>
                                <span className="name">{fileName(filePath)}</span>
                                <span className="dir">{dirName(filePath)}</span>
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}
      </div>
      {tab === "commit" && (
      <form className="commit-form" action={formAction}>
        <div
          className="commit-resize"
          title={t("hint.dragDetails")}
          onPointerDown={onMessageResizeDown}
          onPointerMove={onMessageResizeMove}
          onPointerUp={onMessageResizeUp}
          onPointerCancel={onMessageResizeUp}
        />
        <textarea
          name="message"
          placeholder="Commit Message"
          value={message}
          style={{ height: messageHeight }}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <label>
          <input type="checkbox" name="amend" /> Amend
        </label>
        {error && <div className="error">{error}</div>}
        <div className="commit-actions">
          <button className="primary" name="intent" value="commit" disabled={pending || locked}>
            {pending ? t("toast.committing") : "Commit"}
          </button>
          <button className="primary" name="intent" value="push" disabled={pending || locked}>
            Commit and Push
          </button>
        </div>
      </form>
      )}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.files.length === 1 ? fileName(drag.files[0] ?? "") : `${drag.files.length} files`}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(undefined)}
          onSelect={(id) => {
            if (id === "group-directory") {
              applyChangeView({ groupDirectory: !(state.changeView ?? DEFAULT_CHANGE_VIEW).groupDirectory });
            } else if (id === "group-module") {
              applyChangeView({ groupModule: !(state.changeView ?? DEFAULT_CHANGE_VIEW).groupModule });
            } else if (id === "show-ignored") {
              applyChangeView({ showIgnored: !(state.changeView ?? DEFAULT_CHANGE_VIEW).showIgnored });
            } else if (id === "active" && menu.extra) {
              void request("setActiveChangelist", { id: menu.extra });
            } else if (id === "rename" && menu.extra) {
              void request("renameChangelist", { id: menu.extra });
            } else if (id === "delete-cl" && menu.extra) {
              void request("deleteChangelist", { id: menu.extra });
            } else if (id === "stash-pop") {
              void request("stashPop", { index: Number(menu.extra) });
            } else if (id === "stash-apply") {
              void request("stashApply", { index: Number(menu.extra) });
            } else if (id === "stash-drop") {
              void request("stashDrop", { index: Number(menu.extra) });
            } else if (id === "unshelve" && menu.extra) {
              void request("unshelve", { id: menu.extra });
            } else if (id === "delete-shelf" && menu.extra) {
              void request("deleteShelf", { id: menu.extra });
            } else {
              void onMenu(id);
            }
          }}
        />
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<CommitApp />);
}
