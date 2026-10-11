"use client";

import { useEffect, useRef, useState } from "react";
import { contentMessages } from "@/messages/content.pt-BR";
import { ImageLightbox, type LightboxImage } from "./ImageLightbox";

const m = contentMessages.gallery;

/**
 * The html of a block, as the server filtered it. The pictures of a gallery (SPEC-025 rev. 2) can be opened larger: by click, or by
 * keyboard, since the html itself cannot say that they are buttons.
 */
export function GalleryHtml({ html, className }: { html: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLImageElement | null>(null);
  const [open, setOpen] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  // The pictures of a gallery are reachable by keyboard and announced as buttons.
  useEffect(() => {
    root.current?.querySelectorAll<HTMLImageElement>(".md-gallery img").forEach((img) => {
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", m.open(img.alt || m.noCaption));
    });
  }, [html]);

  const show = (img: HTMLImageElement) => {
    const gallery = img.closest(".md-gallery");
    if (!gallery) return;
    const all = [...gallery.querySelectorAll<HTMLImageElement>("img")];
    opener.current = img;
    setOpen({
      index: Math.max(0, all.indexOf(img)),
      images: all.map((i) => ({ src: i.currentSrc || i.src, caption: i.closest("figure")?.querySelector("figcaption")?.textContent ?? i.alt })),
    });
  };

  return (
    <>
      <div
        ref={root}
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => e.target instanceof HTMLImageElement && show(e.target)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target instanceof HTMLImageElement && e.target.closest(".md-gallery")) {
            e.preventDefault();
            show(e.target);
          }
        }}
      />
      {open && (
        <ImageLightbox
          images={open.images}
          start={open.index}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
}
