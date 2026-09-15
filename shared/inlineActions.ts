export type ExtractedInlineAction = { type: string; attrs: Record<string, string>; body: string };

const ACTION_RE = /<action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/gi;
const DOTTED_TAG_RE = /<([a-zA-Z]\w*(?:\.[a-zA-Z]\w+)+)([\s>\/])/g;
const CLOSE_DOTTED_TAG_RE = /<\/([a-zA-Z]\w*(?:\.[a-zA-Z]\w+)+)>/g;
const LEGACY_COLON_TAG_STRIP_RE = /<\w+:\s*[^>]*?\/?>/g;

export function normalizeInlineActionTags(content: string) {
  return String(content || "").replace(DOTTED_TAG_RE, '<action type="$1"$2').replace(CLOSE_DOTTED_TAG_RE, "</action>");
}

export function parseInlineActionAttrs(raw: string) {
  const attrs: Record<string, string> = {};
  for (const match of String(raw || "").matchAll(/([a-zA-Z][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[match[1]] = value.replace(/^["']|["']$/g, "");
  }
  return attrs;
}

export function extractInlineActionTags(content: string): ExtractedInlineAction[] {
  const normalized = normalizeInlineActionTags(content);
  return Array.from(normalized.matchAll(ACTION_RE), (match) => {
    const attrs = parseInlineActionAttrs(match[1]);
    return { type: String(attrs.type || "").trim(), attrs, body: String(match[2] || "").trim() };
  }).filter((action) => action.type);
}

export function stripInlineActionTags(content: string, preserveTypes: string[] = []) {
  const preserve = new Set(preserveTypes);
  return normalizeInlineActionTags(content).replace(ACTION_RE, (match, rawAttrs) => {
    const type = String(parseInlineActionAttrs(rawAttrs).type || "").trim();
    return preserve.has(type) ? match : "";
  }).replace(LEGACY_COLON_TAG_STRIP_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}
