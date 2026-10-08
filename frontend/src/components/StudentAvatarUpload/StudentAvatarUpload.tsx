"use client";

import { useRef, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { uploadAvatar } from "@/services/studentService";
import styles from "./StudentAvatarUpload.module.scss";

export interface StudentAvatarUploadProps {
  currentAvatarUrl?: string;
  studentName?: string;
  onAvatarUpdated?: (newUrl: string) => void;
}

export function StudentAvatarUpload({
  currentAvatarUrl,
  studentName = "A",
  onAvatarUpdated,
}: StudentAvatarUploadProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(currentAvatarUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setFeedback(null);

    // Validate size (máx 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setFeedback({
        type: "error",
        message: "O tamanho da imagem excede o limite de 2MB.",
      });
      return;
    }

    // Validate format (jpeg, png, webp)
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setFeedback({
        type: "error",
        message: "Formato inválido. Use JPEG, PNG ou WebP.",
      });
      return;
    }

    setIsUploading(true);
    try {
      const res = await uploadAvatar(file);
      setAvatarUrl(res.avatarUrl);
      setFeedback({
        type: "success",
        message: messages.students.profile.uploadSuccess,
      });
      onAvatarUpdated?.(res.avatarUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({
        type: "error",
        message: msg || messages.students.profile.uploadError,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const initials = studentName.substring(0, 2).toUpperCase();

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>{messages.students.profile.avatarTitle}</h3>

      <div className={styles.avatarSection}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="Avatar" className={styles.avatar} />
        ) : (
          <div className={styles.placeholder}>{initials}</div>
        )}

        <div className={styles.actions}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.fileInput}
            onChange={(e) => void handleFileChange(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            className={styles.uploadBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading
              ? messages.students.profile.uploading
              : messages.students.profile.uploadAvatar}
          </button>
          <span className={styles.helpText}>{messages.students.profile.avatarHelp}</span>
        </div>
      </div>

      {feedback && (
        <div
          className={feedback.type === "success" ? styles.successBox : styles.errorBox}
          role="status"
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
