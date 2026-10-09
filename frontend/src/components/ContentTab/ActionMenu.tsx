"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./ContentTab.module.scss";

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface ActionMenuProps {
  /** Accessible name of the button that opens the menu. */
  label: string;
  /** Text shown on the button. */
  text: string;
  actions: MenuAction[];
}

/**
 * A menu of actions on one row. Opens with Enter, Space or the down arrow, moves with the
 * arrows, and closes with Escape, a click outside or a choice.
 */
export function ActionMenu({ label, text, actions }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onMenuKey = (event: React.KeyboardEvent) => {
    const at = items.current.findIndex((el) => el === document.activeElement);
    const go = (to: number) => {
      event.preventDefault();
      items.current[(to + actions.length) % actions.length]?.focus();
    };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(actions.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") close(false);
  };

  return (
    <div className={styles.menu} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.smallButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {text} ▾
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={styles.menuList} onKeyDown={onMenuKey}>
          {actions.map((action, index) => (
            <button
              key={action.key}
              ref={(el) => {
                items.current[index] = el;
              }}
              type="button"
              role="menuitem"
              className={`${styles.menuItem} ${action.danger ? styles.menuDanger : ""}`}
              onClick={() => {
                close(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
