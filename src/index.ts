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
    .addRoute("GET", { pathname: "/bili/cheese/ss:season_id(\\d+).m3u", }, async (request, _env, _ctx, pattern) => {
        const { season_id } = pattern.pathname.groups as { season_id: string; };
        const cookie = request.headers.get("Cookie");
        const url = new URL("https://api.bilibili.com/pugv/view/web/season");
        url.searchParams.set("season_id", season_id);
        const res = await fetch(url, {
            headers: {
                Cookie: cookie ?? "",
                Referer: 'https://www.bilibili.com',
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
        request.headers.set("Connection", "keep-alive");
        request.headers.set("Origin", request.headers.get("Origin") || "*");
        request.headers.set("Referer", request.url);
        const res = await fetch(request);
        res.headers.delete("Set-Cookie");
        return res;
    })
    .addRoute(xget.fetch);

export default {
    fetch: router.fetch,
} satisfies ExportedHandler<Env>;
