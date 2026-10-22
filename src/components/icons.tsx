type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const Check = ({ size = 12, className }: P) => (
  <svg {...base(size)} strokeWidth={3} className={className}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const Chevron = ({ size = 14, className }: P) => (
  <svg {...base(size)} strokeWidth={2.4} className={`chev ${className ?? ""}`}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const Close = ({ size = 12, className }: P) => (
  <svg {...base(size)} strokeWidth={2.4} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const Alert = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 7.5v5.5M12 16.5v.01" strokeWidth={2.4} />
  </svg>
);

export const ArrowUp = ({ size = 16, className }: P) => (
  <svg {...base(size)} strokeWidth={2.6} className={className}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const Exclaim = ({ size = 12, className }: P) => (
  <svg {...base(size)} strokeWidth={3} className={className}>
    <path d="M12 6v8M12 18v.01" />
  </svg>
);

export const Calendar = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const Waves = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 8c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1M3 13c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1M3 18c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1" />
  </svg>
);

export const Scale = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 006 0zM18 8l-3 6a3 3 0 006 0z" />
  </svg>
);

/** Brand mark: a calendar dot pulled by a wave. */
export const Mark = ({ size = 22, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
    <rect x="1" y="1" width="22" height="22" rx="6.5" fill="currentColor" />
    <path d="M5 14.5c2-1.6 3.6-1.6 5.6 0s3.6 1.6 5.6 0 2.4-1.2 2.8-.9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
    <circle cx="12" cy="8.2" r="2" fill="#fff" />
  </svg>
);
