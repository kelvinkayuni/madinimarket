import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function getAdminClient(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const admin = createSupabaseAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "admin" ? admin : null;
}