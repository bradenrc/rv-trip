/**
 * Closes the Place view on any other soft navigation (#197 · #196). On a soft
 * navigation Next keeps a parallel slot's last page when the new URL does not
 * match it, so without this an open sheet would follow you from /map to
 * /places (Delete) or to /map?place= (On the map). Every non-root URL that is
 * not `/places/[id]` lands here and renders nothing.
 */
export default function ModalCatchAll() {
  return null;
}
