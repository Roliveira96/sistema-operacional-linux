"use client";

import { FooterPublic } from "@/components/FooterPublic/FooterPublic";
import { NavbarPublic } from "@/components/NavbarPublic/NavbarPublic";
import { SimulationCard } from "@/components/SimulationCard/SimulationCard";
import { mockSimulationModes } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import styles from "./page.module.scss";

export default function SimulationsPage() {
  return (
    <div className={styles.page}>
      <NavbarPublic />

      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1>{messages.public.simulations.title}</h1>
            <p>{messages.public.simulations.subtitle}</p>
          </header>

          <div className={styles.grid}>
            {mockSimulationModes.map((sim) => (
              <SimulationCard key={sim.id} simulation={sim} />
            ))}
          </div>
        </div>
      </main>

      <FooterPublic />
    </div>
  );
}
