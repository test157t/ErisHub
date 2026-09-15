import type { PromptBlock } from "../../shared/types";
import type { AppModule } from "./types";

export function calculateExpression(expression: string) {
  const expr = String(expression || "").trim().slice(0, 240);
  if (!expr) throw new Error("Missing expression.");
  const dateMatch = expr.match(/^date\s*([+-])\s*(\d+)\s*(day|days|week|weeks|month|months)$/i);
  if (dateMatch) {
    const date = new Date();
    const amount = Number(dateMatch[2]) * (dateMatch[1] === "-" ? -1 : 1);
    const unit = dateMatch[3].toLowerCase();
    if (unit.startsWith("day")) date.setDate(date.getDate() + amount);
    if (unit.startsWith("week")) date.setDate(date.getDate() + amount * 7);
    if (unit.startsWith("month")) date.setMonth(date.getMonth() + amount);
    return date.toISOString();
  }
  if (!/^[0-9+\-*/().%\s]+$/.test(expr)) throw new Error("Only arithmetic expressions are supported.");
  // This is constrained to arithmetic characters above; no identifiers or calls.
  const result = Function(`"use strict"; return (${expr.replace(/%/g, "/100")});`)();
  if (!Number.isFinite(Number(result))) throw new Error("Calculation did not produce a finite number.");
  return String(result);
}

const CALCULATOR_PROMPT_BLOCK: PromptBlock = { id: "calculator-guidance", name: "Calculator", enabled: true, role: "system", position: "bottom", priority: 55, content: "Use the calculator tool for exact arithmetic or date math. It computes results locally." };

export const calculatorModule: AppModule = { id: "calculator", name: "Calculator", description: "Deterministic local arithmetic and date math helper.", kind: "tool", defaultEnabled: false, defaultSettings: {}, hooks: { getPromptBlocks(): PromptBlock[] { return [CALCULATOR_PROMPT_BLOCK]; } } };
