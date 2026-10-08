"use client";

import { useState } from "react";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./PermissionCalculator.module.scss";

const WHO = ["u", "g", "o"] as const;
const BITS = [4, 2, 1] as const;
const LETTERS = ["r", "w", "x"] as const;

/** Converts checkboxes to octal and symbolic notation, like the legacy widget. */
export function PermissionCalculator() {
  const m = contentMessages.calculator;
  // Initial state of the legacy widget: 754 (rwxr-xr--).
  const [digits, setDigits] = useState<number[]>([7, 5, 4]);
  const [typed, setTyped] = useState("754");

  const octal = digits.join("");
  const symbolic = "-" + digits.map((d) => BITS.map((b, i) => (d & b ? LETTERS[i] : "-")).join("")).join("");

  function toggle(who: number, bit: number) {
    const next = digits.map((d, i) => (i === who ? d ^ bit : d));
    setDigits(next);
    setTyped(next.join(""));
  }

  function type(value: string) {
    setTyped(value);
    if (/^[0-7]{3}$/.test(value)) setDigits(value.split("").map(Number));
  }

  return (
    <div className={styles.calculator}>
      <p className={styles.title}>🧮 {m.title}</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            {m.bits.map(([letter, value, label]) => (
              <th key={letter} scope="col">
                {letter} = {value}
                <br />
                <small>{label}</small>
              </th>
            ))}
            <th scope="col">{m.sum}</th>
          </tr>
        </thead>
        <tbody>
          {WHO.map((who, row) => (
            <tr key={who}>
              <th scope="row">{m.who[who]}</th>
              {BITS.map((bit, i) => (
                <td key={bit}>
                  <label className={styles.bit}>
                    <input
                      type="checkbox"
                      checked={(digits[row]! & bit) !== 0}
                      onChange={() => toggle(row, bit)}
                      aria-label={`${m.who[who]} ${LETTERS[i]}`}
                    />
                    <span>{LETTERS[i]}</span>
                  </label>
                </td>
              ))}
              <td className={styles.sum} data-testid={`sum-${who}`}>
                {digits[row]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.result}>
        <label>
          {m.octal}{" "}
          <input
            className={styles.octal}
            value={typed}
            maxLength={3}
            inputMode="numeric"
            spellCheck={false}
            onChange={(e) => type(e.target.value)}
          />
        </label>
        <code data-testid="symbolic">{symbolic}</code>
        <code data-testid="command">{m.command(octal)}</code>
      </div>
    </div>
  );
}
