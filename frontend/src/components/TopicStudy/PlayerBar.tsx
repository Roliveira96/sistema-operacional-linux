"use client";

import type { TopicPlayer } from "@/hooks/useTopicPlayer";
import { TYPING_SPEED, VOICE_SPEED } from "@/lib/machineStorage";
import { cardOfStep, type TopicScript } from "@/lib/topicScript";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./PlayerBar.module.scss";

const m = contentMessages.topic.player;

export interface PlayerBarProps {
  script: TopicScript;
  player: TopicPlayer;
  /** Reading speed of the voice, 0.5x to 2x (SPEC-018, RF-07). */
  voiceSpeed: number;
  onVoiceSpeed(speed: number): void;
}

interface SpeedSliderProps {
  label: string;
  title: string;
  range: { min: number; max: number; step: number };
  value: number;
  onChange(value: number): void;
}

/** One of the two speed controls: a short label, a slider and the value. */
function SpeedSlider({ label, title, range, value, onChange }: SpeedSliderProps) {
  return (
    <label className={styles.slider} title={title}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        className={styles.range}
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={title}
        aria-valuetext={m.speedValue(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className={styles.sliderValue}>{m.speedValue(value)}</output>
    </label>
  );
}

/** The reader of the header: back, play, next, progress and typing speed (SPEC-016). */
export function PlayerBar({ script, player, voiceSpeed, onVoiceSpeed }: PlayerBarProps) {
  const total = script.steps.length;
  const target = player.running ?? player.index + 1;
  const cardIndex = cardOfStep(script.cards, target);
  const card = script.cards[cardIndex];
  const step = script.steps[target];
  const playingAll = player.playing && player.playingCard === null;

  const cardText = card
    ? (player.running !== null ? m.runningCard : m.nextCard)(cardIndex + 1, script.cards.length, card.label, card.title)
    : m.finished;

  return (
    <div className={styles.player} role="group" aria-label={m.label}>
      <button type="button" className={styles.button} onClick={() => void player.back()} disabled={player.index < 0} title={m.back} aria-label={m.back}>
        ⏮
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.play}`}
        onClick={player.toggleAll}
        title={playingAll ? m.pause : m.play}
        aria-label={playingAll ? m.pause : m.play}
        aria-pressed={playingAll}
      >
        {playingAll ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => void player.next()}
        disabled={player.index + 1 >= total}
        title={m.next}
        aria-label={m.next}
      >
        ⏭
      </button>
      <div className={styles.info}>
        <div className={styles.line}>
          <span className={styles.card}>{cardText}</span>
          <span className={styles.counter}>
            {player.index + 1}/{total}
          </span>
        </div>
        <span className={styles.command}>{step ? m.command(step.command) : m.restart}</span>
        <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={player.index + 1}>
          <div className={styles.progress} style={{ width: `${total ? ((player.index + 1) / total) * 100 : 0}%` }} />
        </div>
      </div>
      <div className={styles.sliders}>
        <SpeedSlider label={m.voiceSpeedLabel} title={m.voiceSpeed} range={VOICE_SPEED} value={voiceSpeed} onChange={onVoiceSpeed} />
        <SpeedSlider label={m.typingSpeedLabel} title={m.typingSpeed} range={TYPING_SPEED} value={player.speed} onChange={player.setSpeed} />
      </div>
    </div>
  );
}
