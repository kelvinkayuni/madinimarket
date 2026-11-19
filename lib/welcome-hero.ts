export const WELCOME_HERO_BUCKET = "homepage-hero";

export type WelcomeHeroFontFamily = "serif" | "sans";
export type WelcomeHeroFontWeight = 400 | 500 | 600 | 700;
export type WelcomeHeroHeightMode = "default" | "fit-screen" | "full-screen";
export type WelcomeHeroMobileActionsPosition = "top" | "middle" | "bottom";

export type WelcomeHeroSlide = {
  path: string;
  focusX: number;
  focusY: number;
  scale: number;
  url?: string;
};

export type WelcomeHeroSettings = {
  eyebrow: string;
  headline: string;
  description: string;
  exploreLabel: string;
  requestLabel: string;
  backgroundColor: string;
  overlayColor: string;
  overlayOpacity: number;
  headingColor: string;
  bodyColor: string;
  accentColor: string;
  buttonColor: string;
  buttonTextColor: string;
  fontFamily: WelcomeHeroFontFamily;
  fontWeight: WelcomeHeroFontWeight;
  desktopFontSize: number;
  mobileFontSize: number;
  heightMode: WelcomeHeroHeightMode;
  mobileActionsPosition: WelcomeHeroMobileActionsPosition;
  slides: WelcomeHeroSlide[];
};

export function parseWelcomeHeroSettings(value: unknown, allowEmptyCopy = false): WelcomeHeroSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  const heightMode = settings.heightMode === undefined ? "default" : settings.heightMode;
  const mobileActionsPosition = settings.mobileActionsPosition === undefined ? "top" : settings.mobileActionsPosition;
  const isHeightMode = (candidate: unknown): candidate is WelcomeHeroHeightMode =>
    candidate === "default" || candidate === "fit-screen" || candidate === "full-screen";
  const isMobileActionsPosition = (candidate: unknown): candidate is WelcomeHeroMobileActionsPosition =>
    candidate === "top" || candidate === "middle" || candidate === "bottom";
  const isText = (key: string, maximum: number, allowEmpty = false) =>
    typeof settings[key] === "string" &&
    (allowEmpty || settings[key].trim().length > 0) &&
    settings[key].length <= maximum;
  const isColor = (key: string) =>
    typeof settings[key] === "string" && /^#[\da-f]{6}$/i.test(settings[key]);
  const isIntegerInRange = (key: string, minimum: number, maximum: number) =>
    typeof settings[key] === "number" && Number.isSafeInteger(settings[key]) &&
    settings[key] >= minimum && settings[key] <= maximum;

  if (!isText("eyebrow", 36, allowEmptyCopy) ||
    !isText("headline", 100, allowEmptyCopy) ||
    !isText("description", 320, allowEmptyCopy) ||
    !isText("exploreLabel", 32, allowEmptyCopy) ||
    !isText("requestLabel", 32, allowEmptyCopy) ||
    !isColor("backgroundColor") ||
    !isColor("overlayColor") ||
    !isIntegerInRange("overlayOpacity", 0, 100) ||
    !isColor("headingColor") ||
    !isColor("bodyColor") ||
    !isColor("accentColor") ||
    !isColor("buttonColor") ||
    !isColor("buttonTextColor") ||
    (settings.fontFamily !== "serif" && settings.fontFamily !== "sans") ||
    ![400, 500, 600, 700].includes(settings.fontWeight as number) ||
    !isIntegerInRange("desktopFontSize", 40, 78) ||
    !isIntegerInRange("mobileFontSize", 32, 56) ||
    !isHeightMode(heightMode) ||
    !isMobileActionsPosition(mobileActionsPosition) ||
    !Array.isArray(settings.slides) ||
    settings.slides.length > 3) {
    return null;
  }

  const slides: WelcomeHeroSlide[] = [];
  for (const value of settings.slides) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const slide = value as Record<string, unknown>;
    const scale = slide.scale === undefined ? 100 : slide.scale;
    if (typeof slide.path !== "string" ||
      !/^homepage-hero\/[0-9a-f-]{36}\.jpg$/i.test(slide.path) ||
      typeof slide.focusX !== "number" || !Number.isSafeInteger(slide.focusX) || slide.focusX < 0 || slide.focusX > 100 ||
      typeof slide.focusY !== "number" || !Number.isSafeInteger(slide.focusY) || slide.focusY < 0 || slide.focusY > 100 ||
      typeof scale !== "number" || !Number.isSafeInteger(scale) || scale < 70 || scale > 160) {
      return null;
    }
    slides.push({ path: slide.path, focusX: slide.focusX, focusY: slide.focusY, scale });
  }

  if (new Set(slides.map((slide) => slide.path)).size !== slides.length) return null;

  return {
    eyebrow: settings.eyebrow as string,
    headline: settings.headline as string,
    description: settings.description as string,
    exploreLabel: settings.exploreLabel as string,
    requestLabel: settings.requestLabel as string,
    backgroundColor: settings.backgroundColor as string,
    overlayColor: settings.overlayColor as string,
    overlayOpacity: settings.overlayOpacity as number,
    headingColor: settings.headingColor as string,
    bodyColor: settings.bodyColor as string,
    accentColor: settings.accentColor as string,
    buttonColor: settings.buttonColor as string,
    buttonTextColor: settings.buttonTextColor as string,
    fontFamily: settings.fontFamily,
    fontWeight: settings.fontWeight as WelcomeHeroFontWeight,
    desktopFontSize: settings.desktopFontSize as number,
    mobileFontSize: settings.mobileFontSize as number,
    heightMode,
    mobileActionsPosition,
    slides,
  };
}

export function addWelcomeHeroImageUrls(
  settings: WelcomeHeroSettings,
  getPublicUrl: (path: string) => string,
): WelcomeHeroSettings {
  return {
    ...settings,
    slides: settings.slides.map((slide) => ({ ...slide, url: getPublicUrl(slide.path) })),
  };
}

export function parsePublicWelcomeHeroSettings(value: unknown): WelcomeHeroSettings | null {
  const settings = parseWelcomeHeroSettings(value, true);
  if (!settings || typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const rawSlides = (value as Record<string, unknown>).slides;
  if (!Array.isArray(rawSlides)) return null;
  const slides: WelcomeHeroSlide[] = [];
  for (let index = 0; index < settings.slides.length; index += 1) {
    const rawSlide = rawSlides[index];
    if (typeof rawSlide !== "object" || rawSlide === null || Array.isArray(rawSlide)) return null;
    const url = (rawSlide as Record<string, unknown>).url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
    slides.push({ ...settings.slides[index], url });
  }
  return { ...settings, slides };
}
