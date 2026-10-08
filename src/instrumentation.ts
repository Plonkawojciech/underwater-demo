export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.UNDERWATER_ENVIRONMENT === 'preview') {
    const { startMaintenance } = await import('./lib/maintenance')
    await startMaintenance()
  }
}
