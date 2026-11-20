import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import {
  isWelcomeHeroImageMimeType,
  parseWelcomeHeroSettings,
  WELCOME_HERO_BUCKET,
  WELCOME_HERO_IMAGE_EXTENSION_BY_MIME,
  WELCOME_HERO_MAX_IMAGE_BYTES,
  WELCOME_HERO_ORIGINAL_IMAGE_PATH_PATTERN,
} from "@/lib/welcome-hero";

export async function POST(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Submit valid hero image details." }, { status: 400 });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Hero image details are invalid." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    const contentType = values.contentType;
    const size = values.size;
    if (!isWelcomeHeroImageMimeType(contentType) || typeof size !== "number" ||
      !Number.isSafeInteger(size) || size < 1 || size > WELCOME_HERO_MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Choose a supported hero image up to 20 MB." }, { status: 400 });
    }

    const path = `${WELCOME_HERO_BUCKET}/original/${randomUUID()}.${WELCOME_HERO_IMAGE_EXTENSION_BY_MIME[contentType]}`;
    const { data, error } = await admin.storage.from(WELCOME_HERO_BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;
    return NextResponse.json({ path, token: data.token }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not prepare a welcome hero image upload.", error);
    return NextResponse.json({ error: "Could not prepare that hero image upload. Please try again." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Submit valid hero image paths." }, { status: 400 });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Hero image paths are invalid." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    if (!Array.isArray(values.paths) || values.paths.length > 6) {
      return NextResponse.json({ error: "Hero image paths are invalid." }, { status: 400 });
    }
    const paths: string[] = [];
    for (const path of values.paths) {
      if (typeof path !== "string" || !WELCOME_HERO_ORIGINAL_IMAGE_PATH_PATTERN.test(path) || paths.includes(path)) {
        return NextResponse.json({ error: "Hero image paths are invalid." }, { status: 400 });
      }
      paths.push(path);
    }
    if (!paths.length) return NextResponse.json({ removed: 0 }, { headers: { "Cache-Control": "no-store" } });

    const { data, error } = await admin.from("marketplace_settings")
      .select("welcome_hero_settings")
      .eq("id", true)
      .single();
    if (error) throw error;
    const settings = parseWelcomeHeroSettings(data.welcome_hero_settings, true);
    if (!settings) throw new Error("Saved welcome hero settings are invalid.");
    const activePaths = new Set(settings.slides.flatMap((slide) => slide.mobilePath ? [slide.path, slide.mobilePath] : [slide.path]));
    const unusedPaths = paths.filter((path) => !activePaths.has(path));
    if (!unusedPaths.length) return NextResponse.json({ removed: 0 }, { headers: { "Cache-Control": "no-store" } });

    const { error: removeError } = await admin.storage.from(WELCOME_HERO_BUCKET).remove(unusedPaths);
    if (removeError) throw removeError;
    return NextResponse.json({ removed: unusedPaths.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not remove unused welcome hero images.", error);
    return NextResponse.json({ error: "Could not remove unused hero images. Please retry." }, { status: 503 });
  }
}

