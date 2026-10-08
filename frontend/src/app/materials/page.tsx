"use client";

import { FooterPublic } from "@/components/FooterPublic/FooterPublic";
import { MaterialCard } from "@/components/MaterialCard/MaterialCard";
import { NavbarPublic } from "@/components/NavbarPublic/NavbarPublic";
import { mockMaterialModules } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import styles from "./page.module.scss";

export default function MaterialsPage() {
  return (
    <div className={styles.page}>
      <NavbarPublic />

      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1>{messages.public.materials.title}</h1>
            <p>{messages.public.materials.subtitle}</p>
          </header>

          <div className={styles.grid}>
            {mockMaterialModules.map((mod) => (
              <MaterialCard key={mod.id} module={mod} />
            ))}
          </div>
        </div>
      </main>

      <FooterPublic />
    </div>
  );
}
