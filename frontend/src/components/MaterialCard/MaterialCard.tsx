import { Button } from "@/components/Button/Button";
import type { MaterialModule } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import styles from "./MaterialCard.module.scss";

export interface MaterialCardProps {
  module: MaterialModule;
  onExplore?: (slug: string) => void;
}

export function MaterialCard({ module, onExplore }: MaterialCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.topRow}>
        <span className={styles.levelBadge}>{module.level}</span>
        <span className={styles.lessonCount}>
          {messages.public.materials.lessonsLabel(module.lessonCount)}
        </span>
      </div>

      <h3 className={styles.title}>{module.title}</h3>
      <p className={styles.description}>{module.description}</p>

      {module.commandHighlights.length > 0 && (
        <div className={styles.commandsWrapper}>
          <span className={styles.commandsLabel}>Comandos:</span>
          <div className={styles.commandsList}>
            {module.commandHighlights.map((cmd) => (
              <code key={cmd} className={styles.commandTag}>
                {cmd}
              </code>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actionRow}>
        <Button
          variant="secondary"
          block
          className={styles.button}
          onClick={() => onExplore?.(module.slug)}
        >
          {messages.public.materials.explore}
        </Button>
      </div>
    </article>
  );
}
