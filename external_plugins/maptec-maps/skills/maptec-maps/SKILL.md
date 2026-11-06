---
name: maptec-maps
description: Search places and nearby businesses, resolve addresses or coordinates, plan routes, compare travel distances, match road tracks, and locate IP addresses using Maptec MCP. Use when Maptec is requested or is the connected map provider, including mapping requests that do not mention Maptec by name.
description_zh: 使用 Maptec MCP 进行地点与周边搜索、地理编码、路线规划、距离计算、轨迹绑路与 IP 定位；当用户需要地图、路线、地址或坐标查询时使用。
description_en: Search places, geocode, plan routes, and related map tasks with Maptec MCP; use for map, routing, address, or coordinate requests.
version: 0.1.2
author: 云图知行
---

Use the connected Maptec MCP server and discover its actual tools and parameter schemas before calling them. Answer in the user's language.

If the connection needs credentials, direct the user to the host's secure connection flow. Maptec application API keys are created at https://lbs.maptec.com/console/ . The official remote endpoint is https://mcp.maptec.com/mcp and expects the API key itself in the Authorization header. Do not prepend Bearer unless the provider changes its documented requirements. Never request keys in chat or store them in files.

Ask only for information needed for the requested operation. Use locations and coordinates already supplied in the conversation. Clarify an ambiguous city or place only when it would materially change the result. Ask for a search center when a nearby request lacks one, and obtain missing origin or destination for routing; never assume the user's current location. Place search and geocoding do not require a route starting point or travel mode. For routing, clarify the mode when necessary; if using a documented default, state the mode used.

Choose tools by the user's goal. The following names are examples; the current connection's discovered tools and schemas are authoritative.

| User goal | Tool choice |
|---|---|
| Find a place or business by name or keyword | Prefer text search, such as `map_search_text`; use `map_search_suggest` for incomplete names or search suggestions |
| Convert a street address to coordinates | Geocoding, such as `map_search_geocode` |
| Find an address for supplied coordinates | Reverse geocoding, such as `map_search_reverse` |
| Find businesses around a location | Nearby search, such as `map_search_nearby`; resolve a named search center to coordinates first if needed |
| Get more information about a returned place | Place details, such as `map_search_places`, using an actual returned place ID |
| Plan a route between locations | Directions, such as `map_routes_directions`; resolve named endpoints to suitable coordinates if needed |
| Compare travel distances or times across origins and destinations | Distance matrix, such as `map_matrix_distance` |
| Align supplied track points to roads | Map matching, such as `map_track_snap_to_roads`, preserving the supplied point order |
| Look up the approximate location of a supplied IP address | IP geolocation, such as `map_location_ip`; do not present it as an exact device or live GPS location |

Preserve the coordinate order, coordinate system, and units defined by each tool; do not silently swap latitude and longitude or convert coordinate systems. Distinguish route distance from straight-line distance. Include duration or traffic timing only when returned by the service. Do not invent tools, parameters, ratings, opening hours, results, or routes.

For combined searches, reuse place IDs and coordinates already returned during the task. Request only enough candidates to answer the question, and fetch place details only when the requested information is missing. Apply supported location and language parameters from the user's context; a search bias or relevance ranking alone does not establish a strict radius or travel-time boundary.

- To find the closest place by driving or walking, search for candidates, then compare routed distances or durations with a matrix using the requested mode. Keep matrix rows and columns associated with their original locations, and exclude unreachable or failed pairs from the ranking. Request detailed directions for the selected destination when needed. Describe it as the best among the evaluated candidates, rather than the globally nearest place.
- For a request such as "cafes within a ten-minute walk," retrieve a reasonable candidate set and filter using returned walking durations. Do not convert the time threshold to an assumed search radius or infer walking duration from driving results. If the needed routing tools or mode are unavailable, explain that the travel-time condition could not be verified. A finite candidate search is not a complete reachable-area calculation.
- Prefer a supported matrix call for comparing multiple journeys over repeated directions calls, respecting the discovered batch limits. Reuse results for unchanged inputs within the task; refresh time-sensitive data when the user's timing or route conditions change.

Check the service response status even when the MCP call itself reports no transport error. A response with status ERROR is a failed query. When geocoding returns isDegraded or isPartial, or only a country-level match for a specific address or place, describe that precision limit. Do not present a degraded match as an exact location or use it as a precise routing endpoint. Where a place-name search can resolve the request using information already supplied, try it before asking for more details. Ask for a more specific address or coordinate if the result remains ambiguous or too coarse. Verify the returned place and coordinates before planning a route.

Use locations and other data within the scope of the user's request. Do not send unrelated private data to the map service. If a tool fails or authentication is incomplete, explain the specific missing step and avoid presenting estimated outputs as service results.

Official documentation:
- Overview: https://lbs.maptec.com/docs/en-US/mcp/introduction
- Connection setup: https://lbs.maptec.com/docs/en-US/mcp/overview
