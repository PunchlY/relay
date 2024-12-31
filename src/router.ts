import { QUESTION, SLASH, createNode } from './tree';
import type { Node, ParamNode, WildcardNode } from './tree';

type Writable<T> = { -readonly [P in keyof T]: T[P]; };

const FULFILLED = Symbol('FULFILLED');

const Method = ['GET', 'DELETE', 'PUT', 'POST', 'PATCH', 'ALL'] as const;
type Method = typeof Method[number];

function newResponse(response: Response, set?: Context['set']): Response;
function newResponse(body: BodyInit | null, set?: Context['set']): Response;
function newResponse(data: number | bigint | string | object, set?: Context['set']): Response;
function newResponse(data?: undefined, set?: Context['set']): Response;
function newResponse(data: unknown, set?: Context['set']): Response;
function newResponse(data: unknown, set?: Context['set']) {
    switch (typeof data) {
        case 'string':
            return new Response(data, set);
        case 'object':
            if (data instanceof Response) {
                const headers = new Headers(data.headers), status = set?.status ?? data.status, statusText = set?.statusText ?? data.statusText;
                for (const name in set?.headers)
                    headers.set(name, set.headers[name]);
                return new Response(data.body, { headers, status, statusText });
            }
            if (data === null || data instanceof Blob || data instanceof ReadableStream || data instanceof FormData || data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof URLSearchParams || data instanceof FormData)
                return new Response(data, set);
            break;
    }
    return Response.json(data, set);
}

interface Context<E = unknown, C = unknown, S = {}> {
    readonly request: Request;
    readonly env: E;
    readonly executionCtx: C;
    readonly pathIndex: number;
    readonly routeIndex: number;
    readonly searchIndex: number;
    readonly set: {
        readonly headers: Record<string, string>;
        status?: number;
        statusText?: string;
    };
    readonly store: S;
};

type Handler<E = unknown, C = unknown, S = {}, T = {}, R = unknown> = (context: Context<E, C, S> & T) => R;
function Handler(handler: Function): Handler;
function Handler(handler: unknown): Response;
function Handler(handler: unknown): Handler | Response {
    if (typeof handler !== 'function')
        return newResponse(handler);
    return handler as Handler;
}

type Handlers = Map<string, {
    data: Handler | Response;
    paramNames?: string[];
}>;

interface Meta {
    deep?: number;
    part?: [number[], Node<Meta>];
    fail?: Node<Meta>;

    handlers?: Handlers;

    store?: Record<string, any>;
    decorator?: Record<string, any>;
    onRequests?: Handler[];
    derive?: Handler[];
    notFounds?: (Handler | Response)[];
    onResponses?: Handler[];
}

function build(root: Node<Meta>, mode: number, buildList = new Set<Node<Meta>>()) {
    if (buildList.has(root))
        return root;
    buildList.add(root);
    if (mode & 0b0001 && root.size === 1) {
        const charCodeList: number[] = [];
        let node: Node<Meta> = root;
        do {
            const [charCode, next] = node.entries().next().value!;
            node = next;
            charCodeList.push(charCode);
        } while (!node.isRoot && !node.isEndpoint && !node.param && !node.wildcard && node.size === 1);
        build(node, mode);
        root.meta.part = [charCodeList, node];
    } else for (const [, node] of root) {
        build(node, mode);
    }
    if (mode & 0b0010 && root.param) {
        root.param.meta.deep = 0;
        const queue: Node<Meta>[] = [root.param];
        for (let i = 0; i < queue.length; i++) {
            const temp = queue[i];
            const deep = temp.meta.deep! + 1;
            for (const [charCode, node] of temp) {
                if (node.isRoot) {
                    build(node, mode | 0b0001);
                } else {
                    build(node, mode);
                    node.meta.deep = deep;
                    node.meta.fail = temp !== root.param && temp.meta.fail?.get(charCode) || root.param;
                    queue.push(node);
                }
            }
        }
    }
    return root;
}

function buildFetch<E, C>(root: Node<Meta>) {
    if (!root.isRoot)
        throw new Error();
    root = build(root.clean(), 0b0011);
    interface Ctx extends Writable<Context> {
        params?: Record<string, string>;
        response?: Response;
    }
    return async (request: Request, env: E, executionCtx: C) => {
        const { url } = request;
        let pathIndex = url.indexOf(':') + 1, start: number, { length } = url;
        PARSE: if (url.charCodeAt(pathIndex) === SLASH) {
            if (url.charCodeAt(pathIndex + 1) === SLASH) {
                for (pathIndex += 2; pathIndex < length; pathIndex++) {
                    const charCode = url.charCodeAt(pathIndex);
                    if (charCode === SLASH) {
                        const searchIndex = url.indexOf('?', start = pathIndex + 1);
                        if (searchIndex !== -1) length = searchIndex;
                        break PARSE;
                    }
                    if (charCode === QUESTION)
                        break;
                }
                length = start = pathIndex;
            } else {
                const searchIndex = url.indexOf('?', start = pathIndex + 1);
                if (searchIndex !== -1) length = searchIndex;
            }
        } else {
            const searchIndex = url.indexOf('?', start = pathIndex);
            if (searchIndex !== -1) length = searchIndex;
        }
        const ctx: Ctx = {
            request,
            env,
            executionCtx,
            pathIndex,
            routeIndex: start,
            searchIndex: length,
            store: {},
            set: { headers: {} },
        };
        const route = find(ctx, root, request.method, url, length, start);
        let fulfilled = false;
        for (let result = await route.next(); !result.done;) {
            if (typeof result.value === 'undefined') {
                result = await route.next();
                continue;
            }
            if (result.value !== FULFILLED)
                ctx.response = newResponse(result.value, ctx.set);
            result = fulfilled ? await route.next() : (fulfilled = true, await route.return());
        }
        return ctx.response!;
    };
    async function* response(ctx: Ctx, handlers: Handlers, method: string, url: string, paramFragment?: [number, number][]) {
        const handler = handlers.get(method) || method === 'HEAD' && handlers.get('GET') || handlers.get('ALL');
        if (!handler)
            return;
        const { data, paramNames } = handler;
        if (typeof data === 'function') {
            if (paramNames && paramFragment) {
                ctx.params = {};
                for (const [i, name] of paramNames.entries())
                    ctx.params[name] = String.prototype.slice.apply(url, paramFragment[i]);
            }
            yield data(ctx as Context);
        } else {
            ctx.response = data.clone();
            yield FULFILLED;
        }
    }
    async function* find(ctx: Ctx, root: Node<Meta>, method: string, url: string, length: number, start: number): AsyncGenerator<unknown, void> {
        try {
            if (root.isRoot) {
                ctx.routeIndex = start;
                if (root.meta.store)
                    Object.assign(ctx.store, root.meta.store);
                if (root.meta.decorator)
                    Object.assign(ctx, root.meta.decorator);
                if (root.meta.onRequests?.length)
                    for (const handler of root.meta.onRequests)
                        yield handler(ctx);
                if (root.meta.derive?.length)
                    for (const handler of root.meta.derive)
                        Object.assign(ctx, await handler(ctx));
            }
            if (start === length) {
                ctx.searchIndex = start;
                if (root.meta.handlers?.size)
                    yield* response(ctx, root.meta.handlers, method, url);
            } else {
                if (root.meta.part) PART: {
                    let offset = start;
                    const [charCodeList, next] = root.meta.part;
                    for (const charCode of charCodeList) {
                        if (offset < length && url.charCodeAt(offset++) === charCode)
                            continue;
                        break PART;
                    }
                    yield* find(ctx, next, method, url, length, offset);
                } else {
                    const next = root.get(url.charCodeAt(start));
                    if (next)
                        yield* find(ctx, next, method, url, length, start + 1);
                }
                if (root.param && url.charCodeAt(start) !== SLASH)
                    yield* findParam(ctx, root.param, root.param, method, url, length, start, start + 1, 0, 0, []);
                if (root.wildcard)
                    yield* findWildcard(ctx, root.wildcard, method, url, length, start, 0, []);
            }
            if (root.isRoot) {
                if (root.meta.notFounds?.length) for (const handler of root.meta.notFounds)
                    if (typeof handler !== 'function') {
                        ctx.response = handler.clone();
                        yield FULFILLED;
                    } else {
                        yield handler(ctx);
                    }
                ctx.response = new Response(null, { status: 404 });
                yield FULFILLED;
            }
        } finally {
            if (root.isRoot && root.meta.onResponses?.length)
                for (const handler of root.meta.onResponses) {
                    ctx.set = { headers: {} };
                    yield handler(ctx);
                }
        }
    }
    async function* findParam(ctx: Ctx, root: ParamNode<Meta>, node: Node<Meta>, method: string, url: string, length: number, start: number, offset: number, slashIndex: number, paramIndex: number, paramFragment: [number, number][], set?: Set<Node<Meta>>): AsyncGenerator<unknown, void> {
        for (let charCode; offset < length; offset++) {
            let cnode = node.get(charCode = url.charCodeAt(offset));
            while (!cnode && node !== root) {
                node = node.meta.fail!;
                cnode = node.get(charCode);
            }
            if (cnode)
                node = cnode;
            if (!slashIndex && charCode === SLASH)
                slashIndex = offset;
            if (slashIndex && slashIndex <= offset - node.meta.deep!)
                return;
            if (node.param || node.wildcard) {
                if (set?.has(node))
                    continue;
                (set ??= new Set()).add(node);
                if (node.size || node.meta.handlers?.size)
                    yield* findParam(ctx, root, node, method, url, length, start, offset + 1, slashIndex, paramIndex, paramFragment, set);
                paramFragment[paramIndex] = [start, offset - node.meta.deep! + 1];
                if (node.param && offset + 1 < length && (charCode = url.charCodeAt(offset + 1)) !== SLASH)
                    yield* findParam(ctx, node.param, node.param, method, url, length, offset + 1, offset + 2, 0, paramIndex + 1, paramFragment, set);
                if (node.wildcard)
                    yield* findWildcard(ctx, node.wildcard, method, url, length, offset, paramIndex + 1, paramFragment);
                return;
            }
        }
        while (!node.meta.handlers?.size && node !== root)
            node = node.meta.fail!;
        if (slashIndex && slashIndex < offset - node.meta.deep!)
            return;
        if (!node.meta.handlers?.size)
            return;
        paramFragment[paramIndex] = [start, offset - node.meta.deep!];
        yield* response(ctx, node.meta.handlers, method, url, paramFragment);
    }
    async function* findWildcard(ctx: Ctx, { meta: { handlers } }: WildcardNode<Meta>, method: string, url: string, length: number, start: number, paramIndex: number, paramFragment: [number, number][]): AsyncGenerator<unknown, void> {
        if (!handlers?.size)
            return;
        paramFragment[paramIndex] = [start, length];
        yield* response(ctx, handlers, method, url, paramFragment);
    }
}

interface Router<E, C, S, T> extends Record<Lowercase<Method>, {
    (path: string, handler: Handler<E, C, S, T & {
        readonly params: Readonly<Record<string, string>>;
    }>): Router<E, C, S, T>;
    (path: string, data: unknown): Router<E, C, S, T>;
}> { }
class Router<E = void, C = void, S = {}, T = {}> {
    #node = createNode<Meta>();
    mount(path: string, tree: Router<E, C, any, any>) {
        this.#node.mount(path, tree.#node);
        return this;
    }
    state<K extends string, V>(name: K, data: V): Router<E, C, S & Record<K, V>, T> {
        (this.#node.meta.store ??= {})[name] = data;
        return this as Router<E, C, any, T>;
    }
    decorate<K extends string, V>(name: K, data: V): Router<E, C, S, T & Record<K, V>> {
        (this.#node.meta.decorator ??= {})[name] = data;
        return this as Router<E, C, S, any>;
    }
    onRequest(handler: Handler<E, C, S, T>) {
        if (typeof handler !== 'function')
            throw new Error();
        (this.#node.meta.onRequests ??= []).push(Handler(handler));
        return this;
    }
    derive<R>(handler: Handler<E, C, S, T, R | PromiseLike<R>>): Router<E, C, S, T & R> {
        if (typeof handler !== 'function')
            throw new Error();
        (this.#node.meta.derive ??= []).push(handler as Handler);
        return this as Router<E, C, S, any>;
    }
    on(method: Method, path: string, handler: Handler<E, C, S, T & {
        readonly params: Readonly<Record<string, string>>;
    }>): this;
    on(method: Method, path: string, data: unknown): this;
    on(method: string, path: string, handler: Handler<E, C, S, T & {
        readonly params: Readonly<Record<string, string>>;
    }>): this;
    on(method: string, path: string, data: unknown): this;
    on(method: string, path: string, handler: unknown) {
        const { node, paramNames } = this.#node.init(path);
        const handlers: Handlers = node.meta.handlers ??= new Map();
        method = method.toUpperCase();
        if (handlers.has(method))
            throw new Error();
        handlers.set(method, {
            data: Handler(handler),
            paramNames,
        });
        return this;
    }
    notFound(handler: Handler<E, C, S, T>): this;
    notFound(data: unknown): this;
    notFound(handler: Handler<E, C, S, T & {
        readonly params: Readonly<Record<string, string>>;
    }>) {
        (this.#node.meta.notFounds ??= []).push(Handler(handler));
        return this;
    }
    onResponse(handler: Handler<E, C, S, T & {
        readonly params: Readonly<Record<string, string>>;
        readonly response: Response;
    }>) {
        if (typeof handler !== 'function')
            throw new Error();
        (this.#node.meta.onResponses ??= []).push(Handler(handler));
        return this;
    }
    *[Symbol.iterator]() {
        for (const [raw, { handlers }] of this.#node.metaList()) {
            if (!handlers)
                continue;
            for (const [method, { paramNames }] of handlers)
                yield [method, String.raw({ raw }, ...(paramNames || []).map((name) => name.replace(/^[a-zA-Z]/, ':$&'))) as `/${string}`] as const;
        }
    }
    get fetch() {
        return buildFetch<E, C>(this.#node);
    }
}
for (const method of Method) {
    Router.prototype[method.toLowerCase() as Lowercase<Method>] = function (path: string, data: unknown) {
        return Router.prototype.on.call(this, method, path, data);
    };
}

export { Method, Router, newResponse, FULFILLED };
export type { Context, Handler };
