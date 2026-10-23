"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value (0 on first mount) to `value`.
 * Respects prefers-reduced-motion, and always settles on the exact value.
 */
export function CountUp({ value, decimals = 2, duration = 900, delay = 0 }: { value: number; decimals?: number; duration?: number; delay?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const k = Math.min(1, Math.max(0, (t - t0 - delay) / duration));
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(reduce ? value : start + (value - start) * eased);
      if (k < 1 && !reduce) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, duration, delay]);

  return <span className="num">{shown.toFixed(decimals)}</span>;
}
