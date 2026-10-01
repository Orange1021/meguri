import { describe, expect, it } from "vitest";
import {
  normalizePlaylistRule,
  playlistRuleMatches,
  type PlaylistRule,
} from "../playlistRules.js";

describe("playlist rule AST", () => {
  it("normalizes nested boolean nodes deterministically", () => {
    const rule: PlaylistRule = {
      op: "and",
      children: [
        { op: "and", children: [{ op: "tag", value: " series:柯南 " }] },
        { op: "tag", value: "quality:1080p" },
        { op: "tag", value: "quality:1080p" },
      ],
    };
    expect(normalizePlaylistRule(rule)).toEqual({
      op: "and",
      children: [
        { op: "tag", value: "quality:1080p" },
        { op: "tag", value: "series:柯南" },
      ],
    });
  });

  it("supports AND, OR, NOT and scalar predicates", () => {
    const rule: PlaylistRule = {
      op: "and",
      children: [
        { op: "or", children: [{ op: "tag", value: "series:柯南" }, { op: "tag", value: "series:金田一" }] },
        { op: "not", child: { op: "tag", value: "watch:completed" } },
        { op: "rating_gte", value: 4 },
        { op: "kind", value: "video" },
      ],
    };
    expect(
      playlistRuleMatches(rule, {
        tags: ["series:柯南"],
        rating: 5,
        kind: "video",
        favorite: false,
        played: false,
      }),
    ).toBe(true);
    expect(
      playlistRuleMatches(rule, {
        tags: ["series:柯南", "watch:completed"],
        rating: 5,
        kind: "video",
        favorite: false,
        played: true,
      }),
    ).toBe(false);
  });

  it("rejects excessive depth and empty boolean nodes", () => {
    expect(() => normalizePlaylistRule({ op: "and", children: [] })).toThrow(
      "playlist rule",
    );
    let deep: PlaylistRule = { op: "tag", value: "x" };
    for (let i = 0; i < 20; i++) deep = { op: "not", child: deep };
    expect(() => normalizePlaylistRule(deep)).toThrow("playlist rule");
  });
});
