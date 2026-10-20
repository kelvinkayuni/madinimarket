"use client";

import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Eye, EyeOff, Gem, Menu, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

type Unit = "g" | "kg" | "tons" | "carats";
type Currency = "TZS" | "USD";
type SubmissionStatus = "pending" | "approved" | "rejected";
type CertificateKind = "dealer" | "broker";
type CertificateStatus = "pending" | "approved" | "rejected";
type CertificateSubmission = { id: string; kind: CertificateKind; status: CertificateStatus; review_message: string | null; file_name: string; signed_url: string; created_at: string };
type AdminCertificate = CertificateSubmission & { website_user_id: string; account?: { username: string; display_name: string; email: string } };
type Seller = { id: number; user_id?: string; mineral: string; weight: string; unit: Unit; price: string; currency: Currency; seller: string; location: string; country?: string; region?: string; district?: string; street?: string; email: string; phone: string; image: string; image_path?: string | null; stone_certificate_url?: string | null; accent: string; status: SubmissionStatus; review_message?: string | null };
type Buyer = { id: number; user_id?: string; mineral: string; weight: string; unit: Unit; color: string; shape: "Cut" | "Uncut"; quality: string; offer: string; currency: Currency; buyer: string; location: string; email: string; phone: string; status: SubmissionStatus; review_message?: string | null };
type WebsiteAccount = { id: string; display_name: string; username: string; email: string; phone: string | null; is_active: boolean; created_at: string; listings: SubmissionCounts; buying_requests: SubmissionCounts };
type SubmissionCounts = { total: number; pending: number; approved: number; rejected: number };
type WebsiteDraft = { kind: "seller" | "buyer"; payload: Record<string, string | number>; image_path: string | null; image_url?: string; updated_at: string };
type EditingSubmission = { kind: "seller"; item: Seller } | { kind: "buyer"; item: Buyer } | null;
type Dialog = "create" | "signin" | "sell" | "buy" | "review" | "submissions" | "signout" | null;

const SELLERS_STORAGE_KEY = "madinimarket:sellers:v1";
const BUYERS_STORAGE_KEY = "madinimarket:buyers:v1";
const USER_STORAGE_KEY = "madinimarket:user:v1";
const signedMineralImageUrls = new Map<string, { url: string; expiresAt: number }>();

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

async function getSignedMineralImageUrl(
  supabase: ReturnType<typeof getSupabaseBrowserClient>,
  imagePath: string,
  refreshedUrl?: string,
) {
  const cached = signedMineralImageUrls.get(imagePath);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;
  const url = refreshedUrl ?? (await supabase.storage.from("mineral-images").createSignedUrl(imagePath, 3600)).data?.signedUrl ?? "";
  if (url) signedMineralImageUrls.set(imagePath, { url, expiresAt: Date.now() + 50 * 60 * 1000 });
  return url;
}

async function loadMarketplaceListings(includeOwnSubmissions = false, adminAccessToken?: string) {
  const supabase = getSupabaseBrowserClient();
  const [sellerResult, buyerResult] = await Promise.all([
    supabase.from("marketplace_listings").select("*").order("created_at", { ascending: false }),
    supabase.from("marketplace_buy_requests").select("*").order("created_at", { ascending: false }),
  ]);
  if (sellerResult.error) throw sellerResult.error;
  if (buyerResult.error) throw buyerResult.error;

  let sellerRows = sellerResult.data ?? [];
  let buyerRows = buyerResult.data ?? [];
  if (adminAccessToken) {
    const response = await fetch("/api/admin/review-queue", {
      headers: { Authorization: `Bearer ${adminAccessToken}` },
      cache: "no-store",
    });
    const reviewQueue = await response.json();
    if (!response.ok) throw new Error(reviewQueue.error ?? "Could not load pending submissions.");
    sellerRows = [...sellerRows, ...(reviewQueue.sellers ?? [])];
    buyerRows = [...buyerRows, ...(reviewQueue.buyers ?? [])];
  }
  if (includeOwnSubmissions) {
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
  }

  const sellers = await Promise.all(sellerRows.map(async (row) => {
    let image = "";
    if (row.image_path) {
      image = await getSignedMineralImageUrl(supabase, row.image_path, row.signed_image_url);
    }
    return {
      id: Number(row.id), user_id: row.website_user_id ?? row.user_id, mineral: row.mineral_name, weight: String(row.weight),
      unit: row.unit as Unit, price: String(row.price), currency: row.currency as Currency,
      seller: row.seller_name ?? "", country: row.country, region: row.region, district: row.district,
      location: [row.district, row.region, row.country].filter(Boolean).join(", "), email: row.email ?? "", phone: row.phone ?? "",
      image, image_path: row.image_path, accent: "#43866b", status: row.status as SubmissionStatus,
      review_message: row.review_message, stone_certificate_url: row.signed_stone_certificate_url ?? null,
    } satisfies Seller;
  }));
  const buyers = buyerRows.map((row) => ({
    id: Number(row.id), user_id: row.website_user_id ?? row.user_id, mineral: row.mineral_name, weight: String(row.weight),
    unit: row.unit as Unit, color: row.color, shape: row.shape as Buyer["shape"], quality: row.quality,
    offer: String(row.offer), currency: row.currency as Currency, buyer: row.buyer_name, location: row.location,
    email: row.email ?? "", phone: row.phone ?? "", status: row.status as SubmissionStatus, review_message: row.review_message,
  } satisfies Buyer));
  return { sellers, buyers };
}

async function loadAdminAccounts(accessToken: string): Promise<WebsiteAccount[]> {
  const response = await fetch("/api/admin/website-accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load website accounts.");
  return result.accounts as WebsiteAccount[];
}

async function loadAdminCertificates(accessToken: string): Promise<AdminCertificate[]> {
  const response = await fetch("/api/admin/certificates", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load licence reviews.");
  return result.certificates as AdminCertificate[];
}

export default function Marketplace() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [websiteAccounts, setWebsiteAccounts] = useState<WebsiteAccount[]>([]);
  const [certificates, setCertificates] = useState<Partial<Record<CertificateKind, CertificateSubmission>>>({});
  const [certificateFiles, setCertificateFiles] = useState<Partial<Record<CertificateKind, File>>>({});
  const [adminCertificates, setAdminCertificates] = useState<AdminCertificate[]>([]);
  const [certificateRejectionMessages, setCertificateRejectionMessages] = useState<Record<string, string>>({});
  const [busyCertificate, setBusyCertificate] = useState<CertificateKind | string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"user" | "admin" | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [sellerImagePreview, setSellerImagePreview] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [rejectionMessages, setRejectionMessages] = useState<Record<string, string>>({});
  const [websiteDrafts, setWebsiteDrafts] = useState<{ seller: WebsiteDraft | null; buyer: WebsiteDraft | null }>({ seller: null, buyer: null });
  const [editingSubmission, setEditingSubmission] = useState<EditingSubmission>(null);
  const draftSaveTimers = useRef<{ seller: number | null; buyer: number | null }>({ seller: null, buyer: null });
  const draftRestoreDialog = useRef<Dialog>(null);
  const sellerRail = useRef<HTMLDivElement>(null);
  const buyerRail = useRef<HTMLDivElement>(null);

  const withProgress = async (key: string, action: () => Promise<void>) => {
    if (busyActions.has(key)) return;
    setBusyActions((current) => new Set(current).add(key));
    try {
      await action();
    } finally {
      setBusyActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!sellerImagePreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(sellerImagePreview);
  }, [sellerImagePreview]);
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
          let hasWebsiteAccount = false;
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
              setDisplayName(profile?.username ?? "");
              setUserId(session.user.id);
              setRole("admin");
            }
            if (!isAdmin) await supabase.auth.signOut({ scope: "local" });
          }
          if (!isAdmin) {
            const response = await fetch("/api/auth/website-session", { cache: "no-store" });
            const result = response.ok ? await response.json() : null;
            hasWebsiteAccount = Boolean(result?.account);
            if (active) {
              setUser(result?.account?.username ?? "");
              setDisplayName(result?.account?.display_name ?? "");
              setUserId(result?.account?.id ?? "");
              setRole(result?.account ? "user" : null);
              if (!result?.account) setCertificates({});
            }
            if (result?.account) {
              const certificateResponse = await fetch("/api/website-certificates", { cache: "no-store" });
              if (certificateResponse.ok) {
                const certificateResult = await certificateResponse.json();
                const nextCertificates: Partial<Record<CertificateKind, CertificateSubmission>> = {};
                for (const certificate of certificateResult.certificates as CertificateSubmission[]) nextCertificates[certificate.kind] = certificate;
                if (active) setCertificates(nextCertificates);
              }
            }
          }
          try {
            const listings = await loadMarketplaceListings(hasWebsiteAccount, isAdmin ? session?.access_token : undefined);
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
          if (active && isAdmin && session) {
            try {
              setWebsiteAccounts(await loadAdminAccounts(session.access_token));
              setAdminCertificates(await loadAdminCertificates(session.access_token));
            } catch {
              setNotice("Could not load website accounts.");
            }
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

    const hydrationTimer = window.setTimeout(() => {
      setSellers(readStoredArray<Seller>(SELLERS_STORAGE_KEY));
      setBuyers(readStoredArray<Buyer>(BUYERS_STORAGE_KEY));
      try {
        const storedUser = localStorage.getItem(USER_STORAGE_KEY) ?? "";
        setUser(storedUser);
        setDisplayName(storedUser);
        setUserId(storedUser);
        setRole(storedUser ? "user" : null);
      } catch {
        setUser("");
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, []);
  useEffect(() => {
    if (!storageReady || isSupabaseConfigured) return;
    try {
      localStorage.setItem(SELLERS_STORAGE_KEY, JSON.stringify(sellers));
      localStorage.setItem(BUYERS_STORAGE_KEY, JSON.stringify(buyers));
      if (user) localStorage.setItem(USER_STORAGE_KEY, user);
      else localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      window.setTimeout(() => setNotice("This browser could not save your marketplace changes."), 0);
    }
  }, [storageReady, sellers, buyers, user]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const openDialog = (next: Exclude<Dialog, null>) => { setMenuOpen(false); setDialog(next); };
  const refreshCertificates = async () => {
    const response = await fetch("/api/website-certificates", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load your licences.");
    const nextCertificates: Partial<Record<CertificateKind, CertificateSubmission>> = {};
    for (const certificate of result.certificates as CertificateSubmission[]) nextCertificates[certificate.kind] = certificate;
    setCertificates(nextCertificates);
  };
  const hasApprovedCertificate = Boolean(certificates.dealer?.status === "approved" || certificates.broker?.status === "approved");
  const openListing = async (type: "sell" | "buy") => {
    await withProgress(`open-${type}`, async () => {
    if (!user) { setNotice("Sign in first to post."); openDialog("signin"); return; }
    if (type === "sell" && role === "user" && !hasApprovedCertificate) {
      const certificatePanel = document.getElementById("certificate-manager");
      if (certificatePanel instanceof HTMLDetailsElement) certificatePanel.open = true;
      setNotice("An approved dealer or broker licence is required before listing a mineral.");
      document.getElementById("certificate-manager")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (isSupabaseConfigured && role === "user") await refreshWebsiteDrafts().catch(() => {});
    setSellerImagePreview(null);
    setEditingSubmission(null);
    openDialog(type);
    });
  };
  const scrollRail = (rail: HTMLDivElement | null, direction: number) => rail?.scrollBy({ left: direction * 360, behavior: "smooth" });
  const visibleSellers = sellers.filter((item) => item.status === "approved" && `${item.mineral} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  const visibleBuyers = buyers.filter((item) => item.status === "approved" && `${item.mineral} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  const refreshRemoteListings = async (includeOwnSubmissions = role === "user") => {
    let adminAccessToken: string | undefined;
    if (role === "admin") {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      adminAccessToken = session?.access_token;
    }
    const listings = await loadMarketplaceListings(includeOwnSubmissions, adminAccessToken);
    setSellers(listings.sellers);
    setBuyers(listings.buyers);
    setLastUpdated(new Date());
    return listings;
  };
  const refreshWebsiteDrafts = async () => {
    const response = await fetch("/api/website-drafts", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    const next = { seller: null, buyer: null } as { seller: WebsiteDraft | null; buyer: WebsiteDraft | null };
    for (const draft of result.drafts as WebsiteDraft[]) next[draft.kind] = draft;
    setWebsiteDrafts((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  };
  const persistWebsiteDraft = async (kind: "seller" | "buyer", formElement: HTMLFormElement, saveImage: boolean, keepalive = false) => {
    if (!isSupabaseConfigured || role !== "user" || !userId) return;
    const form = new FormData(formElement);
    const payload: Record<string, string | number> = {};
    for (const [key, value] of form.entries()) if (typeof value === "string") payload[key] = value;
    if (editingSubmission?.kind === kind) payload.submissionId = editingSubmission.item.id;
    const imageFile = form.get("image");
    let imageData: string | undefined;
    if (kind === "seller" && saveImage && imageFile instanceof File && imageFile.size) {
      try {
        imageData = await storeMineralPhoto(imageFile);
      } catch {
        setNotice("The photo could not be saved as a draft. Please try another PNG or JPG.");
        return;
      }
    }
    try {
      const response = await fetch("/api/website-drafts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload, imageData }),
        keepalive,
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "Your draft could not be saved."); return; }
      setWebsiteDrafts((current) => ({ ...current, [kind]: result.draft as WebsiteDraft }));
    } catch {
      setNotice("Your draft could not be synchronized. Keep this page open and try again.");
    }
  };
  const queueWebsiteDraftSave = (kind: "seller" | "buyer", formElement: HTMLFormElement, saveImage = false) => {
    if (!isSupabaseConfigured || role !== "user") return;
    const previousTimer = draftSaveTimers.current[kind];
    if (previousTimer !== null) window.clearTimeout(previousTimer);
    if (saveImage) {
      draftSaveTimers.current[kind] = null;
      void persistWebsiteDraft(kind, formElement, true);
      return;
    }
    draftSaveTimers.current[kind] = window.setTimeout(() => {
      draftSaveTimers.current[kind] = null;
      void persistWebsiteDraft(kind, formElement, false);
    }, 350);
  };
  const queueWebsiteDraftSaveEvent = useEffectEvent(queueWebsiteDraftSave);
  const persistWebsiteDraftEvent = useEffectEvent(persistWebsiteDraft);
  useEffect(() => {
    const saveFormChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      const form = target.closest<HTMLFormElement>("form.form-scroll");
      if (!form) return;
      const kind = form.elements.namedItem("seller") ? "seller" : form.elements.namedItem("buyer") ? "buyer" : null;
      if (!kind) return;
      const saveImage = event.type === "change" && target instanceof HTMLInputElement && target.type === "file" && target.name === "image";
      if (saveImage && target instanceof HTMLInputElement) {
        const file = target.files?.[0];
        setSellerImagePreview(file ? URL.createObjectURL(file) : null);
      }
      queueWebsiteDraftSaveEvent(kind, form, saveImage);
    };
    const flushOpenDraft = () => {
      const form = document.querySelector<HTMLFormElement>(".dialog-panel form.form-scroll");
      if (!form) return;
      const kind = form.elements.namedItem("seller") ? "seller" : form.elements.namedItem("buyer") ? "buyer" : null;
      if (kind) void persistWebsiteDraftEvent(kind, form, false, true);
    };
    document.addEventListener("input", saveFormChange);
    document.addEventListener("change", saveFormChange);
    window.addEventListener("pagehide", flushOpenDraft);
    return () => {
      document.removeEventListener("input", saveFormChange);
      document.removeEventListener("change", saveFormChange);
      window.removeEventListener("pagehide", flushOpenDraft);
    };
  }, [role, userId]);
  useEffect(() => {
    if (dialog !== "sell" && dialog !== "buy") {
      draftRestoreDialog.current = null;
      return;
    }
    if (draftRestoreDialog.current === dialog) return;
    draftRestoreDialog.current = dialog;
    if (editingSubmission) return;
    const kind = dialog === "sell" ? "seller" : "buyer";
    const draft = websiteDrafts[kind];
    if (!draft) return;
    const form = document.querySelector<HTMLFormElement>(".dialog-panel form.form-scroll");
    if (!form) return;
    for (const [name, value] of Object.entries(draft.payload)) {
      if (name === "submissionId") continue;
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = String(value);
    }
    if (kind === "seller" && draft.image_path) {
      const imageInput = form.elements.namedItem("image");
      if (imageInput instanceof HTMLInputElement) imageInput.required = false;
      const imageLabel = form.querySelector<HTMLElement>(".file-drop > span");
      if (imageLabel) imageLabel.textContent = "Saved draft photo will be used";
    }
  }, [dialog, editingSubmission, websiteDrafts]);
      useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    let syncing = false;

    const synchronize = async () => {
      if (!active || syncing || document.visibilityState !== "visible") return;
      syncing = true;

      try {
        const listings = await loadMarketplaceListings(role === "user");

        if (active && role === "user") {
          setSellers(listings.sellers);
          setBuyers(listings.buyers);
          setLastUpdated(new Date());
        } else if (active) {
          setSellers((previous) => {
            const retained = previous.filter(
              (item) => item.status === "pending" || item.status === "rejected"
            );
            const approvedFromFresh = listings.sellers.filter(
              (item) => item.status === "approved"
            );

            const merged = [...retained, ...approvedFromFresh];
            const seen = new Set<number>();

            return merged.filter((item) => {
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            });
          });

          setBuyers((previous) => {
            const retained = previous.filter(
              (item) => item.status === "pending" || item.status === "rejected"
            );
            const approvedFromFresh = listings.buyers.filter(
              (item) => item.status === "approved"
            );

            const merged = [...retained, ...approvedFromFresh];
            const seen = new Set<number>();

            return merged.filter((item) => {
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            });
          });

          setLastUpdated(new Date());
        }
      } catch {
        // Keep the last successful Supabase snapshot when a poll fails.
      }
      if (active && role === "user") {
        await Promise.all([refreshWebsiteDrafts(), refreshCertificates()]).catch(() => {});
      }
      syncing = false;
    };

    const interval = window.setInterval(() => void synchronize(), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [role, userId]);
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
  const refreshAdminAccounts = async () => {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session) throw new Error("Admin session expired.");
    setWebsiteAccounts(await loadAdminAccounts(session.access_token));
  };
  const refreshAdminCertificates = async () => {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session) throw new Error("Admin session expired.");
    setAdminCertificates(await loadAdminCertificates(session.access_token));
  };
  const submitCertificate = async (kind: CertificateKind) => {
    const file = certificateFiles[kind];
    if (!file || role !== "user") return;
    setBusyCertificate(kind);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const response = await fetch("/api/website-certificates", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not submit the licence.");
      setCertificates((current) => ({ ...current, [kind]: result.certificate as CertificateSubmission }));
      setCertificateFiles((current) => ({ ...current, [kind]: undefined }));
      setNotice("Licence received by the admin for verification.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit the licence.");
    } finally {
      setBusyCertificate(null);
    }
  };
  const reviewCertificate = async (certificate: AdminCertificate, approved: boolean) => {
    const message = certificateRejectionMessages[certificate.id]?.trim() ?? "";
    if (!approved && !message) { setNotice("Add a rejection reason before rejecting this licence."); return; }
    setBusyCertificate(certificate.id);
    try {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/certificates", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: certificate.id, approved, message }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save the licence review.");
      setCertificateRejectionMessages((current) => ({ ...current, [certificate.id]: "" }));
      await refreshAdminCertificates();
      setNotice(approved ? "Licence approved. The account can now list minerals." : "Licence rejected and returned with your reason.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the licence review.");
    } finally {
      setBusyCertificate(null);
    }
  };
  const updateWebsiteAccount = async (account: WebsiteAccount, isActive: boolean) => {
    const action = isActive ? "activate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${action} ${account.username}?`)) return;
    setBusyAccountId(account.id);
    try {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/website-accounts", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id, is_active: isActive }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update account.");
      await refreshAdminAccounts();
      setNotice(`Account ${account.username} ${isActive ? "activated" : "deactivated"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update account.");
    } finally {
      setBusyAccountId(null);
    }
  };
  const deleteWebsiteAccount = async (account: WebsiteAccount) => {
    if (!window.confirm(`Permanently delete ${account.username} and all of its submissions and drafts? This cannot be undone.`)) return;
    setBusyAccountId(account.id);
    try {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/website-accounts", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete account.");
      setWebsiteAccounts((current) => current.filter((item) => item.id !== account.id));
      setNotice(`Account ${account.username} deleted.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete account.");
    } finally {
      setBusyAccountId(null);
    }
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
  const editSubmission = async (kind: "seller" | "buyer", item: Seller | Buyer) => {
    await withProgress(`submission-edit-${kind}-${item.id}`, async () => {
      let currentItem = item;
      if (isSupabaseConfigured && role === "user") {
        try {
          const listings = await refreshRemoteListings(true);
          const latestItem = (kind === "seller" ? listings.sellers : listings.buyers).find((submission) => submission.id === item.id);
          if (!latestItem || latestItem.status === "approved") {
            setNotice("This submission is no longer available to edit.");
            return;
          }
          if (latestItem.status === "pending") {
            setNotice("This submission is still waiting for review and cannot be edited yet.");
            return;
          }
          currentItem = latestItem;
        } catch {
          setNotice("Could not load the latest submission. Please try again.");
          return;
        }
      }
      setSellerImagePreview(null);
      setEditingSubmission(kind === "seller" ? { kind, item: currentItem as Seller } : { kind, item: currentItem as Buyer });
      setDialog(kind === "seller" ? "sell" : "buy");
    });
  };
  const mySellers = sellers.filter((item) => item.user_id === userId && item.status !== "approved");
const myBuyers = buyers.filter((item) => item.user_id === userId && item.status !== "approved");
  const pendingSellers = role === "admin" ? sellers.filter((item) => item.status === "pending") : [];
  const pendingBuyers = role === "admin" ? buyers.filter((item) => item.status === "pending") : [];

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("account-create", async () => {
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
        formElement.reset();
        setDialog("signin");
        setNotice(`Account created. Your username has been sent to ${result.email}. Sign in to continue.`);
        return;
      }
      setNotice("Account creation is unavailable until the account service is connected.");
    });
  };
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("account-signin", async () => {
      const form = new FormData(formElement);
      const username = String(form.get("username") ?? "").trim();
      const password = String(form.get("password") ?? "");
      let signedInRole: "user" | "admin" = "user";
      if (isSupabaseConfigured) {
        try {
          let websiteAccount: { id: string; username: string; displayName: string } | null = null;
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
            setDisplayName(websiteAccount.displayName);
            setUserId(websiteAccount.id);
            setRole("user");
            await refreshCertificates().catch(() => {});
            await refreshRemoteListings(true);
            setNotice("Signed in successfully.");
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
          setDisplayName(profile.username);
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
        setDisplayName(username);
        setUserId(username);
        setRole("user");
        setNotice(`Local demo session started as ${username}.`);
      }
      formElement.reset();
      setDialog(null);
    });
  };
  const signOut = async () => {
    if (isSupabaseConfigured) {
      if (role === "admin") await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
      else await fetch("/api/auth/website-session", { method: "DELETE" });
    }
    setUser("");
    setDisplayName("");
    setUserId("");
    setRole(null);
    setCertificates({});
    setCertificateFiles({});
    setDialog(null);
  };
  const addSeller = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("seller-submit", async () => {
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
      const stoneCertificate = form.get("stoneCertificate");
      const submission = new FormData();
      submission.set("kind", "seller");
      if (existing?.id) submission.set("id", String(existing.id));
      submission.set("imageData", imageData);
      submission.set("values", JSON.stringify({
        mineral_name: listing.mineral, weight: listing.weight, unit: listing.unit, price: listing.price,
        currency: listing.currency, seller_name: listing.seller, country: listing.country, region: listing.region,
        district: listing.district, street: listing.street, email: listing.email, phone: listing.phone,
      }));
      if (stoneCertificate instanceof File && stoneCertificate.size) submission.set("stoneCertificate", stoneCertificate);
      const response = await fetch("/api/website-submissions", {
        method: "POST",
        body: submission,
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "The listing could not be saved."); return; }
      setWebsiteDrafts((current) => ({ ...current, seller: null }));
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
    setSellerImagePreview(null);
    setEditingSubmission(null);
    setDialog(null);
    });
  };
  const addBuyer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("buyer-submit", async () => {
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
      setWebsiteDrafts((current) => ({ ...current, buyer: null }));
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
    });
  };
  const editingSeller = editingSubmission?.kind === "seller" ? editingSubmission.item : null;
  const editingBuyer = editingSubmission?.kind === "buyer" ? editingSubmission.item : null;
  const sellerImagePreviewUrl = sellerImagePreview ?? editingSeller?.image ?? websiteDrafts.seller?.image_url ?? "";

  if (isAdminRole(role)) {
    const pendingTotal = pendingSellers.length + pendingBuyers.length;
    return <main className="admin-shell">
      <header className="admin-header">
        <a className="admin-brand" href="#admin-home"><Gem size={20} /> MADINIMARKET <span>ADMIN</span></a>
        <div className="admin-header-actions"><span className="admin-account">{user}</span><button className="text-button" type="button" onClick={() => setDialog("signout")}>Sign out</button></div>
      </header>
      <div className="admin-content" id="admin-home">
        <section className="admin-overview">
          <div className="admin-page-heading"><div><div className="dialog-kicker">ADMIN WORKSPACE</div><h1>Review submissions</h1><p>Approve licences, listings, and buyer requests before they appear in the market.</p></div><button className="button button-outline" type="button" disabled={busyActions.has("admin-refresh")} onClick={() => void withProgress("admin-refresh", async () => { try { await Promise.all([refreshRemoteListings(), refreshAdminAccounts(), refreshAdminCertificates()]); } catch { setNotice("Could not refresh admin data."); } })}>{busyActions.has("admin-refresh") ? "Refreshing…" : <><RefreshCw size={15} /> Refresh</>}</button></div>
          <div className="admin-summary">
            <div><span>SELLER LISTINGS</span><strong>{pendingSellers.length}</strong><small>Awaiting review</small></div>
            <div><span>BUYER REQUESTS</span><strong>{pendingBuyers.length}</strong><small>Awaiting review</small></div>
            <div><span>TOTAL PENDING</span><strong>{pendingTotal}</strong><small>Across both queues</small></div>
          </div>
        </section>
        <section className="admin-accounts" aria-labelledby="admin-accounts-heading">
          <div className="admin-queue-heading"><div><span>WEBSITE USERS</span><h2 id="admin-accounts-heading">Accounts</h2></div><strong>{websiteAccounts.length}</strong></div>
          {websiteAccounts.length ? <div className="admin-account-list">{websiteAccounts.map((account) => {
            const totalPosts = account.listings.total + account.buying_requests.total;
            const accountCertificates = adminCertificates.filter((certificate) => certificate.website_user_id === account.id);
            const busy = busyAccountId === account.id;
            return <article className="admin-account-row" key={account.id}>
              <div className="admin-account-identity"><strong>{account.display_name}</strong><span>{account.username} · {account.email}</span><small>{account.phone || "No phone number"}</small></div>
              <div className="admin-account-counts">
                <span><strong>{totalPosts}</strong> total posted</span>
                <span>Selling: <strong>{account.listings.total}</strong> ({account.listings.pending} pending · {account.listings.approved} approved · {account.listings.rejected} rejected)</span>
                <span>Buying: <strong>{account.buying_requests.total}</strong> ({account.buying_requests.pending} pending · {account.buying_requests.approved} approved · {account.buying_requests.rejected} rejected)</span>
              </div>
              <span className={`admin-account-status ${account.is_active ? "is-active" : "is-inactive"}`}>{account.is_active ? "Active" : "Inactive"}</span>
              <div className="admin-account-actions">
                <button className="button button-outline" type="button" disabled={busy || account.is_active} onClick={() => void withProgress(`account-${account.id}-activate`, () => updateWebsiteAccount(account, true))}>{busyActions.has(`account-${account.id}-activate`) ? "Activating…" : "Activate"}</button>
                <button className="button button-outline" type="button" disabled={busy || !account.is_active} onClick={() => void withProgress(`account-${account.id}-deactivate`, () => updateWebsiteAccount(account, false))}>{busyActions.has(`account-${account.id}-deactivate`) ? "Deactivating…" : "Deactivate"}</button>
                <button className="button button-danger" type="button" disabled={busy} onClick={() => void withProgress(`account-${account.id}-delete`, () => deleteWebsiteAccount(account))}>{busyActions.has(`account-${account.id}-delete`) ? "Deleting…" : "Delete"}</button>
              </div>
              {accountCertificates.length > 0 && <details className="admin-account-certificates">
                <summary className="admin-account-certificates-toggle"><span>Pending licences</span><strong>{accountCertificates.length}</strong><ChevronDown className="admin-submission-chevron" size={16} /></summary>
                <div className="admin-account-certificate-list">{accountCertificates.map((certificate) => <article className="admin-account-certificate" key={certificate.id}>
                  <div className="admin-review-title"><div><span>{certificate.kind === "dealer" ? "DEALER LICENCE" : "BROKER LICENCE"}</span><h3>{certificate.account?.display_name ?? account.display_name}</h3></div><span className="submission-status status-pending">Pending</span></div>
                  <a className="certificate-file-link" href={certificate.signed_url} target="_blank" rel="noreferrer">Review {certificate.file_name}</a>
                  <textarea className="review-message" aria-label={`Rejection reason for ${certificate.file_name}`} placeholder="Reason for rejection (required to reject)" value={certificateRejectionMessages[certificate.id] ?? ""} onChange={(event) => setCertificateRejectionMessages((current) => ({ ...current, [certificate.id]: event.target.value }))} />
                  <div className="submission-actions"><button className="button button-dark" type="button" disabled={busyCertificate === certificate.id} onClick={() => void withProgress(`certificate-${certificate.id}-verify`, () => reviewCertificate(certificate, true))}>{busyActions.has(`certificate-${certificate.id}-verify`) ? "Verifying…" : "Verify"}</button><button className="button button-outline" type="button" disabled={busyCertificate === certificate.id || !certificateRejectionMessages[certificate.id]?.trim()} onClick={() => void withProgress(`certificate-${certificate.id}-reject`, () => reviewCertificate(certificate, false))}>{busyActions.has(`certificate-${certificate.id}-reject`) ? "Rejecting…" : "Reject"}</button></div>
                </article>)}</div>
              </details>}
            </article>;
          })}</div> : <p className="admin-empty">No website accounts have been created.</p>}
        </section>
        <div className="admin-queues">
          <section className="admin-queue" aria-labelledby="admin-sellers-heading">
            <div className="admin-queue-heading"><div><span>SELLERS</span><h2 id="admin-sellers-heading">Mineral listings</h2></div><strong>{pendingSellers.length}</strong></div>
            {pendingSellers.length ? <div className="admin-queue-list">{pendingSellers.map((item) => <details className="admin-review-item admin-submission-disclosure" key={`admin-seller-${item.id}`}>
              <summary className="admin-review-title admin-submission-toggle"><div><span>SELLER LISTING</span><h3>{item.mineral}</h3></div><strong>{money(item.price, item.currency)}</strong><ChevronDown className="admin-submission-chevron" size={17} /></summary>
              <div className="admin-submission-details">
                <p>{item.weight} {item.unit} · {item.seller}</p><p>{item.location} · {item.phone} · {item.email}</p>
                {item.image ? <div className="admin-mineral-image"><Image src={item.image} alt={`${item.mineral} mineral submitted by ${item.seller}`} fill sizes="(max-width: 720px) 100vw, 420px" unoptimized /></div> : <p className="admin-image-missing">No mineral photo attached.</p>}
                {item.stone_certificate_url && <p><a className="certificate-file-link" href={item.stone_certificate_url} target="_blank" rel="noreferrer">Review stone certificate</a></p>}
                <textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to seller (required to reject)" value={rejectionMessages[`seller-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`seller-${item.id}`, event.target.value)} />
                <div className="submission-actions"><button className="button button-dark" type="button" disabled={busyActions.has(`review-seller-${item.id}-approve`) || busyActions.has(`review-seller-${item.id}-reject`)} onClick={() => void withProgress(`review-seller-${item.id}-approve`, () => reviewSubmission("seller", item.id, true))}>{busyActions.has(`review-seller-${item.id}-approve`) ? "Approving…" : "Approve"}</button><button className="button button-outline" type="button" disabled={busyActions.has(`review-seller-${item.id}-approve`) || busyActions.has(`review-seller-${item.id}-reject`)} onClick={() => void withProgress(`review-seller-${item.id}-reject`, () => reviewSubmission("seller", item.id, false))}>{busyActions.has(`review-seller-${item.id}-reject`) ? "Rejecting…" : "Reject"}</button></div>
              </div>
            </details>)}</div> : <p className="admin-empty">No seller listings are waiting for review.</p>}
          </section>
          <section className="admin-queue" aria-labelledby="admin-buyers-heading">
            <div className="admin-queue-heading"><div><span>BUYERS</span><h2 id="admin-buyers-heading">Buying requests</h2></div><strong>{pendingBuyers.length}</strong></div>
            {pendingBuyers.length ? <div className="admin-queue-list">{pendingBuyers.map((item) => <details className="admin-review-item admin-submission-disclosure" key={`admin-buyer-${item.id}`}>
              <summary className="admin-review-title admin-submission-toggle"><div><span>BUYER REQUEST</span><h3>{item.mineral}</h3></div><strong>{money(item.offer, item.currency)}</strong><ChevronDown className="admin-submission-chevron" size={17} /></summary>
              <div className="admin-submission-details">
                <p>{item.weight} {item.unit} · {item.color} · {item.shape} · {item.quality}</p><p>{item.location} · {item.buyer} · {item.phone} · {item.email}</p>
                <textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to buyer (required to reject)" value={rejectionMessages[`buyer-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`buyer-${item.id}`, event.target.value)} />
                <div className="submission-actions"><button className="button button-dark" type="button" disabled={busyActions.has(`review-buyer-${item.id}-approve`) || busyActions.has(`review-buyer-${item.id}-reject`)} onClick={() => void withProgress(`review-buyer-${item.id}-approve`, () => reviewSubmission("buyer", item.id, true))}>{busyActions.has(`review-buyer-${item.id}-approve`) ? "Approving…" : "Approve"}</button><button className="button button-outline" type="button" disabled={busyActions.has(`review-buyer-${item.id}-approve`) || busyActions.has(`review-buyer-${item.id}-reject`)} onClick={() => void withProgress(`review-buyer-${item.id}-reject`, () => reviewSubmission("buyer", item.id, false))}>{busyActions.has(`review-buyer-${item.id}-reject`) ? "Rejecting…" : "Reject"}</button></div>
              </div>
            </details>)}</div> : <p className="admin-empty">No buyer requests are waiting for review.</p>}
          </section>
        </div>
      </div>
      {notice && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
      {dialog === "signout" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => setDialog(null)}><X size={19} /></button><div className="dialog-brand"><Gem size={19} /> MADINIMARKET</div><div className="dialog-kicker">ACCOUNT</div><h2 id="dialog-title">Sign out?</h2><p className="dialog-copy">Are you sure you want to sign out?</p><div className="signout-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="button" onClick={() => void signOut()}>Sign out</button></div></section></div>}
    </main>;
  }

  return <main className={`market-shell${role === "user" && !hasApprovedCertificate ? " seller-locked" : ""}`}>
    <div className="prototype-bar" style={{ display: 'none' }} aria-hidden="true" />
    <header className="site-header">
      <div className="header-left"><div className="menu-wrap">
        <button className="icon-button menu-trigger" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={21} /> : <Menu size={22} />}</button>
        {menuOpen && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenuOpen(false)} /><div className="menu-popover"><span className="menu-kicker">YOUR ACCOUNT</span>{user ? <><button type="button" onClick={() => openDialog("submissions")}>My submissions <ArrowUpRight size={15} /></button><button type="button" onClick={() => openDialog("signout")}>Sign out <ArrowUpRight size={15} /></button></> : <><button type="button" onClick={() => openDialog("create")}>Create account <ArrowUpRight size={15} /></button><button type="button" onClick={() => openDialog("signin")}>Sign in <ArrowUpRight size={15} /></button></>}<div className="menu-foot"><ShieldCheck size={15} /> One account. Buy or sell.</div></div></>}
      </div><a className="wordmark" href="#top" aria-label="Madinimarket home"><span className="wordmark-symbol"><Gem size={21} strokeWidth={1.8} /></span><span>madini<span className="wordmark-market">market</span></span></a></div>
      <div className="header-search"><Search size={17} /><input aria-label="Search minerals and locations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search minerals, people, places" /><kbd>/</kbd></div>
      <div className="header-actions">{user ? <><div className="user-chip" title={displayName}><span className="user-avatar">{displayName.slice(0, 2).toUpperCase()}</span><span>{displayName}</span></div><button className="text-button header-signout" type="button" onClick={() => openDialog("signout")}>Sign out</button></> : <button className="text-button header-signin" type="button" onClick={() => openDialog("signin")}>Sign in</button>}<button className="button button-dark header-list" type="button" disabled={busyActions.has("open-sell")} onClick={() => void openListing("sell")}>{busyActions.has("open-sell") ? "Opening…" : <><Plus size={16} /> List a mineral</>}</button></div>
    </header>

    {role === "user" && <details className="certificate-manager" id="certificate-manager">
      <summary className="certificate-manager-heading">
        <span className="certificate-manager-toggle"><span>SELLER VERIFICATION</span><h2 id="certificate-manager-heading">Your licences</h2></span>
        <ChevronDown className="certificate-manager-toggle-icon" size={18} />
      </summary>
      <div className="certificate-manager-content">
        <p>At least one approved licence is required to list a mineral.</p>
        <div className="certificate-options" id="certificate-options">{(["dealer", "broker"] as const).map((kind) => {
        const certificate = certificates[kind];
        const canUpload = !certificate || certificate.status === "rejected";
        const title = kind === "dealer" ? "Dealer licence" : "Broker licence";
        return <article className="certificate-option" key={kind}>
          <div className="certificate-option-heading"><h3>{title}</h3><span className={`submission-status status-${certificate?.status ?? "empty"}`}>{certificate?.status ?? "Not submitted"}</span></div>
          {certificate?.review_message && <p className="submission-message">Admin rejection reason: {certificate.review_message}</p>}
          {certificate && <a className="certificate-file-link" href={certificate.signed_url} target="_blank" rel="noreferrer">View {certificate.file_name}</a>}
          {canUpload && <><label className="field-label certificate-file-label">Upload PDF, JPEG, or PNG<input className="certificate-file-input" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file && (file.size > 10 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type))) {
              setNotice("Choose a PDF, JPEG, or PNG file no larger than 10 MB.");
              event.currentTarget.value = "";
              setCertificateFiles((current) => ({ ...current, [kind]: undefined }));
              return;
            }
            setCertificateFiles((current) => ({ ...current, [kind]: file }));
          }} /><span className="certificate-file-name">{certificateFiles[kind]?.name ?? "Choose a file"}</span></label>
          <button className="button button-dark" type="button" disabled={!certificateFiles[kind] || busyCertificate === kind} onClick={() => void submitCertificate(kind)}>{busyCertificate === kind ? "Submitting for verification…" : "Submit for verification"}</button></>}
          {certificate?.status === "pending" && <p className="certificate-status-note">Received by the admin. Submission is locked while verification is pending.</p>}
          {certificate?.status === "approved" && <p className="certificate-status-note">Verified. Your account is enabled to list minerals.</p>}
        </article>;
        })}</div>
      </div>
    </details>}

    <div className="market-content" id="top">
      <section className="market-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> TANZANIA & BEYOND <span className="eyebrow-year">EST. 2025</span></div><h1>Find your next <em>good stone.</em></h1><p className="intro-copy">A direct market for the people who know minerals best.</p></div><div className="market-status"><div className="status-orbit"><span /></div><div><strong>Market open</strong><small>Updated {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "just now"}</small></div><RefreshCw size={14} className="refresh-icon" /></div></section>

      <section className="listing-section seller-section" aria-labelledby="seller-heading"><div className="section-head"><div className="section-title-wrap"><span className="section-index">01</span><div><div className="section-kicker">AVAILABLE NOW</div><h2 id="seller-heading">On the market <span className="count-badge">{visibleSellers.length}</span></h2></div></div><div className="section-controls"><button className="button button-outline section-post" type="button" disabled={busyActions.has("open-sell")} onClick={() => void openListing("sell")}>{busyActions.has("open-sell") ? "Opening…" : <><Plus size={15} /> Sell a mineral</>}</button><button className="round-control" type="button" aria-label="Scroll seller listings left" onClick={() => scrollRail(sellerRail.current, -1)}><ArrowLeft size={17} /></button><button className="round-control" type="button" aria-label="Scroll seller listings right" onClick={() => scrollRail(sellerRail.current, 1)}><ArrowRight size={17} /></button></div></div>
        {visibleSellers.length ? <div className="seller-rail" ref={sellerRail}>{visibleSellers.map((listing, index) => <article className="seller-card" key={listing.id} style={{ animationDelay: `${index * 70}ms` }}><div className="seller-photo" style={{ backgroundImage: listing.image ? `url("${listing.image}")` : undefined, backgroundColor: listing.accent }} role="img" aria-label={`${listing.mineral} for sale`}>{!listing.image && <Gem size={38} strokeWidth={1.2} />}<span className="photo-tag"><span /> VERIFIED SELLER</span></div><div className="seller-card-info"><div className="seller-name-row"><h3>{listing.mineral}</h3><span className="weight-tag">{listing.weight} {listing.unit}</span></div><div className="seller-price">{money(listing.price, listing.currency)}</div><div className="seller-meta"><span>{listing.location}</span></div></div></article>)}</div> : <div className="empty-search">{query ? `No minerals match “${query}”.` : "No mineral listings yet."}</div>}
        <div className="rail-hint"><span>SCROLL TO EXPLORE</span><span className="rail-line" /><ArrowRight size={14} /></div>
      </section>

      <section className="listing-section buyer-section" aria-labelledby="buyer-heading"><div className="section-head"><div className="section-title-wrap"><span className="section-index buyer-index">02</span><div><div className="section-kicker">WANTED BY THE COMMUNITY</div><h2 id="buyer-heading">Buyers looking <span className="count-badge count-badge-light">{visibleBuyers.length}</span></h2></div></div><div className="section-controls"><button className="button button-lime section-post" type="button" disabled={busyActions.has("open-buy")} onClick={() => void openListing("buy")}>{busyActions.has("open-buy") ? "Opening…" : <><Plus size={15} /> Post a request</>}</button><button className="round-control round-control-light" type="button" aria-label="Scroll buyer requests left" onClick={() => scrollRail(buyerRail.current, -1)}><ArrowLeft size={17} /></button><button className="round-control round-control-light" type="button" aria-label="Scroll buyer requests right" onClick={() => scrollRail(buyerRail.current, 1)}><ArrowRight size={17} /></button></div></div>
        {visibleBuyers.length ? <div className="buyer-rail" ref={buyerRail}>{visibleBuyers.map((request, index) => <article className="buyer-card" key={request.id} style={{ animationDelay: `${index * 70}ms` }}><div className="buyer-card-top"><span className="wanted-tag"><ArrowDownRight size={14} /> WANTED</span><span className="buyer-location">{request.location}</span></div><h3>{request.mineral}<span className="buyer-shape">{request.shape}</span></h3><div className="buyer-specs"><div><span>WEIGHT</span><strong>{request.weight} {request.unit}</strong></div><div><span>COLOUR</span><strong>{request.color}</strong></div><div><span>QUALITY</span><strong>{request.quality}</strong></div></div><div className="buyer-card-bottom"><div><span>OFFER</span><strong>{money(request.offer, request.currency)}</strong></div></div></article>)}</div> : <div className="empty-search empty-search-dark">{query ? `No requests match “${query}”.` : "No buying requests yet."}</div>}
        <div className="buyer-rail-hint"><span>HAVE WHAT THEY NEED?</span><span className="rail-line" /><button type="button" disabled={busyActions.has("open-sell")} onClick={() => void openListing("sell")}>{busyActions.has("open-sell") ? "Opening…" : <>List a mineral <ArrowUpRight size={14} /></>}</button></div>
      </section>
      <footer className="site-footer"><span><Gem size={16} /> MADINIMARKET</span><span>Built for a fairer mineral trade.</span><span>PREVIEW MARKET · 2025—26</span></footer>
    </div>

    {notice && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDialog(null); setEditingSubmission(null); } }}><section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => { setDialog(null); setEditingSubmission(null); }}><X size={19} /></button><div className="dialog-brand"><Gem size={19} /> MADINIMARKET</div>
      {dialog === "signout" && <><div className="dialog-kicker">ACCOUNT</div><h2 id="dialog-title">Sign out?</h2><p className="dialog-copy">Are you sure you want to sign out?</p><div className="signout-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="button" disabled={busyActions.has("account-signout")} onClick={() => void withProgress("account-signout", signOut)}>{busyActions.has("account-signout") ? "Signing out…" : "Sign out"}</button></div></>}
      {dialog === "create" && <><div className="dialog-kicker">ONE ACCOUNT, BOTH SIDES</div><h2 id="dialog-title">Join the market.</h2><p className="dialog-copy">Create your account to buy, sell, or both.</p><form className="form-stack" onSubmit={createAccount}><div className="field-row"><Field label="First name" name="firstName" required autoComplete="given-name" /><Field label="Surname" name="surname" required autoComplete="family-name" /></div><Field label="Email address" name="email" type="email" required autoComplete="email" /><Field label="Phone number" name="phone" type="tel" required autoComplete="tel" /><Field label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" /><button className="button button-dark form-submit" type="submit" disabled={busyActions.has("account-create")}>{busyActions.has("account-create") ? "Creating account…" : <>Create account <ArrowUpRight size={16} /></>}</button></form><p className="form-footnote">We’ll email your username to the address you provide.</p><button className="switch-dialog" type="button" onClick={() => setDialog("signin")}>Already registered? <strong>Sign in</strong></button></>}
      {dialog === "signin" && <><div className="dialog-kicker">WELCOME BACK</div><h2 id="dialog-title">Good to see you.</h2><p className="dialog-copy">Sign in with your Madinimarket username.</p><form className="form-stack" onSubmit={signIn}><Field label="Username" name="username" placeholder="MM-1254" required autoComplete="username" /><Field label="Password" name="password" type="password" required autoComplete="current-password" /><button className="button button-dark form-submit" type="submit" disabled={busyActions.has("account-signin")}>{busyActions.has("account-signin") ? "Signing in…" : <>Sign in <ArrowUpRight size={16} /></>}</button></form><p className="form-footnote">{isSupabaseConfigured ? "Use your account username and password to continue." : "Supabase is not configured. This local sign-in is for interface preview only."}</p><button className="switch-dialog" type="button" onClick={() => setDialog("create")}>New to the market? <strong>Create account</strong></button></>}
      {dialog === "sell" && <>
        <div className="dialog-kicker">SELL A MINERAL</div>
        <h2 id="dialog-title">{editingSeller ? "Edit your listing." : "Submit a listing."}</h2>
        <p className="dialog-copy">An admin must approve the listing before it appears on the market.</p>
        <form className="form-stack form-scroll" onSubmit={addSeller}>
          <Field label="Mineral name" name="mineral" placeholder="e.g. Tanzanite" defaultValue={editingSeller?.mineral ?? ""} required />
          <div className="field-row field-row-weight">
            <Field label="Weight" name="weight" type="number" min="0.01" step="any" defaultValue={editingSeller?.weight ?? ""} required />
            <SelectField label="Unit" name="unit" defaultValue={editingSeller?.unit ?? ""} options={[["carats", "Carats"], ["g", "Grams"], ["kg", "Kilograms"], ["tons", "Tons"]]} />
          </div>
          <div className="field-row field-row-weight">
            <Field label="Price" name="price" type="number" min="0.01" step="any" defaultValue={editingSeller?.price ?? ""} required />
            <SelectField label="Currency" name="currency" defaultValue={editingSeller?.currency ?? ""} options={[["TZS", "TZS"], ["USD", "USD"]]} />
          </div>
          {sellerImagePreviewUrl && <figure className="seller-image-preview"><Image src={sellerImagePreviewUrl} fill sizes="180px" unoptimized alt="Selected mineral" /></figure>}
          <label className="field-label">Square mineral photo<input className="file-input" name="image" type="file" accept="image/png,image/jpeg" required={!editingSeller?.image && !editingSeller?.image_path} /><span className="file-drop"><Plus size={17} /><span>{editingSeller?.image || editingSeller?.image_path ? "Choose a replacement PNG or JPG" : "Choose PNG or JPG"}</span><small>Square crop looks best</small></span></label>
          <StoneCertificateField />
          <Field label="Seller name" name="seller" defaultValue={editingSeller?.seller ?? ""} required />
          <div className="field-row">
            <Field label="Country" name="country" defaultValue={editingSeller?.country ?? ""} required />
            <Field label="Region" name="region" defaultValue={editingSeller?.region ?? ""} required />
          </div>
          <div className="field-row">
            <Field label="District" name="district" defaultValue={editingSeller?.district ?? ""} required />
            <Field label="Street" name="street" defaultValue={editingSeller?.street ?? ""} required />
          </div>
          <div className="field-row">
            <Field label="Email address" name="email" type="email" defaultValue={editingSeller?.email ?? ""} required />
            <Field label="Phone number" name="phone" type="tel" defaultValue={editingSeller?.phone ?? ""} required />
          </div>
          <button className="button button-dark form-submit" type="submit" disabled={busyActions.has("seller-submit")}>{busyActions.has("seller-submit") ? (editingSeller ? "Resubmitting listing…" : "Submitting for approval…") : editingSeller ? "Resubmit for approval" : <>Submit for approval <ArrowUpRight size={16} /></>}</button>
          {editingSeller && <button className="button button-outline form-submit" type="button" disabled={busyActions.has("seller-submit")} onClick={() => { setEditingSubmission(null); setSellerImagePreview(null); setDialog("submissions"); }}>Cancel</button>}
        </form>
      </>}
      {dialog === "buy" && <>
        <div className="dialog-kicker">POST A BUYING REQUEST</div>
        <h2 id="dialog-title">{editingBuyer ? "Edit your request." : "Submit a request."}</h2>
        <p className="dialog-copy">An admin must approve the request before it appears on the market.</p>
        <form className="form-stack form-scroll" onSubmit={addBuyer}>
          <Field label="Mineral name" name="mineral" placeholder="e.g. Blue sapphire" defaultValue={editingBuyer?.mineral ?? ""} required />
          <div className="field-row field-row-weight">
            <Field label="Desired weight" name="weight" placeholder="e.g. 25–50" defaultValue={editingBuyer?.weight ?? ""} required />
            <SelectField label="Unit" name="unit" defaultValue={editingBuyer?.unit ?? ""} options={[["carats", "Carats"], ["g", "Grams"], ["kg", "Kilograms"], ["tons", "Tons"]]} />
          </div>
          <div className="field-row">
            <Field label="Colour" name="color" placeholder="e.g. Deep blue" defaultValue={editingBuyer?.color ?? ""} required />
            <SelectField label="Shape" name="shape" defaultValue={editingBuyer?.shape ?? ""} options={[["Cut", "Cut"], ["Uncut", "Uncut"]]} />
          </div>
          <Field label="Quality" name="quality" placeholder="e.g. Eye-clean, AAA" defaultValue={editingBuyer?.quality ?? ""} required />
          <div className="field-row field-row-weight">
            <Field label="Offer price" name="offer" type="number" min="0.01" step="any" defaultValue={editingBuyer?.offer ?? ""} required />
            <SelectField label="Currency" name="currency" defaultValue={editingBuyer?.currency ?? ""} options={[["TZS", "TZS"], ["USD", "USD"]]} />
          </div>
          <Field label="Buyer name" name="buyer" defaultValue={editingBuyer?.buyer ?? ""} required />
          <Field label="Location" name="location" placeholder="City, region" defaultValue={editingBuyer?.location ?? ""} required />
          <div className="field-row">
            <Field label="Email address" name="email" type="email" defaultValue={editingBuyer?.email ?? ""} required />
            <Field label="Phone number" name="phone" type="tel" defaultValue={editingBuyer?.phone ?? ""} required />
          </div>
          <button className="button button-dark form-submit" type="submit" disabled={busyActions.has("buyer-submit")}>{busyActions.has("buyer-submit") ? (editingBuyer ? "Updating request…" : "Submitting request…") : editingBuyer ? "Resubmit for approval" : <>Submit for approval <ArrowUpRight size={16} /></>}</button>
          {editingBuyer && <button className="button button-outline form-submit" type="button" disabled={busyActions.has("buyer-submit")} onClick={() => { setEditingSubmission(null); setDialog("submissions"); }}>Cancel</button>}
        </form>
      </>}
      {dialog === "submissions" && <><div className="dialog-kicker">YOUR ACCOUNT</div><h2 id="dialog-title">Your submissions</h2><p className="dialog-copy">Pending items are waiting for admin review. Rejected items can be edited or deleted.</p><div className="submission-list">{mySellers.map((item) => <article className="submission-item" key={`seller-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className={`submission-status status-${item.status}`}>{item.status}</span></div><p>{item.weight} {item.unit} · {money(item.price, item.currency)}</p>{item.review_message && <p className="submission-message">Admin message: {item.review_message}</p>}  <div className="submission-actions">
  <button
    type="button"
    className="button button-outline"
    onClick={() => void editSubmission("seller", item)}
    disabled={item.status === "pending" || busyActions.has(`submission-delete-seller-${item.id}`) || busyActions.has(`submission-edit-seller-${item.id}`)}
  >
    {busyActions.has(`submission-edit-seller-${item.id}`) ? "Loading submission…" : "Edit"}
  </button>
  <button
    type="button"
    className="button button-danger"
    onClick={() => void withProgress(`submission-delete-seller-${item.id}`, () => deleteSubmission("seller", item))}
    disabled={item.status === "pending" || busyActions.has(`submission-delete-seller-${item.id}`)}
  >
    {busyActions.has(`submission-delete-seller-${item.id}`) ? "Deleting…" : "Delete"}
  </button>
</div> </article>)}{myBuyers.map((item) => <article className="submission-item" key={`buyer-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className={`submission-status status-${item.status}`}>{item.status}</span></div><p>{item.weight} {item.unit} · {money(item.offer, item.currency)}</p>{item.review_message && <p className="submission-message">Admin message: {item.review_message}</p>}<div className="submission-actions">
  <button
    type="button"
    className="button button-outline"
    onClick={() => void editSubmission("buyer", item)}
    disabled={item.status === "pending" || busyActions.has(`submission-delete-buyer-${item.id}`) || busyActions.has(`submission-edit-buyer-${item.id}`)}
  >
    {busyActions.has(`submission-edit-buyer-${item.id}`) ? "Loading submission…" : "Edit"}
  </button>
  <button
    type="button"
    className="button button-danger"
    onClick={() => void withProgress(`submission-delete-buyer-${item.id}`, () => deleteSubmission("buyer", item))}
    disabled={item.status === "pending" || busyActions.has(`submission-delete-buyer-${item.id}`)}
  >
    {busyActions.has(`submission-delete-buyer-${item.id}`) ? "Deleting…" : "Delete"}
  </button>
</div> </article>)}{!mySellers.length && !myBuyers.length && <div className="empty-search">You have no pending or rejected submissions.</div>}</div></>}
      {dialog === "review" && role === "admin" && <><div className="dialog-kicker">ADMIN REVIEW</div><h2 id="dialog-title">Review queue</h2><p className="dialog-copy">Approved items appear on the market. Rejected items return to their owner with your message.</p><div className="submission-list">{pendingSellers.map((item) => <article className="submission-item review-item" key={`review-seller-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className="submission-status status-pending">Seller listing</span></div><p>{item.weight} {item.unit} · {money(item.price, item.currency)} · {item.seller}</p><p>{item.location} · {item.phone} · {item.email}</p><textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to seller (required to reject)" value={rejectionMessages[`seller-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`seller-${item.id}`, event.target.value)} /><div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("seller", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("seller", item.id, false)}>Reject</button></div></article>)}{pendingBuyers.map((item) => <article className="submission-item review-item" key={`review-buyer-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className="submission-status status-pending">Buyer request</span></div><p>{item.weight} {item.unit} · {item.color} · {item.shape} · {item.quality}</p><p>{money(item.offer, item.currency)} · {item.buyer} · {item.phone} · {item.email}</p><textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to buyer (required to reject)" value={rejectionMessages[`buyer-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`buyer-${item.id}`, event.target.value)} /><div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("buyer", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("buyer", item.id, false)}>Reject</button></div></article>)}{!pendingSellers.length && !pendingBuyers.length && <div className="empty-search">The review queue is clear.</div>}</div></>}
    </section></div>}
  </main>;
}

function Field(props: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; autoComplete?: string; min?: string; step?: string; minLength?: number; pattern?: string; defaultValue?: string }) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const { label, ...inputProps } = props;
  if (inputProps.type !== "password") {
    return <label className="field-label">{label}<input className="text-input" {...inputProps} /></label>;
  }

  return <label className="field-label">{label}<span className="password-input-wrap"><input className="text-input" {...inputProps} type={passwordVisible ? "text" : "password"} /><button className="password-visibility" type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>;
}

function StoneCertificateField() {
  const [fileName, setFileName] = useState("");
  return <label className="field-label">Stone certificate (optional)<input className="file-input" name="stoneCertificate" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? "")} /><span className="file-drop"><Plus size={17} /><span>{fileName || "Choose PDF or JPEG"}</span><small>Optional · max 10 MB</small></span></label>;
}
function SelectField({ label, name, options, defaultValue = "" }: { label: string; name: string; options: [string, string][]; defaultValue?: string }) {
  return <label className="field-label">{label}<span className="select-wrap"><select className="text-input" name={name} defaultValue={defaultValue} required><option value="" disabled>Select {label.toLowerCase()}</option>{options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><ChevronDown size={15} /></span></label>;
}
