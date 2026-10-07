// Local DNS benchmark: times UDP (IPv4/IPv6), DoT and DoH queries from this machine.
// Usage: node server.js            → http://127.0.0.1:5353
//        node server.js --selftest → one query per protocol, exits non-zero on failure
const http = require('node:http');
const dgram = require('node:dgram');
const tls = require('node:tls');
const http2 = require('node:http2');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');

const { execFile } = require('node:child_process');
const sea = require('node:sea');

const PORT = 5353, TIMEOUT = 2000;

// RFC 1035 query for an A record, RD + AD flags set
function query(name, id) {
  const labels = name.split('.').flatMap(l => [l.length, ...Buffer.from(l)]);
  return Buffer.from([id >> 8, id & 255, 1, 0x20, 0, 1, 0, 0, 0, 0, 0, 0, ...labels, 0, 0, 1, 0, 1]);
}
const parse = m => ({ rcode: m[3] & 15, ad: !!(m[3] & 0x20), qr: !!(m[2] & 0x80) });

function wait(map, key) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { map.delete(key); rej(new Error('timeout')); }, TIMEOUT);
    map.set(key, m => { clearTimeout(t); map.delete(key); res(m); });
  });
}
function freeId(map) { let id; do id = Math.random() * 65536 | 0; while (map.has(id)); return id; }

// UDP: one socket per family, replies matched by DNS ID
const udpPending = new Map(), udpSocks = {};
function udpSock(v6) {
  const k = v6 ? 'udp6' : 'udp4';
  return udpSocks[k] ??= dgram.createSocket(k)
    .on('message', m => udpPending.get(m.readUInt16BE(0))?.(m))
    .on('error', () => {});
}
function udp(addr, name) {
  const id = freeId(udpPending), p = wait(udpPending, id);
  udpSock(net.isIPv6(addr.split('%')[0])).send(query(name, id), 53, addr, e => e && udpPending.get(id) && p.catch(() => {}));
  return p;
}

// DoT: persistent TLS connection per server, 2-byte length-framed messages. addr = "ip@sni"
const dotConns = new Map();
function dotConn(addr) {
  let c = dotConns.get(addr);
  if (c && !c.sock.destroyed) return c;
  const [host, sni] = addr.split('@');
  c = { pend: new Map(), buf: Buffer.alloc(0) };
  c.sock = tls.connect({ host, port: 853, servername: sni });
  c.sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    while (c.buf.length >= 2 && c.buf.length >= 2 + c.buf.readUInt16BE(0)) {
      const m = c.buf.subarray(2, 2 + c.buf.readUInt16BE(0));
      c.buf = c.buf.subarray(2 + m.length);
      c.pend.get(m.readUInt16BE(0))?.(m);
    }
  }).on('error', () => {}).on('close', () => dotConns.delete(addr));
  dotConns.set(addr, c);
  return c;
}
function dot(addr, name) {
  const c = dotConn(addr), id = freeId(c.pend), q = query(name, id), p = wait(c.pend, id);
  const len = Buffer.alloc(2); len.writeUInt16BE(q.length);
  c.sock.write(Buffer.concat([len, q]));
  return p;
}

// DoH: persistent HTTP/2 session per origin (some resolvers refuse HTTP/1.1)
const h2 = new Map();
function doh(url, name) {
  const u = new URL(url);
  let s = h2.get(u.origin);
  if (!s || s.closed || s.destroyed) {
    s = http2.connect(u.origin).on('error', () => {}).on('close', () => h2.delete(u.origin));
    h2.set(u.origin, s);
  }
  const dnsParam = query(name, 0).toString('base64url');
  return new Promise((res, rej) => {
    const r = s.request({ ':path': `${u.pathname}?dns=${dnsParam}`, accept: 'application/dns-message' });
    const chunks = []; let status;
    r.setTimeout(TIMEOUT, () => { r.close(); rej(new Error('timeout')); });
    r.on('response', h => status = h[':status']).on('data', d => chunks.push(d)).on('error', rej)
      .on('end', () => status == 200 ? res(Buffer.concat(chunks)) : rej(new Error('http ' + status)));
    r.end();
  });
}

const PROTOS = { udp, dot, doh };
async function timed(proto, addr, name) {
  const t = performance.now();
  try {
    const r = parse(await PROTOS[proto](addr, name)), ms = performance.now() - t;
    return r.qr && (r.rcode == 0 || r.rcode == 3) ? { ms, ad: r.ad } : { err: 'rcode ' + r.rcode };
  } catch (e) { return { err: e.message }; }
}

async function selftest() {
  let ok = true;
  for (const [p, a] of [['udp', '1.1.1.1'], ['dot', '1.1.1.1@cloudflare-dns.com'], ['doh', 'https://dns.quad9.net/dns-query']]) {
    const r = await timed(p, a, 'example.com');
    console.log(p.padEnd(4), a.padEnd(32), r.err ?? r.ms.toFixed(1) + ' ms');
    ok &&= !r.err;
  }
  process.exit(ok ? 0 : 1);
}

// Standalone build embeds the page as an asset; dev runs read it from disk
const html = sea.isSea() ? sea.getAsset('index.html', 'utf8') : fs.readFileSync(__dirname + '/public/index.html');

const server = http.createServer(async (req, res) => {
  // Bound to loopback; Host check also blocks DNS-rebinding from other sites
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return res.writeHead(403).end();
  const u = new URL(req.url, 'http://x');
  const json = o => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
  if (u.pathname == '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  if (u.pathname == '/system') return json(dns.getServers());
  if (u.pathname == '/q') {
    const p = u.searchParams.get('proto'), a = u.searchParams.get('addr'), n = u.searchParams.get('name');
    if (!PROTOS[p] || !a || !/^[a-z0-9.-]{1,253}$/i.test(n || '')) return res.writeHead(400).end();
    return json(await timed(p, a, n));
  }
  res.writeHead(404).end();
});

function openBrowser(url) {
  const [cmd, args] = process.platform == 'darwin' ? ['open', [url]]
    : process.platform == 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

// Try 5353, then the next few ports if something else is using it
function start(port) {
  server.once('error', e => e.code == 'EADDRINUSE' && port < PORT + 10 ? start(port + 1) : (console.error(e.message), process.exit(1)));
  server.listen(port, '127.0.0.1');
}
server.once('listening', () => {
  const url = `http://localhost:${server.address().port}`;
  console.log(`DNS Benchmark running at ${url}\nClose this window to quit.`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
});

if (process.argv.includes('--selftest')) selftest(); else start(PORT);
