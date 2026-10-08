"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { ClassMembersTable } from "@/components/ClassMembersTable/ClassMembersTable";
import { StudentImportCsvModal } from "@/components/StudentImportCsvModal/StudentImportCsvModal";
import { messages } from "@/messages/pt-BR";
import {
  classService,
  type ClassGroup,
  type ClassMember,
} from "@/services/classService";
import styles from "./page.module.scss";

type TabType = "ACTIVE" | "PENDING_MODERATION";

export default function ClassStudentsPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const [id, setId] = useState<string | null>(null);
  const [classData, setClassData] = useState<ClassGroup | null>(null);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("ACTIVE");
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [isImportOpen, setIsImportOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then((p) => {
      if (active) setId(p.id);
    });
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void Promise.all([classService.getClass(id), classService.listMembers(id)])
      .then(([classRes, membersRes]) => {
        if (active) {
          setClassData(classRes);
          setMembers(membersRes);
        }
      })
      .catch(() => {
        if (active) {
          setClassData(null);
          setMembers([]);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, reloadTrigger]);

  const handleApprove = async (memberId: string) => {
    if (!id) return;
    try {
      await classService.moderateMember(id, memberId, true);
      setFeedback(messages.classes.members.approveSuccess);
      setIsLoading(true);
      setReloadTrigger((prev) => prev + 1);
    } catch {
      setFeedback("Erro ao aprovar solicitação.");
    }
  };

  const handleReject = async (memberId: string, reason?: string) => {
    if (!id) return;
    try {
      await classService.moderateMember(id, memberId, false, reason);
      setFeedback(messages.classes.members.rejectSuccess);
      setIsLoading(true);
      setReloadTrigger((prev) => prev + 1);
    } catch {
      setFeedback("Erro ao rejeitar solicitação.");
    }
  };

  if (isLoading && !classData) {
    return <main className={styles.loading}>Carregando estudantes...</main>;
  }

  if (!classData) {
    return <main className={styles.loading}>Turma não encontrada.</main>;
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>{classData.name}</h1>
          <p className={styles.subtitle}>
            {classData.courseCode} &bull; {classData.semester} &bull;{" "}
            {messages.classes.members.title}
          </p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setIsImportOpen(true)}>
            {messages.students.importCsv}
          </Button>
          <Link href="/app/classes">
            <Button variant="secondary">Voltar para Turmas</Button>
          </Link>
        </div>
      </header>

      {feedback && (
        <div className={styles.feedbackBanner} role="status">
          {feedback}
        </div>
      )}

      <ClassMembersTable
        members={members}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onApprove={handleApprove}
        onReject={handleReject}
        isLoading={isLoading}
      />

      {id && (
        <StudentImportCsvModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onSuccess={() => {
            setFeedback(messages.students.importModal.successSummary);
            setReloadTrigger((prev) => prev + 1);
          }}
          defaultClassId={id}
          availableClasses={[{ id: classData.id, name: classData.name }]}
        />
      )}
    </main>
  );
}
