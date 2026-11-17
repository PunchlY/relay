import { Elysia } from "elysia";
import { request as stealthFetch } from "stealth-fetch";

interface ScopeOptions {
  stealth?: boolean;
  cache?: boolean | number;
  headers?: Record<string, string | true | null>;
}

const scopes = Object.entries<ScopeOptions>({
  "*://{*.}?bilibili.com": {
    stealth: true,
  },
  "*://i.pximg.net": {
    cache: 14400,
  },
  "*://*": {
    cache: true,
  },
}).map(([input, { stealth = false, cache = false, headers = {} }]) => {
  const ttl =
    typeof cache === "number" && Number.isFinite(cache) && cache > 0
      ? Math.floor(cache)
      : 0;

  const revalidate = cache === true;
  const cacheControl = revalidate
    ? "public, max-age=0, must-revalidate"
    : ttl > 0
      ? `public, max-age=${ttl}`
      : "no-store";

  headers = {
    host: null,
    "content-length": null,
    "cf-connecting-ip": null,
    "cf-ipcountry": null,
    "cf-ray": null,
    "cf-visitor": null,
    "x-forwarded-proto": null,
    "x-real-ip": null,
    cookie: null,
    ...headers,
    ...(!revalidate && { "if-none-match": null, "if-modified-since": null }),
  };

  return {
    pattern: new URLPattern(input),
    fetch: stealth ? stealthFetch : global.fetch,
    cacheControl,
    headers: {
      remove: Object.entries(headers)
        .filter(([, value]) => value === null)
        .map(([name]) => name),
      set: Object.entries(headers).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    },
  };
});

function http(protocol: string) {
  return new Elysia({ prefix: `/${protocol}` }).all(
    "//*",
    async ({ request, params, set }) => {
      const targetUrl = new URL(`${protocol}//${params["*"]}`);
      targetUrl.search = new URL(request.url).search;

      const scope = scopes.find(({ pattern }) => pattern.test(targetUrl))!;

      const headers = new Headers(request.headers);
      headers.set("origin", targetUrl.origin);
      headers.set("referer", `${targetUrl.origin}/`);
      for (const name of scope.headers.remove) {
        headers.delete(name);
      }
      for (const [name, value] of scope.headers.set) {
        headers.set(name, value);
      }

      const upstream = await (void 0, scope.fetch)(targetUrl.href, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "follow",
        cache: "no-store",
      });

      set.status = upstream.status;

      set.headers =
        upstream.headers instanceof Headers
          ? Object.fromEntries(upstream.headers)
          : upstream.headers;

      set.headers["cache-control"] =
        request.method === "GET" || request.method === "HEAD"
          ? scope.cacheControl
          : "no-store";

      set.headers["cache-tag"] = "proxy";

      return upstream.body;
    },
  );
}

export default new Elysia().use(http("https:")).use(http("http:"));
