import { createHash } from "node:crypto";

import { interfaceTranslationPhrases } from "@/lib/interface-translation-catalog";
import { normalizeTranslationPhrase } from "@/lib/translation-phrase-normalization";

export type PendingTranslationPhrase = {
  english_phrase: string;
  taskId: string;
};

type ExistingTranslation = {
  english_phrase: string;
  swahili_phrase: string;
};

export function getPendingTranslationPhrases(
  translations: readonly ExistingTranslation[],
  dynamicPhrases: readonly string[] = [],
): PendingTranslationPhrase[] {
  const completedPhrases = new Set(translations.map((translation) =>
    normalizeTranslationPhrase(translation.english_phrase)));
  const pendingPhrases = new Map<string, string>();

  for (const candidate of [...interfaceTranslationPhrases, ...dynamicPhrases]) {
    const phrase = candidate.replace(/\s+/g, " ").trim();
    const staticText = phrase.replace(/\{\{value\d+\}\}/g, "").trim();
    if (!staticText || phrase.length > 1000 || !/\p{L}/u.test(staticText)) continue;
    const normalizedPhrase = normalizeTranslationPhrase(phrase);
    if (!completedPhrases.has(normalizedPhrase) && !pendingPhrases.has(normalizedPhrase)) {
      pendingPhrases.set(normalizedPhrase, phrase);
    }
  }

  return [...pendingPhrases.values()]
    .sort((left, right) => left.localeCompare(right))
    .map((english_phrase) => ({
      english_phrase,
      taskId: getTranslationPhraseTaskId(english_phrase),
    }));
}

export function getTranslationPhraseTaskId(phrase: string) {
  const normalizedPhrase = normalizeTranslationPhrase(phrase);
  return `phrase-${createHash("sha256").update(normalizedPhrase).digest("hex")}`;
}
