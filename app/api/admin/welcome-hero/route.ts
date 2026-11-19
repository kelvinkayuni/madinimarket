import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import {
  addWelcomeHeroImageUrls,
  parseWelcomeHeroSettings,
  WELCOME_HERO_MAX_IMAGE_BYTES,
  WELCOME_HERO_MAX_TOTAL_IMAGE_BYTES,
  WELCOME_HERO_BUCKET,
  type WelcomeHeroSettings,
  type WelcomeHeroSlide,
} from "@/lib/welcome-hero";

type DraftSlide = {
  path?: string;
  uploadIndex?: number;
  headline?: string;
  description?: string;
  focusX: number;
  focusY: number;
  scale: number;
  mobilePath?: string;
  mobileUploadIndex?: number;
  mobileFocusX: number;
  mobileFocusY: number;
  mobileScale: number;
};

function isJpeg(bytes: Buffer) {
  return bytes.length > 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

function parseDraftSlides(value: unknown): DraftSlide[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const slides: DraftSlide[] = [];
  const paths = new Set<string>();
  const uploadIndices = new Set<number>();
  const mobileUploadIndices = new Set<number>();
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
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
    const draft: DraftSlide = {
      ...(typeof slide.headline === "string" ? { headline: slide.headline } : {}),
      ...(typeof slide.description === "string" ? { description: slide.description } : {}),
      focusX: slide.focusX,
      focusY: slide.focusY,
      scale,
      mobileFocusX,
      mobileFocusY,
      mobileScale,
    };
    if (typeof slide.path === "string" && slide.uploadIndex === undefined &&
      /^homepage-hero\/[0-9a-f-]{36}\.jpg$/i.test(slide.path) && !paths.has(slide.path)) {
      paths.add(slide.path);
      draft.path = slide.path;
    } else if (slide.path === undefined && typeof slide.uploadIndex === "number" &&
      Number.isSafeInteger(slide.uploadIndex) && slide.uploadIndex === index && !uploadIndices.has(slide.uploadIndex)) {
      uploadIndices.add(slide.uploadIndex);
      draft.uploadIndex = slide.uploadIndex;
    } else {
      return null;
    }

    if (slide.mobilePath !== undefined && slide.mobileUploadIndex !== undefined) return null;
    if (typeof slide.mobilePath === "string" &&
      /^homepage-hero\/[0-9a-f-]{36}\.jpg$/i.test(slide.mobilePath) && !paths.has(slide.mobilePath)) {
      paths.add(slide.mobilePath);
      draft.mobilePath = slide.mobilePath;
    } else if (slide.mobilePath === undefined && typeof slide.mobileUploadIndex === "number" &&
      Number.isSafeInteger(slide.mobileUploadIndex) && slide.mobileUploadIndex === index &&
      !mobileUploadIndices.has(slide.mobileUploadIndex)) {
      mobileUploadIndices.add(slide.mobileUploadIndex);
      draft.mobileUploadIndex = slide.mobileUploadIndex;
    } else if (slide.mobilePath !== undefined || slide.mobileUploadIndex !== undefined) {
      return null;
    }

    slides.push(draft);
  }
  return slides;
}

async function removeUploadedImages(admin: Awaited<ReturnType<typeof getAdminClient>>, paths: string[]) {
  if (!admin || !paths.length) return;
  const { error } = await admin.storage.from(WELCOME_HERO_BUCKET).remove(paths);
  if (error) console.error("Could not remove unpublished welcome hero images.", error);
}

export async function POST(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Submit valid welcome hero settings." }, { status: 400 });
    }

    const settingsEntry = form.get("settings");
    if (typeof settingsEntry !== "string") {
      return NextResponse.json({ error: "Welcome hero settings are required." }, { status: 400 });
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(settingsEntry);
    } catch {
      return NextResponse.json({ error: "Welcome hero settings must be valid JSON." }, { status: 400 });
    }
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return NextResponse.json({ error: "Welcome hero settings are invalid." }, { status: 400 });
    }
    const values = candidate as Record<string, unknown>;
    const draftSlides = parseDraftSlides(values.slides);
    const design = parseWelcomeHeroSettings({ ...values, slides: [] });
    if (!draftSlides || !design) {
      return NextResponse.json({ error: "Check the welcome hero text, colors, font sizes, layout options, and images." }, { status: 400 });
    }

    const oldSettingsResult = await admin.from("marketplace_settings")
      .select("welcome_hero_settings")
      .eq("id", true)
      .single();
    if (oldSettingsResult.error) throw oldSettingsResult.error;
    const oldSettings = parseWelcomeHeroSettings(oldSettingsResult.data.welcome_hero_settings, true);
    if (!oldSettings) throw new Error("Saved welcome hero settings are invalid.");
    const oldPaths = new Set(oldSettings.slides.flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path]));
    const uploadedPaths: string[] = [];
    const slides: WelcomeHeroSlide[] = [];
    let totalImageBytes = 0;

    for (let index = 0; index < draftSlides.length; index += 1) {
      const slide = draftSlides[index];
      let path: string;
      if (slide.path) {
        if (!oldPaths.has(slide.path)) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "Only currently saved welcome hero images can be reused." }, { status: 400 });
        }
        path = slide.path;
      } else {
        const fileEntry = form.get(`image-${slide.uploadIndex}`);
        if (!(fileEntry instanceof File) || fileEntry.type !== "image/jpeg" ||
          fileEntry.size < 1 || fileEntry.size > WELCOME_HERO_MAX_IMAGE_BYTES) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "Each hero image must be an optimized JPEG up to 1.2 MB." }, { status: 400 });
        }
        totalImageBytes += fileEntry.size;
        if (totalImageBytes > WELCOME_HERO_MAX_TOTAL_IMAGE_BYTES) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "New welcome hero image uploads must total 3.6 MB or less. Save them in smaller batches." }, { status: 400 });
        }
        const bytes = Buffer.from(await fileEntry.arrayBuffer());
        if (!isJpeg(bytes)) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "A welcome hero image is not a valid JPEG." }, { status: 400 });
        }

        path = `homepage-hero/${randomUUID()}.jpg`;
        const { error: uploadError } = await admin.storage.from(WELCOME_HERO_BUCKET).upload(path, bytes, {
          contentType: "image/jpeg",
          upsert: false,
        });
        if (uploadError) {
          await removeUploadedImages(admin, uploadedPaths);
          throw uploadError;
        }
        uploadedPaths.push(path);
      }

      let mobilePath: string | undefined;
      if (slide.mobilePath) {
        if (!oldPaths.has(slide.mobilePath)) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "Only currently saved welcome hero images can be reused." }, { status: 400 });
        }
        mobilePath = slide.mobilePath;
      } else if (slide.mobileUploadIndex !== undefined) {
        const fileEntry = form.get(`mobile-image-${slide.mobileUploadIndex}`);
        if (!(fileEntry instanceof File) || fileEntry.type !== "image/jpeg" ||
          fileEntry.size < 1 || fileEntry.size > WELCOME_HERO_MAX_IMAGE_BYTES) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "Each phone hero image must be an optimized JPEG up to 1.2 MB." }, { status: 400 });
        }
        totalImageBytes += fileEntry.size;
        if (totalImageBytes > WELCOME_HERO_MAX_TOTAL_IMAGE_BYTES) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "New welcome hero image uploads must total 3.6 MB or less. Save them in smaller batches." }, { status: 400 });
        }
        const bytes = Buffer.from(await fileEntry.arrayBuffer());
        if (!isJpeg(bytes)) {
          await removeUploadedImages(admin, uploadedPaths);
          return NextResponse.json({ error: "A phone welcome hero image is not a valid JPEG." }, { status: 400 });
        }

        mobilePath = `homepage-hero/${randomUUID()}.jpg`;
        const { error: uploadError } = await admin.storage.from(WELCOME_HERO_BUCKET).upload(mobilePath, bytes, {
          contentType: "image/jpeg",
          upsert: false,
        });
        if (uploadError) {
          await removeUploadedImages(admin, uploadedPaths);
          throw uploadError;
        }
        uploadedPaths.push(mobilePath);
      }

      slides.push({
        path,
        headline: slide.headline ?? design.headline,
        description: slide.description ?? design.description,
        focusX: slide.focusX,
        focusY: slide.focusY,
        scale: slide.scale,
        ...(mobilePath ? { mobilePath } : {}),
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
    if (saveError) {
      await removeUploadedImages(admin, uploadedPaths);
      throw saveError;
    }
    const saved = parseWelcomeHeroSettings(savedRow.welcome_hero_settings);
    if (!saved) throw new Error("Saved welcome hero settings are invalid.");

    const retainedPaths = new Set(saved.slides.flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path]));
    const removedPaths = oldSettings.slides
      .flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path])
      .filter((path) => !retainedPaths.has(path));
    let cleanupWarning = false;
    if (removedPaths.length) {
      const { error: cleanupError } = await admin.storage.from(WELCOME_HERO_BUCKET).remove(removedPaths);
      if (cleanupError) {
        cleanupWarning = true;
        console.error("Welcome hero settings were published, but old images could not be removed.", cleanupError);
      }
    }

    const getPublicUrl = (path: string) => admin.storage.from(WELCOME_HERO_BUCKET).getPublicUrl(path).data.publicUrl;
    return NextResponse.json({
      settings: addWelcomeHeroImageUrls(saved, getPublicUrl),
      cleanupWarning,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not publish welcome hero settings.", error);
    return NextResponse.json({ error: "Could not publish welcome hero settings. Please retry." }, { status: 503 });
  }
}
