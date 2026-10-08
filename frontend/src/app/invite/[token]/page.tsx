"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { joinByInvite, type JoinInviteResponse } from "@/services/studentService";
import styles from "./page.module.scss";

export default function InviteJoinPage({
  params,
}: {
  params: Promise<{ token: string }> | { token: string };
}) {
  const [token, setToken] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [academicId, setAcademicId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [discord, setDiscord] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinResult, setJoinResult] = useState<JoinInviteResponse | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then((p) => {
      if (active) setToken(p.token);
    });
    return () => {
      active = false;
    };
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setErrorMessage(null);

    const cleanAcademicId = academicId.trim().replace(/^a/i, "");
    if (!/^\d{7}$/.test(cleanAcademicId)) {
      setErrorMessage(messages.auth.errors.invalidAcademicId);
      return;
    }

    if (password.length < 8) {
      setErrorMessage(messages.auth.policy.TOO_SHORT || "Senha muito curta.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await joinByInvite(token, {
        academicId: cleanAcademicId,
        email: email.trim(),
        name: name.trim(),
        password,
        whatsapp: whatsapp.trim() || undefined,
        discord: discord.trim() || undefined,
      });
      setJoinResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("academic") || msg.toLowerCase().includes("ra")) {
        setErrorMessage(messages.students.invite.conflictAcademicId);
      } else if (msg.toLowerCase().includes("email") || msg.toLowerCase().includes("e-mail")) {
        setErrorMessage(messages.students.invite.conflictEmail);
      } else if (msg.toLowerCase().includes("invalid token") || msg.toLowerCase().includes("not found")) {
        setErrorMessage(messages.students.invite.invalidToken);
      } else {
        setErrorMessage(msg || "Erro ao solicitar entrada na turma.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.badge}>Convite Institucional</div>
          <h1 className={styles.title}>{messages.students.invite.title}</h1>
          <p className={styles.subtitle}>{messages.students.invite.subtitle}</p>
        </div>

        {joinResult ? (
          <div className={styles.successContainer}>
            <div className={styles.successNotice} role="status">
              {messages.students.invite.pendingNotice}
            </div>

            <Link href="/login" className={styles.submitBtn} style={{ textAlign: "center", textDecoration: "none" }}>
              {messages.students.invite.loginAction}
            </Link>
          </div>
        ) : (
          <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
            {errorMessage && (
              <div className={styles.errorBox} role="alert">
                {errorMessage}
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="invite-name" className={styles.label}>
                {messages.students.invite.name}
              </label>
              <input
                id="invite-name"
                type="text"
                className={styles.input}
                placeholder={messages.students.invite.nameHint}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="invite-academic-id" className={styles.label}>
                {messages.students.invite.academicId}
              </label>
              <input
                id="invite-academic-id"
                type="text"
                className={styles.input}
                placeholder={messages.students.invite.academicIdHint}
                value={academicId}
                onChange={(e) => setAcademicId(e.target.value)}
                required
              />
              <span className={styles.hint}>{messages.students.invite.academicIdHint}</span>
            </div>

            <div className={styles.field}>
              <label htmlFor="invite-email" className={styles.label}>
                {messages.students.invite.email}
              </label>
              <input
                id="invite-email"
                type="email"
                className={styles.input}
                placeholder={messages.students.invite.emailHint}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="invite-password" className={styles.label}>
                {messages.students.invite.password}
              </label>
              <input
                id="invite-password"
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="invite-whatsapp" className={styles.label}>
                {messages.students.invite.whatsapp}
              </label>
              <input
                id="invite-whatsapp"
                type="text"
                className={styles.input}
                placeholder={messages.students.invite.whatsappHint}
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="invite-discord" className={styles.label}>
                {messages.students.invite.discord}
              </label>
              <input
                id="invite-discord"
                type="text"
                className={styles.input}
                placeholder={messages.students.invite.discordHint}
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting || !token}
            >
              {isSubmitting
                ? messages.students.invite.submitting
                : messages.students.invite.submit}
            </button>

            <div className={styles.loginPrompt}>
              <span>{messages.students.invite.alreadyHaveAccount}</span>
              <Link href="/login" className={styles.loginLink}>
                {messages.students.invite.loginAction}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
