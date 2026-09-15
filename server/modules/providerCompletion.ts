import type { ProviderConfig } from "../../shared/types";

export type ProviderCompletionMessage = { role: string; content: string };
export type ProviderCompletionOptions = {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  reasoningEffort?: ProviderConfig["reasoningEffort"];
};

function textFromPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const value = part as Record<string, unknown>;
  return typeof value.text === "string" ? value.text : typeof value.content === "string" ? value.content : "";
}

export function providerCompletionText(value: unknown): string {
  const json = value as any;
  const choice = json?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) return choice.map(textFromPart).join("");
  if (typeof json?.output_text === "string") return json.output_text;
  const output = json?.response?.output ?? json?.output;
  if (!Array.isArray(output)) return "";
  return output.map((item: any) => Array.isArray(item?.content) ? item.content.map(textFromPart).join("") : "").join("");
}

export async function completeProvider(
  provider: ProviderConfig,
  messages: ProviderCompletionMessage[],
  options: ProviderCompletionOptions = {}
) {
  const baseUrl = String(provider.baseUrl || "").trim().replace(/\/$/, "");
  const model = String(provider.model || "").trim();
  if (!baseUrl) throw new Error("Provider base URL is required.");
  if (!model) throw new Error("Provider model is required.");
  if (provider.useManagedLlamaCpp !== true && !String(provider.apiKey || "").trim()) throw new Error("Provider API key is required.");
  const useResponsesApi = provider.useGrokResponsesApi === true && provider.useManagedLlamaCpp !== true;
  const body: Record<string, unknown> = useResponsesApi
    ? { model, input: messages, store: false }
    : { model, messages, stream: false };
  const temperature = options.temperature ?? provider.temperature;
  const topP = options.topP ?? provider.topP;
  const topK = options.topK ?? provider.topK;
  const minP = options.minP ?? provider.minP;
  const reasoningEffort = options.reasoningEffort ?? provider.reasoningEffort;
  if (Number.isFinite(Number(temperature))) body.temperature = Number(temperature);
  if (Number.isFinite(Number(topP))) body.top_p = Number(topP);
  if (Number.isFinite(Number(topK)) && Number(topK) > 0) body.top_k = Number(topK);
  if (Number.isFinite(Number(minP)) && Number(minP) > 0) body.min_p = Number(minP);
  if (["low", "medium", "high"].includes(String(reasoningEffort))) body.reasoning_effort = reasoningEffort;
  if (Number.isFinite(Number(options.maxTokens)) && Number(options.maxTokens) > 0) body[useResponsesApi ? "max_output_tokens" : "max_tokens"] = Math.floor(Number(options.maxTokens));
  const response = await fetch(`${baseUrl}${useResponsesApi ? "/responses" : "/chat/completions"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : typeof data?.error === "string" ? data.error : await response.text().catch(() => "");
    throw new Error(message || "Provider request failed.");
  }
  return providerCompletionText(data).trim();
}
