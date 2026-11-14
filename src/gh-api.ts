import { env } from "cloudflare:workers";
import { Elysia, t } from "elysia";

export default new Elysia({
  prefix: "/gh-api",
}).get(
  "/repos/:owner/:repo/releases/assets/:asset_id",
  async ({ params, redirect, set }) => {
    const [owner, repo, asset_id] = [
      params.owner,
      params.repo,
      params.asset_id,
    ].map(encodeURIComponent);
    const { url, status } = await fetch(
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
    if (status !== 200) {
      set.status = status;
      return;
    }
    return redirect(url);
  },
  {
    params: t.Object({
      repo: t.String(),
      owner: t.String(),
      asset_id: t.Integer(),
    }),
  },
);
