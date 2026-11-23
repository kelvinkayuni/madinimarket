"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, FileUp, Menu, RotateCcw, Save, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  WELCOME_HERO_BUCKET,
  WELCOME_HERO_RESOLUTION_TARGETS,
  WELCOME_HERO_MAX_IMAGE_BYTES,
  isWelcomeHeroImageMimeType,
  type WelcomeHeroSettings,
  type WelcomeHeroSlide,
} from "@/lib/welcome-hero";
import WelcomeHero from "./welcome-hero";

type DraftSlide = WelcomeHeroSlide & { file?: File; mobileFile?: File };
type ImageDimensions = { width: number; height: number };

function getImageResolutionNote(
  dimensions: ImageDimensions,
  device: keyof typeof WELCOME_HERO_RESOLUTION_TARGETS,
  zoom: number,
) {
  const target = WELCOME_HERO_RESOLUTION_TARGETS[device];
  const targetAspectRatio = target.width / target.height;
  const imageAspectRatio = dimensions.width / dimensions.height;
  const cropWidth = imageAspectRatio > targetAspectRatio
    ? dimensions.height * targetAspectRatio
    : dimensions.width;
  const cropHeight = imageAspectRatio > targetAspectRatio
    ? dimensions.height
    : dimensions.width / targetAspectRatio;
  const enlargement = Math.max(
    target.width / cropWidth,
    target.height / cropHeight,
  ) * zoom / 100;
  const imageSize = `${dimensions.width} x ${dimensions.height} px`;
  const heroSize = `${target.width} x ${target.height}`;
  if (enlargement > 1.02) {
    return `Source: ${imageSize}. At a standard ${heroSize} ${device} hero, it must enlarge to about ${Math.round(enlargement * 100)}% to fill and may look pixelated. Use a higher-resolution original.`;
  }
  return `Source: ${imageSize}. No enlargement expected at a standard ${heroSize} ${device} hero; larger originals look sharper on high-density screens.`;
}

function getPositionLabel(position: number, labels: [string, string, string]) {
  if (position === 0) return labels[0];
  if (position === 50) return labels[1];
  if (position === 100) return labels[2];
  return `${position}%`;
}

function HeroPositionControls({
  title,
  horizontalPosition,
  verticalPosition,
  onHorizontalPositionChange,
  onVerticalPositionChange,
}: {
  title: string;
  horizontalPosition: number;
  verticalPosition: number;
  onHorizontalPositionChange: (position: number) => void;
  onVerticalPositionChange: (position: number) => void;
}) {
  return <fieldset className="admin-welcome-hero-position-control">
    <legend>{title}</legend>
    <label className="field-label admin-welcome-hero-range">
      Horizontal position: {getPositionLabel(horizontalPosition, ["Left", "Middle", "Right"])}
      <input aria-label={`${title} horizontal position`} type="range" min={0} max={100} step={1} value={horizontalPosition} onChange={(event) => onHorizontalPositionChange(Number(event.target.value))} />
      <span className="admin-welcome-hero-range-labels"><span>Left</span><span>Middle</span><span>Right</span></span>
    </label>
    <label className="field-label admin-welcome-hero-range">
      Vertical position: {getPositionLabel(verticalPosition, ["Top", "Middle", "Bottom"])}
      <input aria-label={`${title} vertical position`} type="range" min={0} max={100} step={1} value={verticalPosition} onChange={(event) => onVerticalPositionChange(Number(event.target.value))} />
      <span className="admin-welcome-hero-range-labels"><span>Top</span><span>Middle</span><span>Bottom</span></span>
    </label>
  </fieldset>;
}

function PublicHeaderPreview({ label, mobile, position, scale }: {
  label: string;
  mobile: boolean;
  position: number;
  scale: number;
}) {
  return <div className="admin-public-header-device-preview">
    <strong>{label}</strong>
    <div
      className={`admin-public-header-preview${mobile ? " is-mobile" : ""}`}
      aria-label={`${label} public marketplace header preview`}
      style={{
        "--admin-header-preview-font-size": `${(mobile ? 16 : 24) * scale / 100}px`,
        "--admin-header-preview-icon-size": `${(mobile ? 22 : 30) * scale / 100}px`,
        "--admin-header-preview-gap": `${(mobile ? 5 : 9) * scale / 100}px`,
      } as CSSProperties & Record<`--admin-header-preview-${string}`, string>}
    >
      <div className="admin-public-header-preview-menu" aria-hidden="true"><Menu size={mobile ? 20 : 22} /></div>
      <div className="admin-public-header-preview-track">
        <div className="admin-public-header-preview-brand" style={{
          left: `${position}%`,
          transform: `translate(-${position}%, -50%)`,
        }}>
          <Image src="/madinimarket-logo.png" alt="" width={1254} height={1254} />
          <span>madini<span className="wordmark-market">market</span></span>
        </div>
      </div>
    </div>
  </div>;
}

function prepareImage(file: File): File {
  if (!isWelcomeHeroImageMimeType(file.type) || file.size < 1 || file.size > WELCOME_HERO_MAX_IMAGE_BYTES) {
    throw new Error("Choose a JPEG, PNG, WebP, or AVIF image up to 20 MB.");
  }
  return file;
}

async function removeUploadedHeroImages(paths: string[], accessToken: string) {
  if (!paths.length) return;
  const response = await fetch("/api/admin/welcome-hero/upload", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paths }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not remove unused hero image uploads.");
}

function copySettings(settings: WelcomeHeroSettings): WelcomeHeroSettings {
  return { ...settings, slides: settings.slides.map((slide) => ({ ...slide })) };
}

export default function AdminWelcomeHeroEditor({
  savedSettings,
  hidden,
  visibilityDisabled,
  onToggleVisibility,
  onSaved,
}: {
  savedSettings: WelcomeHeroSettings;
  hidden: boolean;
  visibilityDisabled: boolean;
  onToggleVisibility: (hidden: boolean) => void;
  onSaved: (settings: WelcomeHeroSettings) => void;
}) {
  const [draft, setDraft] = useState<WelcomeHeroSettings>(() => copySettings(savedSettings));
  const [previewMobile, setPreviewMobile] = useState(false);
  const [headerPreviewMobile, setHeaderPreviewMobile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [message, setMessage] = useState("");
  const [imageDimensions, setImageDimensions] = useState<Record<string, ImageDimensions>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setDraft(copySettings(savedSettings));
  }, [savedSettings]);

  useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }, []);

  const update = <Key extends keyof WelcomeHeroSettings>(key: Key, value: WelcomeHeroSettings[Key]) => {
    dirty.current = true;
    setHasDraftChanges(true);
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };
  const rememberImageDimensions = (url: string, image: HTMLImageElement) => {
    const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
    setImageDimensions((current) => {
      const previous = current[url];
      if (previous?.width === dimensions.width && previous.height === dimensions.height) return current;
      return { ...current, [url]: dimensions };
    });
  };
  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    if (draft.slides.length + files.length > 3) {
      setMessage("Choose up to three background images.");
      return;
    }
    setIsPreparingImages(true);
    setMessage("");
    try {
      const prepared = Array.from(files).map(prepareImage);
      const slides: DraftSlide[] = prepared.map((file) => {
        const url = URL.createObjectURL(file);
        objectUrls.current.add(url);
        return {
          path: "",
          headline: "",
          description: "",
          focusX: 50,
          focusY: 50,
          scale: 100,
          mobileFocusX: 50,
          mobileFocusY: 50,
          mobileScale: 100,
          url,
          file,
        };
      });
      dirty.current = true;
      setHasDraftChanges(true);
      setDraft((current) => ({ ...current, slides: [...current.slides, ...slides] }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the selected images.");
    } finally {
      setIsPreparingImages(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const replaceDesktopImage = async (index: number, file: File | null) => {
    if (!file) return;
    setIsPreparingImages(true);
    setMessage("");
    try {
      const prepared = prepareImage(file);
      const url = URL.createObjectURL(prepared);
      objectUrls.current.add(url);
      const current = draft.slides[index] as DraftSlide | undefined;
      if (!current) {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(url);
        return;
      }
      if (current.url && objectUrls.current.has(current.url)) {
        URL.revokeObjectURL(current.url);
        objectUrls.current.delete(current.url);
      }
      const updated: DraftSlide = { ...current, path: "", url, file: prepared };
      delete updated.desktopCropPath;
      const slides = [...draft.slides];
      slides[index] = updated;
      dirty.current = true;
      setHasDraftChanges(true);
      setDraft((saved) => ({ ...saved, slides }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the selected desktop image.");
    } finally {
      setIsPreparingImages(false);
    }
  };

  const replaceMobileImage = async (index: number, file: File | null) => {
    if (!file) return;
    setIsPreparingImages(true);
    setMessage("");
    try {
      const prepared = prepareImage(file);
      const url = URL.createObjectURL(prepared);
      objectUrls.current.add(url);
      const current = draft.slides[index] as DraftSlide | undefined;
      if (!current) {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(url);
        return;
      }
      if (current.mobileUrl && objectUrls.current.has(current.mobileUrl)) {
        URL.revokeObjectURL(current.mobileUrl);
        objectUrls.current.delete(current.mobileUrl);
      }
      const updated: DraftSlide = { ...current, mobileUrl: url, mobileFile: prepared };
      delete updated.mobilePath;
      delete updated.mobileCropPath;
      const slides = [...draft.slides];
      slides[index] = updated;
      dirty.current = true;
      setHasDraftChanges(true);
      setDraft((saved) => ({ ...saved, slides }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the selected phone image.");
    } finally {
      setIsPreparingImages(false);
    }
  };

  const removeMobileImage = (index: number) => {
    const slide = draft.slides[index] as DraftSlide | undefined;
    if (!slide) return;
    if (slide.mobileUrl && objectUrls.current.has(slide.mobileUrl)) {
      URL.revokeObjectURL(slide.mobileUrl);
      objectUrls.current.delete(slide.mobileUrl);
    }
    const updated: DraftSlide = { ...slide };
    delete updated.mobilePath;
    delete updated.mobileUrl;
    delete updated.mobileFile;
    delete updated.mobileCropPath;
    const slides = [...draft.slides];
    slides[index] = updated;
    update("slides", slides);
  };

  const removeSlide = (index: number) => {
    const slide = draft.slides[index] as DraftSlide | undefined;
    for (const url of [slide?.url, slide?.mobileUrl]) {
      if (url && objectUrls.current.has(url)) {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(url);
      }
    }
    dirty.current = true;
    setHasDraftChanges(true);
    update("slides", draft.slides.filter((_, slideIndex) => slideIndex !== index));
  };

  const moveSlide = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= draft.slides.length) return;
    const slides = [...draft.slides];
    [slides[index], slides[destination]] = [slides[destination], slides[index]];
    update("slides", slides);
  };

  const discard = () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
    dirty.current = false;
    setHasDraftChanges(false);
    setDraft(copySettings(savedSettings));
    setMessage("");
  };

  const save = async () => {
    if (draft.slides.some((slide) => !slide.headline.trim() || !slide.description.trim())) {
      setMessage("Add a headline and description for each background image before saving.");
      return;
    }
    setIsSaving(true);
    setMessage("");
    const uploadedPaths: string[] = [];
    let accessToken: string | null = null;
    let saveRequestStarted = false;
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Admin session expired. Sign in again to save.");
      accessToken = session.access_token;

      const uploadImage = async (file: File) => {
        const uploadResponse = await fetch("/api/admin/welcome-hero/upload", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ contentType: file.type, size: file.size }),
        });
        const ticket: unknown = await uploadResponse.json();
        const ticketRecord = typeof ticket === "object" && ticket !== null && !Array.isArray(ticket)
          ? ticket as Record<string, unknown>
          : null;
        const path = ticketRecord?.path;
        const token = ticketRecord?.token;
        if (!uploadResponse.ok || typeof path !== "string" || typeof token !== "string") {
          const errorMessage = ticketRecord?.error;
          throw new Error(typeof errorMessage === "string" ? errorMessage : "Could not prepare a hero image upload.");
        }
        uploadedPaths.push(path);
        const { error } = await supabase.storage.from(WELCOME_HERO_BUCKET).uploadToSignedUrl(
          path,
          token,
          file,
          { cacheControl: "31536000", contentType: file.type },
        );
        if (error) throw error;
        return path;
      };
      const slides: WelcomeHeroSlide[] = [];
      for (const slide of draft.slides) {
        const draftSlide = slide as DraftSlide;
        const path = draftSlide.file ? await uploadImage(draftSlide.file) : slide.path;
        const mobilePath = draftSlide.mobileFile ? await uploadImage(draftSlide.mobileFile) : slide.mobilePath;
        slides.push({
          path,
          ...(mobilePath ? { mobilePath } : {}),
          headline: slide.headline,
          description: slide.description,
          focusX: slide.focusX,
          focusY: slide.focusY,
          scale: slide.scale,
          mobileFocusX: slide.mobileFocusX,
          mobileFocusY: slide.mobileFocusY,
          mobileScale: slide.mobileScale,
        });
      }
      const firstSlide = draft.slides[0];
      const settings = {
        ...draft,
        headline: firstSlide?.headline ?? draft.headline,
        description: firstSlide?.description ?? draft.description,
        slides,
      };
      saveRequestStarted = true;
      const response = await fetch("/api/admin/welcome-hero", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });
      const result = await response.json();
      if (!response.ok || !result.settings) {
        const errorMessage = result.error ?? "Could not save the welcome hero.";
        if ((response.status < 500 || result.settingsCommitted === false) && accessToken && uploadedPaths.length) {
          try {
            await removeUploadedHeroImages(uploadedPaths, accessToken);
            uploadedPaths.length = 0;
          } catch (cleanupError) {
            const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : "Temporary hero images could not be removed.";
            throw new Error(`${errorMessage} ${cleanupMessage}`);
          }
        }
        throw new Error(errorMessage);
      }
      const saved = result.settings as WelcomeHeroSettings;
      uploadedPaths.length = 0;
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
      dirty.current = false;
      setHasDraftChanges(false);
      setDraft(copySettings(saved));
      onSaved(saved);
      setMessage(result.cleanupWarning
        ? "Hero saved, but one or more unused old images could not be removed."
        : "Welcome hero saved.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Could not save the welcome hero.";
      if (!saveRequestStarted && accessToken && uploadedPaths.length) {
        try {
          await removeUploadedHeroImages(uploadedPaths, accessToken);
          uploadedPaths.length = 0;
        } catch (cleanupError) {
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : "Temporary hero images could not be removed.";
          setMessage(`${errorMessage} ${cleanupMessage}`);
          return;
        }
      }
      setMessage(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const previewSettings = {
    ...draft,
    slides: draft.slides.map((slide) => ({ ...slide, url: slide.url })),
  };
  const publicHeaderPosition = headerPreviewMobile ? draft.publicHeaderMobilePosition : draft.publicHeaderDesktopPosition;
  const publicHeaderScale = headerPreviewMobile ? draft.publicHeaderMobileScale : draft.publicHeaderDesktopScale;
  const statusText = message || (hasDraftChanges ? "Unsaved changes" : "Changes are saved");

  return <section className="admin-welcome-hero-editor" aria-labelledby="admin-welcome-hero-heading">
    <div className="admin-welcome-hero-header">
      <div className="admin-queue-heading">
        <div><span>WELCOME HERO</span><h3 id="admin-welcome-hero-heading">Hero content and design</h3></div>
      </div>
      <button
        className="admin-welcome-hero-visibility"
        type="button"
        role="switch"
        aria-checked={hidden}
        aria-label={hidden ? "Show welcome hero" : "Hide welcome hero"}
        disabled={visibilityDisabled}
        onClick={() => onToggleVisibility(!hidden)}
      >
        {hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
        {hidden ? "Show hero" : "Hide hero"}
      </button>
    </div>
    <div className="admin-welcome-hero-preview-heading">
      <strong><Eye size={15} aria-hidden="true" /> Live preview</strong>
      <div role="group" aria-label="Preview size">
        <button className={!previewMobile ? "is-active" : ""} type="button" aria-pressed={!previewMobile} onClick={() => setPreviewMobile(false)}>Desktop</button>
        <button className={previewMobile ? "is-active" : ""} type="button" aria-pressed={previewMobile} onClick={() => setPreviewMobile(true)}>Mobile</button>
      </div>
    </div>
    <div className={`admin-welcome-hero-preview${previewMobile ? " is-mobile" : ""}`}>
      <WelcomeHero settings={previewSettings} marketHoursLoaded marketHoursError="" marketIsOpen preview previewMobile={previewMobile} />
    </div>
    <div className="admin-welcome-hero-fields">
      <label className="field-label">Eyebrow<input className="text-input" maxLength={36} value={draft.eyebrow} onChange={(event) => update("eyebrow", event.target.value)} /></label>
      {draft.slides.length === 0 && <>
        <label className="field-label">Headline<input className="text-input" maxLength={100} value={draft.headline} onChange={(event) => update("headline", event.target.value)} /></label>
        <label className="field-label admin-welcome-hero-description">Description<textarea className="text-input" maxLength={320} rows={3} value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
      </>}
      <label className="field-label">Sell a mineral button label<input className="text-input" maxLength={32} value={draft.sellLabel} onChange={(event) => update("sellLabel", event.target.value)} /></label>
      <label className="field-label">Request button label<input className="text-input" maxLength={32} value={draft.requestLabel} onChange={(event) => update("requestLabel", event.target.value)} /></label>
      <label className="field-label">Explore minerals link label<input className="text-input" maxLength={80} value={draft.exploreLinkLabel} onChange={(event) => update("exploreLinkLabel", event.target.value)} /></label>
      <label className="field-label">Buyer browse link label<input className="text-input" maxLength={80} value={draft.buyerBrowseLinkLabel} onChange={(event) => update("buyerBrowseLinkLabel", event.target.value)} /></label>
      <fieldset className="admin-welcome-hero-position-control admin-welcome-header-control">
        <legend>Public marketplace header</legend>
        <p>Desktop and phone header settings are independent. Admin and staff headers stay the same.</p>
        <div className="admin-welcome-hero-preview-heading">
          <strong>Live header preview</strong>
          <div role="group" aria-label="Public header preview device">
            <button className={!headerPreviewMobile ? "is-active" : ""} type="button" aria-pressed={!headerPreviewMobile} onClick={() => setHeaderPreviewMobile(false)}>Desktop</button>
            <button className={headerPreviewMobile ? "is-active" : ""} type="button" aria-pressed={headerPreviewMobile} onClick={() => setHeaderPreviewMobile(true)}>Phone</button>
          </div>
        </div>
        <PublicHeaderPreview label={headerPreviewMobile ? "Phone preview" : "Desktop preview"} mobile={headerPreviewMobile} position={publicHeaderPosition} scale={publicHeaderScale} />
        <fieldset className="admin-welcome-hero-position-control">
          <legend>{headerPreviewMobile ? "Phone settings" : "Desktop settings"}</legend>
          <label className="field-label admin-welcome-hero-range">
            Horizontal position: {publicHeaderPosition === 0 ? "Default" : publicHeaderPosition === 50 ? "Middle" : publicHeaderPosition === 100 ? "Right" : `${publicHeaderPosition}% right`}
            <input aria-label={`${headerPreviewMobile ? "Phone" : "Desktop"} public header horizontal position`} type="range" min={0} max={100} step={1} value={publicHeaderPosition} onChange={(event) => update(headerPreviewMobile ? "publicHeaderMobilePosition" : "publicHeaderDesktopPosition", Number(event.target.value))} />
            <span className="admin-welcome-hero-range-labels"><span>Default</span><span>Middle</span><span>Right</span></span>
          </label>
          <label className="field-label admin-welcome-hero-range">
            Logo and text size: {publicHeaderScale}% of default size
            <input aria-label={`${headerPreviewMobile ? "Phone" : "Desktop"} public header logo and text size`} type="range" min={70} max={300} step={1} value={publicHeaderScale} onChange={(event) => update(headerPreviewMobile ? "publicHeaderMobileScale" : "publicHeaderDesktopScale", Number(event.target.value))} />
            <span className="admin-welcome-hero-range-labels"><span>70%</span><span>Default · 100%</span><span>300%</span></span>
          </label>
        </fieldset>
      </fieldset>
      <label className="field-label">Hero height
        <select className="text-input" value={draft.heightMode} onChange={(event) => update("heightMode", event.target.value as WelcomeHeroSettings["heightMode"])}>
          <option value="default">Default</option>
          <option value="fit-screen">Fit available screen</option>
          <option value="full-screen">Full screen</option>
        </select>
      </label>
      <details className="admin-welcome-hero-position-panel" open>
        <summary>Element positions <span>Adjust each group independently; use the live preview to avoid overlap.</span></summary>
        <div className="admin-welcome-hero-position-layouts">
          <section className="admin-welcome-hero-position-layout" aria-label="Desktop element positions">
            <h4>Desktop</h4>
            <HeroPositionControls
              title="Headline and description"
              horizontalPosition={draft.desktopCopyHorizontalPosition}
              verticalPosition={draft.desktopCopyVerticalPosition}
              onHorizontalPositionChange={(position) => update("desktopCopyHorizontalPosition", position)}
              onVerticalPositionChange={(position) => update("desktopCopyVerticalPosition", position)}
            />
            <HeroPositionControls
              title="Sell and request buttons"
              horizontalPosition={draft.desktopActionsHorizontalPosition}
              verticalPosition={draft.desktopActionsVerticalPosition}
              onHorizontalPositionChange={(position) => update("desktopActionsHorizontalPosition", position)}
              onVerticalPositionChange={(position) => update("desktopActionsVerticalPosition", position)}
            />
            <HeroPositionControls
              title="Explore and browse links"
              horizontalPosition={draft.desktopLinksHorizontalPosition}
              verticalPosition={draft.desktopLinksVerticalPosition}
              onHorizontalPositionChange={(position) => update("desktopLinksHorizontalPosition", position)}
              onVerticalPositionChange={(position) => update("desktopLinksVerticalPosition", position)}
            />
          </section>
          <section className="admin-welcome-hero-position-layout" aria-label="Phone element positions">
            <h4>Phone</h4>
            <HeroPositionControls
              title="Headline and description"
              horizontalPosition={draft.mobileCopyHorizontalPosition}
              verticalPosition={draft.mobileCopyVerticalPosition}
              onHorizontalPositionChange={(position) => update("mobileCopyHorizontalPosition", position)}
              onVerticalPositionChange={(position) => update("mobileCopyVerticalPosition", position)}
            />
            <HeroPositionControls
              title="Sell and request buttons"
              horizontalPosition={draft.mobileActionsHorizontalPosition}
              verticalPosition={draft.mobileActionsVerticalPosition}
              onHorizontalPositionChange={(position) => update("mobileActionsHorizontalPosition", position)}
              onVerticalPositionChange={(position) => update("mobileActionsVerticalPosition", position)}
            />
            <HeroPositionControls
              title="Explore and browse links"
              horizontalPosition={draft.mobileLinksHorizontalPosition}
              verticalPosition={draft.mobileLinksVerticalPosition}
              onHorizontalPositionChange={(position) => update("mobileLinksHorizontalPosition", position)}
              onVerticalPositionChange={(position) => update("mobileLinksVerticalPosition", position)}
            />
          </section>
        </div>
      </details>
      <label className="field-label">Slide animation
        <select className="text-input" value={draft.transition} onChange={(event) => update("transition", event.target.value as WelcomeHeroSettings["transition"])}>
          <option value="appear">Appear</option>
          <option value="fade">Fade</option>
          <option value="fly-in">Fly in</option>
          <option value="slide">Slide</option>
          <option value="split">Split</option>
          <option value="shape-wipe">Shape wipe</option>
          <option value="wheel">Wheel</option>
          <option value="random-bars">Random bars</option>
          <option value="grow-turn">Grow and turn</option>
          <option value="zoom">Zoom</option>
        </select>
      </label>
      <label className="field-label">Change slides every
        <select className="text-input" value={draft.slideIntervalSeconds} onChange={(event) => update("slideIntervalSeconds", Number(event.target.value) as WelcomeHeroSettings["slideIntervalSeconds"])}>
          <option value={5}>5 seconds</option>
          <option value={10}>10 seconds</option>
          <option value={15}>15 seconds</option>
          <option value={20}>20 seconds</option>
          <option value={30}>30 seconds</option>
        </select>
      </label>
      <label className="field-label">Transition duration
        <select className="text-input" value={draft.transitionDurationMs} onChange={(event) => update("transitionDurationMs", Number(event.target.value) as WelcomeHeroSettings["transitionDurationMs"])}>
          <option value={500}>0.5 seconds</option>
          <option value={1000}>1 second</option>
          <option value={1500}>1.5 seconds</option>
          <option value={2000}>2 seconds</option>
          <option value={3000}>3 seconds</option>
        </select>
      </label>
    </div>

    <div className="admin-welcome-hero-colors">
      {([
        ["Background", "backgroundColor"],
        ["Text shadow", "overlayColor"],
        ["Headline", "headingColor"],
        ["Description", "bodyColor"],
        ["Accent", "accentColor"],
        ["Sell a mineral button", "buttonColor"],
        ["Sell a mineral button text", "buttonTextColor"],
        ["Request button", "requestButtonColor"],
        ["Request button text", "requestButtonTextColor"],
      ] as const).map(([label, key]) => <label className="admin-welcome-hero-color" key={key}>
        <span>{label}</span>
        <input aria-label={`${label} color`} type="color" value={draft[key]} onChange={(event) => update(key, event.target.value)} />
      </label>)}
      <label className="field-label admin-welcome-hero-range">Text shadow strength: {draft.overlayOpacity}%
        <input type="range" min={0} max={100} step={1} value={draft.overlayOpacity} onChange={(event) => update("overlayOpacity", Number(event.target.value))} />
      </label>
      <label className="field-label">Font family
        <select className="text-input" value={draft.fontFamily} onChange={(event) => update("fontFamily", event.target.value as WelcomeHeroSettings["fontFamily"])}>
          <option value="serif">Serif</option><option value="sans">Sans serif</option>
        </select>
      </label>
      <label className="field-label">Font weight
        <select className="text-input" value={draft.fontWeight} onChange={(event) => update("fontWeight", Number(event.target.value) as WelcomeHeroSettings["fontWeight"])}>
          <option value={400}>Regular</option><option value={500}>Medium</option><option value={600}>Semibold</option><option value={700}>Bold</option>
        </select>
      </label>
      <label className="field-label">Description font weight
        <select className="text-input" value={draft.descriptionFontWeight} onChange={(event) => update("descriptionFontWeight", Number(event.target.value) as WelcomeHeroSettings["descriptionFontWeight"])}>
          <option value={400}>Regular</option><option value={500}>Medium</option><option value={600}>Semibold</option><option value={700}>Bold</option>
        </select>
      </label>
      <label className="field-label">Explore and buyer browse links font weight
        <select className="text-input" value={draft.secondaryLinksFontWeight} onChange={(event) => update("secondaryLinksFontWeight", Number(event.target.value) as WelcomeHeroSettings["secondaryLinksFontWeight"])}>
          <option value={400}>Regular</option><option value={500}>Medium</option><option value={600}>Semibold</option><option value={700}>Bold</option>
        </select>
      </label>
      <label className="field-label admin-welcome-hero-range">Desktop heading: {draft.desktopFontSize}px
        <input type="range" min={40} max={78} step={1} value={draft.desktopFontSize} onChange={(event) => update("desktopFontSize", Number(event.target.value))} />
      </label>
      <label className="field-label admin-welcome-hero-range">Mobile heading: {draft.mobileFontSize}px
        <input type="range" min={32} max={56} step={1} value={draft.mobileFontSize} onChange={(event) => update("mobileFontSize", Number(event.target.value))} />
      </label>
    </div>

    <div className="admin-welcome-hero-images">
      <div className="admin-queue-heading"><div><span>BACKGROUND IMAGES</span><h4>{draft.slides.length} of 3 desktop slides</h4></div></div>
      <p className="admin-welcome-hero-image-note">The homepage displays each uploaded original directly—no generated crop or re-encoded display copy is used. Desktop and phone focal points affect how the original is shown, not the file. Check the resolution warning because a full-width hero can still enlarge a low-resolution image.</p>
      {draft.slides.map((slide, index) => {
        const draftSlide = slide as DraftSlide;
        const hasMobileImage = Boolean(draftSlide.mobilePath || draftSlide.mobileFile);
        const desktopSourceUrl = slide.url;
        const phoneSourceUrl = hasMobileImage
          ? draftSlide.mobileUrl
          : desktopSourceUrl;
        const desktopDimensions = desktopSourceUrl ? imageDimensions[desktopSourceUrl] : undefined;
        const phoneDimensions = phoneSourceUrl ? imageDimensions[phoneSourceUrl] : undefined;
        const desktopResolutionNote = desktopDimensions
          ? getImageResolutionNote(desktopDimensions, "desktop", slide.scale)
          : null;
        const phoneResolutionNote = phoneDimensions
          ? getImageResolutionNote(phoneDimensions, "phone", slide.mobileScale)
          : null;
        return <article className="admin-welcome-hero-image" key={slide.path || slide.url || index}>
          {slide.url ? <Image src={slide.url} alt={`Desktop welcome hero background ${index + 1}`} width={360} height={180} unoptimized onLoad={(event) => rememberImageDimensions(slide.url!, event.currentTarget)} /> : <div className="admin-welcome-hero-image-empty">Desktop preview</div>}
          <div className="admin-welcome-hero-image-controls">
            <strong>Desktop image {index + 1}</strong>
            {slide.url && <small className={`admin-welcome-hero-resolution${desktopResolutionNote?.includes("may look pixelated") ? " is-warning" : ""}`}>
              {desktopResolutionNote ?? "Reading desktop image dimensions…"}
            </small>}
            <div className="admin-welcome-hero-image-actions">
              <button type="button" aria-label={`Move image ${index + 1} up`} disabled={isPreparingImages || index === 0} onClick={() => moveSlide(index, -1)}><ArrowUp size={15} /></button>
              <button type="button" aria-label={`Move image ${index + 1} down`} disabled={isPreparingImages || index === draft.slides.length - 1} onClick={() => moveSlide(index, 1)}><ArrowDown size={15} /></button>
              <button type="button" aria-label={`Remove image ${index + 1}`} disabled={isPreparingImages} onClick={() => removeSlide(index)}><Trash2 size={15} /></button>
            </div>
            <label className={`button button-outline admin-welcome-hero-upload${isPreparingImages ? " is-disabled" : ""}`}>
              <FileUp size={14} aria-hidden="true" /> Replace desktop image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                disabled={isPreparingImages}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  if (file) void replaceDesktopImage(index, file);
                }}
              />
            </label>
            <label>Headline for image {index + 1}
              <input className="text-input" maxLength={100} value={slide.headline} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, headline: event.target.value } : current))} />
            </label>
            <label>Description for image {index + 1}
              <textarea className="text-input" maxLength={320} rows={3} value={slide.description} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, description: event.target.value } : current))} />
            </label>
            <label>Desktop horizontal focal point: {slide.focusX}%
              <input type="range" min={0} max={100} step={1} value={slide.focusX} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, focusX: Number(event.target.value) } : current))} />
            </label>
            <label>Desktop vertical focal point: {slide.focusY}%
              <input type="range" min={0} max={100} step={1} value={slide.focusY} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, focusY: Number(event.target.value) } : current))} />
            </label>
            <label>Desktop image zoom: {slide.scale}%
              <input type="range" min={70} max={160} step={1} value={slide.scale} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, scale: Number(event.target.value) } : current))} />
            </label>
            <div className="admin-welcome-hero-mobile-image">
              {hasMobileImage
                ? draftSlide.mobileUrl
                  ? <Image src={draftSlide.mobileUrl} alt={`Phone welcome hero background ${index + 1}`} width={80} height={100} unoptimized onLoad={(event) => rememberImageDimensions(draftSlide.mobileUrl!, event.currentTarget)} />
                  : <div className="admin-welcome-hero-mobile-image-empty">Phone preview</div>
                : <div className="admin-welcome-hero-mobile-image-empty">Using desktop image</div>}
              <div className="admin-welcome-hero-mobile-image-controls">
                <strong>Phone image</strong>
                {phoneResolutionNote && <small className={`admin-welcome-hero-resolution${phoneResolutionNote.includes("may look pixelated") ? " is-warning" : ""}`}>
                  {phoneResolutionNote}
                </small>}
                <label className={`button button-outline admin-welcome-hero-upload${isPreparingImages ? " is-disabled" : ""}`}>
                  <FileUp size={14} aria-hidden="true" /> {hasMobileImage ? "Replace phone image" : "Add phone image"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    disabled={isPreparingImages}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      event.currentTarget.value = "";
                      if (file) void replaceMobileImage(index, file);
                    }}
                  />
                </label>
                {hasMobileImage && <button className="button button-outline" type="button" disabled={isPreparingImages} onClick={() => removeMobileImage(index)}>Use desktop image</button>}
              </div>
            </div>
            <label>Phone horizontal focal point: {slide.mobileFocusX}%
              <input type="range" min={0} max={100} step={1} value={slide.mobileFocusX} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, mobileFocusX: Number(event.target.value) } : current))} />
            </label>
            <label>Phone vertical focal point: {slide.mobileFocusY}%
              <input type="range" min={0} max={100} step={1} value={slide.mobileFocusY} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, mobileFocusY: Number(event.target.value) } : current))} />
            </label>
            <label>Phone image zoom: {slide.mobileScale}%
              <input type="range" min={70} max={160} step={1} value={slide.mobileScale} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, mobileScale: Number(event.target.value) } : current))} />
            </label>
          </div>
        </article>;
      })}
      {draft.slides.length < 3 && <label className={`button button-outline admin-welcome-hero-upload${isPreparingImages ? " is-disabled" : ""}`}>
        <FileUp size={15} aria-hidden="true" /> {isPreparingImages ? "Checking images…" : "Add background images"}
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple disabled={isPreparingImages} onChange={(event) => void addImages(event.target.files)} />
      </label>}
    </div>

    <div className="admin-welcome-hero-save">
      <span className={message && !message.startsWith("Welcome hero saved") && !message.startsWith("Hero saved") ? "is-error" : ""} role="status">{statusText}</span>
      <div>
        <button className="button button-outline" type="button" disabled={isSaving || isPreparingImages} onClick={discard}><RotateCcw size={14} /> Discard</button>
        <button className="button button-dark" type="button" disabled={isSaving || isPreparingImages} onClick={() => void save()}>{isSaving ? "Saving…" : <><Save size={14} /> Save changes</>}</button>
      </div>
    </div>
  </section>;
}
