import { Tree } from './tree';

const tree = new Tree<(url: string, headers: Headers) => Response | PromiseLike<Response>>();

tree.push('https://img.hellogithub.com/*', (url, headers) => {
    headers.set('Referer', 'https://hellogithub.com/');
    return fetch(url, { headers });
});
tree.push('https://:prefix.sinaimg.cn/*', (url, headers) => {
    headers.set('Referer', 'https://weibo.com/');
    return fetch(url, { headers });
});
tree.push('https://:prefix.csdnimg.cn/*', (url, headers) => {
    headers.set('Referer', 'https://csdn.net/');
    return fetch(url, { headers });
});
tree.push('https://*', (url, headers) => {
    headers.set('Referer', url);
    return fetch(url, { headers });
});
tree.push('http://*', (url, headers) => {
    headers.set('Referer', url);
    return fetch(url, { headers });
});

const find = tree.compose();

export default {
    async fetch(request: Request, env: {}, ctx: ExecutionContext): Promise<Response> {
        const pathIndex = request.url.indexOf('/', 8);
        if (request.method !== 'GET' && request.method !== 'HEAD')
            return new Response(null, { status: 405 });
        return find(request.url, pathIndex)?.(request.url.slice(pathIndex + 1), new Headers(request.headers)) || new Response(null, { status: 404 });
    }
};
