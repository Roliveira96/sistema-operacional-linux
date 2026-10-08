"use client";

import { useEffect, useState } from "react";
import { StudentAvatarUpload } from "@/components/StudentAvatarUpload/StudentAvatarUpload";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import {
  getStudentProfile,
  type StudentProfileResponse,
} from "@/services/studentService";
import styles from "./page.module.scss";

export default function ProfilePage() {
  const { user } = useAuth();
  const isStudent = user.role === "STUDENT";
  const [profile, setProfile] = useState<StudentProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(isStudent);

  useEffect(() => {
    let active = true;
    if (!isStudent) {
      return;
    }

    getStudentProfile()
      .then((res) => {
        if (active) setProfile(res);
      })
      .catch(() => {
        if (active) setProfile(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isStudent]);

  if (isLoading) {
    return <main className={styles.loading}>Carregando perfil...</main>;
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.students.profile.title}</h1>
        <p className={styles.subtitle}>
          {user.name ?? user.email} &bull; {messages.home.role[user.role] ?? user.role}
        </p>
      </header>

      {user.role === "STUDENT" && (
        <StudentAvatarUpload
          currentAvatarUrl={profile?.avatarUrl}
          studentName={profile?.name || user.name || "A"}
          onAvatarUpdated={(newUrl) => {
            if (profile) {
              setProfile({ ...profile, avatarUrl: newUrl });
            }
          }}
        />
      )}

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Dados Pessoais</h2>
        <div className={styles.grid}>
          <div className={styles.field}>
            <span className={styles.label}>Nome</span>
            <span className={styles.value}>{profile?.name || user.name || "—"}</span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>E-mail</span>
            <span className={styles.value}>{profile?.email || user.email}</span>
          </div>

          {user.role === "STUDENT" && (
            <>
              <div className={styles.field}>
                <span className={styles.label}>RA</span>
                <span className={styles.value}>
                  {profile?.academicId ? `a${profile.academicId}` : "—"}
                </span>
              </div>

              <div className={styles.field}>
                <span className={styles.label}>WhatsApp</span>
                <span className={styles.value}>{profile?.whatsapp || "—"}</span>
              </div>

              <div className={styles.field}>
                <span className={styles.label}>Discord</span>
                <span className={styles.value}>{profile?.discord || "—"}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
