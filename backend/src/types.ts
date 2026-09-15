export interface Chat {
  jid: string;
  name: string;
  is_group: 0 | 1;
  last_message_at: number | null;
  unread_count: number;
  profile_pic_path: string | null;
  created_at: number;
}

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "revoked"
  | "unknown";

export interface Message {
  id: string;
  chat_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  from_me: 0 | 1;
  timestamp: number;
  type: MessageType;
  text: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_size: number | null;
  media_thumb_path: string | null;
  media_duration: number | null;
  raw_json: string | null;
  indexed_at: number;
}

export type SyncStatus = "running" | "done" | "error";

export interface SyncRun {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: SyncStatus;
  messages_indexed: number;
  media_downloaded: number;
  error: string | null;
}
