import type { CacheControlValue } from "@tusbar/cache-control";
import * as CacheControl from "@tusbar/cache-control";
import { env } from "cloudflare:workers";
import { Elysia } from "elysia";
import { request as stealthFetch } from "stealth-fetch";

interface ScopeOptions {
  stealth?: boolean;
  cacheControl?: CacheControlValue;
  headers?: Record<string, string | boolean>;
}

const scopes = Object.entries<ScopeOptions>({
  "https://{*.}?bilibili.com": {
    stealth: true,
  },
  "https://i.pximg.net": {
    cacheControl: { maxAge: 14400 },
  },
  "https://api.github.com/repos/:owner/:repo/releases/assets/:asset_id": {
    cacheControl: { maxAge: 14400 },
    headers: {
      accept: "application/octet-stream",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "user-agent": "curl/8.22.0",
    },
  },
  "*://*": {
    cacheControl: { maxAge: 60 },
    headers: { accept: true },
  },
}).map(([input, { stealth = false, cacheControl = {}, headers = {} }]) => {
  return {
    pattern: new URLPattern(input),
    fetch: stealth ? stealthFetch : global.fetch,
    cacheControl,
    headers: {
      inherit: Object.entries(headers)
        .filter(([, value]) => value === true)
        .map(([name]) => name),
      set: Object.entries(headers).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    },
  };
});

function http(protocol: string) {
  return new Elysia({ prefix: `/${protocol}` }).get(
    "//*",
    async ({ request, params, set }) => {
      const targetUrl = new URL(`${protocol}//${params["*"]}`);
      targetUrl.search = new URL(request.url).search;

      const scope = scopes.find(({ pattern }) => pattern.test(targetUrl))!;

      const headers = new Headers();
      for (const name of scope.headers.inherit) {
        if (request.headers.has(name)) {
          headers.set(name, request.headers.get(name)!);
        }
      }
      headers.set("origin", targetUrl.origin);
      headers.set("referer", `${targetUrl.origin}/`);
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

      const cacheControl: CacheControlValue =
        upstream.status >= 500
          ? { public: true, maxAge: 60 }
          : upstream.status >= 400
            ? { noStore: true }
            : { public: true, ...scope.cacheControl };
      set.headers["cache-control"] = CacheControl.format(cacheControl);

      set.headers["cache-tag"] = "proxy";

      set.headers.vary = scope.headers.inherit.join();

      return upstream.body;
    },
  );
}

export default new Elysia().use(http("https:")).use(http("http:"));
