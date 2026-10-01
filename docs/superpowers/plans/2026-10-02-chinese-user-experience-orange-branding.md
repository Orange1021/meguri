# 中文用户体验与橙子品牌 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Meguri 增加面向普通用户的简体中文使用文档，将无语言偏好的首次启动默认设为简体中文，并用统一的橙色圆形水果图标替换旧 Logo，同时保持旧配置和便携恢复兼容。

**Architecture:** 文档、语言和品牌资产分为三个可独立验收的工作流，最后由同一轮 typecheck、测试、打包和 Windows portable 冒烟测试汇合。Logo 使用 `shared/branding/orangeLogo.ts` 维护唯一的 SVG/data URL 源，renderer 和 Electron 主进程都引用该源；`LogoId` 只暴露 `orange`，配置解析层把旧值归一化为 `orange`。用户手册以 Markdown 为唯一维护源，README 和文档入口只负责链接。

**Tech Stack:** Electron 42, TypeScript, React 19, Vitest, Testing Library, Node `node:test`, electron-builder, Playwright（仅用于从 SVG 生成发布用位图资源）。

---

## 文件边界

### 文档工作流

- Create: `docs/user-guide-zh-CN.md` — 面向普通 Windows 用户的中文手册。
- Create: `scripts/__tests__/user-guide.test.mjs` — 检查手册章节、README 链接和文档入口链接。
- Modify: `README.md` — 添加中文手册入口，移除旧“巡り”品牌解释。
- Modify: `docs/index.html` — 添加简体中文手册链接。

### 中文界面工作流

- Modify: `src/i18n/I18nProvider.tsx` — 简体中文首选顺序和无偏好回退值。
- Modify: `src/i18n/locales/ja.ts`, `en.ts`, `zh-CN.ts`, `ko.ts`, `es.ts`, `fr.ts` — 统一 `app.name` 为 `Meguri`，把 Logo 文案收敛为 `logo.orange`。
- Modify: `src/i18n/__tests__/i18n.test.tsx` — 默认语言和持久化回归测试。
- Modify: `src/i18n/__tests__/locales.test.ts` — 保持全语言 key/插值校验，并增加品牌 key 断言。
- Modify: `docs/renderer.md` — 记录简体中文默认规则。

### 橙子品牌工作流

- Create: `shared/branding/orangeLogo.ts` — 唯一 SVG 和 data URL 源。
- Create: `logo/orange-logo.svg` — 与共享源一致的可审查静态 SVG。
- Create: `logo/orange-1024.png` — 由静态 SVG 生成、供发布图标转换使用的透明 PNG。
- Create: `src/branding/__tests__/orangeLogo.test.ts` — 资产和 Logo ID 回归测试。
- Create: `electron/core/__tests__/appLogoConfig.test.ts` — 新值、旧值和磁盘归一化测试。
- Modify: `shared/ipc/schema.ts` — `LOGO_IDS = ["orange"]`。
- Modify: `electron/core/appConfig.ts` — 默认值改为 orange，读取旧值后一次性原子写回规范值。
- Modify: `electron/core/portableRecovery.ts` — 沿用新的 Logo schema 解析遗留配置。
- Modify: `electron/core/logoAssets.ts` — 删除旧三组 base64，导出共享橙子 data URL。
- Modify: `electron/main.ts` — 窗口、托盘和 Dock 统一使用橙子资产。
- Modify: `electron/core/__tests__/portableRecovery.test.ts` — 旧 Logo 输入的恢复期望更新为 orange。
- Modify: `src/hooks/useLogo.ts` — 只引用橙子预览，默认值改为 orange。
- Modify: `src/hooks/__tests__/useLogo.test.tsx` — 移除旧变体场景并覆盖 orange 默认值。
- Modify: `src/routes/Settings/index.tsx` — 删除三选一 Logo picker，显示唯一的只读橙子品牌说明。
- Modify: `src/components/__tests__/WorkspaceRail.test.tsx` — 验证工作区栏渲染橙子 data URL。
- Modify: `docs/architecture.md` — 更新 Logo 架构说明。
- Modify: `docs/assets/icon.png`, `logo/app-*.png`, `logo/tray-*.png`, `build/icon.png`, `build/icon.ico`, `build/icon.icns` — 用同一橙子源更新文档、运行时备用和打包图标；若生成器不能写某个平台格式，验收记录明确列出未更新格式。

---

### Task 1: 建立中文用户手册和链接回归

**Files:**
- Create: `scripts/__tests__/user-guide.test.mjs`
- Create: `docs/user-guide-zh-CN.md`
- Modify: `README.md`
- Modify: `docs/index.html`

- [ ] **Step 1: Write the failing documentation-link test**

Add the following executable Node test. It intentionally names the required headings so a short但不完整的宣传页不能冒充使用手册：

```js
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
```

- [ ] **Step 2: Run the test and verify it fails for the missing guide**

Run: `node --test scripts/__tests__/user-guide.test.mjs`

Expected: FAIL because `docs/user-guide-zh-CN.md` does not exist yet.

- [ ] **Step 3: Write the complete user-facing guide**

Create `docs/user-guide-zh-CN.md` with these concrete sections and user actions:

1. `软件定位`: Meguri 是本地优先的视频、图片和音频库；说明只读取用户选择的媒体目录，应用数据单独保存在 `Data`。
2. `Windows 便携版目录`: explain `App` (program), `Data` (config/database/assets/backups/logs/temp), and `Media` (default media root), including copying the whole directory when moving drives.
3. `第一次使用`: launch, recovery page initialization if shown, click the left `+`, select a media folder, wait for background scan, and use header `Scan` after adding files.
4. `浏览、搜索和筛选`: grid/list, folder view, full-text search, kind/tag/rating/favorite/date filters, removable condition badges, and sort.
5. `播放视频、图片和音频`: detail modal/side peek, local streaming, resume position, unsupported codec via external player, image copy, audio bottom bar and spectrum settings.
6. `标签、评分、收藏和历史`: edit metadata in detail, tag autocomplete, ★ rating, favorite, scene bookmarks, history view, and the fact that identity survives moves/renames after a scan when supported by the current index.
7. `集合、稍后观看和播放列表`: distinguish hand-picked collections, Watch Later, smart collections/saved searches, Discovery, and hands-off playlist playback with shuffle/repeat/image timing.
8. `设置与快捷键`: default Chinese language, language switch, theme, zoom (`Ctrl` + wheel / `Ctrl` + `+` / `-` / `0`), list thumbnail size, hover preview, scene count, audio spectrum, and detail/player shortcuts that are visible in the app.
9. `备份、恢复和升级`: use recovery screen actions, keep `Data/backups`, do not delete `Data` while troubleshooting, use `App.new`/rollback procedure from README, and keep independent copies of important media.
10. `常见问题`: files missing after adding, moved files, no thumbnail, unsupported playback, app starts in recovery, how to exit to tray, and what uninstall does.

Use tables for directory layout and feature overview, short numbered steps for operations, and explicit “不会修改原媒体” safety notes. Do not claim cloud sync, online metadata, or a feature that is absent from the current UI/IPC.

- [ ] **Step 4: Add the two user-facing links and remove the old brand explanation**

Add this block near the introductory paragraph in `README.md`:

```md
> 中文用户：请先阅读 [简体中文使用文档](./docs/user-guide-zh-CN.md)，里面包含首次配置、主要功能和 Windows 便携版数据说明。
```

Replace the paragraph explaining the name as Japanese `巡り` with a neutral explanation that Meguri means revisiting and rediscovering one’s local media, without displaying the old Logo character. Add a second navigation link in `docs/index.html` beside the English guide:

```html
<a href="https://github.com/Orange1021/meguri/blob/main/docs/user-guide-zh-CN.md">简体中文使用文档</a>
```

- [ ] **Step 5: Run the documentation test and commit**

Run: `node --test scripts/__tests__/user-guide.test.mjs`

Expected: PASS with two subtests.

Commit: `git add docs/user-guide-zh-CN.md README.md docs/index.html scripts/__tests__/user-guide.test.mjs && git commit -m "docs: add Chinese user guide"`

### Task 2: Make Simplified Chinese the safe default without breaking language choice

**Files:**
- Modify: `src/i18n/__tests__/i18n.test.tsx`
- Modify: `src/i18n/I18nProvider.tsx`
- Modify: `src/i18n/locales/ja.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/ko.ts`
- Modify: `src/i18n/locales/es.ts`
- Modify: `src/i18n/locales/fr.ts`
- Modify: `src/i18n/__tests__/locales.test.ts`
- Modify: `docs/renderer.md`

- [ ] **Step 1: Change the default-language regression test first**

Update `src/i18n/__tests__/i18n.test.tsx` so the first test clears storage and expects the Chinese catalog, while the switching test proves a stored English preference remains authoritative:

```tsx
import { zhCN } from "@/i18n/locales/zh-CN";

it("defaults to Simplified Chinese when nothing is persisted", () => {
  localStorage.clear();
  const { result } = renderHook(() => useI18n(), { wrapper });
  expect(result.current.lang).toBe("zh-CN");
  expect(result.current.t("common.ok")).toBe(zhCN["common.ok"]);
});

it("honors a persisted supported language", () => {
  localStorage.setItem("meguri.lang", "en");
  const { result } = renderHook(() => useI18n(), { wrapper });
  expect(result.current.lang).toBe("en");
  localStorage.clear();
});
```

- [ ] **Step 2: Run the focused test and verify the old default fails**

Run: `npm run test:renderer -- src/i18n/__tests__/i18n.test.tsx`

Expected: FAIL at `expect(result.current.lang).toBe("zh-CN")` because the provider currently returns `"en"`.

- [ ] **Step 3: Implement the default and ordering change**

In `src/i18n/I18nProvider.tsx`, keep the existing storage validation and change only the fallback/order:

```tsx
export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
];

/** Determine the default language from saved preference, otherwise use Simplified Chinese. */
function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && LANGUAGES.some((language) => language.id === stored)) {
      return stored as Lang;
    }
  } catch {
    // ignore unavailable or restricted localStorage
  }
  return "zh-CN";
}
```

Keep `document.documentElement.lang`, `localStorage.setItem`, catalog fallback, and runtime `setLang` unchanged.

- [ ] **Step 4: Normalize application-name and Logo translation keys**

In all six locale files, change the `app.name` value to `"Meguri"`, change the stale comment that describes a single kanji, remove `logo.dark`, `logo.light`, and `logo.enso`, and add exactly one key:

```ts
"settings.logo": "应用图标",
"settings.logoDesc": "窗口、托盘和应用内统一使用橙子图标。",
"logo.orange": "橙子",
```

Use the equivalent translation in each non-Chinese catalog; keep `TranslationKey` defined by `ja.ts` and do not remove unrelated keys. Add to `src/i18n/__tests__/locales.test.ts`:

```ts
it("uses the Meguri brand and a single orange logo label", () => {
  for (const catalog of Object.values(catalogs)) {
    expect(catalog["app.name"]).toBe("Meguri");
    expect(catalog["logo.orange"]).toBeTruthy();
    expect("logo.dark" in catalog).toBe(false);
    expect("logo.light" in catalog).toBe(false);
    expect("logo.enso" in catalog).toBe(false);
  }
});
```

Update `docs/renderer.md` to state that the supported IDs remain `ja`, `en`, `es`, `fr`, `ko`, and `zh-CN`, and that `zh-CN` is the fallback only when no supported `meguri.lang` value exists.

- [ ] **Step 5: Run locale and provider tests and commit**

Run: `npm run test:renderer -- src/i18n/__tests__/i18n.test.tsx src/i18n/__tests__/locales.test.ts`

Expected: all provider and locale subtests PASS.

Commit: `git add src/i18n docs/renderer.md && git commit -m "feat: default the interface to Simplified Chinese"`

### Task 3: Introduce one shared orange SVG/data URL source

**Files:**
- Create: `shared/branding/orangeLogo.ts`
- Create: `logo/orange-logo.svg`
- Create: `src/branding/__tests__/orangeLogo.test.ts`
- Modify: `shared/ipc/schema.ts`

- [ ] **Step 1: Write the failing asset and schema test**

Create `src/branding/__tests__/orangeLogo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ORANGE_LOGO_DATA_URL,
  ORANGE_LOGO_SVG,
} from "@shared/branding/orangeLogo";
import { LOGO_IDS } from "@shared/ipc/schema";

describe("orange branding", () => {
  it("exposes a single orange SVG source without the old character", () => {
    expect(LOGO_IDS).toEqual(["orange"]);
    expect(ORANGE_LOGO_SVG).toContain("<svg");
    expect(ORANGE_LOGO_SVG).toContain("<circle");
    expect(ORANGE_LOGO_SVG).toContain("#f97316");
    expect(ORANGE_LOGO_SVG).toContain("#4d7c0f");
    expect(ORANGE_LOGO_SVG).not.toContain("巡");
  });

  it("encodes the same SVG for img and nativeImage consumers", () => {
    expect(ORANGE_LOGO_DATA_URL).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/,
    );
    expect(decodeURIComponent(ORANGE_LOGO_DATA_URL.split(",", 2)[1])).toBe(
      ORANGE_LOGO_SVG,
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:renderer -- src/branding/__tests__/orangeLogo.test.ts`

Expected: FAIL because the shared source and the `orange` Logo ID do not exist.

- [ ] **Step 3: Add the canonical SVG and ID**

Create `shared/branding/orangeLogo.ts` with no external font or image dependency. Give the root SVG both a `viewBox` and a `width="256" height="256"` intrinsic size so it renders predictably in `<img>` and in the icon-generation page:

```ts
export const ORANGE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title desc">
  <title id="title">Meguri orange</title>
  <desc id="desc">A round orange fruit with a green leaf</desc>
  <defs>
    <radialGradient id="fruit" cx="34%" cy="26%" r="78%">
      <stop offset="0" stop-color="#fdba74" />
      <stop offset="0.42" stop-color="#fb923c" />
      <stop offset="1" stop-color="#ea580c" />
    </radialGradient>
    <linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#365314" />
      <stop offset="1" stop-color="#84cc16" />
    </linearGradient>
  </defs>
  <circle cx="128" cy="139" r="91" fill="#9a3412" opacity="0.22" />
  <circle cx="128" cy="132" r="86" fill="url(#fruit)" stroke="#c2410c" stroke-width="5" />
  <path d="M76 103c25-24 55-31 85-18" fill="none" stroke="#fed7aa" stroke-linecap="round" stroke-width="8" opacity="0.48" />
  <path d="M94 171c22 14 55 18 79 4" fill="none" stroke="#c2410c" stroke-linecap="round" stroke-width="5" opacity="0.34" />
  <path d="M131 50c8-23 31-35 57-27-10 22-29 34-57 27Z" fill="url(#leaf)" stroke="#365314" stroke-width="4" stroke-linejoin="round" />
  <path d="M132 53c-8 15-14 25-25 34" fill="none" stroke="#365314" stroke-linecap="round" stroke-width="7" />
  <ellipse cx="91" cy="88" rx="25" ry="13" fill="#fff7ed" opacity="0.36" transform="rotate(-28 91 88)" />
</svg>`;

export const ORANGE_LOGO_DATA_URL =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ORANGE_LOGO_SVG)}`;
```

Set `LOGO_IDS` in `shared/ipc/schema.ts` to `['orange']` and update its comment to state that legacy `dark`, `light`, and `enso` values are accepted only as configuration input and normalize to orange in `appConfig.ts`.

Copy the exact SVG markup (without the TypeScript template literal) to `logo/orange-logo.svg` and add a comment in the TS source that the file is the reviewable static mirror.

- [ ] **Step 4: Run the asset test and commit**

Run: `npm run test:renderer -- src/branding/__tests__/orangeLogo.test.ts`

Expected: both branding subtests PASS.

Commit: `git add shared/branding shared/ipc/schema.ts logo/orange-logo.svg src/branding/__tests__/orangeLogo.test.ts && git commit -m "feat: add shared orange logo asset"`

### Task 4: Normalize legacy Logo values at configuration boundaries

**Files:**
- Create: `electron/core/__tests__/appLogoConfig.test.ts`
- Modify: `electron/core/appConfig.ts`
- Modify: `electron/core/portableRecovery.ts`
- Modify: `electron/core/__tests__/portableRecovery.test.ts`

- [ ] **Step 1: Write the failing config migration test**

Create a throwaway portable layout and assert both the returned config and the on-disk config are normalized:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureConfigStorage,
  loadConfig,
  saveConfig,
} from "../appConfig.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-logo-"));
const layout = {
  rootDir: root,
  appDir: path.join(root, "App"),
  dataDir: path.join(root, "Data"),
  mediaDir: path.join(root, "Media"),
  configPath: path.join(root, "Data", "config.json"),
  databasePath: path.join(root, "Data", "roots", "test", "db.sqlite"),
  assetsDir: path.join(root, "Data", "assets"),
  playlistsDir: path.join(root, "Data", "playlists"),
  backupsDir: path.join(root, "Data", "backups"),
  logsDir: path.join(root, "Data", "logs"),
  tempDir: path.join(root, "Data", "temp"),
};

afterEach(() => configureConfigStorage(undefined));

describe("Logo config compatibility", () => {
  it("maps legacy values to orange and persists the normalized value", () => {
    fs.mkdirSync(path.dirname(layout.configPath), { recursive: true });
    fs.writeFileSync(
      layout.configPath,
      JSON.stringify({
        formatVersion: 2,
        workspaces: [],
        activeWorkspaceId: null,
        collections: [],
        workspaceEmojis: {},
        update: { autoCheck: true, ignoredVersion: null, lastCheckAt: null },
        logo: "enso",
      }),
    );
    configureConfigStorage(layout);

    expect(loadConfig(layout).logo).toBe("orange");
    expect(JSON.parse(fs.readFileSync(layout.configPath, "utf8")).logo).toBe(
      "orange",
    );
  });

  it("uses orange when the config has no valid Logo value", () => {
    configureConfigStorage(layout);
    saveConfig({
      formatVersion: 2,
      workspaces: [],
      activeWorkspaceId: null,
      roots: [],
      activePath: null,
      collections: [],
      workspaceEmojis: {},
      update: { autoCheck: true, ignoredVersion: null, lastCheckAt: null },
      logo: "orange",
    }, layout);
    const raw = JSON.parse(fs.readFileSync(layout.configPath, "utf8"));
    raw.logo = "not-a-logo";
    fs.writeFileSync(layout.configPath, JSON.stringify(raw));
    expect(loadConfig(layout).logo).toBe("orange");
  });
});
```

- [ ] **Step 2: Run the core test and verify it fails**

Run: `node scripts/run-electron-vitest.mjs --project core electron/core/__tests__/appLogoConfig.test.ts`

Expected: FAIL because the default is `dark` and `loadConfig()` does not write the normalized value.

- [ ] **Step 3: Implement one-way normalization in `appConfig.ts`**

Change the constant and make `loadConfig()` write only when the parsed Logo differs from the raw value:

```ts
export const DEFAULT_LOGO: LogoId = "orange";

function parseLogo(value: unknown): LogoId {
  return LogoIdSchema.catch(DEFAULT_LOGO).parse(value);
}

export function loadConfig(layout?: PortableLayout): AppConfig {
  const storage = layout ?? configuredLayout;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(storage), "utf8")) as Record<
      string,
      unknown
    >;
    const parsed = parseConfig(raw, storage);
    if (raw.logo !== parsed.logo) saveConfig(parsed, storage);
    return parsed;
  } catch {
    return {
      formatVersion: 2,
      workspaces: [],
      activeWorkspaceId: null,
      roots: [],
      activePath: null,
      collections: [],
      workspaceEmojis: {},
      update: { ...DEFAULT_UPDATE_CONFIG },
      logo: DEFAULT_LOGO,
    };
  }
}
```

Because `LogoIdSchema` now contains only `orange`, both old IDs and unknown values fall through the same safe path. `saveConfig()` remains atomic and preserves the existing `App`/`Data` layout.

- [ ] **Step 4: Cover the portable recovery import path**

Keep `portableRecovery.ts` using `LogoIdSchema.catch(DEFAULT_LOGO).parse(raw.logo)`, change the existing fixture input from `dark` to `enso`, and assert the imported config contains `orange`. Do not add a second legacy mapping table.

- [ ] **Step 5: Run core compatibility tests and commit**

Run: `npm run test:core -- electron/core/__tests__/appLogoConfig.test.ts electron/core/__tests__/portableRecovery.test.ts`

Expected: the new Logo config tests and all portable-recovery tests PASS.

Commit: `git add electron/core/appConfig.ts electron/core/portableRecovery.ts electron/core/__tests__/appLogoConfig.test.ts electron/core/__tests__/portableRecovery.test.ts && git commit -m "fix: normalize legacy logo settings"`

### Task 5: Simplify renderer Logo usage to the single orange asset

**Files:**
- Modify: `src/hooks/useLogo.ts`
- Modify: `src/hooks/__tests__/useLogo.test.tsx`
- Modify: `src/routes/Settings/index.tsx`
- Modify: `src/components/WorkspaceRail.tsx`
- Modify: `src/components/__tests__/WorkspaceRail.test.tsx`

- [ ] **Step 1: Update the renderer tests before implementation**

In `useLogo.test.tsx`, replace every old ID with `orange`, change the initial fallback assertion to `orange`, and keep only behavior meaningful for one canonical value:

```tsx
it("falls back to orange until the initial fetch resolves", async () => {
  logoGet.mockResolvedValue("orange");
  const { result } = renderHook(() => useLogo(), { wrapper });
  expect(result.current.logo).toBe("orange");
  await waitFor(() => expect(result.current.logo).toBe("orange"));
});

it("does not send a mutation when the only value is selected again", async () => {
  logoGet.mockResolvedValue("orange");
  logoSet.mockImplementation((logo) => Promise.resolve(logo));
  const { result } = renderHook(() => useLogo(), { wrapper });
  await waitFor(() => expect(result.current.logo).toBe("orange"));
  act(() => result.current.setLogo("orange"));
  expect(logoSet).not.toHaveBeenCalled();
});
```

In `WorkspaceRail.test.tsx`, add after the existing workspace render assertion:

```tsx
expect(screen.getByAltText("Meguri")).toHaveAttribute(
  "src",
  expect.stringMatching(/^data:image\/svg\+xml;charset=utf-8,/),
);
```

- [ ] **Step 2: Run renderer tests and verify old-ID references fail type/test compilation**

Run: `npm run test:renderer -- src/hooks/__tests__/useLogo.test.tsx src/components/__tests__/WorkspaceRail.test.tsx`

Expected: FAIL or type-check because `dark`, `light`, and `enso` are no longer members of `LogoId` and the old asset imports remain.

- [ ] **Step 3: Make `useLogo` and the rail use the shared data URL**

Replace the three bitmap imports in `src/hooks/useLogo.ts` with:

```ts
import { ORANGE_LOGO_DATA_URL } from "@shared/branding/orangeLogo";

export const LOGO_SRC: Record<LogoId, string> = {
  orange: ORANGE_LOGO_DATA_URL,
};
```

Change `const logo = data ?? "dark"` to `const logo = data ?? "orange"`, update comments from “variant/picker” to “canonical application logo”, and retain the existing query/mutation rollback behavior so older renderer calls cannot corrupt cache state. `WorkspaceRail` continues to use `LOGO_SRC[logo]`, now with only the orange key.

- [ ] **Step 4: Replace the settings picker with a read-only brand card**

Remove `LOGO_IDS`, `LogoId`, `LOGO_LABELS`, `selectLogo`, and the `map()` button loop from `src/routes/Settings/index.tsx`. Keep `LOGO_SRC` and render this fixed card inside the existing settings section:

```tsx
<div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
  <img
    src={LOGO_SRC.orange}
    alt={t("logo.orange")}
    className="size-12 rounded-md"
    draggable={false}
  />
  <span className="text-sm text-fg">{t("logo.orange")}</span>
</div>
```

The section remains accessible and explains that window, tray, and in-app icons are unified; it no longer presents a control that cannot produce a different result.

- [ ] **Step 5: Run focused renderer tests and commit**

Run: `npm run test:renderer -- src/hooks/__tests__/useLogo.test.tsx src/components/__tests__/WorkspaceRail.test.tsx src/i18n/__tests__/locales.test.ts`

Expected: all focused renderer tests PASS and no old asset import remains under `src/`.

Commit: `git add src/hooks src/routes/Settings/index.tsx src/components/WorkspaceRail.tsx src/components/__tests__/WorkspaceRail.test.tsx && git commit -m "feat: use the orange logo throughout the renderer"`

### Task 6: Replace Electron runtime icons and publish static icon formats

**Files:**
- Modify: `electron/core/logoAssets.ts`
- Modify: `electron/main.ts`
- Create: `scripts/render-orange-icon.mjs`
- Modify: `docs/architecture.md`
- Modify: `docs/assets/icon.png`
- Modify: `logo/app-32.png`, `app-64.png`, `app-128.png`, `app-256.png`, `app-512.png`, `appicon-1024.png`
- Modify: `logo/tray-16.png`, `tray-32.png`, `tray-64.png`, `tray-256.png`
- Modify: `build/icon.png`, `build/icon.ico`, `build/icon.icns`

- [ ] **Step 1: Add a repeatable SVG-to-PNG helper before changing binaries**

Create `scripts/render-orange-icon.mjs` using the already-installed Playwright Chromium and the static SVG file:

```js
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(resolve(root, "logo/orange-logo.svg"), "utf8");
const output = resolve(root, "logo/orange-1024.png");
await mkdir(dirname(output), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  await page.locator("svg").evaluate((node) => {
    node.setAttribute("width", "1024");
    node.setAttribute("height", "1024");
  });
  await page.locator("svg").screenshot({ path: output, omitBackground: true });
} finally {
  await browser.close();
}
```

Run: `node scripts/render-orange-icon.mjs`

Expected: `logo/orange-1024.png` is created and visually contains the same circular orange fruit as `logo/orange-logo.svg`.

- [ ] **Step 2: Replace `logoAssets.ts` with the shared runtime data URL**

Replace the 100KB legacy module with:

```ts
// The renderer and the main process share this canonical SVG so the tray,
// window, Dock, settings preview, and workspace rail cannot drift apart.
export { ORANGE_LOGO_DATA_URL } from "../../shared/branding/orangeLogo.js";
```

Update `electron/main.ts` to import `ORANGE_LOGO_DATA_URL`, make both helpers call `nativeImage.createFromDataURL(ORANGE_LOGO_DATA_URL)`, and remove the old base64 record lookups. Keep the `applyLogo` callback signature required by `IpcContext`, but ignore its now-canonical parameter:

```ts
function trayImage(): Electron.NativeImage {
  return nativeImage.createFromDataURL(ORANGE_LOGO_DATA_URL);
}

function windowImage(): Electron.NativeImage {
  return nativeImage.createFromDataURL(ORANGE_LOGO_DATA_URL);
}

function applyLogo(_logo: LogoId): void {
  tray?.setImage(trayImage());
  if (process.platform === "darwin") {
    app.dock?.setIcon(windowImage());
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIcon(windowImage());
  }
}
```

Set `icon: windowImage()` on `BrowserWindow` creation and construct the tray with `new Tray(trayImage())`; remove the conditional that skipped the default logo. On macOS, set the Dock icon once after tray creation regardless of config value.

- [ ] **Step 3: Generate and install the static formats**

Use `logo/orange-1024.png` as the source for the existing app/tray sizes and `docs/assets/icon.png`/`build/icon.png`. Run the repository-documented builder for multi-size package formats:

```powershell
npx --yes electron-icon-builder --input=logo/orange-1024.png --output=build
```

Copy the generated multi-size `build/icon.ico` and `build/icon.icns` into the existing fixed paths, and use the generated PNG at the existing `build/icon.png`. Resize/copy the same image into the `logo/app-*.png` and `logo/tray-*.png` names using the builder’s generated PNG outputs. Do not retain or import the old light/enso asset directories in application code; leave any historical files only if deleting them would be outside this request, and verify no runtime reference remains.

- [ ] **Step 4: Update architecture notes**

Replace the old three-variant paragraph in `docs/architecture.md` with a statement that `shared/branding/orangeLogo.ts` owns the SVG/data URL, `electron/core/logoAssets.ts` re-exports it for main, `logo` config values normalize to `orange`, and the renderer displays the same source in Settings and the workspace rail.

- [ ] **Step 5: Run runtime checks and commit**

Run: `npm run typecheck`

Expected: all three TypeScript projects pass.

Run: `rg -n "logo/(light|enso)|app-256\.png|TRAY_ICON_BASE64|WINDOW_ICON_BASE64|logo\.dark|logo\.light|logo\.enso|巡" src electron shared docs README.md -g '!docs/user-guide-zh-CN.md' -g '!**/*.test.*' -g '!docs/superpowers/**'`

Expected: no old runtime asset import, old Logo label, or old brand character remains; the only allowed legacy strings are explicit migration-test inputs and the documented compatibility note.

Commit: `git add electron/core/logoAssets.ts electron/main.ts scripts/render-orange-icon.mjs docs/architecture.md logo docs/assets/icon.png build && git commit -m "feat: replace the application branding with an orange logo"`

### Task 7: Full verification and Windows portable acceptance

**Files:**
- Verify: all files changed by Tasks 1–6.
- Verify: `release/Meguri-0.8.0-win32-x64.exe` or the newly generated portable artifact path reported by electron-builder.

- [ ] **Step 1: Run focused tests for all three workflows**

Run:

```powershell
node --test scripts/__tests__/user-guide.test.mjs
npm run test:renderer -- src/i18n/__tests__/i18n.test.tsx src/i18n/__tests__/locales.test.ts src/branding/__tests__/orangeLogo.test.ts src/hooks/__tests__/useLogo.test.tsx src/components/__tests__/WorkspaceRail.test.tsx
npm run test:core -- electron/core/__tests__/appLogoConfig.test.ts electron/core/__tests__/portableRecovery.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run repository regression suites**

Run: `npm run typecheck; npm run test:core; npm run test:renderer`

Expected: typecheck and both test projects PASS. If the repository-wide lint baseline still reports unrelated pre-existing problems, record the exact count and confirm that all touched files pass targeted lint rather than claiming a clean full lint.

- [ ] **Step 3: Build the app and package Windows portable output**

Run: `npm run build; npm run dist -- --win portable`

Expected: Electron build and Windows portable packaging complete, with the generated artifact containing the updated `build/icon.ico` and runtime bundle.

- [ ] **Step 4: Perform a portable Windows smoke test**

In a temporary directory under `D:\Projects\PortableVideoLibrary\work\orange-brand-smoke`, place the generated portable executable and launch it. Verify:

1. With no `meguri.lang` preference, the first visible UI is Simplified Chinese.
2. The left workspace rail, window/taskbar, tray, and Settings preview show the same orange fruit icon.
3. Settings still opens, language can switch to English, and after restart the selected language remains.
4. A legacy config containing `logo: "enso"` starts successfully and is rewritten as `logo: "orange"`.
5. Adding a temporary media folder scans and displays files; closing the window hides to tray according to the existing behavior.

Keep the smoke-test media and data outside the repository’s real `Data` or `Media` directories, then remove only that exact temporary smoke-test directory after capturing the result.

- [ ] **Step 5: Review the final diff and report evidence**

Run: `git status --short; git diff --check; git log -6 --oneline`

Expected: no unintended changes, no whitespace errors, and separate commits for the guide, language default, shared asset, config compatibility, renderer, and runtime icon work. Report test commands, portable artifact path, and any pre-existing lint limitation.

## Self-review checklist

- **Spec coverage:** Task 1 covers the complete Chinese manual and both links; Task 2 covers default language, persistence, all locale key sets, and brand text; Tasks 3–6 cover a single orange source, renderer/main usage, old config normalization, settings UX, static assets, and architecture notes; Task 7 covers the requested tests, build, and Windows behavior.
- **Placeholder scan:** the plan contains no unresolved implementation markers or unspecified “appropriate handling” steps. Every code-changing task includes the exact file, test command, expected result, and representative code.
- **Type consistency:** `LogoId` is `"orange"` from Task 3 onward; `LOGO_SRC.orange`, `DEFAULT_LOGO`, `logo_get`, config persistence, and renderer tests all use the same value. `IpcContext.applyLogo(logo: LogoId)` remains compatible while `main.ts` deliberately ignores the canonical parameter.
- **Scope:** no task changes media scanning, SQLite schema, playback protocol, or portable upgrade semantics.
