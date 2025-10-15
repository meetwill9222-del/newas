// proxyManager.js
const axios = require("axios");

let localProxyList = [];
let badProxies = new Set();
let activeProxies = new Set();
let reservedProxies = new Set(); // <--- prevent concurrent testing
let lastFirstProxy = null;
let fetching = false;
let proxyurl ="https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/allive.txt";
// let proxyurl ="https://cdn.jsdelivr.net/gh/databay-labs/free-proxy-list/http.txt";

function parseProxy(raw) {
  if (!raw || typeof raw !== "string") return null;
  let proxy = raw.trim();
  if (!proxy.includes("://")) proxy = "http://" + proxy;

  try {
    const url = new URL(proxy);
    const protocol = url.protocol.replace(":", "");
    const host = url.hostname;
    const port = parseInt(url.port || "80");
    if (!host || !port) return null;

    return { protocol, host, port, full: `${protocol}://${host}:${port}` };
  } catch {
    return null;
  }
}

async function fetchProxyList(logger) {
  if (fetching) return localProxyList;
  fetching = true;
  try {
    const res = await fetch(
      proxyurl
    );
    const text = await res.text();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    const parsedList = lines
      .map(parseProxy)
      .filter(Boolean)
      .map((p) => p.full);

    if (parsedList.length === 0) {
      logger.error("⚠️ No proxies fetched — keeping old list");
      fetching = false;
      return localProxyList;
    }

    const firstProxy = parsedList[0];
    if (firstProxy !== lastFirstProxy) {
      logger.log(`🔁 Proxy list updated (first proxy changed to ${firstProxy})`);
      localProxyList = parsedList;
      lastFirstProxy = firstProxy;
      badProxies.clear();
      reservedProxies.clear();
    } else {
      logger.log("✅ Proxy list unchanged — reusing cached version");
    }
  } catch (e) {
    logger.error(`❌ Proxy fetch failed: ${e.message}`);
  } finally {
    fetching = false;
  }
  return localProxyList;
}

async function testProxy(proxyUrl) {
  const parsed = parseProxy(proxyUrl);
  if (!parsed) return false;

  try {
    const res = await axios.get("https://www.bing.com", {
      proxy: {
        protocol: parsed.protocol,
        host: parsed.host,
        port: parsed.port,
      },
      timeout: 8000,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function getUniqueWorkingProxy(workerId, logger) {
  const proxyList = await fetchProxyList(logger);

  for (const proxy of proxyList) {
    if (badProxies.has(proxy)) continue;      // skip failed
    if (activeProxies.has(proxy)) continue;   // skip already in use
    if (reservedProxies.has(proxy)) continue; // skip being tested by another worker

    reservedProxies.add(proxy);               // <--- reserve immediately
    logger.log(`🌐 [${workerId}] Testing proxy: ${proxy}`);

    const ok = await testProxy(proxy);

    reservedProxies.delete(proxy);            // <--- done testing

    if (ok) {
      activeProxies.add(proxy);
      logger.log(`✅ [${workerId}] Using working proxy: ${proxy}`);
      return proxy;
    } else {
      badProxies.add(proxy);
      logger.warn(`❌ [${workerId}] Proxy failed: ${proxy}`);
    }
  }

  logger.error(`😞 [${workerId}] No available working proxy`);
  return null;
}

function releaseProxy(proxy, logger) {
  if (proxy && activeProxies.has(proxy)) {
    activeProxies.delete(proxy);
    logger.log(`🔄 Released proxy: ${proxy}`);
  }
}

module.exports = {
  getUniqueWorkingProxy,
  releaseProxy,
  fetchProxyList,
  testProxy,
};
