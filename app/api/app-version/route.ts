import { NextResponse } from "next/server";

export async function GET() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION
    ?? process.env.VERCEL_DEPLOYMENT_ID
    ?? process.env.NEXT_DEPLOYMENT_ID
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? "development";

  return NextResponse.json({ version }, {
    headers: { "Cache-Control": "no-store" },
  });
}
