import { Hono } from 'hono';

const app = new Hono();

app.get('/age.tv/m3u8/:play', async (c) => {
    const { play } = c.req.param();
    const url = new URL(`https://43.240.156.118:8443/m3u8`);
    url.searchParams.set('url', play);
    const res = await fetch(url);
    const text = await res.text();
    const playUrl = text.match(/var Vurl = ('|")(.+?)\1/)![2];
    if (import.meta.env.DEV)
        return c.text('play ' + playUrl);
    return c.redirect(playUrl);
});

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
    const url = c.req.url.substring(c.req.url.indexOf('/', 8) + 1);
    if (import.meta.env.DEV)
        return c.text('back ' + url);
    return c.redirect(url);
});

export default app;
