# Validation and hackathon demonstration

## Automated coverage

- Unit tests: 25/26-word boundary, coding/uncertain classification, context routing, malformed output, completed-turn replay, no-cloud local guards, native usage measurement, actual installed Firebase adapter behavior with a simulated native model, request filtering, retry grace, correlation identity, deduplication, TTL/restart, claims, storage errors and deletion.
- Playwright: unpacked extension loaded in a fresh Chromium profile; saved multi-turn chat and reopening; coding/long-query cloud routing and local-only blocking; controlled ChatGPT fetch → real webRequest metadata → 503 recovery; unverified adapter confirmation; hidden-content exclusion; success cleanup; production artifact checks.
- Demo inference is deterministic and clearly labeled. It does not validate a real device model or cloud service.

## Real Chrome/Firebase acceptance checklist (requires user configuration)

1. Load `dist-private` with your Firebase config and registered private App Check token. Open the side panel using its toolbar action.
2. Set up Gemini Nano from Settings with a user click. Verify download progress and readiness on supported Chrome hardware.
3. In Auto, ask a short non-coding question such as “Why is the sky blue?” Verify actual source says on-device.
4. Ask “Write a Python function to sort names.” Verify coding classification and Firebase cloud attribution. Ask a 26-word ordinary query and verify the length-based cloud route.
5. Switch to Local only; confirm coding and long queries are blocked. Disconnect from the network and verify a short eligible query still works after model setup. Inspect network activity to confirm no Firebase inference request.
6. Test cloud unavailability or an invalid App Check token. Confirm a retryable error, no substitution to local for cloud-required queries, and no loss of saved user messages.
7. Enable recovery and reload a user-controlled signed-in ChatGPT tab. Verify composer selectors, payload extraction and endpoint matching using DevTools; never record authorization headers or real private prompts in fixtures.
8. Until that verification succeeds, consider turning on Settings → *Confirm each captured ChatGPT prompt* so every recovery is reviewed first.
9. Use DevTools request blocking or a controlled test proxy to fail **only** the verified generation endpoint. A blocked transport may be reported by Chrome as cancellation and correctly excluded; use the controlled 503 fixture for deterministic failure testing.
10. Confirm query/context preview, three-second retry grace, correct tab matching, and that recovery answers on-device first (including coding and long prompts). Fail with HTTP 429 as well as 503. Confirm failures in other requests do not generate answers.
11. Close the side panel, fail a generation, verify the badge and the in-page **Answer with Gemini Nano** notice; click it and verify the panel opens and recovery starts. Try a second tab, permission revocation, and five-minute cache expiry.
12. Do not claim live ChatGPT support or actual Gemini execution based solely on the deterministic demo.

## Demo script

- Show a short prompt answered on-device with its source label.
- Show a coding query routed to Gemini through Firebase.
- Show a long query routed to cloud, then show Local only blocking it.
- Show a controlled ChatGPT 503 recovering the correct stored question and visible context.
- Show saved chat persistence, and that a recovered answer is saved as its own "Recovered · …" conversation.

## Known boundaries

Text only, English-first; incomplete visible ChatGPT history; no attachment extraction; no HTTP 200 in-stream error detection; no public production App Check attestation. A Firebase project, a compatible device and a live signed-in ChatGPT session are not supplied by this repository. Real integration validation remains pending until those external prerequisites are available.
