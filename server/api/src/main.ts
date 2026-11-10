import { createServer } from "node:http";
import { HttpError, ipOf, limit, send, trustProxyFrom } from "./http.ts";
import { route } from "./routes.ts";

/**
 * sc player's own server: the track messenger (friend codes, no accounts), the theme workshop and a pseudonymous
 * count of running apps. JSON over HTTP behind Caddy (TLS); data in SQLite under DATA_DIR.
 */
const PORT = Number(process.env.PORT ?? 8080);
// X-Forwarded-For decides the rate-limit bucket (5 registrations an hour, 20 pings, …), so trusting it by default
// would let anyone start a fresh bucket per request by sending their own header — every limit here would be gone.
// The address is trusted only when the deployment says a proxy it controls is in front: docker-compose does, for
// Caddy ("1"); a bare `node src/main.ts` does not ("0", the default here).
const TRUST_PROXY = trustProxyFrom(process.env.TRUST_PROXY);

const server = createServer(async (req, res) => {
  const ip = ipOf(req, TRUST_PROXY);
  try {
    limit(`ip:${ip}`, 300, 60_000);
    await route({ req, res, ip });
  } catch (e) {
    if (res.headersSent) return void res.destroy();
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(new Date().toISOString(), req.method, req.url, e);
    send(res, 500, { error: "server error" });
  }
});

server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.listen(PORT, () => console.log(`sc player api on :${PORT}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.close(() => process.exit(0)));
