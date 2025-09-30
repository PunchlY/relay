import { PatternRouter } from "./router";
// @ts-ignore
import xget from "xget/src/index.js";
// @ts-ignore
import { PLATFORMS } from "xget/src/config/platforms.js";

interface Env {
    // ASSETS: Fetcher;
}

const router = new PatternRouter<Env>()
    .addRoute("GET", { pathname: "/" }, () => {
        return new Response("hello");
    })
    .addRoute("GET", { pathname: "/test" }, (request) => {
        let content = "";
        for (const [key, value] of request.headers) {
            content += `${key}: ${value}\n`;
        }
        return new Response(content);
    })
    .addRoute("GET", { pathname: "/bili/cheese/ss:season_id(\\d+).m3u", }, async (request, _env, _ctx, pattern) => {
        const { season_id } = pattern.pathname.groups as { season_id: string; };
        const url = new URL("https://api.bilibili.com/pugv/view/web/season");
        url.searchParams.set("season_id", season_id);
        const res = await fetch(url, {
            headers: {
                cookie: request.headers.get("cookie") ?? "",
                accept: "*/*",
                connection: "Keep-Alive",
                "user-agent": "curl/8.16.0",
                referer: "https://www.bilibili.com/",
            },
        });
        const data = await res.json<{
            code: 0;
            data: {
                title: string;
                episodes: { id: number, duration: number, title: string; }[];
            };
        } | { code: -404; }>();
        if (data.code !== 0)
            return new Response("Not Found", { status: 404 });
        const { title, episodes } = data.data;
        const extinf = episodes
            .map(({ id, duration, title }) =>
                `#EXTINF:${duration} group-title="News",${title}\nhttps://www.bilibili.com/cheese/play/ep${id}`
            )
            .join("\n");
        return new Response(`#EXTM3U\n#PLAYLIST:${title}\n${extinf}`, {
            headers: { "Content-Type": "audio/mpegurl" },
        });
    })
    .addRoute("GET", { pathname: "/bili/*", }, () => {
        return new Response("Not Found", { status: 404 });
    })
    .addRoute({ pathname: "/(https?://.+)" }, async (request, _env, _ctx, pattern) => {
        let url = pattern.pathname.groups[0]!;
        const search = pattern.search.input;
        if (search) {
            url += `?${search}`;
        }
        request = new Request(url, request);
        request.headers.delete("host");
        request.headers.delete("cookie");
        request.headers.delete("x-forwarded-proto");
        request.headers.delete("x-real-ip");
        request.headers.delete("cf-connecting-ip");
        request.headers.delete("cf-ipcountry");
        request.headers.delete("cf-ray");
        request.headers.delete("cf-visitor");
        request.headers.set("connection", "keep-alive");
        request.headers.set("origin", request.headers.get("origin") || "*");
        request.headers.set("referer", request.url);

        let res = await fetch(request);
        res = new Response(res.body, res);
        res.headers.delete("set-cookie");
        return new Response(res.body, res);
    })
    .addRoute(xget.fetch);

export default {
    async fetch(request, env, ctx) {
        try {
            return await router.fetch(request, env, ctx);
        } catch {
            return new Response("Internal Server Error", { status: 500 });
        }
    },
} satisfies ExportedHandler<Env>;
