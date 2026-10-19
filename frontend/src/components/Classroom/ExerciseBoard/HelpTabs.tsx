"use client";

import { useId, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/Button/Button";
import type { ScreenElement } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import type { ChatTarget, LiveChatMessage } from "@/services/classroomService";
import { TeacherChat } from "../TeacherChat/TeacherChat";
import { TerminalMirror } from "../TerminalMirror/TerminalMirror";
import styles from "./ExerciseBoard.module.scss";

const m = messages.classroom.exerciseBoard;

/** The most tabs of help at once (SPEC-071 RN-12). */
export const MAX_TABS = 4;

/** The keys that alone type nothing, which the takeover does not send. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph", "OS"]);

export interface HelpTab {
  studentId: string;
  name: string;
  /** The student finished: there is nothing to take over. */
  done: boolean;
  /** His hand is up, or he wrote and the teacher did not read it. */
  attention: boolean;
  /** The commands he ran in the round, as they came, oldest first. */
  history: string[];
}

export interface HelpTabsProps {
  tabs: HelpTab[];
  /** The student whose tab is open: the one the panel watches. */
  active: string | null;
  watchedScreen: { studentId: string; screen: ScreenElement } | null;
  /** The student whose terminal the panel took over. */
  takeover: string | null;
  canControl: boolean;
  /** The round is paused: nobody is taken over. */
  paused: boolean;
  chat: LiveChatMessage[];
  connected: boolean;
  onSelect(studentId: string): void;
  onCloseTab(studentId: string): void;
  onTakeover(studentId: string, on: boolean): void;
  onKey(studentId: string, key: { key: string; ctrl: boolean; alt: boolean; shift: boolean }): void;
  onPaste(studentId: string, text: string): void;
  onSendChat(text: string, to: ChatTarget): boolean;
}

/**
 * The tabs of help of the panel (SPEC-071 RN-12): one for each student the teacher is helping, up to 4, without leaving the section. The open tab is the
 * student the panel watches: his terminal live, the commands he ran and the private conversation, and the takeover of his terminal, where the keys of the
 * teacher go to the student (Ctrl+Shift+D gives the control back and does not go). Opening, switching and closing tabs is only of this screen.
 */
export function HelpTabs({ tabs, active, watchedScreen, takeover, canControl, paused, chat, connected, onSelect, onCloseTab, onTakeover, onKey, onPaste, onSendChat }: HelpTabsProps) {
  const base = useId();
  const open = tabs.find((tab) => tab.studentId === active) ?? null;
  const controlling = open !== null && takeover === open.studentId;

  const onTerminalKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || !controlling) return;
    if (MODIFIERS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
      onTakeover(open.studentId, false);
      return;
    }
    onKey(open.studentId, { key: event.key, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
  };
  const onTerminalPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!open || !controlling) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text");
    if (text) onPaste(open.studentId, text);
  };

  return (
    <section className={styles.helpTabs} aria-label={m.tabsLabel}>
      <div role="tablist" aria-label={m.tabsLabel} className={styles.tabList}>
        {tabs.map((tab) => {
          const selected = tab.studentId === active;
          return (
            <span key={tab.studentId} className={styles.tabItem} data-selected={selected ? "true" : undefined}>
              <button
                type="button"
                role="tab"
                id={`${base}-${tab.studentId}`}
                aria-selected={selected}
                aria-controls={selected ? `${base}-panel` : undefined}
                className={styles.tab}
                data-attention={!selected && tab.attention ? "true" : undefined}
                onClick={() => onSelect(tab.studentId)}
              >
                {tab.name}
              </button>
              <button type="button" className={styles.tabClose} aria-label={m.closeTab(tab.name)} title={m.closeTab(tab.name)} onClick={() => onCloseTab(tab.studentId)}>
                ×
              </button>
            </span>
          );
        })}
      </div>
      {open && (
        <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${open.studentId}`} className={styles.tabPanel}>
          <div className={styles.terminalHead}>
            <h4 className={styles.subtitle}>{m.terminalOf(open.name)}</h4>
            {!open.done &&
              (controlling ? (
                <Button variant="danger" size="sm" disabled={!canControl} onClick={() => onTakeover(open.studentId, false)}>
                  {m.giveBack}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled={!canControl || paused} onClick={() => onTakeover(open.studentId, true)}>
                  {m.takeOver}
                </Button>
              ))}
          </div>
          {controlling && (
            <p className={styles.controlling} role="status">
              <strong>{m.controlling(open.name)}</strong> <span>{m.takeoverHint}</span>
            </p>
          )}
          <div
            role="application"
            aria-label={m.terminalOf(open.name)}
            tabIndex={0}
            className={styles.terminalBody}
            data-controlling={controlling ? "true" : undefined}
            onKeyDown={onTerminalKey}
            onPaste={onTerminalPaste}
          >
            <TerminalMirror screen={watchedScreen?.studentId === open.studentId ? watchedScreen.screen : null} />
          </div>
          <div className={styles.tabColumns}>
            <section aria-label={m.historyTitle}>
              <h5 className={styles.subtitle}>{m.historyTitle}</h5>
              {open.history.length === 0 ? (
                <p className={styles.muted}>{m.noHistory}</p>
              ) : (
                <ol className={styles.history} aria-label={m.historyOf(open.name)}>
                  {open.history.map((command, index) => (
                    <li key={index}>
                      <code>{command}</code>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section aria-label={m.conversation}>
              <TeacherChat target={{ studentId: open.studentId }} studentName={open.name} chat={chat} connected={connected} onSend={onSendChat} />
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

/** The commands of each student as the progress tells them, one after the other: a new last command goes at the end; up to 200 kept for each (SPEC-071). */
export function useCommandHistory(lasts: Record<string, string | undefined>, runId: string): Record<string, string[]> {
  const [history, setHistory] = useState<{ runId: string; key: string; byStudent: Record<string, string[]> }>({ runId: "", key: "", byStudent: {} });
  const key = JSON.stringify(lasts);
  if (history.runId !== runId || history.key !== key) {
    const byStudent = history.runId === runId ? { ...history.byStudent } : {};
    for (const [studentId, last] of Object.entries(lasts)) {
      if (!last) continue;
      const list = byStudent[studentId] ?? [];
      if (list.at(-1) !== last) byStudent[studentId] = [...list, last].slice(-200);
    }
    setHistory({ runId, key, byStudent });
    return byStudent;
  }
  return history.byStudent;
}
