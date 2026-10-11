"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthContainer } from "@/components/AuthContainer/AuthContainer";

function LoginContent() {
  const params = useSearchParams();
  return <AuthContainer initialMode="LOGIN" reason={params.get("reason")} next={params.get("next")} />;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
