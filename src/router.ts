
const ESCAPE = 0x5c, WILDCARD = 0x2a, PARAM = 0x3a, SLASH = 0x2f, QUESTION = 0x3f;
function isParamNameChar(charCode: number) {
    return /* (0x30 <= charCode && charCode <= 0x39) || */ (0x41 <= charCode && charCode <= 0x5a) || (0x61 <= charCode && charCode <= 0x7a);
}

type Path = `/${string}`;

interface Context<T> {
    request: Request;
    env: T;
    path: string;
    pathIndex: number;
    queryIndex: number;
    searchParams: URLSearchParams;
    param: Record<string, string>;
}
type Handler<E, C> = (context: Context<E> & C) => Response | PromiseLike<Response>;

interface Handlers extends Map<string, { handler: Handler<unknown, {}> | Response, paramNames?: string[]; }> { }

interface Node {
    meta?: Handlers;
    part?: [number[], Node];
    fail?: Node;
    param?: ParamNode;
    wildcard?: WildcardNode;
}
interface Endpoint extends Node {
    meta: Handlers;
}
class Node extends Map<number, Node> {
    constructor(public readonly deep = 0) {
        super();
    }
    isEndpoint(): this is Endpoint {
        return !!this.meta?.size;
    }
    put(charCode: number) {
        let next = super.get(charCode);
        if (next)
            return next;
        next = new Node(this.deep + 1);
        super.set(charCode, next);
        return next;
    }
    putParam() {
        return this.param ??= new ParamNode();
    }
    putWildcard() {
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
            } while (!node.isEndpoint() && !node.param && !node.wildcard && node.size === 1);
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
    suffix = false;
    fail = this;
    putParam(): never {
        throw new Error('is ParamNode');
    }
    putWildcard(): never {
        throw new Error('is ParamNode');
    }
    build() {
        const queue: Node[] = [this];
        for (let i = 0; i < queue.length; i++) {
            const temp = queue[i];
            for (const [charCode, node] of temp) {
                this.suffix ||= charCode !== SLASH;
                node.fail = temp !== this && temp.fail?.get(charCode) || this;
                node.param?.build();
                node.wildcard?.build();
                if (charCode === SLASH || node.param || node.wildcard)
                    continue;
                queue.push(node);
            }
        }
        return this;
    }
}
class WildcardNode extends Node {
    put(charCode: number): never;
    put() {
        throw new Error('is WildcardNode');
    }
    putParam(): never {
        throw new Error('is WildcardNode');
    }
    putWildcard(): never {
        throw new Error('is WildcardNode');
    }
    build() {
        return this;
    }
}

function put(node: Node, path: string, offset = path.charCodeAt(0) === SLASH ? 1 : path.charCodeAt(0) === ESCAPE && path.charCodeAt(1) === SLASH ? 2 : 0, paramNames: string[] = [], escape = false): { node: Node, paramNames: string[]; } {
    if (offset >= path.length)
        return { node, paramNames };
    const charCode = path.charCodeAt(offset);
    if (!escape) switch (charCode) {
        case ESCAPE:
            return put(node, path, offset + 1, paramNames, true);
        case PARAM:
            return putParam(node, path, offset + 1, paramNames);
        case WILDCARD:
            return putWildcard(node, path, offset + 1, paramNames);
    }
    if (charCode === QUESTION)
        throw new Error('Unauthorized character: ?');
    return put(node.put(charCode), path, offset + 1, paramNames);
}
function putParam(node: Node, path: string, offset: number, paramNames: string[]) {
    let _offset = offset, charCode;
    while (!isNaN(charCode = path.charCodeAt(_offset)) && isParamNameChar(charCode)) _offset++;
    if (_offset === offset)
        return put(node, path, offset - 1, paramNames, true);
    paramNames.push(path.slice(offset, _offset));
    return put(node.putParam(), path, charCode === ESCAPE ? _offset + 1 : _offset, paramNames, true);
}
function putWildcard(node: Node, path: string, offset: number, paramNames: string[]) {
    const charCode = path.charCodeAt(offset);
    if (isNaN(charCode)) {
        paramNames.push('*');
        return put(node.putWildcard(), path, offset + 1, paramNames);
    }
    return put(node, path, offset - 1, paramNames, true);
}

function clean(node: Node): boolean {
    let hasEndpoint = node.isEndpoint();
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

function* forEach(node: Node, charCodeLists: number[][] = [[SLASH]]): Generator<[string, Path]> {
    if (node.isEndpoint()) {
        for (const [method, { paramNames }] of node.meta) {
            const path = String.raw({
                raw: [...charCodeLists.map((charCodeList) => String.fromCharCode.apply(String, charCodeList))],
            }, ...(paramNames || []).map((name) => name.replace(/^[a-zA-Z]/, ':$&'))) as Path;
            yield [method, path];
        }
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
    if (root.wildcard?.isEndpoint())
        return root;
    if (node.isEndpoint() && !root.isEndpoint()) {
        root.meta = new Map();
        for (const [method, { handler, paramNames }] of node.meta) {
            root.meta.set(method, {
                handler,
                paramNames: baseParamNames?.length || paramNames?.length ? [...baseParamNames || [], ...paramNames || []] : undefined,
            });
        }
    }
    for (const [charCode, child] of node)
        mount(root.put(charCode), child, baseParamNames);
    if (node.param)
        root.param = mount(root.putParam(), node.param, baseParamNames);
    if (node.wildcard)
        root.wildcard = mount(root.putWildcard(), node.wildcard, baseParamNames);
    return root;
}

function buildContext(ctx = {} as Context<any>, request: Request, pathIndex: number, queryIndex: number, param: Record<string, string>, env: any): Context<any> {
    ctx.env = env;
    ctx.request = request;
    ctx.pathIndex = pathIndex;
    ctx.queryIndex = queryIndex;
    ctx.path = request.url.slice(pathIndex, queryIndex);
    ctx.param = param;
    ctx.searchParams = new URLSearchParams(request.url.slice(queryIndex + 1));
    return ctx;
}

function evaluateFind<T, C>(root: Node): (request: Request, env: T, ctx: C) => Promise<Response> {
    const values: any[] = [], paramNodes: any[] = [];
    const findCode = buildFindCode(root.build(), 1);
    let code = '';
    if (paramNodes.length) {
        code += 'function param(o,deep=0,n=new Map){for(let k in o)if(k.length===1)n.set(k.charCodeAt(0),param(o[k],deep+1));return n.deep=deep,n.index=o.index,n.isEnd=o.isEnd,n}';
        code += 'function build(r,q=[r]){while(q.length){let n=q.pop();for(let[c,e]of n)e.fail=n!==r&&n.fail[c]||r,q.push(e);}return r}';
        code += `const ${paramNodes.map((paramNode, i) => `param_${i}=build(param(${JSON.stringify(paramNode)}))`).join(',')};`;
    }
    code += 'return async function(request,env,ctx){';
    code += 'const{method,url}=request;let{length}=url;';
    code += `for(let offset_0=0,count=0;offset_0<=length;offset_0++){`;
    code += `if(url.charCodeAt(offset_0)===${SLASH})count++;`;
    code += `if(count!==3)continue;`;
    code += findCode;
    code += `break}`;
    code += 'return new Response(null,{status:404});';
    code += '}';
    return Function('buildContext', ...values.map((_, i) => `value_${i}`), code)(buildContext, ...values);
    function buildFindCode(node: Node, offset = 0, paramCodes: string[] = [], depth = 0): string {
        let code = '';
        if (node.isEndpoint()) {
            if (isFinite(offset))
                code += `if(offset_${depth}+${offset}>=length||url.charCodeAt(offset_${depth}+${offset})===${QUESTION})`;
            code += 'switch(method){';
            const metadata = new Map(node.meta);
            const HEAD = metadata.get('HEAD'), GET = metadata.get('GET'), ALL = metadata.get('ALL');
            metadata.delete('HEAD'), metadata.delete('GET'), metadata.delete('ALL');
            function value({ handler, paramNames }: { handler: unknown, paramNames?: string[]; }) {
                let ctx = `buildContext(ctx,request,offset_0,offset_${depth}+${offset},{`;
                if (paramNames) for (const [key, paramCode] of new Map(paramNames.map((name, i) => [name, paramCodes[i]])))
                    ctx += `${JSON.stringify(key)}:${paramCode},`;
                ctx += `},env)`;
                const index = values.push(handler) - 1;
                return typeof handler === 'function' ? `value_${index}(${ctx})` : `value_${index}.clone()`;
            }
            if (HEAD)
                code += `case'HEAD':return ${value(HEAD)};`;
            else if (GET)
                code += `case'HEAD':`;
            if (GET)
                code += `case'GET':return ${value(GET)};`;
            for (const [method, meta] of metadata)
                code += `case${JSON.stringify(method)}:return ${value(meta)};`;
            if (ALL)
                code += `default:return ${value(ALL)};`;
            code += '}';
        }
        if (!isFinite(offset))
            return code;
        if (node.part) {
            const [charCodeList, next] = node.part;
            code += `if(`;
            code += charCodeList.map((charCode, index) => `url.charCodeAt(offset_${depth}+${offset + index})===${charCode}`).join('&&');
            code += '){';
            code += buildFindCode(next, offset + charCodeList.length, paramCodes, depth);
            code += `}`;
        } else if (node.size) {
            code += `switch(url.charCodeAt(offset_${depth}+${offset})){`;
            code += `case ${QUESTION}:{length=offset_${depth}+${offset};break}`;
            for (const [charCode, child] of node) {
                code += `case ${charCode}:{`;
                code += buildFindCode(child, offset + 1, paramCodes, depth);
                code += `break}`;
            }
            code += `}`;
        }
        if (node.param) {
            if (node.param.suffix) {
                const nodeList: [{ isEnd: boolean, index?: number; }, Node][] = [];
                let endCount = 0;
                const index = paramNodes.push((function param(node: Node, data: any = {}, isEnd?: boolean) {
                    data.isEnd = isEnd || undefined;
                    if (isEnd)
                        endCount++;
                    if (isEnd || node.isEndpoint())
                        data.index = nodeList.push([data, node]);
                    if (!isEnd) for (const [charCode, child] of node) {
                        const acNode = param(child, {}, Boolean(charCode === SLASH || child.param || child.wildcard));
                        data[String.fromCharCode(charCode)] = acNode;
                    }
                    return data;
                })(node.param)) - 1;
                code += `for(let node_${depth}=param_${index},offset_${depth + 1}=offset_${depth}+${offset},charCode;;offset_${depth + 1}++){`;
                code += `if(offset_${depth + 1}>=length||(charCode=url.charCodeAt(offset_${depth + 1}))===${QUESTION}){length=offset_${depth + 1};`;
                if (nodeList.length - endCount) {
                    code += `if(offset_${depth}+${offset}<length-node_${depth}.deep){`;
                    code += `while(!node_${depth}.index&&node_${depth}!==param_${index})node_${depth}=node_${depth}.fail;`;
                    code += `switch(node_${depth}.index){`;
                    for (const [{ isEnd, index }, next] of nodeList) {
                        if (isEnd)
                            continue;
                        code += `case ${index}:{`;
                        code += buildFindCode(next, Infinity, paramCodes && [...paramCodes, `url.slice(offset_${depth}+${offset},length-node_${depth}.deep)`], depth);
                        code += `break}`;
                    }
                    code += '}';
                    code += '}';
                }
                code += 'break}';
                code += `let node=node_${depth}.get(charCode);`;
                code += `while(!node&&node_${depth}!==param_${index})node_${depth}=node_${depth}.fail,node=node_${depth}.get(charCode);if(node)node_${depth}=node;`;
                if (endCount) {
                    code += `if(node_${depth}.isEnd){`;
                    code += `if(offset_${depth}+${offset}<=offset_${depth + 1}-node_${depth}.deep){`;
                    code += `switch(node_${depth}.index){`;
                    for (const [{ isEnd, index }, next] of nodeList) {
                        if (!isEnd)
                            continue;
                        code += `case ${index}:{`;
                        code += buildFindCode(next, 1, paramCodes && [...paramCodes, `url.slice(offset_${depth}+${offset},offset_${depth + 1}-node_${depth}.deep+1)`], depth + 1);
                        code += `break}`;
                    }
                    code += '}';
                    code += '}';
                    code += 'break}';
                }
                code += `if(charCode===${SLASH})break;`;
                code += '}';
            } else {
                code += `for(let offset_${depth + 1}=offset_${depth}+${offset},charCode;;offset_${depth + 1}++){`;
                code += `if(offset_${depth + 1}>=length||(charCode=url.charCodeAt(offset_${depth + 1}))===${QUESTION}){length=offset_${depth + 1};`;
                if (node.param.isEndpoint()) {
                    code += `if(offset_${depth}+${offset}<length){`;
                    code += buildFindCode(node.param, Infinity, paramCodes && [...paramCodes, `url.slice(offset_${depth}+${offset},length)`], depth);
                    code += '}';
                }
                code += 'break}';
                code += `if(charCode===${SLASH}){`;
                if (node.param.has(SLASH)) {
                    code += `if(offset_${depth}+${offset}!==offset_${depth + 1}){`;
                    code += buildFindCode(node.param.get(SLASH)!, 1, paramCodes && [...paramCodes, `url.slice(offset_${depth}+${offset},offset_${depth + 1})`], depth + 1);
                    code += '}';
                }
                code += 'break}';
                code += '}';
            }
        }
        if (node.wildcard?.isEndpoint()) {
            code += `const queryIndex=url.indexOf('?',offset_${depth}+${offset});if(queryIndex!==-1)length=queryIndex;`;
            code += `if(offset_${depth}+${offset}<length){`;
            code += buildFindCode(node.wildcard, Infinity, paramCodes && [...paramCodes, `url.slice(offset_${depth}+${offset},length)`], depth);
            code += '}';
        }
        return code;
    }
}

function buildFind<T, C>(root: Node): (request: Request, env: T, ctx: C) => Promise<Response> {
    root = mount(new Node(), root).build();
    return async function (request, env, ctx: any) {
        const { url } = request;
        const { length } = url;
        for (let offset = 0, count = 0; offset <= length; offset++) {
            if (url.charCodeAt(offset) === SLASH)
                count++;
            if (count !== 3)
                continue;
            for (const res of find(root, request, env, ctx, offset, offset + 1, length))
                return res;
            break;
        }
        return new Response(null, { status: 404 });
    };
    function* find(root: Node, request: Request, env: any, ctx: any, pathIndex: number, start: number, length: number, paramFragment: [number, number][] = [], index = 0): Generator<Response | PromiseLike<Response>> {
        if (start >= length || request.url.charCodeAt(start) === QUESTION) {
            if (!root.isEndpoint())
                return;
            const meta = root.meta.get(request.method) || request.method === 'HEAD' && root.meta.get('GET') || root.meta.get('ALL');
            if (!meta)
                return;
            const { handler, paramNames } = meta;
            if (typeof handler === 'function') {
                const param: Record<string, string> = {};
                if (paramNames) for (const [index, name] of paramNames.entries())
                    param[name] = String.prototype.slice.apply(request.url, paramFragment[index]);
                yield handler(buildContext(ctx, request, pathIndex, start, param, env));
            } else if (meta)
                yield handler.clone();
            return;
        }
        if (root.part) PART: {
            let offset = start;
            const [charCodeList, next] = root.part;
            for (const charCode of charCodeList) {
                if (offset < length && request.url.charCodeAt(offset++) === charCode)
                    continue;
                break PART;
            }
            yield* find(next, request, env, ctx, pathIndex, offset, length, paramFragment, index);
        } else {
            const next = root.get(request.url.charCodeAt(start));
            if (next)
                yield* find(next, request, env, ctx, pathIndex, start + 1, length, paramFragment, index);
        }
        if (root.param) {
            if (root.param.suffix) for (let offset = start, node: Node = root.param, charCode; ; offset++) {
                if (offset >= length || (charCode = request.url.charCodeAt(offset)) === QUESTION) {
                    while (!node.isEndpoint() && node !== root.param)
                        node = node.fail!;
                    if (node.isEndpoint() && start < length - node.deep) {
                        paramFragment[index] = [start, offset - node.deep];
                        yield* find(node, request, env, ctx, pathIndex, offset, offset, paramFragment, index + 1);
                    }
                    break;
                }
                let cnode = node.get(charCode);
                while (!cnode && node !== root.param) {
                    node = node.fail!;
                    cnode = node.get(charCode);
                }
                if (cnode)
                    node = cnode;
                if (charCode === SLASH || node.param || node.wildcard) {
                    if (node === root.param || start > offset - node.deep)
                        break;
                    paramFragment[index] = [start, offset - node.deep + 1];
                    yield* find(node, request, env, ctx, pathIndex, offset + 1, length, paramFragment, index + 1);
                    break;
                }
            } else for (let offset = start, charCode; ; offset++) {
                if (offset >= length || (charCode = request.url.charCodeAt(offset)) === QUESTION) {
                    if (root.param.isEndpoint() && start < length) {
                        paramFragment[index] = [start, offset];
                        yield* find(root.param, request, env, ctx, pathIndex, offset, offset, paramFragment, index + 1);
                    }
                    break;
                }
                if (charCode !== SLASH)
                    continue;
                const next = root.param.get(SLASH);
                if (next && start < offset) {
                    paramFragment[index] = [start, offset];
                    yield* find(next, request, env, ctx, pathIndex, offset + 1, length, paramFragment, index + 1);
                }
                break;
            }
        }
        if (root.wildcard?.isEndpoint()) {
            const queryIndex = request.url.indexOf('?', start);
            if (queryIndex !== -1)
                length = queryIndex;
            paramFragment[index] = [start, length];
            yield* find(root.wildcard, request, env, ctx, pathIndex, length, length, paramFragment, index + 1);
        }
    }
}

class Router<E = void, C extends object | void = void> {
    #node = new Node();
    #evaluate;
    constructor(evaluate = false) {
        this.#evaluate = evaluate;
    }
    on(method: string, path: string, handler: Handler<E, C>): this;
    on(method: string, path: string, data: unknown): this;
    on(method: string, path: string, data: unknown) {
        const { node, paramNames } = put(this.#node, path);
        const handlers: Handlers = node.meta ||= new Map();
        if (!handlers.has(method))
            handlers.set(method, {
                handler: typeof data === 'function' ? data as Handler<any, any> : newResponse(data),
                paramNames,
            });
        return this;
    }
    #clean() {
        clean(this.#node);
        return this;
    }
    mount(path: string, tree: Router<E, C>) {
        if (path.charCodeAt(path.length - 1) !== SLASH)
            path = `${path}/`;
        const { node, paramNames } = put(this.#clean().#node, path);
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

function newResponse(response: Response, status?: number, headers?: HeadersInit): Response;
function newResponse(body: BodyInit | null, status?: number, headers?: HeadersInit): Response;
function newResponse(data: number | bigint | string | object, status?: number, headers?: HeadersInit): Response;
function newResponse(data?: undefined, status?: number, headers?: HeadersInit): Response;
function newResponse(data: unknown, status?: number, headers?: HeadersInit): Response;
function newResponse(data: unknown, status?: number, headers?: HeadersInit) {
    switch (typeof data) {
        case 'bigint':
            return Response.json(data.toString(), { status, headers });
        case 'string':
            return new Response(data, { status, headers: headers ?? { 'Content-Type': 'text/plain; charset=utf8' } });
        case 'object':
            if (data instanceof Response)
                return new Response(data.body, { ...data, status: status ?? data.status, headers: headers ?? data.headers });
            if (data instanceof Blob)
                return new Response(data, { status, headers });
            if (data === null || data instanceof ReadableStream || data instanceof FormData || data instanceof URLSearchParams || data instanceof ArrayBuffer || ArrayBuffer.isView(data))
                return new Response(data, { status, headers: headers ?? { 'Content-Type': 'text/plain; charset=utf8' } });
            return Response.json(null, { status, headers });
        case 'undefined':
            return new Response(null, { status, headers: headers ?? { 'Content-Type': 'text/plain; charset=utf8' } });
        default:
            return Response.json(data, { status, headers });
    }
}

export { Router, newResponse };
