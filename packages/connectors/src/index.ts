export * from "./types.js";
export * from "./util.js";

import { nwsAlerts } from "./sources/nws-alerts.js";
import { usgsQuakes } from "./sources/usgs-quakes.js";
import { nasaEonet } from "./sources/nasa-eonet.js";
import { issLocation } from "./sources/iss-location.js";
import { openaq } from "./sources/openaq.js";
import { openSky } from "./sources/opensky.js";
import { gdelt } from "./sources/gdelt.js";
import { hackerNews } from "./sources/hackernews.js";
import { wikipediaRc } from "./sources/wikipedia-rc.js";
import { spacex } from "./sources/spacex.js";
import { openMeteo } from "./sources/openmeteo.js";
import { reddit } from "./sources/reddit.js";
import { githubEvents } from "./sources/github-events.js";
import { coinGecko } from "./sources/coingecko.js";
import { mqttGeneric } from "./sources/mqtt-generic.js";
import { webhook } from "./sources/webhook.js";
import { rssFeed } from "./sources/rss.js";
import { noaaSwpc } from "./sources/noaa-swpc.js";
import { emsc } from "./sources/emsc.js";
import { nasaFirms } from "./sources/nasa-firms.js";
import { restGeneric } from "./sources/rest-generic.js";
import { simulator } from "./sources/simulator.js";
import type { Connector } from "./types.js";

export {
  nwsAlerts,
  usgsQuakes,
  nasaEonet,
  issLocation,
  openaq,
  openSky,
  gdelt,
  hackerNews,
  wikipediaRc,
  spacex,
  openMeteo,
  reddit,
  githubEvents,
  coinGecko,
  mqttGeneric,
  webhook,
  rssFeed,
  noaaSwpc,
  emsc,
  nasaFirms,
  restGeneric,
  simulator,
};

export { getWebhookRouter } from "./sources/webhook.js";

export const ALL_CONNECTORS: Connector<any>[] = [
  nwsAlerts,
  usgsQuakes,
  nasaEonet,
  issLocation,
  openaq,
  openSky,
  gdelt,
  hackerNews,
  wikipediaRc,
  spacex,
  openMeteo,
  reddit,
  githubEvents,
  coinGecko,
  mqttGeneric,
  webhook,
  rssFeed,
  noaaSwpc,
  emsc,
  nasaFirms,
  restGeneric,
  simulator,
];

export function getConnectorById(id: string): Connector<any> | undefined {
  return ALL_CONNECTORS.find((c) => c.id === id);
}
