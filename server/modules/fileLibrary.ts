import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PromptBlock } from "../../shared/types";
import type { AppModule, ModuleContext } from "./types";
import { readJsonArrayStore, writeJsonStore } from "./jsonStore";

export type LibraryDoc = { id: string; name: string; path: string; hash: string; size: number; createdAt: string };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "file-library", "documents");
const metaFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "file-library", "documents.json");
const textExts = new Set([".txt", ".md", ".json", ".csv", ".log"]);
const documentCache = new Map<string, { content: string; lowerContent: string }>();
let metaCache: LibraryDoc[] | null = null;

async function meta(): Promise<LibraryDoc[]> {
  if (metaCache) return metaCache;
  metaCache = await readJsonArrayStore<LibraryDoc>(metaFile);
  return metaCache;
}

async function saveMeta(items: LibraryDoc[]) {
  metaCache = items;
  await writeJsonStore(metaFile, items);
}

function safeName(name: string) {
  return path.basename(name).replace(/[^a-zA-Z0-9._ -]+/g, "_").slice(0, 120) || "document.txt";
}

async function cachedDocumentContent(doc: LibraryDoc) {
  const cached = documentCache.get(doc.path);
  if (cached) return cached;
  const content = await readFile(path.join(root, doc.path), "utf8").catch(() => "");
  const next = { content, lowerContent: content.toLowerCase() };
  documentCache.set(doc.path, next);
  return next;
}

export async function listDocuments() {
  return meta();
}

export async function addDocument(input: { name: string; content: string }) {
  const content = String(input.content || "").slice(0, 2_000_000);
  if (!content.trim()) throw new Error("Document content is required.");
  const hash = createHash("sha256").update(content).digest("hex");
  const items = await meta();
  const existing = items.find((item) => item.hash === hash);
  if (existing) return existing;

  await mkdir(root, { recursive: true });
  const name = safeName(input.name || "document.txt");
  const id = crypto.randomUUID();
  const filename = `${id}-${name}`;
  await writeFile(path.join(root, filename), content, "utf8");
  documentCache.set(filename, { content, lowerContent: content.toLowerCase() });

  const doc: LibraryDoc = { id, name, path: filename, hash, size: Buffer.byteLength(content), createdAt: new Date().toISOString() };
  const nextItems = [doc, ...items];
  await saveMeta(nextItems);
  return doc;
}

export async function getDocument(id: string) {
  const items = await meta();
  const doc = items.find((item) => item.id === id);
  if (!doc) return null;
  const { content } = await cachedDocumentContent(doc);
  return { ...doc, content };
}

export async function deleteDocument(id: string) {
  const items = await meta();
  const found = items.find((item) => item.id === id);
  if (found) {
    documentCache.delete(found.path);
    await rm(path.join(root, found.path), { force: true });
  }
  await saveMeta(items.filter((item) => item.id !== id));
}

export async function searchDocuments(query = "") {
  const q = query.toLowerCase().trim();
  const docs = await meta();
  const results: Array<LibraryDoc & { excerpt: string }> = [];

  for (const doc of docs) {
    if (!textExts.has(path.extname(doc.name).toLowerCase())) continue;
    const { content, lowerContent } = await cachedDocumentContent(doc);
    const index = q ? lowerContent.indexOf(q) : 0;
    if (index < 0) continue;
    results.push({ ...doc, excerpt: content.slice(Math.max(0, index - 240), index + 760) });
    if (results.length >= 8) break;
  }

  return results;
}

export async function importExistingDocuments() {
  await mkdir(root, { recursive: true });
  const existing = await meta();
  const hashes = new Set(existing.map((item) => item.hash));
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const added: LibraryDoc[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.includes("-")) continue;
    const filePath = path.join(root, entry.name);
    const content = await readFile(filePath, "utf8").catch(() => "");
    const hash = createHash("sha256").update(content).digest("hex");
    if (hashes.has(hash)) continue;

    const id = crypto.randomUUID();
    const newName = `${id}-${safeName(entry.name)}`;
    await writeFile(path.join(root, newName), content, "utf8");
    await rm(filePath, { force: true });
    documentCache.set(newName, { content, lowerContent: content.toLowerCase() });

    const doc: LibraryDoc = { id, name: entry.name, path: newName, hash, size: Buffer.byteLength(content), createdAt: new Date().toISOString() };
    added.push(doc);
    hashes.add(hash);
  }

  if (added.length) await saveMeta([...added, ...existing]);
  return added;
}

export const fileLibraryModule: AppModule = {
  id: "file-library",
  name: "File Library",
  description: "Local document library with browser uploads, dedupe, and context excerpts.",
  kind: "context",
  defaultEnabled: false,
  defaultSettings: { query: "", maxExcerpts: 4 },
  hooks: {
    async getPromptBlocks({ settings }: ModuleContext): Promise<PromptBlock[]> {
      const results = (await searchDocuments(String(settings.query || ""))).slice(0, Math.max(1, Math.min(8, Number(settings.maxExcerpts) || 4)));
      if (!results.length) return [];
      return [{
        id: "file-library-context",
        name: "File Library",
        enabled: true,
        role: "system",
        position: "after-history",
        priority: 74,
        content: `Document excerpts:\n\n${results.map((doc) => `### ${doc.name}\n${doc.excerpt}`).join("\n\n")}`
      }];
    }
  }
};
