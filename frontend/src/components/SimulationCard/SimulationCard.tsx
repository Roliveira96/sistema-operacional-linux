import { Button } from "@/components/Button/Button";
import type { SimulationMode } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import styles from "./SimulationCard.module.scss";

export interface SimulationCardProps {
  simulation: SimulationMode;
  onStart?: (slug: string) => void;
}

export function SimulationCard({ simulation, onStart }: SimulationCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.topRow}>
        <span className={styles.badge}>{simulation.difficulty}</span>
        <div className={styles.metaGroup}>
          <span className={styles.metaItem}>
            ⏱️ {messages.public.simulations.durationLabel(simulation.durationMinutes)}
          </span>
          <span className={styles.metaDivider}>•</span>
          <span className={styles.metaItem}>
            📝 {messages.public.simulations.questionsLabel(simulation.questionCount)}
          </span>
        </div>
      </div>

      <h3 className={styles.title}>{simulation.title}</h3>
      <p className={styles.description}>{simulation.description}</p>

      {simulation.topicsCovered.length > 0 && (
        <div className={styles.topicsWrapper}>
          <span className={styles.topicsLabel}>Tópicos avaliados:</span>
          <ul className={styles.topicsList}>
            {simulation.topicsCovered.map((topic) => (
              <li key={topic} className={styles.topicItem}>
                {topic}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.actionRow}>
        <Button
          variant="primary"
          block
          className={styles.button}
          onClick={() => onStart?.(simulation.slug)}
        >
          {messages.public.simulations.start}
        </Button>
      </div>
    </article>
  );
}
