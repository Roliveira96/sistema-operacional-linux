"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoogleAuthButton } from "@/components/GoogleAuthButton/GoogleAuthButton";
import { LoginForm } from "@/components/LoginForm/LoginForm";
import { RegisterForm } from "@/components/RegisterForm/RegisterForm";
import { messages } from "@/messages/pt-BR";
import { authService as defaultAuthService, type AuthService, type LoginResult, type RegisterResult } from "@/services/authService";
import styles from "./AuthContainer.module.scss";

export type AuthMode = "LOGIN" | "REGISTER";

export interface AuthContainerProps {
  initialMode?: AuthMode;
  reason?: string | null;
  onLoginSuccess?: (result: LoginResult) => void;
  onRegisterSuccess?: (result: RegisterResult) => void;
  service?: AuthService;
}

/** Unified authentication and registration dual-panel container (SPEC-008). */
export function AuthContainer({
  initialMode = "LOGIN",
  reason,
  onLoginSuccess,
  onRegisterSuccess,
  service = defaultAuthService,
}: AuthContainerProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);

  function handleLoginSuccess(result: LoginResult) {
    if (onLoginSuccess) {
      onLoginSuccess(result);
      return;
    }
    router.replace(result.mustChangePassword ? "/change-password" : "/app");
  }

  function handleRegisterSuccess(result: RegisterResult) {
    if (onRegisterSuccess) {
      onRegisterSuccess(result);
      return;
    }
    router.replace("/app");
  }

  function switchMode(newMode: AuthMode) {
    setMode(newMode);
    if (typeof window !== "undefined") {
      const url = newMode === "LOGIN" ? "/login" : "/register";
      window.history.replaceState(null, "", url);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        {/* Institutional presentation panel */}
        <div className={styles.brandPanel}>
          <div className={styles.badge}>UTFPR • Guarapuava</div>
          <h1 className={styles.brandTitle}>{messages.auth.unified.brandTitle}</h1>
          <p className={styles.brandSubtitle}>{messages.auth.unified.brandSubtitle}</p>

          <div className={styles.terminalBox} aria-hidden="true">
            <div className={styles.terminalHeader}>
              <span className={styles.terminalDot} />
              <span className={styles.terminalDot} />
              <span className={styles.terminalDot} />
              <span className={styles.terminalTitle}>bash — 80x24</span>
            </div>
            <pre className={styles.terminalBody}>
              <code>
                <span className={styles.prompt}>$</span> uname -srm{"\n"}
                <span className={styles.output}>Linux 6.8.0 x86_64</span>{"\n"}
                <span className={styles.prompt}>$</span> gcc -Wall -O2 lab_fork.c -o lab{"\n"}
                <span className={styles.prompt}>$</span> ./lab{"\n"}
                <span className={styles.output}>[PID 1024] processo pronto.</span>
              </code>
            </pre>
          </div>
        </div>

        {/* Dynamic interactive form panel */}
        <div className={styles.formPanel}>
          {/* Segmented tab switch */}
          <div className={styles.tabList} role="tablist" aria-label="Modo de autenticação">
            <button
              type="button"
              role="tab"
              id="tab-login"
              aria-selected={mode === "LOGIN"}
              aria-controls="panel-login"
              className={`${styles.tab} ${mode === "LOGIN" ? styles.tabActive : ""}`}
              onClick={() => switchMode("LOGIN")}
            >
              {messages.auth.login.title}
            </button>
            <button
              type="button"
              role="tab"
              id="tab-register"
              aria-selected={mode === "REGISTER"}
              aria-controls="panel-register"
              className={`${styles.tab} ${mode === "REGISTER" ? styles.tabActive : ""}`}
              onClick={() => switchMode("REGISTER")}
            >
              {messages.auth.register.title}
            </button>
          </div>

          {/* Social login action */}
          <div className={styles.socialSection}>
            <GoogleAuthButton />
          </div>

          <div className={styles.divider}>
            <span className={styles.dividerText}>{messages.auth.unified.orDivider}</span>
          </div>

          {/* Animated active form */}
          <div
            className={styles.formView}
            role="tabpanel"
            id={mode === "LOGIN" ? "panel-login" : "panel-register"}
            aria-labelledby={mode === "LOGIN" ? "tab-login" : "tab-register"}
            key={mode}
          >
            {mode === "LOGIN" ? (
              <LoginForm
                embed
                reason={reason}
                service={service}
                onSuccess={handleLoginSuccess}
                onSwitchToRegister={() => switchMode("REGISTER")}
              />
            ) : (
              <RegisterForm
                service={service}
                onSuccess={handleRegisterSuccess}
                onSwitchToLogin={() => switchMode("LOGIN")}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
