
const Method = ['GET', 'DELETE', 'PUT', 'POST', 'PATCH'] as const;
type Method = typeof Method[number];

const AsyncGeneratorFunction = (async function* () { }).constructor as AsyncGeneratorFunctionConstructor;

const ESCAPE = 0x5c, WILDCARD = 0x2a, PARAM = 0x3a, SLASH = 0x2f, QUESTION = 0x3f;
function isParamNameChar(charCode: number) {
    return /* (0x30 <= charCode && charCode <= 0x39) || */ (0x41 <= charCode && charCode <= 0x5a) || (0x61 <= charCode && charCode <= 0x7a);
}

function newResponse(response: Response, status?: number, headers?: HeadersInit): Response;
function newResponse(stream?: (...args: any[]) => AsyncGenerator, status?: number, headers?: HeadersInit): Response;
function newResponse(body: BodyInit | null, status?: number, headers?: HeadersInit): Response;
function newResponse(data: number | bigint | string | object, status?: number, headers?: HeadersInit): Response;
function newResponse(data?: undefined, status?: number, headers?: HeadersInit): Response;
function newResponse(data: unknown, status?: number, headers?: HeadersInit): Response;
function newResponse(data: unknown, status?: number, headers?: HeadersInit) {
    switch (typeof data) {
        case 'string':
            return new Response(data, { status, headers });
        case 'object':
            if (data instanceof Response) {
                if (status || headers)
                    return new Response(data.body, { status: status ?? data.status, headers: headers ?? data.headers });
                return data.clone();
            }
            if (data === null || data instanceof Blob || data instanceof ReadableStream || data instanceof FormData || data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof URLSearchParams || data instanceof FormData)
                return new Response(data, { status, headers });
            break;
        case 'undefined':
            return new Response(null, { status, headers });
        case 'function':
            if (data instanceof AsyncGeneratorFunction)
                return new Response(data as any, { status, headers });
            break;
    }
    return Response.json(data, { status, headers });
}

type Context<E = unknown, C = {}> = {
    readonly request: Request;
    readonly response?: Response;
    readonly env: E;
    readonly path: string;
    readonly pathIndex: number;
    readonly routeIndex: number;
    readonly queryIndex: number;
    readonly params: Readonly<Record<string, string>>;
} & C;
type Handler<E = unknown, C = {}> = (context: Context<E, C>) => unknown;

interface Handlers extends Map<string, { handler: Handler | Response, paramNames?: string[]; }> {
}

interface Node {
    handlers?: Handlers;
    onRequest?: Handler;
    notFound?: Handler;
    part?: [number[], Node];
    fail?: Node;
    param?: ParamNode;
    wildcard?: WildcardNode;
}
class Node extends Map<number, Node> {
    static create() {
        return new Node(0, undefined, SLASH);
    }
    protected constructor(public readonly deep: number, private readonly parent?: Node, private readonly charCode?: number) {
        super();
    }
    get isRoot() {
        return !this.parent;
    }
    setChild(charCode: number) {
        let next = super.get(charCode);
        if (next)
            return next;
        next = new Node(this.deep + 1, this, charCode);
        super.set(charCode, next);
        return next;
    }
    setParam() {
        return this.param ??= new ParamNode(this);
    }
    setWildcard() {
        return this.wildcard ??= new WildcardNode(this);
    }
    mount(node: Node) {
        if (node.charCode !== SLASH)
            throw new Error();
        clean(this);
        if (this.param || this.wildcard || this.size || this.handlers?.size)
            throw new Error();
        if (!this.parent)
            throw new Error();
        this.parent.set(SLASH, node);
    }
    build() {
        if (this.size === 1) {
            const charCodeList: number[] = [];
            let node: Node = this;
            do {
                const [charCode, next]: [number, Node] = node.entries().next().value;
                node = next;
                charCodeList.push(charCode);
            } while (node.size === 1 && !node.handlers?.size && node.deep && !node.param && !node.wildcard);
            node.build();
            this.part = [charCodeList, node];
        } else for (const [, node] of this) {
            node.build();
        }
        this.param?.build();
        this.wildcard?.build();
        return this;
    }
}
interface ParamNode {
    onRequest: undefined;
    param: undefined;
    wildcard: undefined;
}
class ParamNode extends Node {
    fail = this;
    constructor(parent: Node) {
        super(0, parent);
    }
    setParam(): never {
        throw new Error('is ParamNode');
    }
    setWildcard(): never {
        throw new Error('is ParamNode');
    }
    build() {
        const queue: Node[] = [this];
        for (let i = 0; i < queue.length; i++) {
            const temp = queue[i];
            for (const [charCode, node] of temp) {
                node.fail = temp !== this && temp.fail?.get(charCode) || this;
                node.param?.build();
                node.wildcard?.build();
                if (node.isRoot)
                    continue;
                queue.push(node);
            }
        }
        return this;
    }
}
interface WildcardNode {
    onRequest: undefined;
    paramNames: undefined;
    param: undefined;
    wildcard: undefined;
}
class WildcardNode extends Node {
    constructor(parent: Node) {
        super(0, parent);
    }
    setChild(charCode: number): never;
    setChild() {
        throw new Error('is WildcardNode');
    }
    setParam(): never {
        throw new Error('is WildcardNode');
    }
    setWildcard(): never {
        throw new Error('is WildcardNode');
    }
    build() {
        return this;
    }
}

function get(node: Node, path: string, offset = path.charCodeAt(0) === SLASH ? 1 : path.charCodeAt(0) === ESCAPE && path.charCodeAt(1) === SLASH ? 2 : 0, paramNames: string[] = [], escape = false): { node: Node, paramNames: string[]; } {
    if (offset >= path.length)
        return { node, paramNames };
    const charCode = path.charCodeAt(offset);
    if (!escape) switch (charCode) {
        case ESCAPE:
            return get(node, path, offset + 1, paramNames, true);
        case PARAM:
            return getParam(node, path, offset + 1, paramNames);
        case WILDCARD:
            return getWildcard(node, path, offset + 1, paramNames);
    }
    if (charCode === QUESTION)
        throw new Error('Unauthorized character: ?');
    const next = node.setChild(charCode);
    if (next.isRoot)
        throw new Error();
    return get(next, path, offset + 1, paramNames);
}
function getParam(node: Node, path: string, offset: number, paramNames: string[]) {
    let _offset = offset, charCode;
    while (!isNaN(charCode = path.charCodeAt(_offset)) && isParamNameChar(charCode)) _offset++;
    if (_offset === offset)
        return get(node, path, offset - 1, paramNames, true);
    paramNames.push(path.slice(offset, _offset));
    return get(node.setParam(), path, charCode === ESCAPE ? _offset + 1 : _offset, paramNames, true);
}
function getWildcard(node: Node, path: string, offset: number, paramNames: string[]) {
    const charCode = path.charCodeAt(offset);
    if (isNaN(charCode)) {
        paramNames.push('*');
        return get(node.setWildcard(), path, offset + 1, paramNames);
    }
    return get(node, path, offset - 1, paramNames, true);
}

function clean(node: Node): boolean {
    let hasEndpoint = Boolean(node.handlers?.size);
    for (const [charCode, child] of node) {
        if (clean(child))
            hasEndpoint = true;
        else
            node.delete(charCode);
    }
    if (node.param) {
        if (clean(node.param))
            hasEndpoint = true;
        else
            delete node.param;
    }
    if (node.wildcard) {
        if (clean(node.wildcard))
            hasEndpoint = true;
        else
            delete node.wildcard;
    }
    return hasEndpoint;
}

function* forEach(node: Node, charCodeLists: number[][] = [[SLASH]]): Generator<[method: string, path: `/${string}`]> {
    function path(paramNames?: string[]) {
        return String.raw({
            raw: [...charCodeLists.map((charCodeList) => String.fromCharCode.apply(String, charCodeList))],
        }, ...(paramNames || []).map((name) => name.replace(/^[a-zA-Z]/, ':$&'))) as `/${string}`;
    }
    if (node.handlers?.size) {
        for (const [method, { paramNames }] of node.handlers)
            yield [method, path(paramNames)];
    }
    for (const [charCode, child] of node) {
        const [...charCodeListsCopy] = charCodeLists;
        const [...charCodeListCopy] = charCodeListsCopy.pop()!;
        if (charCode === ESCAPE || (isParamNameChar(charCode) && charCodeListCopy.at(-1) === PARAM))
            charCodeListCopy.push(ESCAPE);
        charCodeListCopy.push(charCode);
        charCodeListsCopy.push(charCodeListCopy);
        yield* forEach(child, charCodeListsCopy);
    }
    if (node.param)
        yield* forEach(node.param, [...charCodeLists, []]);
    if (node.wildcard)
        yield* forEach(node.wildcard, [...charCodeLists, []]);
}

function evaluateFetch<E, C>(root: Node) {
    interface ParamData extends Record<number, ParamData> { next?: number, handler?: number; }
    const values = new Map<unknown, `value_${number}`>(), paramDatas: ParamData[] = [];
    const Fetch = Function('newResponse', 'values', [...function* () {
        yield `"use strict";`;
        //#region function fetch(...){}
        yield 'async function fetch(request,env,context={}){';
        yield 'const{method,url}=request;let{length}=url,response;';
        yield `for(let ${offset(0)}=0,count=0;${offset(0)}<length;${offset(0)}++){`;
        yield `if(url.charCodeAt(offset_0)===${SLASH})count++;`;
        yield 'if(count!==3)continue';
        yield 'context.request=request;';
        yield 'context.env=env;';
        yield `context.pathIndex=${offset(0)};`;
        yield 'context.queryIndex=length;';
        yield 'context.params={};';
        yield 'let queryIndex;';
        yield* find(root.build(), 0, 1, []);
        yield `break}`;
        yield* onNotFound();
        yield '}';
        //#endregion
        //#region values
        if (values.size) {
            yield 'const[';
            for (const name of values.values())
                yield name, yield ',';
            yield ']=values;';
        }
        //#endregion
        if (paramDatas.length) {
            yield 'function param(data,deep=0){';
            yield 'const node=new Map(),{next,handler}=data;';
            yield 'Object.assign([],data).forEach((next,charCode)=>node.set(charCode,param(next,deep+1)));';
            yield 'return Object.assign(node,{deep,next,handler});';
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
    }()].join('\n')) as (newResponse: (data: unknown) => Response, values: unknown[]) => (request: Request, env: E, ctx: C) => Promise<Response>;
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
    function paramData(node: Node, nexts: Map<number, Node>, handlersList: Handlers[]) {
        const data: ParamData = {};
        if (node.param || node.wildcard || node.isRoot)
            data.next = nexts.size + 1, nexts.set(data.next, node);
        if (node.isRoot)
            return data;
        if (node.handlers?.size)
            data.handler = handlersList.push(node.handlers);
        for (const [charCode, child] of node) {
            const acNode = paramData(child, nexts, handlersList);
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
        yield `context.queryIndex??=length;`;
        yield `context.path??=url.slice(${offset(0)}, length);`;
        if (paramNames && paramCodes)
            yield* param(paramNames, paramCodes);
        yield `if(typeof (response=await ${value(handler)}(context))!=="undefined")return response=newResponse(response);`;
    }
    function* onNotFound(notFound?: Handler) {
        if (notFound)
            yield `if(typeof (response=await ${value(notFound)}(context))!=="undefined")return response=newResponse(response);`;
        yield 'return response=new Response(null,{status:404})';
    }
    function* response(handlers: Handlers, paramCodes?: string[], notFound?: Handler) {
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
        yield* onNotFound(notFound);
        yield '}';
        function* call({ handler, paramNames }: { handler: unknown, paramNames?: string[]; }) {
            if (typeof handler !== 'function') {
                yield `return ${value(handler)}.clone();`;
            } else {
                yield '{';
                yield* onRequest(handler, paramNames, paramCodes);
                yield 'break}';
            }
        }
    }
    function* find(root: Node, depth: number, pointer: number, paramCodes: string[], notFound?: Handler): Generator<string> {
        if (root.isRoot) {
            yield `context.routeIndex=${offset(depth, pointer)};`;
            notFound = root.notFound;
            if (root.onRequest) {
                yield 'if(!queryIndex){';
                yield `queryIndex=url.indexOf('?',${offset(depth, pointer)});`;
                yield 'if(queryIndex!==-1)length=queryIndex;';
                yield '}';
                yield* onRequest(root.onRequest);
            }
        }
        if (root.handlers?.size) {
            yield `if(${offset(depth, pointer)}===length||url.charCodeAt(${offset(depth, pointer)})===${QUESTION}){`;
            yield `length=${offset(depth, pointer)};`;
            yield* response(root.handlers, paramCodes, notFound);
            yield '}';
        }
        if (root.part) {
            const [charCodeList, next] = root.part;
            yield `if(${offset(depth, pointer + charCodeList.length)}<=length`;
            for (const [index, charCode] of charCodeList.entries())
                yield `&&url.charCodeAt(${offset(depth, pointer + index)})===${charCode}`;
            yield '){';
            yield* find(next, depth, pointer + charCodeList.length, paramCodes, notFound);
            yield `}`;
        } else if (root.size) {
            yield `switch(url.charCodeAt(${offset(depth, pointer)})){`;
            for (const [charCode, child] of root) {
                yield `case ${charCode}:{`;
                yield* find(child, depth, pointer + 1, paramCodes, notFound);
                yield `break}`;
            }
            yield `}`;
        }
        if (root.param)
            yield* findParam(root.param, depth, pointer, paramCodes, notFound);
        if (root.wildcard)
            yield* findWildcard(root.wildcard, depth, pointer, [...paramCodes, `url.slice(${offset(depth, pointer)},length)`], notFound);
        if (root.isRoot) {
            yield* onNotFound(notFound);
        }
    }
    function* findParam(root: ParamNode | Node, depth: number, pointer: number, paramCodes: string[], notFound?: Handler, start: [depth: number, pointer: number] = [depth, pointer], nexts = new Map<number, Node>(), handlersList: Handlers[] = [], index = paramDatas.push(paramData(root, nexts, handlersList)) - 1): Generator<string> {
        const nodeName = `node_${start[0]}`;
        if (root instanceof ParamNode) {
            yield `if(${offset(depth, pointer)}<length&&url.charCodeAt(${offset(depth, pointer)})!==${SLASH})`;
            yield `for(let ${nodeName}=param_${index},slashIndex,${offset(depth + 1)}=${offset(depth, pointer + 1)},charCode;;${offset(depth + 1)}++){`;
        } else {
            yield `for(let ${offset(depth + 1)}=${offset(depth, pointer)},charCode;;${offset(depth + 1)}++){`;
        }
        yield `if(${offset(depth + 1)}===length||(charCode=url.charCodeAt(${offset(depth + 1)}))===${QUESTION}){`;
        yield `length=${offset(depth + 1)};`;
        yield `while(!${nodeName}.handler&&${nodeName}!==param_${index})${nodeName}=${nodeName}.fail;`;
        yield `if(!${nodeName}.handler)break;`;
        yield `if(slashIndex&&slashIndex<${offset(depth + 1)}-${nodeName}.deep)break;`;
        yield `switch(${nodeName}.handler){`;
        for (const [index, handlers] of handlersList.entries()) {
            yield `case ${index + 1}:{`;
            yield* response(handlers, [...paramCodes, `url.slice(${offset(...start)},${offset(depth + 1)}-${nodeName}.deep)`], notFound);
            yield `break}`;
        }
        yield '}';
        yield 'break}';
        yield `let node=${nodeName}.get(charCode);`;
        yield `while(!node&&${nodeName}!==param_${index})${nodeName}=${nodeName}.fail,node=${nodeName}.get(charCode);`;
        yield `if(node)${nodeName}=node;`;
        if (nexts.size) {
            const nextParamCodes = [...paramCodes, `url.slice(${offset(...start)},${offset(depth + 1)}-${nodeName}.deep+1)`];
            yield `if(${nodeName}.next){switch(${nodeName}.next){`;
            for (const [index, node] of nexts) {
                if (!node?.isRoot)
                    continue;
                nexts.delete(index);
                yield `case ${index}:{`;
                yield* find(node, depth + 1, 1, nextParamCodes);
                yield `break}`;
            }
            for (const [index, node] of nexts) {
                if (!node)
                    continue;
                yield `case ${index}:{`;
                yield `if(!slashIndex&&charCode===${SLASH})slashIndex=${offset(depth + 1)};`;
                yield `if(slashIndex&&slashIndex<=${offset(depth + 1)}-${nodeName}.deep)break;`;
                if (node.size || node.handlers?.size) {
                    const _nextList = new Map(nexts);
                    _nextList.delete(index);
                    yield* findParam(node, depth + 1, 1, paramCodes, notFound, start, _nextList, handlersList, index);
                }
                if (node.param)
                    yield* findParam(node.param, depth + 1, 1, nextParamCodes, notFound);
                if (node.wildcard)
                    yield* findWildcard(node.wildcard, depth, 0, nextParamCodes, notFound);
                yield `break}`;
            }
            yield '}break}';
        }
        yield `if(!slashIndex&&charCode===${SLASH})slashIndex=${offset(depth + 1)};`;
        yield `if(slashIndex&&slashIndex<=${offset(depth + 1)}-${nodeName}.deep)break;`;
        yield '}';
    }
    function* findWildcard(root: WildcardNode, depth: number, pointer: number, paramCodes: string[], notFound?: Handler): Generator<string> {
        if (!root.handlers?.size)
            return;
        yield `if(${offset(depth, pointer)}<length){`;
        yield 'if(!queryIndex){';
        yield `queryIndex=url.indexOf('?',${offset(depth, pointer)});`;
        yield 'if(queryIndex!==-1)length=queryIndex;';
        yield '}';
        yield* response(root.handlers, [...paramCodes, `url.slice(${offset(depth, pointer)},length)`], notFound);
        yield '}';
    }
}

function buildFetch<E, C>(root: Node): (request: Request, env: E, ctx: C) => Promise<Response>;
function buildFetch(root: Node) {
    type Writable<T> = { -readonly [P in keyof T]: T[P]; };
    interface Ctx extends Writable<Context> {
        params: Record<string, string>;
    }
    root.build();
    return async function (request: Request, env: unknown, ctx = {} as Ctx) {
        const { url } = request, { length } = url;
        for (let offset = 0, count = 0; offset <= length; offset++) {
            if (url.charCodeAt(offset) === SLASH)
                count++;
            if (count !== 3)
                continue;
            ctx.request = request;
            ctx.env = env;
            ctx.pathIndex = offset;
            ctx.params = {};
            for await (const res of find(ctx, root, offset + 1, 0, []))
                if (typeof res !== 'undefined')
                    return newResponse(res);
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
        const { url } = ctx.request;
        ctx.path ||= url.slice(ctx.pathIndex, ctx.queryIndex);
        if (paramNames && paramFragment)
            param(ctx, paramNames, paramFragment);
        return handler(ctx as Context);
    }
    async function* response(ctx: Ctx, handlers: Handlers, paramFragment?: [number, number][], notFound?: Handler) {
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
    async function* find(ctx: Ctx, root: Node, start: number, paramIndex: number, paramFragment: [number, number][], notFound?: Handler): AsyncGenerator<unknown, boolean> {
        if (root.isRoot) {
            ctx.routeIndex = start;
            notFound = root.notFound;
            if (root.onRequest) {
                if (!ctx.queryIndex) {
                    const queryIndex = ctx.request.url.indexOf('?', start);
                    if (queryIndex !== -1)
                        ctx.queryIndex = queryIndex;
                }
                yield onRequest(ctx, root.onRequest);
            }
        }
        const { url } = ctx.request, { length } = url;
        if (start === length || url.charCodeAt(start) === QUESTION) {
            ctx.queryIndex = start;
            if (root.handlers?.size)
                return yield* response(ctx, root.handlers, undefined, notFound);
            return false;
        }
        if (root.part) PART: {
            let offset = start;
            const [charCodeList, next] = root.part;
            for (const charCode of charCodeList) {
                if (offset < length && url.charCodeAt(offset++) === charCode)
                    continue;
                break PART;
            }
            if (yield* find(ctx, next, offset, paramIndex, paramFragment, notFound))
                return true;
        } else {
            const next = root.get(url.charCodeAt(start));
            if (next && (yield* find(ctx, next, start + 1, paramIndex, paramFragment, notFound)))
                return true;
        }
        if (root.param && url.charCodeAt(start) !== SLASH && (yield* findParam(ctx, root.param, root.param, start, start + 1, 0, paramIndex, paramFragment, notFound)))
            return true;
        if (root.wildcard && (yield* findWildcard(ctx, root.wildcard, start, paramIndex, paramFragment, notFound)))
            return true;
        if (root.isRoot) {
            if (notFound)
                yield notFound(ctx);
            return true;
        }
        return false;
    }
    async function* findParam(ctx: Ctx, root: ParamNode, node: Node, start: number, offset: number, slashIndex: number, paramIndex: number, paramFragment: [number, number][], notFound?: Handler, set?: Set<Node>): AsyncGenerator<unknown, boolean> {
        const { url } = ctx.request, { length } = url;
        for (let charCode; ; offset++) {
            if (offset === length || (charCode = url.charCodeAt(offset)) === QUESTION) {
                ctx.queryIndex = offset;
                while (!node.handlers?.size && node !== root)
                    node = node.fail!;
                if (slashIndex && slashIndex < offset - node.deep)
                    break;
                if (!node.handlers?.size)
                    break;
                paramFragment[paramIndex] = [start, offset - node.deep];
                return yield* response(ctx, node.handlers, paramFragment, notFound);
            }
            let cnode = node.get(charCode);
            while (!cnode && node !== root) {
                node = node.fail!;
                cnode = node.get(charCode);
            }
            if (cnode)
                node = cnode;
            if (node.isRoot) {
                paramFragment[paramIndex] = [start, offset - node.deep + 1];
                yield* find(ctx, node, offset + 1, paramIndex + 1, paramFragment);
                return true;
            }
            if (!slashIndex && charCode === SLASH)
                slashIndex = offset;
            if (slashIndex && slashIndex <= offset - node.deep)
                break;
            if (node.param || node.wildcard) {
                if (set?.has(node))
                    continue;
                (set ??= new Set()).add(node);
                if (node.size || node.handlers?.size)
                    if (yield* findParam(ctx, root, node, start, offset + 1, slashIndex, paramIndex, paramFragment, notFound, set))
                        return true;
                paramFragment[paramIndex] = [start, offset - node.deep + 1];
                if (node.param && offset + 1 < length && url.charCodeAt(offset + 1) !== SLASH && (yield* findParam(ctx, node.param, node.param, offset + 1, offset + 2, 0, paramIndex + 1, paramFragment, notFound, set)))
                    return true;
                if (node.wildcard && (yield* findWildcard(ctx, node.wildcard, offset, paramIndex + 1, paramFragment, notFound)))
                    return true;
                break;
            }
        }
        return false;
    }
    async function* findWildcard(ctx: Ctx, root: WildcardNode, start: number, paramIndex: number, paramFragment: [number, number][], notFound?: Handler): AsyncGenerator<unknown, boolean> {
        if (!root.handlers?.size)
            return false;
        if (!ctx.queryIndex) {
            const queryIndex = ctx.request.url.indexOf('?', start);
            if (queryIndex !== -1)
                ctx.queryIndex = queryIndex;
        }
        paramFragment[paramIndex] = [start, ctx.queryIndex];
        if (yield* response(ctx, root.handlers, paramFragment, notFound))
            return true;
        return false;
    }
}

interface Router<E, C = void> extends Record<Lowercase<Method>, {
    (path: string, handler: Handler<E, C>): Router<E, C>;
    (path: string, data: Response | ((...args: any[]) => AsyncGenerator) | BodyInit): Router<E, C>;
    (path: string, data: unknown): Router<E, C>;
}> { }
class Router<E = void, C = void> {
    #node = Node.create();
    constructor(public evaluate = false) {
    }
    on(method: Method, path: string, handler: Handler<E, C>): this;
    on(method: Method, path: string, data: Response | BodyInit): this;
    on(method: Method, path: string, data: unknown): this;
    on(method: string, path: string, handler: Handler<E, C>): this;
    on(method: string, path: string, data: Response | BodyInit): this;
    on(method: string, path: string, data: unknown): this;
    on(type: string, path: string, handler: any) {
        const { node, paramNames } = get(this.#node, path);
        const handlers: Handlers = node.handlers ??= new Map();
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
    onRequest(handler: Handler<E, C>) {
        if (typeof handler === 'function')
            this.#node.onRequest ??= handler as unknown as Handler;
        return this;
    }
    notFound(handler: Handler<E, C>) {
        if (typeof handler === 'function')
            this.#node.notFound ??= handler as unknown as Handler;
        return this;
    }
    mount<E1 extends E,C1 extends C>(path: string, tree: Router<E1, C1>) {
        if (path.charCodeAt(path.length - 1) !== SLASH)
            path = `${path}/`;
        const { node } = get(this.#node, path);
        node.mount(tree.#node);
        return this;
    }
    *[Symbol.iterator]() {
        yield* forEach(this.#node);
    }
    evaluateFetch() {
        clean(this.#node);
        return evaluateFetch<E, C>(this.#node);
    }
    get fetch() {
        clean(this.#node);
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
