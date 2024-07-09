import { Hono } from 'hono';
import { cache } from 'hono/cache';
import httpRoute from './http';

const app = new Hono();

app.get('*', cache({
    cacheName: 'relay',
    cacheControl: 'max-age=604800',
}));

app.get('/', async (c) => {
    return c.text('hello.');
});

app.route('/', httpRoute);

export default app;
