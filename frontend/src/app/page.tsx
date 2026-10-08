"use client";

import { useRouter } from "next/navigation";
import { FeatureCard } from "@/components/FeatureCard/FeatureCard";
import { FooterPublic } from "@/components/FooterPublic/FooterPublic";
import { HeroSection } from "@/components/HeroSection/HeroSection";
import { MetricCard } from "@/components/MetricCard/MetricCard";
import { NavbarPublic } from "@/components/NavbarPublic/NavbarPublic";
import { mockPlatformMetrics, mockPlatformPillars } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import styles from "./page.module.scss";

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className={styles.page}>
      <NavbarPublic />

      <main className={styles.main}>
        <HeroSection
          onPrimaryClick={() => router.push("/materials")}
          onSecondaryClick={() => router.push("/simulations")}
        />

        <section className={styles.featuresSection} aria-labelledby="features-heading">
          <div className={styles.container}>
            <header className={styles.sectionHeader}>
              <h2 id="features-heading">{messages.public.features.title}</h2>
              <p>{messages.public.features.subtitle}</p>
            </header>

            <div className={styles.featuresGrid}>
              {mockPlatformPillars.map((pillar) => (
                <FeatureCard
                  key={pillar.id}
                  title={pillar.title}
                  description={pillar.description}
                  badge="UTFPR"
                />
              ))}
            </div>
          </div>
        </section>

        <section className={styles.metricsSection} aria-labelledby="metrics-heading">
          <div className={styles.container}>
            <header className={styles.sectionHeader}>
              <h2 id="metrics-heading">{messages.public.metrics.title}</h2>
              <p>{messages.public.metrics.subtitle}</p>
            </header>

            <div className={styles.metricsGrid}>
              {mockPlatformMetrics.map((metric) => (
                <MetricCard
                  key={metric.id}
                  value={metric.value}
                  label={metric.label}
                  description={metric.description}
                />
              ))}
            </div>
          </div>
        </section>
      </main>

      <FooterPublic />
    </div>
  );
}
