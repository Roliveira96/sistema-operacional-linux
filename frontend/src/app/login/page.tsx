"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm/LoginForm";

function LoginContent() {
  const router = useRouter();
  const reason = useSearchParams().get("reason");
  return (
    <LoginForm
      reason={reason}
      onSuccess={(result) => router.replace(result.mustChangePassword ? "/change-password" : "/app")}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
