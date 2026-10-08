"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthContainer } from "@/components/AuthContainer/AuthContainer";

function LoginContent() {
  const reason = useSearchParams().get("reason");
  return <AuthContainer initialMode="LOGIN" reason={reason} />;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
