// yt-runner-socks5.js
const { chromium } = require("playwright");
const { getUniqueWorkingProxy, releaseProxy } = require("./proxyManager2");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { setTimeout: delay } = require("timers/promises");

const shortsLinks = [
//   'https://www.youtube.com/watch?v=O-Ndwh7XqAc',
//   'https://www.youtube.com/watch?v=aj3ps3Y5je4',
//   'https://www.youtube.com/watch?v=WrpPMZ5hw38',
//   'https://www.youtube.com/watch?v=zyAthTW8Wdg',
//   'https://www.youtube.com/watch?v=s1sAFi0jJcY',
//   'https://www.youtube.com/watch?v=lfsvE5639CY'
        'http://127.0.0.1:5020/'
];

// Human-like scrolling
async function humanScroll(page, durationMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    try {
      const scrollY = Math.floor(Math.random() * 400) + 100;
      await page.mouse.wheel(0, scrollY);
      await delay(1000 + Math.random() * 1500);
    } catch (e) {
      if (/Target closed/i.test(e.message)) break;
    }
  }
}

// Apply SOCKS5 or HTTP proxy to a new page using page route
async function applyProxyToPage(context, proxy) {
  const page = await context.newPage();

  const agent = new SocksProxyAgent(proxy);

  await page.route("**/*", async (route, request) => {
    try {
      const response = await fetch(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postData(),
        agent,
      });

      const body = await response.text();
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body,
      });
    } catch {
      await route.abort("failed");
    }
  });

  return page;
}

// Main runner
(async () => {
  const workerId = "YT-RUNNER";
  const logger = console;

  logger.log("🚀 Starting YouTube Shorts Runner with SOCKS5/HTTP Proxies...");

  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox","--ignore-certificate-errors", // ✅ bypass “Not Secure” errors
    "--disable-web-security",
    "--allow-insecure-localhost",
    "--ignore-ssl-errors=yes",] });
  const context = await browser.newContext();

  while (true) {
    const proxy = await getUniqueWorkingProxy(workerId, logger);
    if (!proxy) {
      logger.warn("⚠️ No proxy available, waiting 30s...");
      await delay(30000);
      continue;
    }

    logger.log(`🌐 Using proxy for this batch: ${proxy}`);

    try {
      for (const link of shortsLinks) {
        const page = await applyProxyToPage(context, proxy);
        try {
            await page.goto(link, {
                waitUntil: "networkidle", // waits for all network requests to finish
                timeout: 60000,
            });

            await page.waitForTimeout(3000);

            // ✅ Check if video elements exist
            const hasVideo = await page.$("video");
            const hasThumbnail = await page.$("img");

            if (hasVideo || hasThumbnail) {
                logger.log(`✅ Watching: ${link} (Media loaded)`);
            } else {
                logger.warn(`⚠️ Page loaded but no media elements found — proxy might block media`);
            }

            // optional: let it play
            await page.evaluate(() => {
                const video = document.querySelector("video");
                if (video) {
                video.muted = true;
                video.play().catch(() => {});
                }
            });

            // watch for 1 minute
            await delay(60000);
            } catch (err) {
            logger.error(`❌ Failed to open or load video: ${err.message}`);
            }
            finally {
                try {
                    await page.close({ runBeforeUnload: true });
                } catch {}
            }
      }

      logger.log("✅ Finished one proxy batch. Rotating...");
    } catch (err) {
      logger.error(`💥 Proxy batch error: ${err.message}`);
    } finally {
      releaseProxy(proxy, logger);
      logger.log("🔄 Waiting 15s before new proxy batch...");
      await delay(15000);
    }
  }
})();
