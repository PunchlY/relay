import { Elysia } from "elysia";
import { request as stealthFetch } from "stealth-fetch";

const defaultScope = {
  stealth: false,
};

const scopes = Object.entries<Partial<typeof defaultScope>>({
  "*://{*.}?bilibili.com": {
    stealth: true,
  },
}).map(([input, opt]) => ({
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
      });

      set.status = upstream.status;
      set.headers = upstream.headers instanceof Headers
        ? Object.fromEntries(upstream.headers)
        : upstream.headers;
      return upstream.body;
    });
}

export default new Elysia()
  .use(http("https:"))
  .use(http("http:"));
