import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * #200 · the Google Maps SDK key slots for iOS and Android.
 *
 * `app.json` stays the static config. This file layers the keys over it at
 * prebuild time, from the environment (EAS environment variables, or
 * `apps/mobile/.env.local` for a local dev-client build), because the repo is
 * public and the keys must never be in the tree.
 *
 * react-native-maps' config plugin writes the iOS key into Info.plist and
 * AppDelegate and links the `react-native-maps/Google` pod only when the iOS
 * key is set. It writes the Android key into the manifest. With no key the
 * plugin links Apple/Android maps only, and the app reads that build as having
 * no Google map ("no-module").
 *
 * The runtime learns WHETHER each key was set (`extra.googleMaps`), never the
 * key itself. `loadGoogle()` in `src/map.tsx` reads that flag.
 */
const iosKey = process.env.GOOGLE_MAPS_IOS_KEY?.trim() || undefined;
const androidKey = process.env.GOOGLE_MAPS_ANDROID_KEY?.trim() || undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "TripCaddie",
  slug: config.slug ?? "tripcaddie",
  plugins: [
    ...(config.plugins ?? []),
    ["react-native-maps", { iosGoogleMapsApiKey: iosKey, androidGoogleMapsApiKey: androidKey }],
  ],
  extra: {
    ...config.extra,
    googleMaps: { ios: iosKey !== undefined, android: androidKey !== undefined },
  },
});
