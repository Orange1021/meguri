import { describe, expect, it } from "vitest";
import { buildM3u8 } from "../m3u8.js";

describe("M3U8 export", () => {
  it("writes UTF-8 ordered entries and skips missing files", () => {
    const output = buildM3u8([
      { path: "E:\\Media\\柯南\\one.mp4", title: "第一集", duration: 5420 },
      { path: null, title: "missing", duration: 10 },
      { path: "E:\\Media\\folder with spaces\\two.avi", title: "第二集", duration: null },
    ]);
    expect(output).toBe(
      "#EXTM3U\r\n" +
        "#EXTINF:5420,第一集\r\n" +
        "E:\\Media\\柯南\\one.mp4\r\n" +
        "#EXTINF:0,第二集\r\n" +
        "E:\\Media\\folder with spaces\\two.avi\r\n",
    );
  });

  it("removes line breaks from titles and paths", () => {
    const output = buildM3u8([
      { path: "C:\\safe\\x.mp4\r\n#EXTM3U", title: "bad\nname", duration: 1 },
    ]);
    expect(output).not.toContain("\nname");
    expect(output).not.toContain("#EXTM3U\r\n#EXTM3U");
  });
});
