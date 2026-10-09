// src/components/journal/SubmitCelebration.jsx
import { useEffect, useMemo } from "react";

/**
 * One-shot celebration shown after a journal is submitted successfully.
 *
 * Deliberately restrained and cheap: a fixed overlay holding a handful of emoji
 * that rise and fade, plus a short message. No canvas, no animation library and
 * no looping, so it stays professional and costs almost nothing on a phone.
 *
 * It is presentational only — it reports how long the caller should wait before
 * clearing it, and never touches submission state itself.
 */

// Drift and spin per emoji so the burst does not look like a single block
// moving in lockstep.
const CONFETTI = [
  { emoji: "🎉", drift: -56, spin: -18, delay: 0, size: "text-2xl" },
  { emoji: "✨", drift: 34, spin: 24, delay: 70, size: "text-xl" },
  { emoji: "🔥", drift: 4, spin: -12, delay: 40, size: "text-lg" },
  { emoji: "✨", drift: 66, spin: 32, delay: 130, size: "text-base" },
  { emoji: "🎉", drift: -30, spin: -26, delay: 160, size: "text-lg" },
];

/** How long the celebration stays on screen, in ms. */
export const CELEBRATION_MS = 1600;

export default function SubmitCelebration({ show, onDone, message }) {
  // Stable across renders so the animation is not restarted mid-flight.
  const particles = useMemo(() => CONFETTI, []);

  useEffect(() => {
    if (!show) return undefined;
    const timer = setTimeout(onDone, CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [show, onDone]);

  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center"
      // Purely decorative and announced politely rather than interrupting.
      aria-hidden="true">
      {/* Emoji burst */}
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
        {particles.map((p, i) => (
          <span
            key={i}
            className={`ims-celebrate-fx absolute select-none ${p.size}`}
            style={{
              animation: `ims-confetti-rise 1.25s ease-out ${p.delay}ms both`,
              "--ims-drift": `${p.drift}px`,
              "--ims-spin": `${p.spin}deg`,
            }}>
            {p.emoji}
          </span>
        ))}
      </div>

      {/* Success message */}
      <div
        role="status"
        aria-live="polite"
        className="ims-celebrate-fx relative mx-4 max-w-sm rounded-2xl border border-brand-100 bg-white/95 px-5 py-4 text-center shadow-xl backdrop-blur-sm"
        style={{ animation: "ims-celebrate-in 0.32s ease-out both" }}>
        <p className="text-lg font-bold text-brand-700">Journal Submitted!</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{message}</p>
      </div>
    </div>
  );
}
