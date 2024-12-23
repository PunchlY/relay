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
    fetch: app.fetch,
};
