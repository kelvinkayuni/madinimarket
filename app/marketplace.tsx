"use client";

import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Clipboard, Gem, Menu, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

type Unit = "g" | "kg" | "tons" | "carats";
type Currency = "TZS" | "USD";
type SubmissionStatus = "pending" | "approved" | "rejected";
type Seller = { id: number; user_id?: string; mineral: string; weight: string; unit: Unit; price: string; currency: Currency; seller: string; location: string; country?: string; region?: string; district?: string; street?: string; email: string; phone: string; image: string; image_path?: string | null; accent: string; status: SubmissionStatus; review_message?: string | null };
type Buyer = { id: number; user_id?: string; mineral: string; weight: string; unit: Unit; color: string; shape: "Cut" | "Uncut"; quality: string; offer: string; currency: Currency; buyer: string; location: string; email: string; phone: string; status: SubmissionStatus; review_message?: string | null };
type EditingSubmission = { kind: "seller"; item: Seller } | { kind: "buyer"; item: Buyer } | null;
type Dialog = "create" | "signin" | "sell" | "buy" | "review" | "submissions" | "signout" | null;

const SELLERS_STORAGE_KEY = "madinimarket:sellers:v1";
const BUYERS_STORAGE_KEY = "madinimarket:buyers:v1";
const USER_STORAGE_KEY = "madinimarket:user:v1";

const money = (value: string, currency: Currency) => `${currency === "TZS" ? "TSh" : "$"} ${value}`;
const isAdminRole = (role: "user" | "admin" | null): boolean => role === "admin";

function readStoredArray<T>(key: string): T[] {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

async function storeMineralPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = 800;
  const sourceSide = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
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

async function loadMarketplaceListings() {
  const supabase = getSupabaseBrowserClient();
  const [sellerResult, buyerResult] = await Promise.all([
    supabase.from("listings").select("*").order("created_at", { ascending: false }),
    supabase.from("buy_requests").select("*").order("created_at", { ascending: false }),
  ]);
  if (sellerResult.error) throw sellerResult.error;
  if (buyerResult.error) throw buyerResult.error;

  let sellerRows = sellerResult.data ?? [];
  let buyerRows = buyerResult.data ?? [];
  try {
    const response = await fetch("/api/website-submissions", { cache: "no-store" });
    if (response.ok) {
      const ownSubmissions = await response.json();
      sellerRows = [...sellerRows, ...(ownSubmissions.sellers ?? [])];
      buyerRows = [...buyerRows, ...(ownSubmissions.buyers ?? [])];
    }
  } catch {
    // Public listings remain available if a website account session has expired.
  }

  const sellers = await Promise.all(sellerRows.map(async (row) => {
    let image = "";
    if (row.image_path) {
      if (row.signed_image_url) image = row.signed_image_url;
      else {
        const { data } = await supabase.storage.from("mineral-images").createSignedUrl(row.image_path, 3600);
        image = data?.signedUrl ?? "";
      }
    }
    return {
      id: Number(row.id), user_id: row.website_user_id ?? row.user_id, mineral: row.mineral_name, weight: String(row.weight),
      unit: row.unit as Unit, price: String(row.price), currency: row.currency as Currency,
      seller: row.seller_name, country: row.country, region: row.region, district: row.district, street: row.street,
      location: [row.district, row.region, row.country].filter(Boolean).join(", "), email: row.email, phone: row.phone,
      image, image_path: row.image_path, accent: "#43866b", status: row.status as SubmissionStatus,
      review_message: row.review_message,
    } satisfies Seller;
  }));
  const buyers = buyerRows.map((row) => ({
    id: Number(row.id), user_id: row.website_user_id ?? row.user_id, mineral: row.mineral_name, weight: String(row.weight),
    unit: row.unit as Unit, color: row.color, shape: row.shape as Buyer["shape"], quality: row.quality,
    offer: String(row.offer), currency: row.currency as Currency, buyer: row.buyer_name, location: row.location,
    email: row.email, phone: row.phone, status: row.status as SubmissionStatus, review_message: row.review_message,
  } satisfies Buyer));
  return { sellers, buyers };
}

export default function Marketplace() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"user" | "admin" | null>(null);
  const [generated, setGenerated] = useState<{ username: string; expiresAt: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [rejectionMessages, setRejectionMessages] = useState<Record<string, string>>({});
  const [editingSubmission, setEditingSubmission] = useState<EditingSubmission>(null);
  const sellerRail = useRef<HTMLDivElement>(null);
  const buyerRail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateTime = () => setLastUpdated(new Date());
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (isSupabaseConfigured) {
      let active = true;
      const supabase = getSupabaseBrowserClient();
      const hydrate = async (session: Session | null) => {
        try {
          let isAdmin = false;
          if (session) {
            const { data: profile, error: profileError } = await supabase
              .from("profiles")
              .select("id, username, role")
              .eq("id", session.user.id)
              .maybeSingle();
            if (profileError) throw profileError;
            isAdmin = profile?.role === "admin";
            if (isAdmin && active) {
              setUser(profile?.username ?? "");
              setUserId(session.user.id);
              setRole("admin");
            }
            if (!isAdmin) await supabase.auth.signOut({ scope: "local" });
          }
          if (!isAdmin) {
            const response = await fetch("/api/auth/website-session", { cache: "no-store" });
            const result = response.ok ? await response.json() : null;
            if (active) {
              setUser(result?.account?.username ?? "");
              setUserId(result?.account?.id ?? "");
              setRole(result?.account ? "user" : null);
            }
          }
          const listings = await loadMarketplaceListings();
          if (active) {
            setSellers(listings.sellers);
            setBuyers(listings.buyers);
            setLastUpdated(new Date());
            setStorageReady(true);
          }
        } catch {
          if (active) {
            setNotice("Could not load marketplace data from Supabase.");
            setStorageReady(true);
          }
        }
      };
      void supabase.auth.getSession().then(({ data }) => hydrate(data.session));
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => void hydrate(session), 0);
      });
      const interval = window.setInterval(() => {
        void supabase.auth.getSession().then(({ data }) => hydrate(data.session));
      }, 60_000);
      return () => {
        active = false;
        subscription.unsubscribe();
        window.clearInterval(interval);
      };
    }

    setSellers(readStoredArray<Seller>(SELLERS_STORAGE_KEY));
    setBuyers(readStoredArray<Buyer>(BUYERS_STORAGE_KEY));
    try {
      const storedUser = localStorage.getItem(USER_STORAGE_KEY) ?? "";
      setUser(storedUser);
      setUserId(storedUser);
      setRole(storedUser ? "user" : null);
    } catch {
      setUser("");
    }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (!storageReady || isSupabaseConfigured) return;
    try {
      localStorage.setItem(SELLERS_STORAGE_KEY, JSON.stringify(sellers));
      localStorage.setItem(BUYERS_STORAGE_KEY, JSON.stringify(buyers));
      if (user) localStorage.setItem(USER_STORAGE_KEY, user);
      else localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      setNotice("This browser could not save your marketplace changes.");
    }
  }, [storageReady, sellers, buyers, user]);
  useEffect(() => {
    if (!generated) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((generated.expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) setGenerated(null);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [generated]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const openDialog = (next: Exclude<Dialog, null>) => { setMenuOpen(false); setDialog(next); };
  const openListing = (type: "sell" | "buy") => {
    if (!user) { setNotice("Sign in first to post a listing."); openDialog("signin"); return; }
    setEditingSubmission(null);
    openDialog(type);
  };
  const scrollRail = (rail: HTMLDivElement | null, direction: number) => rail?.scrollBy({ left: direction * 360, behavior: "smooth" });
  const visibleSellers = sellers.filter((item) => item.status === "approved" && `${item.mineral} ${item.seller} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  const visibleBuyers = buyers.filter((item) => item.status === "approved" && `${item.mineral} ${item.buyer} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  const refreshRemoteListings = async () => {
    const listings = await loadMarketplaceListings();
    setSellers(listings.sellers);
    setBuyers(listings.buyers);
    setLastUpdated(new Date());
  };
  const updateReviewMessage = (key: string, message: string) => {
    setRejectionMessages((current) => ({ ...current, [key]: message }));
  };
  const reviewSubmission = async (kind: "seller" | "buyer", id: number, approved: boolean) => {
    if (role !== "admin" || !isSupabaseConfigured) return;
    const key = `${kind}-${id}`;
    const message = rejectionMessages[key]?.trim() ?? "";
    if (!approved && !message) { setNotice("Add a rejection message before rejecting this submission."); return; }
    const supabase = getSupabaseBrowserClient();
    const { error } = kind === "seller"
      ? await supabase.rpc("review_listing", { p_id: id, p_approved: approved, p_message: message || null })
      : await supabase.rpc("review_buy_request", { p_id: id, p_approved: approved, p_message: message || null });
    if (error) { setNotice(error.message); return; }
    void refreshRemoteListings().catch(() => setNotice("Review saved, but the queue could not be refreshed."));
    updateReviewMessage(key, "");
    setNotice(approved ? "Submission approved and published." : "Submission rejected and returned to its owner.");
  };
  const deleteSubmission = async (kind: "seller" | "buyer", item: Seller | Buyer) => {
    if (isSupabaseConfigured && role === "user") {
      const response = await fetch("/api/website-submissions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: item.id }),
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "The submission could not be deleted."); return; }
      void refreshRemoteListings().catch(() => setNotice("Deleted, but the list could not be refreshed."));
    } else if (isSupabaseConfigured) {
      const supabase = getSupabaseBrowserClient();
      const table = kind === "seller" ? "listings" : "buy_requests";
      const { error } = await supabase.from(table).delete().eq("id", item.id);
      if (error) { setNotice(error.message); return; }
      if (kind === "seller" && "image_path" in item && item.image_path) {
        await supabase.storage.from("mineral-images").remove([item.image_path]);
      }
      void refreshRemoteListings().catch(() => setNotice("Deleted, but the list could not be refreshed."));
    } else if (kind === "seller") {
      setSellers((current) => current.filter((listing) => listing.id !== item.id));
    } else {
      setBuyers((current) => current.filter((request) => request.id !== item.id));
    }
    setNotice("Submission deleted.");
  };
  const editSubmission = (kind: "seller" | "buyer", item: Seller | Buyer) => {
    setEditingSubmission(kind === "seller" ? { kind, item: item as Seller } : { kind, item: item as Buyer });
    setDialog(kind === "seller" ? "sell" : "buy");
  };
  const mySellers = sellers.filter((item) => item.user_id === userId && item.status !== "approved");
  const myBuyers = buyers.filter((item) => item.user_id === userId && item.status !== "approved");
  const pendingSellers = role === "admin" ? sellers.filter((item) => item.status === "pending") : [];
  const pendingBuyers = role === "admin" ? buyers.filter((item) => item.status === "pending") : [];

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (isSupabaseConfigured) {
      const response = await fetch("/api/auth/website-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.get("firstName"), surname: form.get("surname"), email: form.get("email"),
          phone: form.get("phone"), password: form.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setNotice(result.error ?? "Account creation failed.");
        return;
      }
      setUser(result.username);
      setUserId(result.id);
      setRole("user");
      setGenerated({ username: result.username, expiresAt: Date.now() + 60_000 });
      setSecondsLeft(60);
      formElement.reset();
      setDialog(null);
      setNotice(`Account created. You are signed in as ${result.username}.`);
      return;
    }
    const username = `MM-${Math.floor(1000 + Math.random() * 9000)}`;
    setGenerated({ username, expiresAt: Date.now() + 60_000 });
    setSecondsLeft(60);
    formElement.reset();
    setDialog(null);
    setNotice(isSupabaseConfigured ? "Account created. Verify your email if prompted, then sign in with this username." : "Demo username generated. Connect Supabase to create a real account.");
  };
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    let signedInRole: "user" | "admin" = "user";
    if (isSupabaseConfigured) {
      try {
        let websiteAccount: { id: string; username: string } | null = null;
        if (/^MM-\d{4}$/i.test(username)) {
          const websiteResponse = await fetch("/api/auth/website-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          if (websiteResponse.ok) websiteAccount = await websiteResponse.json();
        }
        if (websiteAccount) {
          setUser(websiteAccount.username);
          setUserId(websiteAccount.id);
          setRole("user");
          await refreshRemoteListings();
          setNotice(`Signed in as ${websiteAccount.username}.`);
          formElement.reset();
          setDialog(null);
          return;
        }
        const response = await fetch("/api/auth/username-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Username or password is incorrect.");
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken });
        if (error || !data.session) throw error ?? new Error("Sign-in failed.");
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, role")
          .eq("id", data.session.user.id)
          .single();
        if (profileError) throw profileError;
        setUser(profile.username);
        setUserId(profile.id);
        if (profile.role !== "admin") throw new Error("Username or password is incorrect.");
        signedInRole = "admin";
        setRole(signedInRole);
        await refreshRemoteListings();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Sign-in failed.");
        return;
      }
      setNotice(signedInRole === "admin" ? "Signed in to the admin account." : `Signed in as ${username}.`);
    } else {
      setUser(username);
      setUserId(username);
      setRole("user");
      setNotice(`Local demo session started as ${username}.`);
    }
    formElement.reset();
    setDialog(null);
  };
  const signOut = async () => {
    if (isSupabaseConfigured) {
      if (role === "admin") await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
      else await fetch("/api/auth/website-session", { method: "DELETE" });
    }
    setUser("");
    setUserId("");
    setRole(null);
    setDialog(null);
  };
  const copyUsername = async () => {
    if (!generated) return;
    try { await navigator.clipboard.writeText(generated.username); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setNotice(`Your username is ${generated.username}.`); }
  };
  const addSeller = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("image");
    const existing = editingSubmission?.kind === "seller" ? editingSubmission.item : null;
    let image = existing?.image ?? "";
    let imagePath = existing?.image_path ?? null;
    let imageData = "";
    if (file instanceof File && file.size) {
      try {
        image = await storeMineralPhoto(file);
        imageData = image;
      } catch {
        setNotice("That image could not be processed. Please try another PNG or JPG.");
        return;
      }
    }
    const listing: Seller = {
      id: existing?.id ?? Date.now(), mineral: String(form.get("mineral")), weight: String(form.get("weight")), unit: form.get("unit") as Unit,
      price: String(form.get("price")), currency: form.get("currency") as Currency, seller: String(form.get("seller")),
      location: [form.get("street"), form.get("district"), form.get("region"), form.get("country")].filter(Boolean).join(", "),
      country: String(form.get("country")), region: String(form.get("region")), district: String(form.get("district")), street: String(form.get("street")),
      email: String(form.get("email")), phone: String(form.get("phone")), image, image_path: null, accent: "#448363",
      user_id: userId, status: "pending", review_message: null,
    };
    if (isSupabaseConfigured && role === "user") {
      if (!userId) { setNotice("Sign in again before submitting this listing."); return; }
      const response = await fetch("/api/website-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "seller", id: existing?.id,
          imageData,
          values: {
            mineral_name: listing.mineral, weight: listing.weight, unit: listing.unit, price: listing.price,
            currency: listing.currency, seller_name: listing.seller, country: listing.country, region: listing.region,
            district: listing.district, street: listing.street, email: listing.email, phone: listing.phone,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "The listing could not be saved."); return; }
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Listing updated and resubmitted for admin approval." : "Seller listing submitted for admin approval.");
    } else if (isSupabaseConfigured) {
      if (!userId) { setNotice("Sign in again before submitting this listing."); return; }
      const supabase = getSupabaseBrowserClient();
      if (file instanceof File && file.size) {
        const path = `${userId}/${crypto.randomUUID()}.jpg`;
        const imageBlob = await (await fetch(image)).blob();
        const { error: uploadError } = await supabase.storage.from("mineral-images").upload(path, imageBlob, { contentType: "image/jpeg" });
        if (uploadError) { setNotice(uploadError.message); return; }
        imagePath = path;
      }
      const values = {
        user_id: userId, mineral_name: listing.mineral, weight: listing.weight, unit: listing.unit,
        price: listing.price, currency: listing.currency, seller_name: listing.seller,
        country: listing.country, region: listing.region, district: listing.district, street: listing.street,
        email: listing.email, phone: listing.phone, image_path: imagePath,
        status: "pending", review_message: null, reviewed_by: null, reviewed_at: null,
      };
      const result = existing
        ? await supabase.from("listings").update(values).eq("id", existing.id).select("id").maybeSingle()
        : await supabase.from("listings").insert(values);
      const error = result.error;
      if (error) { setNotice(error.message); return; }
      if (existing?.image_path && existing.image_path !== imagePath) {
        await supabase.storage.from("mineral-images").remove([existing.image_path]);
      }
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Listing updated and resubmitted for admin approval." : "Seller listing submitted for admin approval.");
    } else {
      setSellers((current) => existing ? current.map((item) => item.id === existing.id ? listing : item) : [listing, ...current]);
      setLastUpdated(new Date());
      setNotice(existing ? "Listing updated in this browser." : "Saved in this browser as pending. Connect Supabase to enable real admin review.");
    }
    formElement.reset();
    setEditingSubmission(null);
    setDialog(null);
  };
  const addBuyer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const existing = editingSubmission?.kind === "buyer" ? editingSubmission.item : null;
    const listing: Buyer = {
      id: existing?.id ?? Date.now(), mineral: String(form.get("mineral")), weight: String(form.get("weight")), unit: form.get("unit") as Unit,
      color: String(form.get("color")), shape: form.get("shape") as "Cut" | "Uncut", quality: String(form.get("quality")),
      offer: String(form.get("offer")), currency: form.get("currency") as Currency, buyer: String(form.get("buyer")),
      location: String(form.get("location")), email: String(form.get("email")), phone: String(form.get("phone")),
      user_id: userId, status: "pending", review_message: null,
    };
    if (isSupabaseConfigured && role === "user") {
      if (!userId) { setNotice("Sign in again before submitting this request."); return; }
      const response = await fetch("/api/website-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "buyer", id: existing?.id,
          values: {
            mineral_name: listing.mineral, weight: listing.weight, unit: listing.unit, color: listing.color,
            shape: listing.shape, quality: listing.quality, offer: listing.offer, currency: listing.currency,
            buyer_name: listing.buyer, location: listing.location, email: listing.email, phone: listing.phone,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "The request could not be saved."); return; }
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Request updated and resubmitted for admin approval." : "Buying request submitted for admin approval.");
    } else if (isSupabaseConfigured) {
      if (!userId) { setNotice("Sign in again before submitting this request."); return; }
      const supabase = getSupabaseBrowserClient();
      const values = {
        user_id: userId, mineral_name: listing.mineral, weight: listing.weight, unit: listing.unit,
        color: listing.color, shape: listing.shape, quality: listing.quality, offer: listing.offer,
        currency: listing.currency, buyer_name: listing.buyer, location: listing.location,
        email: listing.email, phone: listing.phone, status: "pending",
        review_message: null, reviewed_by: null, reviewed_at: null,
      };
      const result = existing
        ? await supabase.from("buy_requests").update(values).eq("id", existing.id).select("id").maybeSingle()
        : await supabase.from("buy_requests").insert(values);
      const error = result.error;
      if (error) { setNotice(error.message); return; }
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Request updated and resubmitted for admin approval." : "Buying request submitted for admin approval.");
    } else {
      setBuyers((current) => existing ? current.map((item) => item.id === existing.id ? listing : item) : [listing, ...current]);
      setLastUpdated(new Date());
      setNotice("Saved in this browser as pending. Connect Supabase to enable real admin review.");
    }
    formElement.reset();
    setEditingSubmission(null);
    setDialog(null);
  };
  const editingSeller = editingSubmission?.kind === "seller" ? editingSubmission.item : null;
  const editingBuyer = editingSubmission?.kind === "buyer" ? editingSubmission.item : null;

  if (isAdminRole(role)) {
    const pendingTotal = pendingSellers.length + pendingBuyers.length;
    return <main className="admin-shell">
      <header className="admin-header">
        <a className="admin-brand" href="#admin-home"><Gem size={20} /> MADINIMARKET <span>ADMIN</span></a>
        <div className="admin-header-actions"><span className="admin-account">{user}</span><button className="text-button" type="button" onClick={() => setDialog("signout")}>Sign out</button></div>
      </header>
      <div className="admin-content" id="admin-home">
        <section className="admin-overview">
          <div className="admin-page-heading"><div><div className="dialog-kicker">ADMIN WORKSPACE</div><h1>Review submissions</h1><p>Approve listings and buyer requests before they appear in the market.</p></div><button className="button button-outline" type="button" onClick={() => void refreshRemoteListings().catch(() => setNotice("Could not refresh submissions."))}><RefreshCw size={15} /> Refresh</button></div>
          <div className="admin-summary">
            <div><span>SELLER LISTINGS</span><strong>{pendingSellers.length}</strong><small>Awaiting review</small></div>
            <div><span>BUYER REQUESTS</span><strong>{pendingBuyers.length}</strong><small>Awaiting review</small></div>
            <div><span>TOTAL PENDING</span><strong>{pendingTotal}</strong><small>Across both queues</small></div>
          </div>
        </section>
        <div className="admin-queues">
          <section className="admin-queue" aria-labelledby="admin-sellers-heading">
            <div className="admin-queue-heading"><div><span>SELLERS</span><h2 id="admin-sellers-heading">Mineral listings</h2></div><strong>{pendingSellers.length}</strong></div>
            {pendingSellers.length ? pendingSellers.map((item) => <article className="admin-review-item" key={`admin-seller-${item.id}`}>
              <div className="admin-review-title"><div><span>SELLER LISTING</span><h3>{item.mineral}</h3></div><strong>{money(item.price, item.currency)}</strong></div>
              <p>{item.weight} {item.unit} · {item.seller}</p><p>{item.location} · {item.phone} · {item.email}</p>
              <textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to seller (required to reject)" value={rejectionMessages[`seller-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`seller-${item.id}`, event.target.value)} />
              <div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("seller", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("seller", item.id, false)}>Reject</button></div>
            </article>) : <p className="admin-empty">No seller listings are waiting for review.</p>}
          </section>
          <section className="admin-queue" aria-labelledby="admin-buyers-heading">
            <div className="admin-queue-heading"><div><span>BUYERS</span><h2 id="admin-buyers-heading">Buying requests</h2></div><strong>{pendingBuyers.length}</strong></div>
            {pendingBuyers.length ? pendingBuyers.map((item) => <article className="admin-review-item" key={`admin-buyer-${item.id}`}>
              <div className="admin-review-title"><div><span>BUYER REQUEST</span><h3>{item.mineral}</h3></div><strong>{money(item.offer, item.currency)}</strong></div>
              <p>{item.weight} {item.unit} · {item.color} · {item.shape} · {item.quality}</p><p>{item.location} · {item.buyer} · {item.phone} · {item.email}</p>
              <textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to buyer (required to reject)" value={rejectionMessages[`buyer-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`buyer-${item.id}`, event.target.value)} />
              <div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("buyer", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("buyer", item.id, false)}>Reject</button></div>
            </article>) : <p className="admin-empty">No buyer requests are waiting for review.</p>}
          </section>
        </div>
      </div>
      {notice && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
      {dialog === "signout" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => setDialog(null)}><X size={19} /></button><div className="dialog-brand"><Gem size={19} /> MADINIMARKET</div><div className="dialog-kicker">ACCOUNT</div><h2 id="dialog-title">Sign out?</h2><p className="dialog-copy">Are you sure you want to sign out?</p><div className="signout-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="button" onClick={() => void signOut()}>Sign out</button></div></section></div>}
    </main>;
  }

  return <main className="market-shell">
    <div className="prototype-bar" style={{ display: 'none' }} aria-hidden="true" />
    <header className="site-header">
      <div className="header-left"><div className="menu-wrap">
        <button className="icon-button menu-trigger" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={21} /> : <Menu size={22} />}</button>
        {menuOpen && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenuOpen(false)} /><div className="menu-popover"><span className="menu-kicker">YOUR ACCOUNT</span>{user ? <><button type="button" onClick={() => openDialog("submissions")}>My submissions <ArrowUpRight size={15} /></button><button type="button" onClick={() => openDialog("signout")}>Sign out <ArrowUpRight size={15} /></button></> : <><button type="button" onClick={() => openDialog("create")}>Create account <ArrowUpRight size={15} /></button><button type="button" onClick={() => openDialog("signin")}>Sign in <ArrowUpRight size={15} /></button></>}<div className="menu-foot"><ShieldCheck size={15} /> One account. Buy or sell.</div></div></>}
      </div><a className="wordmark" href="#top" aria-label="Madinimarket home"><span className="wordmark-symbol"><Gem size={21} strokeWidth={1.8} /></span><span>madini<span className="wordmark-market">market</span></span></a></div>
      <div className="header-search"><Search size={17} /><input aria-label="Search minerals and locations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search minerals, people, places" /><kbd>/</kbd></div>
      <div className="header-actions">{user ? <><div className="user-chip" title={user}><span className="user-avatar">{user.slice(-2)}</span><span>{user}</span></div><button className="text-button header-signout" type="button" onClick={() => openDialog("signout")}>Sign out</button></> : <button className="text-button header-signin" type="button" onClick={() => openDialog("signin")}>Sign in</button>}<button className="button button-dark header-list" type="button" onClick={() => openListing("sell")}><Plus size={16} /> List a mineral</button></div>
    </header>

    {generated && <section className="username-banner" aria-live="polite"><div className="username-copy"><span className="username-icon"><Check size={17} /></span><span><strong>Your username is ready</strong><small>Use it with your password to sign in. Expires in {secondsLeft}s.</small></span></div><code>{generated.username}</code><button className="copy-button" type="button" onClick={copyUsername}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "Copied" : "Copy"}</button><button className="dismiss-username" aria-label="Dismiss username" onClick={() => setGenerated(null)}><X size={17} /></button></section>}

    <div className="market-content" id="top">
      <section className="market-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> TANZANIA & BEYOND <span className="eyebrow-year">EST. 2025</span></div><h1>Find your next <em>good stone.</em></h1><p className="intro-copy">A direct market for the people who know minerals best.</p></div><div className="market-status"><div className="status-orbit"><span /></div><div><strong>Market open</strong><small>Updated {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "just now"}</small></div><RefreshCw size={14} className="refresh-icon" /></div></section>

      <section className="listing-section seller-section" aria-labelledby="seller-heading"><div className="section-head"><div className="section-title-wrap"><span className="section-index">01</span><div><div className="section-kicker">AVAILABLE NOW</div><h2 id="seller-heading">On the market <span className="count-badge">{visibleSellers.length}</span></h2></div></div><div className="section-controls"><button className="button button-outline section-post" type="button" onClick={() => openListing("sell")}><Plus size={15} /> Sell a mineral</button><button className="round-control" type="button" aria-label="Scroll seller listings left" onClick={() => scrollRail(sellerRail.current, -1)}><ArrowLeft size={17} /></button><button className="round-control" type="button" aria-label="Scroll seller listings right" onClick={() => scrollRail(sellerRail.current, 1)}><ArrowRight size={17} /></button></div></div>
        {visibleSellers.length ? <div className="seller-rail" ref={sellerRail}>{visibleSellers.map((listing, index) => <article className="seller-card" key={listing.id} style={{ animationDelay: `${index * 70}ms` }}><div className="seller-photo" style={{ backgroundImage: listing.image ? `url("${listing.image}")` : undefined, backgroundColor: listing.accent }} role="img" aria-label={`${listing.mineral} for sale`}>{!listing.image && <Gem size={38} strokeWidth={1.2} />}<span className="photo-tag"><span /> VERIFIED SELLER</span><button className="photo-action" type="button" aria-label={`Contact ${listing.seller}`} onClick={() => setNotice(`${listing.seller}: ${listing.phone} · ${listing.email}`)}><ArrowUpRight size={17} /></button></div><div className="seller-card-info"><div className="seller-name-row"><h3>{listing.mineral}</h3><span className="weight-tag">{listing.weight} {listing.unit}</span></div><div className="seller-price">{money(listing.price, listing.currency)}</div><div className="seller-meta"><span>{listing.seller}</span><span>{listing.location}</span></div></div></article>)}</div> : <div className="empty-search">{query ? `No minerals match “${query}”.` : "No mineral listings yet."}</div>}
        <div className="rail-hint"><span>SCROLL TO EXPLORE</span><span className="rail-line" /><ArrowRight size={14} /></div>
      </section>

      <section className="listing-section buyer-section" aria-labelledby="buyer-heading"><div className="section-head"><div className="section-title-wrap"><span className="section-index buyer-index">02</span><div><div className="section-kicker">WANTED BY THE COMMUNITY</div><h2 id="buyer-heading">Buyers looking <span className="count-badge count-badge-light">{visibleBuyers.length}</span></h2></div></div><div className="section-controls"><button className="button button-lime section-post" type="button" onClick={() => openListing("buy")}><Plus size={15} /> Post a request</button><button className="round-control round-control-light" type="button" aria-label="Scroll buyer requests left" onClick={() => scrollRail(buyerRail.current, -1)}><ArrowLeft size={17} /></button><button className="round-control round-control-light" type="button" aria-label="Scroll buyer requests right" onClick={() => scrollRail(buyerRail.current, 1)}><ArrowRight size={17} /></button></div></div>
        {visibleBuyers.length ? <div className="buyer-rail" ref={buyerRail}>{visibleBuyers.map((request, index) => <article className="buyer-card" key={request.id} style={{ animationDelay: `${index * 70}ms` }}><div className="buyer-card-top"><span className="wanted-tag"><ArrowDownRight size={14} /> WANTED</span><span className="buyer-location">{request.location}</span></div><h3>{request.mineral}<span className="buyer-shape">{request.shape}</span></h3><div className="buyer-specs"><div><span>WEIGHT</span><strong>{request.weight} {request.unit}</strong></div><div><span>COLOUR</span><strong>{request.color}</strong></div><div><span>QUALITY</span><strong>{request.quality}</strong></div></div><div className="buyer-card-bottom"><div><span>OFFER</span><strong>{money(request.offer, request.currency)}</strong></div><button type="button" aria-label={`Contact ${request.buyer}`} onClick={() => setNotice(`${request.buyer}: ${request.phone} · ${request.email}`)}><ArrowUpRight size={18} /></button></div></article>)}</div> : <div className="empty-search empty-search-dark">{query ? `No requests match “${query}”.` : "No buying requests yet."}</div>}
        <div className="buyer-rail-hint"><span>HAVE WHAT THEY NEED?</span><span className="rail-line" /><button type="button" onClick={() => openListing("sell")}>List a mineral <ArrowUpRight size={14} /></button></div>
      </section>
      <footer className="site-footer"><span><Gem size={16} /> MADINIMARKET</span><span>Built for a fairer mineral trade.</span><span>PREVIEW MARKET · 2025—26</span></footer>
    </div>

    {notice && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDialog(null); setEditingSubmission(null); } }}><section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => { setDialog(null); setEditingSubmission(null); }}><X size={19} /></button><div className="dialog-brand"><Gem size={19} /> MADINIMARKET</div>
      {dialog === "signout" && <><div className="dialog-kicker">ACCOUNT</div><h2 id="dialog-title">Sign out?</h2><p className="dialog-copy">Are you sure you want to sign out?</p><div className="signout-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="button" onClick={() => void signOut()}>Sign out</button></div></>}
      {dialog === "create" && <><div className="dialog-kicker">ONE ACCOUNT, BOTH SIDES</div><h2 id="dialog-title">Join the market.</h2><p className="dialog-copy">Create your account to buy, sell, or both.</p><form className="form-stack" onSubmit={createAccount}><div className="field-row"><Field label="First name" name="firstName" required autoComplete="given-name" /><Field label="Surname" name="surname" required autoComplete="family-name" /></div><Field label="Email address" name="email" type="email" required autoComplete="email" /><Field label="Phone number" name="phone" type="tel" required autoComplete="tel" /><Field label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" /><button className="button button-dark form-submit" type="submit">Create account <ArrowUpRight size={16} /></button></form><p className="form-footnote">Your username appears here for one minute after account creation.</p><button className="switch-dialog" type="button" onClick={() => setDialog("signin")}>Already registered? <strong>Sign in</strong></button></>}
      {dialog === "signin" && <><div className="dialog-kicker">WELCOME BACK</div><h2 id="dialog-title">Good to see you.</h2><p className="dialog-copy">Sign in with your Madinimarket username.</p><form className="form-stack" onSubmit={signIn}><Field label="Username" name="username" placeholder="MM-1254" required autoComplete="username" /><Field label="Password" name="password" type="password" required autoComplete="current-password" /><button className="button button-dark form-submit" type="submit">Sign in <ArrowUpRight size={16} /></button></form><p className="form-footnote">{isSupabaseConfigured ? "Use your account username and password to continue." : "Supabase is not configured. This local sign-in is for interface preview only."}</p><button className="switch-dialog" type="button" onClick={() => setDialog("create")}>New to the market? <strong>Create account</strong></button></>}
      {dialog === "sell" && <><div className="dialog-kicker">SELL A MINERAL</div><h2 id="dialog-title">{editingSeller ? "Edit your listing." : "Submit a listing."}</h2><p className="dialog-copy">An admin must approve the listing before it appears on the market.</p><form className="form-stack form-scroll" onSubmit={addSeller}><Field label="Mineral name" name="mineral" placeholder="e.g. Tanzanite" defaultValue={editingSeller?.mineral ?? ""} required /><div className="field-row field-row-weight"><Field label="Weight" name="weight" type="number" min="0.01" step="any" defaultValue={editingSeller?.weight ?? ""} required /><SelectField label="Unit" name="unit" defaultValue={editingSeller?.unit ?? ""} options={[["carats", "Carats"], ["g", "Grams"], ["kg", "Kilograms"], ["tons", "Tons"]]} /></div><div className="field-row field-row-weight"><Field label="Price" name="price" type="number" min="0.01" step="any" defaultValue={editingSeller?.price ?? ""} required /><SelectField label="Currency" name="currency" defaultValue={editingSeller?.currency ?? ""} options={[["TZS", "TZS"], ["USD", "USD"]]} /></div><label className="field-label">Square mineral photo<input className="file-input" name="image" type="file" accept="image/png,image/jpeg" required={!editingSeller?.image && !editingSeller?.image_path} /><span className="file-drop"><Plus size={17} /><span>{editingSeller?.image || editingSeller?.image_path ? "Choose a replacement PNG or JPG" : "Choose PNG or JPG"}</span><small>Square crop looks best</small></span></label><Field label="Seller name" name="seller" defaultValue={editingSeller?.seller ?? ""} required /><div className="field-row"><Field label="Country" name="country" defaultValue={editingSeller?.country ?? ""} required /><Field label="Region" name="region" defaultValue={editingSeller?.region ?? ""} required /></div><div className="field-row"><Field label="District" name="district" defaultValue={editingSeller?.district ?? ""} required /><Field label="Street" name="street" defaultValue={editingSeller?.street ?? ""} required /></div><div className="field-row"><Field label="Email address" name="email" type="email" defaultValue={editingSeller?.email ?? ""} required /><Field label="Phone number" name="phone" type="tel" defaultValue={editingSeller?.phone ?? ""} required /></div><button className="button button-dark form-submit" type="submit">{editingSeller ? "Resubmit for approval" : "Submit for approval"} <ArrowUpRight size={16} /></button></form></>}
      {dialog === "buy" && <><div className="dialog-kicker">POST A BUYING REQUEST</div><h2 id="dialog-title">{editingBuyer ? "Edit your request." : "Submit a request."}</h2><p className="dialog-copy">An admin must approve the request before it appears on the market.</p><form className="form-stack form-scroll" onSubmit={addBuyer}><Field label="Mineral name" name="mineral" placeholder="e.g. Blue sapphire" defaultValue={editingBuyer?.mineral ?? ""} required /><div className="field-row field-row-weight"><Field label="Desired weight" name="weight" placeholder="e.g. 25–50" defaultValue={editingBuyer?.weight ?? ""} required /><SelectField label="Unit" name="unit" defaultValue={editingBuyer?.unit ?? ""} options={[["carats", "Carats"], ["g", "Grams"], ["kg", "Kilograms"], ["tons", "Tons"]]} /></div><div className="field-row"><Field label="Colour" name="color" placeholder="e.g. Deep blue" defaultValue={editingBuyer?.color ?? ""} required /><SelectField label="Shape" name="shape" defaultValue={editingBuyer?.shape ?? ""} options={[["Cut", "Cut"], ["Uncut", "Uncut"]]} /></div><Field label="Quality" name="quality" placeholder="e.g. Eye-clean, AAA" defaultValue={editingBuyer?.quality ?? ""} required /><div className="field-row field-row-weight"><Field label="Offer price" name="offer" type="number" min="0.01" step="any" defaultValue={editingBuyer?.offer ?? ""} required /><SelectField label="Currency" name="currency" defaultValue={editingBuyer?.currency ?? ""} options={[["TZS", "TZS"], ["USD", "USD"]]} /></div><Field label="Buyer name" name="buyer" defaultValue={editingBuyer?.buyer ?? ""} required /><Field label="Location" name="location" placeholder="City, region" defaultValue={editingBuyer?.location ?? ""} required /><div className="field-row"><Field label="Email address" name="email" type="email" defaultValue={editingBuyer?.email ?? ""} required /><Field label="Phone number" name="phone" type="tel" defaultValue={editingBuyer?.phone ?? ""} required /></div><button className="button button-dark form-submit" type="submit">{editingBuyer ? "Resubmit for approval" : "Submit for approval"} <ArrowUpRight size={16} /></button></form></>}
      {dialog === "submissions" && <><div className="dialog-kicker">YOUR ACCOUNT</div><h2 id="dialog-title">Your submissions</h2><p className="dialog-copy">Pending items are waiting for admin review. Rejected items can be edited or deleted.</p><div className="submission-list">{mySellers.map((item) => <article className="submission-item" key={`seller-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className={`submission-status status-${item.status}`}>{item.status}</span></div><p>{item.weight} {item.unit} · {money(item.price, item.currency)}</p>{item.review_message && <p className="submission-message">Admin message: {item.review_message}</p>}<div className="submission-actions"><button className="button button-outline" type="button" onClick={() => editSubmission("seller", item)}>Edit</button><button className="text-button" type="button" onClick={() => void deleteSubmission("seller", item)}>Delete</button></div></article>)}{myBuyers.map((item) => <article className="submission-item" key={`buyer-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className={`submission-status status-${item.status}`}>{item.status}</span></div><p>{item.weight} {item.unit} · {money(item.offer, item.currency)}</p>{item.review_message && <p className="submission-message">Admin message: {item.review_message}</p>}<div className="submission-actions"><button className="button button-outline" type="button" onClick={() => editSubmission("buyer", item)}>Edit</button><button className="text-button" type="button" onClick={() => void deleteSubmission("buyer", item)}>Delete</button></div></article>)}{!mySellers.length && !myBuyers.length && <div className="empty-search">You have no pending or rejected submissions.</div>}</div></>}
      {dialog === "review" && role === "admin" && <><div className="dialog-kicker">ADMIN REVIEW</div><h2 id="dialog-title">Review queue</h2><p className="dialog-copy">Approved items appear on the market. Rejected items return to their owner with your message.</p><div className="submission-list">{pendingSellers.map((item) => <article className="submission-item review-item" key={`review-seller-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className="submission-status status-pending">Seller listing</span></div><p>{item.weight} {item.unit} · {money(item.price, item.currency)} · {item.seller}</p><p>{item.location} · {item.phone} · {item.email}</p><textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to seller (required to reject)" value={rejectionMessages[`seller-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`seller-${item.id}`, event.target.value)} /><div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("seller", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("seller", item.id, false)}>Reject</button></div></article>)}{pendingBuyers.map((item) => <article className="submission-item review-item" key={`review-buyer-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className="submission-status status-pending">Buyer request</span></div><p>{item.weight} {item.unit} · {item.color} · {item.shape} · {item.quality}</p><p>{money(item.offer, item.currency)} · {item.buyer} · {item.phone} · {item.email}</p><textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to buyer (required to reject)" value={rejectionMessages[`buyer-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`buyer-${item.id}`, event.target.value)} /><div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("buyer", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("buyer", item.id, false)}>Reject</button></div></article>)}{!pendingSellers.length && !pendingBuyers.length && <div className="empty-search">The review queue is clear.</div>}</div></>}
    </section></div>}
  </main>;
}

function Field(props: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; autoComplete?: string; min?: string; step?: string; minLength?: number; pattern?: string; defaultValue?: string }) {
  const { label, ...inputProps } = props;
  return <label className="field-label">{label}<input className="text-input" {...inputProps} /></label>;
}
function SelectField({ label, name, options, defaultValue = "" }: { label: string; name: string; options: [string, string][]; defaultValue?: string }) {
  return <label className="field-label">{label}<span className="select-wrap"><select className="text-input" name={name} defaultValue={defaultValue} required><option value="" disabled>Select {label.toLowerCase()}</option>{options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><ChevronDown size={15} /></span></label>;
}