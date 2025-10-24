const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const useProxy = require('@lem0-packages/puppeteer-page-proxy');
const { getUniqueWorkingProxy, releaseProxy } = require('./proxyManager');
const treeKill = require('tree-kill');
const { faker } = require('@faker-js/faker');
const UserAgent = require('user-agents');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise(res => setTimeout(res, ms));

function makeLogger(workerId) {
  return {
    log: (...args) => console.log(`WORKER-${workerId}:`, ...args),
    warn: (...args) => console.warn(`WORKER-${workerId}:`, ...args),
    error: (...args) => console.error(`WORKER-${workerId}:`, ...args),
  };
}

async function safeCloseBrowser(browserRef, logger = console) {
  if (!browserRef) return;
  try {
    const proc = browserRef.process?.();
    if (proc?.pid) {
      treeKill(proc.pid, 'SIGKILL', (err) => {
        if (err) logger.error('Failed to kill browser:', err.message);
        else logger.log(`💀 Killed browser PID ${proc.pid}`);
      });
    } else {
      await browserRef.close().catch(() => {});
      logger.log('🧹 Closed browser gracefully');
    }
  } catch (err) {
    logger.error('safeCloseBrowser error:', err.message);
  }
}

function getRandomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCookies(category, domains) {
  const domain = getRandomFromArray(domains[category]);
  const now = Math.floor(Date.now() / 1000);
  const oneYearLater = now + 60 * 60 * 24 * 365;

  const baseCookies = [
    { name: 'interest', value: category, domain, path: '/', expirationDate: oneYearLater, sameSite: 'Lax', httpOnly: false, secure: false },
    { name: 'session_id', value: faker.string.uuid(), domain, path: '/', sameSite: 'Lax', httpOnly: true, secure: true }
  ];

  const extraCookies = {
    insurance: { name: 'policy_num', value: 'PN-' + faker.number.int({ min: 100000, max: 999999 }) },
    health: { name: 'health_session', value: faker.string.alphanumeric(24) },
    education: { name: 'edu_user', value: faker.internet.username() },
    business: { name: 'biz_visitor', value: faker.string.uuid() },
  };

  const extra = extraCookies[category];
  if (extra) baseCookies.push({ ...extra, domain, path: '/', expirationDate: oneYearLater, sameSite: 'Lax', secure: true, httpOnly: category === 'health' });

  return baseCookies;
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
      await delay(Math.random() * 300 + 200);
    }

    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, -window.innerHeight / 4));
      await delay(Math.random() * 300 + 200);
    }
  }

  await delay(Math.random() * (maxTime - minTime) + minTime);
}

// ---------------- MAIN WORKER ----------------
async function runWorker(workerId) {
  const logger = makeLogger(workerId);
  const urls = [
    'https://otieu.com/4/10074827',
    'https://otieu.com/4/10074656',
    'https://otieu.com/4/10074655',
    'https://otieu.com/4/10074654',
    'https://otieu.com/4/10074657',
  ];

  const categories = ['insurance', 'health', 'education', 'business'];
  const categoryDomains = {
    insurance: ['insurance.example.com'],
    health: ['health.example.com'],
    education: ['education.example.com'],
    business: ['business.example.com']
  };

  let browser = null;
  let proxy = null;

  try {
    logger.log('🚀 Launching browser...');
    browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    logger.log('🟢 Browser launched');
  } catch (err) {
    logger.error('❌ Failed to launch browser:', err.message);
    return;
  }

  while (true) {
    try {
      proxy = await getUniqueWorkingProxy(workerId, logger);
      if (!proxy) {
        logger.warn('⚠️ No proxy available, closing browser');
        await safeCloseBrowser(browser, logger);
        return;
      }

      logger.log(`🌐 Using proxy: ${proxy}`);
      logger.log('🪄 Opening all tabs in parallel...');

     const tasks = urls.map(async (url, i) => {
        const page = await browser.newPage();

        try {
            // Set proxy, user-agent, cookies
            try {
            await useProxy(page, proxy);
            const userAgent = new UserAgent().toString();
            await page.setUserAgent(userAgent);

            const category = getRandomFromArray(categories);
            const cookies = generateCookies(category, categoryDomains);
            if (!page.isClosed()) await page.setCookie(...cookies);
            } catch (err) {
            logger.warn(`⚠️ Tab ${i + 1}: Failed to set proxy/cookies:`, err.message);
            }

            // Navigate and scroll
            logger.log(`🧭 Tab ${i + 1}: Navigating to ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await humanScroll(page, 5000, 10000);
            logger.log(`✅ Tab ${i + 1}: Finished ${url}`);

        } catch (err) {
            logger.warn(`⚠️ Tab ${i + 1} error: ${err.message}`);

        } finally {
            // Ensure the tab always closes
            if (!page.isClosed()) {
            try {
                await page.close({ runBeforeUnload: true });
                logger.log(`🧹 Tab ${i + 1} closed`);
            } catch (err) {
                logger.warn(`⚠️ Tab ${i + 1} failed to close: ${err.message}`);
            }
            }
        }
        });



      await Promise.all(tasks);
      logger.log('🎯 Completed all tabs, restarting loop after delay...');
      await delay(1000);

    } catch (err) {
      logger.error('❌ Worker loop error:', err);
      await delay(1000);
    }
  }
}

// ---------------- START WORKERS ----------------
(async () => {
  const numInstances = 1;
  for (let i = 0; i < numInstances; i++) {
    runWorker(i + 1).catch(console.error);
    await delay(3000);
  }
})();
