#!/usr/bin/env node
/* The fake provider: a CLI that speaks the Coach contract without an AI account.
 *
 * Two jobs. In CI it is the whole test surface — every job outcome (a valid plan, a valid
 * change-set, "nothing to change", a malformed answer that the repair round rescues, one that
 * it can't, a timeout, a crash) is one FIXTURE_MODE away, deterministically. On a real
 * instance it is a provider an owner can select to walk the entire loop before connecting a
 * paid account to it.
 *
 * Deliberately dependency-free and deliberately dumb: it reads the payload the server built,
 * echoes real ids back out of it, and never tries to be a coach. Tests assert on structure.
 */

const MODE = process.env.FIXTURE_MODE || '';

const read = () => new Promise(resolve => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', () => resolve(buf));
});

const prompt = await read();

if (MODE === 'timeout') { await new Promise(() => {}); }          // never resolves — the runner kills us
if (MODE === 'crash') { process.stderr.write('fixture: simulated crash\n'); process.exit(3); }
if (MODE === 'invalid') { process.stdout.write('I am afraid I cannot do that.\n'); process.exit(0); }

// The repair round: the first call is garbage, the second (which carries the repair marker)
// is fine. Two invocations of one process can't share memory, so the marker in the prompt is
// what tells them apart — exactly how the real repair round works.
const isRepair = /REPAIR REQUEST/i.test(prompt);
if (MODE === 'invalid-then-valid' && !isRepair) { process.stdout.write('{"changes": "not an array"}\n'); process.exit(0); }

// The admin card's "Test the Coach": a prompt with no payload attached, asking for one small
// object back. A real provider answers that from the prompt alone, so the fixture does too —
// otherwise the single button that proves the runtime works is the one thing the shipped
// provider cannot do. Every genuine job embeds its payload in a fence (see buildPrompt), so
// the absence of one is what distinguishes the two.
if (!/```json/.test(prompt)) out({ coach_contract: 1, ok: true });

// The payload the server built is embedded in the prompt between fences; pull it back out so
// the answer references ids that actually exist.
function payload() {
  const m = prompt.match(/```json\s*([\s\S]*?)```/);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}
const P = payload();
const kind = P.task || (/change-set/i.test(prompt) ? 'review' : 'create');

// Well-formed JSON naming an exercise nobody has. This is the failure validate.js exists for,
// and it is not the same as garbage: every check upstream of the validator is happy with it.
// The fixture keeps saying it on the repair round too, because the interesting assertion is
// that a model which cannot be told produces a failed job rather than a retry loop.
if (MODE === 'unknown-exercise') {
  out({
    coach_contract: 1,
    summary: 'One change.',
    changes: [{
      id: 'c1', type: 'add-exercise', target: { routineId: (P.plan?.routines || [])[0]?.id },
      after: { id: 'not-a-real-exercise', sets: 3, reps: 10 },
      why: 'An id that resolves to nothing must never reach a plan.'
    }]
  });
}

// An exercise lookup: split the text the way a person lists things and hand each piece back as
// its own English name. No interpretation — a test that types a catalogue name gets that row.
if (kind === 'match') {
  const parts = String(P.text || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
  const own = (P.custom || []);
  out({
    coach_contract: 1,
    items: parts.map(said => {
      const mine = own.find(c => c.n.toLowerCase() === said.toLowerCase());
      return {
        said,
        names: [said.toLowerCase()],
        bp: 'chest',
        ...(MODE === 'foreign-custom' ? { customId: 'not-yours' } : mine ? { customId: mine.id } : {}),
        create: { name: said, desc: 'Fixture description.', primary: ['chest', 'not-a-muscle'], secondary: ['triceps'] }
      };
    })
  });
}

// The food diary's three questions. Canned, and shaped to exercise the validators: one item
// with energy that contradicts its macros, one weight a model would give as text.
if (kind === 'meal') {
  if (MODE === 'meal-empty') out({ coach_contract: 1, items: [], note: 'No food in the picture.' });
  if (MODE === 'meal-broken') out({ coach_contract: 1, items: [{ name: 'Rice' }] });
  out({
    coach_contract: 1,
    items: [
      { name: P.caption || 'Chicken breast, grilled', en: 'chicken breast, grilled', grams: 150, kcal100: 151, p100: 30.5, f100: 3.2, c100: 0, conf: 'medium' },
      { name: 'Buckwheat, cooked', en: 'buckwheat, cooked', grams: '200', kcal100: 900, p100: 3.4, f100: 0.6, c100: 19.9, conf: 'certain' }
    ],
    note: P.photo ? 'Estimated from the photo.' : 'Estimated from the description.'
  });
}
if (kind === 'label') {
  if (MODE === 'label-none') out({ coach_contract: 1, found: false, note: 'No nutrition panel in the picture.' });
  out({ coach_contract: 1, found: true, name: 'Fixture curd 5%', brand: 'Fixture', per: 'serving', kj: 911, protein: 31, fat: 9, carbs: 3.2, servingGrams: 180, note: '' });
}
if (kind === 'suggest') {
  const mine = (P.foods || [])[0];
  out({
    coach_contract: 1,
    ideas: [{
      title: 'Fixture meal',
      items: [
        ...(mine ? [{ id: mine.id, name: mine.name, grams: 150 }] : []),
        { id: 'not-yours', name: 'Tomato', grams: 120, kcal100: 18, p100: 0.9, f100: 0.2, c100: 3.9 }
      ],
      why: 'Fits what is left.'
    }]
  });
}

if (MODE === 'nochange' || (kind === 'review' && !(P.window?.workouts || []).length)) {
  out({ coach_contract: 1, nochange: true, reading: 'Not enough new training to read anything into yet — keep logging and ask again in a week.' });
}

if (kind === 'create') {
  const lib = (P.library || []).slice(0, 6);
  const ex = (i) => lib[i % Math.max(1, lib.length)] || { id: 'unknown' };
  out({
    coach_contract: 1,
    opengym_plan: 1,
    name: 'Coach plan',
    summary: 'A three-day full-body plan built around the equipment you listed.',
    // Echoes whether the previous bundle actually arrived, so a test can tell a refine that
    // carried its predecessor from one that silently sent `previous: null`.
    basedOn: P.refine?.previous
      ? 'Refined from the plan you were shown.'
      : 'No training history yet — starting conservatively.',
    week: { 1: 'r1', 3: 'r2', 5: 'r1' },
    routines: [
      {
        id: 'r1', name: 'Full body A', emoji: '💪', prog: 'linear', why: 'Compound-first, three sessions a week.',
        ex: [
          { id: ex(0).id, sets: 3, reps: 8, mode: 'reps', prog: 'linear', why: 'Main lower-body driver.' },
          { id: ex(1).id, sets: 3, reps: 10, mode: 'reps', why: 'Upper-body push volume.' },
          { id: ex(2).id, sets: 3, reps: 12, mode: 'reps', why: 'Pull, to balance the pressing.' }
        ]
      },
      {
        id: 'r2', name: 'Full body B', emoji: '🏋️', prog: 'linear', why: 'The same pattern, different variations.',
        ex: [
          { id: ex(3).id, sets: 3, reps: 8, mode: 'reps', why: 'Hinge pattern.' },
          { id: ex(4).id, sets: 3, reps: 10, mode: 'reps', why: 'Vertical press.' },
          { id: ex(5).id, sets: 3, reps: 12, mode: 'reps', why: 'Accessory work.' }
        ]
      }
    ],
    customEx: []
  });
}

// debrief: one session read back, with its own numbers echoed so a test can check they arrived
if (kind === 'debrief') {
  const s = P.session || {};
  const done = (s.entries || []).reduce((n, en) => n + (en.sets || []).filter(x => x.done).length, 0);
  out({
    coach_contract: 1,
    summary: `${s.name || 'The session'} on ${s.d || '?'}: ${done} sets done in ${s.minutes ?? '?'} minutes.`,
    score: done ? 8 : 3,
    highlights: done ? [`${done} working sets completed.`] : [],
    watch: (P.previous || []).length ? [] : ['First time this routine was logged — nothing to compare against yet.'],
    nextTime: ['Keep the same loads and add one rep where the last set had reps in reserve.']
  });
}

// review
const routine = (P.plan?.routines || [])[0];
const first = routine?.ex?.[0];
const changes = [];
if (routine && first) {
  changes.push({
    id: 'c1', type: 'sets', target: { routineId: routine.id, exId: first.id },
    before: first.sets, after: (first.sets || 3) + 1,
    why: 'Every set hit its target for three sessions running — one more set is the smallest useful step up.'
  });
  changes.push({
    id: 'c2', type: 'reps', target: { routineId: routine.id, exId: first.id },
    before: first.reps ?? 10, after: (first.reps ?? 10),
    why: 'Rep target stays where it is while the extra set beds in.'
  });
}
out({
  coach_contract: 1,
  summary: changes.length ? 'One change: a little more volume where you are clearly ready for it.' : 'Plan looks right for now.',
  evidence: { from: P.window?.from || null, to: P.window?.to || null, sessions: (P.window?.workouts || []).length },
  changes,
  notes: ['Body weight has been flat for four weeks — if the goal is to gain, that is the lever, not the plan.']
});

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); process.exit(0); }
