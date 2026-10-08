"use client";

import { Suspense } from "react";
import { AuthContainer } from "@/components/AuthContainer/AuthContainer";

function RegisterContent() {
  return <AuthContainer initialMode="REGISTER" />;
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterContent />
    </Suspense>
  );
}
