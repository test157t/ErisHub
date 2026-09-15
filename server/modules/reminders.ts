import type { PromptBlock } from "../../shared/types";
import type { AppModule, ModuleContext } from "./types";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonArrayStore, writeJsonStore } from "./jsonStore";

export type ScheduledItem = {
  id: string;
  kind: "reminder" | "alarm";
  title: string;
  at: string;
  note?: string;
  createdAt: string;
  notifiedAt?: string;
};

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const remindersRoot = path.join(moduleRoot, "reminders");
const remindersPath = path.join(remindersRoot, "scheduled-items.json");

function cappedText(value: unknown, maxLength: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeScheduledDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) throw new Error("Scheduled date/time is invalid.");
  return date.toISOString();
}

function requestNow(request: ModuleContext["request"]) {
  const clientNow = new Date(String(request.clientNowIso || ""));
  return Number.isFinite(clientNow.getTime()) ? clientNow : new Date();
}

function formatUserLocalTime(date: Date, request: ModuleContext["request"]) {
  const locale = request.clientLocale || undefined;
  const timeZone = request.clientTimeZone || undefined;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "long",
      timeZone
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatScheduleList(reminders: ScheduledItem[]) {
  const upcoming = reminders
    .filter((item) => !item.notifiedAt)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, 12);

  if (upcoming.length === 0) return "No upcoming scheduled items.";
  return upcoming.map((item) => `- ${item.id}: ${item.kind || "reminder"}: ${item.title} at ${item.at}${item.note ? ` (${item.note})` : ""}`).join("\n");
}

function scheduleItemKind(value: unknown): ScheduledItem["kind"] {
  if (value === "alarm") return value;
  return "reminder";
}

export async function readStoredScheduleItems() {
  return readJsonArrayStore<ScheduledItem>(remindersPath);
}

export async function writeStoredScheduleItems(items: ScheduledItem[]) {
  await writeJsonStore(remindersPath, items);
}

export async function createScheduledItem(input: { kind?: string; title?: unknown; at?: unknown; note?: unknown }) {
  const items = await readStoredScheduleItems();
  if (items.length >= 200) throw new Error("Scheduled item limit reached.");
  const reminder: ScheduledItem = {
    id: crypto.randomUUID(),
    kind: scheduleItemKind(input.kind),
    title: cappedText(input.title, 120) || (input.kind === "alarm" ? "Alarm" : "Reminder"),
    at: sanitizeScheduledDate(input.at),
    note: cappedText(input.note, 360) || undefined,
    createdAt: new Date().toISOString()
  };
  items.push(reminder);
  await writeStoredScheduleItems(items);
  return reminder;
}

export const remindersModule: AppModule = {
  id: "reminders",
  name: "Reminders",
  description: "Local calendar/reminder context plus model-created reminders and alarms.",
  kind: "automation",
  defaultEnabled: false,
  defaultSettings: {
    allowModelCreate: true,
    alertWhenDue: true
  },
  hooks: {
    async getPromptBlocks({ request, settings }: ModuleContext): Promise<PromptBlock[]> {
      const reminders = await readStoredScheduleItems();
      const now = requestNow(request);
      const timeZone = String(request.clientTimeZone || "local");
      return [{
        id: "reminders-context",
        name: "Reminders",
        enabled: true,
        role: "system",
        position: "after-history",
        priority: 82,
        content: [
          `Current user/browser time: ${formatUserLocalTime(now, request)}.`,
          `Current instant: ${now.toISOString()}. User timezone: ${timeZone}.`,
          "Upcoming scheduled items:",
          formatScheduleList(reminders),
          "",
          settings.allowModelCreate === false
            ? "Schedule creation is disabled. You may read the scheduled item list but must not create schedules."
            : "When the user asks you to set a reminder or alarm, use the schedule tool.",
          settings.allowModelCreate === false
            ? ""
            : "Use kind=alarm for alarms or wake-up style alerts. Use kind=reminder for normal reminders. For appointments, meetings, calls, and calendar events, use calendar.create instead. For relative requests like 'in 5 hours', add the duration to the Current instant exactly. Use the user's intended local date/time and include a timezone offset or Z in at. The title must describe the thing being reminded about, not the relative timing; for a generic alarm with no subject, use title='Alarm'. Do not set titles like 'Alarm in 5 hours' or notes like 'Set five hours from now'. If the date/time is ambiguous, ask a clarifying question instead of creating it. Also explain the reminder or alarm normally in visible text."
        ].filter(Boolean).join("\n")
      }];
    }
  }
};
