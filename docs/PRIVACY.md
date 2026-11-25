# Privacy and data handling

## Saved chats

Standalone conversations are stored in `chrome.storage.local` in the browser profile, retained until deleted. Messages, timestamps, titles, completion states, inference sources and routing reasons are saved. Interrupted answers are marked and excluded from subsequent context. Storage is not synced or encrypted by RouteBackAI. Do not treat the browser profile as a secure vault. Storage errors are shown; the extension does not silently overwrite unreadable history.

## Recovery cache

Only optional access to chatgpt.com enables capture. Each cache entry contains the submitted text, visible conversation snapshot, attempt/tab/document identities, timestamps and request outcome metadata. Entries expire five minutes after capture. Reads reject expired entries immediately; alarms remove retained data periodically, subject to Chrome scheduling. Entries are also cleared on successful cloud completion, completed recovery, dismissal, tab closure/navigation, permission revocation or disabling recovery. Cache data is held in `chrome.storage.session` and is not exposed directly to content scripts. Browser shutdown clears it.

The snapshot contains only rendered message text; unloaded history and attachments are not captured. DOM selectors may change. Prompts/context over capture limits are not truncated. In-page submission snapshots are discarded after 15 seconds. The extension does not read cookies, authorization headers, all network bodies or unrelated pages. It never logs prompts.

A completed recovery is saved to chat history as its own conversation ("Recovered · …") containing the recovered prompt and answer, stored like any other saved chat until deleted. The captured ChatGPT context is not saved. Unfinished or failed recoveries are shown only in panel memory; dismissal, source-tab closure or panel closure removes them. Closing the panel cancels consumption and aborts requests where supported; a cloud request already dispatched can still complete and consume provider quota. Chromium/Firebase control native model session cleanup when the panel is unloaded. The Firebase SDK does not expose a public model-session destroy method; measurement sessions created directly through Chrome are explicitly destroyed.

## Inference

Local classification uses Chrome-managed Gemini Nano through Firebase AI Logic. It is guarded against missing or unavailable native APIs and never deliberately falls back to cloud. In Local only mode, inference remains on the device; the browser model may still require an initial download.

In Auto mode, the latest query and full assembled text context may be transmitted to Firebase/Gemini when the query exceeds 25 words, is coding-related, exceeds local capacity, cannot be classified locally, or the local-first SDK falls back. The UI explains the route and labels the actual provider source. Firebase/Gemini have their own processing, retention and billing policies; clearing this extension's cache does not delete provider-side records.

No application analytics, cross-device synchronization, remote images in generated Markdown, or alternate local models are included. All executable app code is bundled. Cloud requests are restricted by extension CSP to the Firebase AI Logic, App Check and Installations hosts.

## Release status

This implementation is intended for private hackathon evaluation. Cloud use needs your own Firebase project and registered App Check debug token in a private build. Public distribution requires production attestation, live-site compatibility validation and a Chrome Web Store privacy review.
