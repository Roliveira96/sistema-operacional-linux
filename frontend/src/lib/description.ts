// The description of a module is formatted text, stored as filtered html (SPEC-010 RN-12). The
// cards, the materials page and the study screen show it as plain text, so the layout and the
// "commands — summary" tags keep working (SPEC-019 CA-17).

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

/** The visible text of a description, with the spaces collapsed. Plain text comes back as it is. */
export function descriptionText(description: string): string {
  return description
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The html the visual editor opens with. A description stored as plain text (everything loaded
 * from the prototype) becomes one paragraph per line; html is left as it is.
 */
export function descriptionHtml(description: string): string {
  if (/<\/?[a-z][^>]*>/i.test(description)) return description;
  return description
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => `<p>${escapeText(line.trim())}</p>`)
    .join("");
}
