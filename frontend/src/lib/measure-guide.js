/* How to take each measurement so that two readings a month apart can be compared.
 *
 * A tape is only as good as the habit behind it: the same spot, the same posture, the same time
 * of day. The sites and postures follow the anthropometry manuals — NHANES (CDC, 2021) for the
 * arm, waist and hip, WHO for the waist, and ISAK's definitions for the flexed arm, forearm,
 * chest, neck, thigh and calf — put into words someone can follow alone with a tape. Shoulders
 * is in no manual, and says so.
 *
 * The texts are ordinary locale keys, in t() calls, so the string check finds them and every
 * language pack carries them; a function per site because t() has to run at render time.
 */
import { t } from './i18n.js'

/** Rules that hold for every site. */
export const GENERAL = () => [
  t('Measure in the morning, before training: a muscle is temporarily bigger right after a workout.'),
  t('Stand relaxed, with the tape on bare skin, flat and not twisted.'),
  t('Keep the tape at right angles to the limb, and level with the floor on the torso.'),
  t('Pull it snug, but not so tight that it dents the skin.'),
  t('Measure twice and enter the average.'),
  t('Use the same spot and the same side every time. Every two weeks is often enough.')
]

const RELAXED_BELLY = () => t('Relax the abdomen — do not pull it in — and read the tape at the end of a normal breath out.')
const FRAME = () => t('It barely changes with training: a reference for frame size, not a progress marker.')

export const GUIDE = {
  upperArm: () => [
    t('Bend the elbow to 90° and find the point halfway between the bony tip of the shoulder and the tip of the elbow.'),
    t('Let the arm hang loose at your side and wrap the tape at that point.'),
    t('Do not tense: a flexed arm is a different measurement.')
  ],
  upperArmFlexed: () => [
    t('Raise the arm forward to shoulder height and bend the elbow to 90°, palm towards you.'),
    t('Tense the biceps as hard as you can.'),
    t('Measure around the highest point of the biceps.')
  ],
  forearm: () => [
    t('Hold the arm straight and relaxed, palm facing forward.'),
    t('Slide the tape just below the elbow until you find the widest part, and measure there.')
  ],
  chest: () => [
    t('Stand with your arms at your sides, the tape level around the chest at the middle of the breastbone (nipple level for men).'),
    t('Breathe normally and read the tape at the end of a normal breath out.')
  ],
  shoulders: () => [
    t('Stand with your arms at your sides, the tape level around the widest part of the shoulders.'),
    t('There is no agreed standard for this one: what matters is doing it the same way every time.')
  ],
  neck: () => [
    t('Look straight ahead and place the tape just above the Adam’s apple, at right angles to the neck.'),
    t('Do not tilt the head or tense the neck.')
  ],
  waist: () => [
    t('Find the lowest rib and the top of the hip bone at your side: the tape goes halfway between them, level all the way round.'),
    RELAXED_BELLY()
  ],
  abdomen: () => [
    t('Put the tape level around the abdomen at the navel.'),
    RELAXED_BELLY()
  ],
  hips: () => [
    t('Stand with your feet together and the glutes relaxed.'),
    t('Put the tape level around the widest part of the buttocks.')
  ],
  thigh: () => [
    t('Stand with your weight on both legs.'),
    t('Measure halfway between the hip crease and the top of the kneecap, the tape at right angles to the leg.')
  ],
  calf: () => [
    t('Stand with your weight on both legs.'),
    t('Measure around the widest part of the calf.')
  ],
  wrist: () => [
    t('Measure around the narrowest part of the wrist, just above the wrist bones.'),
    FRAME()
  ],
  ankle: () => [
    t('Measure around the narrowest part of the ankle, just above the ankle bones.'),
    FRAME()
  ]
}

/** The steps for one site; an empty list for a measurement no tape takes (body fat, lean mass). */
export const guideFor = site => (GUIDE[site] ? GUIDE[site]() : [])
