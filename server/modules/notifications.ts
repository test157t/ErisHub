import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptBlock } from "../../shared/types";
import type { AppModule, ModuleContext } from "./types";
import { readJsonArrayStore, writeJsonStore } from "./jsonStore";

export type NotificationItem = {
  id: string;
  kind: "info" | "success" | "warning" | "error" | "reminder" | "alarm" | "task";
  title: string;
  message: string;
  source: string;
  createdAt: string;
  readAt?: string;
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "notifications");
const file = path.join(root, "notifications.json");

export async function listNotifications() {
  return readJsonArrayStore<NotificationItem>(file);
}

async function saveNotifications(items: NotificationItem[]) {
  await writeJsonStore(file, items.slice(0, 300));
}

export async function createNotification(input: Partial<NotificationItem>) {
  const item: NotificationItem = {
    id: crypto.randomUUID(),
    kind: input.kind === "success" || input.kind === "warning" || input.kind === "error" || input.kind === "reminder" || input.kind === "alarm" || input.kind === "task" ? input.kind : "info",
    title: String(input.title || "Notification").trim().slice(0, 140) || "Notification",
    message: String(input.message || "").trim().slice(0, 1200),
    source: String(input.source || "system").trim().slice(0, 80) || "system",
    createdAt: new Date().toISOString()
  };
  const items = [item, ...(await listNotifications())];
  await saveNotifications(items);
  return item;
}

export async function markNotificationRead(id: string) {
  const items = await listNotifications();
  const now = new Date().toISOString();
  await saveNotifications(items.map((item) => item.id === id ? { ...item, readAt: now } : item));
}

export async function markAllNotificationsRead() {
  const now = new Date().toISOString();
  await saveNotifications((await listNotifications()).map((item) => item.readAt ? item : { ...item, readAt: now }));
}

export async function deleteNotification(id: string) {
  await saveNotifications((await listNotifications()).filter((item) => item.id !== id));
}

export async function clearNotifications() {
  await saveNotifications([]);
}

export const notificationsModule: AppModule = {
  id: "notifications",
  name: "Notifications",
  description: "Central notification feed for reminders, alarms, tasks, and app events.",
  kind: "automation",
  defaultEnabled: false,
  defaultSettings: {
    browserNotifications: false,
    includeUnreadInPrompt: true
  },
  hooks: {
    async getPromptBlocks({ settings }: ModuleContext): Promise<PromptBlock[]> {
      if (settings.includeUnreadInPrompt === false) return [];
      const unread = (await listNotifications()).filter((item) => !item.readAt).slice(0, 12);
      if (!unread.length) return [];
      return [{
        id: "notifications-context",
        name: "Notifications",
        enabled: true,
        role: "system",
        position: "after-history",
        priority: 79,
        content: `Unread notifications:\n${unread.map((item) => `- [${item.kind}] ${item.title}: ${item.message}`).join("\n")}`
      }];
    }
  }
};
