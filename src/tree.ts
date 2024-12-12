
const ESCAPE = 0x5c, WILDCARD = 0x2a, PARAM = 0x3a, SLASH = 0x2f;
function isParamNameChar(charCode: number) {
    return /* (0x30 <= charCode && charCode <= 0x39) || */ (0x41 <= charCode && charCode <= 0x5a) || (0x61 <= charCode && charCode <= 0x7a);
}

type Path = `/${string}`;

class Node extends Map<number, Node> {
    part?: [number[], Node];
    fail?: Node;
    index?: number;
    param?: ParamNode;
    wildcard?: WildcardNode;
    paramNames?: string[];
    constructor(public readonly deep = 0) {
        super();
    }
    toJSON(): Record<any, any> {
        const { fail, deep, ...data } = this as Record<any, any> & Node;
        if (data.part) {
            // @ts-ignore
            data.part = [String.fromCharCode.apply(String, data.part[0]), data.part[1]];
        } else {
            for (const [charCode, child] of super.entries())
                data[String.fromCharCode(charCode)] = child;
        };
        return data;
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
    assign(obj: object) {
        for (const [key, value] of Object.entries(obj)) {
            if (key.length === 1)
                this.set(key.charCodeAt(0), new Node(this.deep + 1).assign(value));
            else switch (key) {
                case 'param':
                    this.param = new ParamNode().assign(value);
                    break;
                case 'wildcard':
                    this.wildcard = new WildcardNode().assign(value);
                    break;
            }
        }
        return this;
    }
    build() {
        if (this.size === 1) {
            const charCodeList: number[] = [];
            let node: Node = this;
            do {
                const [charCode, next]: [number, Node] = node.entries().next().value;
                node = next;
                charCodeList.push(charCode);
            } while (!node.index && !node.param && !node.wildcard && node.size === 1);
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
                node.fail = temp === this && temp.fail?.get(charCode) || this;
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

function put(node: Node, path: string, offset = path.charCodeAt(0) === SLASH ? 1 : path.charCodeAt(0) === ESCAPE && path.charCodeAt(1) === SLASH ? 2 : 0, paramNames: string[] = [], escape = false): Node {
    if (offset >= path.length) {
        if (!node.index && paramNames.length)
            node.paramNames = paramNames;
        return node;
    }
    if (node.wildcard?.index)
        return node.wildcard;
    const charCode = path.charCodeAt(offset);
    if (!escape) switch (charCode) {
        case ESCAPE:
            return put(node, path, offset + 1, paramNames, true);
        case PARAM:
            return putParam(node, path, offset + 1, paramNames);
        case WILDCARD:
            return putWildcard(node, path, offset + 1, paramNames);
    }
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

function clean<T>(node: Node, list: T[], newList: T[]): boolean {
    let hasEndpoint = false;
    if (node.index) {
        if (node.index - 1 in list) {
            node.index = newList.push(list[node.index - 1]);
            hasEndpoint = true;
        } else {
            delete node.index;
            delete node.paramNames;
        }
    }
    for (const [charCode, child] of node) {
        if (clean(child, list, newList))
            hasEndpoint = true;
        else
            node.delete(charCode);
    }
    if (node.param) {
        if (clean(node.param, list, newList))
            hasEndpoint = true;
        else
            delete node.param;
    }
    if (node.wildcard) {
        if (clean(node.wildcard, list, newList))
            hasEndpoint = true;
        else
            delete node.wildcard;
    }
    return hasEndpoint;
}

function mount<T extends Node>(root: T, node: Node, index = 0, paramNames?: string[]) {
    if (root.wildcard?.index)
        return root;
    if (node.index && !root.index) {
        root.index = node.index + index;
        if (paramNames || node.paramNames)
            root.paramNames = [...paramNames || [], ...node.paramNames || []];
    }
    for (const [charCode, child] of node)
        mount(root.put(charCode), child, index, paramNames);
    if (node.param)
        root.param = mount(root.putParam(), node.param, index, paramNames);
    if (node.wildcard)
        root.wildcard = mount(root.putWildcard(), node.wildcard, index, paramNames);
    return root;
}

function* find<T>(root: Node, list: T[], path: string, start: number, length: number): Generator<T> {
    if (start >= length) {
        if (root.index)
            yield list[root.index - 1];
        return;
    }
    if (root.part) PART: {
        let offset = start;
        const [charCodeList, next] = root.part;
        for (const charCode of charCodeList) {
            if (offset < length && path.charCodeAt(offset++) === charCode)
                continue;
            break PART;
        }
        yield* find(next, list, path, offset, length);
    } else {
        const next = root.get(path.charCodeAt(start));
        if (next)
            yield* find(next, list, path, start + 1, length);
    }
    if (root.param) PARAM: {
        let offset = start, node: Node = root.param;
        for (let charCode; offset < length; offset++) {
            charCode = path.charCodeAt(offset);
            let cnode = node.get(charCode);
            while (!cnode && node !== root.param) {
                node = node.fail!;
                cnode = node.get(charCode);
            }
            if (cnode)
                node = cnode;
            if (charCode === SLASH || node.param || node.wildcard) {
                if (node === root.param || start > offset - node.deep)
                    break PARAM;
                yield* find(node, list, path, offset + 1, length);
                break PARAM;
            }
        }
        if (node.index && start < offset - node.deep)
            yield* find(node, list, path, offset + 1, length);
    }
    if (root.wildcard?.index)
        yield* find(root.wildcard, list, path, length, length);
}

class Tree<T> {
    #node = new Node();
    #list: T[] = [];
    constructor(iterable?: Iterable<readonly [string, T]>) {
        if (!iterable)
            return;
        for (const args of iterable)
            Reflect.apply(Tree.prototype.push, this, args);
    }
    push(path: string, data: T) {
        const endpoint = put(this.#node, path);
        if (!endpoint || endpoint.index)
            return false;
        endpoint.index = this.#list.push(data);
        return true;
    }
    mount(path: string, tree: Tree<T>) {
        if (path.charCodeAt(path.length - 1) !== SLASH)
            path = `${path}/`;
        const node = mount(new Node(), tree.clean().#node);
        const endpoint = put(this.#node, path);
        if (!endpoint)
            return false;
        mount(endpoint, node, this.#list.length, endpoint.paramNames);
        Reflect.apply(Array.prototype.push, this.#list, tree.#list);
        return true;
    }
    clean() {
        clean(this.#node, this.#list, this.#list = []);
        return this;
    }
    compose() {
        const root = mount(new Node(), this.#node).build();
        const list = [...this.#list];
        return (path: string, offset = 0, length = path.length) => {
            if (path.charCodeAt(offset) === SLASH)
                offset++;
            for (const value of find(root, list, path, offset, length))
                return value;
        };
    }
}

type Find<T> = ReturnType<Tree<T>['compose']>;

export { Tree };
export type { Path, Find };
