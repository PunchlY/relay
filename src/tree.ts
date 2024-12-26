
const ESCAPE = 0x5c, WILDCARD = 0x2a, PARAM = 0x3a, SLASH = 0x2f, QUESTION = 0x3f, HASH = 0x23;
function isParamNameChar(charCode: number) {
    return /* (0x30 <= charCode && charCode <= 0x39) || */ (0x41 <= charCode && charCode <= 0x5a) || (0x61 <= charCode && charCode <= 0x7a);
}

interface Node<T> {
    param?: ParamNode<T>;
    wildcard?: WildcardNode<T>;
}
class Node<T extends object> extends Map<number, Node<T>> {
    readonly root: Node<T>;
    readonly isRoot: boolean;
    isEndpoint = false;
    constructor(
        public readonly parent?: Node<T>,
        public readonly meta = {} as T,
    ) {
        super();
        this.root = parent?.root ?? this;
        this.isRoot = this.root === this;
    }

    #set(charCode: number) {
        let next = super.get(charCode);
        if (next)
            return next;
        next = new Node(this);
        super.set(charCode, next);
        return next;
    }
    #setParam() {
        return this.param ??= new ParamNode(this);
    }
    #setWildcard() {
        return this.wildcard ??= new WildcardNode(this);
    }

    #init(path: string, offset = path.charCodeAt(0) === SLASH ? 1 : path.charCodeAt(0) === ESCAPE && path.charCodeAt(1) === SLASH ? 2 : 0, paramNames: string[] = [], escape = false): [node: Node<T>, paramNames: string[]] {
        if (offset >= path.length)
            return [this, paramNames];
        const charCode = path.charCodeAt(offset);
        if (!escape) switch (charCode) {
            case ESCAPE:
                return this.#init(path, offset + 1, paramNames, true);
            case PARAM:
                return this.#initParam(path, offset + 1, paramNames);
            case WILDCARD:
                return this.#initWildcard(path, offset + 1, paramNames);
        }
        if (charCode === QUESTION || charCode === HASH)
            throw new Error(`Unauthorized character: ${String.fromCharCode(charCode)}`);
        const next = this.#set(charCode);
        if (next.isRoot)
            throw new Error();
        return next.#init(path, offset + 1, paramNames);
    }
    #initParam(path: string, offset: number, paramNames: string[]) {
        let _offset = offset, charCode;
        while (!isNaN(charCode = path.charCodeAt(_offset)) && isParamNameChar(charCode)) _offset++;
        if (_offset === offset)
            return this.#init(path, offset - 1, paramNames, true);
        paramNames.push(path.slice(offset, _offset));
        return this.#setParam().#init(path, charCode === ESCAPE ? _offset + 1 : _offset, paramNames, true);
    }
    #initWildcard(path: string, offset: number, paramNames: string[]) {
        const charCode = path.charCodeAt(offset);
        if (isNaN(charCode)) {
            paramNames.push('*');
            return this.#setWildcard().#init(path, offset + 1, paramNames);
        }
        return this.#init(path, offset - 1, paramNames, true);
    }

    init(path: string) {
        const [node, paramNames] = this.#init(path);
        node.isEndpoint = true;
        return { node, paramNames };
    }
    mount(path: string, node: Node<T>) {
        if (path.charCodeAt(path.length - 1) !== SLASH)
            path = `${path}/`;
        const [mount] = this.#init(path);
        for (let { parent: node } = mount; node; node = node.parent)
            if (node.isParamNode())
                throw new Error();
        if (!mount.parent)
            throw new Error();
        mount.#clean();
        if (mount.isEndpoint || mount.param || mount.wildcard || mount.size)
            throw new Error();
        mount.parent.set(SLASH, node);
    }

    #clean(): boolean {
        let hasEndpoint = this.isEndpoint || this.isRoot;
        for (const [charCode, child] of this) {
            if (child.#clean())
                hasEndpoint = true;
            else
                this.delete(charCode);
        }
        if (this.param) {
            if (this.param.#clean())
                hasEndpoint = true;
            else
                delete this.param;
        }
        if (this.wildcard) {
            if (this.wildcard.#clean())
                hasEndpoint = true;
            else
                delete this.wildcard;
        }
        return hasEndpoint;
    }
    clean() {
        this.#clean();
        return this;
    }

    *#metaList(charCodeLists: number[][] = [[SLASH]]): Generator<[readonly string[], meta: T]> {
        if (this.isEndpoint)
            yield [charCodeLists.map((charCodeList) => String.fromCharCode.apply(String, charCodeList)), this.meta];
        for (const [charCode, child] of this) {
            const [...charCodeListsCopy] = charCodeLists;
            const [...charCodeListCopy] = charCodeListsCopy.pop()!;
            if (charCode === ESCAPE || (isParamNameChar(charCode) && charCodeListCopy.at(-1) === PARAM))
                charCodeListCopy.push(ESCAPE);
            charCodeListCopy.push(charCode);
            charCodeListsCopy.push(charCodeListCopy);
            yield* child.#metaList(charCodeListsCopy);
        }
        if (this.param)
            yield* this.param.#metaList([...charCodeLists, []]);
        if (this.wildcard)
            yield* this.wildcard.#metaList([...charCodeLists, []]);
    }
    *metaList() {
        yield* this.#metaList();
    }

    isParamNode(): this is ParamNode<T> {
        return this instanceof ParamNode;
    }
    isWildcardNode(): this is WildcardNode<T> {
        return this instanceof WildcardNode;
    }
}
class ParamNode<T extends Record<string, any>> extends Node<T> {
    set param(value: ParamNode<T> | undefined) {
        throw new Error('is WildcardParamNode');
    }
    set wildcard(value: WildcardNode<T> | undefined) {
        throw new Error('is WildcardParamNode');
    }
}
class WildcardNode<T extends Record<string, any>> extends Node<T> {
    set param(value: ParamNode<T> | undefined) {
        throw new Error('is WildcardNode');
    }
    set wildcard(value: WildcardNode<T> | undefined) {
        throw new Error('is WildcardNode');
    }
    set(key: number, value: Node<T>): this;
    set(): never {
        throw new Error('is WildcardNode');
    }
}

function createNode<T extends object>() {
    return new Node<Partial<T>>();
}

export { SLASH };
export { createNode };
export type { Node, ParamNode, WildcardNode };

