import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "madinimarket_website_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function signingKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Website account sessions are not configured.");
  return key;
}

export async function hashWebsitePassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyWebsitePassword(password: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex || !/^[a-f\d]{128}$/i.test(expectedHex)) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return timingSafeEqual(actual, expected);
}

export function setWebsiteSession(response: NextResponse, accountId: string) {
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const payload = Buffer.from(`${accountId}:${expiresAt}`).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  response.cookies.set(COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function getWebsiteAccountId() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", signingKey()).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(":");
  const accountId = decoded.slice(0, separator);
  const expiresAt = Number(decoded.slice(separator + 1));
  if (separator < 1 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return accountId;
}

export function clearWebsiteSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
