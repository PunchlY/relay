
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
    newResponse: typeof newResponse,
}
type Handler<T, C> = (context: Context<T> & C) => Response | PromiseLike<Response>;

interface Handlers extends Record<string, Handler<any, any>> { }

interface Node {
    value?: Handlers;
}
interface Endpoint extends Node {
    value: Handlers;
}
class Node extends Map<number, Node> {
    part?: [number[], Node];
    fail?: Node;
    param?: ParamNode;
    wildcard?: WildcardNode;
    paramNames?: string[];
    constructor(public readonly deep = 0) {
        super();
    }
    isEndpoint(): this is Endpoint {
        return 'value' in this;
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

function put(node: Node, path: string, offset = path.charCodeAt(0) === SLASH ? 1 : path.charCodeAt(0) === ESCAPE && path.charCodeAt(1) === SLASH ? 2 : 0, paramNames: string[] = [], escape = false): Node | undefined {
    if (offset >= path.length) {
        if (!node.isEndpoint() && paramNames.length)
            node.paramNames = paramNames;
        return node;
    }
    // if (node.wildcard?.isEndpoint())
    //     return;
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
        return;
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

function* forEach(node: Node, charCodeLists: number[][] = [[SLASH]]): Generator<[Path, Endpoint]> {
    if (node.isEndpoint()) {
        const path = String.raw({
            raw: [...charCodeLists.map((charCodeList) => String.fromCharCode.apply(String, charCodeList))],
        }, ...(node.paramNames || []).map((name) => name.replace(/^[a-zA-Z]/, ':$&'))) as Path;
        yield [path, node];
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

function mount<T extends Node>(root: NoInfer<T>, node: T, paramNames?: string[]) {
    if (root.wildcard?.isEndpoint())
        return root;
    if (node.isEndpoint() && !root.isEndpoint()) {
        root.value = node.value;
        if (paramNames || node.paramNames)
            root.paramNames = [...paramNames || [], ...node.paramNames || []];
    }
    for (const [charCode, child] of node)
        mount(root.put(charCode), child, paramNames);
    if (node.param)
        root.param = mount(root.putParam(), node.param, paramNames);
    if (node.wildcard)
        root.wildcard = mount(root.putWildcard(), node.wildcard, paramNames);
    return root;
}

function buildContext(ctx = {} as Record<any, string> & Context<any>, request: Request, pathIndex: number, queryIndex: number, param: Record<string, string>, env: any): Context<any> {
    ctx.env = env;
    ctx.request = request;
    ctx.pathIndex = pathIndex;
    ctx.queryIndex = queryIndex;
    ctx.searchParams = new URLSearchParams(request.url.slice(queryIndex + 1));
    ctx.path = request.url.slice(pathIndex, queryIndex);
    ctx.newResponse = newResponse;
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
            const index = values.push(node.value) - 1;
            code += `if(method in value_${index}){`;
            code += `return(0,value_${index}[method])(buildContext(ctx,request,offset_0,offset_${depth}+${offset},{`;
            if (node.paramNames) for (const [key, paramCode] of new Map(node.paramNames.map((name, i) => [name, paramCodes[i]])))
                code += `${JSON.stringify(key)}:${paramCode},`;
            code += `},env))`;
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
        const { method, url } = request;
        const { length } = url;
        for (let offset = 0, count = 0; offset <= length; offset++) {
            if (url.charCodeAt(offset) === SLASH)
                count++;
            if (count !== 3)
                continue;
            for (const { handler, param, queryIndex } of find(root, method, url, offset + 1, length))
                return handler(buildContext(ctx, request, offset, queryIndex, param, env));
            break;
        }
        return new Response(null, { status: 404 });
    };
    function* find(root: Node, method: string, url: string, start: number, length: number, paramFragment: [number, number][] = [], index = 0): Generator<{ handler: Handler<any, any>, param: Record<string, string>, queryIndex: number; }> {
        if (start >= length || url.charCodeAt(start) === QUESTION) {
            if (root.isEndpoint() && method in root.value) {
                const param: Record<string, string> = {};
                if (root.paramNames) for (const [index, name] of root.paramNames.entries())
                    param[name] = url.slice(...paramFragment[index]);
                yield { handler: root.value[method], param, queryIndex: start };
            }
            return;
        }
        if (root.part) PART: {
            let offset = start;
            const [charCodeList, next] = root.part;
            for (const charCode of charCodeList) {
                if (offset < length && url.charCodeAt(offset++) === charCode)
                    continue;
                break PART;
            }
            yield* find(next, method, url, offset, length, paramFragment, index);
        } else {
            const next = root.get(url.charCodeAt(start));
            if (next)
                yield* find(next, method, url, start + 1, length, paramFragment, index);
        }
        if (root.param) {
            if (root.param.suffix) for (let offset = start, node: Node = root.param, charCode; ; offset++) {
                if (offset >= length || (charCode = url.charCodeAt(offset)) === QUESTION) {
                    while (!node.isEndpoint() && node !== root.param)
                        node = node.fail!;
                    if (node.isEndpoint() && start < length - node.deep) {
                        paramFragment[index] = [start, offset - node.deep];
                        yield* find(node, method, url, offset, offset, paramFragment, index + 1);
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
                    yield* find(node, method, url, offset + 1, length, paramFragment, index + 1);
                    break;
                }
            } else for (let offset = start, charCode; ; offset++) {
                if (offset >= length || (charCode = url.charCodeAt(offset)) === QUESTION) {
                    if (root.param.isEndpoint() && start < length) {
                        paramFragment[index] = [start, offset];
                        yield* find(root.param, method, url, offset, offset, paramFragment, index + 1);
                    }
                    break;
                }
                if (charCode !== SLASH)
                    continue;
                const next = root.param.get(SLASH);
                if (next && start < offset) {
                    paramFragment[index] = [start, offset];
                    yield* find(next, method, url, offset + 1, length, paramFragment, index + 1);
                }
                break;
            }
        }
        if (root.wildcard?.isEndpoint()) {
            const queryIndex = url.indexOf('?', start);
            if (queryIndex !== -1)
                length = queryIndex;
            paramFragment[index] = [start, length];
            yield* find(root.wildcard, method, url, length, length, paramFragment, index + 1);
        }
    }
}

class Router<T = void, C extends object | void = void> {
    #node = new Node();
    on(method: string, path: string, handler: Handler<T, C>) {
        const endpoint = put(this.#node, path);
        if (!endpoint)
            return this;
        const handlers = endpoint.value ||= Object.create(null) as Handlers;
        if (typeof handler === 'function')
            handlers[method] ||= handler;
        return this;
    }
    get(path: string, handler: Handler<T, C>) {
        Router.prototype.on.call(this, 'GET', path, handler);
        Router.prototype.on.call(this, 'HEAD', path, handler);
        return this;
    }
    post(path: string, handler: Handler<T, C>) {
        Router.prototype.on.call(this, 'POST', path, handler);
        return this;
    }
    put(path: string, handler: Handler<T, C>) {
        Router.prototype.on.call(this, 'PUT', path, handler);
        return this;
    }
    delete(path: string, handler: Handler<T, C>) {
        Router.prototype.on.call(this, 'PUT', path, handler);
        return this;
    }
    patch(path: string, handler: Handler<T, C>) {
        Router.prototype.on.call(this, 'PATCH', path, handler);
        return this;
    }
    mount(path: string, tree: Router<T>) {
        if (path.charCodeAt(path.length - 1) !== SLASH)
            path = `${path}/`;
        const endpoint = put(this.#clean().#node, path);
        if (!endpoint)
            return this;
        for (const _ of forEach(endpoint))
            return this;
        const node = mount(new Node(), tree.#clean().#node);
        mount(endpoint, node, endpoint.paramNames);
        return this;
    }
    #clean() {
        clean(this.#node);
        return this;
    }
    *[Symbol.iterator]() {
        for (const [path, node] of forEach(this.#node)) {
            for (const method in node.value)
                yield [method, path] as const;
        }
    }
    compose(evaluate = false) {
        this.#clean();
        return evaluate ? evaluateFind<T, C>(this.#node) : buildFind<T, C>(this.#node);
    }
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
