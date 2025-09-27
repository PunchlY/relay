import { PatternRouter } from "./router";
// @ts-ignore
import xget from "xget/src/index.js";

interface Env {
    // ASSETS: Fetcher;
}

const router = new PatternRouter<Env>()
    .addRoute("GET", { pathname: "/" }, () => {
        return new Response("hello");
    })
    .addRoute({ pathname: "/(https?://.+)" }, async (request, _env, _ctx, pattern) => {
        let url = pattern.pathname.groups[0]!;
        const search = pattern.search.input;
        if (search) {
            url += `?${search}`;
        }
        request = new Request(url, request);
        request.headers.set("Connection", "keep-alive");
        request.headers.set("Origin", request.headers.get("Origin") || "*");
        request.headers.set("Referer", request.url);
        const res = await fetch(request);
        res.headers.delete("Set-Cookie");
        return res;
    })
    .addRoute((request, env, ctx) => {
        return xget.fetch(request, env, ctx);
    });

export default {
    fetch: router.fetch,
} satisfies ExportedHandler<Env>;
