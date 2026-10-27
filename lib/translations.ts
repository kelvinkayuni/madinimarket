import { normalizeTranslationPhrase } from "@/lib/translation-phrase-normalization";

export type TranslationPair = {
  id: string;
  english_phrase: string;
  swahili_phrase: string;
};

export type Language = "en" | "sw";

const originalText = new WeakMap<Text, string>();
const renderedText = new WeakMap<Text, string>();
const originalPlaceholder = new WeakMap<Element, string>();
const renderedPlaceholder = new WeakMap<Element, string>();

function preserveCase(source: string, translation: string) {
  if (source === source.toUpperCase()) return translation.toUpperCase();
  const sourceWords = source.split(/\s+/);
  if (sourceWords.length > 1 && sourceWords.every((word) =>
    word[0] === word[0]?.toUpperCase() && word.slice(1) === word.slice(1).toLowerCase())) {
    return translation.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
  if (source[0] === source[0]?.toUpperCase() && source.slice(1) === source.slice(1).toLowerCase()) {
    return translation[0]?.toUpperCase() + translation.slice(1);
  }
  return translation;
}

function createTranslator(pairs: TranslationPair[]) {
  const replacements = new Map(pairs.map((pair) => [
    normalizeTranslationPhrase(pair.english_phrase),
    pair.swahili_phrase,
  ]));
  return (value: string) => {
    const phrase = value.trim();
    const translation = replacements.get(normalizeTranslationPhrase(phrase));
    if (!translation) return value;
    const start = value.indexOf(phrase);
    return `${value.slice(0, start)}${preserveCase(phrase, translation)}${value.slice(start + phrase.length)}`;
  };
}

export function translateText(value: string, pairs: TranslationPair[]) {
  return createTranslator(pairs)(value);
}

function isExcluded(element: Element | null) {
  return Boolean(element?.closest("[data-no-translate], input, textarea, select, script, style, [contenteditable='true']"));
}

export function applyVisibleTranslations(root: HTMLElement, language: Language, pairs: TranslationPair[]) {
  const translate = createTranslator(pairs);
  const placeholders = root.querySelectorAll<HTMLElement>("[placeholder]");
  for (const element of placeholders) {
    const value = element.getAttribute("placeholder") ?? "";
    let source = originalPlaceholder.get(element);
    const previous = renderedPlaceholder.get(element);
    if (previous !== undefined && value !== previous) {
      source = value;
      originalPlaceholder.set(element, source);
    } else if (source === undefined) {
      source = value;
      originalPlaceholder.set(element, source);
    }
    const translated = !element.closest("[data-no-translate]") && language === "sw"
      ? translate(source)
      : source;
    if (value !== translated) element.setAttribute("placeholder", translated);
    renderedPlaceholder.set(element, translated);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    const value = text.nodeValue ?? "";
    let source = originalText.get(text);
    const previous = renderedText.get(text);
    if (previous !== undefined && value !== previous) {
      source = value;
      originalText.set(text, source);
    } else if (source === undefined) {
      source = value;
      originalText.set(text, source);
    }

    const translated = !isExcluded(text.parentElement) && language === "sw"
      ? translate(source)
      : source;
    if (value !== translated) text.nodeValue = translated;
    renderedText.set(text, translated);
    current = walker.nextNode();
  }
}
