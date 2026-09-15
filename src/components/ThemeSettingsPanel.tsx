import { memo, useEffect, useState, type CSSProperties } from "react";
import type { ProviderConfig } from "../../shared/types";
import type { ModuleSettingChange, ModuleSettings } from "./modules/types";

type ThemeSettingsPanelProps = { onError: (message: string) => void; onSettingChange: ModuleSettingChange; provider: ProviderConfig; settings: ModuleSettings };
type ThemeTokenSet = Record<string, unknown> & { id: string; name: string };

const defaultTheme: ThemeTokenSet = {
  id: "nitral-dark", name: "Nitral Dark", colorBg: "#06040d", colorBg2: "#10091f", colorSurface: "rgba(18, 12, 31, 0.82)", colorSurface2: "rgba(28, 18, 46, 0.78)", colorSurface3: "rgba(45, 28, 70, 0.72)", colorGlass: "rgba(7, 5, 13, 0.72)", colorLine: "rgba(220, 205, 255, 0.12)", colorLineStrong: "rgba(220, 205, 255, 0.2)", colorText: "#f7f2ff", colorMuted: "#b9accd", colorMuted2: "#8d7fa3", colorAccent: "#b26cff", colorAccent2: "#7c3aed", colorAccent3: "#d8b4fe", colorDanger: "#ff6b7a", colorDangerBg: "rgba(255, 87, 104, 0.13)", colorSuccess: "#4ade80", colorSuccessBg: "rgba(74, 222, 128, 0.13)", colorWarning: "#ffbd7a", colorWarningBg: "rgba(255, 189, 122, 0.13)", colorInfo: "#8be9fd", colorInfoBg: "rgba(139, 233, 253, 0.13)", colorCodeKeyword: "#ff79c6", colorCodeString: "#50fa7b", colorCodeNumber: "#bd93f9", colorCodeComment: "#6272a4", colorCodeFunction: "#ffb86c", colorCodeTag: "#8be9fd", colorCodeCaret: "#f0ebe5", colorCodeCompletion: "#ffd89b", radiusLg: 28, radiusMd: 18, radiusSm: 12, controlHeight: 38, controlRadius: 14, controlBorderOpacity: 0.18, controlBgOpacity: 0.54, shadowStrength: 46
};

const colorFields = [["colorBg", "Background"], ["colorBg2", "Background 2"], ["colorSurface", "Surface"], ["colorSurface2", "Surface 2"], ["colorSurface3", "Surface 3"], ["colorGlass", "Glass"], ["colorLine", "Line"], ["colorLineStrong", "Strong line"], ["colorText", "Text"], ["colorMuted", "Muted"], ["colorMuted2", "Muted 2"], ["colorAccent", "Accent"], ["colorAccent2", "Accent 2"], ["colorAccent3", "Accent 3"], ["colorDanger", "Danger"], ["colorDangerBg", "Danger bg"], ["colorSuccess", "Success"], ["colorSuccessBg", "Success bg"], ["colorWarning", "Warning"], ["colorWarningBg", "Warning bg"], ["colorInfo", "Info"], ["colorInfoBg", "Info bg"], ["colorCodeKeyword", "Code keyword"], ["colorCodeString", "Code string"], ["colorCodeNumber", "Code number"], ["colorCodeComment", "Code comment"], ["colorCodeFunction", "Code function"], ["colorCodeTag", "Code tag"], ["colorCodeCaret", "Code caret"], ["colorCodeCompletion", "Code completion"]] as const;
const numberFields = [["radiusLg", "Large radius", 10, 44, "px"], ["radiusMd", "Medium radius", 6, 32, "px"], ["radiusSm", "Small radius", 4, 24, "px"], ["controlHeight", "Control height", 28, 56, "px"], ["controlRadius", "Control radius", 4, 28, "px"], ["controlBorderOpacity", "Control border", 0, 1, ""], ["controlBgOpacity", "Control fill", 0, 1, ""], ["shadowStrength", "Shadow strength", 0, 90, "%"]] as const;

function themesFromSettings(settings: ModuleSettings): ThemeTokenSet[] {
  const raw = Array.isArray(settings.themes) ? settings.themes : [];
  const themes = raw.filter((item): item is ThemeTokenSet => Boolean(item) && typeof item === "object" && !Array.isArray(item) && typeof (item as ThemeTokenSet).id === "string");
  return themes.length ? themes : [defaultTheme];
}

function activeThemeId(settings: ModuleSettings, themes: ThemeTokenSet[]) {
  const id = String(settings.activeThemeId || "").trim();
  return themes.some((theme) => theme.id === id) ? id : themes[0].id;
}

function clamp(value: string, min: number, max: number, fallback: number) {
  const next = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(next) ? next : fallback));
}

function themeValue(theme: ThemeTokenSet, key: string) {
  return String(theme[key] ?? defaultTheme[key] ?? "").trim();
}

function themeNumber(theme: ThemeTokenSet, key: string) {
  const value = Number(theme[key] ?? defaultTheme[key]);
  return Number.isFinite(value) ? value : Number(defaultTheme[key]);
}

function lighten(hex: string, amount: number) {
  const num = parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(num)) return hex;
  const r = Math.min(255, ((num >> 16) & 255) + amount);
  const g = Math.min(255, ((num >> 8) & 255) + amount);
  const b = Math.min(255, (num & 255) + amount);
  return `rgb(${r},${g},${b})`;
}

function themeCardStyle(theme: ThemeTokenSet) {
  const raw = themeValue(theme, "colorText");
  return {
    "--theme-card-bg": themeValue(theme, "colorBg"),
    "--theme-card-bg-2": themeValue(theme, "colorBg2"),
    "--theme-card-surface": themeValue(theme, "colorSurface"),
    "--theme-card-surface-2": themeValue(theme, "colorSurface2"),
    "--theme-card-line": themeValue(theme, "colorLine"),
    "--theme-card-line-strong": themeValue(theme, "colorLineStrong"),
    "--theme-card-text": raw,
    "--theme-card-muted": themeValue(theme, "colorMuted"),
    "--theme-card-muted-2": themeValue(theme, "colorMuted2"),
    "--theme-card-accent": themeValue(theme, "colorAccent"),
    "--theme-card-accent-2": themeValue(theme, "colorAccent2"),
    "--theme-card-accent-3": themeValue(theme, "colorAccent3"),
    "--theme-card-danger": themeValue(theme, "colorDanger"),
    "--theme-card-danger-bg": themeValue(theme, "colorDangerBg"),
    "--theme-card-text-strong": lighten(raw, 15),
    "--theme-card-radius-lg": `${themeNumber(theme, "radiusLg")}px`,
    "--theme-card-radius-md": `${themeNumber(theme, "radiusMd")}px`,
    "--theme-card-radius-sm": `${themeNumber(theme, "radiusSm")}px`,
    "--theme-card-control-radius": `${themeNumber(theme, "controlRadius")}px`,
    "--theme-card-shadow-alpha": String(Math.max(0, Math.min(90, themeNumber(theme, "shadowStrength"))) / 100)
  } as CSSProperties;
}

export const ThemeSettingsPanel = memo(function ThemeSettingsPanel({ onError, onSettingChange, provider, settings }: ThemeSettingsPanelProps) {
  const themes = themesFromSettings(settings);
  const selectedId = activeThemeId(settings, themes);
  const selectedTheme = themes.find((theme) => theme.id === selectedId) || themes[0];
  const [expandedThemeId, setExpandedThemeId] = useState("");
  const [promptThemeId, setPromptThemeId] = useState("");
  const [themePrompt, setThemePrompt] = useState("");
  const [generatingTheme, setGeneratingTheme] = useState(false);
  const [themePromptError, setThemePromptError] = useState("");

  useEffect(() => {
    if (expandedThemeId && !themes.some((theme) => theme.id === expandedThemeId)) setExpandedThemeId(selectedId);
  }, [expandedThemeId, selectedId, themes]);

  const persistTheme = (theme: ThemeTokenSet) => {
    fetch(`/api/settings/themes/${encodeURIComponent(theme.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(theme) }).catch((error) => onError(error instanceof Error ? error.message : "Theme save failed."));
  };
  const updateThemes = (nextThemes: ThemeTokenSet[], nextActiveId = selectedId) => {
    onSettingChange("themes", nextThemes);
    onSettingChange("activeThemeId", nextActiveId);
    nextThemes.forEach(persistTheme);
  };
  const updateTheme = (themeId: string, changes: Partial<ThemeTokenSet>) => updateThemes(themes.map((theme) => theme.id === themeId ? { ...theme, ...changes } : theme));
  const createTheme = () => {
    const id = `theme-${crypto.randomUUID()}`;
    updateThemes([...themes, { ...selectedTheme, id, name: `${selectedTheme.name || "Theme"} Copy` }], id);
    setExpandedThemeId(id);
  };
  const deleteTheme = (id: string) => {
    if (themes.length <= 1) return;
    const nextThemes = themes.filter((theme) => theme.id !== id);
    const nextActiveId = id === selectedId ? nextThemes[0].id : selectedId;
    updateThemes(nextThemes, nextActiveId);
    fetch(`/api/settings/themes/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((error) => onError(error instanceof Error ? error.message : "Theme delete failed."));
    setExpandedThemeId(nextActiveId);
  };
  const promptTheme = themes.find((theme) => theme.id === promptThemeId);
  const generatePromptedTheme = async () => {
    if (!promptTheme || !themePrompt.trim() || generatingTheme) return;
    setThemePromptError("");
    setGeneratingTheme(true);
    try {
      const response = await fetch("/api/settings/themes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: themePrompt, provider, currentTheme: promptTheme })
      });
      if (!response.ok) throw new Error(String((await response.json().catch(() => ({})))?.error || "Theme generation failed."));
      const data = await response.json().catch(() => ({}));
      const generated = data.theme && typeof data.theme === "object" && !Array.isArray(data.theme) ? data.theme as Record<string, unknown> : {};
      updateTheme(promptTheme.id, { ...generated, id: promptTheme.id, name: String(generated.name || promptTheme.name || "Generated Theme") });
      setThemePrompt("");
      setPromptThemeId("");
      setExpandedThemeId(promptTheme.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Theme generation failed.";
      setThemePromptError(message);
      onError(message);
    } finally {
      setGeneratingTheme(false);
    }
  };

  return <div className="voiceforge-panel native-voiceforge-panel theme-panel">
    <div className="theme-card-toolbar"><div><strong>Theme library</strong><small>Select a theme or open a card to customize it.</small></div><span className="theme-toolbar-actions"><button className="theme-create-button" type="button" onClick={createTheme}>Create theme</button></span></div>
    <div className="theme-card-list">
      {themes.map((theme) => {
        const isActive = theme.id === selectedId;
        const isExpanded = theme.id === expandedThemeId;
        const bg = themeValue(theme, "colorBg");
        const surface = themeValue(theme, "colorSurface");
        const accent = themeValue(theme, "colorAccent");
        const accent2 = themeValue(theme, "colorAccent2");
        const accent3 = themeValue(theme, "colorAccent3");
        return <div className={`theme-card ${isActive ? "active" : ""} ${isExpanded ? "open" : ""}`} key={theme.id} style={themeCardStyle(theme)}>
          <div className="theme-card-summary" onClick={() => setExpandedThemeId(isExpanded ? "" : theme.id)}>
            <span className="theme-card-preview" style={{ background: `radial-gradient(circle at 16% 0%, ${accent}55, transparent 58%), linear-gradient(145deg, ${surface}, ${bg})` }}><span className="theme-preview-window"><i style={{ background: accent }} /><i style={{ background: accent2 }} /><i style={{ background: accent3 }} /></span><span className="theme-preview-button" /><span className="theme-preview-lines"><i /><i /><i /></span></span>
            <span className="theme-card-body"><span><strong style={{ color: themeValue(theme, "colorText") }}>{String(theme.name || "Theme")}</strong><small style={{ color: themeValue(theme, "colorMuted") }}>{isActive ? "Active theme" : "Available theme"}</small></span><span className="theme-card-swatches"><i style={{ background: bg }} /><i style={{ background: surface }} /><i style={{ background: accent }} /><i style={{ background: accent3 }} /></span></span>
          </div>
          {isExpanded ? <div className="theme-card-editor" role="dialog" aria-modal="true" aria-label={`Edit ${String(theme.name || "theme")}`}>
            <div className="theme-editor-header"><div><strong>Edit {String(theme.name || "Theme")}</strong><small>Changes are saved as you make them.</small></div><button aria-label="Close theme editor" type="button" onClick={() => setExpandedThemeId("")}>×</button></div>
            <div className="theme-card-actions"><button className="small-action-button" disabled={isActive} type="button" onClick={() => onSettingChange("activeThemeId", theme.id)}>{isActive ? "Active" : "Activate"}</button><button className="small-action-button" type="button" onClick={() => { setPromptThemeId(theme.id); setThemePrompt(""); setThemePromptError(""); }}>Prompt theme</button>{themes.length > 1 ? <button className="delete-button small-action-button" type="button" onClick={() => deleteTheme(theme.id)}>Delete</button> : null}</div>
            <label>Theme name<input className="text_pole" value={String(theme.name || "")} onChange={(event) => updateTheme(theme.id, { name: event.target.value })} /></label>
            <details className="voiceforge-section native-voiceforge-section"><summary className="voiceforge-section-header"><span>Global Colors</span><i className="fa-solid fa-chevron-down" /></summary><div className="voiceforge-section-content theme-token-grid">{colorFields.map(([key, label]) => { const value = String(theme[key] ?? defaultTheme[key] ?? ""); return <label key={key}>{label}<div className="theme-color-row"><input aria-label={`${label} color`} type="color" value={value.startsWith("#") ? value : "#000000"} onChange={(event) => updateTheme(theme.id, { [key]: event.target.value })} /><input className="text_pole" value={value} onChange={(event) => updateTheme(theme.id, { [key]: event.target.value })} /></div></label>; })}</div></details>
            <details className="voiceforge-section native-voiceforge-section"><summary className="voiceforge-section-header"><span>Shape And Controls</span><i className="fa-solid fa-chevron-down" /></summary><div className="voiceforge-section-content">{numberFields.map(([key, label, min, max, suffix]) => { const rawValue = Number(theme[key] ?? defaultTheme[key]); const value = Number.isFinite(rawValue) ? rawValue : min; const step = max <= 1 ? 0.01 : 1; return <label key={key}>{label}<div className="voiceforge-range-row"><input className="text_pole" min={min} max={max} step={step} type="range" value={value} onChange={(event) => updateTheme(theme.id, { [key]: clamp(event.target.value, min, max, value) })} /><span>{value}{suffix}</span></div></label>; })}</div></details>
          </div> : null}
        </div>;
      })}
    </div>
    {promptTheme ? <div className="theme-prompt-modal" role="dialog" aria-modal="true" aria-label="Prompt theme generator">
      <div className="theme-prompt-card">
        <div className="modal-header"><strong>Prompt {promptTheme.name}</strong><button aria-label="Close theme prompt" type="button" onClick={() => setPromptThemeId("")}>×</button></div>
        <label>Describe the theme you want<textarea className="text_pole" rows={6} value={themePrompt} onChange={(event) => setThemePrompt(event.target.value)} placeholder="Example: a soft moonlit glass theme with cool blue shadows, lavender accents, low contrast surfaces, and rounded controls." /></label>
        {themePromptError ? <p className="theme-prompt-error">{themePromptError}</p> : null}
        {generatingTheme ? <p className="text_muted">Generating theme tokens with {provider.name || provider.model}...</p> : null}
        <div className="theme-card-actions"><button disabled={generatingTheme || !themePrompt.trim()} type="button" onClick={generatePromptedTheme}>{generatingTheme ? "Generating..." : "Generate theme"}</button><button className="small-action-button" type="button" onClick={() => setPromptThemeId("")}>Cancel</button></div>
      </div>
    </div> : null}
  </div>;
});
