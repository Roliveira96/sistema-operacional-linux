"use client";
/* eslint-disable @next/next/no-img-element */

import React from "react";

export interface NoteMarkdownProps {
  markdown: string;
  className?: string;
  imageClassName?: string;
  codeClassName?: string;
  listClassName?: string;
}

const SAFE_NOTE_MEDIA_RE = /^\/api\/v1\/media\/notes\/[a-zA-Z0-9_-]+$/;

function renderInline(text: string, codeClassName?: string, imageClassName?: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches: ![alt](url) | `code` | ***bolditalic*** | **bold** | *italic*
  const tokenRe = /!\[([^\]]*)\]\(([^)]+)\)|`([^`]+)`|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const [, imgAlt, imgUrl, codeText, boldItalicText, boldText, italicText] = match;
    if (imgUrl !== undefined) {
      const trimmedUrl = imgUrl.trim();
      if (SAFE_NOTE_MEDIA_RE.test(trimmedUrl)) {
        nodes.push(
          <img
            key={`img-${key++}`}
            src={trimmedUrl}
            alt={imgAlt || "Captura"}
            loading="lazy"
            className={imageClassName}
          />,
        );
      }
    } else if (codeText !== undefined) {
      nodes.push(
        <code key={`code-${key++}`} className={codeClassName}>
          {codeText}
        </code>,
      );
    } else if (boldItalicText !== undefined) {
      nodes.push(
        <strong key={`bi-${key++}`}>
          <em>{boldItalicText}</em>
        </strong>,
      );
    } else if (boldText !== undefined) {
      nodes.push(<strong key={`b-${key++}`}>{boldText}</strong>);
    } else if (italicText !== undefined) {
      nodes.push(<em key={`i-${key++}`}>{italicText}</em>);
    }
    lastIndex = tokenRe.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/**
 * Renders the Markdown of a student note block using React elements only (never dangerouslySetInnerHTML),
 * allowing bold, italic, inline code, bullet lists, and authenticated proxy images `/api/v1/media/notes/{id}` (SPEC-071 CA-09).
 */
export function NoteMarkdown({ markdown, className, imageClassName, codeClassName, listClassName }: NoteMarkdownProps) {
  const rawLines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let blockKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={`ul-${blockKey++}`} className={listClassName}>
          {listItems}
        </ul>,
      );
      listItems = [];
    }
  };

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bulletMatch && bulletMatch[1]) {
      listItems.push(
        <li key={`li-${listItems.length}`}>{renderInline(bulletMatch[1], codeClassName, imageClassName)}</li>,
      );
      continue;
    }

    flushList();
    blocks.push(<p key={`p-${blockKey++}`}>{renderInline(rawLine, codeClassName, imageClassName)}</p>);
  }

  flushList();

  return <div className={className}>{blocks}</div>;
}
