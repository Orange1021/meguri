import type { Kind } from "./types.js";

export type PlaylistRule =
  | { op: "tag"; value: string }
  | { op: "and"; children: PlaylistRule[] }
  | { op: "or"; children?: PlaylistRule[]; tags?: string[] }
  | { op: "not"; child: PlaylistRule }
  | { op: "kind"; value: Kind }
  | { op: "favorite"; value: boolean }
  | { op: "rating_gte"; value: number }
  | { op: "played"; value: boolean };

export interface PlaylistRuleContext {
  tags: readonly string[];
  kind: string;
  favorite: boolean;
  rating: number;
  played: boolean;
}

const MAX_RULE_DEPTH = 12;
const MAX_RULE_NODES = 128;
const MAX_TAG_VALUE_LENGTH = 256;

/** Normalize user-authored rules before they are persisted or compiled. */
export function normalizePlaylistRule(rule: PlaylistRule): PlaylistRule {
  let nodes = 0;
  const visit = (value: PlaylistRule, depth: number): PlaylistRule => {
    nodes++;
    if (nodes > MAX_RULE_NODES || depth > MAX_RULE_DEPTH) {
      throw new Error("playlist rule is too complex");
    }
    if (!value || typeof value !== "object" || typeof value.op !== "string") {
      throw new Error("invalid playlist rule");
    }
    switch (value.op) {
      case "tag": {
        const tag = value.value.trim();
        if (!tag || tag.length > MAX_TAG_VALUE_LENGTH) {
          throw new Error("invalid playlist rule tag");
        }
        return { op: "tag", value: tag };
      }
      case "kind":
        if (
          value.value !== "video" &&
          value.value !== "image" &&
          value.value !== "audio"
        ) {
          throw new Error("invalid playlist rule kind");
        }
        return { op: "kind", value: value.value };
      case "favorite":
      case "played":
        if (typeof value.value !== "boolean")
          throw new Error("invalid playlist rule boolean");
        return { op: value.op, value: value.value };
      case "rating_gte":
        if (
          !Number.isInteger(value.value) ||
          value.value < 0 ||
          value.value > 5
        ) {
          throw new Error("invalid playlist rule rating");
        }
        return { op: "rating_gte", value: value.value };
      case "not":
        return { op: "not", child: visit(value.child, depth + 1) };
      case "and":
      case "or": {
        const rawChildren =
          value.op === "or" && value.tags
            ? value.tags.map((tag): PlaylistRule => ({ op: "tag", value: tag }))
            : value.children;
        if (!Array.isArray(rawChildren) || rawChildren.length === 0) {
          throw new Error("playlist rule boolean node cannot be empty");
        }
        const children = rawChildren.map((child) => visit(child, depth + 1));
        const flattened: PlaylistRule[] = [];
        for (const child of children) {
          if (child.op === value.op && "children" in child && child.children) {
            flattened.push(...child.children);
          } else {
            flattened.push(child);
          }
        }
        const unique = [
          ...new Map(
            flattened.map((child) => [ruleKey(child), child]),
          ).values(),
        ];
        unique.sort((left, right) =>
          ruleKey(left).localeCompare(ruleKey(right)),
        );
        if (unique.length === 1) return unique[0];
        return { op: value.op, children: unique };
      }
      default:
        throw new Error("unknown playlist rule operator");
    }
  };
  return visit(rule, 0);
}

export function playlistRuleMatches(
  rule: PlaylistRule,
  context: PlaylistRuleContext,
): boolean {
  const normalized = normalizePlaylistRule(rule);
  const tags = new Set(context.tags.map((tag) => tag.toLocaleLowerCase()));
  const evaluate = (value: PlaylistRule): boolean => {
    switch (value.op) {
      case "tag":
        return tags.has(value.value.toLocaleLowerCase());
      case "and":
        return value.children.every(evaluate);
      case "or":
        return value.children?.some(evaluate) ?? false;
      case "not":
        return !evaluate(value.child);
      case "kind":
        return context.kind === value.value;
      case "favorite":
        return context.favorite === value.value;
      case "rating_gte":
        return context.rating >= value.value;
      case "played":
        return context.played === value.value;
    }
  };
  return evaluate(normalized);
}

/** Compile a normalized rule to a parameterized SQLite predicate. */
export function playlistRuleSql(rule: PlaylistRule, args: unknown[]): string {
  const normalized = normalizePlaylistRule(rule);
  const compile = (value: PlaylistRule): string => {
    switch (value.op) {
      case "tag":
        args.push(value.value, value.value);
        return "EXISTS (SELECT 1 FROM meta_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.meta_key = f.meta_key AND ((t.namespace = '' AND t.name = ?) OR (t.namespace <> '' AND t.namespace || ':' || t.name = ?)))";
      case "and":
        return `(${value.children.map(compile).join(" AND ")})`;
      case "or":
        return `(${(value.children ?? []).map(compile).join(" OR ")})`;
      case "not":
        return `(NOT ${compile(value.child)})`;
      case "kind":
        args.push(value.value);
        return "f.kind = ?";
      case "favorite":
        args.push(value.value ? 1 : 0);
        return "COALESCE(m.favorite, 0) = ?";
      case "rating_gte":
        args.push(value.value);
        return "COALESCE(m.rating, 0) >= ?";
      case "played":
        return `${value.value ? "EXISTS" : "NOT EXISTS"} (SELECT 1 FROM play_history ph WHERE ph.meta_key = f.meta_key)`;
    }
  };
  return compile(normalized);
}

export function ruleKey(rule: PlaylistRule): string {
  return JSON.stringify(rule);
}
