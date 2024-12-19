
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
        case 'bigint':
            return Response.json(data.toString(), { status, headers });
        case 'string':
            return new Response(data, { status, headers });
        case 'object':
            if (data instanceof Response) {
                if (!status && !headers)
                    return data.clone();
                status ??= data.status;
                headers ??= data.headers;
                return new Response(data.body, { status, headers });
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
    request: Request;
    env: E;
    path: string;
    pathIndex: number;
    queryIndex: number;
    param: Record<string, string>;
} & C;
type Handler<E = unknown, C = {}> = (context: Context<E, C>) => unknown;

interface Handlers extends Map<string, { handler: Handler | Response | ((...args: any) => AsyncGenerator), paramNames?: string[]; }> {
}

interface Node {
    handlers?: Handlers;
    onRequest?: Handler;
    part?: [number[], Node];
    fail?: Node;
    param?: ParamNode;
    wildcard?: WildcardNode;
}
class Node extends Map<number, Node> {
    constructor(public readonly deep = 0) {
        super();
    }
    setChild(charCode: number) {
        let next = super.get(charCode);
        if (next)
            return next;
        next = new Node(this.deep + 1);
        super.set(charCode, next);
        return next;
    }
    setParam() {
        return this.param ??= new ParamNode();
    }
    setWildcard() {
        return this.wildcard ??= new WildcardNode();
    }
    build() {
        if (this.size === 1) {
            const charCodeList: number[] = [];
            let node: Node = this;
            do {
                const [charCode, next]: [number, Node] = node.entries().next().value;
                node = next;
                charCodeList.push(charCode);
            } while (!this.handlers?.size && !this.onRequest && !node.param && !node.wildcard && node.size === 1);
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
class ParamNode extends Node {
    declare param: undefined;
    declare wildcard: undefined;
    fail = this;
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
                queue.push(node);
            }
        }
        return this;
    }
}
class WildcardNode extends Node {
    declare param: undefined;
    declare wildcard: undefined;
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
    return get(node.setChild(charCode), path, offset + 1, paramNames);
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

function mount<T extends Node>(root: NoInfer<T>, node: T, baseParamNames?: string[]) {
    function copy<T>({ handler, paramNames }: { handler: T, paramNames?: string[]; }) {
        if (baseParamNames?.length || paramNames?.length)
            paramNames = [...baseParamNames || [], ...paramNames || []];
        return { handler, paramNames };
    }
    if (root.wildcard?.handlers?.size)
        return root;
    if (node.handlers?.size && !root.handlers?.size) {
        root.handlers = new Map();
        for (const [method, data] of node.handlers)
            root.handlers.set(method, copy(data));
        if (node.onRequest)
            root.onRequest = node.onRequest;
    }
    for (const [charCode, child] of node)
        mount(root.setChild(charCode), child, baseParamNames);
    if (node.param)
        root.param = mount(root.setParam(), node.param, baseParamNames);
    if (node.wildcard)
        root.wildcard = mount(root.setWildcard(), node.wildcard, baseParamNames);
    return root;
}

function Context<E, C>(request: Request, env: E, ctx: C | undefined, pathIndex: number): Context<E, C>;
function Context(request: Request, env: any, ctx = {} as Context, pathIndex: number): Context<unknown, {}> {
    ctx.request = request;
    ctx.env = env;
    ctx.pathIndex = pathIndex;
    ctx.queryIndex = request.url.length;
    return ctx;
}

function evaluateFind<E, C>(root: Node): (request: Request, env: E, ctx: C) => Promise<Response> {
    interface ParamData extends Record<number, ParamData> { next?: number, handler?: number; }
    const values: unknown[] = [], paramDatas: ParamData[] = [];
    const code = [
        'return async function(request,env,ctx){',
        'const{method,url}=request;let{length}=url;',
        `for(let offset_0=0,count=0;offset_0<=length;offset_0++){`,
        `if(url.charCodeAt(offset_0)===${SLASH})count++;`,
        `if(count!==3)continue;`,
        'const context=Context(request,env,ctx,offset_0);',
        'let queryIndex;',
        ...find(root.build(), 1),
        `break}`,
        'return new Response(null,{status:404});',
        '}',
    ];
    if (paramDatas.length) code.unshift(
        'function param(o,deep=0,n=new Map){return Object.assign([],o).forEach((v,k)=>{n.set(k,param(v,deep+1)),delete o[k]}),Object.assign(n,o,{deep})}',
        'function build(r,q=[r]){while(q.length){let n=q.pop();for(let[c,e]of n)e.fail=n!==r&&n.fail[c]||r,q.push(e);}return r}',
        `const ${paramDatas.map((paramData, i) => `param_${i}=build(param(${JSON.stringify(paramData)}))`).join(',')};`,
    );
    code.unshift(`"use strict";`);
    return Function('Context', 'newResponse', ...values.map((_, i) => `value_${i}`), code.join('\n'))(Context, newResponse, ...values);
    function offset(depth: number, offset?: number) {
        if (!offset)
            return `offset_${depth}`;
        return `offset_${depth}+${offset}`;
    }
    function paramData(node: Node, nextList: Node[], handlersList: Handlers[]) {
        const data: ParamData = {};
        if (node.handlers?.size)
            data.handler = handlersList.push(node.handlers);
        if (node.param || node.wildcard)
            data.next = nextList.push(node);
        for (const [charCode, child] of node) {
            const acNode = paramData(child, nextList, handlersList);
            data[charCode] = acNode;
        }
        return data;
    }
    function param(paramNames?: string[], paramCodes?: string[]) {
        let code = `{`;
        if (paramNames && paramCodes) for (const [key, paramCode] of new Map(paramNames.map((name, i) => [name, paramCodes[i]])))
            code += `${JSON.stringify(key)}:${paramCode},`;
        code += `};`;
        return code;
    }
    function* call(handlers: Handlers, paramCodes?: string[]) {
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
        function* call({ handler, paramNames }: { handler: unknown, paramNames?: string[]; }) {
            const index = values.push(handler) - 1;
            if (typeof handler !== 'function') {
                yield `return value_${index}.clone();`;
                return;
            } else if (handler instanceof AsyncGeneratorFunction) {
                yield `return newResponse(value_${index});`;
            }
            yield '{';
            yield `context.param=${param(paramNames, paramCodes)};`;
            yield `context.queryIndex=length;`;
            yield `const res=value_${index}(context);`;
            yield `if(typeof res==="undefined")return new Response(null,{status:404});`;
            yield 'return newResponse(res);';
            yield '}';
        }
    }
    function* find(root: Node, pointer: number): Generator<string> {
        if (root.handlers?.size) {
            yield `if(${offset(0, pointer)}===length||url.charCodeAt(${offset(0, pointer)})===${QUESTION}){`;
            yield `length=${offset(0, pointer)};`;
            yield* call(root.handlers);
            yield '}';
        }
        if (!isFinite(pointer))
            return;
        if (root.part) {
            const [charCodeList, next] = root.part;
            yield `if(${offset(0, pointer + charCodeList.length)}<=length`;
            for (const [index, charCode] of charCodeList.entries())
                yield `&&url.charCodeAt(${offset(0, pointer + index)})===${charCode}`;
            yield '){';
            yield* find(next, pointer + charCodeList.length);
            yield `}`;
        } else if (root.size) {
            yield `switch(url.charCodeAt(${offset(0, pointer)})){`;
            for (const [charCode, child] of root) {
                yield `case ${charCode}:{`;
                yield* find(child, pointer + 1);
                yield `break}`;
            }
            yield `}`;
        }
        if (root.param) {
            yield `if(url.charCodeAt(${offset(0, pointer)})!==${SLASH}){`;
            yield* findParam(root.param, 0, pointer + 1, []);
            yield '}';
        }
        if (root.wildcard)
            yield* findWildcard(root.wildcard, 0, pointer, [`url.slice(${offset(0, pointer)},length)`]);
    }
    function* findParam(root: ParamNode | Node, depth: number, pointer: number, paramCodes: string[], start: [depth: number, pointer: number] = [depth, pointer - 1], nextList: Node[] = [], handlersList: Handlers[] = [], index = paramDatas.push(paramData(root, nextList, handlersList)) - 1, set = new Set<Node>()): Generator<string> {
        const nodeName = `node_${start[0]}`;
        if (root instanceof ParamNode) {
            yield `for(let ${nodeName}=param_${index},slashIndex,${offset(depth + 1)}=${offset(depth, pointer)},charCode;;${offset(depth + 1)}++){`;
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
            yield* call(handlers, [...paramCodes, `url.slice(${offset(...start)},${offset(depth + 1)}-${nodeName}.deep)`]);
            yield `break}`;
        }
        yield '}';
        yield 'break}';
        yield `if(!slashIndex&&charCode===${SLASH})slashIndex=${offset(depth + 1)};`;
        yield `let node=${nodeName}.get(charCode);`;
        yield `while(!node&&${nodeName}!==param_${index})${nodeName}=${nodeName}.fail,node=${nodeName}.get(charCode);`;
        yield `if(node)${nodeName}=node;`;
        yield `if(slashIndex&&slashIndex<=${offset(depth + 1)}-${nodeName}.deep)break;`;
        if (nextList.length && set.size < nextList.length) {
            yield `if(${nodeName}.next){switch(${nodeName}.next){`;
            for (const [index, next] of nextList.entries()) {
                if (set.has(next))
                    continue;
                yield `case ${index + 1}:{`;
                if (next.size || next.handlers?.size)
                    yield* findParam(next, depth + 1, 1, paramCodes, start, nextList, handlersList, index, new Set([...set, next]));
                const paramCodes_1 = [...paramCodes, `url.slice(${offset(...start)},${offset(depth + 1)}-${nodeName}.deep+1)`];
                if (next.param) {
                    yield `if(${offset(depth + 1, 1)}<length&&url.charCodeAt(${offset(depth + 1, 1)})!==${SLASH}){`;
                    yield* findParam(next.param, depth + 1, 2, paramCodes_1);
                    yield '}';
                }
                if (next.wildcard)
                    yield* findWildcard(next.wildcard, depth, 0, paramCodes_1);
                yield `break}`;
            }
            yield '}break}';
        }
        yield '}';
    }
    function* findWildcard(root: WildcardNode, depth: number, pointer: number, paramCodes: string[]): Generator<string> {
        if (!root.handlers?.size)
            return;
        yield `if(${offset(depth, pointer)}<length){`;
        yield 'if(!queryIndex){';
        yield `queryIndex=url.indexOf('?',${offset(depth, pointer)});`;
        yield 'if(queryIndex!==-1)length=queryIndex;';
        yield '}';
        yield* call(root.handlers, [...paramCodes, `url.slice(${offset(depth, pointer)},length)`]);
        yield '}';
    }
}

function buildFind<E, C>(root: Node): (request: Request, env: E, ctx: C) => Promise<Response> {
    root = mount(new Node(), root).build();
    return async function (request, env, ctx) {
        const { url } = request, { length } = url;
        for (let offset = 0, count = 0; offset <= length; offset++) {
            if (url.charCodeAt(offset) === SLASH)
                count++;
            if (count !== 3)
                continue;
            for await (const res of find(Context(request, env, ctx, offset), root, offset + 1))
                if (typeof res === 'undefined')
                    return new Response(null, { status: 404 });
                else
                    return newResponse(res);
            break;
        }
        return new Response(null, { status: 404 });
    };
    function param(url: string, paramNames: string[], paramFragment: [number, number][]) {
        const param: Record<string, string> = {};
        if (paramNames) for (const [index, name] of paramNames.entries())
            param[name] = String.prototype.slice.apply(url, paramFragment[index]);
        return param;
    }
    async function* call(context: Context, handlers: Handlers, paramFragment?: [number, number][]) {
        const { method, url } = context.request;
        const data = handlers.get(method) || method === 'HEAD' && handlers.get('GET') || handlers.get('ALL');
        if (!data)
            return false;
        const { handler, paramNames } = data;
        if (typeof handler !== 'function') {
            yield handler.clone();
        } else if (handler instanceof AsyncGeneratorFunction) {
            yield newResponse(handler);
        } else {
            context.path = url.slice(context.pathIndex, context.queryIndex);
            context.param = paramNames && paramFragment ? param(url, paramNames, paramFragment) : {};
            yield handler(context);
        }
        return true;
    }
    async function* find(context: Context, root: Node, start: number): AsyncGenerator<unknown, boolean> {
        const { queryIndex: length, request: { url } } = context;
        if (start === length || url.charCodeAt(start) === QUESTION) {
            context.queryIndex = start;
            if (root.handlers?.size)
                return yield* call(context, root.handlers);
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
            if (yield* find(context, next, offset))
                return true;
        } else {
            const next = root.get(url.charCodeAt(start));
            if (next && (yield* find(context, next, start + 1)))
                return true;
        }
        if (root.param && url.charCodeAt(start) !== SLASH && (yield* findParam(context, root.param, root.param, start, start + 1, 0, 0, [])))
            return true;
        if (root.wildcard && (yield* findWildcard(context, root.wildcard, start, 0, [])))
            return true;
        return false;
    }
    async function* findParam(context: Context, root: ParamNode, node: Node, start: number, offset: number, slashIndex: number, paramIndex: number, paramFragment: [number, number][], set?: Set<Node>): AsyncGenerator<unknown, boolean> {
        const { queryIndex: length, request: { url } } = context;
        for (let charCode; ; offset++) {
            if (offset === length || (charCode = url.charCodeAt(offset)) === QUESTION) {
                context.queryIndex = offset;
                while (!node.handlers?.size && node !== root)
                    node = node.fail!;
                if (slashIndex && slashIndex < offset - node.deep)
                    break;
                if (!node.handlers?.size)
                    break;
                paramFragment[paramIndex] = [start, offset - node.deep];
                return yield* call(context, node.handlers, paramFragment);
            }
            if (!slashIndex && charCode === SLASH)
                slashIndex = offset;
            let cnode = node.get(charCode);
            while (!cnode && node !== root) {
                node = node.fail!;
                cnode = node.get(charCode);
            }
            if (cnode)
                node = cnode;
            if (slashIndex && slashIndex <= offset - node.deep)
                break;
            if (node.param || node.wildcard) {
                if (set?.has(node))
                    continue;
                (set ??= new Set()).add(node);
                if (node.size || node.handlers?.size)
                    if (yield* findParam(context, root, node, start, offset + 1, slashIndex, paramIndex, paramFragment, set))
                        return true;
                paramFragment[paramIndex] = [start, offset - node.deep + 1];
                if (node.param && offset + 1 < length && url.charCodeAt(offset + 1) !== SLASH && (yield* findParam(context, node.param, node.param, offset + 1, offset + 2, 0, paramIndex + 1, paramFragment, set)))
                    return true;
                if (node.wildcard && (yield* findWildcard(context, node.wildcard, offset, paramIndex + 1, paramFragment)))
                    return true;
                break;
            }
        }
        return false;
    }
    async function* findWildcard(content: Context, root: WildcardNode, start: number, paramIndex: number, paramFragment: [number, number][]): AsyncGenerator<unknown, boolean> {
        if (!root.handlers?.size)
            return false;
        const queryIndex = content.request.url.indexOf('?', start);
        if (queryIndex !== -1)
            content.queryIndex = queryIndex;
        paramFragment[paramIndex] = [start, content.queryIndex];
        if (yield* call(content, root.handlers, paramFragment))
            return true;
        return false;
    }
}

class Router<E = void, C extends object | void = void> {
    #node = new Node();
    #evaluate;
    constructor(evaluate = false) {
        this.#evaluate = evaluate;
    }
    on(method: typeof methodNames[number], path: string, handler: Handler<E, C>): this;
    on(method: typeof methodNames[number], path: string, data: unknown): this;
    on(method: string, path: string, handler: Handler<E, C>): this;
    on(method: string, path: string, data: unknown): this;
    on(type: string, path: string, data: unknown) {
        const { node, paramNames } = get(this.#node, path);
        const handlers: Handlers = node.handlers ||= new Map();
        const method = type.toUpperCase();
        if (handlers.has(method))
            return this;
        if (typeof data !== 'function')
            data = newResponse(data);
        handlers.set(method, {
            handler: data as any,
            paramNames,
        });
        return this;
    }
    onRequest(handler: Handler<E, C>) {
        if (typeof handler === 'function')
            this.#node.onRequest ??= handler as Handler;
        return this;
    }
    #clean() {
        clean(this.#node);
        return this;
    }
    mount(path: string, tree: Router<E, C>) {
        if (path.charCodeAt(path.length - 1) !== SLASH)
            path = `${path}/`;
        const { node, paramNames } = get(this.#clean().#node, path);
        for (const _ of forEach(node))
            return this;
        mount(node, mount(new Node(), tree.#clean().#node), paramNames);
        return this;
    }
    *[Symbol.iterator]() {
        yield* forEach(this.#node);
    }
    get fetch() {
        this.#clean();
        return this.#evaluate ? evaluateFind<E, C>(this.#node) : buildFind<E, C>(this.#node);
    }
}
const methodNames = ['GET', 'HEAD', 'DELETE', 'PUT', 'POST', 'PATCH'] as const;
interface Router<E, C> extends Record<Lowercase<typeof methodNames[number]>, {
    (path: string, handler: Handler<E, C>): Router<E, C>;
    (path: string, data: unknown): Router<E, C>;
}> { }
for (const method of methodNames) {
    Router.prototype[method.toLowerCase() as Lowercase<typeof methodNames[number]>] = function (path: string, data: unknown) {
        return Router.prototype.on.call(this, method, path, data);
    };
}

export { Router, newResponse };
