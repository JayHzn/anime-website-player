// Streamtape — the URL is split across a string concat so a naive regex misses it.
// Port of Aniyomi's StreamTapeExtractor.

import { httpGetText } from '../http.js';
import { buildHeaders, createVideo } from '../video.js';

const TARGET = "document.getElementById('robotlink')";

export const streamtape = {
  name: 'Streamtape',
  host: 'streamtape',
  match: (url) => /streamtape|streamadblocker|stape\./i.test(url),

  async extract(url, { prefix = '' } = {}) {
    // Normalise any /v/<id>/title link to the embed form.
    let embedUrl = url;
    if (!/\/e\//.test(url)) {
      const id = url.split('/')[4];
      if (!id) return [];
      embedUrl = `https://streamtape.com/e/${id}`;
    }

    const referer = `${new URL(embedUrl).origin}/`;
    const html = await httpGetText(embedUrl, { referer, headers: buildHeaders(referer) });
    if (!html) return [];

    const idx = html.indexOf(`${TARGET}.innerHTML = '`);
    if (idx === -1) return [];
    const script = html.slice(idx + `${TARGET}.innerHTML = '`.length);

    const head = script.split("'")[0];
    const tailIdx = script.indexOf("+ ('xcd");
    if (tailIdx === -1) return [];
    const tail = script.slice(tailIdx + 4).split("'")[0];

    const videoUrl = `https:${head}${tail}`;
    return [createVideo({
      url: videoUrl,
      quality: `${prefix}Streamtape - mp4`,
      host: 'streamtape',
      referer: embedUrl,
      headers: buildHeaders(referer),
    })];
  },
};
