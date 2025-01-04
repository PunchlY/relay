const ESCAPE = 0x5c, WILDCARD = 0x2a, PARAM = 0x3a, SLASH = 0x2f, QUESTION = 0x3f, HASH = 0x23;
function isParamNameChar(charCode: number) {
    return /* (0x30 <= charCode && charCode <= 0x39) || */ (0x41 <= charCode && charCode <= 0x5a) || (0x61 <= charCode && charCode <= 0x7a);
}

interface Node<T extends object> {
    param?: ParamNode<T>;
    wildcard?: WildcardNode<T>;
}
class Node<T> extends Map<number, Node<T>> {
    readonly meta = {} as Partial<T>;
    readonly root: Node<T>;
    readonly isRoot: boolean;
    isEndpoint = false;
    constructor(public readonly parent?: Node<T>) {
        super();
        this.root = parent?.root ?? this;
        this.isRoot = this.root === this;
    }

    #set(charCode: number) {
        let next = super.get(charCode);
        if (next) {
            if (next.isRoot)
                throw new Error('Cannot set root node as a child node');
            return next;
        }
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
            throw new Error(`Unauthorized character: ${JSON.stringify(String.fromCharCode(charCode))}.`);
        return this.#set(charCode).#init(path, offset + 1, paramNames);
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
    #initStatic(path: string, offset = path.charCodeAt(0) === SLASH ? 1 : 0): Node<T> {
        if (offset === path.length) {
            if (this.isRoot || path.charCodeAt(offset - 1) === SLASH)
                return this;
            return this.#set(SLASH);
        }
        const charCode = path.charCodeAt(offset);
        if (charCode === QUESTION || charCode === HASH)
            throw new Error(`Unauthorized character: ${JSON.stringify(String.fromCharCode(charCode))}`);
        return this.#set(charCode).#initStatic(path, offset + 1);
    }

    init(path: string) {
        const [node, paramNames] = this.#init(path);
        node.isEndpoint = true;
        return { node, paramNames };
    }
    mount(path: string, node: Node<T>) {
        const mount = this.#initStatic(path);
        if (!mount.parent)
            throw new Error('Cannot mount node without a parent');
        mount.#clean();
        if (mount.isEndpoint || mount.param || mount.wildcard || mount.size)
            throw new Error('Cannot mount node on an occupied path');
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

    *#metas(charCodeLists: number[][] = [[SLASH]]): Generator<[readonly string[], meta: Partial<T>]> {
        if (this.isEndpoint)
            yield [charCodeLists.map((charCodeList) => String.fromCharCode.apply(String, charCodeList)), this.meta];
        for (const [charCode, child] of this) {
            const [...charCodeListsCopy] = charCodeLists;
            const [...charCodeListCopy] = charCodeListsCopy.pop()!;
            if (charCode === ESCAPE || (isParamNameChar(charCode) && charCodeListCopy.at(-1) === PARAM))
                charCodeListCopy.push(ESCAPE);
            charCodeListCopy.push(charCode);
            charCodeListsCopy.push(charCodeListCopy);
            yield* child.#metas(charCodeListsCopy);
        }
        if (this.param)
            yield* this.param.#metas([...charCodeLists, []]);
        if (this.wildcard)
            yield* this.wildcard.#metas([...charCodeLists, []]);
    }
    *metas() {
        yield* this.#metas();
    }

    isParamNode(): this is ParamNode<T> {
        return this instanceof ParamNode;
    }
    isWildcardNode(): this is WildcardNode<T> {
        return this instanceof WildcardNode;
    }
}
class ParamNode<T extends object> extends Node<T> {
    set param(value: ParamNode<T> | undefined) {
        throw new Error('Cannot set param on ParamNode');
    }
    set wildcard(value: WildcardNode<T> | undefined) {
        throw new Error('Cannot set wildcard on ParamNode');
    }
}
class WildcardNode<T extends object> extends Node<T> {
    set param(value: ParamNode<T> | undefined) {
        throw new Error('Cannot set param on WildcardNode');
    }
    set wildcard(value: WildcardNode<T> | undefined) {
        throw new Error('Cannot set wildcard on WildcardNode');
    }
    set(key: number, value: Node<T>): this;
    set(): never {
        throw new Error('Cannot set child on WildcardNode');
    }
}

function createNode<T extends object>() {
    return new Node<T>();
}

export { SLASH, QUESTION };
export { createNode };
export type { Node, ParamNode, WildcardNode };
