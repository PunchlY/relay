import { Router } from './router';

interface Env {
    // ASSETS: Fetcher;
}

const app = new Router<Env, ExecutionContext & { to: string; }>()
    .get('/', () => {
        let text = '';
        for (const [method, path] of app)
            text += `${method} ${path}\n`;
        return new Response(text);
    })
    .onRequest((ctx) => {
        ctx.to = ctx.request.url.slice(ctx.routeIndex);
    })
    .get('https://img.hellogithub.com/*', ({ request, to }) => {
        request = new Request(to, request);
        request.headers.set('Referer', 'https://hellogithub.com/');
        return fetch(request);
    })
    .get('https://:prefix.sinaimg.cn/*', ({ request, to }) => {
        request = new Request(to, request);
        request.headers.set('Referer', 'https://weibo.com/');
        return fetch(request);
    })
    .get('https://:prefix.csdnimg.cn/*', ({ request, to }) => {
        request = new Request(to, request);
        request.headers.set('Referer', 'https://csdn.net/');
        return fetch(request);
    })
    .get('https://*', ({ request, to }) => {
        request = new Request(to, request);
        request.headers.set('Referer', to);
        return fetch(request);
    })
    .get('http://*', ({ request, to }) => {
        request = new Request(to, request);
        request.headers.set('Referer', to);
        return fetch(request);
    });

export default {
    fetch: app.fetch,
};
