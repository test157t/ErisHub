import type { PromptBlock } from "../../shared/types";
import type { AppModule } from "./types";

const PYTHON_SANDBOX_PROMPT_BLOCK: PromptBlock = {
  id: "python-sandbox-guidance",
  name: "Python Sandbox Guidance",
  enabled: true,
  role: "system",
  position: "bottom",
  priority: 20,
  content: "Python and JavaScript code blocks may be run only when the user explicitly clicks Run. Code runs in a local Python 3 or Node.js process on the server with output limited by the active provider max output tokens. The process runs with the project directory as its working directory, so it can access project files."
};

export const pythonSandboxModule: AppModule = {
  id: "python-sandbox",
  name: "Python Sandbox",
  description: "Runs assistant Python code blocks in a server-side sandboxed local Python process with project directory access.",
  kind: "tool",
  defaultEnabled: false,
  defaultSettings: {
    requireConfirmation: true
  },
  hooks: {
    getPromptBlocks(): PromptBlock[] {
      return [PYTHON_SANDBOX_PROMPT_BLOCK];
    }
  }
};
