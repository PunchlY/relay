import { Hono } from 'hono';
import { cache } from 'hono/cache';

const app = new Hono();

app.get('*', cache({
    cacheName: 'my-app',
    cacheControl: 'max-age=604800',
}));

app.get('/', async (c) => {
    return c.text('hello.');
});

app.get('/:protocol{http(s?):}//img.hellogithub.com/*', async (c) => {
    return fetch(c.req.path.substring(1), {
        headers: {
            Referer: 'https://hellogithub.com/',
        },
    });
});

app.get('/:protocol{http(s?):}//:host{.+\\.sinaimg\\.cn}/*', async (c) => {
    return fetch(c.req.path.substring(1), {
        headers: {
            Referer: 'https://weibo.com/',
        },
    });
});

app.get('/:protocol{http(s?):}//img-blog.csdnimg.cn/*', async (c) => {
    return fetch(c.req.path.substring(1));
});

app.get('/:protocol{http(s?):}//:host/*', (c) => {
    const url = c.req.url.substring(c.req.url.indexOf('/', 8) + 1);
    if (import.meta.env.DEV)
        return c.text('back ' + url);
    return c.redirect(url);
});

export default app;
