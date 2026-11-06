import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const [sellersResult, buyersResult] = await Promise.all([
      admin.from("listings").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      admin.from("buy_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    ]);
    if (sellersResult.error || buyersResult.error) throw new Error("Could not load pending submissions.");

    const sellers = await Promise.all((sellersResult.data ?? []).map(async (row) => {
      const [image, certificate, gallery] = await Promise.all([
        row.image_path ? admin.storage.from("mineral-images").createSignedUrl(row.image_path, 3600) : null,
        row.stone_certificate_path ? admin.storage.from("stone-certificates").createSignedUrl(row.stone_certificate_path, 3600) : null,
        Array.isArray(row.image_gallery_paths)
          ? Promise.all(row.image_gallery_paths.map((path: string) => admin.storage.from("mineral-images").createSignedUrl(path, 3600)))
          : Promise.resolve([]),
      ]);
      const galleryError = gallery.find((result) => result.error)?.error;
      if (galleryError) throw galleryError;
      return {
        ...row,
        signed_image_url: image?.data?.signedUrl ?? "",
        signed_stone_certificate_url: certificate?.data?.signedUrl ?? "",
        signed_image_gallery_urls: gallery.map((result) => result.data?.signedUrl ?? ""),
      };
    }));
    return NextResponse.json({ sellers, buyers: buyersResult.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load pending submissions." }, { status: 503 });
  }
}