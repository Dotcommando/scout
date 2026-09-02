# Known-affiliation catalog

`config/qualification/known-affiliations.yaml` is configuration-owned
evidence for the Qualification service. Catalog data is not a generic domain
constant and every enabled entry records its catalog revision and official
source URL.

## Deterministic matching

Names are normalized by Unicode NFKC normalization, `en-US` case folding, and
replacement of each non-letter/non-number code point with one separator. Runs
of separators collapse to one space and leading/trailing separators are
removed. The implementation evaluates one Unicode code point at a time; it
does not use unbounded regular expressions, similarity scoring, or fuzzy
matching.

`exact-normalized-full-name` compares the entire normalized name. `exact-token-
sequence-name` compares a configured normalized token sequence only against
contiguous whole-name tokens. `website-host-or-subdomain` matches the exact
configured host or a dot-delimited subdomain. A catalog alias can be marked
`ambiguous`; it becomes an indeterminate decision rather than a rejection.

The campaign profile explicitly selects the affiliation scopes it excludes.
The initial `europe-gb-ie` profile selects franchise, management, collection,
and soft-brand scopes. No catalog match is not evidence that a lead is
independent; ordinary profile rules continue to decide it.
