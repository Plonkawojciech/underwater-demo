/** Shared by startup validation and the adapter registry; no runtime secrets. */
export const DEFAULT_PAYMENT_PROVIDER = 'internal-test' as const
export function paymentProviderID(selected?: string): typeof DEFAULT_PAYMENT_PROVIDER {
  const value = selected ?? DEFAULT_PAYMENT_PROVIDER
  if (value !== DEFAULT_PAYMENT_PROVIDER) throw new Error('The configured payment adapter has no verified isolated implementation.')
  return value
}
