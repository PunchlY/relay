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
    .mount('https://', new Router<Env, ExecutionContext>()
        .derive(({ request: { url, headers }, routeIndex }) => ({
            to: new Request(`https://${url.slice(routeIndex + 1)}`, { headers }),
        }))
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
    fetch: app.fetch,
};
