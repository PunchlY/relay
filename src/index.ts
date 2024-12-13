import { Router } from './router';

const app = new Router()
    .push('/', () => {
        let text = '';
        for (const [path] of app)
            text += path, text += '\n';
        return new Response(text);
    })
    .push('https://img.hellogithub.com/*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', 'https://hellogithub.com/');
        return fetch(request);
    })
    .push('https://:prefix.sinaimg.cn/*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', 'https://weibo.com/');
        return fetch(request);
    })
    .push('https://:prefix.csdnimg.cn/*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', 'https://csdn.net/');
        return fetch(request);
    })
    .push('https://*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', request.url);
        return fetch(request);
    })
    .push('http://*', ({ request, pathIndex }) => {
        request = new Request(request.url.slice(pathIndex + 1), request);
        request.headers.set('Referer', request.url);
        return fetch(request);
    });

interface Env {
    ASSETS: Fetcher;
}

const appFetch = app.compose();

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.method !== 'GET' && request.method !== 'HEAD')
            return new Response(null, { status: 405 });
        console.log(request.url);
        return await appFetch(request) ?? new Response(null, { status: 404 });
    }
};
