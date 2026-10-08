"use client";

import { useState } from "react";
import { ptBR } from "@/messages/pt-BR";
import type { ExerciseItem } from "@/services/moduleService";
import styles from "./ExerciseOrderList.module.scss";

interface ExerciseOrderListProps {
  exercises: ExerciseItem[];
  onSaveOrder: (orderedExerciseIds: string[]) => Promise<void>;
}

export function ExerciseOrderList({ exercises: initialExercises, onSaveOrder }: ExerciseOrderListProps) {
  const m = ptBR.modules.exercises;
  const [items, setItems] = useState<ExerciseItem[]>(initialExercises);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newItems = [...items];
    const prevItem = newItems[index - 1];
    const currentItem = newItems[index];
    if (prevItem && currentItem) {
      newItems[index - 1] = currentItem;
      newItems[index] = prevItem;
      setItems(newItems);
      setSuccess(null);
    }
  };

  const moveDown = (index: number) => {
    if (index >= items.length - 1) return;
    const newItems = [...items];
    const nextItem = newItems[index + 1];
    const currentItem = newItems[index];
    if (nextItem && currentItem) {
      newItems[index + 1] = currentItem;
      newItems[index] = nextItem;
      setItems(newItems);
      setSuccess(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const ids = items.map((it) => it.exerciseId);
      await onSaveOrder(ids);
      setSuccess(m.saveSuccess);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao salvar ordenação.");
    } finally {
      setSaving(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className={styles.container}>
        <h3 className={styles.title}>{m.title}</h3>
        <p className={styles.emptyNotice}>{m.empty}</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="exercise-order-list">
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>{m.title}</h3>
          <p className={styles.subtitle}>{m.subtitle}</p>
        </div>
        <button
          type="button"
          className={styles.saveButton}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Salvando…" : m.saveOrder}
        </button>
      </header>

      {success && <div className={styles.successMessage} role="status">{success}</div>}
      {error && <div className={styles.errorMessage} role="alert">{error}</div>}

      <ul className={styles.list}>
        {items.map((item, index) => (
          <li key={item.id} className={styles.item}>
            <div className={styles.positionBadge}>{index + 1}º</div>
            <div className={styles.itemInfo}>
              <span className={styles.exerciseName}>Exercício #{item.exerciseId.slice(0, 8)}</span>
              {item.isMandatory && (
                <span className={styles.mandatoryBadge}>{m.mandatoryBadge}</span>
              )}
            </div>
            <div className={styles.orderActions}>
              <button
                type="button"
                className={styles.moveButton}
                onClick={() => moveUp(index)}
                disabled={index === 0}
                aria-label={`Subir exercício ${index + 1}`}
              >
                ↑ {m.moveUp}
              </button>
              <button
                type="button"
                className={styles.moveButton}
                onClick={() => moveDown(index)}
                disabled={index === items.length - 1}
                aria-label={`Descer exercício ${index + 1}`}
              >
                ↓ {m.moveDown}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
