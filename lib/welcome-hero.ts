export const WELCOME_HERO_BUCKET = "homepage-hero";
export const WELCOME_HERO_MAX_IMAGE_BYTES = 20_000_000;
export const WELCOME_HERO_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type WelcomeHeroImageMimeType = typeof WELCOME_HERO_IMAGE_MIME_TYPES[number];
export const WELCOME_HERO_IMAGE_EXTENSION_BY_MIME: Record<WelcomeHeroImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};
export const WELCOME_HERO_CROP_TARGETS = {
  desktop: { width: 3840, height: 940 },
  phone: { width: 1080, height: 1165 },
} as const;
export const WELCOME_HERO_IMAGE_PATH_PATTERN = /^homepage-hero\/(?:(?:original|crops\/(?:desktop|phone))\/)?[0-9a-f-]{36}\.(?:jpe?g|png|webp|avif)$/i;
export const WELCOME_HERO_ORIGINAL_IMAGE_PATH_PATTERN = /^homepage-hero\/original\/[0-9a-f-]{36}\.(?:jpe?g|png|webp|avif)$/i;
export const WELCOME_HERO_DESKTOP_CROP_PATH_PATTERN = /^homepage-hero\/crops\/desktop\/[0-9a-f-]{36}\.(?:jpe?g|png|webp|avif)$/i;
export const WELCOME_HERO_PHONE_CROP_PATH_PATTERN = /^homepage-hero\/crops\/phone\/[0-9a-f-]{36}\.(?:jpe?g|png|webp|avif)$/i;

export function isWelcomeHeroImageMimeType(value: unknown): value is WelcomeHeroImageMimeType {
  return typeof value === "string" && WELCOME_HERO_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}

export function getWelcomeHeroImageMimeType(path: string): WelcomeHeroImageMimeType | null {
  const extension = path.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    default:
      return null;
  }
}

export type WelcomeHeroFontFamily = "serif" | "sans";
export type WelcomeHeroFontWeight = 400 | 500 | 600 | 700;
export type WelcomeHeroHeightMode = "default" | "fit-screen" | "full-screen";
export type WelcomeHeroMobileActionsPosition = "top" | "middle" | "bottom";
export type WelcomeHeroTransition =
  | "appear"
  | "fade"
  | "fly-in"
  | "slide"
  | "split"
  | "shape-wipe"
  | "wheel"
  | "random-bars"
  | "grow-turn"
  | "zoom";
export type WelcomeHeroSlideIntervalSeconds = 5 | 10 | 15 | 20 | 30;
export type WelcomeHeroTransitionDurationMs = 500 | 1000 | 1500 | 2000 | 3000;

export type WelcomeHeroSlide = {
  path: string;
  headline: string;
  description: string;
  focusX: number;
  focusY: number;
  scale: number;
  mobilePath?: string;
  desktopCropPath?: string;
  mobileCropPath?: string;
  mobileFocusX: number;
  mobileFocusY: number;
  mobileScale: number;
  url?: string;
  mobileUrl?: string;
  originalUrl?: string;
  mobileOriginalUrl?: string;
};

export type WelcomeHeroSettings = {
  eyebrow: string;
  headline: string;
  description: string;
  sellLabel: string;
  requestLabel: string;
  exploreLinkLabel: string;
  buyerBrowseLinkLabel: string;
  backgroundColor: string;
  overlayColor: string;
  overlayOpacity: number;
  headingColor: string;
  bodyColor: string;
  accentColor: string;
  buttonColor: string;
  buttonTextColor: string;
  requestButtonColor: string;
  requestButtonTextColor: string;
  fontFamily: WelcomeHeroFontFamily;
  fontWeight: WelcomeHeroFontWeight;
  desktopFontSize: number;
  mobileFontSize: number;
  transition: WelcomeHeroTransition;
  slideIntervalSeconds: WelcomeHeroSlideIntervalSeconds;
  transitionDurationMs: WelcomeHeroTransitionDurationMs;
  heightMode: WelcomeHeroHeightMode;
  desktopCopyHorizontalPosition: number;
  desktopCopyVerticalPosition: number;
  mobileCopyHorizontalPosition: number;
  mobileCopyVerticalPosition: number;
  desktopActionsHorizontalPosition: number;
  desktopActionsVerticalPosition: number;
  mobileActionsHorizontalPosition: number;
  mobileActionsVerticalPosition: number;
  desktopLinksHorizontalPosition: number;
  desktopLinksVerticalPosition: number;
  mobileLinksHorizontalPosition: number;
  mobileLinksVerticalPosition: number;
  publicHeaderDesktopPosition: number;
  publicHeaderMobilePosition: number;
  publicHeaderDesktopScale: number;
  publicHeaderMobileScale: number;
  slides: WelcomeHeroSlide[];
};

export function parseWelcomeHeroSettings(value: unknown, allowEmptyCopy = false): WelcomeHeroSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  const heightMode = settings.heightMode === undefined ? "default" : settings.heightMode;
  const mobileActionsPosition = settings.mobileActionsPosition === undefined ? "top" : settings.mobileActionsPosition;
  const transition = settings.transition === undefined ? "fade" : settings.transition;
  const slideIntervalSeconds = settings.slideIntervalSeconds === undefined ? 10 : settings.slideIntervalSeconds;
  const transitionDurationMs = settings.transitionDurationMs === undefined ? 1000 : settings.transitionDurationMs;
  const legacyDesktopActionsPosition = settings.desktopActionsPosition;
  const desktopCopyHorizontalPosition = settings.desktopCopyHorizontalPosition === undefined ? 0 : settings.desktopCopyHorizontalPosition;
  const desktopCopyVerticalPosition = settings.desktopCopyVerticalPosition === undefined ? 0 : settings.desktopCopyVerticalPosition;
  const mobileCopyHorizontalPosition = settings.mobileCopyHorizontalPosition === undefined ? 0 : settings.mobileCopyHorizontalPosition;
  const mobileCopyVerticalPosition = settings.mobileCopyVerticalPosition === undefined ? 0 : settings.mobileCopyVerticalPosition;
  const desktopActionsHorizontalPosition = settings.desktopActionsHorizontalPosition === undefined
    ? settings.actionsHorizontalPosition === undefined ? 0 : settings.actionsHorizontalPosition
    : settings.desktopActionsHorizontalPosition;
  const desktopActionsVerticalPosition = settings.desktopActionsVerticalPosition === undefined
    ? legacyDesktopActionsPosition === "middle" ? 50 : legacyDesktopActionsPosition === "bottom" ? 100 : 85
    : settings.desktopActionsVerticalPosition;
  const mobileActionsHorizontalPosition = settings.mobileActionsHorizontalPosition === undefined
    ? settings.actionsHorizontalPosition === undefined ? 0 : settings.actionsHorizontalPosition
    : settings.mobileActionsHorizontalPosition;
  const mobileActionsVerticalPosition = settings.mobileActionsVerticalPosition === undefined
    ? mobileActionsPosition === "middle" ? 75 : mobileActionsPosition === "bottom" ? 100 : 85
    : settings.mobileActionsVerticalPosition;
  const desktopLinksHorizontalPosition = settings.desktopLinksHorizontalPosition === undefined ? 0 : settings.desktopLinksHorizontalPosition;
  const desktopLinksVerticalPosition = settings.desktopLinksVerticalPosition === undefined ? 100 : settings.desktopLinksVerticalPosition;
  const mobileLinksHorizontalPosition = settings.mobileLinksHorizontalPosition === undefined ? 0 : settings.mobileLinksHorizontalPosition;
  const mobileLinksVerticalPosition = settings.mobileLinksVerticalPosition === undefined ? 100 : settings.mobileLinksVerticalPosition;
  const legacyPublicHeaderPosition = settings.publicHeaderHorizontalPosition;
  const sharedPublicHeaderPosition = settings.publicHeaderPosition === undefined
    ? typeof legacyPublicHeaderPosition === "number" && Number.isSafeInteger(legacyPublicHeaderPosition) &&
      legacyPublicHeaderPosition >= 50 && legacyPublicHeaderPosition <= 100
      ? (legacyPublicHeaderPosition - 50) * 2
      : 0
    : settings.publicHeaderPosition;
  const sharedPublicHeaderScale = settings.publicHeaderScale === undefined ? 100 : settings.publicHeaderScale;
  const publicHeaderDesktopPosition = settings.publicHeaderDesktopPosition === undefined
    ? sharedPublicHeaderPosition
    : settings.publicHeaderDesktopPosition;
  const publicHeaderMobilePosition = settings.publicHeaderMobilePosition === undefined
    ? sharedPublicHeaderPosition
    : settings.publicHeaderMobilePosition;
  const publicHeaderDesktopScale = settings.publicHeaderDesktopScale === undefined
    ? sharedPublicHeaderScale
    : settings.publicHeaderDesktopScale;
  const publicHeaderMobileScale = settings.publicHeaderMobileScale === undefined
    ? sharedPublicHeaderScale
    : settings.publicHeaderMobileScale;
  const requestButtonColor = settings.requestButtonColor === undefined ? "#f2ecdc" : settings.requestButtonColor;
  const requestButtonTextColor = settings.requestButtonTextColor === undefined ? "#18382e" : settings.requestButtonTextColor;
  const exploreLinkLabel = settings.exploreLinkLabel === undefined ? "" : settings.exploreLinkLabel;
  const buyerBrowseLinkLabel = settings.buyerBrowseLinkLabel === undefined
    ? ""
    : settings.buyerBrowseLinkLabel;
  const sellLabel = settings.sellLabel === undefined
    ? settings.exploreLabel === "Explore minerals" ? "Sell a mineral" : settings.exploreLabel
    : settings.sellLabel;
  const isHeightMode = (candidate: unknown): candidate is WelcomeHeroHeightMode =>
    candidate === "default" || candidate === "fit-screen" || candidate === "full-screen";
  const isMobileActionsPosition = (candidate: unknown): candidate is WelcomeHeroMobileActionsPosition =>
    candidate === "top" || candidate === "middle" || candidate === "bottom";
  const isTransition = (candidate: unknown): candidate is WelcomeHeroTransition =>
    candidate === "appear" ||
    candidate === "fade" ||
    candidate === "fly-in" ||
    candidate === "slide" ||
    candidate === "split" ||
    candidate === "shape-wipe" ||
    candidate === "wheel" ||
    candidate === "random-bars" ||
    candidate === "grow-turn" ||
    candidate === "zoom";
  const isSlideInterval = (candidate: unknown): candidate is WelcomeHeroSlideIntervalSeconds =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) && [5, 10, 15, 20, 30].includes(candidate);
  const isTransitionDuration = (candidate: unknown): candidate is WelcomeHeroTransitionDurationMs =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) && [500, 1000, 1500, 2000, 3000].includes(candidate);
  const isText = (key: string, maximum: number, allowEmpty = false) =>
    typeof settings[key] === "string" &&
    (allowEmpty || settings[key].trim().length > 0) &&
    settings[key].length <= maximum;
  const isTextValue = (candidate: unknown, maximum: number, allowEmpty = false) =>
    typeof candidate === "string" &&
    (allowEmpty || candidate.trim().length > 0) &&
    candidate.length <= maximum;
  const isColorValue = (candidate: unknown) =>
    typeof candidate === "string" && /^#[\da-f]{6}$/i.test(candidate);
  const isColor = (key: string) => isColorValue(settings[key]);
  const isIntegerValueInRange = (candidate: unknown, minimum: number, maximum: number) =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) &&
    candidate >= minimum && candidate <= maximum;
  const isIntegerInRange = (key: string, minimum: number, maximum: number) =>
    isIntegerValueInRange(settings[key], minimum, maximum);

  if (!isText("eyebrow", 36, allowEmptyCopy) ||
    !isText("headline", 100, allowEmptyCopy) ||
    !isText("description", 320, allowEmptyCopy) ||
    !isTextValue(sellLabel, 32, allowEmptyCopy) ||
    !isText("requestLabel", 32, allowEmptyCopy) ||
    !isTextValue(exploreLinkLabel, 80, true) ||
    !isTextValue(buyerBrowseLinkLabel, 80, true) ||
    !isColor("backgroundColor") ||
    !isColor("overlayColor") ||
    !isIntegerInRange("overlayOpacity", 0, 100) ||
    !isColor("headingColor") ||
    !isColor("bodyColor") ||
    !isColor("accentColor") ||
    !isColor("buttonColor") ||
    !isColor("buttonTextColor") ||
    !isColorValue(requestButtonColor) ||
    !isColorValue(requestButtonTextColor) ||
    (settings.fontFamily !== "serif" && settings.fontFamily !== "sans") ||
    ![400, 500, 600, 700].includes(settings.fontWeight as number) ||
    !isIntegerInRange("desktopFontSize", 40, 78) ||
    !isIntegerInRange("mobileFontSize", 32, 56) ||
    !isIntegerValueInRange(desktopCopyHorizontalPosition, 0, 100) ||
    !isIntegerValueInRange(desktopCopyVerticalPosition, 0, 100) ||
    !isIntegerValueInRange(mobileCopyHorizontalPosition, 0, 100) ||
    !isIntegerValueInRange(mobileCopyVerticalPosition, 0, 100) ||
    !isIntegerValueInRange(desktopActionsHorizontalPosition, 0, 100) ||
    !isIntegerValueInRange(desktopActionsVerticalPosition, 0, 100) ||
    !isIntegerValueInRange(mobileActionsHorizontalPosition, 0, 100) ||
    !isIntegerValueInRange(mobileActionsVerticalPosition, 0, 100) ||
    !isIntegerValueInRange(desktopLinksHorizontalPosition, 0, 100) ||
    !isIntegerValueInRange(desktopLinksVerticalPosition, 0, 100) ||
    !isIntegerValueInRange(mobileLinksHorizontalPosition, 0, 100) ||
    !isIntegerValueInRange(mobileLinksVerticalPosition, 0, 100) ||
    !isIntegerValueInRange(publicHeaderDesktopPosition, 0, 100) ||
    !isIntegerValueInRange(publicHeaderMobilePosition, 0, 100) ||
    (legacyPublicHeaderPosition !== undefined && !isIntegerValueInRange(legacyPublicHeaderPosition, 0, 100)) ||
    !isIntegerValueInRange(publicHeaderDesktopScale, 70, 300) ||
    !isIntegerValueInRange(publicHeaderMobileScale, 70, 300) ||
    !isTransition(transition) ||
    !isSlideInterval(slideIntervalSeconds) ||
    !isTransitionDuration(transitionDurationMs) ||
    !isHeightMode(heightMode) ||
    !isMobileActionsPosition(mobileActionsPosition) ||
    !Array.isArray(settings.slides) ||
    settings.slides.length > 3) {
    return null;
  }

  const slides: WelcomeHeroSlide[] = [];
  const paths = new Set<string>();
  for (const value of settings.slides) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const slide = value as Record<string, unknown>;
    const scale = slide.scale === undefined ? 100 : slide.scale;
    const mobileFocusX = slide.mobileFocusX === undefined ? slide.focusX : slide.mobileFocusX;
    const mobileFocusY = slide.mobileFocusY === undefined ? slide.focusY : slide.mobileFocusY;
    const mobileScale = slide.mobileScale === undefined ? scale : slide.mobileScale;
    const headline = slide.headline === undefined ? settings.headline : slide.headline;
    const description = slide.description === undefined ? settings.description : slide.description;
    const mobilePath = slide.mobilePath;
    const desktopCropPath = slide.desktopCropPath;
    const mobileCropPath = slide.mobileCropPath;
    if (typeof slide.path !== "string" ||
      !WELCOME_HERO_IMAGE_PATH_PATTERN.test(slide.path) ||
      typeof headline !== "string" || (!allowEmptyCopy && headline.trim().length === 0) || headline.length > 100 ||
      typeof description !== "string" || (!allowEmptyCopy && description.trim().length === 0) || description.length > 320 ||
      typeof slide.focusX !== "number" || !Number.isSafeInteger(slide.focusX) || slide.focusX < 0 || slide.focusX > 100 ||
      typeof slide.focusY !== "number" || !Number.isSafeInteger(slide.focusY) || slide.focusY < 0 || slide.focusY > 100 ||
      typeof scale !== "number" || !Number.isSafeInteger(scale) || scale < 70 || scale > 160 ||
      typeof mobileFocusX !== "number" || !Number.isSafeInteger(mobileFocusX) || mobileFocusX < 0 || mobileFocusX > 100 ||
      typeof mobileFocusY !== "number" || !Number.isSafeInteger(mobileFocusY) || mobileFocusY < 0 || mobileFocusY > 100 ||
      typeof mobileScale !== "number" || !Number.isSafeInteger(mobileScale) || mobileScale < 70 || mobileScale > 160 ||
      (mobilePath !== undefined && (typeof mobilePath !== "string" || !WELCOME_HERO_IMAGE_PATH_PATTERN.test(mobilePath))) ||
      (desktopCropPath !== undefined && (typeof desktopCropPath !== "string" || !WELCOME_HERO_DESKTOP_CROP_PATH_PATTERN.test(desktopCropPath))) ||
      (mobileCropPath !== undefined && (typeof mobileCropPath !== "string" || !WELCOME_HERO_PHONE_CROP_PATH_PATTERN.test(mobileCropPath)))) {
      return null;
    }
    const slidePaths = [slide.path, mobilePath, desktopCropPath, mobileCropPath].filter((path): path is string => typeof path === "string");
    if (slidePaths.some((path) => paths.has(path))) return null;
    for (const path of slidePaths) paths.add(path);
    slides.push({
      path: slide.path,
      headline,
      description,
      focusX: slide.focusX,
      focusY: slide.focusY,
      scale,
      ...(typeof mobilePath === "string" ? { mobilePath } : {}),
      ...(typeof desktopCropPath === "string" ? { desktopCropPath } : {}),
      ...(typeof mobileCropPath === "string" ? { mobileCropPath } : {}),
      mobileFocusX,
      mobileFocusY,
      mobileScale,
    });
  }

  return {
    eyebrow: settings.eyebrow as string,
    headline: settings.headline as string,
    description: settings.description as string,
    sellLabel: sellLabel as string,
    requestLabel: settings.requestLabel as string,
    exploreLinkLabel: exploreLinkLabel as string,
    buyerBrowseLinkLabel: buyerBrowseLinkLabel as string,
    backgroundColor: settings.backgroundColor as string,
    overlayColor: settings.overlayColor as string,
    overlayOpacity: settings.overlayOpacity as number,
    headingColor: settings.headingColor as string,
    bodyColor: settings.bodyColor as string,
    accentColor: settings.accentColor as string,
    buttonColor: settings.buttonColor as string,
    buttonTextColor: settings.buttonTextColor as string,
    requestButtonColor: requestButtonColor as string,
    requestButtonTextColor: requestButtonTextColor as string,
    fontFamily: settings.fontFamily,
    fontWeight: settings.fontWeight as WelcomeHeroFontWeight,
    desktopFontSize: settings.desktopFontSize as number,
    mobileFontSize: settings.mobileFontSize as number,
    transition,
    slideIntervalSeconds,
    transitionDurationMs,
    heightMode,
    desktopCopyHorizontalPosition: desktopCopyHorizontalPosition as number,
    desktopCopyVerticalPosition: desktopCopyVerticalPosition as number,
    mobileCopyHorizontalPosition: mobileCopyHorizontalPosition as number,
    mobileCopyVerticalPosition: mobileCopyVerticalPosition as number,
    desktopActionsHorizontalPosition: desktopActionsHorizontalPosition as number,
    desktopActionsVerticalPosition: desktopActionsVerticalPosition as number,
    mobileActionsHorizontalPosition: mobileActionsHorizontalPosition as number,
    mobileActionsVerticalPosition: mobileActionsVerticalPosition as number,
    desktopLinksHorizontalPosition: desktopLinksHorizontalPosition as number,
    desktopLinksVerticalPosition: desktopLinksVerticalPosition as number,
    mobileLinksHorizontalPosition: mobileLinksHorizontalPosition as number,
    mobileLinksVerticalPosition: mobileLinksVerticalPosition as number,
    publicHeaderDesktopPosition: publicHeaderDesktopPosition as number,
    publicHeaderMobilePosition: publicHeaderMobilePosition as number,
    publicHeaderDesktopScale: publicHeaderDesktopScale as number,
    publicHeaderMobileScale: publicHeaderMobileScale as number,
    slides,
  };
}

export function addWelcomeHeroImageUrls(
  settings: WelcomeHeroSettings,
  getPublicUrl: (path: string) => string,
): WelcomeHeroSettings {
  return {
    ...settings,
    slides: settings.slides.map((slide) => ({
      ...slide,
      url: getPublicUrl(slide.desktopCropPath ?? slide.path),
      mobileUrl: getPublicUrl(slide.mobileCropPath ?? slide.mobilePath ?? slide.path),
      originalUrl: getPublicUrl(slide.path),
      mobileOriginalUrl: getPublicUrl(slide.mobilePath ?? slide.path),
    })),
  };
}

export function getWelcomeHeroSlideStoragePaths(slide: Pick<WelcomeHeroSlide, "path" | "mobilePath" | "desktopCropPath" | "mobileCropPath">) {
  return [slide.path, slide.mobilePath, slide.desktopCropPath, slide.mobileCropPath]
    .filter((path): path is string => typeof path === "string");
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
    const rawMobileUrl = (rawSlide as Record<string, unknown>).mobileUrl;
    const mobileUrl = rawMobileUrl === undefined ? url : rawMobileUrl;
    const originalUrl = (rawSlide as Record<string, unknown>).originalUrl;
    const mobileOriginalUrl = (rawSlide as Record<string, unknown>).mobileOriginalUrl;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url) ||
      typeof mobileUrl !== "string" || !/^https?:\/\//i.test(mobileUrl) ||
      (originalUrl !== undefined && (typeof originalUrl !== "string" || !/^https?:\/\//i.test(originalUrl))) ||
      (mobileOriginalUrl !== undefined && (typeof mobileOriginalUrl !== "string" || !/^https?:\/\//i.test(mobileOriginalUrl)))) return null;
    slides.push({
      ...settings.slides[index],
      url,
      mobileUrl,
      ...(typeof originalUrl === "string" ? { originalUrl } : {}),
      ...(typeof mobileOriginalUrl === "string" ? { mobileOriginalUrl } : {}),
    });
  }
  return { ...settings, slides };
}
