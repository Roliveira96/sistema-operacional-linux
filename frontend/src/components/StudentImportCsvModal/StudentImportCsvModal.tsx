"use client";

import { useRef, useState } from "react";
import { messages } from "@/messages/pt-BR";
import {
  importStudentsCSV,
  type CSVImportResult,
} from "@/services/studentService";
import styles from "./StudentImportCsvModal.module.scss";

export interface StudentImportCsvModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  availableClasses?: Array<{ id: string; name: string }>;
  defaultClassId?: string;
}

export function StudentImportCsvModal({
  isOpen,
  onClose,
  onSuccess,
  availableClasses = [],
  defaultClassId = "",
}: StudentImportCsvModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [classGroupId, setClassGroupId] = useState(defaultClassId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (file: File | null) => {
    setErrorMessage(null);
    setImportResult(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrorMessage(messages.students.importModal.invalidFileType);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMessage(messages.students.importModal.fileRequired);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const res = await importStudentsCSV(selectedFile, classGroupId || undefined);
      setImportResult(res);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "Erro ao processar o arquivo CSV.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setImportResult(null);
    setErrorMessage(null);
    onClose();
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 id="import-title" className={styles.title}>
            {messages.students.importModal.title}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleClose}
            aria-label="Fechar janela"
          >
            &times;
          </button>
        </div>

        <div className={styles.body}>
          {!importResult && (
            <div className={styles.instructionsBox}>
              {messages.students.importModal.instructions}
            </div>
          )}

          {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

          {importResult ? (
            <div className={styles.reportContainer}>
              <div className={styles.reportSuccess}>
                {messages.students.importModal.successSummary}
              </div>

              <div className={styles.reportStats}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>
                    {messages.students.importModal.report.totalRows}
                  </span>
                  <span className={styles.statValue}>{importResult.totalRows}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>
                    {messages.students.importModal.report.created}
                  </span>
                  <span className={styles.statValue}>{importResult.created}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>
                    {messages.students.importModal.report.enrolled}
                  </span>
                  <span className={styles.statValue}>{importResult.enrolled}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>
                    {messages.students.importModal.report.alreadyEnrolled}
                  </span>
                  <span className={styles.statValue}>{importResult.alreadyEnrolled}</span>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className={styles.errorsList}>
                  <div className={styles.errorsTitle}>
                    {`${messages.students.importModal.report.errorsCount} (${importResult.errors.length})`}
                  </div>
                  {importResult.errors.map((err) => (
                    <div key={err.line} className={styles.errorItem}>
                      {messages.students.importModal.report.errorLine(err.line, err.reason)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <form id="csv-form" onSubmit={(e) => void handleSubmit(e)}>
              <div
                className={`${styles.dropArea} ${isDragActive ? styles.dragActive : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className={styles.fileInput}
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                />
                {selectedFile ? (
                  <div className={styles.selectedFileName}>
                    {messages.students.importModal.selectedFile(selectedFile.name)}
                  </div>
                ) : (
                  <div className={styles.dropText}>
                    {messages.students.importModal.dragDropArea}
                  </div>
                )}
              </div>

              <div className={styles.field} style={{ marginTop: "1rem" }}>
                <label htmlFor="csv-class-select" className={styles.label}>
                  {messages.students.importModal.classGroupLabel}
                </label>
                <select
                  id="csv-class-select"
                  className={styles.select}
                  value={classGroupId}
                  onChange={(e) => setClassGroupId(e.target.value)}
                >
                  <option value="">{messages.students.importModal.noClassOption}</option>
                  {availableClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
              </div>
            </form>
          )}
        </div>

        <div className={styles.footer}>
          {importResult ? (
            <button type="button" className={styles.submitBtn} onClick={handleClose}>
              {messages.students.importModal.close}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={handleClose}
                disabled={isSubmitting}
              >
                {messages.students.importModal.cancel}
              </button>
              <button
                type="submit"
                form="csv-form"
                className={styles.submitBtn}
                disabled={isSubmitting || !selectedFile}
              >
                {isSubmitting
                  ? messages.students.importModal.submitting
                  : messages.students.importModal.submit}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
