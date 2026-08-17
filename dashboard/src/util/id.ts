/**
 * Stable request key for a reply. It is generated once per composed message and
 * reused on every retry, so a send that is retried after losing signal cannot
 * become two WhatsApp messages.
 */
export function requestKey(): string {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  if (globalCrypto?.getRandomValues) {
    const bytes = globalCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}
