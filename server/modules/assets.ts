import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readJsonStore, writeJsonStore } from "./jsonStore";

const execFileAsync = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const appDataRoot = path.join(appRoot, "data");
export const moduleAssetsRoot = path.join(appRoot, "server", "modules", "assets");
export const backgroundRoot = path.join(moduleAssetsRoot, "chat-backgrounds");
export const backgroundPreviewRoot = path.join(backgroundRoot, "previews");
export const imageGenerationRoot = path.join(appRoot, "server", "modules", "image-generation", "generated");
export const videoGenerationRoot = path.join(appRoot, "server", "modules", "image-generation", "generated-videos");
export const embodyRoot = path.join(appRoot, "server", "modules", "Embody");
export const vrmRoot = path.join(appRoot, "server", "modules", "Vrm");
export const intifaceRoot = path.join(appRoot, "server", "modules", "Intiface");

export type BackgroundAsset = { name: string; url: string; previewUrl: string; type: "image" | "video" };
export type ModuleAsset = { name: string; path: string; url: string; size: number; updatedAt: string; type: string };
type LocalAssetInventory = {
  createdAt: number;
  chatBackgrounds: BackgroundAsset[];
  modules: {
    embody: {
      voiceforge: { audio: ModuleAsset[]; backgrounds: ModuleAsset[] };
    };
    vrm: { models: ModuleAsset[]; animations: ModuleAsset[]; props: ModuleAsset[] };
    intiface: { funscripts: ModuleAsset[]; media: ModuleAsset[]; playModes: ModuleAsset[]; lorebooks: ModuleAsset[] };
  };
};

const assetManifestPath = path.join(appDataRoot, "assets-manifest.json");
const assetInventoryTtlMs = 5 * 60 * 1000;
const pendingBackgroundPreviews = new Set<string>();
const assetInventoryCache: { value: LocalAssetInventory | null; promise: Promise<LocalAssetInventory> | null; expiresAt: number } = { value: null, promise: null, expiresAt: 0 };

const backgroundTypes = new Map([
  ["images", new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"])],
  ["videos", new Set([".m4v", ".mov", ".mp4", ".webm"])]
]);

function safeJoin(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath || ".");
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid asset path.");
  return resolved;
}

function slugName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9'_]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function safePackageRelativePath(input: unknown) {
  const parts = String(input || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || /^[a-z]:$/i.test(part))) throw new Error("Invalid package file path.");
  return parts.join("/");
}

async function ensureBackgroundPreview(sourcePath: string, folder: string, entryName: string) {
  const sourceInfo = await stat(sourcePath).catch(() => null);
  if (!sourceInfo) return "";
  await mkdir(backgroundPreviewRoot, { recursive: true });
  const base = slugName(path.basename(entryName, path.extname(entryName)));
  const previewName = `${folder}-${base}-${Math.round(sourceInfo.mtimeMs)}-${sourceInfo.size}.jpg`;
  const previewPath = path.join(backgroundPreviewRoot, previewName);
  if ((await stat(previewPath).catch(() => null))?.isFile()) return `/assets/chat-backgrounds/previews/${encodeURIComponent(previewName)}`;
  const args = folder === "videos"
    ? ["-y", "-ss", "00:00:01", "-i", sourcePath, "-frames:v", "1", "-vf", "scale='min(360,iw)':-1", "-q:v", "3", previewPath]
    : ["-y", "-i", sourcePath, "-frames:v", "1", "-vf", "scale='min(360,iw)':-1", "-q:v", "3", previewPath];
  if (!pendingBackgroundPreviews.has(previewPath)) {
    pendingBackgroundPreviews.add(previewPath);
    void execFileAsync("ffmpeg", args, { windowsHide: true }).catch(() => undefined).finally(() => pendingBackgroundPreviews.delete(previewPath));
  }
  return "";
}

async function uniqueAssetPath(folderPath: string, baseName: string, ext: string) {
  const entries = new Set((await readdir(folderPath).catch(() => [])).map((entry) => entry.toLowerCase()));
  let candidate = `${baseName}${ext}`;
  let index = 2;
  while (entries.has(candidate.toLowerCase())) {
    candidate = `${baseName}-${index}${ext}`;
    index += 1;
  }
  return path.join(folderPath, candidate);
}

async function normalizeBackgroundFolder(folderPath: string, extensions: Set<string>) {
  await mkdir(folderPath, { recursive: true });
  const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!extensions.has(ext)) continue;
    const normalizedName = `${slugName(path.basename(entry.name, ext))}${ext}`;
    if (entry.name === normalizedName) continue;
    await rename(path.join(folderPath, entry.name), await uniqueAssetPath(folderPath, path.basename(normalizedName, ext), ext)).catch(() => undefined);
  }
}

function emptyAssetInventory(): LocalAssetInventory {
  return { createdAt: 0, chatBackgrounds: [], modules: emptyModuleAssets() };
}

function emptyModuleAssets(): LocalAssetInventory["modules"] {
  return {
    embody: {
      voiceforge: { audio: [], backgrounds: [] }
    },
    vrm: { models: [], animations: [], props: [] },
    intiface: { funscripts: [], media: [], playModes: [], lorebooks: [] }
  };
}

function normalizeBackgroundAssets(value: unknown): BackgroundAsset[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && typeof (item as BackgroundAsset).name === "string" && typeof (item as BackgroundAsset).url === "string") as BackgroundAsset[] : [];
}

function normalizeModuleAssets(value: unknown): ModuleAsset[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && typeof (item as ModuleAsset).name === "string" && typeof (item as ModuleAsset).url === "string") as ModuleAsset[] : [];
}

function normalizeModuleInventory(value: unknown): LocalAssetInventory["modules"] {
  const empty = emptyModuleAssets();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const modules = value as Partial<LocalAssetInventory["modules"]>;
  const embody = modules.embody || empty.embody;
  const vrm = modules.vrm || empty.vrm;
  const intiface = modules.intiface || empty.intiface;
  return {
    embody: {
      voiceforge: {
        audio: normalizeModuleAssets(embody.voiceforge?.audio),
        backgrounds: normalizeModuleAssets(embody.voiceforge?.backgrounds)
      }
    },
    vrm: {
      models: normalizeModuleAssets(vrm.models),
      animations: normalizeModuleAssets(vrm.animations),
      props: normalizeModuleAssets(vrm.props)
    },
    intiface: {
      funscripts: normalizeModuleAssets(intiface.funscripts),
      media: normalizeModuleAssets(intiface.media),
      playModes: normalizeModuleAssets(intiface.playModes),
      lorebooks: normalizeModuleAssets(intiface.lorebooks)
    }
  };
}

function normalizeAssetInventory(value: unknown): LocalAssetInventory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<LocalAssetInventory>;
  return { createdAt: Number(raw.createdAt) || 0, chatBackgrounds: normalizeBackgroundAssets(raw.chatBackgrounds), modules: normalizeModuleInventory(raw.modules) };
}

async function readAssetManifest() {
  return normalizeAssetInventory(await readJsonStore<unknown>(assetManifestPath, null));
}

async function cacheAssetInventory(inventory: LocalAssetInventory) {
  assetInventoryCache.value = inventory;
  assetInventoryCache.expiresAt = Date.now() + assetInventoryTtlMs;
  await writeJsonStore(assetManifestPath, inventory);
}

export function invalidateAssetInventory() {
  assetInventoryCache.value = null;
  assetInventoryCache.promise = null;
  assetInventoryCache.expiresAt = 0;
  void rm(assetManifestPath, { force: true }).catch(() => undefined);
}

export async function listBackgroundAssets(): Promise<BackgroundAsset[]> {
  const assets: BackgroundAsset[] = [];
  for (const [folder, extensions] of backgroundTypes) {
    const folderPath = path.join(backgroundRoot, folder);
    await normalizeBackgroundFolder(folderPath, extensions);
    const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;
      const sourcePath = path.join(folderPath, entry.name);
      const url = `/assets/chat-backgrounds/${folder}/${encodeURIComponent(entry.name)}`;
      void (folder === "videos" ? ensureBackgroundPreview(sourcePath, folder, entry.name) : Promise.resolve(url)).catch(() => undefined);
      assets.push({ name: entry.name, type: folder === "images" ? "image" : "video", url, previewUrl: folder === "images" ? url : "" });
    }
  }
  return assets.sort((a, b) => a.name.localeCompare(b.name));
}

async function listModuleFiles(root: string, urlRoot: string, accept: (relativePath: string, extension: string) => string | null) {
  const files: ModuleAsset[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const type = accept(relative, extension);
      if (!type) continue;
      const info = await stat(absolute).catch(() => null);
      if (!info) continue;
      files.push({ name: entry.name, path: relative, url: `${urlRoot}/${relative.split("/").map(encodeURIComponent).join("/")}`, size: info.size, updatedAt: info.mtime.toISOString(), type });
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function categorizeEmbodyAsset(relativePath: string, extension: string) {
  const pathValue = relativePath.toLowerCase();
  if (pathValue.startsWith("voiceforge/bgm/") && [".mp3", ".wav", ".ogg", ".flac", ".m4a"].includes(extension)) return "voiceforge-background";
  if (pathValue.startsWith("voiceforge/") && [".mp3", ".wav", ".ogg", ".flac", ".m4a"].includes(extension)) return "voiceforge-audio";
  if (pathValue.startsWith("voiceforge/") && [".json"].includes(extension)) return "voiceforge-background";
  return null;
}

async function listEmbodyAssets(): Promise<LocalAssetInventory["modules"]["embody"]> {
  const files = await listModuleFiles(moduleAssetsRoot, "/assets", categorizeEmbodyAsset);
  return {
    voiceforge: {
      audio: files.filter((file) => file.type === "voiceforge-audio"),
      backgrounds: files.filter((file) => file.type === "voiceforge-background")
    }
  };
}

function categorizeIntifaceAsset(relativePath: string, extension: string) {
  const pathValue = relativePath.toLowerCase();
  if (pathValue.startsWith("intiface/") && extension === ".funscript") return "intiface-funscript";
  if (pathValue.startsWith("intiface/") && [".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".ogg"].includes(extension)) return "intiface-media";
  if (pathValue.startsWith("intiface/playmodes/") && [".json", ".js"].includes(extension)) return "intiface-play-mode";
  if (pathValue.startsWith("intiface/play_modes/") && [".json", ".js"].includes(extension)) return "intiface-play-mode";
  if (pathValue.startsWith("intiface/lorebooks/") && extension === ".json") return "intiface-lorebook";
  return null;
}

async function listIntifaceAssets(): Promise<LocalAssetInventory["modules"]["intiface"]> {
  const files = await listModuleFiles(moduleAssetsRoot, "/assets", categorizeIntifaceAsset);
  return {
    funscripts: files.filter((file) => file.type === "intiface-funscript"),
    media: files.filter((file) => file.type === "intiface-media"),
    playModes: files.filter((file) => file.type === "intiface-play-mode"),
    lorebooks: files.filter((file) => file.type === "intiface-lorebook")
  };
}

function categorizeVrmAsset(relativePath: string, extension: string) {
  const pathValue = relativePath.toLowerCase();
  if (pathValue.startsWith("vrm/models/") && [".vrm", ".fbx"].includes(extension)) return "vrm-model";
  if (pathValue.startsWith("vrm/") && [".vrma", ".bvh"].includes(extension)) return "vrm-animation";
  if (pathValue.startsWith("vrm/") && [".fbx", ".glb", ".gltf"].includes(extension)) return "vrm-prop";
  return null;
}

async function listVrmAssets(): Promise<LocalAssetInventory["modules"]["vrm"]> {
  const files = await listModuleFiles(moduleAssetsRoot, "/assets", categorizeVrmAsset);
  return {
    models: files.filter((file) => file.type === "vrm-model"),
    animations: files.filter((file) => file.type === "vrm-animation"),
    props: files.filter((file) => file.type === "vrm-prop")
  };
}

export async function getAssetsFolderListing(folderInput: unknown) {
  const folder = String(folderInput || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (folder === "vrm") {
    const vrm = await listVrmAssets();
    return {
      vrm: {
        model: vrm.models.map((asset) => asset.url),
        animation: vrm.animations.map((asset) => asset.url),
        object: vrm.props.map((asset) => asset.url)
      }
    };
  }
  const root = safeJoin(moduleAssetsRoot, folder);
  const files = await listModuleFiles(root, `/assets/${folder}`, () => "file");
  return files.map((asset) => asset.url);
}

function backgroundFileFromUrl(rawUrl: unknown) {
  const value = String(rawUrl || "").trim();
  const match = value.match(/^\/assets\/chat-backgrounds\/(images|videos)\/(.+)$/);
  if (!match) throw new Error("Invalid background asset URL.");
  const folder = match[1];
  const fileName = decodeURIComponent(match[2]);
  if (fileName.includes("/") || fileName.includes("\\")) throw new Error("Invalid background asset name.");
  const extension = path.extname(fileName).toLowerCase();
  const extensions = backgroundTypes.get(folder);
  if (!extensions?.has(extension)) throw new Error("Unsupported background asset type.");
  const folderPath = path.join(backgroundRoot, folder);
  return { fileName, extension, folderPath, filePath: safeJoin(folderPath, fileName) };
}

export async function deleteBackgroundAsset(url: unknown) {
  const asset = backgroundFileFromUrl(url);
  await rm(asset.filePath, { force: false });
  invalidateAssetInventory();
}

export async function renameBackgroundAsset(url: unknown, name: unknown) {
  const asset = backgroundFileFromUrl(url);
  const requestedName = String(name || "").trim();
  if (!requestedName) throw new Error("New background name is required.");
  const requestedExtension = path.extname(requestedName).toLowerCase();
  if (requestedExtension && requestedExtension !== asset.extension) throw new Error("Background file type cannot be changed by renaming.");
  const nextName = `${slugName(path.basename(requestedName, requestedExtension || asset.extension))}${asset.extension}`;
  const nextPath = safeJoin(asset.folderPath, nextName);
  if (nextName === asset.fileName) throw new Error("Background already has that name.");
  if (await stat(nextPath).catch(() => null)) throw new Error("A background with that name already exists.");
  await rename(asset.filePath, nextPath);
  invalidateAssetInventory();
  return nextName;
}

async function buildLocalAssetInventory(): Promise<LocalAssetInventory> {
  return { createdAt: Date.now(), chatBackgrounds: await listBackgroundAssets(), modules: { embody: await listEmbodyAssets(), vrm: await listVrmAssets(), intiface: await listIntifaceAssets() } };
}

async function readCachedAssetInventory() {
  if (assetInventoryCache.value) return assetInventoryCache.value;
  const persisted = await readAssetManifest().catch(() => null);
  if (!persisted) return null;
  assetInventoryCache.value = persisted;
  assetInventoryCache.expiresAt = persisted.createdAt + assetInventoryTtlMs;
  return persisted;
}

function refreshAssetInventoryInBackground() {
  if (assetInventoryCache.promise) return;
  assetInventoryCache.promise = buildLocalAssetInventory().then(async (inventory) => { await cacheAssetInventory(inventory); return inventory; }).finally(() => { assetInventoryCache.promise = null; });
  void assetInventoryCache.promise.catch(() => undefined);
}

export async function getLocalAssetInventory(refresh = false) {
  const now = Date.now();
  if (!refresh && assetInventoryCache.value && assetInventoryCache.expiresAt > now) return assetInventoryCache.value;
  if (assetInventoryCache.promise) return assetInventoryCache.promise;
  if (!refresh) {
    const persisted = await readCachedAssetInventory();
    if (persisted) {
      if (assetInventoryCache.expiresAt <= now) refreshAssetInventoryInBackground();
      return persisted;
    }
  }
  assetInventoryCache.promise = buildLocalAssetInventory().then(async (inventory) => { await cacheAssetInventory(inventory); return inventory; }).finally(() => { assetInventoryCache.promise = null; });
  return assetInventoryCache.promise;
}

export type AssetUploadCategory = "background-image" | "background-video" | "voiceforge-bgm" | "vrm-model" | "vrm-animation" | "intiface-media" | "intiface-funscript";

export const uploadCategoryConfig: Record<AssetUploadCategory, { path: string; extensions: Set<string>; displayName: string; accept: string }> = {
  "background-image": { path: path.join(moduleAssetsRoot, "chat-backgrounds", "images"), extensions: new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"]), displayName: "Background Image", accept: ".avif,.gif,.jpg,.jpeg,.png,.webp" },
  "background-video": { path: path.join(moduleAssetsRoot, "chat-backgrounds", "videos"), extensions: new Set([".m4v", ".mov", ".mp4", ".webm"]), displayName: "Background Video", accept: ".m4v,.mov,.mp4,.webm" },
  "voiceforge-bgm": { path: path.join(moduleAssetsRoot, "voiceforge", "bgm"), extensions: new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a"]), displayName: "VoiceForge BGM", accept: ".mp3,.wav,.ogg,.flac,.m4a" },
  "vrm-model": { path: path.join(moduleAssetsRoot, "vrm", "models"), extensions: new Set([".vrm", ".fbx"]), displayName: "VRM / FBX Model", accept: ".vrm,.fbx" },
  "vrm-animation": { path: path.join(moduleAssetsRoot, "vrm", "animations"), extensions: new Set([".vrma", ".bvh"]), displayName: "VRM Animation", accept: ".vrma,.bvh" },
  "intiface-media": { path: path.join(moduleAssetsRoot, "intiface", "media"), extensions: new Set([".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".ogg"]), displayName: "Intiface Media", accept: ".mp4,.webm,.mov,.m4v,.mp3,.wav,.ogg" },
  "intiface-funscript": { path: path.join(moduleAssetsRoot, "intiface", "funscripts"), extensions: new Set([".funscript"]), displayName: "Intiface Funscript", accept: ".funscript" }
};

export async function uploadAsset(category: string, fileName: string, fileData: Buffer) {
  const cat = uploadCategoryConfig[category as AssetUploadCategory];
  if (!cat) throw new Error(`Unknown upload category: ${category}`);

  let ext = path.extname(fileName).toLowerCase();
  if (!ext || !cat.extensions.has(ext)) {
    const exts = [...cat.extensions].join(", ");
    const msg = ext ? `Unsupported file type "${ext}" for ${cat.displayName}. Supported: ${exts}` : `File must have a supported extension: ${exts}`;
    throw new Error(msg);
  }

  const baseName = slugName(path.basename(fileName, ext));
  if (!baseName) throw new Error("Invalid file name.");

  await mkdir(cat.path, { recursive: true });
  const destPath = await uniqueAssetPath(cat.path, baseName, ext);

  await writeFile(destPath, fileData);
  invalidateAssetInventory();

  return { name: path.basename(destPath), path: destPath };
}

export async function uploadFbxPackage(packageName: string, files: Array<{ data: string; path: string }>) {
  const safePackageName = slugName(packageName || "fbx-package");
  const root = path.join(moduleAssetsRoot, "vrm", "models", safePackageName);
  const allowedExtensions = new Set([".fbx", ".png", ".jpg", ".jpeg", ".tga", ".psd", ".webp"]);
  let modelUrl = "";

  if (!Array.isArray(files) || files.length === 0) throw new Error("FBX package must include files.");
  await mkdir(root, { recursive: true });

  for (const file of files) {
    const relativePath = safePackageRelativePath(file.path);
    const ext = path.extname(relativePath).toLowerCase();
    if (!relativePath || !allowedExtensions.has(ext)) continue;
    const targetPath = safeJoin(root, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, Buffer.from(String(file.data || "").replace(/^data:[^;]+;base64,/, ""), "base64"));
    if (ext === ".fbx" && !modelUrl) modelUrl = `/assets/vrm/models/${encodeURIComponent(safePackageName)}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  }

  if (!modelUrl) throw new Error("FBX package must include a .fbx file.");
  invalidateAssetInventory();
  return { name: safePackageName, modelUrl };
}

export async function getBackgroundAssets(refresh = false) {
  if (!refresh) {
    const inventory = await readCachedAssetInventory();
    if (inventory && (inventory.chatBackgrounds.length || inventory.createdAt)) return inventory.chatBackgrounds;
  }
  const chatBackgrounds = await listBackgroundAssets();
  const inventory = assetInventoryCache.value ?? await readAssetManifest().catch(() => null) ?? emptyAssetInventory();
  await cacheAssetInventory({ ...inventory, createdAt: Date.now(), chatBackgrounds });
  return chatBackgrounds;
}
