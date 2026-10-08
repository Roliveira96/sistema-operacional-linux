import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle/ThemeToggle";
import { messages } from "@/messages/pt-BR";
import { themeInitScript } from "@/theme/theme";
import "@/styles/globals.scss";
import styles from "./layout.module.scss";

export const metadata: Metadata = {
  title: messages.app.name,
  description: messages.app.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline script sets data-theme before hydration, hence the warning suppression.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <header className={styles.header}>
          <div className={styles.inner}>
            <span className={styles.brand}>{messages.app.name}</span>
            <ThemeToggle />
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </body>
    </html>
  );
}
