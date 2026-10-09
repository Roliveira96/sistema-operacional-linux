import type { Metadata } from "next";
import { Inter, Ubuntu_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { messages } from "@/messages/pt-BR";
import "@/styles/globals.scss";
import styles from "./layout.module.scss";

// SPEC-015: the prototype fonts, self-hosted by next/font (no runtime request to Google).
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });
const ubuntuMono = Ubuntu_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-ubuntu-mono", display: "swap" });

export const metadata: Metadata = {
  title: messages.app.name,
  description: messages.app.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${ubuntuMono.variable}`}>
      <body>
        <main className={styles.main}>{children}</main>
      </body>
    </html>
  );
}
