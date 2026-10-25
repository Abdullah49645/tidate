"use client";

import { useId } from "react";

/** Wave with a 16-unit period across a 64-unit strip, so shifting it by 16 loops seamlessly. */
function wave(level: number, amp: number) {
  let d = `M -8 ${level}`;
  for (let x = -8; x < 56; x += 16) {
    d += ` C ${x + 4} ${level - amp}, ${x + 4} ${level - amp}, ${x + 8} ${level}`;
    d += ` S ${x + 12} ${level + amp}, ${x + 16} ${level}`;
  }
  return `${d} V 34 H -8 Z`;
}

/**
 * The Tidate mark: a desk-calendar leaf holding a small tide, with the moon that
 * moves it. On load the water rises into the leaf and the moon comes up; after
 * that two swells drift at different speeds. Hovering the brand lifts the tide.
 * Everything holds still under prefers-reduced-motion.
 */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <clipPath id={`${id}-body`}>
          <path d="M3 10 H29 V23 a6 6 0 0 1 -6 6 H9 a6 6 0 0 1 -6 -6 Z" />
        </clipPath>
      </defs>
      <rect className="lg-leaf" x="3" y="4" width="26" height="25" rx="6" />
      <g clipPath={`url(#${id}-body)`}>
        <circle className="lg-moon" cx="21.5" cy="15.2" r="2.3" />
        <g className="lg-water">
          <path className="lg-swell lg-back" d={wave(20.6, 1.5)} />
          <path className="lg-swell lg-front" d={wave(22.4, 1.7)} />
        </g>
      </g>
      <path className="lg-band" d="M3 10.5 V10 a6 6 0 0 1 6 -6 H23 a6 6 0 0 1 6 6 v0.5 Z" />
      <rect className="lg-ring" x="9.6" y="1.6" width="2.4" height="5" rx="1.2" />
      <rect className="lg-ring" x="20" y="1.6" width="2.4" height="5" rx="1.2" />
      <rect className="lg-edge" x="3" y="4" width="26" height="25" rx="6" />
    </svg>
  );
}

/** Mark plus wordmark. "Ti" and "date" are set apart so the name reads as tide + date. */
export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="wordmark" aria-label="Tidate">
        <span className="wm-ti" aria-hidden>
          Ti
        </span>
        <span className="wm-date" aria-hidden>
          date
        </span>
      </span>
    </span>
  );
}
