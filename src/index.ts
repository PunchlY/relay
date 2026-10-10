import cors from "@elysia/cors";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { request as stealthFetch } from "stealth-fetch/lite";

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
  .get("/bili/cheese/:ssid", async function* ({ params, set }) {
    const res = await stealthFetch(
      `https://api.bilibili.com/pugv/view/web/season?season_id=${params.ssid}`,
    );
    const data = await res.json() as {
      code: 0;
      data: {
        title: string;
        episodes: {
          id: number;
          duration: number;
          title: string;
        }[];
      };
    } | { code: -404 };
    if (data.code !== 0) return;
    set.headers["content-type"] = "audio/mpegurl";
    const { title, episodes } = data.data;
    yield "#EXTM3U\n";
    yield `#PLAYLIST:${title}\n`;
    for (const { id, duration, title } of episodes) {
      yield `#EXTINF:${duration} group-title="News",${title}\n`;
      yield `https://www.bilibili.com/cheese/play/ep${id}\n`;
    }
  }, {
    params: t.Object({
      ssid: t.Numeric(),
    }),
  })
  .options("/*", ({ set }) => {
    set.status = 204;
  }, {
    params: t.Object({
      "*": t.String({ format: "uri" }),
    }),
  })
  .all("/*", async ({ request, params, set }) => {
    const targetUrl = new URL(params["*"]);
    targetUrl.search = new URL(request.url).search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("x-forwarded-proto");
    headers.delete("x-real-ip");

    headers.delete("cookie");

    headers.set("origin", targetUrl.origin);
    headers.set("referer", `${targetUrl.origin}/`);

    const upstream = await stealthFetch(targetUrl.href, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "follow",
    });

    set.status = upstream.status;
    set.headers = upstream.headers;
    return upstream.body;
  }, {
    params: t.Object({
      "*": t.String({ format: "uri" }),
    }),
  })
  .compile();
