import path from "node:path";
import { expect, test } from "./fixtures/app";
import { fileCard, waitForIdle, waitForIndexedMedia } from "./fixtures/helpers";

const VIDEO_MEDIA_ROOT = path.join(process.cwd(), "e2e/fixtures/video-media");

test.use({ mediaRoot: VIDEO_MEDIA_ROOT });

test("plays a real MP4 with decoded video frames", async ({ window }) => {
  await waitForIndexedMedia(window, "flower.mp4");
  await waitForIdle(window);

  const card = fileCard(window, "flower.mp4");
  await card.locator("[data-thumb]").click();

  const dialog = window.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const video = dialog.locator("video");
  await expect(video).toBeVisible();

  await expect
    .poll(
      () =>
        video.evaluate((element) => (element as HTMLVideoElement).readyState),
      {
        timeout: 60_000,
      },
    )
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(
      () =>
        video.evaluate((element) => (element as HTMLVideoElement).videoWidth),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        video.evaluate((element) => (element as HTMLVideoElement).videoHeight),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  const initialTime = await video.evaluate(
    (element) => (element as HTMLVideoElement).currentTime,
  );
  await expect
    .poll(
      () =>
        video.evaluate((element) => (element as HTMLVideoElement).currentTime),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(initialTime + 0.1);
  await expect(
    dialog.getByText("Could not play in the built-in player.", {
      exact: true,
    }),
  ).toHaveCount(0);
});
