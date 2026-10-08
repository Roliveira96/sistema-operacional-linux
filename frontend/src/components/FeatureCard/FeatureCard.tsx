import type { ReactNode } from "react";
import styles from "./FeatureCard.module.scss";

export interface FeatureCardProps {
  title: string;
  description: string;
  icon?: ReactNode;
  badge?: string;
}

export function FeatureCard({ title, description, icon, badge }: FeatureCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.header}>
        {icon && <div className={styles.iconContainer}>{icon}</div>}
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
    </article>
  );
}
