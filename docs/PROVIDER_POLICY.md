# Provider policy

The registry lives in `packages/core/src/providers.ts` and is enforced on the server (web BFF and
worker). The browser sends only a URL; it can't send or override a capability, and request schemas
are strict (unknown keys are rejected; tested).

## Capability states

| State | Meaning |
|---|---|
| `disabled` | Not processed at all. |
| `metadata_only` | Metadata may be shown through an approved method; no files. |
| `official_export_only` | No extraction; the UI links to the platform's own download/export feature. |
| `authorized_download` | Downloads allowed for a confirmed, authorised scope. |
| `enabled` | Inspection, download and conversion allowed. |

## Default registry (reviewed 2026-10-24)

| Provider | Hosts | Capability | Notes |
|---|---|---|---|
| Direct media file link | any other host | enabled | Must be an actual audio/video file; web pages and HLS/DASH playlists are rejected. |
| Your own file (upload) | — | enabled | Browser → worker signed, single-use upload. |
| YouTube | youtube.com, youtu.be, … | official_export_only | Links to "Download YouTube videos that you've uploaded" (YouTube Studio). |
| Facebook | facebook.com, fb.watch | official_export_only | Links to "Export a copy of your Facebook information". |
| Instagram | instagram.com | official_export_only | Links to "Review and export a copy of your Instagram information". |
| TikTok | tiktok.com | official_export_only | Links to TikTok's post download settings help. |
| X (Twitter) | x.com, twitter.com, t.co | disabled | Links to "How to download your X archive". |
| Vimeo | vimeo.com | official_export_only | Owners decide whether a Download button exists. |
| SoundCloud | soundcloud.com | official_export_only | Creators enable downloads per track. |
| Internet Archive item page | archive.org `/details/`, `/embed/` | official_export_only | `archive.org/download/<id>/<file>` links are direct files and use the direct-media provider. |

"Reviewed" means the maintainers checked the linked terms/help pages on that date. **It is not legal
advice. TODO: qualified legal review before public commercial launch.**

## Changing policy (operators)

Set `JD_PROVIDER_POLICY_OVERRIDES` (JSON) on **both** the worker and the web app, e.g.
`{"direct_media":{"status":"outage"}}`. Rules enforced at startup:

- Overrides can't add new providers.
- Switching a platform to `enabled`/`authorized_download` requires `"metadataMethod": "approved_extractor"`
  so the decision is explicit in config review.
- This build ships **no extractor adapter**. A platform enabled with `approved_extractor` is refused
  at inspection with `PROVIDER_UNAVAILABLE` rather than being scraped as "direct media". Adding an
  adapter means implementing it behind the same interface, revalidating every extracted stream URL
  through `safeFetch`, and adding regression tests against media you are authorised to use.

Never add cookie import, login automation, DRM or signature workarounds.
