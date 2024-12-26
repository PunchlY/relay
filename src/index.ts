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
    .mount('https://', new Router<Env, ExecutionContext, { to: Request; }>()
        .onRequest((ctx) => {
            ctx.to = new Request(`https://${ctx.request.url.slice(ctx.routeIndex)}`);
        })
        .get('img.hellogithub.com/*', ({ to: request }) => {
            request.headers.set('Referer', 'https://hellogithub.com/');
            return fetch(request);
        })
        .get(':prefix.sinaimg.cn/*', ({ to: request }) => {
            request.headers.set('Referer', 'https://weibo.com/');
            return fetch(request);
        })
        .get(':prefix.csdnimg.cn/*', ({ to: request }) => {
            request.headers.set('Referer', 'https://csdn.net/');
            return fetch(request);
        })
        .get('*', ({ to: request }) => {
            request.headers.set('Referer', request.url);
            return fetch(request);
        })
    );

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        return app.fetch(request, env, Object.create(ctx));
    },
};
