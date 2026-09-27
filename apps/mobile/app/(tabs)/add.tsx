/**
 * The center + tab's route. Never shown: `app/(tabs)/_layout.tsx` intercepts
 * its `tabPress` and opens the capture sheet (`app/capture.tsx`) instead. A tab
 * needs a route to exist, and it cannot be named `capture` — that path is the
 * sheet's.
 */
export default function AddTab() {
  return null;
}
