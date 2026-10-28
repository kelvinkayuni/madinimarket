const canonicalAppUrl = new URL("https://www.madinimarket.co.tz");

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){1,3}$/.test(normalized);
}

export function getPublicAppUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configuredUrl) return canonicalAppUrl;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    console.warn("NEXT_PUBLIC_APP_URL is invalid; using the canonical Madinimarket URL.");
    return canonicalAppUrl;
  }

  if (parsedUrl.protocol !== "https:" || isLoopbackHostname(parsedUrl.hostname)) {
    console.warn("NEXT_PUBLIC_APP_URL must be a public HTTPS URL; using the canonical Madinimarket URL.");
    return canonicalAppUrl;
  }

  return new URL(parsedUrl.origin);
}
