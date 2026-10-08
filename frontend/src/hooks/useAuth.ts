"use client";

import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "@/components/AuthProvider/AuthProvider";

/** Returns the signed-in user and session actions. Must be used under AuthProvider. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
