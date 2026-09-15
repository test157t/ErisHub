import { memo, useEffect, useState } from "react";

type AssetInventory = {
  createdAt?: number;
  chatBackgrounds?: unknown[];
  modules?: {
    embody?: {
      voiceforge?: { audio?: unknown[]; backgrounds?: unknown[] };
    };
    intiface?: { funscripts?: unknown[]; media?: unknown[]; playModes?: unknown[]; lorebooks?: unknown[] };
    vrm?: { models?: unknown[]; animations?: unknown[]; props?: unknown[] };
  };
};

type UploadCategory = "background-image" | "background-video" | "voiceforge-bgm" | "vrm-model" | "vrm-animation" | "intiface-media" | "intiface-funscript";

const uploadCategories: { key: UploadCategory; label: string; countKey: string[]; accept: string; filter?: (asset: unknown) => boolean }[] = [
  { key: "background-image", label: "Background Image", countKey: ["chatBackgrounds"], accept: ".avif,.gif,.jpg,.jpeg,.png,.webp", filter: (a) => (a as { type?: string }).type === "image" },
  { key: "background-video", label: "Background Video", countKey: ["chatBackgrounds"], accept: ".m4v,.mov,.mp4,.webm", filter: (a) => (a as { type?: string }).type === "video" },
  { key: "voiceforge-bgm", label: "VoiceForge BGM", countKey: ["modules", "embody", "voiceforge", "backgrounds"], accept: ".mp3,.wav,.ogg,.flac,.m4a" },
  { key: "intiface-media", label: "Intiface Media", countKey: ["modules", "intiface", "media"], accept: ".mp4,.webm,.mov,.m4v,.mp3,.wav,.ogg" },
  { key: "intiface-funscript", label: "Intiface Funscript", countKey: ["modules", "intiface", "funscripts"], accept: ".funscript" },
  { key: "vrm-model", label: "VRM Model", countKey: ["modules", "vrm", "models"], accept: ".vrm" },
  { key: "vrm-animation", label: "VRM Animation", countKey: ["modules", "vrm", "animations"], accept: ".vrma,.bvh" },
];

function countAtPath(obj: unknown, path: string[], filter?: (item: unknown) => boolean): number {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== "object") return 0;
    current = (current as Record<string, unknown>)[key];
  }
  if (!Array.isArray(current)) return 0;
  return filter ? current.filter(filter).length : current.length;
}

export const AssetsPanel = memo(function AssetsPanel() {
  const [inventory, setInventory] = useState<AssetInventory | null>(null);
  const [status, setStatus] = useState("Loading assets...");
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});

  async function loadInventory(refresh = false) {
    setStatus(refresh ? "Refreshing assets..." : "Loading assets...");
    try {
      const res = await fetch(`/api/modules/assets/inventory${refresh ? "?refresh=true" : ""}`);
      if (!res.ok) throw new Error("Could not load asset inventory.");
      const data = await res.json();
      setInventory(data.inventory || null);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load asset inventory.");
    }
  }

  async function handleFilePick(category: UploadCategory, file: File) {
    setUploadStatus((prev) => ({ ...prev, [category]: "Uploading..." }));
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file."));
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/modules/assets/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, name: file.name, data: dataUrl })
      });

      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Upload failed.");
      setUploadStatus((prev) => ({ ...prev, [category]: `Uploaded ${result.name}` }));
      await loadInventory(true);
    } catch (error) {
      setUploadStatus((prev) => ({ ...prev, [category]: error instanceof Error ? error.message : "Upload failed." }));
    }
  }

  async function handleFbxPackagePick(files: FileList) {
    const selectedFiles = Array.from(files);
    const fbxFile = selectedFiles.find((file) => file.name.toLowerCase().endsWith(".fbx"));
    if (!fbxFile) {
      setUploadStatus((prev) => ({ ...prev, "vrm-fbx-package": "Folder must include an FBX file." }));
      return;
    }

    setUploadStatus((prev) => ({ ...prev, "vrm-fbx-package": "Uploading package..." }));
    try {
      const packageRoot = (fbxFile as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] || fbxFile.name.replace(/\.fbx$/i, "");
      const uploadFiles = await Promise.all(selectedFiles
        .filter((file) => /\.(fbx|png|jpe?g|tga|psd|webp)$/i.test(file.name))
        .map(async (file) => {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
            reader.readAsDataURL(file);
          });
          const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          return { path: relativePath.split("/").slice(1).join("/") || file.name, data };
        }));

      const res = await fetch("/api/modules/assets/vrm/fbx-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: packageRoot, files: uploadFiles })
      });

      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "FBX package upload failed.");
      setUploadStatus((prev) => ({ ...prev, "vrm-fbx-package": `Uploaded ${result.modelUrl}` }));
      await loadInventory(true);
    } catch (error) {
      setUploadStatus((prev) => ({ ...prev, "vrm-fbx-package": error instanceof Error ? error.message : "FBX package upload failed." }));
    }
  }

  function triggerUpload(category: UploadCategory, accept: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handleFilePick(category, file);
    };
    input.click();
  }

  function triggerFbxPackageUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.onchange = () => {
      if (input.files?.length) void handleFbxPackagePick(input.files);
    };
    input.click();
  }

  useEffect(() => { void loadInventory(false); }, []);

  return <div className="module-settings-stack">
    <div className="profile-toolbar">
      <button className="small-action-button" onClick={() => void loadInventory(true)} type="button">Refresh Index</button>
      {inventory?.createdAt ? <span className="setting-hint">Indexed {new Date(inventory.createdAt).toLocaleString()}</span> : null}
    </div>
    {status ? <p className="empty-state">{status}</p> : null}
    <div className="module-metric-grid">
      <div className="module-metric-card uploadable-card">
        <strong>FBX</strong>
        <span>VRChat FBX Package</span>
        <button className="small-action-button upload-card-button" onClick={triggerFbxPackageUpload} type="button" title="Upload VRChat FBX package folder">+</button>
        {uploadStatus["vrm-fbx-package"] ? <small className="upload-card-status">{uploadStatus["vrm-fbx-package"]}</small> : null}
      </div>
      {uploadCategories.map(({ key, label, countKey, accept, filter }) => {
        const count = countAtPath(inventory, countKey, filter);
        const msg = uploadStatus[key];
        return <div className="module-metric-card uploadable-card" key={key}>
          <strong>{count}</strong>
          <span>{label}</span>
          <button className="small-action-button upload-card-button" onClick={() => triggerUpload(key, accept)} type="button" title={`Upload ${label}`}>+</button>
          {msg ? <small className="upload-card-status">{msg}</small> : null}
        </div>;
      })}
    </div>
  </div>;
});
