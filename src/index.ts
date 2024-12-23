import { Router } from './router';

interface Env {
    // ASSETS: Fetcher;
}

const app = new Router<Env, ExecutionContext>()
    .get('/', () => {
        let text = '';
        for (const [method, path] of app)
            text += `${method} ${path}\n`;
        return text;
    })
    .mount('https://', new Router<Env, ExecutionContext & { to: string; }>()
        .onRequest((ctx) => {
            ctx.to = `https://${ctx.request.url.slice(ctx.routeIndex)}`;
        })
        .get('img.hellogithub.com/*', ({ request, to }) => {
            request = new Request(to, request);
            request.headers.set('Referer', 'https://hellogithub.com/');
            return fetch(request);
        })
        .get(':prefix.sinaimg.cn/*', ({ request, to }) => {
            request = new Request(to, request);
            request.headers.set('Referer', 'https://weibo.com/');
            return fetch(request);
        })
        .get(':prefix.csdnimg.cn/*', ({ request, to }) => {
            request = new Request(to, request);
            request.headers.set('Referer', 'https://csdn.net/');
            return fetch(request);
        })
        .get('*', ({ request, to }) => {
            request = new Request(to, request);
            request.headers.set('Referer', to);
            return fetch(request);
        })
    );

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.method !== 'GET')
            return app.fetch(request, env, ctx);
        const cache = caches.default;
        let response = await cache.match(request.url);
        if (response)
            return response;
        response = await app.fetch(request, env, ctx);
        response.headers.delete('Set-Cookie');
        ctx.waitUntil(cache.put(request.url, response.clone()));
        return response;
    },
};
