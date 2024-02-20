
export default {
    async fetch(request: Request) {
        const url = new URL(request.url.replace(/^https?:\/\/.*?\//, ''));
        const { method, body } = request;

        if (request.method === 'OPTIONS') {
            return new Response(JSON.stringify({
                code: 0,
                usage: 'Host/{URL}',
            }), {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Allow-Headers') || 'Accept, Authorization, Cache-Control, Content-Type, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, Token, x-access-token',
                    'Content-Type': 'application/json',
                },
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

        res.headers.set('Access-Control-Allow-Origin', '*');
        res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Allow-Headers') || 'Accept, Authorization, Cache-Control, Content-Type, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, Token, x-access-token');

        return res;
    },
};
