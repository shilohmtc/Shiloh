# Public website presentation

The public website uses the existing service catalogue and published clinic address.

- If Google reviews fail, return no reviews or take longer than twelve seconds, show a clear unavailable message and the existing Google Maps link. Keep reviews that have already loaded successfully. Twelve seconds allows time for the existing two-step listing lookup.
- Use `https://shilohmtc.co.za/book` as the public booking page's canonical and sharing URL. Preserve the visitor's selected service in the booking links and page content.
- Offer directions using the existing published address in a plain Google Maps link. The visitor chooses their route in Maps.
- Show the known Young Guest and Youth Guests pedi names under Pedicures & Foot Care. Keep the catalogue's recorded names, categories, prices, durations and booking IDs intact.
- Keep the full street address in Contact and directions. Narrative Home/About text and the shared visit banner should avoid repeating it; retain Heidelberg naturally and keep map destinations and structured metadata unchanged.
- Selected-service anchors must leave the chosen card visible below the sticky header on phone and desktop, including after reload.

The public renderers and presentation mapper are the implementation authority. Storybook, phone/desktop browser checks and the public presentation tests verify these behaviours.
