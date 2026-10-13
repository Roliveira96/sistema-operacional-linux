"use client";

import { useState } from "react";
import { messages } from "@/messages/pt-BR";
import {
  createStudentManual,
  type ManualStudentInput,
} from "@/services/studentService";
import styles from "./StudentFormModal.module.scss";

export interface StudentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  availableClasses?: Array<{ id: string; name: string }>;
  /** From the class page: the student is enrolled in this class, without a selector (SPEC-041). */
  fixedClass?: { id: string; name: string };
}

export function StudentFormModal({
  isOpen,
  onClose,
  onSuccess,
  availableClasses = [],
  fixedClass,
}: StudentFormModalProps) {
  const [academicId, setAcademicId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [discord, setDiscord] = useState("");
  const [selectedClassId, setClassGroupId] = useState("");
  const classGroupId = fixedClass?.id ?? selectedClassId;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanAcademicId = academicId.trim().replace(/^a/i, "");
    if (!/^\d{7}$/.test(cleanAcademicId)) {
      setErrorMessage(messages.auth.errors.invalidAcademicId);
      return;
    }

    if (!email.trim()) {
      setErrorMessage(messages.students.form.validationError);
      return;
    }

    const payload: ManualStudentInput = {
      academicId: cleanAcademicId,
      email: email.trim(),
      name: name.trim() || undefined,
      whatsapp: whatsapp.trim() || undefined,
      discord: discord.trim() || undefined,
      classGroupId: classGroupId || undefined,
    };

    setIsSubmitting(true);
    try {
      await createStudentManual(payload);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("academic") || msg.toLowerCase().includes("ra")) {
        setErrorMessage(messages.students.form.conflictAcademicId);
      } else if (msg.toLowerCase().includes("email") || msg.toLowerCase().includes("e-mail")) {
        setErrorMessage(messages.students.form.conflictEmail);
      } else {
        setErrorMessage(msg || "Erro ao cadastrar estudante.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const f = messages.students.form;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className={styles.modal}>
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </span>
          <div className={styles.headerText}>
            <h2 id="modal-title" className={styles.title}>
              {f.title}
            </h2>
            {fixedClass ? (
              <span className={styles.classChip}>{f.enrollIn(fixedClass.name)}</span>
            ) : (
              <p className={styles.subtitle}>{f.subtitle}</p>
            )}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
          <div className={styles.body}>
            {errorMessage && (
              <div className={styles.errorBox} role="alert">
                {errorMessage}
              </div>
            )}

            <fieldset className={styles.group}>
              <legend className={styles.legend}>{f.identityGroup}</legend>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label htmlFor="student-academic-id" className={styles.label}>
                    {f.academicId}
                  </label>
                  <input
                    id="student-academic-id"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    className={`${styles.input} ${styles.mono}`}
                    placeholder={f.academicIdPlaceholder}
                    value={academicId}
                    onChange={(e) => setAcademicId(e.target.value)}
                    aria-describedby="student-academic-id-hint"
                    required
                  />
                  <span id="student-academic-id-hint" className={styles.hint}>
                    {f.academicIdHint}
                  </span>
                </div>

                <div className={styles.field}>
                  <label htmlFor="student-email" className={styles.label}>
                    {f.email}
                  </label>
                  <input
                    id="student-email"
                    type="email"
                    autoComplete="email"
                    className={styles.input}
                    placeholder={f.emailHint.replace(/^Ex\.: /, "")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className={styles.group}>
              <legend className={styles.legend}>{f.contactGroup}</legend>
              <div className={styles.field}>
                <label htmlFor="student-name" className={styles.label}>
                  {f.name}
                </label>
                <input
                  id="student-name"
                  type="text"
                  autoComplete="name"
                  className={styles.input}
                  placeholder={f.nameHint.replace(/^Ex\.: /, "")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label htmlFor="student-whatsapp" className={styles.label}>
                    {f.whatsapp}
                  </label>
                  <input
                    id="student-whatsapp"
                    type="tel"
                    autoComplete="tel"
                    className={styles.input}
                    placeholder={f.whatsappHint.replace(/^Ex\.: /, "")}
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="student-discord" className={styles.label}>
                    {f.discord}
                  </label>
                  <input
                    id="student-discord"
                    type="text"
                    autoComplete="off"
                    className={styles.input}
                    placeholder={f.discordHint.replace(/^Ex\.: /, "")}
                    value={discord}
                    onChange={(e) => setDiscord(e.target.value)}
                  />
                </div>
              </div>
            </fieldset>

            {!fixedClass && (
              <div className={styles.field}>
                <label htmlFor="student-class" className={styles.label}>
                  {f.classGroup}
                </label>
                <select
                  id="student-class"
                  className={styles.input}
                  value={classGroupId}
                  onChange={(e) => setClassGroupId(e.target.value)}
                >
                  <option value="">{f.noClassOption}</option>
                  {availableClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!classGroupId && (
              <div className={styles.warningBox} role="alert">
                {messages.students.noClassWarning}
              </div>
            )}
          </div>

          <footer className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={isSubmitting}>
              {f.cancel}
            </button>
            <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
              {isSubmitting ? f.submitting : f.submit}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
