"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, FileUp, RotateCcw, Save, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  WELCOME_HERO_MAX_IMAGE_BYTES,
  WELCOME_HERO_MAX_TOTAL_IMAGE_BYTES,
  type WelcomeHeroSettings,
  type WelcomeHeroSlide,
} from "@/lib/welcome-hero";
import WelcomeHero from "./welcome-hero";

type DraftSlide = WelcomeHeroSlide & { file?: File; mobileFile?: File };

function optimizeImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size > 20_000_000) {
    throw new Error("Choose image files smaller than 20 MB.");
  }
  return createImageBitmap(file).then((bitmap) => {
    const scale = Math.min(1, 2200 / bitmap.width, 2200 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("Could not prepare that image for upload.");
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const encode = (quality: number) => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare that image for upload.")), "image/jpeg", quality);
    });
    const compress = async () => {
      let quality = 0.88;
      let blob = await encode(quality);
      while (blob.size > WELCOME_HERO_MAX_IMAGE_BYTES && quality > 0.42) {
        quality -= 0.1;
        blob = await encode(quality);
      }
      if (blob.size > WELCOME_HERO_MAX_IMAGE_BYTES) throw new Error(`${file.name} is too large to optimize. Choose a smaller image.`);
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "hero-image"}.jpg`, { type: "image/jpeg" });
    };
    return compress();
  });
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
  const [isSaving, setIsSaving] = useState(false);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [message, setMessage] = useState("");
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
  const horizontalPositionLabel = draft.actionsHorizontalPosition === 0
    ? "Left"
    : draft.actionsHorizontalPosition === 50
      ? "Middle"
      : draft.actionsHorizontalPosition === 100
        ? "Right"
        : `${draft.actionsHorizontalPosition}%`;

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    if (draft.slides.length + files.length > 3) {
      setMessage("Choose up to three background images.");
      return;
    }
    setIsPreparingImages(true);
    setMessage("");
    try {
      const prepared = await Promise.all(Array.from(files).map(optimizeImage));
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

  const replaceMobileImage = async (index: number, file: File | null) => {
    if (!file) return;
    setIsPreparingImages(true);
    setMessage("");
    try {
      const prepared = await optimizeImage(file);
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
    const newImageBytes = draft.slides.reduce((total, slide) => {
      const draftSlide = slide as DraftSlide;
      return total + (draftSlide.file?.size ?? 0) + (draftSlide.mobileFile?.size ?? 0);
    }, 0);
    if (newImageBytes > WELCOME_HERO_MAX_TOTAL_IMAGE_BYTES) {
      setMessage("New image uploads must total 3.6 MB or less. Save them in smaller batches.");
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const form = new FormData();
      const slides = draft.slides.map((slide, index) => {
        const draftSlide = slide as DraftSlide;
        if (draftSlide.file) {
          form.append(`image-${index}`, draftSlide.file);
        }
        if (draftSlide.mobileFile) {
          form.append(`mobile-image-${index}`, draftSlide.mobileFile);
        }
        return {
          ...(draftSlide.file ? { uploadIndex: index } : { path: slide.path }),
          ...(draftSlide.mobileFile
            ? { mobileUploadIndex: index }
            : slide.mobilePath ? { mobilePath: slide.mobilePath } : {}),
          headline: slide.headline,
          description: slide.description,
          focusX: slide.focusX,
          focusY: slide.focusY,
          scale: slide.scale,
          mobileFocusX: slide.mobileFocusX,
          mobileFocusY: slide.mobileFocusY,
          mobileScale: slide.mobileScale,
        };
      });
      const firstSlide = draft.slides[0];
      form.append("settings", JSON.stringify({
        ...draft,
        headline: firstSlide?.headline ?? draft.headline,
        description: firstSlide?.description ?? draft.description,
        slides,
      }));
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Admin session expired. Sign in again to save.");
      const response = await fetch("/api/admin/welcome-hero", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.settings) {
        throw new Error(result.error ?? "Could not save the welcome hero.");
      }
      const saved = result.settings as WelcomeHeroSettings;
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
      setMessage(error instanceof Error ? error.message : "Could not save the welcome hero.");
    } finally {
      setIsSaving(false);
    }
  };

  const previewSettings = {
    ...draft,
    slides: draft.slides.map((slide) => ({ ...slide, url: slide.url })),
  };
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
      <label className="field-label">Hero height
        <select className="text-input" value={draft.heightMode} onChange={(event) => update("heightMode", event.target.value as WelcomeHeroSettings["heightMode"])}>
          <option value="default">Default</option>
          <option value="fit-screen">Fit available screen</option>
          <option value="full-screen">Full screen</option>
        </select>
      </label>
      <label className="field-label">Phone button position
        <select className="text-input" value={draft.mobileActionsPosition} onChange={(event) => update("mobileActionsPosition", event.target.value as WelcomeHeroSettings["mobileActionsPosition"])}>
          <option value="top">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </label>
      <label className="field-label admin-welcome-hero-range">
        Horizontal button position: {horizontalPositionLabel}
        <input aria-label="Horizontal button position" type="range" min={0} max={100} step={1} value={draft.actionsHorizontalPosition} onChange={(event) => update("actionsHorizontalPosition", Number(event.target.value))} />
        <span className="admin-welcome-hero-range-labels"><span>Left</span><span>Middle</span><span>Right</span></span>
      </label>
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
        ["Overlay", "overlayColor"],
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
      <label className="field-label admin-welcome-hero-range">Overlay strength: {draft.overlayOpacity}%
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
      <label className="field-label admin-welcome-hero-range">Desktop heading: {draft.desktopFontSize}px
        <input type="range" min={40} max={78} step={1} value={draft.desktopFontSize} onChange={(event) => update("desktopFontSize", Number(event.target.value))} />
      </label>
      <label className="field-label admin-welcome-hero-range">Mobile heading: {draft.mobileFontSize}px
        <input type="range" min={32} max={56} step={1} value={draft.mobileFontSize} onChange={(event) => update("mobileFontSize", Number(event.target.value))} />
      </label>
    </div>

    <div className="admin-welcome-hero-images">
      <div className="admin-queue-heading"><div><span>BACKGROUND IMAGES</span><h4>{draft.slides.length} of 3 desktop slides</h4></div></div>
      {draft.slides.map((slide, index) => {
        const draftSlide = slide as DraftSlide;
        const hasMobileImage = Boolean(draftSlide.mobilePath || draftSlide.mobileFile);
        return <article className="admin-welcome-hero-image" key={slide.path || slide.url || index}>
          {slide.url ? <Image src={slide.url} alt={`Desktop welcome hero background ${index + 1}`} width={360} height={180} unoptimized /> : <div className="admin-welcome-hero-image-empty">Desktop preview</div>}
          <div className="admin-welcome-hero-image-controls">
            <strong>Desktop image {index + 1}</strong>
            <div className="admin-welcome-hero-image-actions">
              <button type="button" aria-label={`Move image ${index + 1} up`} disabled={isPreparingImages || index === 0} onClick={() => moveSlide(index, -1)}><ArrowUp size={15} /></button>
              <button type="button" aria-label={`Move image ${index + 1} down`} disabled={isPreparingImages || index === draft.slides.length - 1} onClick={() => moveSlide(index, 1)}><ArrowDown size={15} /></button>
              <button type="button" aria-label={`Remove image ${index + 1}`} disabled={isPreparingImages} onClick={() => removeSlide(index)}><Trash2 size={15} /></button>
            </div>
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
            <label>Desktop image size: {slide.scale}%
              <input type="range" min={70} max={160} step={1} value={slide.scale} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, scale: Number(event.target.value) } : current))} />
            </label>
            <div className="admin-welcome-hero-mobile-image">
              {hasMobileImage
                ? draftSlide.mobileUrl
                  ? <Image src={draftSlide.mobileUrl} alt={`Phone welcome hero background ${index + 1}`} width={80} height={100} unoptimized />
                  : <div className="admin-welcome-hero-mobile-image-empty">Phone preview</div>
                : <div className="admin-welcome-hero-mobile-image-empty">Using desktop image</div>}
              <div className="admin-welcome-hero-mobile-image-controls">
                <strong>Phone image</strong>
                <label className={`button button-outline admin-welcome-hero-upload${isPreparingImages ? " is-disabled" : ""}`}>
                  <FileUp size={14} aria-hidden="true" /> {hasMobileImage ? "Replace phone image" : "Add phone image"}
                  <input
                    type="file"
                    accept="image/*"
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
            <label>Phone image size: {slide.mobileScale}%
              <input type="range" min={70} max={160} step={1} value={slide.mobileScale} disabled={isPreparingImages} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, mobileScale: Number(event.target.value) } : current))} />
            </label>
          </div>
        </article>;
      })}
      {draft.slides.length < 3 && <label className={`button button-outline admin-welcome-hero-upload${isPreparingImages ? " is-disabled" : ""}`}>
        <FileUp size={15} aria-hidden="true" /> {isPreparingImages ? "Preparing images…" : "Add background images"}
        <input ref={fileInput} type="file" accept="image/*" multiple disabled={isPreparingImages} onChange={(event) => void addImages(event.target.files)} />
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
