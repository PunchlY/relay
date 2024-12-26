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
    .mount('https://', new Router<Env, ExecutionContext, { request: Request; }>()
        .onRequest(({ request: { url }, routeIndex, store }) => {
            store.request = new Request(`https://${url.slice(routeIndex)}`);
        })
        .get('img.hellogithub.com/*', ({ store: { request } }) => {
            request.headers.set('Referer', 'https://hellogithub.com/');
            return fetch(request);
        })
        .get(':prefix.sinaimg.cn/*', ({ store: { request } }) => {
            request.headers.set('Referer', 'https://weibo.com/');
            return fetch(request);
        })
        .get(':prefix.csdnimg.cn/*', ({ store: { request } }) => {
            request.headers.set('Referer', 'https://csdn.net/');
            return fetch(request);
        })
        .get('*', ({ store: { request } }) => {
            request.headers.set('Referer', request.url);
            return fetch(request);
        })
    );

export default {
    fetch: app.fetch,
};
