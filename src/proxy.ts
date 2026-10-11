import { Elysia } from "elysia";
import { request as stealthFetch } from "stealth-fetch";

const defaultScope = {
  stealth: false,
  cache: false as number | boolean,
};

const scopes = Object.entries<Partial<typeof defaultScope>>({
  "*://{*.}?bilibili.com": {
    stealth: true,
  },
  "*://i.pximg.net": {
    cache: 3600,
  },
}).map(([input, opt]) => ({
  ...defaultScope,
  ...opt,
  pattern: new URLPattern(input),
}));

function http(protocol: string) {
  return new Elysia({ prefix: `/${protocol}` })
    .all("//*", async ({ request, params, set }) => {
      const targetUrl = new URL(`${protocol}//${params["*"]}`);
      targetUrl.search = new URL(request.url).search;

      const cfg = scopes.find(({ pattern }) => pattern.test(targetUrl)) ??
        defaultScope;

      const fetch = cfg.stealth ? stealthFetch : global.fetch;

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

      const upstream = await fetch(targetUrl.href, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "follow",
        cache: "no-cache",
      });

      set.status = upstream.status;
      set.headers = upstream.headers instanceof Headers
        ? Object.fromEntries(upstream.headers)
        : upstream.headers;

      set.headers["cache-tag"] = "proxy";
      if (typeof cfg.cache === "number" && cfg.cache > 0) {
        set.headers["cache-control"] = `public, max-age=${cfg.cache}`;
      } else if (cfg.cache === false) {
        set.headers["cache-control"] = "no-store";
      }

      return upstream.body;
    });
}

export default new Elysia()
  .use(http("https:"))
  .use(http("http:"));
