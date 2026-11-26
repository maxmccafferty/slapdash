/** A new random id for a project or file. Uses the Web Crypto API (browsers, workers and Node 19+). */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
