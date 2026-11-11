import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const bucket = "staff-admin-attachments";
const maxFileSize = 10 * 1024 * 1024;
const maxTotalFileSize = 4 * 1024 * 1024;
const maxFilesPerMessage = 5;
const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type MessageRow = { id: string };
type ChatSender = "staff" | "admin";

export async function getStaffChatUnreadCount(
  admin: AdminClient,
  conversationId: string,
  senderType: ChatSender,
  lastReadAt: string,
) {
  const { count, error } = await admin.from("staff_admin_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_type", senderType)
    .gt("created_at", lastReadAt);
  if (error) throw error;
  return count ?? 0;
}

export async function saveStaffChatAttachments(
  admin: AdminClient,
  files: File[],
  conversationId: string,
  messageId: string,
  staffMemberId: number,
) {
  if (files.length > maxFilesPerMessage) throw new Error("Attach no more than 5 files to a message.");
  if (files.reduce((total, file) => total + file.size, 0) > maxTotalFileSize) {
    throw new Error("Attachments must total 4 MB or less per message. Choose fewer or smaller files.");
  }
  for (const file of files) {
    if (!allowedTypes[file.type] || file.size < 1 || file.size > maxFileSize) {
      throw new Error("Files must be images, PDF, TXT, DOCX, or XLSX, and no larger than 10 MB each.");
    }
  }

  const uploadedPaths: string[] = [];
  try {
    for (const file of files) {
      const path = `${conversationId}/${staffMemberId}/${randomUUID()}.${allowedTypes[file.type]}`;
      const { error } = await admin.storage.from(bucket).upload(path, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      uploadedPaths.push(path);
      const { error: rowError } = await admin.from("staff_admin_attachments").insert({
        message_id: messageId,
        file_name: file.name.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 255),
        file_path: path,
        file_type: file.type,
        file_size: file.size,
      });
      if (rowError) throw rowError;
    }
  } catch (error) {
    if (uploadedPaths.length) {
      const { error: cleanupError } = await admin.storage.from(bucket).remove(uploadedPaths);
      if (cleanupError) throw cleanupError;
    }
    throw error;
  }
}

export async function getStaffChatAttachments(admin: AdminClient, messages: MessageRow[]) {
  const messageIds = messages.map((message) => message.id);
  if (!messageIds.length) return new Map<string, { id: string; file_name: string; file_type: string; file_size: number; signed_url: string }[]>();

  const { data, error } = await admin.from("staff_admin_attachments")
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

export async function removeStaffChatMessages(admin: AdminClient, messages: MessageRow[]) {
  const messageIds = messages.map((message) => message.id);
  if (!messageIds.length) return;
  const { data: attachments, error } = await admin.from("staff_admin_attachments")
    .select("file_path")
    .in("message_id", messageIds);
  if (error) throw error;
  const paths = (attachments ?? []).map((attachment) => attachment.file_path);
  for (let index = 0; index < paths.length; index += 100) {
    const { error: storageError } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (storageError) throw storageError;
  }
  const { error: deleteError } = await admin.from("staff_admin_messages").delete().in("id", messageIds);
  if (deleteError) throw deleteError;
}

export async function deleteStaffChatConversation(admin: AdminClient, conversationId: string) {
  for (;;) {
    const { data: messages, error } = await admin.from("staff_admin_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    if (!messages?.length) break;
    await removeStaffChatMessages(admin, messages);
  }

  const { error } = await admin.from("staff_admin_conversations").delete().eq("id", conversationId);
  if (error) throw error;
}
