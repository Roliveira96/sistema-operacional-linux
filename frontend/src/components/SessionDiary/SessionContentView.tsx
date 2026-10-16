import Link from "next/link";
import { messages } from "@/messages/pt-BR";
import type { SessionContent } from "@/services/scheduleService";
import styles from "./SessionDiary.module.scss";

/** Whether the content has anything to show besides the notes of the teacher. */
export function hasContentToShow(content: SessionContent): boolean {
  return Boolean(content.topic || content.description || content.links.length > 0 || content.module || content.deck);
}

/** What a lesson covers: topic, description, links, module and presentation, for whoever reads the lesson (SPEC-053, 3.1). */
export function SessionContentView({ content }: { content: SessionContent }) {
  return (
    <div className={styles.content}>
      {content.topic && <h4 className={styles.contentTopic}>{content.topic}</h4>}
      {content.description && (
        // HTML filtered by the server when it was saved (SPEC-053 RN-01).
        <div className={styles.contentText} dangerouslySetInnerHTML={{ __html: content.description }} />
      )}
      {content.links.length > 0 && (
        <ul className={styles.contentLinks}>
          {content.links.map((link) => (
            <li key={`${link.url}-${link.name}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {content.module && <Link href={`/app/modules/${content.module.id}`}>{content.module.title}</Link>}
      {content.deck && (
        <a href={content.deck.downloadUrl} target="_blank" rel="noopener noreferrer">
          {messages.schedule.calendar.viewDeck}
        </a>
      )}
    </div>
  );
}
