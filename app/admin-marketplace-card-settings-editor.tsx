"use client";

import { ArrowDownRight, Gem } from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  DEFAULT_MARKETPLACE_CARD_APPEARANCE,
  getMarketplaceCardStyleProperties,
  type MarketplaceCardAppearanceSettings,
  type MarketplaceCardStyleSettings,
} from "@/lib/marketplace-card-settings";

type Props = {
  savedSettings: MarketplaceCardAppearanceSettings;
  saving: boolean;
  onSave: (settings: MarketplaceCardAppearanceSettings) => Promise<boolean>;
};

type CardKind = "seller" | "buyer";
type SizeKey = "titleDesktopSize" | "titlePhoneSize" | "priceDesktopSize" | "pricePhoneSize" | "detailsDesktopSize" | "detailsPhoneSize";
type ColorKey = "titleColor" | "priceColor" | "detailsColor";

const SIZE_FIELDS: { key: SizeKey; label: string; min: number; max: number }[] = [
  { key: "titleDesktopSize", label: "Title · desktop", min: 10, max: 28 },
  { key: "titlePhoneSize", label: "Title · phone", min: 10, max: 24 },
  { key: "priceDesktopSize", label: "Price / offer · desktop", min: 9, max: 22 },
  { key: "pricePhoneSize", label: "Price / offer · phone", min: 9, max: 20 },
  { key: "detailsDesktopSize", label: "Details · desktop", min: 7, max: 16 },
  { key: "detailsPhoneSize", label: "Details · phone", min: 7, max: 14 },
];

const COLOR_FIELDS: { key: ColorKey; label: string; sellerDefault: string; buyerDefault: string }[] = [
  { key: "titleColor", label: "Title", sellerDefault: "#26382e", buyerDefault: "#f6f7f1" },
  { key: "priceColor", label: "Price / offer", sellerDefault: "#395c46", buyerDefault: "#d2ee77" },
  { key: "detailsColor", label: "Details", sellerDefault: "#788277", buyerDefault: "#a9b9ae" },
];

function copyAppearance(settings: MarketplaceCardAppearanceSettings): MarketplaceCardAppearanceSettings {
  return { seller: { ...settings.seller }, buyer: { ...settings.buyer } };
}

function copyCard(settings: MarketplaceCardStyleSettings): MarketplaceCardStyleSettings {
  return { ...settings };
}

export default function AdminMarketplaceCardSettingsEditor({ savedSettings, saving, onSave }: Props) {
  const [kind, setKind] = useState<CardKind>("seller");
  const [previewMode, setPreviewMode] = useState<"desktop" | "phone">("desktop");
  const [draft, setDraft] = useState(() => copyAppearance(savedSettings));

  const settings = draft[kind];
  const updateAlignment = (alignment: MarketplaceCardStyleSettings["alignment"]) => {
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], alignment } }));
  };
  const updateColor = (key: ColorKey, color: string) => {
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], [key]: color } }));
  };
  const updateSize = (key: SizeKey, value: number | null) => {
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], [key]: value } }));
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await onSave(draft)) setDraft(copyAppearance(draft));
  };
  const reset = async () => {
    const resetDraft = { ...draft, [kind]: copyCard(DEFAULT_MARKETPLACE_CARD_APPEARANCE[kind]) };
    setDraft(resetDraft);
    await onSave(resetDraft);
  };

  return <section className="admin-marketplace-card-editor" aria-label="Marketplace card styling editor">
    <div className="admin-marketplace-card-editor-heading">
      <div><span>CARD TEXT DESIGN</span><h3>Live card preview</h3></div>
      <div className="admin-marketplace-card-tabs" role="group" aria-label="Choose card type">
        <button type="button" className={kind === "seller" ? "is-active" : ""} aria-pressed={kind === "seller"} onClick={() => setKind("seller")}>Seller card</button>
        <button type="button" className={kind === "buyer" ? "is-active" : ""} aria-pressed={kind === "buyer"} onClick={() => setKind("buyer")}>Buyer card</button>
      </div>
    </div>

    <div className="admin-marketplace-card-preview-heading">
      <span>{previewMode === "desktop" ? "Desktop" : "Phone"} preview · sample listing</span>
      <div role="group" aria-label="Marketplace card preview size">
        <button type="button" className={previewMode === "desktop" ? "is-active" : ""} aria-pressed={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")}>Desktop</button>
        <button type="button" className={previewMode === "phone" ? "is-active" : ""} aria-pressed={previewMode === "phone"} onClick={() => setPreviewMode("phone")}>Phone</button>
      </div>
    </div>
    <div className={`admin-marketplace-card-preview-stage${previewMode === "phone" ? " is-phone" : ""}`}>
      {kind === "seller"
        ? <article className="seller-card" style={getMarketplaceCardStyleProperties(settings)}>
          <div className="seller-photo admin-marketplace-card-preview-photo"><Gem size={38} strokeWidth={1.2} /></div>
          <div className="seller-card-info">
            <div className="seller-name-row"><div className="seller-name-color"><h3>Tanzanite</h3><span className="seller-color-tag">Deep blue</span></div><span className="weight-tag">12.5 ct</span></div>
            <div className="seller-price-row"><div className="seller-price">TSh 2,450,000</div><span className="seller-comment">Genuine stone</span></div>
            <div className="seller-meta"><span>Arusha, Tanzania</span><span>See certificate</span></div>
            <button className="button button-dark add-to-cart-button" type="button" tabIndex={-1}>Add to cart</button>
          </div>
        </article>
        : <article className="buyer-card" style={getMarketplaceCardStyleProperties(settings)}>
          <div className="buyer-card-top"><span className="wanted-tag"><ArrowDownRight size={14} /> WANTED</span><span className="buyer-location">Dar es Salaam</span></div>
          <h3><span>Tanzanite</span><span className="buyer-shape">Oval</span></h3>
          <div className="buyer-specs"><div><span>WEIGHT</span><strong>10–15 ct</strong></div><div><span>COLOUR</span><strong>Blue</strong></div><div><span>QUALITY</span><strong>Eye clean</strong></div></div>
          <div className="buyer-card-bottom"><div><span>OFFER</span><strong>TSh 3,000,000</strong></div><button className="private-offer-button" type="button" tabIndex={-1}>Send private offer</button></div>
        </article>}
    </div>

    <form className="admin-marketplace-card-controls" onSubmit={(event) => void save(event)}>
      <fieldset className="admin-marketplace-card-alignment">
        <legend>Content alignment</legend>
        <div role="group" aria-label={`${kind} card content alignment`}>
          {([
            ["spread", "Current"],
            ["left", "Left"],
            ["center", "Middle"],
            ["right", "Right"],
          ] as const).map(([value, label]) => <button key={value} type="button" className={settings.alignment === value ? "is-active" : ""} aria-pressed={settings.alignment === value} onClick={() => updateAlignment(value)}>{label}</button>)}
        </div>
      </fieldset>

      <div className="admin-marketplace-card-colors">
        {COLOR_FIELDS.map(({ key, label, sellerDefault, buyerDefault }) => <label className="admin-marketplace-card-color" key={key}>
          <span>{label} color</span>
          <input aria-label={`${kind} card ${label.toLowerCase()} color`} type="color" value={settings[key] ?? (kind === "seller" ? sellerDefault : buyerDefault)} onChange={(event) => updateColor(key, event.target.value)} />
        </label>)}
      </div>

      <div className="admin-marketplace-card-sizes">
        {SIZE_FIELDS.map(({ key, label, min, max }) => <label className="field-label" key={key}>
          {label} ({min}–{max}px)
          <input className="text-input" type="number" min={min} max={max} step={1} placeholder="Current design" value={settings[key] ?? ""} onChange={(event) => updateSize(key, event.target.value === "" ? null : Number(event.target.value))} />
        </label>)}
      </div>

      <div className="admin-marketplace-card-actions">
        <p>Card dimensions and seller photo area stay unchanged. Blank sizes and colors use the current design.</p>
        <div>
          <button className="button button-outline" type="button" disabled={saving} onClick={() => void reset()}>Reset {kind} to current design</button>
          <button className="button button-dark" type="submit" disabled={saving}>{saving ? "Saving…" : "Save card design"}</button>
        </div>
      </div>
    </form>
  </section>;
}
