import { Router } from './router';

interface Env {
    // ASSETS: Fetcher;
}

const app = new Router<Env, ExecutionContext>()
    .get('/', () => {
        let text = '';
        for (const [method, path] of app)
            text += `${method} ${path}\n`;
        return new Response(text);
    })
    .get('https://img.hellogithub.com/*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', 'https://hellogithub.com/');
        return fetch(request);
    })
    .get('https://:prefix.sinaimg.cn/*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', 'https://weibo.com/');
        return fetch(request);
    })
    .get('https://:prefix.csdnimg.cn/*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', 'https://csdn.net/');
        return fetch(request);
    })
    .get('https://*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', request.url);
        return fetch(request);
    })
    .get('http://*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', request.url);
        return fetch(request);
    });

export default app;
