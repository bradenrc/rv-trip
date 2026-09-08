import Constants from "expo-constants";
import { createApiClient } from "@rv-trip/core/api-client";

/**
 * The one API client.
 *
 * Base URL, in order: `EXPO_PUBLIC_API_URL` (apps/mobile/.env.local, for a
 * physical phone or a deployed API) → the machine Metro is serving from, on
 * the web app's port (the dev default: the simulator and a phone on the same
 * Wi-Fi both reach the Mac this way) → localhost.
 *
 * Auth is the dev-user stub until #33 (`getAuthHeader` seam on the client).
 */
function devHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri; // "10.0.0.223:8081" under `expo start`
  const host = hostUri?.split(":")[0];
  return host ? `http://${host}:3000` : null;
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? devHost() ?? "http://localhost:3000";

export const api = createApiClient({ baseUrl: API_URL });
