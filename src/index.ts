import { PatternRouter } from "./router";

interface Env {
    // ASSETS: Fetcher;
}

const proxyRouter = new PatternRouter<Env>()
    // .addRoute("GET", "https://img.hellogithub.com", ({ request }) => {
    //     request.headers.set('Referer', 'https://hellogithub.com/');
    //     return fetch(request);
    // })
    // .addRoute("GET", "https://*.sinaimg.cn", ({ request }) => {
    //     request.headers.set('Referer', 'https://weibo.com/');
    //     return fetch(request);
    // })
    // .addRoute("GET", "https://*.csdnimg.cn", ({ request }) => {
    //     request.headers.set('Referer', 'https://csdn.net/');
    //     return fetch(request);
    // })
    .addRoute(({ request }) => {
        request.headers.set('Referer', request.url);
        return fetch(request);
    });

const router = new PatternRouter<Env>()
    .addRoute("GET", { pathname: "/" }, () => {
        return new Response("hello");
    })
    .addRoute({ pathname: "/(https?://.+)" }, ({ request, env, ctx, pattern }) => {
        let url = pattern.pathname.groups[0];
        const search = pattern.search.input;
        if (search) {
            url += `?${search}`;
        }
        return proxyRouter.fetch(new Request(url, request), env, ctx);
    });

export default {
    fetch: router.fetch,
} satisfies ExportedHandler<Env>;
