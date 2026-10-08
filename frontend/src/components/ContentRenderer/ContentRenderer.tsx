import type { ComponentType } from "react";
import type { ContentBlock } from "@/services/contentService";
import {
  CardsBlock,
  CommandBlock,
  CuriosityBlock,
  LegacyHtmlBlock,
  StepByStepBlock,
  TextBlock,
  TipBlock,
  UnknownBlock,
  WidgetBlock,
} from "./blocks";
import styles from "./ContentRenderer.module.scss";

const COMPONENTS: Record<string, ComponentType<{ payload: Record<string, unknown> }>> = {
  TEXT: TextBlock,
  COMMAND: CommandBlock,
  TIP: TipBlock,
  CURIOSITY: CuriosityBlock,
  STEP_BY_STEP: StepByStepBlock,
  CARDS: CardsBlock,
  WIDGET: WidgetBlock,
  LEGACY_HTML: LegacyHtmlBlock,
};

/** Renders a module's blocks in order; unknown types do not break the page (SPEC-012 CA-09). */
export function ContentRenderer({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className={styles.renderer}>
      {[...blocks]
        .sort((a, b) => a.position - b.position)
        .map((block) => {
          const Component = COMPONENTS[block.type];
          return (
            <div key={block.id} className={styles.block} data-block-type={block.type}>
              {Component ? <Component payload={block.payload ?? {}} /> : <UnknownBlock />}
            </div>
          );
        })}
    </div>
  );
}
