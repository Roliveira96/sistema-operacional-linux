"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EngineConformance } from "@/components/EngineConformance/EngineConformance";
import { useAuth } from "@/hooks/useAuth";

/** Engine conformance (SPEC-030): only the administrator; anyone else goes back to the start, and the verification never runs for them (RN-09). */
export default function ConformancePage() {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user.role === "ADMIN";

  useEffect(() => {
    if (!isAdmin) router.replace("/app");
  }, [isAdmin, router]);

  return isAdmin ? <EngineConformance /> : null;
}
