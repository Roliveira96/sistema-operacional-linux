"use client";

import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/AuthCard/AuthCard";
import { AuthProvider } from "@/components/AuthProvider/AuthProvider";
import { ChangePasswordForm } from "@/components/ChangePasswordForm/ChangePasswordForm";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";

function ChangePasswordContent() {
  const router = useRouter();
  const { user } = useAuth();
  return (
    <AuthCard
      title={messages.auth.change.title}
      subtitle={user.mustChangePassword ? messages.auth.change.forcedSubtitle : messages.auth.change.voluntarySubtitle}
    >
      <ChangePasswordForm email={user.email} onSuccess={() => router.replace("/app")} />
    </AuthCard>
  );
}

/** Mandatory password change (SPEC-003 RN-08). */
export default function ChangePasswordPage() {
  return (
    <AuthProvider enforcePasswordChange={false}>
      <ChangePasswordContent />
    </AuthProvider>
  );
}
