import { FormEvent, memo, SetStateAction } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings, SimpleModuleDraft } from "./types";

type ComputationPanelProps = {
  settings: ModuleSettings;
  simpleDraft: SimpleModuleDraft;
  calculate: (expression: string) => Promise<unknown>;
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  setSimpleDraft: (value: SetStateAction<SimpleModuleDraft>) => void;
};

export const ComputationPanel = memo(function ComputationPanel({ settings, simpleDraft, calculate, onError, onSettingChange, setSimpleDraft }: ComputationPanelProps) {
  const handleCalculate = (event: FormEvent) => {
    event.preventDefault();
    calculate(simpleDraft.calc)
      .then((data) => setSimpleDraft((current) => ({ ...current, calcResult: String((data as { result?: unknown })?.result || "") })))
      .catch((error) => onError(error.message));
  };

  return <ModuleInfoPanel className="basic-module-panel" description="Local calculator, hashline editor edits, and client-side Pyodide/WASM Python sandbox." title="Computation">
    <form className="basic-create-form" onSubmit={handleCalculate}><input value={simpleDraft.calc} onChange={(event) => setSimpleDraft((current) => ({ ...current, calc: event.target.value }))} placeholder="2 + 2 * 5" /><button type="submit">Calculate</button></form>{simpleDraft.calcResult ? <pre className="python-sandbox-output done">{simpleDraft.calcResult}</pre> : null}
    <ToggleSetting checked={settings.requireConfirmation !== false} onChange={(checked) => onSettingChange("requireConfirmation", checked)}>Confirm before running</ToggleSetting>
    <ToggleSetting checked={settings.enableHashlineEdits !== false} onChange={(checked) => onSettingChange("enableHashlineEdits", checked)}>Allow model hashline edit tool</ToggleSetting>
    <ToggleSetting checked={settings.autoSaveEditorFiles === true} onChange={(checked) => onSettingChange("autoSaveEditorFiles", checked)}>Auto-save editor files after accepted edits</ToggleSetting>
  </ModuleInfoPanel>;
});
