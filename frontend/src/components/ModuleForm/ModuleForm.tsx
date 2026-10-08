"use client";

import { useState, useId } from "react";
import Link from "next/link";
import { ptBR } from "@/messages/pt-BR";
import type {
  Visibility,
  ModuleStatus,
  CourseModuleDetails,
  CreateModulePayload,
  UpdateModulePayload,
} from "@/services/moduleService";
import styles from "./ModuleForm.module.scss";

interface AvailableClass {
  id: string;
  name: string;
}

interface ModuleFormProps {
  initialData?: Partial<CourseModuleDetails>;
  availableClasses?: AvailableClass[];
  onSubmit: (data: CreateModulePayload | UpdateModulePayload) => Promise<void>;
  isEditing?: boolean;
}

export function ModuleForm({
  initialData,
  availableClasses = [],
  onSubmit,
  isEditing = false,
}: ModuleFormProps) {
  const m = ptBR.modules.form;

  const titleId = useId();
  const descId = useId();
  const visId = useId();
  const statusId = useId();
  const startId = useId();
  const endId = useId();

  const [title, setTitle] = useState(initialData?.title || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [visibility, setVisibility] = useState<Visibility>(initialData?.visibility || "PUBLIC");
  const [status, setStatus] = useState<ModuleStatus>(initialData?.status || "ACTIVE");
  const [activationStart, setActivationStart] = useState(
    initialData?.activationStart ? initialData.activationStart.slice(0, 16) : ""
  );
  const [activationEnd, setActivationEnd] = useState(
    initialData?.activationEnd ? initialData.activationEnd.slice(0, 16) : ""
  );
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>(
    initialData?.assignedClassIds || []
  );

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleClassToggle = (classId: string) => {
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("O título do módulo é obrigatório.");
      return;
    }

    if (!description.trim()) {
      setError("A descrição do módulo é obrigatória.");
      return;
    }

    if (visibility === "PRIVATE" && selectedClassIds.length === 0) {
      setError("Selecione ao menos uma turma para um módulo privado.");
      return;
    }

    if (activationStart && activationEnd && new Date(activationStart) > new Date(activationEnd)) {
      setError("A data de início da vigência não pode ser posterior ao término.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateModulePayload | UpdateModulePayload = {
        title: title.trim(),
        description: description.trim(),
        visibility,
        activationStart: activationStart ? new Date(activationStart).toISOString() : undefined,
        activationEnd: activationEnd ? new Date(activationEnd).toISOString() : undefined,
        classIds: visibility === "PRIVATE" ? selectedClassIds : [],
        ...(isEditing ? { status } : {}),
      };

      await onSubmit(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao salvar módulo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} data-testid="module-form">
      {error && (
        <div className={styles.errorMessage} role="alert">
          {error}
        </div>
      )}

      <div className={styles.fieldGroup}>
        <label htmlFor={titleId} className={styles.label}>
          {m.titleLabel} *
        </label>
        <input
          id={titleId}
          type="text"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={m.titlePlaceholder}
          required
        />
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor={descId} className={styles.label}>
          {m.descriptionLabel} *
        </label>
        <textarea
          id={descId}
          className={styles.textarea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={m.descriptionPlaceholder}
          rows={4}
          required
        />
      </div>

      <div className={styles.row}>
        <div className={styles.fieldGroup}>
          <label htmlFor={visId} className={styles.label}>
            {m.visibilityLabel} *
          </label>
          <select
            id={visId}
            className={styles.select}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
          >
            <option value="PUBLIC">Público</option>
            <option value="AUTHENTICATED">Autenticado</option>
            <option value="PRIVATE">Privado (Turmas)</option>
          </select>
          <span className={styles.helperText}>{m.visibilityHelp[visibility]}</span>
        </div>

        {isEditing && (
          <div className={styles.fieldGroup}>
            <label htmlFor={statusId} className={styles.label}>
              Status
            </label>
            <select
              id={statusId}
              className={styles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value as ModuleStatus)}
            >
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
              <option value="ARCHIVED">Arquivado</option>
            </select>
          </div>
        )}
      </div>

      {visibility === "PRIVATE" && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{m.classesLabel} *</legend>
          <span className={styles.helperText}>{m.classesHelp}</span>
          {availableClasses.length === 0 ? (
            <p className={styles.emptyNotice}>Nenhuma turma disponível cadastrada.</p>
          ) : (
            <div className={styles.checkboxList}>
              {availableClasses.map((c) => (
                <label key={c.id} className={styles.checkboxItem}>
                  <input
                    type="checkbox"
                    checked={selectedClassIds.includes(c.id)}
                    onChange={() => handleClassToggle(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Vigência Temporal</legend>
        <span className={styles.helperText}>{m.datesHelp}</span>
        <div className={styles.row}>
          <div className={styles.fieldGroup}>
            <label htmlFor={startId} className={styles.label}>
              {m.activationStartLabel}
            </label>
            <input
              id={startId}
              type="datetime-local"
              className={styles.input}
              value={activationStart}
              onChange={(e) => setActivationStart(e.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor={endId} className={styles.label}>
              {m.activationEndLabel}
            </label>
            <input
              id={endId}
              type="datetime-local"
              className={styles.input}
              value={activationEnd}
              onChange={(e) => setActivationEnd(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <div className={styles.actions}>
        <Link href="/app/modules" className={styles.cancelLink}>
          {m.cancel}
        </Link>
        <button type="submit" className={styles.submitButton} disabled={submitting}>
          {submitting ? "Salvando…" : isEditing ? m.submitSave : m.submitCreate}
        </button>
      </div>
    </form>
  );
}
