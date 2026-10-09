"use client";

import { useEffect, useState } from "react";
import { authService, type CurrentUser } from "@/services/authService";
import { getStudentProfile, type StudentProfileResponse } from "@/services/studentService";

/** Who is signed in, as the topic screen shows them (SPEC-016, CA-11). */
export interface Identity {
  name: string;
  /** Only students have an academic ID and a photo in their profile. */
  academicId?: string;
  avatarUrl?: string;
}

export interface IdentitySources {
  me(): Promise<Pick<CurrentUser, "name" | "email" | "role">>;
  studentProfile(): Promise<Pick<StudentProfileResponse, "name" | "academicId" | "avatarUrl">>;
}

const defaults: IdentitySources = { me: () => authService.me(), studentProfile: () => getStudentProfile() };

/**
 * Reads the session of the page, which is public: a visitor gets null and no error, and
 * undefined means the session is still being read. Students also load their profile for
 * the academic ID and the photo.
 */
export function useIdentity(sources: IdentitySources = defaults): Identity | null | undefined {
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const user = await sources.me();
        const base: Identity = { name: user.name || user.email };
        if (active) setIdentity(base);
        if (user.role !== "STUDENT") return;
        const profile = await sources.studentProfile().catch(() => null);
        if (active && profile) {
          setIdentity({ name: profile.name || base.name, academicId: profile.academicId || undefined, avatarUrl: profile.avatarUrl || undefined });
        }
      } catch {
        // No session: the page is public, so there is simply nobody to show.
        if (active) setIdentity(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [sources]);

  return identity;
}
