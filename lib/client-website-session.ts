"use client";

const SESSION_STORAGE_KEY = "madinimarket:website-session:v1";
const SUPABASE_STORAGE_KEY = "madinimarket:supabase-storage-key:v1";
const TAB_ID_STORAGE_KEY = "madinimarket:tab-id:v1";
const WINDOW_NAME_PREFIX = "__madinimarket_tab_v1__:";

function ensureTabIdentity() {
  let tabId = window.sessionStorage.getItem(TAB_ID_STORAGE_KEY);
  const namedTabId = window.name.startsWith(WINDOW_NAME_PREFIX)
    ? window.name.slice(WINDOW_NAME_PREFIX.length)
    : null;

  if (tabId && namedTabId !== tabId) {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    const oldSupabaseStorageKey = `madinimarket-auth-${tabId}`;
    window.sessionStorage.removeItem(oldSupabaseStorageKey);
    window.sessionStorage.removeItem(SUPABASE_STORAGE_KEY);
    tabId = null;
  }

  if (!tabId) {
    tabId = crypto.randomUUID();
    window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, tabId);
    window.name = `${WINDOW_NAME_PREFIX}${tabId}`;
  }
  return tabId;
}

export function getWebsiteSessionToken() {
  if (typeof window === "undefined") return null;
  ensureTabIdentity();
  return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
}

export function setWebsiteSessionToken(token: string) {
  ensureTabIdentity();
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
}

export function clearWebsiteSessionToken() {
  ensureTabIdentity();
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getSupabaseTabStorageKey() {
  const tabId = ensureTabIdentity();
  let tabKey = window.sessionStorage.getItem(SUPABASE_STORAGE_KEY);
  if (!tabKey) {
    tabKey = tabId;
    window.sessionStorage.setItem(SUPABASE_STORAGE_KEY, tabKey);
  }
  return `madinimarket-auth-${tabKey}`;
}

export function fetchWithWebsiteSession(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const token = getWebsiteSessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
