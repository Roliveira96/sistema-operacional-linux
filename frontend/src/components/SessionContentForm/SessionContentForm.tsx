"use client";

import { type ChangeEvent, type FormEvent, useEffect, useId, useState } from "react";
import { Button } from "@/components/Button/Button";
import { readPdfInfo } from "@/components/Classroom/SlidePresenter/pdfRenderer";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { messages } from "@/messages/pt-BR";
import { classroomService } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import { moduleService, type CourseModuleSummary } from "@/services/moduleService";
import { scheduleService, type Session, type SessionContent } from "@/services/scheduleService";
import styles from "./SessionContentForm.module.scss";

const m = messages.schedule.content;
const pdf = messages.classroom.panel.errors;

const TOPIC_MAX = 120;
const LINK_NAME_MAX = 80;
const MAX_LINKS = 10;
const MAX_PAGES = 100;
const MAX_BYTES = 25 * 1024 * 1024;

export interface SessionContentFormProps {
  classId: string;
  session: Session;
  onSaved: () => void;
  onClose: () => void;
}

interface Link {
  name: string;
  url: string;
}

interface Option {
  id: string;
  title: string;
}

const dateBr = (iso: string) => iso.split("-").reverse().join("/");

function isHttps(address: string): boolean {
  try {
    const u = new URL(address);
    return u.protocol === "https:" && u.host !== "";
  } catch {
    return false;
  }
}

/** The dialog where the teacher says what one lesson covers: topic, description, links, module and presentation (SPEC-053, 3.1). */
export function SessionContentForm({ classId, session, onSaved, onClose }: SessionContentFormProps) {
  const baseId = useId();
  const [content, setContent] = useState<SessionContent | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [modules, setModules] = useState<Option[]>([]);

  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [teacherNotes, setTeacherNotes] = useState("");
  const [teacherPrivateNotes, setTeacherPrivateNotes] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  const [moduleId, setModuleId] = useState("");
  const [deckId, setDeckId] = useState("");
  const [classDecks, setClassDecks] = useState<Option[]>([]);
  const [uploaded, setUploaded] = useState<Option[]>([]);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const [errors, setErrors] = useState<
    Partial<Record<"topic" | "description" | "teacherNotes" | "teacherPrivateNotes" | "linkName" | "linkUrl" | "links" | "file", string>>
  >({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    scheduleService.getSessionContent(classId, session.id).then(
      (loaded) => {
        if (!active) return;
        setContent(loaded);
        setTopic(loaded.topic ?? "");
        setDescription(loaded.description ?? "");
        setTeacherNotes(loaded.teacherNotes ?? "");
        setTeacherPrivateNotes(loaded.teacherPrivateNotes ?? "");
        setLinks(loaded.links.map((l) => ({ name: l.name, url: l.url })));
        setModuleId(loaded.module?.id ?? "");
        setDeckId(loaded.deck?.id ?? "");
        setLoadFailed(false);
      },
      () => active && setLoadFailed(true),
    );
    return () => {
      active = false;
    };
  }, [classId, session.id, attempt]);

  useEffect(() => {
    let active = true;
    moduleService.listModules({ limit: 100 }).then(
      (res) => active && setModules(res.items.map((x: CourseModuleSummary) => ({ id: x.id, title: x.title }))),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  // The presentations of the class, the most recent first (SPEC-053 CA-13).
  useEffect(() => {
    let active = true;
    classroomService.listDecks(classId).then(
      (res) => active && setClassDecks(res.map((d) => ({ id: d.id, title: d.title }))),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [classId]);

  const retry = () => {
    setLoadFailed(false);
    setAttempt((n) => n + 1);
  };

  // The module of the lesson may not be among the ones listed (it can be of another teacher): keep it as an option.
  const moduleOptions = content?.module && !modules.some((x) => x.id === content.module?.id) ? [...modules, content.module] : modules;

  // The list, plus the one of the lesson and the ones sent here when the list did not bring them yet.
  const deckOptions = [...classDecks];
  for (const extra of [...(content?.deck ? [{ id: content.deck.id, title: content.deck.title }] : []), ...uploaded]) {
    if (!deckOptions.some((d) => d.id === extra.id)) deckOptions.push(extra);
  }

  const addLink = () => {
    const name = linkName.trim();
    const url = linkUrl.trim();
    const found: typeof errors = {};
    if (!name) found.linkName = m.errors.linkNameRequired;
    else if (name.length > LINK_NAME_MAX) found.linkName = m.errors.linkNameTooLong;
    if (!url) found.linkUrl = m.errors.linkUrlRequired;
    else if (!isHttps(url)) found.linkUrl = m.errors.linkUrlHttps;
    if (!found.linkName && !found.linkUrl && links.length >= MAX_LINKS) found.links = m.errors.tooManyLinks;
    setErrors((prev) => ({ ...prev, linkName: found.linkName, linkUrl: found.linkUrl, links: found.links }));
    if (Object.keys(found).length > 0) return;
    setLinks([...links, { name, url }]);
    setLinkName("");
    setLinkUrl("");
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setErrors((prev) => ({ ...prev, file: undefined }));
    if (!file) return;
    const fail = (message: string) => setErrors((prev) => ({ ...prev, file: message }));
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return fail(pdf.notPdf);
    if (file.size > MAX_BYTES) return fail(pdf.tooBig);
    let pageCount: number;
    try {
      ({ pageCount } = await readPdfInfo(file));
    } catch {
      return fail(pdf.invalidPdf);
    }
    if (pageCount > MAX_PAGES) return fail(pdf.tooManyPages);
    setUploading(true);
    try {
      const title = file.name.replace(/\.pdf$/i, "").trim().slice(0, 120) || file.name;
      const deck = await classroomService.uploadDeck(classId, file, title, pageCount);
      setUploaded((prev) => [...prev.filter((d) => d.id !== deck.id), { id: deck.id, title: deck.title }]);
      setDeckId(deck.id);
    } catch (err) {
      fail(err instanceof ApiProblemError && err.type === "deck-limit-exceeded" ? pdf.deckLimit : m.errors.upload);
    } finally {
      setUploading(false);
    }
  };

  /** Puts a problem of the server on the field it is about, or at the top. */
  const showProblem = (err: unknown) => {
    if (err instanceof ApiProblemError) {
      const field = String(err.extensions.field ?? "");
      if (err.type === "invalid-session-content") {
        if (field === "topic") return setErrors({ topic: m.errors.topicInvalid });
        const link = /^links\[(\d+)\]/.exec(field);
        if (link) return setErrors({ links: m.errors.linkInvalid(Number(link[1]) + 1) });
        if (field === "links") return setErrors({ links: m.errors.tooManyLinks });
      }
      if (err.type === "content-too-long") {
        if (field === "teacherNotes") return setErrors({ teacherNotes: m.errors.notesTooLong });
        if (field === "teacherPrivateNotes") return setErrors({ teacherPrivateNotes: m.errors.notesTooLong });
        return setErrors({ description: m.errors.descriptionTooLong });
      }
      if (err.type === "deck-not-found") return setBanner(m.errors.deckGone);
      if (err.type === "module-not-found") return setBanner(m.errors.moduleGone);
      if (err.type === "forbidden") return setBanner(m.errors.forbidden);
      if (err.type === "session-not-found") return setBanner(m.errors.sessionGone);
    }
    setBanner(m.errors.save);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBanner(null);
    const name = topic.trim();
    if (name.length > TOPIC_MAX) {
      setErrors({ topic: m.errors.topicTooLong });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await scheduleService.saveSessionContent(classId, session.id, { topic: name, description, moduleId, deckId, links, teacherNotes, teacherPrivateNotes });
      onSaved();
      onClose();
    } catch (err) {
      showProblem(err);
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || uploading;
  const titleId = `${baseId}-title`;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={styles.modal}>
        <h2 id={titleId} className={styles.title}>
          {m.title(dateBr(session.date))}
        </h2>

        {loadFailed && (
          <div className={styles.error} role="alert">
            <span>{m.loadError}</span>
            <Button variant="secondary" size="sm" onClick={retry}>
              {m.retry}
            </Button>
          </div>
        )}
        {!content && !loadFailed && <p className={styles.muted}>{m.loading}</p>}

        {content && (
          <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
            <div className={styles.field}>
              <label htmlFor={`${baseId}-topic`} className={styles.label}>
                {m.topicLabel}
              </label>
              <input
                id={`${baseId}-topic`}
                className={styles.input}
                value={topic}
                placeholder={m.topicPlaceholder}
                aria-invalid={errors.topic ? true : undefined}
                aria-describedby={errors.topic ? `${baseId}-topic-error` : undefined}
                onChange={(e) => setTopic(e.target.value)}
              />
              {errors.topic && (
                <span id={`${baseId}-topic-error`} className={styles.fieldError}>
                  {errors.topic}
                </span>
              )}
            </div>

            <div className={styles.field}>
              <RichTextEditor
                label={m.descriptionLabel}
                value={description}
                onChange={setDescription}
                placeholder={m.descriptionPlaceholder}
                invalid={Boolean(errors.description)}
              />
              {errors.description && <span className={styles.fieldError}>{errors.description}</span>}
            </div>

            {/* The notes of the teacher on the lesson: the public ones the class reads, the private ones only he does (SPEC-073). */}
            <div className={styles.field}>
              <RichTextEditor
                label={m.teacherNotesLabel}
                value={teacherNotes}
                onChange={setTeacherNotes}
                placeholder={m.teacherNotesPlaceholder}
                invalid={Boolean(errors.teacherNotes)}
              />
              {errors.teacherNotes && <span className={styles.fieldError}>{errors.teacherNotes}</span>}
            </div>
            <div className={styles.field}>
              <RichTextEditor
                label={m.teacherPrivateNotesLabel}
                value={teacherPrivateNotes}
                onChange={setTeacherPrivateNotes}
                placeholder={m.teacherPrivateNotesPlaceholder}
                invalid={Boolean(errors.teacherPrivateNotes)}
              />
              {errors.teacherPrivateNotes && <span className={styles.fieldError}>{errors.teacherPrivateNotes}</span>}
            </div>

            <fieldset className={styles.group}>
              <legend className={styles.label}>{m.linksLegend}</legend>
              {links.length > 0 && (
                <ul className={styles.links}>
                  {links.map((link, i) => (
                    <li key={`${link.url}-${i}`} className={styles.link}>
                      <span className={styles.linkText}>
                        <span className={styles.linkName}>{link.name}</span>
                        <span className={styles.linkUrl}>{link.url}</span>
                      </span>
                      <Button variant="secondary" size="sm" aria-label={m.removeLink(link.name)} onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                        {m.remove}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.addLink}>
                <div className={styles.field}>
                  <label htmlFor={`${baseId}-link-name`} className={styles.label}>
                    {m.linkNameLabel}
                  </label>
                  <input
                    id={`${baseId}-link-name`}
                    className={styles.input}
                    value={linkName}
                    aria-invalid={errors.linkName ? true : undefined}
                    onChange={(e) => setLinkName(e.target.value)}
                  />
                  {errors.linkName && <span className={styles.fieldError}>{errors.linkName}</span>}
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${baseId}-link-url`} className={styles.label}>
                    {m.linkUrlLabel}
                  </label>
                  <input
                    id={`${baseId}-link-url`}
                    className={styles.input}
                    type="url"
                    value={linkUrl}
                    placeholder="https://"
                    aria-invalid={errors.linkUrl ? true : undefined}
                    onChange={(e) => setLinkUrl(e.target.value)}
                  />
                  {errors.linkUrl && <span className={styles.fieldError}>{errors.linkUrl}</span>}
                </div>
                <Button variant="secondary" onClick={addLink}>
                  {m.addLink}
                </Button>
              </div>
              {errors.links && <span className={styles.fieldError}>{errors.links}</span>}
            </fieldset>

            <div className={styles.field}>
              <label htmlFor={`${baseId}-module`} className={styles.label}>
                {m.moduleLabel}
              </label>
              <select id={`${baseId}-module`} className={styles.input} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                <option value="">{m.moduleNone}</option>
                {moduleOptions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor={`${baseId}-deck`} className={styles.label}>
                {m.deckLabel}
              </label>
              <select id={`${baseId}-deck`} className={styles.input} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                <option value="">{m.deckNone}</option>
                {deckOptions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
              <label htmlFor={`${baseId}-file`} className={styles.label}>
                {m.uploadLabel}
              </label>
              <input
                id={`${baseId}-file`}
                className={styles.input}
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                onChange={(e) => void chooseFile(e)}
              />
              {uploading && <span className={styles.muted}>{m.uploading}</span>}
              {errors.file && <span className={styles.fieldError}>{errors.file}</span>}
            </div>

            {banner && (
              <div className={styles.error} role="alert">
                {banner}
              </div>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                {m.cancel}
              </Button>
              <Button type="submit" disabled={busy}>
                {saving ? m.saving : m.save}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
