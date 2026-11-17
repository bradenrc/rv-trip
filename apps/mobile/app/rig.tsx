import { Redirect } from "expo-router";

/** #173 i2 (Q5 A): the rig moved to the You tab, `app/(tabs)/you.tsx`. The old
 * `/rig` path still resolves, straight there. */
export default function RigRedirect() {
  return <Redirect href="/you" />;
}
