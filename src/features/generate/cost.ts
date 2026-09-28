export function currencyToMicro(value: string): number | null {
  const trimmed = value.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(trimmed)) return null
  const [whole, fraction = ''] = trimmed.split('.')
  try {
    const amount = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
    return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
  } catch { return null }
}
