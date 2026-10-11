import { Elysia } from "elysia";
import { request as stealthFetch } from "stealth-fetch";

interface ScopeOptions {
  stealth?: boolean;
  cache?: true | number;
  headers?: Record<string, string | true | null>;
}

const scopes = Object.entries<ScopeOptions>({
  "*://{*.}?bilibili.com": {
    stealth: true,
  },
  "*://i.pximg.net": {
    cache: 3600,
  },
  "*://*": {},
}).map(([input, opt]) => {
  const stealth = opt.stealth ?? false;
  const cache = opt.cache === true
    ? true
    : typeof opt.cache !== "number" || opt.cache < 0
    ? 0
    : opt.cache;
  const headers = Object.entries<string | true | null>({
    host: null,
    "content-length": null,
    "cf-connecting-ip": null,
    "cf-ipcountry": null,
    "cf-ray": null,
    "cf-visitor": null,
    "x-forwarded-proto": null,
    "x-real-ip": null,
    "cookie": null,
    ...opt.headers,
  });
  return {
    pattern: new URLPattern(input),
    fetch: stealth ? stealthFetch : global.fetch,
    cache,
    headers: {
      remove: headers
        .filter((pair) => pair[1] === null)
        .map(([name]) => name),
      set: headers
        .filter((pair): pair is [string, string] =>
          typeof pair[1] === "string"
        ),
    },
  };
});

function http(protocol: string) {
  return new Elysia({ prefix: `/${protocol}` })
    .all("//*", async ({ request, params, set }) => {
      const targetUrl = new URL(`${protocol}//${params["*"]}`);
      targetUrl.search = new URL(request.url).search;

      const scope = scopes.find(({ pattern }) => pattern.test(targetUrl))!;

      const fetch = scope.fetch;

      const headers = new Headers(request.headers);
      headers.set("origin", targetUrl.origin);
      headers.set("referer", `${targetUrl.origin}/`);
      for (const name of scope.headers.remove) {
        headers.delete(name);
      }
      for (const [name, value] of scope.headers.set) {
        headers.set(name, value);
      }

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
      if (typeof scope.cache === "number" && scope.cache > 0) {
        set.headers["cache-control"] = `public, max-age=${scope.cache}`;
      } else if (!scope.cache) {
        set.headers["cache-control"] = "no-store";
      }

      return upstream.body;
    });
}

export default new Elysia()
  .use(http("https:"))
  .use(http("http:"));
