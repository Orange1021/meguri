import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

describe("Chinese user guide", () => {
  it("exists with the required user-facing sections", () => {
    const guide = read("docs/user-guide-zh-CN.md");
    for (const heading of [
      "## 1. 软件定位",
      "## 2. Windows 便携版目录",
      "## 3. 第一次使用",
      "## 4. 浏览、搜索和筛选",
      "## 5. 播放视频、图片和音频",
      "## 6. 标签、评分、收藏和历史",
      "## 7. 集合、稍后观看和播放列表",
      "## 8. 设置与快捷键",
      "## 9. 备份、恢复和升级",
      "## 10. 常见问题",
    ]) {
      assert.ok(guide.includes(heading), `missing heading: ${heading}`);
    }
    assert.match(guide, /只读|不会修改|不会移动|不会删除/);
    assert.match(guide, /Data/);
    assert.match(guide, /Media/);
  });

  it("is linked from the repository README and docs landing page", () => {
    assert.match(read("README.md"), /docs\/user-guide-zh-CN\.md/);
    assert.match(read("docs/index.html"), /user-guide-zh-CN\.md/);
  });
});
