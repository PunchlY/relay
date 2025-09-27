
class MultiMap<K, V> extends Map<K, V[]> {
    push(key: K, value: V) {
        let list = super.get(key);
        if (!list) {
            super.set(key, list = []);
        }
        list.push(value);
    }
}

type Handler<Env = unknown, CfHostMetadata = unknown> = (
    request: Request<CfHostMetadata, IncomingRequestCfProperties<CfHostMetadata>>,
    env: Env,
    ctx: ExecutionContext,
) => Promise<Response> | Response;

type PatternHandler<Env = unknown, CfHostMetadata = unknown> = (
    request: Request<CfHostMetadata, IncomingRequestCfProperties<CfHostMetadata>>,
    env: Env,
    ctx: ExecutionContext,
    pattern: URLPatternResult,
) => Promise<Response> | Response;

class PatternRouter<Env = unknown, CfHostMetadata = unknown> {
    #routes = new MultiMap<string, [URLPattern, PatternHandler<Env, CfHostMetadata>]>();
    #fallbackRoutes: [URLPattern, PatternHandler<Env, CfHostMetadata>][] = [];
    #fallback?: Handler<Env, CfHostMetadata>;

    addRoute(method: string, input: string | URLPatternInit, handler: PatternHandler<Env, CfHostMetadata>): this;
    addRoute(input: string | URLPatternInit, handler: PatternHandler<Env, CfHostMetadata>): this;
    addRoute(handler: Handler<Env, CfHostMetadata>): this;
    addRoute(...args:
        [string, string | URLPatternInit, PatternHandler<Env, CfHostMetadata>] |
        [string | URLPatternInit, PatternHandler<Env, CfHostMetadata>] |
        [Handler<Env, CfHostMetadata>]
    ) {
        if (args.length === 1) {
            this.#fallback = args[0];
        } else if (args.length === 2) {
            this.#fallbackRoutes.push([new URLPattern(args[0]), args[1]]);
        } else {
            this.#routes.push(args[0].toUpperCase(), [new URLPattern(args[1]), args[2]]);
        }
        return this;
    }

    *candidates(method: string) {
        if (this.#routes.has(method))
            yield* this.#routes.get(method)!;
        yield* this.#fallbackRoutes;
    }

    fetch = async (
        request: Request<CfHostMetadata, IncomingRequestCfProperties<CfHostMetadata>>,
        env: Env,
        ctx: ExecutionContext,
    ) => {
        for (const [pattern, handler] of this.candidates(request.method.toUpperCase())) {
            const patternResult = pattern.exec(request.url);
            if (patternResult) {
                return handler(request, env, ctx, patternResult);
            }
        }
        if (this.#fallback)
            return this.#fallback(request, env, ctx);
        return new Response(null, { status: 404 });
    };

}

export type { Handler, PatternHandler };
export { PatternRouter };
