import styles from "./MetricCard.module.scss";

export interface MetricCardProps {
  value: string;
  label: string;
  description?: string;
}

export function MetricCard({ value, label, description }: MetricCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.value}>{value}</div>
      <div className={styles.label}>{label}</div>
      {description && <div className={styles.description}>{description}</div>}
    </div>
  );
}
