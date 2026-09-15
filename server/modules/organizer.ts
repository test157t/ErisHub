import type { PromptBlock } from "../../shared/types";
import { listCalendar } from "./coreAssistant";
import { moduleTool, type AppModule, type ModuleContext } from "./types";
import { notificationsModule } from "./notifications";
import { remindersModule } from "./reminders";
import { schedulerModule } from "./scheduler";
import { tasksModule } from "./tasks";

function listBlock(title: string, items: string[]) { return `${title}:\n${items.length ? items.join("\n") : "None."}`; }

export const organizerModule: AppModule = {
  id: "organizer",
  name: "Organizer",
  description: "Tasks, reminders, calendar events, notifications, and due-item automation.",
  kind: "automation",
  defaultEnabled: false,
  defaultSettings: {
    allowModelCreate: true,
    includeProgress: true,
    browserNotifications: false,
    enabledJobs: ["scheduled-items"],
    pollSeconds: 30
  },
  tools: [moduleTool("task.create", "Create a persistent task.", ["title"]), moduleTool("task.update", "Update a persistent task.", ["id"]), moduleTool("task.execute", "Execute a persistent task workflow.", ["id"]), moduleTool("schedule.create", "Create a reminder or alarm.", ["title", "at"]), moduleTool("notification.create", "Create a user notification.", ["title"]), moduleTool("calendar.create", "Create a calendar event.", ["title", "startsAt"]), moduleTool("calendar.update", "Update or cancel a calendar event.", ["id"])],
  hooks: {
    async getPromptBlocks(context: ModuleContext): Promise<PromptBlock[]> {
      const settings = context.settings;
      const taskBlocks = await tasksModule.hooks!.getPromptBlocks!({
        ...context,
        settings: { allowModelCreate: settings.allowModelCreate, includeDone: settings.includeProgress }
      });
      const reminderBlocks = await remindersModule.hooks!.getPromptBlocks!({
        ...context,
        settings: { allowModelCreate: settings.allowModelCreate, alertWhenDue: settings.includeProgress }
      });
      const notificationBlocks = await notificationsModule.hooks!.getPromptBlocks!({
        ...context,
        settings: { browserNotifications: settings.browserNotifications, includeUnreadInPrompt: settings.includeProgress }
      });
      const schedulerBlocks = await schedulerModule.hooks!.getPromptBlocks!({
        ...context,
        settings: { enabledJobs: settings.enabledJobs, pollSeconds: settings.pollSeconds }
      });
      const events = (await listCalendar())
        .filter((item) => item.status !== "cancelled")
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .slice(0, 20);
      const calendarBlock: PromptBlock = {
        id: "calendar-context",
        name: "Calendar",
        enabled: true,
        role: "system",
        position: "after-history",
        priority: 83,
        content: [
          listBlock("Calendar events", events.map((item) => `- ${item.id}: ${item.title} starts ${item.startsAt}${item.endsAt ? ` ends ${item.endsAt}` : ""}${item.location ? ` @ ${item.location}` : ""}${item.note ? ` (${item.note})` : ""}`)),
          settings.allowModelCreate === false ? "" : "Use calendar tools for appointments, meetings, calls, and events. Use the schedule tool only for reminders and alarms."
        ].filter(Boolean).join("\n")
      };
      return [...taskBlocks, ...reminderBlocks, calendarBlock, ...notificationBlocks, ...schedulerBlocks];
    }
  }
};
