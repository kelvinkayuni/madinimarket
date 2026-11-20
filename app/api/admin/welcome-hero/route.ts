import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import {
  addWelcomeHeroImageUrls,
  getWelcomeHeroImageMimeType,
  parseWelcomeHeroSettings,
  WELCOME_HERO_IMAGE_PATH_PATTERN,
  WELCOME_HERO_MAX_IMAGE_BYTES,
  WELCOME_HERO_ORIGINAL_IMAGE_PATH_PATTERN,
  WELCOME_HERO_BUCKET,
  type WelcomeHeroSettings,
  type WelcomeHeroSlide,
} from "@/lib/welcome-hero";

type DraftSlide = {
  path: string;
  headline?: string;
  description?: string;
  focusX: number;
  focusY: number;
  scale: number;
  mobilePath?: string;
  mobileFocusX: number;
  mobileFocusY: number;
  mobileScale: number;
};

function parseDraftSlides(value: unknown): DraftSlide[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const slides: DraftSlide[] = [];
  const paths = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const slide = candidate as Record<string, unknown>;
    const scale = slide.scale === undefined ? 100 : slide.scale;
    const mobileFocusX = slide.mobileFocusX === undefined ? slide.focusX : slide.mobileFocusX;
    const mobileFocusY = slide.mobileFocusY === undefined ? slide.focusY : slide.mobileFocusY;
    const mobileScale = slide.mobileScale === undefined ? scale : slide.mobileScale;
    if ((slide.headline !== undefined &&
      (typeof slide.headline !== "string" || !slide.headline.trim() || slide.headline.length > 100)) ||
      (slide.description !== undefined &&
        (typeof slide.description !== "string" || !slide.description.trim() || slide.description.length > 320))) {
      return null;
    }
    if (typeof slide.focusX !== "number" || !Number.isSafeInteger(slide.focusX) || slide.focusX < 0 || slide.focusX > 100 ||
      typeof slide.focusY !== "number" || !Number.isSafeInteger(slide.focusY) || slide.focusY < 0 || slide.focusY > 100 ||
      typeof scale !== "number" || !Number.isSafeInteger(scale) || scale < 70 || scale > 160 ||
      typeof mobileFocusX !== "number" || !Number.isSafeInteger(mobileFocusX) || mobileFocusX < 0 || mobileFocusX > 100 ||
      typeof mobileFocusY !== "number" || !Number.isSafeInteger(mobileFocusY) || mobileFocusY < 0 || mobileFocusY > 100 ||
      typeof mobileScale !== "number" || !Number.isSafeInteger(mobileScale) || mobileScale < 70 || mobileScale > 160) {
      return null;
    }
    if (slide.uploadIndex !== undefined || slide.mobileUploadIndex !== undefined ||
      typeof slide.path !== "string" || !WELCOME_HERO_IMAGE_PATH_PATTERN.test(slide.path) || paths.has(slide.path)) {
      return null;
    }
    paths.add(slide.path);
    const draft: DraftSlide = {
      path: slide.path,
      ...(typeof slide.headline === "string" ? { headline: slide.headline } : {}),
      ...(typeof slide.description === "string" ? { description: slide.description } : {}),
      focusX: slide.focusX,
      focusY: slide.focusY,
      scale,
      mobileFocusX,
      mobileFocusY,
      mobileScale,
    };
    if (typeof slide.mobilePath === "string" &&
      WELCOME_HERO_IMAGE_PATH_PATTERN.test(slide.mobilePath) && !paths.has(slide.mobilePath)) {
      paths.add(slide.mobilePath);
      draft.mobilePath = slide.mobilePath;
    } else if (slide.mobilePath !== undefined) {
      return null;
    }

    slides.push(draft);
  }
  return slides;
}

function getNewUploadPaths(value: unknown, oldPaths: Set<string>) {
  if (!Array.isArray(value)) return [];
  const paths = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const slide = candidate as Record<string, unknown>;
    for (const path of [slide.path, slide.mobilePath]) {
      if (typeof path === "string" && WELCOME_HERO_ORIGINAL_IMAGE_PATH_PATTERN.test(path) && !oldPaths.has(path)) {
        paths.add(path);
      }
    }
  }
  return [...paths];
}

async function verifyWelcomeHeroUpload(
  admin: Awaited<ReturnType<typeof getAdminClient>>,
  path: string,
) {
  if (!admin) return false;
  const mimeType = getWelcomeHeroImageMimeType(path);
  if (!mimeType) return false;
  const separator = path.lastIndexOf("/");
  const directory = path.slice(0, separator);
  const filename = path.slice(separator + 1);
  const { data, error } = await admin.storage.from(WELCOME_HERO_BUCKET).list(directory, { limit: 1, search: filename });
  if (error) throw error;
  const file = data?.find((entry) => entry.name === filename);
  const size = Number(file?.metadata?.size);
  return Boolean(file && Number.isSafeInteger(size) && size > 0 && size <= WELCOME_HERO_MAX_IMAGE_BYTES
    && file.metadata?.mimetype === mimeType);
}

async function removeUploadedImages(admin: Awaited<ReturnType<typeof getAdminClient>>, paths: string[]) {
  if (!admin || !paths.length) return;
  const { error } = await admin.storage.from(WELCOME_HERO_BUCKET).remove(paths);
  if (error) console.error("Could not remove unpublished welcome hero images.", error);
}

export async function POST(request: Request) {
  let admin: Awaited<ReturnType<typeof getAdminClient>> = null;
  let uploadedPaths: string[] = [];
  let settingsSaved = false;
  try {
    admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

    let candidate: unknown;
    try {
      candidate = await request.json();
    } catch {
      return NextResponse.json({ error: "Submit valid welcome hero settings." }, { status: 400 });
    }
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return NextResponse.json({ error: "Welcome hero settings are invalid." }, { status: 400 });
    }
    const values = candidate as Record<string, unknown>;

    const oldSettingsResult = await admin.from("marketplace_settings")
      .select("welcome_hero_settings")
      .eq("id", true)
      .single();
    if (oldSettingsResult.error) throw oldSettingsResult.error;
    const oldSettings = parseWelcomeHeroSettings(oldSettingsResult.data.welcome_hero_settings, true);
    if (!oldSettings) throw new Error("Saved welcome hero settings are invalid.");
    const oldPaths = new Set(oldSettings.slides.flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path]));
    uploadedPaths = getNewUploadPaths(values.slides, oldPaths);

    const draftSlides = parseDraftSlides(values.slides);
    const design = parseWelcomeHeroSettings({ ...values, slides: [] });
    if (!draftSlides || !design) {
      return NextResponse.json({ error: "Check the welcome hero text, colors, font sizes, layout options, and images." }, { status: 400 });
    }
    const requestedPaths = draftSlides.flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path]);
    if (requestedPaths.some((path) => !oldPaths.has(path) && !WELCOME_HERO_ORIGINAL_IMAGE_PATH_PATTERN.test(path))) {
      return NextResponse.json({ error: "Only uploaded hero images can be added." }, { status: 400 });
    }
    for (const path of uploadedPaths) {
      if (!await verifyWelcomeHeroUpload(admin, path)) {
        return NextResponse.json({ error: "A new hero image is missing or has invalid file details." }, { status: 400 });
      }
    }

    const slides: WelcomeHeroSlide[] = [];
    for (const slide of draftSlides) {
      slides.push({
        path: slide.path,
        headline: slide.headline ?? design.headline,
        description: slide.description ?? design.description,
        focusX: slide.focusX,
        focusY: slide.focusY,
        scale: slide.scale,
        ...(slide.mobilePath ? { mobilePath: slide.mobilePath } : {}),
        mobileFocusX: slide.mobileFocusX,
        mobileFocusY: slide.mobileFocusY,
        mobileScale: slide.mobileScale,
      });
    }

    const savedSettings: WelcomeHeroSettings = { ...design, slides };
    const { data: savedRow, error: saveError } = await admin.from("marketplace_settings")
      .update({ welcome_hero_settings: savedSettings })
      .eq("id", true)
      .select("welcome_hero_settings")
      .single();
    if (saveError) throw saveError;
    settingsSaved = true;
    const saved = parseWelcomeHeroSettings(savedRow.welcome_hero_settings);
    if (!saved) throw new Error("Saved welcome hero settings are invalid.");

    const retainedPaths = new Set(saved.slides.flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path]));
    const removedPaths = oldSettings.slides
      .flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path])
      .filter((path) => !retainedPaths.has(path));
    const heroStorage = admin.storage.from(WELCOME_HERO_BUCKET);
    let cleanupWarning = false;
    if (removedPaths.length) {
      const { error: cleanupError } = await heroStorage.remove(removedPaths);
      if (cleanupError) {
        cleanupWarning = true;
        console.error("Welcome hero settings were published, but old images could not be removed.", cleanupError);
      }
    }

    const getPublicUrl = (path: string) => heroStorage.getPublicUrl(path).data.publicUrl;
    return NextResponse.json({
      settings: addWelcomeHeroImageUrls(saved, getPublicUrl),
      cleanupWarning,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (admin && !settingsSaved && uploadedPaths.length) await removeUploadedImages(admin, uploadedPaths);
    console.error("Could not publish welcome hero settings.", error);
    return NextResponse.json({
      error: "Could not publish welcome hero settings. Please retry.",
      settingsCommitted: settingsSaved,
    }, { status: 503 });
  }
}
