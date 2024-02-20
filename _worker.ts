
export default {
    async fetch(request: Request) {

        const resHeaders = new Headers({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': request.headers.get('Access-Control-Allow-Headers') || 'Accept, Authorization, Cache-Control, Content-Type, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, Token, x-access-token',
        });

        try {
            const url = new URL(request.url.replace(/^https?:\/\/.*?\//, ''));
            const { method, body } = request;
            if (request.method === 'OPTIONS') {
                resHeaders.set('Content-Type', 'application/json');
                return new Response(JSON.stringify({
                    code: 0,
                    usage: 'Host/{URL}',
                }), {
                    status: 200,
                    headers: resHeaders,
                });
            }

            const dropHeaders = [
                'Content-Length',
                'Content-Type',
                'Host',
                'Referer',
            ] as const;

            const headers = new Headers();

            for (const key of dropHeaders)
                if (request.headers.has(key))
                    headers.set(key, request.headers.get(key)!);

            if (url.hostname.endsWith('.sinaimg.cn'))
                headers.set('Referer', 'https://weibo.com/');
            else if (url.hostname === 'img.hellogithub.com')
                headers.set('Referer', 'https://hellogithub.com/');

            const res = await fetch(url, { method, headers, body });

            for (const [key, value] of res.headers) {
                if (resHeaders.has(key))
                    continue;
                resHeaders.set(key, value);
            }

            return new Response(await res.arrayBuffer(), {
                status: 200,
                headers: resHeaders,
            });
        } catch (err) {
            resHeaders.set('Content-Type', 'application/json');
            if (err instanceof Error)
                err = err.stack || err.message;
            return new Response(JSON.stringify({
                code: -1,
                msg: err
            }), {
                status: 500,
                headers: resHeaders,
            });
        }
    },
};
