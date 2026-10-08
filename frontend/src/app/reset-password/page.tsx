"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/ResetPasswordForm/ResetPasswordForm";

function ResetContent() {
  return <ResetPasswordForm token={useSearchParams().get("token")} />;
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetContent />
    </Suspense>
  );
}
