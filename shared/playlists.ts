import { z } from "zod";

export type PlaylistRule =
  | { op: "tag"; value: string }
  | { op: "and"; children: PlaylistRule[] }
  | { op: "or"; children?: PlaylistRule[]; tags?: string[] }
  | { op: "not"; child: PlaylistRule }
  | { op: "kind"; value: "video" | "image" | "audio" }
  | { op: "favorite"; value: boolean }
  | { op: "rating_gte"; value: number }
  | { op: "played"; value: boolean };

export const PlaylistRuleSchema: z.ZodType<PlaylistRule> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal("tag"), value: z.string().max(256) }),
    z.object({ op: z.literal("and"), children: z.array(PlaylistRuleSchema).min(1).max(128) }),
    z.object({
      op: z.literal("or"),
      children: z.array(PlaylistRuleSchema).min(1).max(128).optional(),
      tags: z.array(z.string().max(256)).min(1).max(128).optional(),
    }).refine((value) => value.children !== undefined || value.tags !== undefined, {
      message: "or rule needs children or tags",
    }),
    z.object({ op: z.literal("not"), child: PlaylistRuleSchema }),
    z.object({ op: z.literal("kind"), value: z.enum(["video", "image", "audio"]) }),
    z.object({ op: z.literal("favorite"), value: z.boolean() }),
    z.object({ op: z.literal("rating_gte"), value: z.number().int().min(0).max(5) }),
    z.object({ op: z.literal("played"), value: z.boolean() }),
  ]),
);

export const PlaylistKindSchema = z.enum(["static", "smart"]);
export type PlaylistKind = z.infer<typeof PlaylistKindSchema>;

export const PlaylistSortSchema = z.object({
  field: z.enum(["name", "rating", "captured", "btime", "accessed", "hash"]),
  dir: z.enum(["asc", "desc"]),
});
export type PlaylistSort = z.infer<typeof PlaylistSortSchema>;
