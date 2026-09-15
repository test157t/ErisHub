export type Token = { type: "comment" | "string" | "keyword" | "number" | "jsx-tag" | "function" | "text"; value: string };
export type LineTokens = Token[];

const KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends", "finally",
  "for", "function", "if", "import", "in", "instanceof", "let", "new",
  "of", "return", "static", "super", "switch", "this", "throw", "try",
  "typeof", "var", "void", "while", "with", "yield",
  "true", "false", "null", "undefined", "NaN",
  "from", "as", "type", "interface", "enum", "implements", "abstract",
  "private", "protected", "public", "readonly", "declare", "namespace",
  "module", "keyof", "infer", "satisfies", "using",
  "def", "if", "elif", "else", "for", "while", "try", "except", "finally",
  "import", "from", "as", "class", "return", "yield", "async", "await",
  "pass", "break", "continue", "raise", "with", "lambda", "global", "nonlocal",
  "True", "False", "None",
]);

export function tokenize(code: string): LineTokens[] {
  const all: Token[] = [];
  let i = 0;
  const len = code.length;

  while (i < len) {
    if (code[i] === "/" && code[i + 1] === "/") {
      const start = i;
      while (i < len && code[i] !== "\n") i++;
      all.push({ type: "comment", value: code.slice(start, i) });
      continue;
    }
    if (code[i] === "/" && code[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) i++;
      if (i < len) i += 2;
      all.push({ type: "comment", value: code.slice(start, i) });
      continue;
    }
    if (code[i] === "`") {
      const start = i;
      i++;
      while (i < len && code[i] !== "`") {
        if (code[i] === "\\") { i += 2; continue; }
        i++;
      }
      if (i < len) i++;
      all.push({ type: "string", value: code.slice(start, i) });
      continue;
    }
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      const start = i;
      i++;
      while (i < len && code[i] !== quote) {
        if (code[i] === "\\") i += 2;
        else i++;
      }
      if (i < len) i++;
      all.push({ type: "string", value: code.slice(start, i) });
      continue;
    }
    if (/[0-9]/.test(code[i])) {
      const start = i;
      if (code[i] === "0" && /[xXbBoO]/.test(code[i + 1])) {
        i += 2;
        while (i < len && /[0-9a-fA-F._]/.test(code[i])) i++;
      } else {
        while (i < len && /[0-9._eE+\-]/.test(code[i])) {
          if ((code[i] === "+" || code[i] === "-") && i > start && code[i - 1] !== "e" && code[i - 1] !== "E") break;
          i++;
        }
      }
      all.push({ type: "number", value: code.slice(start, i) });
      continue;
    }
    if (code[i] === "<" && code[i + 1] !== "=" && code[i + 1] !== "<") {
      const start = i;
      if (code[i + 1] === "/") {
        i += 2;
        while (i < len && code[i] !== ">" && code[i] !== "\n") i++;
        if (code[i] === ">") i++;
        all.push({ type: "jsx-tag", value: code.slice(start, i) });
        continue;
      }
      i++;
      while (i < len && /[a-zA-Z0-9_$.\-]/.test(code[i])) i++;
      while (i < len && code[i] !== ">" && code[i] !== "/") {
        if (code[i] === "{" || code[i] === "}") { i++; break; }
        if (code[i] === '"' || code[i] === "'") {
          const q = code[i]; i++;
          while (i < len && code[i] !== q) { if (code[i] === "\\") i++; i++; }
          if (i < len) i++;
          continue;
        }
        if (code[i] === "=" || code[i] === "\n") { i++; continue; }
        if (/\s/.test(code[i])) { i++; continue; }
        i++;
      }
      if (code[i] === "/" && code[i + 1] === ">") i += 2;
      else if (code[i] === ">") i++;
      all.push({ type: "jsx-tag", value: code.slice(start, i) });
      continue;
    }
    if (/[a-zA-Z_$]/.test(code[i])) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) i++;
      const word = code.slice(start, i);
      if (KEYWORDS.has(word)) {
        all.push({ type: "keyword", value: word });
      } else {
        let j = i;
        while (j < len && (code[j] === " " || code[j] === "\t")) j++;
        const isFn = j < len && code[j] === "(";
        all.push({ type: isFn ? "function" : "text", value: word });
      }
      continue;
    }
    if (code[i] === "\n") {
      all.push({ type: "text", value: "\n" });
      i++;
      continue;
    }
    all.push({ type: "text", value: code[i] });
    i++;
  }

  const lines: LineTokens[] = [[]];
  for (const token of all) {
    if (token.type === "text" && token.value === "\n") {
      lines.push([]);
    } else {
      const lastLine = lines[lines.length - 1];
      const last = lastLine[lastLine.length - 1];
      if (last && last.type === token.type) {
        last.value += token.value;
      } else {
        lastLine.push({ ...token });
      }
    }
  }
  if (lines[lines.length - 1].length === 0 && code.endsWith("\n")) {
    lines.push([]);
  }
  return lines;
}
