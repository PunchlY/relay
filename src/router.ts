import { SLASH, QUESTION, HASH, createNode } from './tree';
import type { Node, ParamNode, WildcardNode } from './tree';

const Method = ['GET', 'DELETE', 'PUT', 'POST', 'PATCH'] as const;
type Method = typeof Method[number];

const AsyncGeneratorFunction = (async function* () { }).constructor as AsyncGeneratorFunctionConstructor;

function newResponse(response: Response): Response;
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
                return data;
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
    readonly response?: Response;
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
        } while (!node.isEndpoint && !node.param && !node.wildcard && node.size === 1);
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

function evaluateFetch<E, C>(root: Node<Meta>) {
    interface ParamData extends Record<number, ParamData> { mount?: number, next?: number, handler?: number; }
    const values = new Map<unknown, `value_${number}`>(), paramDatas: ParamData[] = [];
    const Fetch = Function('newResponse', 'values', [...function* () {
        yield `"use strict";`;
        yield 'async function fetch(request,env,context={}){';
        yield 'const{method,url}=request;';
        yield 'let{length}=url,response;';
        yield `for(let ${offset(0)}=0,count=0;${offset(0)}<length;${offset(0)}++){`;
        yield `if(url.charCodeAt(offset_0)===${SLASH})count++;`;
        yield 'if(count!==3)continue';
        yield 'context.request=request;';
        yield 'context.env=env;';
        yield `context.pathIndex=${offset(0)};`;
        yield 'context.params={};';
        yield 'context.set={};';
        yield 'let searchIndex,charCode;';
        yield* find(root, 0, 1, []);
        yield `break}`;
        yield 'return new Response(null,{status:404})';
        yield '}';
        if (values.size) {
            yield 'const[';
            for (const name of values.values())
                yield name, yield ',';
            yield ']=values;';
        }
        if (paramDatas.length) {
            yield 'function param(data,deep=0){';
            yield 'const node=new Map(),{mount,next,handler}=data;';
            yield 'Object.assign([],data).forEach((next,charCode)=>node.set(charCode,param(next,deep+1)));';
            yield 'return Object.assign(node,{deep,mount,next,handler});';
            yield '}';
            yield 'function build(root){';
            yield 'const queue=[root];';
            yield 'for (let i=0;i<queue.length;i++){';
            yield 'const temp=queue[i];';
            yield 'for(let[charCode,node]of temp){';
            yield 'node.fail=temp!==root&&temp.fail?.get(charCode)||root;';
            yield 'queue.push(node);';
            yield '}';
            yield '}';
            yield 'return root;';
            yield '}';
            yield `const ${paramDatas.map((paramData, i) => `param_${i}=build(param(${JSON.stringify(paramData)}))`).join(',')};`;
        }
        yield 'return fetch;';
    }()].join('\n')) as (newResponse: (data: unknown, init?: ResponseInit) => Response | PromiseLike<Response>, values: unknown[]) => (request: Request, env: E, ctx: C) => Promise<Response>;
    return { Fetch, values: [...values.keys()] };
    function offset<D extends number>(depth: D): `offset_${D}`;
    function offset<D extends number, P extends number>(depth: D, offset: P): `offset_${D}+${P}`;
    function offset(depth: number, offset?: number) {
        if (typeof offset === 'undefined')
            return `offset_${depth}`;
        return `offset_${depth}+${offset}`;
    }
    function value(data: unknown) {
        if (values.has(data))
            return values.get(data)!;
        const name = `value_${values.size}` as const;
        values.set(data, name);
        return name;
    }
    function paramData(node: Node<Meta>, mountList: Node<Meta>[], nextList: Map<number, Node<Meta>>, handlersList: Handlers[]) {
        const data: ParamData = {};
        if (node.isRoot)
            data.mount = mountList.push(node);
        if (node.isRoot)
            return data;
        if (node.param || node.wildcard)
            data.next = nextList.size + 1, nextList.set(data.next, node);
        if (node.meta.handlers?.size)
            data.handler = handlersList.push(node.meta.handlers);
        for (const [charCode, child] of node) {
            const acNode = paramData(child, mountList, nextList, handlersList);
            data[charCode] = acNode;
        }
        return data;
    }
    function* param(paramNames: string[], paramCodes: string[]) {
        const index = paramCodes.length - paramNames.length;
        for (const [key, paramCode] of new Map(paramNames.map((name, i) => [name, paramCodes[i + index]])))
            yield `context.params[${JSON.stringify(key)}]=${paramCode};`;
    }
    function* onRequest(handler: ((...args: any[]) => any) | Function, paramNames?: string[], paramCodes?: string[]) {
        if (paramNames && paramCodes)
            yield* param(paramNames, paramCodes);
        yield `if(typeof (response=await ${value(handler)}(context))!=="undefined")return response=await newResponse(response,context.set);`;
    }
    function* response(handlers: Handlers, { notFound }: Meta, paramCodes?: string[]) {
        handlers = new Map(handlers);
        const HEAD = handlers.get('HEAD'), GET = handlers.get('GET'), ALL = handlers.get('ALL');
        handlers.delete('HEAD'), handlers.delete('GET'), handlers.delete('ALL');
        yield 'switch(method){';
        if (HEAD)
            yield `case"HEAD":`, yield* call(HEAD);
        else if (GET)
            yield `case"HEAD":`;
        if (GET)
            yield `case"GET":`, yield* call(GET);
        for (const [method, data] of handlers)
            yield `case${JSON.stringify(method)}:`, yield* call(data);
        if (ALL)
            yield `default:`, yield* call(ALL);
        yield '}';
        if (notFound)
            yield* onRequest(notFound);
        yield 'return response=new Response(null,{status:404})';
        function* call({ handler, paramNames }: { handler: unknown, paramNames?: string[]; }) {
            if (typeof handler === 'function') {
                yield '{';
                yield* onRequest(handler, paramNames, paramCodes);
                yield 'break}';
            } else {
                yield `return ${value(handler)}.clone();`;
            }
        }
    }
    function* find(root: Node<Meta>, depth: number, pointer: number, paramCodes: string[]): Generator<string> {
        if (root.isRoot) {
            yield `context.routeIndex=${offset(depth, pointer)};`;
            if (root.meta.onRequest) {
                yield 'if(!searchIndex){';
                yield `for(searchIndex=${offset(depth, pointer)};searchIndex<length&&(charCode=url.charCodeAt(searchIndex))!==${QUESTION}&&charCode!==${HASH};searchIndex++);`;
                yield 'context.searchIndex=length=searchIndex;';
                yield '}';
                yield* onRequest(root.meta.onRequest);
            }
        }
        if (root.meta.handlers?.size) {
            yield `if(${offset(depth, pointer)}===length||(charCode=url.charCodeAt(${offset(depth, pointer)}))===${QUESTION}||charCode===${HASH}){`;
            yield `context.searchIndex=length=${offset(depth, pointer)};`;
            yield* response(root.meta.handlers, root.root.meta, paramCodes);
            yield '}';
        }
        if (root.meta.part) {
            const [charCodeList, next] = root.meta.part;
            yield `if(${offset(depth, pointer + charCodeList.length)}<=length`;
            for (const [index, charCode] of charCodeList.entries())
                yield `&&url.charCodeAt(${offset(depth, pointer + index)})===${charCode}`;
            yield '){';
            yield* find(next, depth, pointer + charCodeList.length, paramCodes);
            yield `}`;
        } else if (root.size) {
            yield `switch(url.charCodeAt(${offset(depth, pointer)})){`;
            for (const [charCode, child] of root) {
                yield `case ${charCode}:{`;
                yield* find(child, depth, pointer + 1, paramCodes);
                yield `break}`;
            }
            yield `}`;
        }
        if (root.param)
            yield* findParam(root.param, depth, pointer, paramCodes);
        if (root.wildcard)
            yield* findWildcard(root.wildcard, depth, pointer, [...paramCodes, `url.slice(${offset(depth, pointer)},length)`]);
        if (root.isRoot) {
            if (root.meta.notFound) {
                yield 'if(!searchIndex){';
                yield `for(searchIndex=${offset(depth, pointer)};searchIndex<length&&(charCode=url.charCodeAt(searchIndex))!==${QUESTION}&&charCode!==${HASH};searchIndex++);`;
                yield 'context.searchIndex=length=searchIndex;';
                yield '}';
                yield* onRequest(root.meta.notFound);
            }
        }
    }
    function* findParam(root: ParamNode<Meta> | Node<Meta>, depth: number, pointer: number, paramCodes: string[], start: [depth: number, pointer: number] = [depth, pointer], mountList: Node<Meta>[] = [], nextList = new Map<number, Node<Meta>>(), handlersList: Handlers[] = [], index = paramDatas.push(paramData(root, mountList, nextList, handlersList)) - 1): Generator<string> {
        const nodeName = `node_${start[0]}`;
        const notFoundLabel = `NOTFOUND_${start[0]}`;
        const nextParamCodes = [...paramCodes, `url.slice(${offset(...start)},${offset(depth + 1)}-${nodeName}.deep+1)`];
        if (root.isParamNode()) {
            yield `if(${offset(depth, pointer)}<length&&(charCode=url.charCodeAt(${offset(depth, pointer)}))!==${SLASH}&&charCode!==${QUESTION}&&charCode!==${HASH})${notFoundLabel}:{`;
            yield `let ${nodeName}=param_${index},slashIndex;`;
        }
        yield `for(let ${offset(depth + 1)}=${offset(depth, pointer)};${offset(depth + 1)}<length&&(charCode=url.charCodeAt(${offset(depth + 1)}))!==${QUESTION}&&charCode!==${HASH}||(context.searchIndex=length=${offset(depth + 1)},false);${offset(depth + 1)}++){`;
        yield `let node=${nodeName}.get(charCode);`;
        yield `while(!node&&${nodeName}!==param_${index})${nodeName}=${nodeName}.fail,node=${nodeName}.get(charCode);`;
        yield `if(node)${nodeName}=node;`;
        if (mountList.length) {
            yield `if(${nodeName}.mount){switch(${nodeName}.mount){`;
            for (const [index, next] of mountList.entries()) {
                yield `case ${index + 1}:{`;
                yield* find(next, depth + 1, 1, nextParamCodes);
                yield `break}`;
            }
            yield `}break ${notFoundLabel}}`;
        }
        yield `if(!slashIndex&&charCode===${SLASH})slashIndex=${offset(depth + 1)};`;
        yield `if(slashIndex&&slashIndex<=${offset(depth + 1)}-${nodeName}.deep)break ${notFoundLabel};`;
        if (nextList.size) {
            yield `if(${nodeName}.next){switch(${nodeName}.next){`;
            for (const [index, node] of nextList) {
                yield `case ${index}:{`;
                if (node.size || node.meta.handlers?.size) {
                    const _nextList = new Map(nextList);
                    _nextList.delete(index);
                    yield* findParam(node, depth + 1, 1, paramCodes, start, [], _nextList, handlersList, index);
                }
                if (node.param)
                    yield* findParam(node.param, depth + 1, 1, nextParamCodes);
                if (node.wildcard)
                    yield* findWildcard(node.wildcard, depth, 0, nextParamCodes);
                yield `break}`;
            }
            yield `}break ${notFoundLabel}}`;
        }
        yield '}';
        if (root.isParamNode()) {
            yield `while(!${nodeName}.handler&&${nodeName}!==param_${index})${nodeName}=${nodeName}.fail;`;
            yield `if(!${nodeName}.handler)break ${notFoundLabel};`;
            yield `if(slashIndex&&slashIndex<length-${nodeName}.deep)break ${notFoundLabel};`;
            yield `switch(${nodeName}.handler){`;
            for (const [index, handlers] of handlersList.entries()) {
                yield `case ${index + 1}:{`;
                yield* response(handlers, root.root.meta, [...paramCodes, `url.slice(${offset(...start)},length-${nodeName}.deep)`]);
                yield `break}`;
            }
            yield '}';
            yield '}';
        }
    }
    function* findWildcard(root: WildcardNode<Meta>, depth: number, pointer: number, paramCodes: string[]): Generator<string> {
        if (!root.meta.handlers?.size)
            return;
        yield `if(${offset(depth, pointer)}<length){`;
        yield 'if(!searchIndex){';
        yield `for(searchIndex=${offset(depth, pointer)};searchIndex<length&&(charCode=url.charCodeAt(searchIndex))!==${QUESTION}&&charCode!==${HASH};searchIndex++);`;
        yield 'context.searchIndex=length=searchIndex;';
        yield '}';
        yield* response(root.meta.handlers, root.meta, [...paramCodes, `url.slice(${offset(depth, pointer)},length)`]);
        yield '}';
    }
}

function buildFetch<E, C>(root: Node<Meta>): (request: Request, env: E, ctx: C) => Promise<Response>;
function buildFetch(root: Node<Meta>) {
    type Writable<T> = { -readonly [P in keyof T]: T[P]; };
    interface Ctx extends Writable<Context> {
        params: Record<string, string>;
    }
    return async function (request: Request, env: unknown, ctx = {} as Ctx) {
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
            for await (const res of find(ctx, root, offset + 1, 0, []))
                if (typeof res !== 'undefined')
                    return newResponse(res, ctx.set);
            break;
        }
        return new Response(null, { status: 404 });
    };
    function param(ctx: Ctx, paramNames: string[], paramFragment: [number, number][]) {
        const { url } = ctx.request, index = paramFragment.length - paramNames.length;
        for (const [i, name] of paramNames.entries())
            ctx.params[name] = String.prototype.slice.apply(url, paramFragment[i + index]);
    }
    function onRequest(ctx: Ctx, handler: Handler, paramNames?: string[], paramFragment?: [number, number][]) {
        if (paramNames && paramFragment)
            param(ctx, paramNames, paramFragment);
        return handler(ctx as Context);
    }
    async function* response(ctx: Ctx, handlers: Handlers, { notFound }: Meta, paramFragment?: [number, number][]) {
        const { method } = ctx.request;
        const data = handlers.get(method) || method === 'HEAD' && handlers.get('GET') || handlers.get('ALL');
        if (!data)
            return false;
        const { handler, paramNames } = data;
        if (typeof handler !== 'function') {
            yield handler.clone();
        } else
            yield onRequest(ctx, handler, paramNames, paramFragment);
        if (notFound)
            yield notFound(ctx);
        return true;
    }
    async function* find(ctx: Ctx, root: Node<Meta>, start: number, paramIndex: number, paramFragment: [number, number][]): AsyncGenerator<unknown, boolean> {
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
                return yield* response(ctx, root.meta.handlers, root.root.meta, undefined);
            return false;
        }
        if (root.meta.part) PART: {
            let offset = start;
            const [charCodeList, next] = root.meta.part;
            for (const charCode of charCodeList) {
                if (offset < length && url.charCodeAt(offset++) === charCode)
                    continue;
                break PART;
            }
            if (yield* find(ctx, next, offset, paramIndex, paramFragment))
                return true;
        } else {
            const next = root.get(url.charCodeAt(start));
            if (next && (yield* find(ctx, next, start + 1, paramIndex, paramFragment)))
                return true;
        }
        if (root.param && url.charCodeAt(start) !== SLASH && (yield* findParam(ctx, root.param, root.param, start, start + 1, 0, paramIndex, paramFragment)))
            return true;
        if (root.wildcard && (yield* findWildcard(ctx, root.wildcard, start, paramIndex, paramFragment)))
            return true;
        if (root.isRoot) {
            if (root.meta.notFound) {
                if (!ctx.searchIndex)
                    for (ctx.searchIndex = start; ctx.searchIndex < length && url.charCodeAt(ctx.searchIndex) !== QUESTION && url.charCodeAt(ctx.searchIndex) !== HASH; ctx.searchIndex++);
                yield root.meta.notFound(ctx);
            }
            return true;
        }
        return false;
    }
    async function* findParam(ctx: Ctx, root: ParamNode<Meta>, node: Node<Meta>, start: number, offset: number, slashIndex: number, paramIndex: number, paramFragment: [number, number][], set?: Set<Node<Meta>>): AsyncGenerator<unknown, boolean> {
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
                return true;
            }
            if (!slashIndex && charCode === SLASH)
                slashIndex = offset;
            if (slashIndex && slashIndex <= offset - node.meta.deep!)
                return false;
            if (node.param || node.wildcard) {
                if (set?.has(node))
                    continue;
                (set ??= new Set()).add(node);
                if (node.size || node.meta.handlers?.size)
                    if (yield* findParam(ctx, root, node, start, offset + 1, slashIndex, paramIndex, paramFragment, set))
                        return true;
                paramFragment[paramIndex] = [start, offset - node.meta.deep! + 1];
                if (node.param && offset + 1 < length && url.charCodeAt(offset + 1) !== SLASH && (yield* findParam(ctx, node.param, node.param, offset + 1, offset + 2, 0, paramIndex + 1, paramFragment, set)))
                    return true;
                if (node.wildcard && (yield* findWildcard(ctx, node.wildcard, offset, paramIndex + 1, paramFragment)))
                    return true;
                return false;
            }
        }
        ctx.searchIndex = offset;
        while (!node.meta.handlers?.size && node !== root)
            node = node.meta.fail!;
        if (slashIndex && slashIndex < offset - node.meta.deep!)
            return false;
        if (!node.meta.handlers?.size)
            return false;
        paramFragment[paramIndex] = [start, offset - node.meta.deep!];
        return yield* response(ctx, node.meta.handlers, node.root.meta, paramFragment);
    }
    async function* findWildcard(ctx: Ctx, { meta: { handlers }, root: { meta } }: WildcardNode<Meta>, start: number, paramIndex: number, paramFragment: [number, number][]): AsyncGenerator<unknown, boolean> {
        const { url } = ctx.request, length = ctx.searchIndex ?? url.length;
        if (!handlers?.size)
            return false;
        if (!ctx.searchIndex)
            for (ctx.searchIndex = start; ctx.searchIndex < length && url.charCodeAt(ctx.searchIndex) !== QUESTION && url.charCodeAt(ctx.searchIndex) !== HASH; ctx.searchIndex++);
        paramFragment[paramIndex] = [start, ctx.searchIndex];
        if (yield* response(ctx, handlers, meta, paramFragment))
            return true;
        return false;
    }
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
            return this;
        if (typeof handler !== 'function')
            handler = newResponse(handler);
        else if (handler instanceof AsyncGeneratorFunction) {
            const stream = handler;
            handler = (ctx: Context) => async function* () { yield* stream(ctx); };
        }
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
        if (typeof handler === 'function')
            this.#node.meta.onRequest ??= handler as unknown as Handler;
        return this;
    }
    notFound(handler: Handler<E, C>) {
        if (typeof handler === 'function')
            this.#node.meta.notFound ??= handler as unknown as Handler;
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
    evaluateFetch() {
        build(this.#node.clean());
        return evaluateFetch<E, C>(this.#node);
    }
    get fetch() {
        build(this.#node.clean());
        if (!this.evaluate)
            return buildFetch<E, C>(this.#node);
        const { Fetch, values } = evaluateFetch<E, C>(this.#node);
        return Fetch(newResponse, values);
    }
}
for (const method of Method) {
    Router.prototype[method.toLowerCase() as Lowercase<Method>] = function (path: string, data: unknown) {
        return Router.prototype.on.call(this, method, path, data);
    };
}

export { Method, Router, newResponse };
export type { Context, Handler };
