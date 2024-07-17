import { Hono } from 'hono';
import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';

const app = new Hono<{
    Variables: {
        url: string;
    };
}>().basePath(':protocol{http(s?):}//');

app.use(async (c, next) => {
    switch (c.req.method) {
        case 'GET':
        case 'HEAD': break;
        default: return c.status(405);
    }
    c.set('url', c.req.url.substring(c.req.url.indexOf('/', 8) + 1));
    await next();
});

app.use('img.hellogithub.com/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://hellogithub.com/' },
    });
});

app.use(':host{.+\\.sinaimg\\.cn}/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://weibo.com/' },
    });
});

app.use(':host{.+\\.csdnimg\\.cn}/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://blog.csdn.net/' },
    });
});

app.use('developer.qcloudimg.com/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://cloud.tencent.com/' },
    });
});

app.use('*', async (c) => {
    if (import.meta.env.DEV)
        return c.text('Back: ' + c.var.url);
    return c.redirect(c.var.url);
});

async function $fetch(c: Context, input: RequestInfo, init?: RequestInit<RequestInitCfProperties>) {
    const _headers = new Headers(init?.headers);

    const range = c.req.header('Range');
    range && _headers.set('Range', range);

    const { body, status, headers } = await fetch(input, {
        ...init,
        headers: _headers,
        method: c.req.method,
    });
    const newHeaders = Object.fromEntries(headers.entries());
    return c.newResponse(body as ReadableStream, status as StatusCode, newHeaders);
}

export default app;
