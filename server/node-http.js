import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export function nodeHandler(origin, handle) {
  return async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      if (url.origin !== origin) {
        outgoing.writeHead(400).end();
        return;
      }
      const method = incoming.method;
      const request = new Request(url, {
        method,
        headers: incoming.headers,
        ...(["GET", "HEAD"].includes(method) ? {} : { body: Readable.toWeb(incoming), duplex: "half" }),
      });
      const response = await handle(request);
      outgoing.statusCode = response.status;
      for (const [key, value] of response.headers) {
        if (key !== "set-cookie") outgoing.setHeader(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
      if (response.body && method !== "HEAD") await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
    } catch {
      if (outgoing.headersSent || outgoing.destroyed) outgoing.destroy();
      else outgoing.writeHead(500, { "Cache-Control": "no-store" }).end();
    }
  };
}
