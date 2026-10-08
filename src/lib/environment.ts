import path from 'node:path'

export type AppEnvironment = 'preview' | 'test' | 'build'

export function validateEnvironment(env: Record<string, string | undefined>) {
  const environment = env.UNDERWATER_ENVIRONMENT
  if (!['preview', 'test', 'build'].includes(environment || '')) {
    throw new Error('UNDERWATER_ENVIRONMENT must explicitly identify preview, test or build.')
  }
  if (!env.PAYLOAD_SECRET || env.PAYLOAD_SECRET.length < 32) {
    throw new Error('A private PAYLOAD_SECRET of at least 32 characters is required.')
  }
  if (!env.UNDERWATER_DATA_ROOT || !path.isAbsolute(env.UNDERWATER_DATA_ROOT)) {
    throw new Error('An absolute, dedicated UNDERWATER_DATA_ROOT is required.')
  }
  const dataRoot = path.resolve(env.UNDERWATER_DATA_ROOT)
  const databasePath = path.join(dataRoot, 'underwater-' + environment + '.db')
  if (env.DATABASE_URI !== 'file:' + databasePath) {
    throw new Error('DATABASE_URI does not match the explicitly isolated Underwater database.')
  }
  const mediaDir = path.join(dataRoot, 'media')
  if (env.MEDIA_DIR !== mediaDir) {
    throw new Error('MEDIA_DIR does not match the dedicated Underwater data directory.')
  }
  let serverURL: URL
  try {
    serverURL = new URL(env.UNDERWATER_ORIGIN || env.NEXT_PUBLIC_SERVER_URL || '')
  } catch {
    throw new Error('An explicit NEXT_PUBLIC_SERVER_URL is required.')
  }
  if (environment === 'preview' && (!env.UNDERWATER_PREVIEW_USER || !env.UNDERWATER_PREVIEW_PASSWORD || env.UNDERWATER_PREVIEW_PASSWORD.length < 24)) {
    throw new Error('Private preview authentication must be configured before runtime startup.')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(serverURL.hostname)
  const ownHost = serverURL.hostname.endsWith('.programo.pl')
  if ((!local && !ownHost) || (!local && serverURL.protocol !== 'https:') ||
      (local && !['http:', 'https:'].includes(serverURL.protocol)) ||
      serverURL.username || serverURL.password || serverURL.search || serverURL.hash ||
      (serverURL.pathname !== '/' && serverURL.pathname !== '')) {
    throw new Error('Only a local or HTTPS Programo preview origin is allowed.')
  }
  return {
    environment: environment as AppEnvironment,
    dataRoot,
    databasePath,
    databaseURI: env.DATABASE_URI,
    mediaDir,
    serverURL: serverURL.origin,
    secret: env.PAYLOAD_SECRET,
  }
}
