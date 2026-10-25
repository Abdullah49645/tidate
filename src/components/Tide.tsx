/**
 * The signature tide: three layered swells drifting at different speeds
 * behind the command bar. Each path repeats every 720px across a 2880px strip,
 * so translating it by -1440px loops seamlessly. Purely decorative.
 */
function swell(amp: number, base: number, period = 720, width = 2880) {
  let d = `M 0 ${base}`;
  for (let x = 0; x < width; x += period) {
    const q = period / 4;
    d += ` C ${x + q} ${base - amp}, ${x + q} ${base - amp}, ${x + 2 * q} ${base}`;
    d += ` S ${x + 3 * q} ${base + amp}, ${x + period} ${base}`;
  }
  return `${d} L ${width} 220 L 0 220 Z`;
}

const LAYERS = [
  { amp: 14, base: 92, cls: "tide-a" },
  { amp: 18, base: 112, cls: "tide-b" },
  { amp: 11, base: 138, cls: "tide-c" },
];

export function Tide() {
  return (
    <div className="tide" aria-hidden>
      {LAYERS.map((l) => (
        <svg key={l.cls} className={`tide-layer ${l.cls}`} viewBox="0 0 2880 220" preserveAspectRatio="none">
          <path d={swell(l.amp, l.base)} />
        </svg>
      ))}
    </div>
  );
}
