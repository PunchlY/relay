import { } from 'hono';

declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props?: { title?: string; }): Response;
  }
}

declare global {
  function fetch(
    input: RequestInfo,
    init?: RequestInit<RequestInitCfProperties>,
  ): Promise<Response>;
}
