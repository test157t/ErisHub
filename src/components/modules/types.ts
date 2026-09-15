import type { SetStateAction } from "react";

export type ModuleManifest = {
  id: string;
  name: string;
  description: string;
  kind: string;
  defaultEnabled: boolean;
  defaultSettings: Record<string, unknown>;
};

export type BackgroundAsset = {
  name: string;
  url: string;
  previewUrl?: string;
  type: "image" | "video";
};

export type BackgroundAutopickContext = {
  agentNames: string[];
};

export type ModuleSettings = Record<string, unknown>;

export type ModuleSettingChange = (key: string, value: unknown) => void;

export type SimpleModuleDraft = {
  memory: string;
  task: string;
  noteTitle: string;
  noteContent: string;
  calc: string;
  calcResult: string;
  fileName: string;
  fileContent: string;
  summary: string;
};

export type SetSimpleModuleDraft = (value: SetStateAction<SimpleModuleDraft>) => void;

export type NotificationItem = { id: string; kind: string; title: string; message: string; source: string; createdAt: string; readAt?: string };

export type ModuleEventItem = { id: string; createdAt: string; source: string; action: string; status: string; input?: unknown; output?: unknown; error?: string };

export type NoteItem = { id: string; type: "note"; title: string; content: string; createdAt: string; updatedAt: string };

export type MemoryItem = { id: string; scope: "user" | "agent" | "global"; text: string; tags: string; createdAt: string; updatedAt: string };

export type SessionSummaryItem = { id: string; title: string; summary: string; updatedAt: string };

export type LibraryDocumentItem = { id: string; name: string; size: number; createdAt: string; hash?: string };

export type LibraryDocumentPreview = LibraryDocumentItem & { content: string };

export type ReminderDraft = { kind: "reminder" | "alarm"; title: string; at: string; note: string };

export type ReminderItem = { id: string; kind: "reminder" | "alarm"; title: string; at: string; note?: string; createdAt: string; notifiedAt?: string };

export type TaskItem = { id: string; title: string; status: "todo" | "doing" | "done" | "blocked"; note?: string; createdAt: string; updatedAt: string };
