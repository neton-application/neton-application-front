// Local same-origin proxy for MFA acceptance. Cookie behavior matches a production reverse proxy.
import http from "node:http";

const port = Number(process.env.MFA_ACCEPTANCE_PORT || 33181);
const frontend = new URL(process.env.MFA_ACCEPTANCE_FRONTEND || "http://127.0.0.1:33180");
const backend = new URL(process.env.MFA_ACCEPTANCE_BACKEND || "http://127.0.0.1:33179");
for (const target of [frontend, backend]) {
  if (target.hostname !== "127.0.0.1" || target.protocol !== "http:") throw new Error("Acceptance proxy only supports local HTTP targets");
}
const server = http.createServer((req, res) => {
  const target = req.url.startsWith("/admin/") ? backend : frontend;
  const upstream = http.request(new URL(req.url, target), {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end("Local acceptance upstream unavailable"); });
  req.pipe(upstream);
});
// Next development hydration waits for its HMR socket; preserve the Upgrade path too.
server.on("upgrade", (req, socket, head) => {
  const upstream = http.request(new URL(req.url, frontend), { headers: { ...req.headers, host: frontend.host } });
  upstream.on("upgrade", (response, peer, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) peer.write(head);
    peer.pipe(socket); socket.pipe(peer);
    socket.on("error", () => peer.destroy()); peer.on("error", () => socket.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});
server.listen(port, "127.0.0.1", () => console.log(`MFA acceptance proxy http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
