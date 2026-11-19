/**
 * The `@modal` slot's resting state (#197 · #196): nothing. A hard load of any
 * URL renders this, so the Place view only ever opens as a modal through the
 * intercepting `(.)places/[id]` route on a soft navigation.
 */
export default function ModalDefault() {
  return null;
}
