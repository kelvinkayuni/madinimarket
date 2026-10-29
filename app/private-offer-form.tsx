"use client";

import { FormEvent, useState } from "react";

import { calculateListingPrice } from "@/lib/listing-pricing";

type Currency = "TZS" | "USD";
type Unit = "carats" | "g" | "kg" | "tons";

export type PrivateOfferDetails = {
  requestId: number;
  threadId: string | null;
  feeRate: number;
  usdEnabled: boolean;
  defaultCurrency: Currency;
  submitting: boolean;
  onSubmit: (details: Record<string, unknown>) => void;
};

export type FinalizedOfferDetails = {
  mineralName: string;
  listingType: "single" | "batch";
  weight: number;
  unit: Unit;
  smallestStoneWeight: number | null;
  largestStoneWeight: number | null;
  stoneWeightUnit: string | null;
  color: string;
  shape: string;
  quality: string;
  country: string;
  region: string;
  district: string;
};

async function encodeCertificate(file: File) {
  if (file.size > 10 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Choose a PDF, JPG, or PNG mineral certificate smaller than 10 MB.");
  }
  const bytes = await file.arrayBuffer();
  let binary = "";
  const chunk = new Uint8Array(bytes);
  for (let index = 0; index < chunk.length; index += 0x8000) {
    binary += String.fromCharCode(...chunk.subarray(index, index + 0x8000));
  }
  return { data: `data:${file.type};base64,${btoa(binary)}`, name: file.name.slice(0, 180), type: file.type };
}

async function encodeMineralPhoto(file: File) {
  if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Choose a JPG or PNG mineral photo smaller than 5 MB.");
  }
  const bitmap = await createImageBitmap(file);
  const side = 800;
  const sourceSide = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image processing is unavailable.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, side, side);
  context.drawImage(
    bitmap,
    (bitmap.width - sourceSide) / 2,
    (bitmap.height - sourceSide) / 2,
    sourceSide,
    sourceSide,
    0,
    0,
    side,
    side,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function FinalizePrivateOfferForm({
  offer,
  submitting,
  onSubmit,
}: {
  offer: FinalizedOfferDetails;
  submitting: boolean;
  onSubmit: (details: Record<string, string | number | null>) => void;
}) {
  const [listingType, setListingType] = useState(offer.listingType);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    onSubmit({
      action: "confirm_offer",
      mineralName: String(values.get("mineralName") ?? ""),
      listingType,
      weight: Number(values.get("weight")),
      unit: String(values.get("unit") ?? ""),
      smallestStoneWeight: listingType === "batch" ? Number(values.get("smallestStoneWeight")) : null,
      largestStoneWeight: listingType === "batch" ? Number(values.get("largestStoneWeight")) : null,
      stoneWeightUnit: listingType === "batch" ? String(values.get("stoneWeightUnit") ?? "") : null,
      color: String(values.get("color") ?? ""),
      shape: String(values.get("shape") ?? ""),
      quality: String(values.get("quality") ?? ""),
      country: String(values.get("country") ?? ""),
      region: String(values.get("region") ?? ""),
      district: String(values.get("district") ?? ""),
    });
  };
  return <form className="account-form private-offer-form" onSubmit={submit}>
    <label>Mineral name<input name="mineralName" required maxLength={120} defaultValue={offer.mineralName} /></label>
    <div className="form-row">
      <label>Listing type<select value={listingType} onChange={(event) => setListingType(event.target.value as "single" | "batch")}><option value="single">Single stone</option><option value="batch">Batch</option></select></label>
      <label>Total weight<input name="weight" type="number" min="0.001" step="any" required defaultValue={offer.weight} /></label>
      <label>Unit<select name="unit" defaultValue={offer.unit}><option value="carats">Carats</option><option value="g">Grams</option><option value="kg">Kilograms</option><option value="tons">Tons</option></select></label>
    </div>
    {listingType === "batch" && <div className="form-row">
      <label>Smallest stone<input name="smallestStoneWeight" type="number" min="0.001" step="any" required defaultValue={offer.smallestStoneWeight ?? ""} /></label>
      <label>Largest stone<input name="largestStoneWeight" type="number" min="0.001" step="any" required defaultValue={offer.largestStoneWeight ?? ""} /></label>
      <label>Stone weight unit<select name="stoneWeightUnit" defaultValue={offer.stoneWeightUnit ?? "carats"}><option value="carats">Carats</option><option value="g">Grams</option><option value="kg">Kilograms</option></select></label>
    </div>}
    <div className="form-row">
      <label>Color<input name="color" required maxLength={100} defaultValue={offer.color} /></label>
      <label>Shape<select name="shape" defaultValue={offer.shape}><option value="Cut">Cut</option><option value="Uncut">Uncut</option></select></label>
      <label>Quality<input name="quality" required maxLength={200} defaultValue={offer.quality} /></label>
    </div>
    <div className="form-row">
      <label>Country<input name="country" required maxLength={100} defaultValue={offer.country} /></label>
      <label>Region<input name="region" required maxLength={100} defaultValue={offer.region} /></label>
      <label>District<input name="district" required maxLength={100} defaultValue={offer.district} /></label>
    </div>
    <p className="commerce-note">The accepted seller price and currency are locked and cannot be changed here.</p>
    <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? "Confirming details…" : "Confirm final mineral details"}</button>
  </form>;
}

export default function PrivateOfferForm({
  requestId,
  threadId,
  feeRate,
  usdEnabled,
  defaultCurrency,
  submitting,
  onSubmit,
}: PrivateOfferDetails) {
  const [listingType, setListingType] = useState<"single" | "batch">("single");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [sellerAmount, setSellerAmount] = useState("");
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const photo = values.get("image");
    if (!(photo instanceof File)) {
      setPhotoError("Attach a mineral photo to your offer.");
      return;
    }
    setPreparingPhoto(true);
    setPhotoError("");
    try {
      const imageData = await encodeMineralPhoto(photo);
      const certificate = values.get("certificate");
      const certificateData = certificate instanceof File && certificate.size > 0
        ? await encodeCertificate(certificate)
        : null;
      onSubmit({
        action: "send_offer",
        requestId,
        threadId,
        availabilityConfirmed: values.get("availabilityConfirmed") === "on",
        mineralName: String(values.get("mineralName") ?? ""),
        listingType,
        weight: Number(values.get("weight")),
        unit: String(values.get("unit") ?? ""),
        smallestStoneWeight: listingType === "batch" ? Number(values.get("smallestStoneWeight")) : null,
        largestStoneWeight: listingType === "batch" ? Number(values.get("largestStoneWeight")) : null,
        stoneWeightUnit: listingType === "batch" ? String(values.get("stoneWeightUnit") ?? "") : null,
        color: String(values.get("color") ?? ""),
        shape: String(values.get("shape") ?? ""),
        quality: String(values.get("quality") ?? ""),
        country: String(values.get("country") ?? ""),
        region: String(values.get("region") ?? ""),
        district: String(values.get("district") ?? ""),
        sellerAmount: Number(sellerAmount),
        currency,
        imageData,
        certificateData,
      });
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not prepare the mineral photo.");
    } finally {
      setPreparingPhoto(false);
    }
  };

  const parsedAmount = Number(sellerAmount);
  const price = Number.isFinite(parsedAmount) && parsedAmount > 0
    ? calculateListingPrice(parsedAmount, currency, feeRate)
    : null;
  const formatAmount = (amount: number) => `${currency === "TZS" ? "TSh" : "$"} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(amount)}`;

  return (
    <form className="account-form private-offer-form" onSubmit={submit}>
      <label>Mineral name<input name="mineralName" required maxLength={120} /></label>
      <div className="form-row">
        <label>Listing type<select value={listingType} onChange={(event) => setListingType(event.target.value as "single" | "batch")}><option value="single">Single stone</option><option value="batch">Batch</option></select></label>
        <label>Total weight<input name="weight" type="number" min="0.001" step="any" required /></label>
        <label>Unit<select name="unit" defaultValue="carats"><option value="carats">Carats</option><option value="g">Grams</option><option value="kg">Kilograms</option><option value="tons">Tons</option></select></label>
      </div>
      {listingType === "batch" && <div className="form-row">
        <label>Smallest stone<input name="smallestStoneWeight" type="number" min="0.001" step="any" required /></label>
        <label>Largest stone<input name="largestStoneWeight" type="number" min="0.001" step="any" required /></label>
        <label>Stone weight unit<select name="stoneWeightUnit" defaultValue="carats"><option value="carats">Carats</option><option value="g">Grams</option><option value="kg">Kilograms</option></select></label>
      </div>}
      <div className="form-row">
        <label>Color<input name="color" required maxLength={100} /></label>
        <label>Shape<select name="shape" defaultValue="Cut"><option value="Cut">Cut</option><option value="Uncut">Uncut</option></select></label>
        <label>Quality<input name="quality" required maxLength={200} /></label>
      </div>
      <div className="form-row">
        <label>Country<input name="country" required maxLength={100} /></label>
        <label>Region<input name="region" required maxLength={100} /></label>
        <label>District<input name="district" required maxLength={100} /></label>
      </div>
      <label>Mineral photo<input name="image" type="file" accept="image/jpeg,image/png" required /><small>JPG or PNG · square crop · max 5 MB</small></label>
      <label>Seller mineral certificate <small>(optional — shown privately to buyer and seller)</small><input name="certificate" type="file" accept="application/pdf,image/jpeg,image/png" /><small>PDF, JPG, or PNG · max 10 MB</small></label>
      <label className="private-offer-availability-confirmation">
        <input name="availabilityConfirmed" type="checkbox" required />
        I confirm this mineral is currently available and I will honor this offer during the buyer’s payment window.
      </label>
      {photoError && <p className="commerce-warning" role="alert">{photoError}</p>}
      <div className="form-row">
        <label>Your price<input type="number" min="0.01" step="any" required value={sellerAmount} onChange={(event) => setSellerAmount(event.target.value)} /></label>
        <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option value="TZS">TSh</option>{usdEnabled && <option value="USD">USD</option>}</select></label>
      </div>
      {price && <p className="private-offer-price-preview">
        Your price: <strong>{formatAmount(price.sellerPrice)}</strong>
        <span> · Madinimarket fee: {formatAmount(price.platformFeeAmount)} · Buyer total: {formatAmount(price.marketPrice)}.</span>
      </p>}
      <button className="button button-dark" type="submit" disabled={submitting || preparingPhoto}>{preparingPhoto ? "Preparing photo…" : submitting ? "Sending offer…" : "Send private offer"}</button>
    </form>
  );
}
