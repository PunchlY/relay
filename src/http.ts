import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { StatusCode } from 'hono/utils/http-status';

const app = new Hono<{
    Variables: {
        url: string;
    };
}>().basePath(':protocol{http(s?):}//');

app.get(async (c, next) => {
    c.set('url', c.req.url.substring(c.req.url.indexOf('/', 8) + 1));
    await next();
});

app.get('img.hellogithub.com/*', $fetch({
    headers: { Referer: 'https://hellogithub.com/' },
}));

app.get(':host{.+\\.sinaimg\\.cn}/*', $fetch({
    headers: { Referer: 'https://weibo.com/' },
}));

app.get($fetch());

function $fetch(init?: RequestInit<RequestInitCfProperties>) {
    return createMiddleware<{
        Variables: {
            url: string;
        };
    }>(async (c) => {
        const _headers = new Headers(init?.headers);

        const range = c.req.header('Range');
        range && _headers.set('Range', range);

        const { body, status, headers } = await fetch(c.var.url, {
            ...init,
            headers: _headers,
            method: c.req.method,
        });
        const newHeaders = Object.fromEntries(headers.entries());
        return c.newResponse(body as ReadableStream, status as StatusCode, newHeaders);
    });
}

export default app;
