// proxyManager.js
const got = require("got");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const net = require("net");

let localProxyList = [];
let badProxies = new Set();
let activeProxies = new Set();
let reservedProxies = new Set(); // <--- prevent concurrent testing
let lastFirstProxy = null;
let fetching = false;

// You can switch the source file here:
// let proxyurl = "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt";
let proxyurl = "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/allive.txt";
// let proxyurl = "https://cdn.jsdelivr.net/gh/databay-labs/free-proxy-list/http.txt";

function parseProxy(raw) {
  if (!raw || typeof raw !== "string") return null;
  let proxy = raw.trim();
  if (!proxy) return null;

  // Default protocol if not present
  if (!proxy.includes("://")) proxy = "http://" + proxy;

  try {
    const url = new URL(proxy);
    const protocol = url.protocol.replace(":", "");
    const host = url.hostname;
    const port = parseInt(url.port || "80");
    if (!host || !port) return null;

    // Force socks5h if it's socks5 to ensure DNS resolution through proxy
    const safeProtocol =
      protocol.startsWith("socks5") ? "socks5h" : protocol;

    return { protocol: safeProtocol, host, port, full: `${safeProtocol}://${host}:${port}` };
  } catch {
    return null;
  }
}

async function fetchProxyList(logger) {
  if (fetching) return localProxyList;
  fetching = true;
  try {
    const res = await fetch(proxyurl);
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

// --- helper: attempt a quick TCP connect to proxy host:port (fast fail) ---
function tcpConnect(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeout);
    socket.on("connect", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(true);
      }
    });
    socket.on("timeout", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });
    socket.on("error", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.connect(port, host);
  });
}

// --- updated testProxy to fully support SOCKS and HTTP proxies with real HTTPS validation ---
async function testProxy(proxyUrl) {
  const parsed = parseProxy(proxyUrl);
  if (!parsed) return false;

  // quick TCP check first — avoids long HTTP timeouts for dead hosts
  try {
    const reachable = await tcpConnect(parsed.host, parsed.port, 3000);
    if (!reachable) return false;
  } catch {
    return false;
  }

  // Test lightweight HTTPS endpoints to ensure full TLS support
  const testUrls = [
    // "https://www.youtube.com", // real TLS check
    "https://www.bing.com/",
    "https://httpbin.org/ip",  
  ];

  for (const url of testUrls) {
    try {
      let res;
      if (parsed.protocol.startsWith("socks")) {
        // SOCKS proxy -> use SocksProxyAgent for both http & https
        const agent = new SocksProxyAgent(parsed.full);
        res = await got(url, {
          agent: { http: agent, https: agent },
          timeout: { request: 10000 },
          retry: 0,
        });
      } else {
        // HTTP/HTTPS proxy -> use appropriate agents
        const proxyString = `${parsed.protocol}://${parsed.host}:${parsed.port}`;
        const httpAgent = new HttpProxyAgent(proxyString);
        const httpsAgent = new HttpsProxyAgent(proxyString);
        res = await got(url, {
          agent: { http: httpAgent, https: httpsAgent },
          timeout: { request: 10000 },
          retry: 0,
        });
      }

      if (res && res.statusCode >= 200 && res.statusCode < 400) {
        return true; // ✅ working proxy
      }
    } catch (err) {
      // try next URL
    }
  }

  // none succeeded
  return false;
}

// keep your existing getUniqueWorkingProxy with comments
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

// keep your existing releaseProxy function
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
