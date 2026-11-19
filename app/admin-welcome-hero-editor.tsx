"use client";

import { ArrowDown, ArrowUp, Eye, FileUp, RotateCcw, Save, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { WelcomeHeroSettings, WelcomeHeroSlide } from "@/lib/welcome-hero";
import WelcomeHero from "./welcome-hero";

type DraftSlide = WelcomeHeroSlide & { file?: File };

function optimizeImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size > 20_000_000) {
    throw new Error("Choose image files smaller than 20 MB.");
  }
  return createImageBitmap(file).then((bitmap) => {
    const scale = Math.min(1, 2200 / bitmap.width, 1400 / bitmap.height);
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
      while (blob.size > 1_200_000 && quality > 0.42) {
        quality -= 0.1;
        blob = await encode(quality);
      }
      if (blob.size > 1_200_000) throw new Error(`${file.name} is too large to optimize. Choose a smaller image.`);
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
  onSaved,
}: {
  savedSettings: WelcomeHeroSettings;
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
        return { path: "", focusX: 50, focusY: 50, url, file };
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

  const removeSlide = (index: number) => {
    const slide = draft.slides[index] as DraftSlide | undefined;
    if (slide?.url && objectUrls.current.has(slide.url)) {
      URL.revokeObjectURL(slide.url);
      objectUrls.current.delete(slide.url);
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
    setIsSaving(true);
    setMessage("");
    try {
      const form = new FormData();
      const slides = draft.slides.map((slide, index) => {
        const draftSlide = slide as DraftSlide;
        if (draftSlide.file) {
          form.append(`image-${index}`, draftSlide.file);
          return { uploadIndex: index, focusX: slide.focusX, focusY: slide.focusY };
        }
        return { path: slide.path, focusX: slide.focusX, focusY: slide.focusY };
      });
      form.append("settings", JSON.stringify({ ...draft, slides }));
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
        ? "Hero saved, but an unused old image could not be removed."
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
    <div className="admin-queue-heading">
      <div><span>WELCOME HERO</span><h3 id="admin-welcome-hero-heading">Hero content and design</h3></div>
    </div>
    <p className="admin-translation-help">Changes affect the welcome panel shown above the marketplace. The two buttons keep their existing actions; only their labels are editable.</p>

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
      <label className="field-label">Headline<input className="text-input" maxLength={100} value={draft.headline} onChange={(event) => update("headline", event.target.value)} /></label>
      <label className="field-label admin-welcome-hero-description">Description<textarea className="text-input" maxLength={320} rows={3} value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
      <label className="field-label">Explore button label<input className="text-input" maxLength={32} value={draft.exploreLabel} onChange={(event) => update("exploreLabel", event.target.value)} /></label>
      <label className="field-label">Request button label<input className="text-input" maxLength={32} value={draft.requestLabel} onChange={(event) => update("requestLabel", event.target.value)} /></label>
    </div>

    <div className="admin-welcome-hero-colors">
      {([
        ["Background", "backgroundColor"],
        ["Overlay", "overlayColor"],
        ["Headline", "headingColor"],
        ["Description", "bodyColor"],
        ["Accent", "accentColor"],
        ["Button", "buttonColor"],
        ["Button text", "buttonTextColor"],
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
      <div className="admin-queue-heading"><div><span>BACKGROUND IMAGES</span><h4>{draft.slides.length} of 3 images</h4></div></div>
      <p className="admin-translation-help">Images are optimized as JPEGs before upload, then rotate every five seconds. The existing gemstone artwork remains the fallback when no images are selected.</p>
      {draft.slides.map((slide, index) => <article className="admin-welcome-hero-image" key={slide.path || slide.url || index}>
        {slide.url ? <Image src={slide.url} alt={`Welcome hero background ${index + 1}`} width={360} height={180} unoptimized /> : <div className="admin-welcome-hero-image-empty">Image preview</div>}
        <div className="admin-welcome-hero-image-controls">
          <strong>Image {index + 1}</strong>
          <div className="admin-welcome-hero-image-actions">
            <button type="button" aria-label={`Move image ${index + 1} up`} disabled={index === 0} onClick={() => moveSlide(index, -1)}><ArrowUp size={15} /></button>
            <button type="button" aria-label={`Move image ${index + 1} down`} disabled={index === draft.slides.length - 1} onClick={() => moveSlide(index, 1)}><ArrowDown size={15} /></button>
            <button type="button" aria-label={`Remove image ${index + 1}`} onClick={() => removeSlide(index)}><Trash2 size={15} /></button>
          </div>
          <label>Horizontal focal point: {slide.focusX}%
            <input type="range" min={0} max={100} step={1} value={slide.focusX} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, focusX: Number(event.target.value) } : current))} />
          </label>
          <label>Vertical focal point: {slide.focusY}%
            <input type="range" min={0} max={100} step={1} value={slide.focusY} onChange={(event) => update("slides", draft.slides.map((current, slideIndex) => slideIndex === index ? { ...current, focusY: Number(event.target.value) } : current))} />
          </label>
        </div>
      </article>)}
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
