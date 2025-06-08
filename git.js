const puppeteer = require('puppeteer');

(async () => {
  const proxy = 'http://47.254.127.197:3128'; // Replace with your actual proxy

  const browser = await puppeteer.launch({
    headless: false, // set to true if you don’t want a visible browser
    args: [`--proxy-server=${proxy}`],
  });

  const page = await browser.newPage();

  await page.goto('https://github.com');

  // Optional: wait a bit to observe
//   await page.waitForTimeout(1000000);

//   await browser.close();
})();
