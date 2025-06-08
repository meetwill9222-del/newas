const fs = require('fs');
const puppeteer = require('puppeteer');
const axios = require('axios');
const path = require('path');

const proxyTxtFile = 'proxies.txt';
const proxyJsonFile = 'proxies.json';
const urlToTest = 'https://www.technologymanias.com';

// Step 1: Load or create JSON proxy list
let proxies = [];

if (fs.existsSync(proxyJsonFile)) {
  proxies = JSON.parse(fs.readFileSync(proxyJsonFile, 'utf8'));
} else {
  const proxyList = fs.readFileSync(proxyTxtFile, 'utf8').split('\n').map(p => p.trim()).filter(Boolean);
  proxies = proxyList.map(proxy => ({
    proxy,
    status: 0, // 0 = not tested
    country: null,
    latency: null
  }));
  fs.writeFileSync(proxyJsonFile, JSON.stringify(proxies, null, 2));
  console.log('✅ proxies.json created');
}

// Step 2: Get country from IP using ipapi.co
async function getCountry(ip) {
  try {
    const response = await axios.get(`https://ipapi.co/${ip}/country_name/`, { timeout: 5000 });
    return response.data.trim();
  } catch (err) {
    return null;
  }
}

// Step 3: Test proxy with Puppeteer
async function testProxy(proxyObj) {
  const proxy = proxyObj.proxy;
  console.log(`🔌 Trying proxy: ${proxy}`);

  const proxyParts = proxy.match(/(?:(http:\/\/)?(.+?):(.+?)@)?(.+?):(\d+)/);
  const hasAuth = proxyParts && proxyParts[2] && proxyParts[3];
  const ip = proxyParts[4];

  const args = [`--proxy-server=${ip}:${proxyParts[5]}`];

  const start = Date.now();
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args,
      timeout: 10000,
    });

    const page = await browser.newPage();

    if (hasAuth) {
      await page.authenticate({ username: proxyParts[2], password: proxyParts[3] });
    }

    await page.goto(urlToTest, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const finalUrl = page.url();
    const latency = Date.now() - start;

    if (finalUrl.includes('technologymanias.com')) {
      proxyObj.status = 1;
      proxyObj.latency = latency;
      proxyObj.country = await getCountry(ip);

      console.log(`✅ Working proxy: ${proxy} | ${proxyObj.country} | ${latency}ms`);
    } else {
      console.warn(`⚠️ Unexpected redirect to: ${finalUrl}`);
      proxyObj.status = 2;
    }

    await browser.close();
  } catch (err) {
    proxyObj.status = 2;
    proxyObj.latency = null;
    proxyObj.country = null;
    console.warn(`❌ Failed proxy: ${proxy} | Reason: ${err.message}`);
    if (browser) await browser.close();
  }

  // Save JSON after each test
  fs.writeFileSync(proxyJsonFile, JSON.stringify(proxies, null, 2));
}

// Step 4: Run tests
(async () => {
  for (const proxy of proxies) {
    if (proxy.status === 0) {
      await testProxy(proxy);
    }
  }

  console.log('✅ Testing complete. Updated results saved to proxies.json');
})();
