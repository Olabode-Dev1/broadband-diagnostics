import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the broadband diagnostics sign-in screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Broadband Diagnostics/i);
  assert.match(html, /MTN and Airtel broadband diagnostics/i);
  assert.match(html, /ZLT X17U/i);
  assert.match(html, /Connect your router/i);
  assert.match(html, /Router password/i);
  assert.match(html, /Open live dashboard/i);
  assert.match(html, /router session only/i);
  assert.match(html, /every 5 seconds/i);
  assert.match(html, /RSRP.*RSRQ.*SINR.*CQI/i);
  assert.doesNotMatch(html, /Sylva|living world|inner-green|ecostove|ethos/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|SkeletonPreview/i);
});

test("keeps adapter boundaries and product metadata in source", async () => {
  const [page, layout, adapter, css, packageJson, skill] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/lib/router-adapters/x17u.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../SKILL.md", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /title:\s*"Broadband Diagnostics"/);
  assert.match(page, /plannedAdapters/);
  assert.match(page, /Local history/);
  assert.match(page, /Most likely cause/);
  assert.match(page, /LinkPath/);
  assert.match(page, /WifiPanel/);
  assert.match(page, /ClientsPanel/);
  assert.match(page, /activeAccessLabel/);
  assert.match(page, /SignalMap/);
  assert.match(page, /RouterSessionState/);
  assert.match(page, /SESSION_STORAGE_KEY/);
  assert.match(page, /AUTO_SYNC_MS/);
  assert.match(page, /syncRouter/);
  assert.match(page, /Sign in and start sync/);
  assert.match(page, /How your internet is connected/);
  assert.match(css, /\.signal-map/);
  assert.match(css, /\.sync-toggle/);
  assert.match(adapter, /cmd:\s*232/);
  assert.match(adapter, /cmd:\s*100/);
  assert.match(adapter, /cmd:\s*205/);
  assert.match(adapter, /cmd:\s*223/);
  assert.match(adapter, /cmd:\s*224/);
  assert.match(adapter, /cmd:\s*225/);
  assert.match(adapter, /cmd:\s*80/);
  assert.match(adapter, /readX17USnapshotWithSession/);
  assert.match(adapter, /station_list/);
  assert.match(adapter, /system_status/);
  assert.match(adapter, /web_signal/);
  assert.match(adapter, /application\/json/);
  assert.match(adapter, /rootIsNull/);
  assert.match(adapter, /sha256\(token \+ credentials\.password\)/);
  assert.match(adapter, /findStringDeep/);
  assert.match(adapter, /login_token/);
  assert.match(adapter, /Check that the router address is the X17U admin address/);
  assert.match(skill, /visual reference only/i);
  assert.match(skill, /do not copy/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(
    `${page}\n${css}\n${skill}`,
    /SylvaHero|inner-green-3d|card-ecostove|card-ethos|living world/i,
  );
});

test("does not keep the copied Sylva landing page or assets", async () => {
  const removedFiles = [
    "../public/landing-pages/inner-green-3d.html",
    "../public/landing-pages/inner-green-assets/three.min.js",
    "../public/landing-pages/inner-green-assets/lexend-latin.woff2",
    "../public/landing-pages/inner-green-assets/card-ecostove.jpg",
    "../public/landing-pages/inner-green-assets/card-ethos.jpg",
    "../app/effects/sylva-hero/SylvaHero.tsx",
    "../app/effects/sylva-hero/styles.css",
  ];

  for (const file of removedFiles) {
    await assert.rejects(readFile(new URL(file, import.meta.url)), {
      code: "ENOENT",
    });
  }
});
