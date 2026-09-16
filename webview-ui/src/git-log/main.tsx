import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ChangeViewOptions, GitBranch, GitCommitNode, GitFileChange, GitRemote, HostToWebview, LogViewState } from "@ipc";
import { parseLocale, setLocale, t } from "@i18n";
import { collectNodeFiles, groupChangeFiles, type FileTreeNode } from "../commit/groupFiles";
import { changeViewMenu, DEFAULT_CHANGE_VIEW } from "../shared/changeViewMenu";
import { ContextMenu, type MenuItem } from "../shared/ContextMenu";
import { FileChangeLabel } from "../shared/FileChangeLabel";
import { formatClock, formatDuration, formatIdeaStamp, formatTime } from "../shared/format";
import "../shared/styles.css";
import { consumeResult, post, ready, request } from "../shared/vscodeApi";
import {
  IconButton,
  IconEye,
  IconFetch,
  IconNewBranch,
  IconPull,
  IconPush,
  IconUpdate,
} from "../shared/icons";
import { ProgressBreath, ToastStack } from "../shared/ActionChrome";
import { EmptyRepoSetup } from "../shared/EmptyRepo";
import { useBusy } from "../shared/useBusy";

const LAYOUT_KEY = "easyGit.logLayout";
const DEFAULT_LAYOUT = { branches: 240, files: 280, details: 168 };

const emptyState: LogViewState = {
  branches: [],
  remotes: [],
  commits: [],
  console: [],
  search: "",
  operation: "none",
  modules: [],
  changeView: DEFAULT_CHANGE_VIEW,
  language: "zh-cn",
};

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  hash?: string;
  branch?: GitBranch;
  remote?: GitRemote;
  file?: string;
  kind?: "change-view";
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) {
      return DEFAULT_LAYOUT;
    }
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_LAYOUT>;
    return { ...DEFAULT_LAYOUT, ...parsed };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function GitLogApp() {
  const [state, setState] = useState<LogViewState>(emptyState);
  setLocale(parseLocale(state.language));
  const [tab, setTab] = useState<"log" | "console">("log");
  const [query, setQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | undefined>();
  const { busy, run, locked, toasts, dismiss } = useBusy();
  const consoleRef = useRef<HTMLDivElement>(null);
  const layout = useRef(loadLayout());
  const [branchWidth, setBranchWidth] = useState(layout.current.branches);
  const [filesWidth, setFilesWidth] = useState(layout.current.files);
  const [detailsHeight, setDetailsHeight] = useState(layout.current.details);
  const [resizing, setResizing] = useState<"col" | "row" | undefined>();
  const [collapsedTrees, setCollapsedTrees] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const data = event.data;
      if (consumeResult(data)) {
        return;
      }
      if (data.type === "logState") {
        setState(data.payload);
        setQuery(data.payload.search);
      }
      if (data.type === "dismissUi") {
        setMenu(undefined);
      }
    };
    window.addEventListener("message", onMessage);
    ready("log");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (tab !== "console") {
      return;
    }
    const el = consoleRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [tab, state.console]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ branches: branchWidth, files: filesWidth, details: detailsHeight }));
    } catch {
      /* webview storage may be unavailable */
    }
  }, [branchWidth, filesWidth, detailsHeight]);

  useEffect(() => {
    setMenu((current) => {
      if (!current || current.kind !== "change-view") {
        return current;
      }
      return { ...current, items: changeViewMenu(state.changeView ?? DEFAULT_CHANGE_VIEW, { ignored: false }) };
    });
  }, [state.changeView]);

  const local = state.branches.filter((branch) => !branch.remote);
  const remote = state.branches.filter((branch) => branch.remote);
  const current = local.find((branch) => branch.current);
  const localSorted = [...local].sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  const remoteGroups = buildRemoteTree(state.remotes ?? [], remote);
  const activeRemote = (state.remotes ?? []).find((item) => item.active);
  const branchText = branchQuery.trim().toLowerCase();
  const matchBranch = (name: string) => !branchText || name.toLowerCase().includes(branchText);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const searching = Boolean(branchText);
  const isOpen = (id: string) => searching || !collapsed[id];
  const toggleGroup = (id: string) => {
    setCollapsed((currentMap) => ({ ...currentMap, [id]: !currentMap[id] }));
  };
  const selected = state.commits.find((commit) => commit.hash === state.selectedHash);
  const selectedBranch = (fullName?: string) =>
    (state.filterBranch ?? current?.fullName) === fullName;
  const openBranchLog = (fullName: string) => {
    post({ type: "filterBranch", branch: fullName });
  };

  const commitMenu = (): MenuItem[] => [
    { id: "checkout-commit", label: "Checkout Revision" },
    { id: "new-branch", label: "New Branch from Here…" },
    { id: "cherry", label: "Cherry-Pick" },
    { id: "revert", label: "Revert" },
    {
      id: "reset",
      label: "Reset",
      children: [
        { id: "reset-soft", label: "Reset Soft" },
        { id: "reset-mixed", label: "Reset Mixed" },
        { id: "reset-hard", label: "Reset Hard", danger: true },
      ],
    },
    { id: "copy", label: "Copy Revision" },
  ];

  const branchMenu = (branch: GitBranch): MenuItem[] => {
    const items: MenuItem[] = [];
    if (!branch.current) {
      items.push({ id: "checkout", label: "Checkout" });
    }
    items.push({ id: "new-branch-from", label: `New Branch from '${branch.name}'` });
    if (!branch.remote) {
      items.push({ id: "push-branch", label: "Push" });
    }
    items.push(
      { id: "merge", label: "Merge into Current" },
      { id: "rebase", label: "Rebase Current onto This" },
      { id: "compare", label: "Compare with Current" },
      { id: "rename-branch", label: "Rename…", disabled: branch.remote },
      { id: "delete-branch", label: "Delete…", danger: true },
    );
    return items;
  };

  const remoteGroupMenu = (): MenuItem[] => [{ id: "add-remote", label: "Add Remote…" }];

  const remoteMenu = (item: GitRemote): MenuItem[] => [
    { id: "active-remote", label: "Set Active Remote", disabled: item.active },
    { id: "fetch-remote", label: `Fetch '${item.name}'` },
    { id: "open-remote", label: "Open in Browser" },
    { id: "copy-remote", label: "Copy URL" },
    { id: "edit-remote", label: "Edit URL…" },
    { id: "add-remote", label: "Add Remote…" },
    { id: "remove-remote", label: "Remove…", danger: true },
  ];

  const onSelectMenu = async (id: string) => {
    const hash = menu?.hash;
    const branch = menu?.branch;
    const remoteItem = menu?.remote;
    const file = menu?.file;
    if (id === "checkout-commit" && hash) {
      await request("checkout", { branch: hash });
    } else if (id === "new-branch" && hash) {
      await request("newBranchFromCommit", { hash });
    } else if (id === "cherry" && hash) {
      await request("cherryPick", { hash });
    } else if (id === "revert" && hash) {
      await request("revert", { hash });
    } else if (id === "reset-soft" && hash) {
      await request("resetSoft", { hash });
    } else if (id === "reset-mixed" && hash) {
      await request("resetMixed", { hash });
    } else if (id === "reset-hard" && hash) {
      await request("resetHard", { hash });
    } else if (id === "copy" && hash) {
      await request("copyRevision", { hash });
    } else if (id === "checkout" && branch) {
      await request("checkout", { branch: branch.fullName });
    } else if (id === "new-branch-from" && branch) {
      await request("createBranch", { startPoint: branch.fullName });
    } else if (id === "push-branch" && branch) {
      await run("push", "Push", () => request("push", { branch: branch.name }));
    } else if (id === "merge" && branch) {
      await request("merge", { branch: branch.fullName });
    } else if (id === "rebase" && branch) {
      await request("rebase", { branch: branch.fullName });
    } else if (id === "compare" && branch) {
      await request("compareWithCurrent", { branch: branch.fullName });
    } else if (id === "rename-branch" && branch) {
      await request("renameBranch", { oldName: branch.name });
    } else if (id === "delete-branch" && branch) {
      await request("deleteBranch", { branch: branch.fullName, remote: branch.remote });
    } else if (id === "add-remote") {
      await request("addRemote");
    } else if (id === "fetch-remote" && remoteItem) {
      await request("fetchRemote", { name: remoteItem.name });
    } else if (id === "open-remote" && remoteItem) {
      await request("openRemote", { name: remoteItem.name });
    } else if (id === "copy-remote" && remoteItem) {
      await request("copyRemoteUrl", { name: remoteItem.name });
    } else if (id === "edit-remote" && remoteItem) {
      await request("setRemoteUrl", { name: remoteItem.name });
    } else if (id === "remove-remote" && remoteItem) {
      await request("removeRemote", { name: remoteItem.name });
    } else if (id === "active-remote" && remoteItem) {
      await request("setActiveRemote", { name: remoteItem.name });
    } else if (id === "diff-file" && file && hash) {
      await request("showDiff", { files: [file], hash });
    } else if (id === "group-directory") {
      applyChangeView({ groupDirectory: !(state.changeView ?? DEFAULT_CHANGE_VIEW).groupDirectory });
    } else if (id === "group-module") {
      applyChangeView({ groupModule: !(state.changeView ?? DEFAULT_CHANGE_VIEW).groupModule });
    }
  };

  const applyChangeView = (patch: Partial<ChangeViewOptions>) => {
    const next = { ...(state.changeView ?? DEFAULT_CHANGE_VIEW), ...patch };
    setState((current) => ({ ...current, changeView: next }));
    void request("setChangeView", { ...patch, scope: "log" });
  };

  const openChangeViewMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (menu?.kind === "change-view") {
      setMenu(undefined);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      kind: "change-view",
      items: changeViewMenu(state.changeView ?? DEFAULT_CHANGE_VIEW, { ignored: false }),
    });
  };

  const widthDrag = useRef<{
    startX: number;
    start: number;
    invert: boolean;
    min: number;
    max: number;
    setter: (value: number) => void;
  } | null>(null);
  const detailsDrag = useRef<{ startY: number; start: number } | null>(null);

  const onWidthPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    startValue: number,
    invert: boolean,
    setter: (value: number) => void,
    min: number,
    max: number,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    widthDrag.current = { startX: event.clientX, start: startValue, invert, min, max, setter };
    setResizing("col");
  };

  const onWidthPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = widthDrag.current;
    if (!drag) {
      return;
    }
    const delta = event.clientX - drag.startX;
    drag.setter(clamp(drag.start + (drag.invert ? -delta : delta), drag.min, drag.max));
  };

  const onWidthPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    widthDrag.current = null;
    setResizing(undefined);
  };

  const onDetailsPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    detailsDrag.current = { startY: event.clientY, start: detailsHeight };
    setResizing("row");
  };

  const onDetailsPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = detailsDrag.current;
    if (!drag) {
      return;
    }
    setDetailsHeight(clamp(drag.start + (drag.startY - event.clientY), 72, 420));
  };

  const onDetailsPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    detailsDrag.current = null;
    setResizing(undefined);
  };

  const toggleTree = (key: string) => {
    setCollapsedTrees((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderLogFile = (file: GitFileChange, depth: number, hideDir: boolean) => (
    <div
      key={file.path}
      className={`file-row status-${file.status}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onMouseDown={preventTextSelect}
      onDoubleClick={() => void request("showDiff", { files: [file.path], hash: selected?.hash })}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({
          x: event.clientX,
          y: event.clientY,
          items: [{ id: "diff-file", label: "Show Diff" }],
          hash: selected?.hash,
          file: file.path,
        });
      }}
    >
      <FileChangeLabel status={file.status} path={file.path} oldPath={file.oldPath} hideDir={hideDir} modules={state.modules} />
    </div>
  );

  const renderLogNode = (node: FileTreeNode, byPath: Map<string, GitFileChange>, depth: number, hideDir: boolean): ReactNode => {
    const nodeKey = node.key;
    const open = !collapsedTrees.has(nodeKey);
    const count = collectNodeFiles(node).length;
    return (
      <div key={node.key}>
        <div
          className={`group-title tree-group folder-node ${node.kind === "mod" ? "mod-node" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          aria-expanded={open}
          onClick={() => toggleTree(nodeKey)}
        >
          <span className={`tree-toggle ${open ? "open" : ""}`} aria-hidden="true">
            ▸
          </span>
          <span title={node.path || node.name}>{node.name}</span>
          <span className="muted">{count}</span>
        </div>
        {open && (
          <>
            {node.files.map((path) => {
              const file = byPath.get(path);
              return file ? renderLogFile(file, depth + 1, hideDir) : null;
            })}
            {node.children.map((child) => renderLogNode(child, byPath, depth + 1, hideDir))}
          </>
        )}
      </div>
    );
  };

  const renderChangedFiles = (files: GitFileChange[]) => {
    const view = state.changeView ?? DEFAULT_CHANGE_VIEW;
    const bucket = groupChangeFiles(
      files.map((file) => file.path),
      view,
      state.modules ?? [],
    );
    const byPath = new Map(files.map((file) => [file.path, file]));
    const hideDir = view.groupDirectory;
    return (
      <>
        {bucket.files.map((path) => {
          const file = byPath.get(path);
          return file ? renderLogFile(file, bucket.children.length ? 1 : 0, hideDir) : null;
        })}
        {bucket.children.map((node) => renderLogNode(node, byPath, 0, hideDir))}
      </>
    );
  };

  const maxLanes = useMemo(() => {
    let max = 1;
    for (const commit of state.commits) {
      max = Math.max(max, commit.laneCount || 0, (commit.lane ?? 0) + 1);
    }
    return max;
  }, [state.commits]);

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
    <div className={`app${locked ? " is-busy" : ""}${resizing === "col" ? " is-col-resizing" : ""}${resizing === "row" ? " is-row-resizing" : ""}`}>
      <ProgressBreath active={locked} />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <div className="tabs">
        <button type="button" className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>
          Log
        </button>
        <button type="button" className={tab === "console" ? "active" : ""} onClick={() => setTab("console")}>
          Console
        </button>
      </div>
      <div className="log-body">
        <nav className="side-actions" aria-label="Git actions">
          <IconButton
            className="side-action"
            title="New Branch"
            busy={busy === "branch"}
            disabled={locked}
            onClick={() => void run("branch", "New Branch", () => request("createBranch"))}
          >
            <IconNewBranch />
          </IconButton>
          <span className="sep" />
          <IconButton className="side-action" title="Update Project" busy={busy === "update"} disabled={locked} onClick={() => void run("update", "Update Project", () => request("updateProject"))}>
            <IconUpdate />
          </IconButton>
          <IconButton className="side-action" title="Fetch All" busy={busy === "fetch"} disabled={locked} onClick={() => void run("fetch", "Fetch All", () => request("fetch"))}>
            <IconFetch />
          </IconButton>
          <IconButton className="side-action" title="Pull" busy={busy === "pull"} disabled={locked} onClick={() => void run("pull", "Pull", () => request("pull"))}>
            <IconPull />
          </IconButton>
          <IconButton className="side-action" title="Push" busy={busy === "push"} disabled={locked} onClick={() => void run("push", "Push", () => request("push"))}>
            <IconPush />
          </IconButton>
        </nav>
        {tab === "console" ? (
        <div className="scroll console" ref={consoleRef}>
          {state.console.length === 0 && <div className="muted">{t("empty.console")}</div>}
          {state.console.map((entry) => (
            <div key={entry.id} className="console-entry">
              <div className="cmd">
                <span className="when">{formatClock(entry.startedAt)}</span>
                <span className="cmd-text">$ {entry.command}</span>
                <span className="took">{t("empty.duration", { time: formatDuration(entry.durationMs) })}</span>
              </div>
              {entry.stdout}
              {entry.stderr && <div className="error">{entry.stderr}</div>}
              <div className="muted">exit {entry.code}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="split">
          <div className="pane pane-branches" style={{ width: branchWidth, flex: `0 0 ${branchWidth}px` }}>
            <input
              className="search"
              placeholder="Branch or tag"
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
            />
            <div className="scroll">
              {current && matchBranch(current.name) && (
                <div
                  className="group-title head-label"
                  title={t("hint.branchLogCurrent")}
                  onMouseDown={preventTextSelect}
                  onDoubleClick={() => openBranchLog(current.fullName)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, items: branchMenu(current), branch: current });
                  }}
                >
                  <span>HEAD (Current Branch)</span>
                </div>
              )}
              <div className="group-title tree-group" onClick={() => toggleGroup("local")}>
                <TreeToggle open={isOpen("local")} />
                <span>Local</span>
              </div>
              <TreeFold open={isOpen("local")}>
                {localSorted.filter((branch) => matchBranch(branch.name)).map((branch) => (
                  <div
                    key={branch.fullName}
                    className={`branch-item nested ${selectedBranch(branch.fullName) ? "selected" : ""}`}
                    title={t("hint.branchLog")}
                    onMouseDown={preventTextSelect}
                    onDoubleClick={() => openBranchLog(branch.fullName)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, items: branchMenu(branch), branch });
                    }}
                  >
                    <BranchMark current={branch.current} />
                    <span className="path">{branch.name}</span>
                    {(branch.ahead > 0 || branch.behind > 0) && (
                      <span className="sync-badges">
                        {branch.ahead > 0 && <span className="sync-badge ahead">↑{branch.ahead}</span>}
                        {branch.behind > 0 && <span className="sync-badge behind">↓{branch.behind}</span>}
                      </span>
                    )}
                  </div>
                ))}
              </TreeFold>
              <div
                className="group-title tree-group"
                onClick={() => toggleGroup("remote")}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ x: event.clientX, y: event.clientY, items: remoteGroupMenu() });
                }}
              >
                <TreeToggle open={isOpen("remote")} />
                <span>Remote</span>
                {activeRemote && <span className="muted">{activeRemote.name}</span>}
              </div>
              <TreeFold open={isOpen("remote")}>
                {remoteGroups.length === 0 && !branchText && (
                  <div
                    className="branch-item nested muted"
                    onClick={() => void request("addRemote")}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ x: event.clientX, y: event.clientY, items: remoteGroupMenu() });
                    }}
                  >
                    {t("empty.noRemote")}
                  </div>
                )}
                {remoteGroups.map((group) => {
                  const remoteId = `remote:${group.name}`;
                  const remoteOpen = isOpen(remoteId);
                  const visible = sortRemoteItems(
                    group.branches.filter(
                      (item) => matchBranch(item.branch.name) || matchBranch(item.leaf) || matchBranch(group.name),
                    ),
                    current,
                  );
                  const nameMatches = matchBranch(group.name) || matchBranch(group.remote?.fetchUrl ?? "");
                  if (!visible.length && branchText && !nameMatches) {
                    return null;
                  }
                  return (
                    <div key={group.name}>
                      <div
                        className={`group-title tree-group nested${group.remote?.active ? " active-remote" : ""}`}
                        title={group.remote?.fetchUrl ?? group.name}
                        onClick={() => toggleGroup(remoteId)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (group.remote) {
                            setMenu({
                              x: event.clientX,
                              y: event.clientY,
                              items: remoteMenu(group.remote),
                              remote: group.remote,
                            });
                          } else {
                            setMenu({ x: event.clientX, y: event.clientY, items: remoteGroupMenu() });
                          }
                        }}
                      >
                        <TreeToggle open={remoteOpen} />
                        <FolderIcon />
                        <span className="path">
                          {group.name}
                          {group.remote?.active ? " (active)" : ""}
                        </span>
                        {group.remote?.fetchUrl && (
                          <span className="muted remote-url" title={group.remote.fetchUrl}>
                            {group.remote.fetchUrl}
                          </span>
                        )}
                      </div>
                      <TreeFold open={remoteOpen}>
                        {visible.length === 0 ? (
                          <div
                            className="file-row nested muted"
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (group.remote) {
                                setMenu({
                                  x: event.clientX,
                                  y: event.clientY,
                                  items: remoteMenu(group.remote),
                                  remote: group.remote,
                                });
                              }
                            }}
                          >
                            {t("empty.noRemoteBranches")}
                          </div>
                        ) : (
                          visible.map((item) => (
                            <div
                              key={item.branch.fullName}
                              className={`branch-item deep ${selectedBranch(item.branch.fullName) ? "selected" : ""}`}
                              title={t("hint.branchLog")}
                              onMouseDown={preventTextSelect}
                              onDoubleClick={() => openBranchLog(item.branch.fullName)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setMenu({ x: event.clientX, y: event.clientY, items: branchMenu(item.branch), branch: item.branch });
                              }}
                            >
                              <BranchMark current={isTrackedRemote(item.branch, current)} />
                              <span className="path">{item.leaf}</span>
                            </div>
                          ))
                        )}
                      </TreeFold>
                    </div>
                  );
                })}
              </TreeFold>
            </div>
          </div>
          <div
            className={`split-handle${resizing === "col" ? " is-active" : ""}`}
            onPointerDown={(event) => onWidthPointerDown(event, branchWidth, false, setBranchWidth, 140, 520)}
            onPointerMove={onWidthPointerMove}
            onPointerUp={onWidthPointerUp}
            onPointerCancel={onWidthPointerUp}
          />
          <div className="pane pane-commits">
            <input
              className="search"
              placeholder="Text or hash"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  post({ type: "searchLog", query });
                }
              }}
            />
            <div className="scroll">
              {state.commits.length === 0 && <div className="empty">{t("empty.noCommits")}</div>}
              {state.commits.map((commit) => (
                  <div
                    key={commit.hash}
                    className={`commit-row ${commit.hash === state.selectedHash ? "selected" : ""} ${commit.sharedWithCurrent ? "shared" : ""}`}
                    title={commit.sharedWithCurrent ? t("hint.sharedCommit") : undefined}
                    onMouseDown={preventTextSelect}
                    onClick={() => post({ type: "selectCommit", hash: commit.hash })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, items: commitMenu(), hash: commit.hash });
                    }}
                  >
                    <GraphSvg commit={commit} lanes={maxLanes} />
                    <span className="subject" title={commit.subject}>
                      {commit.subject}
                    </span>
                    <RefChips refs={commit.refs} />
                    <span className="muted">{commit.author}</span>
                    <span className="muted">{formatTime(commit.timestamp)}</span>
                  </div>
              ))}
            </div>
          </div>
          <div
            className={`split-handle${resizing === "col" ? " is-active" : ""}`}
            onPointerDown={(event) => onWidthPointerDown(event, filesWidth, true, setFilesWidth, 180, 640)}
            onPointerMove={onWidthPointerMove}
            onPointerUp={onWidthPointerUp}
            onPointerCancel={onWidthPointerUp}
          />
          <div className="pane pane-files" style={{ width: filesWidth, flex: `0 0 ${filesWidth}px` }}>
            <div className="pane-title">
              <span>Changed Files</span>
              <span className="spacer" />
              <span data-menu-anchor="change-view">
                <IconButton title="Group By" onClick={openChangeViewMenu}>
                  <IconEye />
                </IconButton>
              </span>
            </div>
            <div className="scroll">{renderChangedFiles(state.selectedCommit?.files ?? [])}</div>
            {state.selectedCommit && (
              <div className="details" style={{ height: detailsHeight }}>
                <div
                  className="details-resize"
                  title={t("hint.dragDetails")}
                  onPointerDown={onDetailsPointerDown}
                  onPointerMove={onDetailsPointerMove}
                  onPointerUp={onDetailsPointerUp}
                  onPointerCancel={onDetailsPointerUp}
                />
                <div className="details-subject">{state.selectedCommit.subject}</div>
                {state.selectedCommit.body ? <div className="details-body">{state.selectedCommit.body}</div> : null}
                <div className="details-meta">
                  <span className="details-hash">{state.selectedCommit.hash.slice(0, 8)}</span>
                  {` ${state.selectedCommit.author} <${state.selectedCommit.email}> ${formatIdeaStamp(state.selectedCommit.timestamp)}`}
                </div>
                <RefChips refs={state.selectedCommit.refs ?? selected?.refs ?? []} className="details-refs" />
                {(state.selectedCommit.containedIn ?? []).length > 0 && (
                  <div className="details-contains">
                    In {state.selectedCommit.containedIn.length} branches: {state.selectedCommit.containedIn.join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(undefined)}
          onSelect={(id) => void onSelectMenu(id)}
        />
      )}
    </div>
  );
}

function preventTextSelect(event: MouseEvent) {
  if (event.detail > 1) {
    event.preventDefault();
  }
}

function RefChips({ refs, className = "refs" }: { refs: string[]; className?: string }) {
  if (!refs.length) {
    return null;
  }
  return (
    <span className={className}>
      {refs.map((ref) => {
        const label = ref.replace(/^tag: /, "");
        const kind = ref === "HEAD" || ref.startsWith("HEAD") ? "head" : ref.startsWith("tag:") ? "tag" : ref.includes("/") ? "remote" : "local";
        return (
          <span key={ref} className={`ref ${kind}`}>
            {label}
          </span>
        );
      })}
    </span>
  );
}

function BranchMark({ current }: { current: boolean }) {
  if (current) {
    return <span className="branch-star">★</span>;
  }
  return (
    <svg className="branch-mark" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5" cy="3.6" r="1.35" />
      <circle cx="5" cy="12.4" r="1.35" />
      <path d="M5 5v5.2" />
      <path d="M5 8.2h3.2a2.6 2.6 0 0 1 2.6 2.6v1.6" />
      <circle cx="11" cy="12.4" r="1.35" />
    </svg>
  );
}

function TreeFold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`tree-fold${open ? " open" : ""}`}>
      <div className="tree-fold-inner">{children}</div>
    </div>
  );
}

function TreeToggle({ open }: { open: boolean }) {
  return (
    <span className={`tree-toggle${open ? " open" : ""}`} aria-hidden="true">
      ▸
    </span>
  );
}

function FolderIcon() {
  return (
    <svg className="tree-folder" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.4 4.2h4l1.2 1.5h6v6.7H2.4z" />
    </svg>
  );
}

function isTrackedRemote(branch: GitBranch, current?: GitBranch): boolean {
  if (!current) {
    return false;
  }
  if (current.upstream) {
    return branch.fullName === current.upstream || branch.name === current.upstream;
  }
  const slash = branch.name.indexOf("/");
  const leaf = slash >= 0 ? branch.name.slice(slash + 1) : branch.name;
  return leaf === current.name;
}

function sortRemoteItems(
  items: Array<{ leaf: string; branch: GitBranch }>,
  current?: GitBranch,
): Array<{ leaf: string; branch: GitBranch }> {
  return [...items].sort((a, b) => {
    const aCur = isTrackedRemote(a.branch, current);
    const bCur = isTrackedRemote(b.branch, current);
    if (aCur !== bCur) {
      return aCur ? -1 : 1;
    }
    return a.leaf.localeCompare(b.leaf, undefined, { sensitivity: "base" });
  });
}

function groupRemotes(branches: GitBranch[]): Array<{ remote: string; branches: Array<{ leaf: string; branch: GitBranch }> }> {
  const map = new Map<string, Array<{ leaf: string; branch: GitBranch }>>();
  for (const branch of branches) {
    const parts = branch.name.split("/");
    const remote = parts.length > 1 ? (parts[0] ?? "origin") : "origin";
    const leaf = parts.length > 1 ? parts.slice(1).join("/") : branch.name;
    const list = map.get(remote) ?? [];
    list.push({ leaf, branch });
    map.set(remote, list);
  }
  return [...map.entries()].map(([remote, items]) => ({ remote, branches: items }));
}

function buildRemoteTree(
  remotes: GitRemote[],
  branches: GitBranch[],
): Array<{ name: string; remote?: GitRemote; branches: Array<{ leaf: string; branch: GitBranch }> }> {
  const grouped = groupRemotes(branches);
  const byName = new Map(grouped.map((group) => [group.remote, group.branches]));
  const names: string[] = [];
  for (const item of remotes) {
    names.push(item.name);
  }
  for (const group of grouped) {
    if (!names.includes(group.remote)) {
      names.push(group.remote);
    }
  }
  return names.map((name) => ({
    name,
    remote: remotes.find((item) => item.name === name),
    branches: byName.get(name) ?? [],
  }));
}

const SHARED_COLOR = "#c9a227";
const LANE_WIDTH = 16;
const ROW_HEIGHT = 28;
const GRAPH_PAD = 10;
const GRAPH_COLORS = ["#3794ff", "#e2c08d", "#c586c0", "#13c2c2", "#f14c4c", "#73c991", "#b180d7", "#cca700"];

function GraphSvg({ commit, lanes }: { commit: GitCommitNode; lanes: number }) {
  const height = ROW_HEIGHT;
  const width = GRAPH_PAD * 2 + Math.max(lanes || 0, commit.laneCount || 0, 1) * LANE_WIDTH;
  const midY = height / 2;
  const x = (lane: number) => GRAPH_PAD + lane * LANE_WIDTH;
  const color = (lane: number) => GRAPH_COLORS[lane % GRAPH_COLORS.length];
  const ring = commit.isMerge || commit.isHead;
  const shared = Boolean(commit.sharedWithCurrent);
  const laneColor = color(commit.lane);
  const dotColor = shared ? SHARED_COLOR : laneColor;

  return (
    <svg className="graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {commit.incoming && (
        <line
          x1={x(commit.lane)}
          y1={0}
          x2={x(commit.lane)}
          y2={midY}
          stroke={laneColor}
          strokeWidth={2}
        />
      )}
      {commit.lines.map((line, index) => {
        const x1 = x(line.from);
        const x2 = x(line.to);
        const stroke = color(line.color);
        let d: string;
        if (line.span === "full") {
          d =
            x1 === x2
              ? `M ${x1} 0 L ${x1} ${height}`
              : `M ${x1} 0 C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${height}`;
        } else if (line.span === "in") {
          d =
            x1 === x2
              ? `M ${x1} 0 L ${x1} ${midY}`
              : `M ${x1} 0 C ${x1} ${midY - 2}, ${x2} ${midY - 10}, ${x2} ${midY}`;
        } else if (x1 === x2) {
          d = `M ${x1} ${midY} L ${x1} ${height}`;
        } else {
          d = `M ${x1} ${midY} C ${x1} ${midY + 12}, ${x2} ${midY + 2}, ${x2} ${height}`;
        }
        return <path key={`${line.span}-${line.from}-${line.to}-${index}`} d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />;
      })}
      {ring && <circle cx={x(commit.lane)} cy={midY} r={6.5} fill="none" stroke={dotColor} strokeWidth={2} />}
      <circle cx={x(commit.lane)} cy={midY} r={ring ? 3 : 4} fill={dotColor} />
    </svg>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<GitLogApp />);
}
