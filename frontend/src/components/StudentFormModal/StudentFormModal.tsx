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
}

export function StudentFormModal({
  isOpen,
  onClose,
  onSuccess,
  availableClasses = [],
}: StudentFormModalProps) {
  const [academicId, setAcademicId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [discord, setDiscord] = useState("");
  const [classGroupId, setClassGroupId] = useState("");

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

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 id="modal-title" className={styles.title}>
            {messages.students.form.title}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Fechar"
          >
            &times;
          </button>
        </div>

        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
          {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

          <div className={styles.field}>
            <label htmlFor="student-academic-id" className={styles.label}>
              {messages.students.form.academicId}
            </label>
            <input
              id="student-academic-id"
              type="text"
              className={styles.input}
              placeholder={messages.students.form.academicIdHint}
              value={academicId}
              onChange={(e) => setAcademicId(e.target.value)}
              required
            />
            <span className={styles.hint}>{messages.students.form.academicIdHint}</span>
          </div>

          <div className={styles.field}>
            <label htmlFor="student-email" className={styles.label}>
              {messages.students.form.email}
            </label>
            <input
              id="student-email"
              type="email"
              className={styles.input}
              placeholder={messages.students.form.emailHint}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="student-name" className={styles.label}>
              {messages.students.form.name}
            </label>
            <input
              id="student-name"
              type="text"
              className={styles.input}
              placeholder={messages.students.form.nameHint}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="student-whatsapp" className={styles.label}>
              {messages.students.form.whatsapp}
            </label>
            <input
              id="student-whatsapp"
              type="text"
              className={styles.input}
              placeholder={messages.students.form.whatsappHint}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="student-discord" className={styles.label}>
              {messages.students.form.discord}
            </label>
            <input
              id="student-discord"
              type="text"
              className={styles.input}
              placeholder={messages.students.form.discordHint}
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="student-class" className={styles.label}>
              {messages.students.form.classGroup}
            </label>
            <select
              id="student-class"
              className={styles.select}
              value={classGroupId}
              onChange={(e) => setClassGroupId(e.target.value)}
            >
              <option value="">{messages.students.form.noClassOption}</option>
              {availableClasses.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>

          {!classGroupId && (
            <div className={styles.warningBox} role="alert">
              {messages.students.noClassWarning}
            </div>
          )}

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={isSubmitting}
            >
              {messages.students.form.cancel}
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? messages.students.form.submitting
                : messages.students.form.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
