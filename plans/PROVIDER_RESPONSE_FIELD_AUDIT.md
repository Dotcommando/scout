# Provider response field audit

## Goal

Determine whether the configured Google Maps Actor returns structured hotel
star-rating or room-count data before changing Discovery persistence or
Qualification rules.

## Constraints

- Use one explicitly requested live provider run with no more than 10 items.
- Do not import the contract-capture results into Discovery, RabbitMQ, or
  Qualification.
- Do not infer a property's room count from booking-link query parameters.

# Plan steps

## Step 1 — Inspect a bounded Google Maps response

**Status:** Done

### Objective

Inspect the raw dataset fields returned by the configured Actor for ten hotel
search results.

### Observable result

The availability and reliability of structured star-rating and room-count
fields are recorded, together with the provider run reference.

### Implementation

1. Run the existing `contract-capture` command, which has a hard ten-item
   limit.
2. Read the completed dataset without importing it into the application.
3. Inspect top-level and nested field names and distinguish property facts from
   booking-search parameters.

### Verification

- The Actor run `CzcSOUnbHy15E0Oxo` completed successfully with ten items.
- The raw dataset was inspected read-only.

### DoD

- The presence or absence of each requested structured field is known.
- No contract-capture result was written to application persistence.

### Done

- A live contract-capture run was explicitly requested and started with a
  maximum of ten results for `GB` and `independent hotel`.
- The run completed with ten raw items. Every item included `hotelStars`, but
  only eight values matched a numeric hotel-star representation (`2-star hotel`
  through `4-star hotel`); two values were non-rating text (`Hotel` and
  `English restaurant`).
- No top-level or nested structured room-count field was returned. `floor` was
  null for all ten items. Room-related values in booking-link query strings
  describe the search request, not the property's capacity.
- The command did not import leads or publish messages.
