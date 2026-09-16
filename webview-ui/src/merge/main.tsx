import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HostToWebview, MergeBlock, MergeViewState } from "@ipc";
import { t } from "@i18n";
import { diffLines, type DiffLine } from "./diff";
import "../shared/styles.css";
import "./merge.css";
import { ProgressBreath, ToastStack } from "../shared/ActionChrome";
import { useBusy } from "../shared/useBusy";
import { consumeResult, ready, request } from "../shared/vscodeApi";

const emptyState: MergeViewState = {
  path: "",
  oursLabel: "Yours",
  theirsLabel: "Theirs",
  blocks: [],
};

type SideMark = "pending" | "accepted" | "ignored";

interface HunkMark {
  ours: SideMark;
  theirs: SideMark;
  dirty: boolean;
}

function initialResult(block: MergeBlock): string {
  if (block.kind === "text" || block.kind === "ours" || block.kind === "theirs") {
    return block.text;
  }
  return "";
}

function initialMark(block: MergeBlock): HunkMark {
  if (block.kind === "ours") {
    return { ours: "accepted", theirs: "ignored", dirty: false };
  }
  if (block.kind === "theirs") {
    return { ours: "ignored", theirs: "accepted", dirty: false };
  }
  if (block.kind === "conflict") {
    return { ours: "pending", theirs: "pending", dirty: false };
  }
  return { ours: "accepted", theirs: "accepted", dirty: false };
}

function autoResult(block: MergeBlock, mark: HunkMark): string {
  if (mark.dirty) {
    return "";
  }
  if (block.kind === "text") {
    return block.text;
  }
  if (block.kind === "ours") {
    return mark.ours === "accepted" ? block.text : block.base;
  }
  if (block.kind === "theirs") {
    return mark.theirs === "accepted" ? block.text : block.base;
  }
  const parts: string[] = [];
  if (mark.ours === "accepted") {
    parts.push(block.ours);
  }
  if (mark.theirs === "accepted") {
    parts.push(block.theirs);
  }
  return parts.filter((part) => part.length > 0).join("\n");
}

function isConflict(block: MergeBlock): block is Extract<MergeBlock, { kind: "conflict" }> {
  return block.kind === "conflict";
}

function MergeApp() {
  const [state, setState] = useState<MergeViewState>(emptyState);
  const [results, setResults] = useState<Record<string, string>>({});
  const [marks, setMarks] = useState<Record<string, HunkMark>>({});
  const [currentId, setCurrentId] = useState<string>();
  const { busy, run, toasts, dismiss, notify } = useBusy();
  const currentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      if (consumeResult(message)) {
        return;
      }
      if (message.type === "mergeState") {
        const nextResults: Record<string, string> = {};
        const nextMarks: Record<string, HunkMark> = {};
        for (const block of message.payload.blocks) {
          nextResults[block.id] = initialResult(block);
          nextMarks[block.id] = initialMark(block);
        }
        setState(message.payload);
        setResults(nextResults);
        setMarks(nextMarks);
        setCurrentId(message.payload.blocks.find(isConflict)?.id);
      }
    };
    window.addEventListener("message", onMessage);
    ready("merge");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const conflicts = useMemo(() => state.blocks.filter(isConflict), [state.blocks]);
  const remaining = conflicts.filter((block) => {
    const mark = marks[block.id];
    if (!mark) {
      return true;
    }
    if (mark.dirty) {
      return false;
    }
    return mark.ours === "pending" || mark.theirs === "pending";
  }).length;
  const canApply = remaining === 0 && Boolean(state.path) && !busy;

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentId]);

  const patchHunk = (id: string, patch: (mark: HunkMark, block: MergeBlock) => HunkMark) => {
    const block = state.blocks.find((item) => item.id === id);
    if (!block) {
      return;
    }
    const prev = marks[id] ?? initialMark(block);
    const next = patch(prev, block);
    setCurrentId(id);
    setMarks((current) => ({ ...current, [id]: next }));
    if (!next.dirty) {
      setResults((texts) => ({ ...texts, [id]: autoResult(block, next) }));
    }
  };

  const acceptSide = (id: string, side: "ours" | "theirs") => {
    patchHunk(id, (mark) => ({ ...mark, [side]: "accepted" }));
  };

  const ignoreSide = (id: string, side: "ours" | "theirs") => {
    patchHunk(id, (mark) => ({ ...mark, [side]: "ignored" }));
  };

  const editResult = (id: string, value: string) => {
    const block = state.blocks.find((item) => item.id === id);
    setResults((current) => ({ ...current, [id]: value }));
    if (block && isConflict(block)) {
      setMarks((current) => ({
        ...current,
        [id]: { ...(current[id] ?? initialMark(block)), dirty: true },
      }));
    }
  };

  const acceptAll = (side: "ours" | "theirs") => {
    const nextMarks = { ...marks };
    const nextResults = { ...results };
    for (const block of conflicts) {
      const mark: HunkMark = {
        ours: side === "ours" ? "accepted" : "ignored",
        theirs: side === "theirs" ? "accepted" : "ignored",
        dirty: false,
      };
      nextMarks[block.id] = mark;
      nextResults[block.id] = autoResult(block, mark);
    }
    setMarks(nextMarks);
    setResults(nextResults);
  };

  const jump = (delta: number) => {
    if (!conflicts.length) {
      return;
    }
    const index = conflicts.findIndex((block) => block.id === currentId);
    const next = conflicts[(index + delta + conflicts.length) % conflicts.length];
    if (next) {
      setCurrentId(next.id);
    }
  };

  const apply = () => {
    if (remaining > 0) {
      notify(t("merge.remainingCount", { count: remaining }), "warning");
      const first = conflicts.find((block) => {
        const mark = marks[block.id];
        return !mark || (!mark.dirty && (mark.ours === "pending" || mark.theirs === "pending"));
      });
      if (first) {
        setCurrentId(first.id);
      }
      return;
    }
    const content = state.blocks
      .map((block) => results[block.id] ?? initialResult(block))
      .filter((part) => part.length > 0)
      .join("\n");
    void run("apply", "Apply", () => request("applyMerge", { path: state.path, content }));
  };

  return (
    <div className="app merge-app">
      <ProgressBreath active={Boolean(busy)} />
      <header className="toolbar merge-toolbar">
        <span className="merge-path" title={state.path}>
          {state.path || "Merge"}
        </span>
        <span className="merge-count">
          {conflicts.length === 0 ? t("merge.noConflict") : t("merge.unresolved", { remaining, total: conflicts.length })}
        </span>
        <span className="spacer" />
        <button type="button" disabled={!conflicts.length} onClick={() => jump(-1)}>
          Previous
        </button>
        <button type="button" disabled={!conflicts.length} onClick={() => jump(1)}>
          Next
        </button>
        <button type="button" disabled={!conflicts.length} onClick={() => acceptAll("ours")}>
          Accept All Yours
        </button>
        <button type="button" disabled={!conflicts.length} onClick={() => acceptAll("theirs")}>
          Accept All Theirs
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canApply}
          title={remaining > 0 ? t("hint.mergeApplyDisabled") : t("hint.mergeApplyEnabled")}
          onClick={apply}
        >
          Apply
        </button>
      </header>
      <div className="merge-head">
        <div className="merge-col-title ours">Yours · {state.oursLabel}</div>
        <div className="merge-gutter-head" />
        <div className="merge-col-title result">Result</div>
        <div className="merge-gutter-head" />
        <div className="merge-col-title theirs">Theirs · {state.theirsLabel}</div>
      </div>
      <div className="merge-scroll">
        <div className="merge-grid">
          {state.blocks.map((block) => {
            const mark = marks[block.id] ?? initialMark(block);
            const active = currentId === block.id;
            const unresolved =
              block.kind === "conflict" && !mark.dirty && (mark.ours === "pending" || mark.theirs === "pending");
            return (
              <div
                key={block.id}
                className={`merge-row ${block.kind} ${active ? "current" : ""} ${unresolved ? "unresolved" : "resolved"}`}
                ref={active ? currentRef : undefined}
                onClick={() => block.kind !== "text" && setCurrentId(block.id)}
              >
                <div className="merge-cell side">
                  <SideCode block={block} side="ours" />
                </div>
                <div className="merge-gutter">
                  {block.kind !== "text" && block.kind !== "theirs" ? (
                    <>
                      <button
                        type="button"
                        className={mark.ours === "ignored" ? "ignored" : ""}
                        title={t("hint.ignoreYours")}
                        onClick={(event) => {
                          event.stopPropagation();
                          ignoreSide(block.id, "ours");
                        }}
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        className={mark.ours === "accepted" ? "accepted" : ""}
                        title={t("hint.acceptYours")}
                        onClick={(event) => {
                          event.stopPropagation();
                          acceptSide(block.id, "ours");
                        }}
                      >
                        »
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="merge-cell result">
                  <textarea
                    value={results[block.id] ?? ""}
                    rows={Math.max(1, (results[block.id] ?? "").split("\n").length)}
                    spellCheck={false}
                    onChange={(event) => editResult(block.id, event.target.value)}
                    onFocus={() => block.kind !== "text" && setCurrentId(block.id)}
                  />
                </div>
                <div className="merge-gutter">
                  {block.kind !== "text" && block.kind !== "ours" ? (
                    <>
                      <button
                        type="button"
                        className={mark.theirs === "accepted" ? "accepted" : ""}
                        title={t("hint.acceptTheirs")}
                        onClick={(event) => {
                          event.stopPropagation();
                          acceptSide(block.id, "theirs");
                        }}
                      >
                        «
                      </button>
                      <button
                        type="button"
                        className={mark.theirs === "ignored" ? "ignored" : ""}
                        title={t("hint.ignoreTheirs")}
                        onClick={(event) => {
                          event.stopPropagation();
                          ignoreSide(block.id, "theirs");
                        }}
                      >
                        ×
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="merge-cell side">
                  <SideCode block={block} side="theirs" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function SideCode({ block, side }: { block: MergeBlock; side: "ours" | "theirs" }) {
  return <pre className="merge-code">{renderSideLines(block, side).map(renderLine)}</pre>;
}

function renderLine(line: DiffLine & { tone?: "conflict" }, index: number) {
  const tone = line.tone ?? line.type;
  return (
    <span key={`${tone}-${index}-${line.text}`} className={`merge-line merge-line-${tone}`}>
      {line.text || " "}
    </span>
  );
}

function renderSideLines(block: MergeBlock, side: "ours" | "theirs"): Array<DiffLine & { tone?: "conflict" }> {
  if (block.kind === "text") {
    return splitDisplay(block.text).map((text) => ({ type: "equal", text }));
  }
  if (block.kind === "ours") {
    if (side === "ours") {
      return diffLines(block.base, block.text);
    }
    return splitDisplay(block.base).map((text) => ({ type: "del", text }));
  }
  if (block.kind === "theirs") {
    if (side === "theirs") {
      return diffLines(block.base, block.text);
    }
    return splitDisplay(block.base).map((text) => ({ type: "del", text }));
  }
  const value = side === "ours" ? block.ours : block.theirs;
  const other = side === "ours" ? block.theirs : block.ours;
  if (!value && other) {
    return splitDisplay(other).map((text) => ({ type: "del", text }));
  }
  if (value && !other) {
    return splitDisplay(value).map((text) => ({ type: "add", text }));
  }
  return splitDisplay(value).map((text) => ({ type: "equal", text, tone: "conflict" }));
}

function splitDisplay(value: string): string[] {
  return value.length ? value.split("\n") : [" "];
}

createRoot(document.getElementById("root")!).render(<MergeApp />);
