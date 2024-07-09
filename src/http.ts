import { Hono } from 'hono';
import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';


const app = new Hono<{
    Variables: {
        url: string;
    };
}>().basePath(':protocol{http(s?):}//');

app.use(async (c, next) => {
    c.set('url', c.req.url.substring(c.req.url.indexOf('/', 8) + 1));
    await next();
});

app.get('img.hellogithub.com/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://hellogithub.com/' },
    });
});

app.get(':host{.+\\.sinaimg\\.cn}/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://weibo.com/' },
    });
});

app.get('img-blog.csdnimg.cn/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://blog.csdn.net/' },
    });
});

app.get('developer.qcloudimg.com/*', async (c) => {
    return $fetch(c, c.var.url, {
        headers: { Referer: 'https://cloud.tencent.com/' },
    });
});

app.get(':host/*', (c) => {
    if (import.meta.env.DEV)
        return c.text('Back: ' + c.var.url);
    return c.redirect(c.var.url);
});

async function $fetch(c: Context, input: RequestInfo, init?: RequestInit<RequestInitCfProperties>) {
    const { body, status, headers } = await fetch(input, {
        ...init,
        headers: {
            ...c.req.header(),
            ...init?.headers
        }
    });
    const newHeaders = Object.fromEntries(headers.entries());
    return c.newResponse(body as ReadableStream, status as StatusCode, newHeaders);
}

export default app;
