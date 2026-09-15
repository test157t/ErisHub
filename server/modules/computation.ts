import type { PromptBlock } from "../../shared/types";
import { moduleTool, type AppModule } from "./types";
import { calculatorModule } from "./calculator";
import { pythonSandboxModule } from "./pythonSandbox";

export const computationModule: AppModule = {
  id: "computation",
  name: "Computation",
  description: "Calculator, hashline editing, and client-side Python sandbox for exact local computation.",
  kind: "tool",
  defaultEnabled: false,
  defaultSettings: {
    requireConfirmation: true,
    enableHashlineEdits: true,
    autoSaveEditorFiles: false
  },
  tools: [moduleTool("calculate", "Evaluate exact arithmetic or date math.", ["expression"]), moduleTool("python.run", "Run Python code in the configured project context."), moduleTool("assistant-file.hashline", "Replace exact numbered lines in an assistant-managed file.", ["id"])],
  hooks: {
    async getPromptBlocks(): Promise<PromptBlock[]> {
      const calculatorBlocks = await calculatorModule.hooks!.getPromptBlocks!({} as never);
      const pythonBlocks = await pythonSandboxModule.hooks!.getPromptBlocks!({} as never);
      return [
        ...calculatorBlocks,
        ...pythonBlocks,
        { id: "hashline-edit-guidance", name: "Hashline Editing", enabled: true, role: "system", position: "bottom", priority: 54, content: "Use the assistant-file hashline tool for precise line replacements. Line numbers are 1-based." }
      ];
    }
  }
};
