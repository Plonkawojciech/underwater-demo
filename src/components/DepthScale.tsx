/* Sygnatura strony: skala głębokości = ścieżka kursów. Każdy znacznik to realne uprawnienie. */
export function DepthScale({ marks }: { marks: { depth: number; label: string }[] }) {
  const H = 380, W = 200, top = 16, max = 40
  const y = (d: number) => top + (d / max) * (H - top - 20)
  const ticks = Array.from({ length: max / 2 + 1 }, (_, i) => i * 2)
  return (
    <div className="depth" aria-label="Uprawnienia głębokościowe po kursach">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1="150" y1={y(0)} x2="150" y2={y(max)} stroke="#c7d6e2" strokeWidth="1.5" />
        {ticks.map((t) => <line key={t} x1={t % 10 === 0 ? 136 : 143} y1={y(t)} x2="150" y2={y(t)} stroke="#c7d6e2" strokeWidth="1" />)}
        {[0, 10, 20, 30, 40].map((t) => <text key={t} x="158" y={y(t) + 4}>{t} m</text>)}
        {marks.map((m) => (
          <g key={m.depth}>
            <circle cx="150" cy={y(m.depth)} r="4.5" fill="#F05A28" />
            <line x1="40" y1={y(m.depth)} x2="145" y2={y(m.depth)} stroke="#F05A28" strokeWidth="1" strokeDasharray="2 3" />
            <text x="128" y={y(m.depth) - 7} textAnchor="end" className="dl">{m.label}</text>
            <text x="128" y={y(m.depth) + 13} textAnchor="end" className="dc">do {m.depth} m</text>
          </g>
        ))}
        <text x="0" y={H - 2} className="dc">powierzchnia → głębokość</text>
      </svg>
    </div>
  )
}
