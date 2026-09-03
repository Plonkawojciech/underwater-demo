export default function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <img src="/img/logo_under.png" alt="" width={44} height={54} />
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' }}>Underwater.pl</div>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6 }}>Panel zarządzania</div>
      </div>
    </div>
  )
}
