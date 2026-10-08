"use client";

import { messages } from "@/messages/pt-BR";
import type { ClassMember } from "@/services/classService";
import styles from "./ClassMembersTable.module.scss";

export interface ClassMembersTableProps {
  members: ClassMember[];
  activeTab: "ACTIVE" | "PENDING_MODERATION";
  onTabChange: (tab: "ACTIVE" | "PENDING_MODERATION") => void;
  onApprove: (memberId: string) => Promise<void>;
  onReject: (memberId: string, reason?: string) => Promise<void>;
  isLoading?: boolean;
}

export function ClassMembersTable({
  members,
  activeTab,
  onTabChange,
  onApprove,
  onReject,
  isLoading = false,
}: ClassMembersTableProps) {
  const handleRejectClick = async (memberId: string) => {
    const reason = window.prompt(messages.classes.members.rejectPrompt);
    if (reason === null) return; // User cancelled prompt
    await onReject(memberId, reason.trim() || undefined);
  };

  const filtered = members.filter((m) => m.status === activeTab);

  return (
    <div className={styles.container}>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "ACTIVE"}
          className={`${styles.tab} ${activeTab === "ACTIVE" ? styles.activeTab : ""}`}
          onClick={() => onTabChange("ACTIVE")}
        >
          {messages.classes.members.activeTab}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "PENDING_MODERATION"}
          className={`${styles.tab} ${activeTab === "PENDING_MODERATION" ? styles.activeTab : ""}`}
          onClick={() => onTabChange("PENDING_MODERATION")}
        >
          {messages.classes.members.pendingTab}
        </button>
      </div>

      <div className={styles.tableWrapper}>
        {isLoading ? (
          <div className={styles.emptyMessage}>Carregando membros...</div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyMessage}>
            {activeTab === "ACTIVE"
              ? messages.classes.members.emptyActive
              : messages.classes.members.emptyPending}
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{messages.classes.members.studentColumn}</th>
                <th>{messages.classes.members.raColumn}</th>
                <th>{messages.classes.members.emailColumn}</th>
                <th>{messages.classes.members.originColumn}</th>
                <th>{messages.classes.members.dateColumn}</th>
                {activeTab === "PENDING_MODERATION" && (
                  <th>{messages.classes.members.actionsColumn}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.id}>
                  <td>{member.userName || "—"}</td>
                  <td>{member.userAcademicId || "—"}</td>
                  <td>{member.userEmail}</td>
                  <td>{messages.classes.members.origin[member.origin] ?? member.origin}</td>
                  <td>{new Date(member.requestedAt).toLocaleDateString("pt-BR")}</td>
                  {activeTab === "PENDING_MODERATION" && (
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.approveBtn}
                          onClick={() => void onApprove(member.id)}
                        >
                          {messages.classes.members.approveButton}
                        </button>
                        <button
                          type="button"
                          className={styles.rejectBtn}
                          onClick={() => void handleRejectClick(member.id)}
                        >
                          {messages.classes.members.rejectButton}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
