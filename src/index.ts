import cors from "@elysia/cors";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";

export default new Elysia({
  adapter: CloudflareAdapter,
})
  .use(cors({}))
  .get("/", () => "Hello!")
  .all("/headers", function* ({ headers }) {
    for (const [key, value] of Object.entries(headers)) {
      yield `${key}: ${value}\n`;
    }
  })
  .get("/trace", function* ({ request, headers }) {
    const { cf } = request;
    const url = new URL(request.url);

    yield `fl=${cf?.colo || ""}\n`;
    yield `h=${url.hostname}\n`;
    yield `ip=${headers["x-forwarded-for"] ?? headers["x-real-ip"] ?? ""}\n`;
    yield `ts=${(Date.now() / 1000).toFixed(3)}\n`;
    yield `visit_scheme=${url.protocol.replace(":", "")}\n`;
    yield `uag=${headers["user-agent"] || ""}`,
      yield `colo=${cf?.colo || ""}\n`;
    // yield `sliver=none\n`
    yield `http=${cf?.httpProtocol || ""}\n`;
    yield `loc=${cf?.country || ""}\n`;
    yield `tls=${cf?.tlsVersion || ""}\n`;
    yield `sni=plaintext\n`;
    yield `warp=${cf?.asn === 13335 || "off"}\n`;
    // yield `gateway=off\n`
    // yield `rbi=off\n`
    yield `kex=${cf?.tlsCipher || ""}\n`;
  })
  .use(import("./bili"))
  .use(import("./proxy"))
  .compile();
