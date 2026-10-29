/**
 * dsh-session-focus — Host half.
 *
 * Deliberately thin. Every visible behaviour lives in the client half
 * (`lib/client.js`), which marks Sessions inside seats the shipped sidebar
 * already declares. The Host side exists only so the Loader has one row to
 * mount and so `dsh.client` gets scanned into the web boot graph; it
 * registers no route, no tool and no service.
 *
 * Marks are per-browser state and live in `localStorage`. That keeps this
 * plugin free of Host storage, authentication and migration concerns, and
 * makes a bad mark cost nothing to undo.
 */
export const name = "dsh-session-focus";

export const inject = [];

export function apply() {
  // Intentionally empty: see the module comment.
}
