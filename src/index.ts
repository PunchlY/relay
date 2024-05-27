import { Hono } from 'hono';

const app = new Hono();

app.get('/:protocol{http(s?):}//img.hellogithub.com/*', async (c) => {
    const url = c.req.path.substring(1);
    const res = await fetch(url, {
        headers: {
            Referer: 'https://hellogithub.com/',
        },
    });
    return c.newResponse(await res.arrayBuffer(), {
        headers: res.headers,
    });
});

app.get('/:protocol{http(s?):}//:host{.+\\.sinaimg\\.cn}/*', async (c) => {
    const url = c.req.path.substring(1);
    const res = await fetch(url, {
        headers: {
            Referer: 'https://weibo.com/',
        },
    });
    return c.newResponse(await res.arrayBuffer(), {
        headers: res.headers,
    });
});

app.get('/:protocol{http(s?):}//:host/*', (c) => {
    const url = c.req.path.substring(1);
    if (import.meta.env.DEV)
        return c.text('back ' + url);
    return c.redirect(url);
});

export default app;
