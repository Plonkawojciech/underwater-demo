export function runtimeOrigin(env: Record<string, string | undefined> = process.env): string {
  const configured = env.UNDERWATER_ORIGIN || env.NEXT_PUBLIC_SERVER_URL
  if (!configured) throw new Error('An isolated application origin is required.')
  return new URL(configured).origin
}
