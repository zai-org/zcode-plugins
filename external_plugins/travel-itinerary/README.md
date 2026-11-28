# Travel Itinerary

Turn a trip plan sheet into a printable day-by-day itinerary, a calendar file for your phone and a bookings list. Every time is read in its own time zone (Asia/Tokyo, UTC+9 or just 东京), so flight durations, home time and calendar entries come out right across borders. Catches the mistakes that ruin a trip: a flight with no arrival time zone that shifts the rest of the trip, arrivals before departures, overlapping plans, too little time before a flight or between places, nights with nowhere to stay or two hotels on one night, stays without a check-out date, unreadable times like 19:3O and missing booking refs. Exports a PDF itinerary with times, addresses and booking refs per day plus a bookings page, an .ics calendar (stays as all-day spans, reminders before flights and trains) and an Excel itinerary. No account or API keys; runs on your computer.

## Features

- **Time zones**: each row in its own zone (IANA, UTC+9 or a city name); arrival zone for flights and trains; home time shown.
- **Checks**: missing arrival zone, arrival before departure, overlaps, tight connections and airport time, nights without a stay or booked twice.
- **Bookings**: warns about flights, trains and stays without a booking ref; bookings page in the PDF.
- **Exports**: day-by-day PDF, .ics calendar with reminders, Excel itinerary with nights and bookings.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `travel-itinerary/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a printable itinerary from 东京大阪"
- "Check my trip plan for time zone and hotel gaps"
- "Export the itinerary and calendar file"

## Tools

| Tool | Purpose |
|---|---|
| `trip_open` | Read the trip plan and check times, time zones and stays. Opens the panel |
| `trip_edit` | Change settings, edit cells by row, add or remove rows |
| `trip_status` | Show the current rows, issues and summary |
| `trip_export` | Write itinerary.pdf, itinerary.ics and itinerary.xlsx |

Output goes to `travel-itinerary/<project>/` in the workspace.

## Scope (v0.1)

- Travel times are what you enter; no live flight status or maps.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `travel-itinerary/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/travel-itinerary/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-travel-itinerary test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
