"use client";

import { useState } from "react";
import { Alert } from "@/components/Alert/Alert";
import { AuthCard } from "@/components/AuthCard/AuthCard";
import { ChangePasswordForm } from "@/components/ChangePasswordForm/ChangePasswordForm";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";

/** Voluntary password change (SPEC-003). */
export default function SecurityPage() {
  const { user } = useAuth();
  const [changed, setChanged] = useState(false);
  return (
    <AuthCard title={messages.home.security} subtitle={messages.auth.change.voluntarySubtitle}>
      {changed ? (
        <Alert tone="success">{messages.auth.change.success}</Alert>
      ) : (
        <ChangePasswordForm email={user.email} onSuccess={() => setChanged(true)} />
      )}
    </AuthCard>
  );
}
