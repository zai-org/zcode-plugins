---
name: api-indonesia-data
description: Look up official Indonesian public data (regions, holidays, prayer times, schools, hospitals, earthquakes, exchange rates, wages) through the API Indonesia MCP server.
---

# API Indonesia data

Use this skill for questions about Indonesia that need official data instead of an estimate.

## Coverage

Administrative regions (province, regency/city, district, village, postal code), region boundaries as GeoJSON, public holidays and joint leave days, prayer times, Hijri dates, schools by NPSN, universities, hospitals, BMKG earthquakes, weather and warnings, air quality, Bank Indonesia exchange rates, provincial minimum wage, NIK and NPWP format checks, QRIS parsing, rupiah formatting and terbilang, halal (BPJPH), BPOM, DJKI trademarks, OJK lists, food prices, Transjakarta, KBBI, Al-Quran and Alkitab.

## Working rules

1. Pick the tool that matches the data type; 84 tools are exposed by the server, each with a title and hints.
2. Pass official region codes or names exactly as the tool schema asks; do not translate names.
3. Quote the source the tool returns and the date of the data when it is present.
4. If a lookup returns nothing, say the registry has no record for that value instead of filling the gap with a guess.
5. A successful request costs 2 credits; a failed one is not billed.
