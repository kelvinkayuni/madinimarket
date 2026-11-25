"use client";

import { ArrowRight, Pause, Play, Plus } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { WelcomeHeroSettings } from "@/lib/welcome-hero";

const barStaggerOrder = [3, 0, 6, 2, 7, 1, 5, 4];

function getColorWithOpacity(color: string, opacity: number) {
  if (!/^#[\da-f]{6}$/i.test(color)) {
    throw new Error("Welcome hero colors must be six-digit hex values.");
  }
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity / 100})`;
}

export default function WelcomeHero({
  settings,
  marketHoursLoaded,
  marketHoursError,
  marketIsOpen,
  onSellMineral,
  onPostRequest,
  onViewSellerStats,
  onViewBuyerStats,
  sellBusy = false,
  postRequestBusy = false,
  preview = false,
  previewMobile = false,
}: {
  settings: WelcomeHeroSettings;
  marketHoursLoaded: boolean;
  marketHoursError: string;
  marketIsOpen: boolean;
  onSellMineral?: () => void;
  onPostRequest?: () => void;
  onViewSellerStats?: (trigger: HTMLButtonElement) => void;
  onViewBuyerStats?: (trigger: HTMLButtonElement) => void;
  sellBusy?: boolean;
  postRequestBusy?: boolean;
  preview?: boolean;
  previewMobile?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [rotationPaused, setRotationPaused] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const slides = settings.slides;
  const activeSlide = slides.length > 0 ? slides[activeIndex % slides.length] : undefined;
  const headline = activeSlide?.headline.trim() ? activeSlide.headline : settings.headline;
  const description = activeSlide?.description.trim() ? activeSlide.description : settings.description;
  const fontFamily = settings.fontFamily === "serif"
    ? "var(--font-display), Georgia, serif"
    : "var(--font-body), Arial, sans-serif";
  const style = {
    "--welcome-background-color": settings.backgroundColor,
    "--welcome-text-shadow-color": getColorWithOpacity(settings.overlayColor, settings.overlayOpacity),
    "--welcome-text-shadow-highlight-color": getColorWithOpacity("#ffffff", settings.overlayOpacity * 0.5),
    "--welcome-text-shadow-blur": `${5 + settings.overlayOpacity * 0.09}px`,
    "--welcome-text-shadow-glow": `${2 + settings.overlayOpacity * 0.04}px`,
    "--welcome-heading-color": settings.headingColor,
    "--welcome-body-color": settings.bodyColor,
    "--welcome-accent-color": settings.accentColor,
    "--welcome-button-color": settings.buttonColor,
    "--welcome-button-text-color": settings.buttonTextColor,
    "--welcome-button-background": getColorWithOpacity(settings.buttonColor, settings.buttonBackgroundOpacity),
    "--welcome-button-border-color": settings.buttonBorderColor,
    "--welcome-button-border-width": `${settings.buttonBorderWidth}px`,
    "--welcome-button-shadow": getColorWithOpacity("#000000", settings.buttonShadowStrength),
    "--welcome-button-font-weight": settings.buttonFontWeight,
    "--welcome-request-button-color": settings.requestButtonColor,
    "--welcome-request-button-text-color": settings.requestButtonTextColor,
    "--welcome-request-button-background": getColorWithOpacity(settings.requestButtonColor, settings.requestButtonBackgroundOpacity),
    "--welcome-request-button-border-color": settings.requestButtonBorderColor,
    "--welcome-request-button-border-width": `${settings.requestButtonBorderWidth}px`,
    "--welcome-request-button-shadow": getColorWithOpacity("#000000", settings.requestButtonShadowStrength),
    "--welcome-request-button-font-weight": settings.requestButtonFontWeight,
    "--welcome-desktop-copy-x": `${settings.desktopCopyHorizontalPosition}%`,
    "--welcome-desktop-copy-y": `${settings.desktopCopyVerticalPosition}%`,
    "--welcome-mobile-copy-x": `${settings.mobileCopyHorizontalPosition}%`,
    "--welcome-mobile-copy-y": `${settings.mobileCopyVerticalPosition}%`,
    "--welcome-desktop-sell-x": `${settings.desktopSellButtonHorizontalPosition}%`,
    "--welcome-desktop-sell-y": `${settings.desktopSellButtonVerticalPosition}%`,
    "--welcome-mobile-sell-x": `${settings.mobileSellButtonHorizontalPosition}%`,
    "--welcome-mobile-sell-y": `${settings.mobileSellButtonVerticalPosition}%`,
    "--welcome-desktop-request-x": `${settings.desktopRequestButtonHorizontalPosition}%`,
    "--welcome-desktop-request-y": `${settings.desktopRequestButtonVerticalPosition}%`,
    "--welcome-mobile-request-x": `${settings.mobileRequestButtonHorizontalPosition}%`,
    "--welcome-mobile-request-y": `${settings.mobileRequestButtonVerticalPosition}%`,
    "--welcome-desktop-links-x": `${settings.desktopLinksHorizontalPosition}%`,
    "--welcome-desktop-links-y": `${settings.desktopLinksVerticalPosition}%`,
    "--welcome-mobile-links-x": `${settings.mobileLinksHorizontalPosition}%`,
    "--welcome-mobile-links-y": `${settings.mobileLinksVerticalPosition}%`,
    "--welcome-font-family": fontFamily,
    "--welcome-font-weight": settings.fontWeight,
    "--welcome-eyebrow-font-weight": settings.eyebrowFontWeight,
    "--welcome-description-font-weight": settings.descriptionFontWeight,
    "--welcome-secondary-links-font-weight": settings.secondaryLinksFontWeight,
    "--welcome-desktop-font-size": `${settings.desktopFontSize}px`,
    "--welcome-mobile-font-size": `${settings.mobileFontSize}px`,
    "--welcome-transition-duration": `${settings.transitionDurationMs}ms`,
  } as CSSProperties & Record<`--welcome-${string}`, string | number>;
  const statusText = !marketHoursLoaded
    ? "Checking market hours"
    : marketHoursError
      ? "Market schedule unavailable"
      : marketIsOpen ? "Market open now" : "Market currently closed";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setRotationPaused(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (slides.length < 2 || rotationPaused) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setActiveIndex((index) => (index + 1) % slides.length);
      }
    }, settings.slideIntervalSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [rotationPaused, settings.slideIntervalSeconds, slides.length]);

  useEffect(() => {
    if (preview || settings.heightMode !== "fit-screen") return;
    const hero = heroRef.current;
    if (!hero) return;

    const updateAvailableHeight = () => {
      const documentTop = hero.getBoundingClientRect().top + window.scrollY;
      hero.style.setProperty("--welcome-fit-offset", `${documentTop}px`);
    };

    updateAvailableHeight();
    const observer = new ResizeObserver(updateAvailableHeight);
    const shell = hero.closest(".market-shell");
    const header = shell?.querySelector(".site-header");
    const content = hero.parentElement;
    if (header) observer.observe(header);
    if (content) observer.observe(content);
    window.addEventListener("resize", updateAvailableHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateAvailableHeight);
    };
  }, [preview, settings.heightMode]);

  return <section
    ref={heroRef}
    className={`market-welcome-hero${slides.length > 0 ? " has-slides" : ""}${preview ? " is-preview" : ""}${previewMobile ? " is-preview-mobile" : ""}`}
    data-height-mode={settings.heightMode}
    data-transition={settings.transition}
    aria-labelledby={preview ? undefined : "market-welcome-heading"}
    style={style}
  >
    {slides.length > 0 && <div className="market-welcome-slides" aria-hidden="true">
      {slides.map((slide, index) => slide.url && <div
        className={`market-welcome-slide${index === activeIndex % slides.length ? " is-active" : ""}`}
        key={slide.path}
        style={{
          "--welcome-slide-image": `url("${slide.url}")`,
          "--welcome-slide-position": `${slide.focusX}% ${slide.focusY}%`,
          "--welcome-slide-scale": slide.scale / 100,
          "--welcome-slide-origin": `${slide.focusX}% ${slide.focusY}%`,
          "--welcome-mobile-slide-image": `url("${slide.mobileUrl ?? slide.url}")`,
          "--welcome-mobile-slide-position": `${slide.mobileFocusX}% ${slide.mobileFocusY}%`,
          "--welcome-mobile-slide-scale": slide.mobileScale / 100,
          "--welcome-mobile-slide-origin": `${slide.mobileFocusX}% ${slide.mobileFocusY}%`,
        } as CSSProperties & Record<`--welcome-${string}`, string | number>}
      >
        {settings.transition === "random-bars" && barStaggerOrder.map((order, barIndex) => <span
          className="market-welcome-bar"
          key={barIndex}
          style={{
            "--welcome-bar-left": `${barIndex * 12.5}%`,
            "--welcome-bar-right": `${100 - (barIndex + 1) * 12.5}%`,
            "--welcome-bar-delay": `${order * settings.transitionDurationMs / 12}ms`,
          } as CSSProperties & Record<`--welcome-${string}`, string | number>}
        />)}
      </div>)}
    </div>}
    <div className="market-welcome-copy">
      <div className="market-welcome-main-copy">
        <span className="market-welcome-eyebrow"><span /> {settings.eyebrow}</span>
        <div className="market-welcome-phrase" key={activeIndex}>
          <h1 id={preview ? undefined : "market-welcome-heading"}>{headline}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="market-welcome-action market-welcome-sell-action">
        {preview
          ? <span className="button button-lime">{settings.sellLabel} <ArrowRight size={16} aria-hidden="true" /></span>
          : <button className="button button-lime" type="button" disabled={sellBusy} onClick={onSellMineral}>
            {sellBusy ? "Opening…" : <>{settings.sellLabel} <ArrowRight size={16} aria-hidden="true" /></>}
          </button>}
      </div>
      <div className="market-welcome-action market-welcome-request-action">
        <button className="button market-welcome-post-button" type="button" disabled={preview || postRequestBusy} onClick={onPostRequest}>
          {postRequestBusy ? "Opening…" : <><Plus size={16} aria-hidden="true" /> {settings.requestLabel}</>}
        </button>
      </div>
      <div className="market-welcome-secondary-links">
        {settings.exploreLinkLabel.trim() && (preview
          ? <span className="market-welcome-secondary-link">{settings.exploreLinkLabel} <ArrowRight size={14} aria-hidden="true" /></span>
          : <a className="market-welcome-secondary-link" href="#marketplace">{settings.exploreLinkLabel} <ArrowRight size={14} aria-hidden="true" /></a>)}
        {settings.buyerBrowseLinkLabel.trim() && (preview
          ? <span className="market-welcome-secondary-link">{settings.buyerBrowseLinkLabel} <ArrowRight size={14} aria-hidden="true" /></span>
          : <a className="market-welcome-secondary-link" href={marketHoursLoaded && !marketHoursError && marketIsOpen ? "#buyer-heading" : "#marketplace"}>
            {settings.buyerBrowseLinkLabel} <ArrowRight size={14} aria-hidden="true" />
          </a>)}
        {preview
          ? <span className="market-welcome-secondary-link">Top listed minerals <ArrowRight size={14} aria-hidden="true" /></span>
          : <button className="market-welcome-secondary-link" type="button" aria-haspopup="dialog" disabled={!onViewSellerStats} onClick={(event) => onViewSellerStats?.(event.currentTarget)}>
            Top listed minerals <ArrowRight size={14} aria-hidden="true" />
          </button>}
        {preview
          ? <span className="market-welcome-secondary-link">Most requested minerals <ArrowRight size={14} aria-hidden="true" /></span>
          : <button className="market-welcome-secondary-link" type="button" aria-haspopup="dialog" disabled={!onViewBuyerStats} onClick={(event) => onViewBuyerStats?.(event.currentTarget)}>
            Most requested minerals <ArrowRight size={14} aria-hidden="true" />
          </button>}
      </div>
    </div>
    <div className={`market-welcome-status${marketHoursLoaded && !marketIsOpen ? " is-closed" : ""}`} role={preview ? undefined : "status"}>
      <span className="market-welcome-status-dot" />
      {preview ? "Market open now" : statusText}
    </div>
    {slides.length > 1 && <div className="market-welcome-carousel-controls" role="group" aria-label="Welcome hero background images">
      <button type="button" aria-label={rotationPaused ? "Resume background rotation" : "Pause background rotation"} aria-pressed={rotationPaused} onClick={() => setRotationPaused((paused) => !paused)}>
        {rotationPaused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
      </button>
      {slides.map((slide, index) => <button
        className={`market-welcome-carousel-dot${index === activeIndex % slides.length ? " is-active" : ""}`}
        type="button"
        aria-label={`Show background image ${index + 1} of ${slides.length}`}
        aria-pressed={index === activeIndex % slides.length}
        key={slide.path}
        onClick={() => setActiveIndex(index)}
      />)}
    </div>}
  </section>;
}
