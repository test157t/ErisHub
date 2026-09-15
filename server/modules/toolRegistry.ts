import type { ChatRequest } from "../../shared/types";
import { executeToolCall } from "./actionBus";
import { modules } from "./registry";

type JsonSchema = Record<string, unknown>;
export type McpTool = { name: string; description: string; inputSchema: JsonSchema };

function toolName(action: string) {
  return `erishub_${action.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

export function listMcpTools(request: Pick<ChatRequest, "modules">): McpTool[] {
  const enabled = new Set(request.modules.filter((config) => config.enabled).map((config) => config.id));
  return modules.flatMap((module) => enabled.has(module.id) ? (module.tools || []).map((tool) => ({ name: toolName(tool.action), description: tool.description, inputSchema: tool.inputSchema })) : []);
}

export function listProviderTools(request: Pick<ChatRequest, "modules">) {
  return listMcpTools(request).map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
}

export async function callMcpTool(request: ChatRequest, name: string, input: unknown) {
  const tool = listMcpTools(request).find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown or disabled ErisHub tool: ${name}`);
  const declared = modules.flatMap((module) => module.tools || []).find((item) => toolName(item.action) === name);
  if (!declared) throw new Error(`Unknown ErisHub tool: ${name}`);
  const args = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return executeToolCall(request, declared.action, args);
}
