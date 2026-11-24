import { normalizeTranslationPhrase } from "@/lib/translation-phrase-normalization";

export type TranslationPair = {
  id: string;
  english_phrase: string;
  swahili_phrase: string;
};

export type Language = "en" | "sw";

const originalText = new WeakMap<Text, string>();
const renderedText = new WeakMap<Text, string>();
const originalAttribute = new WeakMap<Element, Map<string, string>>();
const renderedAttribute = new WeakMap<Element, Map<string, string>>();
const translatableAttributes = ["alt", "aria-description", "aria-label", "placeholder", "title"] as const;
const translationTemplateTokenPattern = /\{\{value\d+\}\}/gi;

type TranslationTemplate = {
  englishPhrase: string;
  swahiliPhrase: string;
  matcher: RegExp;
  tokens: string[];
};

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

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createTranslationTemplate(englishPhrase: string, swahiliPhrase: string): TranslationTemplate | null {
  const tokens = [...englishPhrase.matchAll(translationTemplateTokenPattern)].map((match) => match[0].toLowerCase());
  if (!tokens.length) return null;

  let source = "^";
  let offset = 0;
  for (const match of englishPhrase.matchAll(translationTemplateTokenPattern)) {
    const index = match.index ?? 0;
    const literal = englishPhrase.slice(offset, index);
    source += literal.split(/(\s+)/).map((part) => /^\s+$/.test(part) ? "\\s+" : escapeRegularExpression(part)).join("");
    source += "([\\s\\S]*?)";
    offset = index + match[0].length;
  }
  const trailingLiteral = englishPhrase.slice(offset);
  source += trailingLiteral.split(/(\s+)/).map((part) => /^\s+$/.test(part) ? "\\s+" : escapeRegularExpression(part)).join("");

  return {
    englishPhrase,
    swahiliPhrase,
    matcher: new RegExp(`${source}$`, "i"),
    tokens,
  };
}

function createTranslator(pairs: TranslationPair[]) {
  const replacements = new Map(pairs.map((pair) => [
    normalizeTranslationPhrase(pair.english_phrase),
    pair.swahili_phrase,
  ]));
  const templates = pairs.flatMap((pair) => {
    const template = createTranslationTemplate(pair.english_phrase, pair.swahili_phrase);
    return template ? [template] : [];
  });
  return (value: string) => {
    const phrase = value.trim();
    const translation = replacements.get(normalizeTranslationPhrase(phrase));
    const start = value.indexOf(phrase);
    if (translation) {
      return `${value.slice(0, start)}${preserveCase(phrase, translation)}${value.slice(start + phrase.length)}`;
    }

    for (const template of templates) {
      const match = template.matcher.exec(phrase);
      if (!match) continue;
      const values = new Map(template.tokens.map((token, index) => [token, match[index + 1] ?? ""]));
      const translated = preserveCase(template.englishPhrase, template.swahiliPhrase)
        .replace(translationTemplateTokenPattern, (token) => values.get(token.toLowerCase()) ?? token);
      return `${value.slice(0, start)}${translated}${value.slice(start + phrase.length)}`;
    }
    return value;
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
  const attributes = root.querySelectorAll<Element>(translatableAttributes.map((attribute) => `[${attribute}]`).join(", "));
  for (const element of attributes) {
    const originalValues = originalAttribute.get(element) ?? new Map<string, string>();
    const renderedValues = renderedAttribute.get(element) ?? new Map<string, string>();
    for (const attribute of translatableAttributes) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      let source = originalValues.get(attribute);
      const previous = renderedValues.get(attribute);
      if (previous !== undefined && value !== previous) {
        source = value;
        originalValues.set(attribute, source);
      } else if (source === undefined) {
        source = value;
        originalValues.set(attribute, source);
      }

      const original = source ?? value;
      const translated = !element.closest("[data-no-translate]") && language === "sw"
        ? translate(original)
        : original;
      if (value !== translated) element.setAttribute(attribute, translated);
      renderedValues.set(attribute, translated);
    }
    originalAttribute.set(element, originalValues);
    renderedAttribute.set(element, renderedValues);
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
