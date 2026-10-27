export function normalizeTranslationPhrase(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
