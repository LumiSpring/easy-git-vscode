import { useEffect, useRef, useState } from "react";
import { MenuIcon } from "./icons";
import { MENU_HINTS } from "./menuHints";

export interface MenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  keepOpen?: boolean;
  header?: boolean;
  separator?: boolean;
  children?: MenuItem[];
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

interface HintState {
  text: string;
  left: number;
  top: number;
}

interface ListProps {
  items: MenuItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onHint: (hint?: HintState) => void;
  className?: string;
  style?: { left: number; top: number };
}

function MenuList({ items, onClose, onSelect, onHint, className = "ctx-menu", style }: ListProps) {
  const timer = useRef(0);

  const showHint = (id: string, target: HTMLElement) => {
    window.clearTimeout(timer.current);
    const text = MENU_HINTS[id];
    if (!text) {
      onHint(undefined);
      return;
    }
    timer.current = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const left = Math.min(rect.right + 8, window.innerWidth - 280);
      const top = Math.min(rect.top, window.innerHeight - 64);
      onHint({ text, left: Math.max(8, left), top: Math.max(8, top) });
    }, 480);
  };

  const hideHint = () => {
    window.clearTimeout(timer.current);
    onHint(undefined);
  };

  return (
    <ul className={className} style={style}>
      {items.map((item) => {
        if (item.separator) {
          return <li key={item.id} className="ctx-sep" />;
        }
        const nested = item.children?.length ? item.children : undefined;
        return (
          <li key={item.id} className={nested ? "has-sub" : undefined}>
            <button
              type="button"
              className={[item.danger && "danger", item.header && "header", item.checked && "checked"].filter(Boolean).join(" ") || undefined}
              disabled={item.disabled}
              onMouseEnter={(event) => showHint(item.id, event.currentTarget)}
              onMouseLeave={hideHint}
              onClick={() => {
                if (nested || item.disabled || item.header) {
                  return;
                }
                hideHint();
                onSelect(item.id);
                if (!item.keepOpen) {
                  onClose();
                }
              }}
            >
              {item.header ? null : item.checked !== undefined ? (
                <span className={`ctx-check${item.checked ? " on" : ""}`} aria-hidden="true">
                  {item.checked ? "✓" : ""}
                </span>
              ) : (
                <MenuIcon name={item.id} />
              )}
              <span>{item.label}</span>
              {nested && (
                <span className="ctx-caret" aria-hidden="true">
                  ▸
                </span>
              )}
            </button>
            {nested && (
              <MenuList items={nested} onClose={onClose} onSelect={onSelect} onHint={onHint} className="ctx-menu ctx-submenu" />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ContextMenu({ x, y, items, onClose, onSelect }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, openLeft: false });
  const [hint, setHint] = useState<HintState | undefined>();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (rootRef.current?.contains(target) || target.closest("[data-menu-anchor]"))) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    const width = 228;
    const height = items.length * 28 + 8;
    const left = Math.min(x, window.innerWidth - width);
    const top = Math.min(y, window.innerHeight - height);
    setPos({
      x: Math.max(4, left),
      y: Math.max(4, top),
      openLeft: x > window.innerWidth - width - 180,
    });
  }, [x, y, items.length]);

  return (
    <div ref={rootRef} className="ctx-root">
      <MenuList
        items={items}
        onClose={onClose}
        onSelect={onSelect}
        onHint={setHint}
        className={`ctx-menu${pos.openLeft ? " open-left" : ""}`}
        style={{ left: pos.x, top: pos.y }}
      />
      {hint && (
        <div className="ctx-hint" style={{ left: hint.left, top: hint.top }}>
          {hint.text}
        </div>
      )}
    </div>
  );
}
