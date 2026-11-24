import type { PanelRequest, PanelResponse } from "../shared/types";
export async function request(message: PanelRequest): Promise<PanelResponse> {
  const result: PanelResponse = await chrome.runtime.sendMessage(message);
  if (!result?.ok)
    throw new Error(
      result?.error || "Extension service worker did not respond.",
    );
  return result;
}
