// (Full modified script — kept your logic & comments; lifecycle manager & health checks added)

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('sourceurl');
const UserAgent = require('user-agents');
const { faker } = require('@faker-js/faker');
const fs = require('fs');
const axios = require('axios');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const path = require('path');
const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
const { execSync } = require('child_process');
const treeKill = require('tree-kill');
const { getUniqueWorkingProxy, releaseProxy } = require('./proxyManager');
const useProxy = require("@lem0-packages/puppeteer-page-proxy");

stealth.enabledEvasions.delete('chrome.app');
stealth.enabledEvasions.delete('chrome.csi');
stealth.enabledEvasions.delete('chrome.loadTimes');
stealth.enabledEvasions.delete('chrome.runtime');

puppeteer.use(StealthPlugin());

let current = Math.floor(Math.random() * 4270);

const insuranceDomains = require('./domains/insurance');
const healthDomains = require('./domains/health');
const educationDomains = require('./domains/education');
const businessDomains = require('./domains/business');

let browser = null; // NOTE: this variable will be set per worker; we keep this here for compatibility

const categories = ['insurance', 'health', 'education', 'business'];
const categoryDomains = {
  insurance: insuranceDomains,
  health: healthDomains,
  education: educationDomains,
  business: businessDomains,
};

const iPhone13Pro = {
  name: 'iPhone 13 Pro',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  viewport: {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    isLandscape: false
  }
};

const Pixel7 = {
  name: 'Pixel 7',
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  viewport: {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    isLandscape: false
  }
};

const GalaxyS20 = {
  name: 'Galaxy S20',
  userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G980F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  viewport: {
    width: 360,
    height: 800,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    isLandscape: false
  }
};

function getRandomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCookies(category) {
  const domain = getRandomFromArray(categoryDomains[category]);
  const now = Math.floor(Date.now() / 1000);
  const oneYearLater = now + 60 * 60 * 24 * 365;

  const baseCookies = [
    {
      name: 'interest',
      value: category,
      domain,
      path: '/',
      expirationDate: oneYearLater,
      sameSite: 'Lax',
      httpOnly: false,
      secure: false,
      session: false,
      storeId: '0',
    },
    {
      name: 'session_id',
      value: faker.string.uuid(),
      domain,
      path: '/',
      sameSite: 'Lax',
      httpOnly: true,
      secure: true,
      session: true,
      storeId: '0',
    },
  ];

  const extraCookies = {
    insurance: { name: 'policy_num', value: 'PN-' + faker.number.int({ min: 100000, max: 999999 }) },
    health: { name: 'health_session', value: faker.string.alphanumeric(24) },
    education: { name: 'edu_user', value: faker.internet.username() },
    business: { name: 'biz_visitor', value: faker.string.uuid() },
  };

  const extra = extraCookies[category];
  if (extra) {
    baseCookies.push({
      ...extra,
      domain,
      path: '/',
      expirationDate: oneYearLater,
      sameSite: 'Lax',
      secure: true,
      session: category !== 'health',
      httpOnly: category === 'health',
      storeId: '0',
    });
  }
  return baseCookies;
}

function getCustomUserAgent() {
  const isMobile = Math.random() < 0.65;
  return new UserAgent({ deviceCategory: isMobile ? 'mobile' : 'desktop' }).toString();
}

async function humanScroll(page, minTime = 5000, maxTime = 10000) {
  if (page.isClosed()) return;
  await page.waitForFunction(() => document && document.documentElement !== null);

  const repeatCount = Math.floor(Math.random() * 2) + 2;

  for (let pass = 0; pass < repeatCount; pass++) {
    let hasMore = true;
    while (hasMore) {
      hasMore = await page.evaluate(() => {
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        window.scrollBy(0, clientHeight / 4);
        return scrollTop + clientHeight < scrollHeight;
      });
      await new Promise(r => setTimeout(r, Math.random() * 300 + 200));
    }

    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, -window.innerHeight / 4));
      await new Promise(r => setTimeout(r, Math.random() * 300 + 200));
    }
  }

  await new Promise(r => setTimeout(r, Math.random() * (maxTime - minTime) + minTime));
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getAgent(proxy) {
  if (!proxy) throw new Error('Proxy is undefined!');
  if (proxy.startsWith('http://')) return new HttpProxyAgent(proxy);
  if (proxy.startsWith('https://')) return new HttpsProxyAgent(proxy);
  if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) return new SocksProxyAgent(proxy);
  throw new Error('Unsupported proxy type: ' + proxy);
}

function makeLogger(workerId) {
  return {
    log: (...args) => console.log(`WORKER-${workerId}:`, ...args),
    warn: (...args) => console.warn(`WORKER-${workerId}:`, ...args),
    error: (...args) => console.error(`WORKER-${workerId}:`, ...args),
  };
}

async function clearPageData(page) {
  try {
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    await page.evaluate(() => localStorage.clear());
  } catch {}
}

// ---------------- SAFE BROWSER CLOSE ----------------
async function safeCloseBrowser(browserRef, logger) {
  if (!browserRef) return;

  try {
    const proc = browserRef.process?.();
    if (!proc || !proc.pid) {
      logger.log('✅ Browser has no PID, skipping force kill');
      return;
    }

    try {
      await browserRef.close(); // try graceful
      logger.log('✅ browser.close() called');
    } catch (err) {
      logger.warn('⚠️ browser.close() threw:', err.message || err);
    }

    // Force kill entire process tree
    treeKill(proc.pid, 'SIGKILL', (err) => {
      if (err) logger.error('❌ Failed to kill browser tree:', err.message || err);
      else logger.log(`💀 Successfully killed browser PID ${proc.pid} and all children`);
    });
  } catch (err) {
    logger.error('❌ safeCloseBrowser error:', err.message || err);
  }
}
// ---------------------------------------------------

// ---------------- CHECK IF BROWSER IS ALIVE ----------------
function isBrowserAlive(browserRef) {
  if (!browserRef) return false;
  try {
    const proc = typeof browserRef.process === 'function' ? browserRef.process() : null;
    if (!proc || !proc.pid) return false;
    process.kill(proc.pid, 0); // throws if process not alive
    return true;
  } catch (err) {
    return false;
  }
}
// ---------------------------------------------------

// ensure only a single page (tab) remains open
async function ensureSinglePage(browserRef, logger) {
  try {
    const pages = await browserRef.pages();
    if (pages.length > 1) {
      logger.warn(`⚠️ Found ${pages.length} tabs — closing extras`);
      for (let i = 1; i < pages.length; i++) {
        try { await pages[i].close({ runBeforeUnload: true }); } catch (e) { /* ignore */ }
      }
    }
    return (await browserRef.pages())[0];
  } catch (e) {
    logger.warn('⚠️ ensureSinglePage failed:', e.message || e);
    return null;
  }
}

// safe goto helper (retry once, wait 5s before retry) — fixed to actually wait
async function safeGoto(page, logger, url, timeout = 60000, retry = true) {
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout });
    const status = response ? response.status() : null;

    if (status && status >= 400) {
      logger.warn(`⚠️ HTTP ${status} error while visiting ${url}`);

      // Screenshot or log page title for debugging
      try {
        const title = await page.title();
        logger.warn(`⚠️ Error page title: ${title}`);
      } catch {}

      if (retry) {
        logger.warn('🔁 Retrying after HTTP error...');
        await delay(5000);

        const retryResponse = await page.goto(url, { waitUntil: 'networkidle2', timeout });
        const retryStatus = retryResponse ? retryResponse.status() : null;

        if (retryStatus && retryStatus >= 400) {
          logger.error(`❌ Retry failed (HTTP ${retryStatus}) for ${url}`);
          return false;
        } else {
          logger.log(`✅ Retry successful for: ${url}`);
          await delay(10000);
          return true;
        }
      } else {
        return false;
      }
    }

    logger.log(`✅ Navigated to: ${url} (status: ${status})`);
    await delay(10000); // small post-load wait
    return true;
  } catch (e) {
    logger.warn(`⚠️ Navigation error for ${url}: ${e.message || e}`);

    const retryable =
      /net::ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|Navigation timeout|ERR_SOCKS_CONNECTION_FAILED|ERR_CONNECT_TIMEOUT|Target closed/i.test(
        e.message || ''
      );

    if (retry && retryable) {
      logger.warn('🔁 Retrying navigation in 5 seconds...');
      await delay(5000);

      try {
        const retryResponse = await page.goto(url, { waitUntil: 'networkidle2', timeout });
        const retryStatus = retryResponse ? retryResponse.status() : null;

        if (retryStatus && retryStatus >= 400) {
          logger.error(`❌ Retry failed (HTTP ${retryStatus}) for ${url}`);
          return false;
        }

        logger.log(`✅ Retry successful for: ${url}`);
        await delay(10000);
        return true;
      } catch (e2) {
        logger.error(`❌ Retry failed (${url}): ${e2.message || e2}`);
        return false;
      }
    }

    return false;
  }
}


// visitRandomTechnologymaniasLinks (kept your logic; uses safeGoto)
async function visitRandomTechnologymaniasLinks(page, browserRef, logger) {
  const repeatCount = getRandomInt(7, 15);
  let visitCount = 0;
  logger.log(`🔁 Visiting up to ${repeatCount} technologymanias.com links`);

  for (let i = 0; i < repeatCount; i++) {
    logger.log(`\n➡️ Iteration ${i + 1}/${repeatCount} starting...`);

    // collect links on the page that match your pattern
    let links = [];
    try {
      links = await page.$$eval('a', anchors =>
        anchors
          .filter(a => a.offsetParent !== null && a.href && a.href !== '#' && a.href.startsWith('https://insurance.technologymanias.com'))
          .map(a => a.href)
      );
    } catch (e) {
      logger.warn('⚠️ Error extracting links:', e.message || e);
    }

    logger.log(`🔗 Found ${links.length} valid technologymanias.com links`);

    if (links.length) {
      const randomLink = getRandomFromArray(links);
      logger.log(`🎯 Navigating to: ${randomLink}`);

      try {
        const ok = await safeGoto(page, logger, randomLink, 60000, true);
        if (!ok) {
          logger.error('❌ Bing navigation failed after retry — stopping this browser.');
          await safeCloseBrowser(browserRef, logger);
          await delay(5000);
          return; // stop this worker cycle
        }
        logger.log(`✅ Navigated to: ${page.url()}`);
        visitCount++;
        logger.log(`✅ Loading Ads `);

        // Wait for AdSense script to load
        await page.waitForSelector('ins.adsbygoogle', { timeout: 20000 }).catch(() => {});

        try {
          // Force ad to render
          await page.evaluate(() => {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
          });
        } catch (e) {
          logger.log('📜 Ad loaded...');
        }

        await page.waitForFunction(
          () => document.readyState === 'complete',
          { timeout: 1200000 }
        );
      } catch (e) {
        logger.warn(`⚠️  Navigation error: ${e.message || e}`);
      }

      logger.log(`📜 Scrolling on page...`);
      await humanScroll(page, 5000, 10000);

      if (visitCount % 7 === 0) {
      logger.log('🖱️ 10th visit reached — clicking AdSense ad...');
      try {
        const adSelector = 'ins.adsbygoogle';
        await page.waitForSelector(adSelector, { timeout: 10000 });

        const adBox = await page.$eval(adSelector, el => {
          const rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });

        const clickX = adBox.x + adBox.width / 2;
        const clickY = adBox.y + adBox.height / 2;

        const pagesBefore = await browserRef.pages();

        await page.mouse.move(clickX, clickY);
        await page.mouse.click(clickX, clickY, { button: 'left' });
        logger.log('🖱️ Clicked AdSense ad');

        // 🕒 Wait briefly to detect a new tab
        await delay(4000);

        const pagesAfter = await browserRef.pages();
        const newPage = pagesAfter.find(p => !pagesBefore.includes(p));

        // CASE 1️⃣: New tab opened
        if (newPage) {
          logger.log('🆕 New tab detected for ad — applying proxy...');
          try { await newPage.setRequestInterception(false); } catch {}

          try {
            if (typeof useProxy === 'function' && proxy) {
              await useProxy(newPage, proxy);
            }
          } catch (proxyErr) {
            logger.warn(`⚠️ Proxy not applied on ad tab: ${proxyErr.message}`);
          }

          await newPage.bringToFront();
          logger.log('🌐 Waiting 60s and scrolling ad tab...');
          await humanScroll(newPage, 5000, 60000);
          await delay(60000);

          try { await newPage.close({ runBeforeUnload: true }); } catch {}
          logger.log('✅ Ad tab closed, continuing visits...');
        }

        // CASE 2️⃣: No new tab — same tab redirect
        else {
          logger.log('↪️ Ad clicked but no new tab detected — handling redirect on same page');
          await delay(5000);

          try {
            await humanScroll(page, 5000, 60000);
            await delay(60000);
            logger.log('✅ Finished ad visit on same page, going back...');
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch (backErr) {
            logger.warn(`⚠️ Could not return from ad page: ${backErr.message}`);
          }
        }
      } catch (err) {
        if (!/Session closed|Request is already handled/i.test(err.message)) {
          logger.warn('⚠️ Failed to click ad or process new tab:', err.message || err);
        }
      }

      }

      const delayTime = Math.random() * 10000 + 20000;
      logger.log(`⏱️  Waiting ${Math.round(delayTime / 1000)} seconds before next iteration...`);
      await delay(delayTime);
    } else {
      logger.warn('🚫 No valid technologymanias.com links found on this page.');
    }
  }
}

// === MAIN worker loop: keep your logic but robust lifecycle handling ===
async function runWorkerLoop(workerId) {
  //  try {
  //       execSync("ps -ef | grep '[c]hrome' | awk '{print $2}' | xargs -r kill -9");
  //       console.log('✅ Cleared old Chrome processes');
  //     } catch (err) {
  //       console.log('⚠️ No Chrome processes to clear or error occurred');
  //     }
  const logger = makeLogger(workerId);
  let localBrowser = null;
  let localPage = null;

  // Launch browser for this worker
  localBrowser = await puppeteer.launch({
    // userDataDir: '/tmp/puppeteer_profile',
    headless: true,
    args: [
      // `--proxy-server=${proxy}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      '--disable-gpu',
    ],
  });

  logger.log('🟢 Browser launched for worker', workerId);

  while (true) {
    try {
      
      // read keywords
      const KeyLines = fs.readFileSync('key.txt', 'utf-8')
        .split('\n').map(line => line.trim()).filter(Boolean);

      const keyword = getRandomFromArray(KeyLines);
      logger.log(`🧠 Selected keyword: ${keyword}`);

      proxy = await getUniqueWorkingProxy(workerId, logger);
      if (!proxy) {
        logger.error(`WORKER-${workerId}: 🚫 No valid proxy available`);
        await localPage.close();
        return;
      }

      const userAgent = getCustomUserAgent();
      const category = getRandomFromArray(categories);
      const cookies = generateCookies(category);

      logger.log(`🧠 Selected category: ${category}`);
      logger.log(`🕵️‍♂️ Using User-Agent: ${userAgent}`);
      logger.log(`🌐 Launching browser with proxy: ${proxy}`);

      // If previous browser exists and is still alive, close it first
      // if (localBrowser && isBrowserAlive(localBrowser)) {
      //   logger.warn('⚠️ Previous browser still alive — closing it before launch');
      //   await safeCloseBrowser(localBrowser, logger);
      // }

      // store in top-level variable too (keeps compatibility with existing spots expecting `browser`)
      browser = localBrowser;

      logger.log('🧭 Opening new page...');
      // small wait to avoid "Requesting main frame too early"
      await delay(500);

      // create page and ensure only one page exists
      localPage = await localBrowser.newPage();
      await delay(500);
      await useProxy(localPage, proxy);
      await delay(500);
      // await localPage.setRequestInterception(true);
      //   localPage.on('request', async (request) => {
      //       await useProxy(request, 'http://138.68.60.8:8080');
      //   });

      // const data = await useProxy.lookup(localPage);
      // console.log(data.ip);

      await clearPageData(localPage);
      

      // ensure single tab — close extras if any popped
      // try {
      //   localPage = await ensureSinglePage(localBrowser, logger);
      // } catch (e) {
      //   logger.warn('⚠️ ensureSinglePage failed after launch:', e.message || e);
      // }

      if (!localPage) {
        logger.error('❌ Could not create page; closing browser and retrying');
        // await safeCloseBrowser(localBrowser, logger);
        await delay(3000);
        continue; // restart worker loop to launch fresh browser
      }

      await localPage.setUserAgent(userAgent);

      // attach page error handlers
      localPage.on('error', async (err) => {
        logger.error('❌ Page error event:', err && err.message ? err.message : err);
      });
      localPage.on('pageerror', (err) => {
        logger.warn('⚠️ Page runtime error:', err && err.message ? err.message : err);
      });
      localPage.on('close', () => {
        logger.warn('⚠️ Page closed event triggered');
      });

      // --- Mobile device emulation ---
      const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
      if (isMobile) {
        const mobileDevices = [iPhone13Pro, Pixel7, GalaxyS20];
        const selectedDevice = mobileDevices[Math.floor(Math.random() * mobileDevices.length)];

        await localPage.emulate(selectedDevice);
        logger.log(`📱 Emulating mobile device: ${selectedDevice.name}`);
      } else {
        await localPage.setViewport({ width: 1366, height: 768 });
        logger.log(`🖥️ Using desktop viewport`);
      }

      await localPage.setCookie(...cookies);
      // await localPage.mouse.move(100, 100);
      await localPage.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'upgrade-insecure-requests': '1',
      });

      logger.log('🚀 Navigating to Bing...');
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(keyword)}`;

      // safe goto with retry; if fails, close browser and restart this worker iteration
      const bingOk = await safeGoto(localPage, logger, searchUrl, 60000, true);
      if (!bingOk) {
        logger.error('❌ Bing navigation failed after retry — stopping this browser.');
        if (localPage && !localPage.isClosed()) await localPage.close();
        // await safeCloseBrowser(localBrowser, logger);
        // localBrowser = null;
        localPage = null;
        await delay(5000);
        continue; // start next iteration (will launch new browser)
      }

      await delay(1000);

      // let links = [];
      // try {
      //   if (isMobile) {
      //     await localPage.waitForSelector('li.b_algo a', { timeout: 30000 });
      //     links = await localPage.$$eval('li.b_algo a', anchors => anchors.map(a => a.href));
      //   } else {
      //     await localPage.waitForSelector('li.b_algo h2 a', { timeout: 30000 });
      //     links = await localPage.$$eval('li.b_algo h2 a', anchors => anchors.map(a => a.href));
      //   }
      //   logger.log(`🔗 Found ${links.length} Bing search result links`);
      // } catch {
      //   logger.warn('⚠️  Bing search results not found');
      //   if (localPage && !localPage.isClosed()) await localPage.close();
      //   // await safeCloseBrowser(localBrowser, logger);
      //   // localBrowser = null;
      //   localPage = null;
      //   continue;
      // }

      // if (links.length > 0) {
      //   const randomLink = getRandomFromArray(links);
      //   logger.log(`🎯 Clicking random result: ${randomLink}`);

      //   const linkOk = await safeGoto(localPage, logger, randomLink, 60000, true);
      //   if (!linkOk) {
      //     logger.error('❌ Target site failed after retry — closing browser.');
      //     // await safeCloseBrowser(localBrowser, logger);
      //     // localBrowser = null;
      //     if (localPage && !localPage.isClosed()) await localPage.close();
      //     localPage = null;
      //     await delay(5000);
      //     continue;
      //   }

      //   await delay(Math.random() * 1000 + 200);

      //   try {
      //     const clicked = await localPage.evaluate(() => {
      //       const buttons = Array.from(document.querySelectorAll('button'));
      //       const consentBtn = buttons.find(b => /accept|agree|ok/i.test(b.innerText));
      //       if (consentBtn) { consentBtn.click(); return true; }
      //       return false;
      //     });

      //     if (clicked) logger.log("✅ Accepted cookie consent");
      //     else logger.log("ℹ️  No cookie consent button found");
      //     await delay(Math.random() * 2000 + 500);
      //   } catch (err) {
      //     logger.warn("⚠️ Error trying to accept cookies:", err.message);
      //   }

      //   await delay(Math.random() * 4000 + 100);
      //   logger.log(`✅ Finished visiting: ${localPage.url()}`);
      // } else logger.warn('⚠️ No valid search result links found');

      // navigates to technologymanias site
      const techOk = await safeGoto(localPage, logger, 'https://insurance.technologymanias.com/', 90000, true);
      if (!techOk) {
        logger.error('❌ technologymanias.com not reachable — closing browser.');
        // await safeCloseBrowser(localBrowser, logger);
        // localBrowser = null;
        if (localPage && !localPage.isClosed()) await localPage.close();
        localPage = null;
        await delay(5000);
        continue;
      }
      else{
        // const html = await localPage.content();
        // console.log(html);
      }

      logger.log('📜 Loading ads...');

      // Wait for AdSense script to load
      await localPage.waitForSelector('ins.adsbygoogle', { timeout: 20000 }).catch(() => {});

      try{
        // Force ad to render
        await localPage.evaluate(() => {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        });
      }
      catch(e)
      {
        logger.log('📜 Ad loaded...');
      }

      await localPage.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: 1200000 }
      );
      logger.log('📜 Scrolling through page like a human...');

      await delay(Math.random() * 2000 + 500);

      await humanScroll(localPage);

      logger.log('🔗 Clicking random internal links...');
      await visitRandomTechnologymaniasLinks(localPage, localBrowser, logger);

      // cleanup & next run
      // await safeCloseBrowser(localBrowser, logger);
      // localBrowser = null;
      if (localPage && !localPage.isClosed()) await localPage.close();
      localPage = null;
      const nextDelay = Math.random() * 1500 + 500;
      logger.log(`⏳ Waiting ${nextDelay.toFixed(0)}ms before next run...`);
      await delay(nextDelay);

    } catch (err) {
      logger.error('❌ Fatal error during run:', err && err.message ? err.message : err);
      // network / proxy specific errors: close browser and restart worker cycle
      if (/ERR_TUNNEL_CONNECTION_FAILED|ECONNREFUSED|network|timeout|ERR_SOCKS_CONNECTION_FAILED|ERR_CONNECT_TIMEOUT/i.test(err && err.message ? err.message : '')) {
        logger.error('🚫 Network/Proxy issue detected — stopping this browser instance.');
        if (localPage && !localPage.isClosed()) await localPage.close();
        // localBrowser = null;
        localPage = null;
        await delay(5000);
        continue; // start new iteration (new browser)
      }

      // If protocol errors (target closed etc.) happened, just close and restart
      // if (localBrowser) {
      //   try { await safeCloseBrowser(localBrowser, logger); } catch (e) { /* ignore */ }
      // }
      // localBrowser = null;
      if (localPage && !localPage.isClosed()) await localPage.close();
      localPage = null;
      await delay(5000);
    }
  }
}

// === pool manager: Start N workers sequentially with delay and keep them running ===
(async () => {
  const numInstances = 3; // max parallel browsers desired
  const workerPromises = [];

  for (let i = 0; i < numInstances; i++) {
    // start each worker loop as a detached promise — it manages its own lifecycle
    const p = runWorkerLoop(i + 1)
      .catch(err => {
        // in case the worker promise throws unexpectedly (shouldn't because loop is infinite),
        // log and restart it after brief delay
        console.error(`WORKER-${i+1}: Uncaught worker error:`, err && err.message ? err.message : err);
        return delay(2000).then(() => runWorkerLoop(i + 1));
      });
    workerPromises.push(p);
    console.log(`🟢 Started worker ${i + 1}`);
    await delay(5000); // wait 5 seconds before starting next
  }

  // Wait for all (they're infinite loops). If any rejects, the above catch restarts it.
  await Promise.all(workerPromises);
})();
