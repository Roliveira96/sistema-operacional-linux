"use client";

import { useParams } from "next/navigation";
import { FooterPublic } from "@/components/FooterPublic/FooterPublic";
import { ModuleContentView } from "@/components/ModuleContentView/ModuleContentView";
import { NavbarPublic } from "@/components/NavbarPublic/NavbarPublic";
import styles from "./page.module.scss";

/** Public reading page of a module (SPEC-012). */
export default function MaterialPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className={styles.page}>
      <NavbarPublic />
      <main className={styles.main}>
        <ModuleContentView moduleId={id} backHref="/materials" />
      </main>
      <FooterPublic />
    </div>
  );
}
