import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const bucket = "support-attachments";
const maxFileSize = 4 * 1024 * 1024;
const allowedTypes: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type SupportReader = "admin" | "user";
type SupportMessageRow = { id: string; support_attachments?: { file_path: string }[] | null };

export function getSupportFiles(form: FormData) {
  return form.getAll("attachments").filter((value): value is File =>
    value instanceof File && !(value.name === "" && value.size === 0),
  );
}

export function validateSupportFiles(files: File[]) {
  return files.some((file) => !allowedTypes[file.type] || file.size < 1 || file.size > maxFileSize)
    ? "Attachments must be PDF, JPEG, or PNG and no larger than 4 MB."
    : null;
}

export async function getSupportUnreadCount(admin: AdminClient, threadId: string, reader: SupportReader) {
  const senderType = reader === "admin" ? "user" : "admin";
  const seenColumn = reader === "admin" ? "seen_by_admin_at" : "seen_by_user_at";
  const { count, error } = await admin.from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("sender_type", senderType)
    .is(seenColumn, null);
  if (error) throw error;
  return count ?? 0;
}

export async function getSupportUnreadCounts(admin: AdminClient, threadIds: string[], reader: SupportReader) {
  const counts = new Map<string, number>();
  for (let index = 0; index < threadIds.length; index += 50) {
    const batch = threadIds.slice(index, index + 50);
    const results = await Promise.all(batch.map(async (threadId) =>
      [threadId, await getSupportUnreadCount(admin, threadId, reader)] as const));
    for (const [threadId, count] of results) counts.set(threadId, count);
  }
  return counts;
}

export async function markSupportMessagesSeen(
  admin: AdminClient,
  messages: { id: string; sender_type: string; seen_by_admin_at: string | null; seen_by_user_at: string | null }[],
  reader: SupportReader,
) {
  const senderType = reader === "admin" ? "user" : "admin";
  const seenColumn = reader === "admin" ? "seen_by_admin_at" : "seen_by_user_at";
  const unseenIds = messages
    .filter((message) => message.sender_type === senderType && !message[seenColumn])
    .map((message) => message.id);
  const seenAt = new Date().toISOString();
  for (let index = 0; index < unseenIds.length; index += 100) {
    const { error } = await admin.from("support_messages")
      .update({ [seenColumn]: seenAt })
      .in("id", unseenIds.slice(index, index + 100));
    if (error) throw error;
  }
  return { seenColumn, seenAt, unseenIds: new Set(unseenIds) };
}

export async function refreshSupportUnreadFlags(admin: AdminClient, threadId: string) {
  const [unreadByAdmin, unreadByUser] = await Promise.all([
    getSupportUnreadCount(admin, threadId, "admin"),
    getSupportUnreadCount(admin, threadId, "user"),
  ]);
  const { error } = await admin.from("support_threads").update({
    unread_by_admin: unreadByAdmin > 0,
    unread_by_user: unreadByUser > 0,
  }).eq("id", threadId);
  if (error) throw error;
  return { unreadByAdmin, unreadByUser };
}

export async function getSupportAttachments(admin: AdminClient, messages: { id: string }[]) {
  const messageIds = messages.map((message) => message.id);
  if (!messageIds.length) return new Map<string, { id: string; file_name: string; file_type: string; file_size: number; signed_url: string }[]>();

  const { data, error } = await admin.from("support_attachments")
    .select("id,message_id,file_name,file_path,file_type,file_size")
    .in("message_id", messageIds);
  if (error) throw error;
  const signedFiles = await Promise.all((data ?? []).map(async (attachment) => {
    const { data: signed, error: signedError } = await admin.storage.from(bucket)
      .createSignedUrl(attachment.file_path, 15 * 60, attachment.file_type.startsWith("image/")
        ? undefined
        : { download: attachment.file_name });
    if (signedError) throw signedError;
    return {
      messageId: attachment.message_id,
      attachment: {
        id: attachment.id,
        file_name: attachment.file_name,
        file_type: attachment.file_type,
        file_size: attachment.file_size,
        signed_url: signed.signedUrl,
      },
    };
  }));
  const byMessage = new Map<string, typeof signedFiles[number]["attachment"][]>();
  for (const { messageId, attachment } of signedFiles) {
    byMessage.set(messageId, [...(byMessage.get(messageId) ?? []), attachment]);
  }
  return byMessage;
}

export async function saveSupportAttachments(
  admin: AdminClient,
  files: File[],
  accountId: string,
  threadId: string,
  messageId: string,
) {
  const validationError = validateSupportFiles(files);
  if (validationError) throw new Error(validationError);

  const uploadedPaths: string[] = [];
  try {
    for (const file of files) {
      const path = `${accountId}/${threadId}/${randomUUID()}.${allowedTypes[file.type]}`;
      const { error } = await admin.storage.from(bucket).upload(path, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      uploadedPaths.push(path);
      const { error: rowError } = await admin.from("support_attachments").insert({
        message_id: messageId,
        file_name: file.name.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 255),
        file_path: path,
        file_type: file.type,
        file_size: file.size,
      });
      if (rowError) throw rowError;
    }
  } catch (error) {
    const { error: rowCleanupError } = await admin.from("support_attachments").delete().eq("message_id", messageId);
    if (rowCleanupError) throw rowCleanupError;
    for (let index = 0; index < uploadedPaths.length; index += 100) {
      const { error: storageError } = await admin.storage.from(bucket).remove(uploadedPaths.slice(index, index + 100));
      if (storageError) throw storageError;
    }
    throw error;
  }
}

export async function removeSupportMessages(admin: AdminClient, messages: SupportMessageRow[]) {
  const messageIds = messages.map((message) => message.id);
  if (!messageIds.length) return;
  const { data: attachments, error } = await admin.from("support_attachments")
    .select("file_path")
    .in("message_id", messageIds);
  if (error) throw error;
  const paths = (attachments ?? []).map((attachment) => attachment.file_path);
  for (let index = 0; index < paths.length; index += 100) {
    const { error: storageError } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (storageError) throw storageError;
  }
  const { error: deleteError } = await admin.from("support_messages").delete().in("id", messageIds);
  if (deleteError) throw deleteError;
}

export async function deleteSupportConversation(admin: AdminClient, threadId: string) {
  for (;;) {
    const { data: messages, error } = await admin.from("support_messages")
      .select("id,support_attachments(file_path)")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    if (!messages?.length) break;
    await removeSupportMessages(admin, messages as SupportMessageRow[]);
  }

  const { error } = await admin.from("support_threads").delete().eq("id", threadId);
  if (error) throw error;
}
