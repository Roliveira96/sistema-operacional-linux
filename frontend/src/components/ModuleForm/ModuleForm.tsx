"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { descriptionHtml, descriptionText } from "@/lib/description";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { endsBeforeStart, isoToLocalInput, localInputToIso } from "@/lib/localDateTime";
import { normalizeSlug, slugProblem, slugify } from "@/lib/slug";
import { ptBR } from "@/messages/pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import type {
  CourseModuleDetails,
  CreateModulePayload,
  ModuleStatus,
  UpdateModulePayload,
  Visibility,
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
  /** Where "Cancelar" goes. */
  cancelHref?: string;
}

type FieldName = "title" | "slug" | "description" | "activationStart" | "activationEnd";
type FieldErrors = Partial<Record<FieldName, string>>;

const VISIBILITIES: Visibility[] = ["PUBLIC", "AUTHENTICATED", "PRIVATE"];
const STATUSES: ModuleStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];

const formatMoment = (local: string) =>
  new Date(local).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** The server names the field that failed; the form shows the message under that field. */
function fromServer(error: unknown): { fields: FieldErrors; general: string | null } {
  const m = ptBR.modules.form;
  if (!(error instanceof ApiProblemError)) {
    return { fields: {}, general: error instanceof Error ? error.message : m.errors.generic };
  }
  switch (error.type) {
    case "slug-taken":
      return { fields: { slug: m.slugErrors.taken }, general: null };
    case "invalid-slug":
      return { fields: { slug: m.slugErrors.format }, general: null };
    case "invalid-date-range":
      return { fields: { activationEnd: m.dateRangeError }, general: null };
    case "invalid-date-format": {
      const field = error.invalidParams[0]?.name === "activationStart" ? "activationStart" : "activationEnd";
      return { fields: { [field]: error.message }, general: null };
    }
    case "title-required":
      return { fields: { title: m.errors.title }, general: null };
    case "description-required":
      return { fields: { description: m.errors.description }, general: null };
    case "description-too-long":
      return { fields: { description: m.errors.descriptionTooLong }, general: null };
    default:
      return { fields: {}, general: error.message || m.errors.generic };
  }
}

export function ModuleForm({ initialData, availableClasses = [], onSubmit, isEditing = false, cancelHref = "/app/modules" }: ModuleFormProps) {
  const m = ptBR.modules.form;

  const titleId = useId();
  const slugId = useId();
  const descId = useId();
  const startId = useId();
  const endId = useId();
  const visName = useId();
  const statusName = useId();

  const initial = useMemo(
    () => ({
      title: initialData?.title ?? "",
      slug: initialData?.slug ?? "",
      // A description stored as plain text opens as paragraphs in the visual editor (SPEC-010 RN-12).
      description: descriptionHtml(initialData?.description ?? ""),
      visibility: (initialData?.visibility ?? "PUBLIC") as Visibility,
      status: (initialData?.status ?? "ACTIVE") as ModuleStatus,
      start: isoToLocalInput(initialData?.activationStart),
      end: isoToLocalInput(initialData?.activationEnd),
      classIds: initialData?.assignedClassIds ?? [],
    }),
    [initialData],
  );

  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [description, setDescription] = useState(initial.description);
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility);
  const [status, setStatus] = useState<ModuleStatus>(initial.status);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [classIds, setClassIds] = useState<string[]>(initial.classIds);

  const [serverFields, setServerFields] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Read once on mount: the badge only needs to be right for the moment the form was opened.
  const [now] = useState(() => Date.now());

  const dirty =
    title !== initial.title ||
    slug !== initial.slug ||
    description !== initial.description ||
    visibility !== initial.visibility ||
    status !== initial.status ||
    start !== initial.start ||
    end !== initial.end ||
    [...classIds].sort().join() !== [...initial.classIds].sort().join();

  // Problems found while the person types, before anything is sent.
  const slugIssue = slugProblem(slug);
  const rangeIssue = endsBeforeStart(start, end);
  const errors: FieldErrors = {
    ...serverFields,
    ...(slugIssue ? { slug: m.slugErrors[slugIssue] } : {}),
    ...(rangeIssue ? { activationEnd: m.dateRangeError } : {}),
  };

  const clearServerField = (field: FieldName) => setServerFields((prev) => ({ ...prev, [field]: undefined }));

  const validitySummary = (() => {
    if (start && end) return m.validitySummary.between(formatMoment(start), formatMoment(end));
    if (start) return m.validitySummary.from(formatMoment(start));
    if (end) return m.validitySummary.until(formatMoment(end));
    return m.validitySummary.none;
  })();
  const validityState =
    start && new Date(start).getTime() > now ? "future" : end && new Date(end).getTime() < now ? "expired" : "ongoing";

  const toggleClass = (id: string) => setClassIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setGeneral(null);
    setServerFields({});

    const local: FieldErrors = {};
    if (!title.trim()) local.title = m.errors.title;
    if (descriptionText(description) === "") local.description = m.errors.description;
    if (Object.keys(local).length > 0) {
      setServerFields(local);
      return;
    }
    if (slugIssue || rangeIssue) return;
    if (visibility === "PRIVATE" && classIds.length === 0) {
      setGeneral(m.errors.privateClass);
      return;
    }

    const cleanSlug = normalizeSlug(slug);
    const startIso = localInputToIso(start);
    const endIso = localInputToIso(end);

    setSubmitting(true);
    try {
      const payload: CreateModulePayload | UpdateModulePayload = isEditing
        ? {
            title: title.trim(),
            description: description.trim(),
            // On an update null takes the value away, which is how a date or the slug is removed.
            slug: cleanSlug || null,
            visibility,
            status,
            activationStart: startIso,
            activationEnd: endIso,
            classIds: visibility === "PRIVATE" ? classIds : [],
          }
        : {
            title: title.trim(),
            description: description.trim(),
            slug: cleanSlug || undefined,
            visibility,
            activationStart: startIso ?? undefined,
            activationEnd: endIso ?? undefined,
            classIds: visibility === "PRIVATE" ? classIds : [],
          };
      await onSubmit(payload);
    } catch (error: unknown) {
      const { fields, general: message } = fromServer(error);
      setServerFields(fields);
      setGeneral(message);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldMessage = (field: FieldName, id: string) =>
    errors[field] ? (
      <p id={`${id}-error`} className={styles.fieldError} role="alert">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate data-testid="module-form">
      {general && (
        <div className={styles.errorMessage} role="alert">
          {general}
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.column}>
          <section className={styles.card} aria-labelledby={`${titleId}-section`}>
            <header className={styles.cardHeader}>
              <h2 id={`${titleId}-section`} className={styles.cardTitle}>
                {m.sections.identity}
              </h2>
              <p className={styles.cardHint}>{m.sections.identityHint}</p>
            </header>

            <div className={styles.fieldGroup}>
              <label htmlFor={titleId} className={styles.label}>
                {m.titleLabel} *
              </label>
              <input
                id={titleId}
                type="text"
                className={styles.input}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearServerField("title");
                }}
                placeholder={m.titlePlaceholder}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? `${titleId}-error` : undefined}
              />
              {fieldMessage("title", titleId)}
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor={slugId} className={styles.label}>
                {m.slugLabel}
              </label>
              <div className={styles.inline}>
                <input
                  id={slugId}
                  type="text"
                  className={`${styles.input} ${styles.mono}`}
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    clearServerField("slug");
                  }}
                  onBlur={() => setSlug((current) => normalizeSlug(current))}
                  placeholder={m.slugPlaceholder}
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={Boolean(errors.slug)}
                  aria-describedby={errors.slug ? `${slugId}-error` : `${slugId}-help`}
                />
                <button type="button" className={styles.secondaryButton} onClick={() => setSlug(slugify(title))} disabled={!title.trim()}>
                  {m.slugGenerate}
                </button>
              </div>
              <p id={`${slugId}-help`} className={styles.helperText}>
                {m.slugHelp}
              </p>
              {fieldMessage("slug", slugId)}
            </div>

            <div className={styles.fieldGroup}>
              <span className={styles.label}>{m.descriptionLabel} *</span>
              <RichTextEditor
                label={m.descriptionLabel}
                value={description}
                placeholder={m.descriptionPlaceholder}
                invalid={Boolean(errors.description)}
                describedBy={errors.description ? `${descId}-error` : undefined}
                onChange={(html) => {
                  setDescription(html);
                  clearServerField("description");
                }}
              />
              <span className={styles.counter}>{m.descriptionCount(descriptionText(description).length)}</span>
              {fieldMessage("description", descId)}
            </div>
          </section>

          <section className={styles.card} aria-labelledby={`${startId}-section`}>
            <header className={styles.cardHeader}>
              <h2 id={`${startId}-section`} className={styles.cardTitle}>
                {m.sections.validity}
              </h2>
              <p className={styles.cardHint}>{m.sections.validityHint}</p>
            </header>

            <div className={styles.dates}>
              <div className={styles.fieldGroup}>
                <label htmlFor={startId} className={styles.label}>
                  {m.activationStartLabel}
                </label>
                <div className={styles.inline}>
                  <input
                    id={startId}
                    type="datetime-local"
                    className={styles.input}
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      clearServerField("activationStart");
                    }}
                    aria-invalid={Boolean(errors.activationStart)}
                  />
                  {start && (
                    <button type="button" className={styles.linkButton} onClick={() => setStart("")} aria-label={`${m.clearDate}: ${m.activationStartLabel}`}>
                      {m.clearDate}
                    </button>
                  )}
                </div>
                {fieldMessage("activationStart", startId)}
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor={endId} className={styles.label}>
                  {m.activationEndLabel}
                </label>
                <div className={styles.inline}>
                  <input
                    id={endId}
                    type="datetime-local"
                    className={styles.input}
                    value={end}
                    min={start || undefined}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      clearServerField("activationEnd");
                    }}
                    aria-invalid={Boolean(errors.activationEnd)}
                    aria-describedby={errors.activationEnd ? `${endId}-error` : undefined}
                  />
                  {end && (
                    <button type="button" className={styles.linkButton} onClick={() => setEnd("")} aria-label={`${m.clearDate}: ${m.activationEndLabel}`}>
                      {m.clearDate}
                    </button>
                  )}
                </div>
                {fieldMessage("activationEnd", endId)}
              </div>
            </div>

            <p className={styles.summary} data-state={validityState}>
              <span className={styles.stateBadge}>{m.validityState[validityState]}</span>
              {validitySummary}
            </p>
          </section>
        </div>

        <div className={styles.column}>
          <section className={styles.card} aria-labelledby={`${visName}-section`}>
            <header className={styles.cardHeader}>
              <h2 id={`${visName}-section`} className={styles.cardTitle}>
                {m.sections.publication}
              </h2>
              <p className={styles.cardHint}>{m.sections.publicationHint}</p>
            </header>

            <fieldset className={styles.options}>
              <legend className={styles.label}>{m.visibilityLabel} *</legend>
              {VISIBILITIES.map((value) => (
                <label key={value} className={`${styles.option} ${visibility === value ? styles.selected : ""}`}>
                  <input type="radio" name={visName} value={value} checked={visibility === value} onChange={() => setVisibility(value)} />
                  <span className={styles.optionText}>
                    <span className={styles.optionTitle}>{m.visibilityOptions[value].title}</span>
                    <span className={styles.optionHelp}>{m.visibilityOptions[value].help}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {visibility === "PRIVATE" && (
              <fieldset className={styles.classes}>
                <legend className={styles.label}>{m.classesLabel} *</legend>
                <span className={styles.helperText}>{m.classesHelp}</span>
                {availableClasses.length === 0 ? (
                  <p className={styles.emptyNotice}>{m.classesEmpty}</p>
                ) : (
                  <div className={styles.checkboxList}>
                    {availableClasses.map((c) => (
                      <label key={c.id} className={styles.checkboxItem}>
                        <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            {isEditing && (
              <fieldset className={styles.options}>
                <legend className={styles.label}>{m.statusLabel}</legend>
                {STATUSES.map((value) => (
                  <label key={value} className={`${styles.option} ${status === value ? styles.selected : ""}`}>
                    <input type="radio" name={statusName} value={value} checked={status === value} onChange={() => setStatus(value)} />
                    <span className={styles.optionText}>
                      <span className={styles.optionTitle}>{m.statusOptions[value].title}</span>
                      <span className={styles.optionHelp}>{m.statusOptions[value].help}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </section>
        </div>
      </div>

      <div className={styles.actions}>
        {isEditing && dirty && <span className={styles.unsaved}>{m.unsaved}</span>}
        <Link href={cancelHref} className={styles.cancelLink}>
          {m.cancel}
        </Link>
        <button type="submit" className={styles.submitButton} disabled={submitting || (isEditing && !dirty)}>
          {submitting ? m.saving : isEditing ? m.submitSave : m.submitCreate}
        </button>
      </div>
    </form>
  );
}
