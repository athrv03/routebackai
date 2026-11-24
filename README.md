# RouteBackAI

**When cloud AI fails, keep going.** A Chrome MV3 extension with saved local-first chat and a separate recovery view for failed ChatGPT generations.

Both paths use the **Firebase AI Logic Hybrid Inference SDK**. Chrome manages the on-device Gemini Nano model; Firebase serves cloud Gemini when local inference is unsuitable. No alternate local model or direct Gemini API key is bundled.

## Run it

Use Node **24.12+** (see `.nvmrc`) and npm.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist`. Pin RouteBackAI and click its toolbar button to open the side panel.

Open Settings → **Set up** to initialize Chrome's model from a user interaction. Use Chrome desktop 139+ on supported hardware. Depending on Chrome's current rollout, the Firebase guide requires enabling `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restarting. A model download needs connectivity and can take several minutes. Chrome decides device/model eligibility; the extension does not download its own model.

The default build supports **Local only** without Firebase credentials. Auto mode requires the cloud setup below, since it may fall through to cloud. Unsupported devices receive a clear error rather than a replacement local model.

## Firebase cloud: private hackathon setup

1. Create or choose a Firebase project. Register a Web app and enable **AI Logic → Gemini Developer API** using the Firebase console workflow. Do not put a Gemini API secret in the extension.
2. Copy `.env.example` to `.env.local` and fill in the Firebase Web app configuration. Set `VITE_CLOUD_MODEL` to a model enabled in your project; the pinned default is `gemini-3.5-flash-lite`. Model access must be verified in your project.
3. Register a private App Check debug token in Firebase Console → App Check → your Web app → Manage debug tokens. Put that token in `VITE_APPCHECK_DEBUG_TOKEN`. The SDK exchanges the registered token with Firebase App Check.
4. Build using `npm run build:private` and load **`dist-private`**. Keep this build and token private. Never commit the token or distribute the private build publicly.
5. Verify a short ordinary query uses **Gemini Nano · on-device**, and a coding query uses **Gemini · Firebase cloud**. Attribution comes from the SDK response, not the planned route.

App Check debug tokens are deliberately compiled **only into private builds**. Public builds do not initialize the debug provider and reject cloud execution until production attestation has been implemented. Browser reCAPTCHA scripts are not an MV3-compatible drop-in solution. Public distribution needs a validated extension-compatible production App Check flow, such as a trusted custom attestation service; that is outside this private hackathon release.

Environment files and all build output are git-ignored. Firebase Web configuration is public application configuration; the App Check debug token is sensitive. Quotas, provider availability, billing, and provider retention are controlled by your Firebase project. No real Firebase project or token is included in this repository.

## Routing

| Condition                                                             | Auto                                   | Local only                 |
| --------------------------------------------------------------------- | -------------------------------------- | -------------------------- |
| Query is 26+ whitespace-separated words                               | Cloud                                  | Block; suggest Auto        |
| Gemini Nano classifies the query as coding                            | Cloud                                  | Block; suggest Auto        |
| Conversation does not fit the local input budget plus output headroom | Cloud                                  | Block; suggest Auto        |
| Classification is unavailable, malformed, or uncertain                | Cloud                                  | Block; suggest local setup |
| Short non-coding query with suitable context                          | Prefer on-device, cloud if unavailable | On-device only             |

Classification always uses `ONLY_ON_DEVICE`, preceded by explicit availability guards. The guards are necessary because the installed Firebase SDK can otherwise construct no native adapter and dispatch to cloud even when `ONLY_ON_DEVICE` was requested. Tests verify this boundary and the real installed SDK's local adapter with a simulated Chrome model.

The latest query determines the 25-word cutoff; visible/saved history also counts toward context capacity. Context is never silently truncated. History is serialized into one generation request because Firebase's documented native chat API is not supported on-device. Saved conversations remain multi-turn in the interface.

Local context usage is measured through Chrome where supported, reserving 2,048 tokens of headroom. Older implementations use a conservative 4,096-byte input ceiling. This is not a cloud token estimate. Native context-limit errors before output cause an explicit cloud retry in Auto; required-cloud failures never fall back locally. Token-limit failures advise shortening the conversation.

## ChatGPT recovery

Enable it in Settings and approve access to **chatgpt.com only**. Reload existing ChatGPT tabs. Chat does not need site access.

The adapter captures the submitted text and **currently rendered** conversation messages. It observes only allowlisted generation fetch calls, extracting a recognized plain-text submission payload. It preserves fetch dispatch, arguments, response bodies, promise identity, and errors. Chrome request metadata corroborates failures; telemetry/assets never trigger recovery. Hidden elements, buttons, form values, attachment elements, and unrelated page content are excluded from the visible snapshot.

Failures: HTTP 500/502/503/504 or transport errors, with a three-second retry grace period. Cancellation/navigation, 401/403/429, unrelated requests, and HTTP 200 streaming errors are excluded. Ambiguous correlation needs explicit prompt confirmation. Each query/context snapshot has a five-minute TTL. Oversized captures are refused, never silently truncated; the current capture limit is 180,000 characters across query and context and 500 visible messages.

**Live adapter validation is required:** the endpoint/payload fixtures are illustrative, not evidence of current live ChatGPT compatibility. Until someone verifies the selectors, `/backend-api/conversation` or `/backend-api/f/conversation`, plain-text `action: next` payload, and observed request outcomes in a user-controlled signed-in session, leave **Live adapter validated** unchecked. In that state, failed captured prompts require confirmation. If ChatGPT changes an endpoint or payload shape, update the adapter and redacted fixtures; do not widen the allowlist to all requests.

When the panel is closed, the badge signals a pending failure. Opening it performs local classification and, for verified failures, starts generation once inference is idle. Chrome's side panel cannot reliably be opened from a network failure without a user gesture. A successful ChatGPT response never starts cloud recovery generation. Coding/long/oversized recovery goes to **Firebase Gemini**, not back to ChatGPT.

## Tests and demo

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`test:e2e` builds both production and deterministic demo artifacts and launches Chromium with a fresh temporary profile. It grants ChatGPT access in a temporary test-only manifest, serves a controlled fixture at the ChatGPT origin, and exercises actual content scripts, webRequest events, service worker storage, claims, and the panel. It does not touch your real Chrome profile or account.

```sh
npm run build:demo
```

Load `dist-demo` for a **clearly labeled simulation**, including a Recovery → Simulate HTTP 503 button. No model or cloud credentials are needed. The demo provider and failure handler are absent from normal/private builds. The simulation is not evidence of real Gemini inference.

See [docs/VALIDATION.md](docs/VALIDATION.md) for the real-model acceptance checklist and [docs/PRIVACY.md](docs/PRIVACY.md) for storage and transmission details.

## References

- [Firebase hybrid Web setup](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started)
- [Firebase inference modes and source attribution](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options)
- [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- [Chrome side panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
