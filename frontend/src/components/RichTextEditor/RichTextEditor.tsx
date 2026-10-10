"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useId, useState } from "react";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import styles from "./RichTextEditor.module.scss";

interface RichTextEditorProps {
  label: string;
  /** HTML shown when the editor opens. A new key restarts the editor from another value. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Visual editor for formatted text (SPEC-019). Everything is stored as HTML, and the server
 * filters it again. "Comando" marks a snippet as inline code, which the voice reader (SPEC-018)
 * already says as a command.
 */
// What each button shows (the name is in its aria-label and its title), and where a new group of buttons starts.
const GLYPHS: Record<string, string> = {
  bold: "B",
  italic: "I",
  code: "</>",
  codeBlock: "{ }",
  heading: "H",
  bulletList: "•",
  orderedList: "1.",
  blockquote: "❝",
  link: "🔗",
  undo: "↶",
  redo: "↷",
};
const GROUP_STARTS = new Set(["code", "heading", "link", "undo"]);

export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder,
  invalid,
  describedBy,
}: RichTextEditorProps) {
  const t = authoringMessages.richText;
  const labelId = useId();
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
        link: { openOnClick: false },
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
        class: styles.content ?? "",
      },
    },
    onUpdate: ({ editor: current }) =>
      onChange(current.isEmpty ? "" : current.getHTML()),
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      code: e?.isActive("code") ?? false,
      codeBlock: e?.isActive("codeBlock") ?? false,
      heading: e?.isActive("heading", { level: 3 }) ?? false,
      bulletList: e?.isActive("bulletList") ?? false,
      orderedList: e?.isActive("orderedList") ?? false,
      blockquote: e?.isActive("blockquote") ?? false,
      link: e?.isActive("link") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  if (!editor) return <div className={styles.placeholder} aria-hidden="true" />;

  const run = (action: () => boolean) => () => {
    action();
    editor.commands.focus();
  };

  const buttons: {
    key: string;
    label: string;
    title?: string;
    pressed?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "bold",
      label: t.bold,
      pressed: active?.bold,
      onClick: run(() => editor.chain().toggleBold().run()),
    },
    {
      key: "italic",
      label: t.italic,
      pressed: active?.italic,
      onClick: run(() => editor.chain().toggleItalic().run()),
    },
    {
      key: "code",
      label: t.command,
      title: t.commandHelp,
      pressed: active?.code,
      onClick: run(() => editor.chain().toggleCode().run()),
    },
    {
      key: "codeBlock",
      label: t.codeBlock,
      pressed: active?.codeBlock,
      onClick: run(() => editor.chain().toggleCodeBlock().run()),
    },
    {
      key: "heading",
      label: t.heading,
      pressed: active?.heading,
      onClick: run(() => editor.chain().toggleHeading({ level: 3 }).run()),
    },
    {
      key: "bulletList",
      label: t.bulletList,
      pressed: active?.bulletList,
      onClick: run(() => editor.chain().toggleBulletList().run()),
    },
    {
      key: "orderedList",
      label: t.orderedList,
      pressed: active?.orderedList,
      onClick: run(() => editor.chain().toggleOrderedList().run()),
    },
    {
      key: "blockquote",
      label: t.quote,
      pressed: active?.blockquote,
      onClick: run(() => editor.chain().toggleBlockquote().run()),
    },
    {
      key: "link",
      label: t.link,
      pressed: active?.link,
      onClick: () => {
        setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
        setLinkOpen((open) => !open);
      },
    },
    {
      key: "undo",
      label: t.undo,
      disabled: !active?.canUndo,
      onClick: run(() => editor.chain().undo().run()),
    },
    {
      key: "redo",
      label: t.redo,
      disabled: !active?.canRedo,
      onClick: run(() => editor.chain().redo().run()),
    },
  ];

  const applyLink = () => {
    const href = url.trim();
    if (href)
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  };

  return (
    <div className={`${styles.editor} ${invalid ? styles.invalid : ""}`}>
      <span id={labelId} className={styles.srLabel}>
        {label}
      </span>
      <div role="toolbar" aria-label={t.toolbar} className={styles.toolbar}>
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`${styles.tool} ${styles[`tool${b.key[0]!.toUpperCase()}${b.key.slice(1)}`] ?? ""} ${GROUP_STARTS.has(b.key) ? styles.groupStart : ""}`}
            aria-label={b.label}
            aria-pressed={b.pressed === undefined ? undefined : b.pressed}
            title={b.title ?? b.label}
            disabled={b.disabled}
            onClick={b.onClick}
          >
            <span aria-hidden="true">{GLYPHS[b.key] ?? b.label}</span>
          </button>
        ))}
      </div>
      {linkOpen && (
        <div className={styles.linkRow}>
          <input
            type="url"
            className={styles.linkInput}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label={t.linkUrl}
            placeholder="https://"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          />
          <button type="button" className={styles.tool} onClick={applyLink}>
            {t.linkApply}
          </button>
          {active?.link && (
            <button
              type="button"
              className={styles.tool}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLinkOpen(false);
              }}
            >
              {t.linkRemove}
            </button>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
