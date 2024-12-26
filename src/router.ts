import { SLASH, QUESTION, HASH, createNode } from './tree';
import type { Node, ParamNode, WildcardNode } from './tree';

const Method = ['GET', 'DELETE', 'PUT', 'POST', 'PATCH', 'ALL'] as const;
type Method = typeof Method[number];

const AsyncGeneratorFunction = (async function* () { }).constructor as AsyncGeneratorFunctionConstructor;
const GeneratorFunction = (function* () { }).constructor as GeneratorFunctionConstructor;

function newResponse(response: Response, init?: ResponseInit): Response;
function newResponse(stream?: (...args: any[]) => AsyncGenerator, init?: ResponseInit): Response;
function newResponse(body: BodyInit | null, init?: ResponseInit): Response;
function newResponse(data: number | bigint | string | object, init?: ResponseInit): Response;
function newResponse(data?: undefined, init?: ResponseInit): Response;
function newResponse(data: unknown, init?: ResponseInit): Response;
function newResponse(data: unknown, init?: ResponseInit) {
    switch (typeof data) {
        case 'string':
            return new Response(data, init);
        case 'object':
            if (data instanceof Response)
                return new Response(data.body, init);
            if (data === null || data instanceof Blob || data instanceof ReadableStream || data instanceof FormData || data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof URLSearchParams || data instanceof FormData)
                return new Response(data, init);
            break;
        case 'undefined':
            return new Response(null, init);
        case 'function':
            if (data instanceof AsyncGeneratorFunction)
                return new Response(data as any, init);
            break;
    }
    return Response.json(data, init);
}

type Context<E = unknown, C = {}> = {
    readonly request: Request;
    readonly env: E;
    readonly pathIndex: number;
    readonly routeIndex: number;
    readonly searchIndex: number;
    readonly params: Readonly<Record<string, string>>;
    readonly set: ResponseInit;
} & C;

type Handler<E = unknown, C = {}> = (context: Context<E, C>) => unknown;

interface Handlers extends Map<string, { handler: Handler | Response, paramNames?: string[]; }> {
}
interface Meta {
    deep?: number;
    part?: [number[], Node<Meta>];
    fail?: Node<Meta>;
    handlers?: Handlers;
    onRequest?: Handler;
    onResponse?: Handler;
    notFound?: Handler;
}

function build(root: Node<Meta>, mode = -1, buildList = new Set<Node<Meta>>()) {
    if (buildList.has(root))
        return;
    buildList.add(root);
    if (mode & 1 && root.size === 1) {
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
    if (mode & 2 && root.param) {
        root.param.meta.deep = 0;
        const queue: Node<Meta>[] = [root.param];
        for (let i = 0; i < queue.length; i++) {
            const temp = queue[i];
            const deep = temp.meta.deep! + 1;
            for (const [charCode, node] of temp) {
                if (node.isRoot) {
                    build(node, mode | 1);
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

function buildFetch<E, C>(root: Node<Meta>, newResponse: (data: unknown, init?: ResponseInit) => Response | PromiseLike<Response>): (request: Request, env: E, ctx: C) => Promise<Response>;
function buildFetch(root: Node<Meta>, newResponse: (data: unknown, init?: ResponseInit) => Response | PromiseLike<Response>) {
    type Writable<T> = { -readonly [P in keyof T]: T[P]; };
    interface Ctx extends Writable<Context> {
        params: Record<string, string>;
        response?: Response;
    }
    const STATIC = Symbol('STATIC');
    return async (request: Request, env: unknown, ctx = {} as Ctx) => {
        const { url, url: { length } } = request;
        for (let offset = 0, count = 0; offset <= length; offset++) {
            if (url.charCodeAt(offset) === SLASH)
                count++;
            if (count !== 3)
                continue;
            ctx.request = request;
            ctx.env = env;
            ctx.pathIndex = offset;
            ctx.params = {};
            ctx.set = {};
            const route = find(ctx, root, offset + 1, 0, []);
            for await (const response of route) {
                if (typeof response === 'undefined')
                    continue;
                if (response !== STATIC)
                    ctx.response = await newResponse(response, ctx.set);
                break;
            }
            await route.return();
            return ctx.response;
        }
        return newResponse(null, { status: 404 });
    };
    function onRequest(ctx: Ctx, handler: Handler, paramNames?: string[], paramFragment?: [number, number][]) {
        if (paramNames && paramFragment) {
            const { url } = ctx.request, index = paramFragment.length - paramNames.length;
            for (const [i, name] of paramNames.entries())
                ctx.params[name] = String.prototype.slice.apply(url, paramFragment[i + index]);
        }
        return handler(ctx as Context);
    }
    async function* response(ctx: Ctx, handlers: Handlers, { notFound }: Meta, paramFragment?: [number, number][]) {
        const { method } = ctx.request;
        const data = handlers.get(method) || method === 'HEAD' && handlers.get('GET') || handlers.get('ALL');
        if (!data)
            return;
        const { handler, paramNames } = data;
        if (typeof handler !== 'function') {
            ctx.response = handler.clone();
            yield STATIC;
        } else
            yield onRequest(ctx, handler, paramNames, paramFragment);
        if (notFound)
            yield notFound(ctx);
        ctx.set.status = 404;
        yield null;
    }
    async function* find(ctx: Ctx, root: Node<Meta>, start: number, paramIndex: number, paramFragment: [number, number][]): AsyncGenerator<unknown, void> {
        try {
            const { url } = ctx.request, length = ctx.searchIndex ?? url.length;
            if (root.isRoot) {
                ctx.routeIndex = start;
                if (root.meta.onRequest) {
                    if (!ctx.searchIndex)
                        for (ctx.searchIndex = start; ctx.searchIndex < length && url.charCodeAt(ctx.searchIndex) !== QUESTION && url.charCodeAt(ctx.searchIndex) !== HASH; ctx.searchIndex++);
                    yield onRequest(ctx, root.meta.onRequest);
                }
            }
            if (start === length || url.charCodeAt(start) === QUESTION || url.charCodeAt(start) === HASH) {
                ctx.searchIndex = start;
                if (root.meta.handlers?.size)
                    yield* response(ctx, root.meta.handlers, root.root.meta, undefined);
            } else {
                if (root.meta.part) PART: {
                    let offset = start;
                    const [charCodeList, next] = root.meta.part;
                    for (const charCode of charCodeList) {
                        if (offset < length && url.charCodeAt(offset++) === charCode)
                            continue;
                        break PART;
                    }
                    yield* find(ctx, next, offset, paramIndex, paramFragment);
                } else {
                    const next = root.get(url.charCodeAt(start));
                    if (next)
                        yield* find(ctx, next, start + 1, paramIndex, paramFragment);
                }
                if (root.param && url.charCodeAt(start) !== SLASH)
                    yield* findParam(ctx, root.param, root.param, start, start + 1, 0, paramIndex, paramFragment);
                if (root.wildcard)
                    yield* findWildcard(ctx, root.wildcard, start, paramIndex, paramFragment);
            }
            if (root.isRoot) {
                if (root.meta.notFound) {
                    if (!ctx.searchIndex)
                        for (ctx.searchIndex = start; ctx.searchIndex < length && url.charCodeAt(ctx.searchIndex) !== QUESTION && url.charCodeAt(ctx.searchIndex) !== HASH; ctx.searchIndex++);
                    yield root.meta.notFound(ctx);
                }
                ctx.set.status = 404;
                yield null;
            }
        } finally {
            if (root.isRoot && root.meta.onResponse && ctx.response) try {
                ctx.set = {};
                const response = await onRequest(ctx, root.meta.onResponse);
                if (typeof response !== 'undefined')
                    ctx.response = await newResponse(response);
            } catch (err) {
                ctx.response = undefined;
                throw err;
            }
        }
    }
    async function* findParam(ctx: Ctx, root: ParamNode<Meta>, node: Node<Meta>, start: number, offset: number, slashIndex: number, paramIndex: number, paramFragment: [number, number][], set?: Set<Node<Meta>>): AsyncGenerator<unknown, void> {
        const { url } = ctx.request, length = ctx.searchIndex ?? url.length;
        for (let charCode; offset < length && (charCode = url.charCodeAt(offset)) !== QUESTION && charCode !== HASH; offset++) {
            let cnode = node.get(charCode);
            while (!cnode && node !== root) {
                node = node.meta.fail!;
                cnode = node.get(charCode);
            }
            if (cnode)
                node = cnode;
            if (node.isRoot) {
                paramFragment[paramIndex] = [start, offset - node.meta.deep! + 1];
                yield* find(ctx, node, offset + 1, paramIndex + 1, paramFragment);
                return;
            }
            if (!slashIndex && charCode === SLASH)
                slashIndex = offset;
            if (slashIndex && slashIndex <= offset - node.meta.deep!)
                return;
            if (node.param || node.wildcard) {
                if (set?.has(node))
                    continue;
                (set ??= new Set()).add(node);
                if (node.size || node.meta.handlers?.size)
                    yield* findParam(ctx, root, node, start, offset + 1, slashIndex, paramIndex, paramFragment, set);
                paramFragment[paramIndex] = [start, offset - node.meta.deep! + 1];
                if (node.param && offset + 1 < length && (charCode = url.charCodeAt(offset + 1)) !== SLASH && charCode !== QUESTION && charCode !== HASH)
                    yield* findParam(ctx, node.param, node.param, offset + 1, offset + 2, 0, paramIndex + 1, paramFragment, set);
                if (node.wildcard)
                    yield* findWildcard(ctx, node.wildcard, offset, paramIndex + 1, paramFragment);
                return;
            }
        }
        ctx.searchIndex = offset;
        while (!node.meta.handlers?.size && node !== root)
            node = node.meta.fail!;
        if (slashIndex && slashIndex < offset - node.meta.deep!)
            return;
        if (!node.meta.handlers?.size)
            return;
        paramFragment[paramIndex] = [start, offset - node.meta.deep!];
        yield* response(ctx, node.meta.handlers, node.root.meta, paramFragment);
    }
    async function* findWildcard(ctx: Ctx, { meta: { handlers }, root: { meta } }: WildcardNode<Meta>, start: number, paramIndex: number, paramFragment: [number, number][]): AsyncGenerator<unknown, void> {
        const { url } = ctx.request, length = ctx.searchIndex ?? url.length;
        if (!handlers?.size)
            return;
        if (!ctx.searchIndex)
            for (ctx.searchIndex = start; ctx.searchIndex < length && url.charCodeAt(ctx.searchIndex) !== QUESTION && url.charCodeAt(ctx.searchIndex) !== HASH; ctx.searchIndex++);
        paramFragment[paramIndex] = [start, ctx.searchIndex];
        yield* response(ctx, handlers, meta, paramFragment);
    }
}

function stream(handler: GeneratorFunction | AsyncGeneratorFunction) {
    const next: () => Promise<IteratorResult<unknown, any>> | IteratorResult<unknown, any> = (handler instanceof GeneratorFunction ? GeneratorFunction : AsyncGeneratorFunction).prototype.prototype.next;
    return async (ctx: Context) => {
        const stream = handler(ctx);
        const { value, done } = await next.call(stream);
        if (done)
            return value;
        return async function* () { yield value, yield* stream; };
    };
}
function handlerType(handler: unknown): Handler {
    if (typeof handler !== 'function')
        throw new Error();
    if (handler instanceof AsyncGeneratorFunction || handler instanceof GeneratorFunction)
        handler = stream(handler);
    return handler as Handler;
}

interface Router<E, C = {}> extends Record<Lowercase<Method>, {
    (path: string, handler: Handler<E, C>): Router<E, C>;
    (path: string, data: unknown): Router<E, C>;
}> { }
class Router<E = unknown, C = {}> {
    #node = createNode<Meta>();
    constructor(public evaluate = false) {
    }
    on(method: Method, path: string, handler: Handler<E, C>): this;
    on(method: Method, path: string, data: unknown): this;
    on(method: string, path: string, handler: Handler<E, C>): this;
    on(method: string, path: string, data: unknown): this;
    on(type: string, path: string, handler: any) {
        const { node, paramNames } = this.#node.init(path);
        const handlers: Handlers = node.meta.handlers ??= new Map();
        const method = type.toUpperCase();
        if (handlers.has(method))
            throw new Error();
        if (typeof handler !== 'function')
            handler = newResponse(handler);
        else if (handler instanceof AsyncGeneratorFunction || handler instanceof GeneratorFunction)
            handler = stream(handler);
        handlers.set(method, {
            handler,
            paramNames,
        });
        return this;
    }
    mount<E1 extends E, C1 extends C>(path: string, tree: Router<E1, C1>) {
        this.#node.mount(path, tree.#node);
        return this;
    }
    onRequest(handler: Handler<E, C>) {
        if (this.#node.meta.onRequest)
            throw new Error();
        this.#node.meta.onRequest = handlerType(handler);
        return this;
    }
    notFound(handler: Handler<E, C>) {
        if (this.#node.meta.notFound)
            throw new Error();
        this.#node.meta.notFound = handlerType(handler);
        return this;
    }
    onResponse(handler: Handler<E, C & { readonly response: Response; }>) {
        if (this.#node.meta.onResponse)
            throw new Error();
        this.#node.meta.onResponse = handlerType(handler);
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
        build(this.#node.clean());
        return buildFetch<E, C>(this.#node, newResponse);
    }
}
for (const method of Method) {
    Router.prototype[method.toLowerCase() as Lowercase<Method>] = function (path: string, data: unknown) {
        return Router.prototype.on.call(this, method, path, data);
    };
}

export { Method, Router, newResponse };
export type { Context, Handler };
