import { memo, useEffect, useState } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings } from "./types";
import { deleteProjectApi, listProjectsApi, type ProjectRecord } from "../../lib/projectsApi";

type ProjectsPanelProps = {
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  settings: ModuleSettings;
};

export const ProjectsPanel = memo(function ProjectsPanel({ onError, onSettingChange, settings }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [query, setQuery] = useState("");

  const refreshProjects = () => {
    listProjectsApi()
      .then(setProjects)
      .catch((error) => onError(error instanceof Error ? error.message : "Could not load projects."));
  };

  const deleteProject = (project: { id: string; name: string }) => {
    if (!window.confirm(`Delete project "${project.name}"?`)) return;
    deleteProjectApi(project.id)
      .then(refreshProjects)
      .catch((error) => onError(error instanceof Error ? error.message : "Could not delete project."));
  };

  useEffect(refreshProjects, []);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = projects
    .filter((item) => !normalizedQuery || [item.name, item.status, item.summary].some((value) => value?.toLowerCase().includes(normalizedQuery)))
    .sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));

  return <ModuleInfoPanel className="basic-module-panel" description="Project goals, editor workspace context, decisions, open questions, and status." title="Projects">
    <ToggleSetting checked={settings.allowModelCreate !== false} onChange={(checked) => onSettingChange("allowModelCreate", checked)}>Allow model-created project actions</ToggleSetting>
    <div className="module-toolbar contacts-toolbar"><label className="module-search-field">Search projects<input placeholder="Name, status, or summary" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" onClick={refreshProjects}>Refresh</button></div>
    <div className="module-list-summary">Showing {visibleProjects.length} of {projects.length} projects</div>
    <div className="project-card-grid">{projects.length === 0 ? <span className="empty-module-state">No projects yet.</span> : visibleProjects.length === 0 ? <span className="empty-module-state">No projects match the current filters.</span> : visibleProjects.map((item) => <article className={`project-card status-${item.status}`} key={item.id}><div className="project-card-heading"><strong>{item.name}</strong><span>{item.status}</span></div>{item.summary ? <p>{item.summary}</p> : <p>No summary yet.</p>}<div className="button-row"><button type="button" onClick={() => deleteProject(item)}>Delete</button></div></article>)}</div>
  </ModuleInfoPanel>;
});
