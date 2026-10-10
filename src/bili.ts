import { Elysia, t } from "elysia";
import { request as stealthFetch } from "stealth-fetch";

export default new Elysia({
  prefix: "/bili",
})
  .get("/cheese/:ssid", async function* ({ params, set }) {
    const res = await stealthFetch(
      `https://api.bilibili.com/pugv/view/web/season?season_id=${params.ssid}`,
    );
    const data = await res.json() as {
      code: 0;
      data: {
        title: string;
        episodes: {
          id: number;
          duration: number;
          title: string;
        }[];
      };
    } | { code: -404 };
    if (data.code !== 0) {
      set.status = 404;
      return;
    }
    set.headers["content-type"] = "audio/mpegurl";
    const { title, episodes } = data.data;
    yield "#EXTM3U\n";
    yield `#PLAYLIST:${title}\n`;
    for (const { id, duration, title } of episodes) {
      yield `#EXTINF:${duration} group-title="News",${title}\n`;
      yield `https://www.bilibili.com/cheese/play/ep${id}\n`;
    }
  }, {
    params: t.Object({
      ssid: t.Numeric({ minimum: 1 }),
    }),
  });
