/* The data categories the consent screen names (FR-09/10).
 *
 * Its own tiny module so a screen that only needs to *say* what would leave — the mobile setup
 * screen, before anything AI-related has been loaded — can import five strings without pulling
 * the payload builder and the exercise catalogue behind it. payload.js re-exports it, and
 * builds from it, so the screen cannot drift from the payload. */
export const DATA_CATEGORIES = Object.freeze([
  'plan',        // routines, exercises, sets/reps, schedule, progression settings
  'training',    // logged sets, targets, effort ratings, durations, PRs in the review window
  'bodyweight',  // weigh-ins in the window and your goal weight
  'profile',     // the intake answers you gave the Coach, including any limitations
  'prefs'        // unit, language, effort scale
]);

/* What the Coach may additionally be shown, each behind a switch of its own that is off until
 * the person turns it on (S.coach.consent.extra) — the Coach's consent does not cover them, so a
 * profile that agreed before they existed sends exactly what it sent then. extras.js builds them. */
export const OPTIONAL_CATEGORIES = Object.freeze([
  'bodyProfile', // sex, age, height, daily activity, body fat, and how the measurements moved
  'nutrition'    // the daily target and two-week averages actually eaten — never what was eaten
]);
