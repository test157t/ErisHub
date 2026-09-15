export type ProjectStatus = "enabled" | "disabled" | "done";
export type ProjectRecord = { id: string; name: string; status: ProjectStatus; directory?: string; summary?: string; decisions?: string[]; openQuestions?: string[] };

async function projectRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || "Project request failed."));
  return data as T;
}

export async function listProjectsApi() {
  const data = await projectRequest<{ items?: ProjectRecord[] }>("/api/modules/core-assistant/projects");
  return Array.isArray(data.items) ? data.items : [];
}

export async function createProjectApi(input: Partial<ProjectRecord>) {
  return (await projectRequest<{ item: ProjectRecord }>("/api/modules/core-assistant/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).item;
}

export async function updateProjectApi(id: string, patch: Partial<ProjectRecord>) {
  return (await projectRequest<{ item: ProjectRecord }>(`/api/modules/core-assistant/projects/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })).item;
}

export async function deleteProjectApi(id: string) {
  await projectRequest(`/api/modules/core-assistant/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}
