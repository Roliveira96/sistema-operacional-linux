"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassLinkItem } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./ClassLinks.module.scss";

const m = messages.classes.links;

/** The largest name of a link, as in the server (SPEC-048 RN-01). */
export const LINK_NAME_MAX_LENGTH = 80;

export interface ClassLinksProps {
  classId: string;
  /** The owner teacher and the administrator edit; a student only reads (SPEC-048, section 3.1). */
  editable: boolean;
}

type FieldErrors = Partial<Record<"name" | "url", string>>;

function isHttps(address: string): boolean {
  try {
    const u = new URL(address);
    return u.protocol === "https:" && u.host !== "";
  } catch {
    return false;
  }
}

const toInput = (links: ClassLinkItem[]) => links.map((l) => ({ name: l.name, url: l.url }));

/** The links of a class: the teacher adds and removes them, saving the whole list at once; a student reads (SPEC-048). */
export function ClassLinks({ classId, editable }: ClassLinksProps) {
  const [links, setLinks] = useState<ClassLinkItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<"add" | "remove" | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    classService
      .getLinks(classId)
      .then((list) => {
        if (!active) return;
        setLinks(list);
        setLoadError(false);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [classId, attempt]);

  const retry = () => {
    setLoadError(false);
    setAttempt((n) => n + 1);
  };

  /** Maps a problem of the server to the field it is about, when there is one. */
  const showProblem = (err: unknown) => {
    if (err instanceof ApiProblemError) {
      if (err.type === "invalid-link") {
        const field = String(err.extensions.field ?? "");
        if (field.endsWith(".name")) return setErrors({ name: m.errors.nameRequired });
        if (field.endsWith(".url")) return setErrors({ url: m.errors.urlHttps });
      }
      if (err.type === "too-many-links") return setBanner(m.errors.tooMany);
    }
    setBanner(m.errors.save);
  };

  const save = async (next: { name: string; url: string }[], kind: "add" | "remove") => {
    setSaving(kind);
    setBanner(null);
    setNotice(null);
    try {
      const saved = await classService.replaceLinks(classId, next);
      setLinks(saved);
      setNotice(kind === "add" ? m.added : m.removed);
      return true;
    } catch (err) {
      showProblem(err);
      return false;
    } finally {
      setSaving(null);
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const found: FieldErrors = {};
    if (!trimmedName) found.name = m.errors.nameRequired;
    else if (trimmedName.length > LINK_NAME_MAX_LENGTH) found.name = m.errors.nameTooLong;
    if (!trimmedUrl) found.url = m.errors.urlRequired;
    else if (!isHttps(trimmedUrl)) found.url = m.errors.urlHttps;
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.url) return urlRef.current?.focus();

    const ok = await save([...toInput(links ?? []), { name: trimmedName, url: trimmedUrl }], "add");
    if (ok) {
      setName("");
      setUrl("");
    }
  };

  const handleRemove = (id: string) => {
    setErrors({});
    void save(toInput((links ?? []).filter((l) => l.id !== id)), "remove");
  };

  const nameErrorId = `${baseId}-name-error`;
  const urlErrorId = `${baseId}-url-error`;

  return (
    <section className={styles.section} aria-labelledby={`${baseId}-title`}>
      <h2 id={`${baseId}-title`} className={styles.title}>
        {m.title}
      </h2>

      {loadError && (
        <div className={styles.error} role="alert">
          <span>{m.errors.load}</span>
          <Button variant="secondary" size="sm" onClick={retry}>
            {m.retry}
          </Button>
        </div>
      )}

      {!loadError && links === null && <p className={styles.muted}>{m.loading}</p>}

      {links !== null && links.length === 0 && <p className={styles.muted}>{editable ? m.empty : m.emptyStudent}</p>}

      {links !== null && links.length > 0 && (
        <ul className={styles.list}>
          {links.map((link) => (
            <li key={link.id} className={styles.item}>
              <div className={styles.itemText}>
                {editable ? (
                  <span className={styles.itemName}>{link.name}</span>
                ) : (
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.itemLink}>
                    {link.name}
                  </a>
                )}
                {editable && <span className={styles.itemUrl}>{link.url}</span>}
              </div>
              {editable && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving !== null}
                  aria-label={m.removeLink(link.name)}
                  onClick={() => handleRemove(link.id)}
                >
                  {m.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && links !== null && (
        <form className={styles.form} onSubmit={(e) => void handleAdd(e)} noValidate>
          <div className={styles.field}>
            <label htmlFor={`${baseId}-name`} className={styles.label}>
              {m.nameLabel}
            </label>
            <input
              id={`${baseId}-name`}
              ref={nameRef}
              className={styles.input}
              type="text"
              value={name}
              placeholder={m.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? nameErrorId : undefined}
            />
            {errors.name && (
              <span id={nameErrorId} className={styles.fieldError}>
                {errors.name}
              </span>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor={`${baseId}-url`} className={styles.label}>
              {m.urlLabel}
            </label>
            <input
              id={`${baseId}-url`}
              ref={urlRef}
              className={styles.input}
              type="url"
              value={url}
              placeholder={m.urlPlaceholder}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={errors.url ? true : undefined}
              aria-describedby={errors.url ? urlErrorId : undefined}
            />
            {errors.url && (
              <span id={urlErrorId} className={styles.fieldError}>
                {errors.url}
              </span>
            )}
          </div>

          <Button type="submit" disabled={saving !== null}>
            {saving === "add" ? m.adding : m.add}
          </Button>
        </form>
      )}

      {banner && (
        <div className={styles.error} role="alert">
          {banner}
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
