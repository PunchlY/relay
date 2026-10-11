import { Elysia } from "elysia";

export default new Elysia()
  .options("*", ({ set, headers }) => {
    set.status = 204;
    set.headers["access-control-allow-methods"] = "*";
    set.headers["access-control-allow-headers"] =
      headers["access-control-request-headers"];
    set.headers["access-control-max-age"] = "86400";
  })
  .onAfterHandle(({ request, set }) => {
    if (request.method !== "OPTIONS") {
      set.headers["access-control-allow-methods"] = request.method;
    }
    set.headers["access-control-allow-origin"] = "*";
  })
  .as("global");
