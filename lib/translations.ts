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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  const ordered = [...pairs].sort((left, right) => right.english_phrase.length - left.english_phrase.length);
  if (!ordered.length) return (value: string) => value;
  const replacements = new Map(ordered.map((pair) => [pair.english_phrase.toLowerCase().replace(/\s+/g, " "), pair.swahili_phrase]));
  const alternatives = ordered.map((pair) => escapeRegExp(pair.english_phrase).replace(/\s+/g, "\\s+")).join("|");
  const matcher = new RegExp(`(^|[^\\p{L}\\p{N}_])(${alternatives})(?=$|[^\\p{L}\\p{N}_])`, "giu");
  return (value: string) => value.replace(matcher, (match, prefix: string, phrase: string) => {
    const translation = replacements.get(phrase.toLowerCase().replace(/\s+/g, " "));
    return `${prefix}${translation ? preserveCase(phrase, translation) : phrase}`;
  });
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
