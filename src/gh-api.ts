import { env } from "cloudflare:workers";
import { Elysia, t } from "elysia";

export default new Elysia({
  prefix: "/gh-api",
}).get(
  "/repos/:owner/:repo/releases/assets/:asset_id",
  async ({ params, set }) => {
    const [owner, repo, asset_id] = [
      params.owner,
      params.repo,
      params.asset_id,
    ].map(encodeURIComponent);
    const { ok, headers, body } = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset_id}`,
      {
        method: "HEAD",
        headers: {
          accept: "application/octet-stream",
          authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "user-agent": "curl/8.22.0",
        },
        redirect: "follow",
      },
    );
    if (!ok) {
      set.headers["cache-control"] = "public, max-age=60";
      set.status = 404;
      return null;
    }
    set.headers = Object.fromEntries(headers);
    set.headers["cache-control"] = "public, max-age=14400";
    return body;
  },
  {
    params: t.Object({
      repo: t.String(),
      owner: t.String(),
      asset_id: t.Integer(),
    }),
  },
);
