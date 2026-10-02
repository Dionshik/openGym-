/* The pure half of the custom reminders (reminders.js): reading a list out of a state that may
   hold anything, deciding what is due, deciding what is already done, and the sent-marker file.
   The tick that drives them against a real clock is in server-custom-reminder.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanReminders, dueReminders, loggedOn, createReminderLog, LINKS, LINK_URL, MAX_REMINDERS, MAX_TEXT } from '../reminders.js';
import { customReminderPush } from '../push-messages.js';

const row = (over = {}) => ({ id: 'r1', text: 'Log food', time: '13:00', days: [], on: true, link: null, skipIfLogged: false, t: 1, ...over });

test('a well-formed reminder comes through as written', () => {
  assert.deepEqual(cleanReminders({ reminders: [row({ days: [1, 3, 5], link: 'nutrition', skipIfLogged: true })] }),
    [{ id: 'r1', time: '13:00', days: [1, 3, 5], link: 'nutrition', text: 'Log food', skipIfLogged: true, t: 1 }]);
  // a row with no usable stamp counts as written long ago
  assert.equal(cleanReminders({ reminders: [row({ t: 'yesterday' })] })[0].t, 0);
});

test('anything that is not a list of reminders yields none, and nothing throws', () => {
  for (const S of [null, undefined, 7, 'abc', [], {}, { reminders: null }, { reminders: {} }, { reminders: 'r1' }, { reminders: 3 }]) {
    assert.deepEqual(cleanReminders(S), [], JSON.stringify(S));
  }
});

test('rows it cannot fully read are dropped one by one; the rest still count', () => {
  const S = { reminders: [
    null, 7, 'x', [], {},
    row({ id: '' }), row({ id: 'has space' }), row({ id: 42 }), row({ id: 'a'.repeat(41) }),
    row({ id: 'badtime', time: '25:00' }), row({ id: 'badtime2', time: '9:00' }), row({ id: 'badtime3', time: null }),
    row({ id: 'off', on: false }), row({ id: 'truthy', on: 'yes' }), row({ id: 'gone', x: true }),
    row({ id: 'ok' }), row({ id: 'ok', text: 'a second row with the same id' })
  ] };
  assert.deepEqual(cleanReminders(S).map(r => r.id), ['ok']);
});

test('fields are normalised rather than trusted', () => {
  const [r] = cleanReminders({ reminders: [row({ text: '  a\n\tb   ' + 'x'.repeat(300), days: [1, 1, 7, -1, '2', 2.5, 6, null], link: 'javascript:alert(1)', skipIfLogged: true })] });
  assert.equal(r.text.length, MAX_TEXT);
  assert.ok(r.text.startsWith('a b x'));
  assert.deepEqual(r.days, [1, 6]);
  assert.equal(r.link, null);
  assert.equal(r.skipIfLogged, false, 'no section to check without a link');
  assert.equal(cleanReminders({ reminders: [row({ text: 99 })] })[0].text, '');
  assert.deepEqual(cleanReminders({ reminders: [row({ days: 'mon' })] })[0].days, []);
});

test('no more than the cap is read', () => {
  const many = Array.from({ length: MAX_REMINDERS + 15 }, (_, i) => row({ id: 'r' + i }));
  assert.equal(cleanReminders({ reminders: many }).length, MAX_REMINDERS);
});

test('every link has an address, and the address is ours', () => {
  for (const l of LINKS) assert.match(LINK_URL[l], /^#\/[a-z]+(\?do=[a-z]+)?$/, l);
  assert.deepEqual(Object.keys(LINK_URL).sort(), [...LINKS].sort());
});

const now = (hhmm, weekday = 3, date = '2026-10-07') => ({ date, hhmm, weekday });
const due = (list, n, sent) => dueReminders(list, n, sent).map(x => x.key);

test('due from its minute to fifteen minutes after, on the same day only', () => {
  const list = cleanReminders({ reminders: [row()] });
  assert.deepEqual(due(list, now('12:59')), []);
  assert.deepEqual(due(list, now('13:00')), ['r1@13:00']);
  assert.deepEqual(due(list, now('13:15')), ['r1@13:00']);
  assert.deepEqual(due(list, now('13:16')), []);
  const late = cleanReminders({ reminders: [row({ time: '23:55' })] });
  assert.deepEqual(due(late, now('23:59')), ['r1@23:55']);
  assert.deepEqual(due(late, now('00:05')), [], 'not owed after midnight');
});

test('only on its weekdays; no weekdays means every day', () => {
  const list = cleanReminders({ reminders: [row({ days: [1, 3] })] });
  assert.deepEqual(due(list, now('13:00', 3)), ['r1@13:00']);
  assert.deepEqual(due(list, now('13:00', 4)), []);
  const daily = cleanReminders({ reminders: [row()] });
  for (let wd = 0; wd < 7; wd++) assert.equal(due(daily, now('13:00', wd)).length, 1, 'weekday ' + wd);
});

test('sent once: the key holds for the window; a changed time is a new appointment', () => {
  const list = cleanReminders({ reminders: [row(), row({ id: 'r2', time: '13:05' })] });
  assert.deepEqual(due(list, now('13:06'), []), ['r1@13:00', 'r2@13:05']);
  assert.deepEqual(due(list, now('13:06'), ['r1@13:00']), ['r2@13:05']);
  assert.deepEqual(due(list, now('13:06'), ['r1@13:00', 'r2@13:05']), []);
  const moved = cleanReminders({ reminders: [row({ time: '14:00' })] });
  assert.deepEqual(due(moved, now('14:01'), ['r1@13:00']), ['r1@14:00']);
});

/* The catch-up window is for a server that was down at 13:00 — not for a reminder that did not
   exist at 13:00. Written, switched on or moved after its time, it is for tomorrow. */
test('a reminder written after its time is not owed today', () => {
  const at = (h, m, s = 0) => Date.UTC(2026, 9, 7, h, m, s);        // the member's clock is UTC here
  const made = t => cleanReminders({ reminders: [row({ t })] });      // a 13:00 reminder, last changed at t
  const dueAt = (list, hhmm, ms) => dueReminders(list, now(hhmm), [], 15, ms).length;
  assert.equal(dueAt(made(at(12, 59, 59)), '13:00', at(13, 0, 5)), 1, 'written a second before');
  assert.equal(dueAt(made(at(9, 0)), '13:10', at(13, 10, 30)), 1, 'the server was down until 13:10: still owed');
  assert.equal(dueAt(made(at(13, 4)), '13:10', at(13, 10, 30)), 0, 'created at 13:04 for 13:00');
  assert.equal(dueAt(made(at(13, 0, 20)), '13:00', at(13, 0, 40)), 0, 'even seconds after the minute');
  // moved from 13:00 to 13:05 at 13:10, after it had fired: a new key, but not a new appointment today
  const moved = cleanReminders({ reminders: [row({ time: '13:05', t: at(13, 10) })] });
  assert.equal(dueReminders(moved, now('13:10'), ['r1@13:00'], 15, at(13, 10, 20)).length, 0);
  // moved to a time still ahead: fires when that time comes
  const ahead = cleanReminders({ reminders: [row({ time: '13:30', t: at(13, 10) })] });
  assert.equal(dueReminders(ahead, now('13:30'), ['r1@13:00'], 15, at(13, 30, 5)).length, 1);
  // without the instant (an older caller), behaviour is what it was
  assert.equal(dueReminders(made(at(13, 4)), now('13:10')).length, 1);
});

test('a clock that cannot be read sends nothing', () => {
  const list = cleanReminders({ reminders: [row()] });
  for (const n of [null, {}, { hhmm: '1300' }, { hhmm: 13 }]) assert.deepEqual(dueReminders(list, n), []);
});

test('"already done today" is read from the section the reminder points at', () => {
  const D = '2026-10-07';
  assert.equal(loggedOn({ nutrition: { log: [{ id: 'a', d: D }] } }, 'nutrition', D), true);
  assert.equal(loggedOn({ nutrition: { log: [], days: { [D]: { k: 2000 } } } }, 'nutrition', D), true);
  assert.equal(loggedOn({ nutrition: { log: [{ id: 'a', d: '2026-10-06' }] } }, 'nutrition', D), false);
  assert.equal(loggedOn({ bodyweight: [{ d: D, w: 80 }] }, 'weight', D), true);
  assert.equal(loggedOn({ bodyweight: [{ d: D, w: 80 }] }, 'body', D), false);
  assert.equal(loggedOn({ measurements: [{ d: D, waist: 90 }] }, 'body', D), true);
  assert.equal(loggedOn({}, 'photos', D, d => d === D), true);
  assert.equal(loggedOn({}, 'photos', D, () => false), false);
  assert.equal(loggedOn({}, 'photos', D), false);
  assert.equal(loggedOn({ nutrition: { log: [{ d: D }] } }, null, D), false);
  // whatever is on disk
  for (const S of [null, 5, { nutrition: 'x' }, { nutrition: { log: {}, days: [] } }, { bodyweight: {} }, { measurements: [null, 3] }]) {
    for (const l of LINKS) assert.equal(loggedOn(S, l, D), false);
  }
});

test('the sent-marker survives a restart, resets with the date and forgets a deleted account', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-remlog-'));
  const atomicWrite = (file, content) => fs.writeFileSync(file, content);
  try {
    const a = createReminderLog({ dataDir, atomicWrite });
    assert.deepEqual(a.sent('u1', '2026-10-07'), []);
    a.mark('u1', '2026-10-07', 'r1@13:00');
    a.mark('u1', '2026-10-07', 'r1@13:00');
    a.mark('u1', '2026-10-07', 'r2@20:00');
    a.mark('u2', '2026-10-07', 'x@08:00');
    const b = createReminderLog({ dataDir, atomicWrite });          // a restart
    assert.deepEqual(b.sent('u1', '2026-10-07'), ['r1@13:00', 'r2@20:00']);
    assert.deepEqual(b.sent('u1', '2026-10-08'), [], 'yesterday is not today');
    b.mark('u1', '2026-10-08', 'r1@13:00');
    assert.deepEqual(b.sent('u1', '2026-10-07'), [], 'one day per profile is kept');
    b.dropUser('u2');
    assert.deepEqual(createReminderLog({ dataDir, atomicWrite }).sent('u2', '2026-10-07'), []);
    // a file someone mangled is the same as no file
    fs.writeFileSync(path.join(dataDir, 'reminder-log.json'), '[1,2');
    const c = createReminderLog({ dataDir, atomicWrite });
    assert.deepEqual(c.sent('u1', '2026-10-08'), []);
    fs.writeFileSync(path.join(dataDir, 'reminder-log.json'), JSON.stringify({ u1: 'x', u3: { d: '2026-10-08', keys: 'no' } }));
    const d = createReminderLog({ dataDir, atomicWrite });
    assert.deepEqual(d.sent('u1', '2026-10-08'), []);
    assert.deepEqual(d.sent('u3', '2026-10-08'), []);
    d.mark('u3', '2026-10-08', 'k@01:00');
    assert.deepEqual(d.sent('u3', '2026-10-08'), ['k@01:00']);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('the push: the member\'s words as the title, our address as the link', () => {
  const [r] = cleanReminders({ reminders: [row({ link: 'nutrition' })] });
  assert.deepEqual(customReminderPush('en', r, LINK_URL[r.link]), { title: 'Log food', body: 'Log what you ate.', tag: 'reminder-r1', url: '#/nutrition' });
  assert.deepEqual(customReminderPush('ru', r, LINK_URL[r.link]), { title: 'Log food', body: 'Запишите, что вы ели.', tag: 'reminder-r1', url: '#/nutrition' });
  // a language with no copy of its own falls back to English, as the other pushes do
  assert.equal(customReminderPush('pt-BR', r, LINK_URL[r.link]).body, 'Log what you ate.');
  assert.equal(customReminderPush('zz', r).body, 'Log what you ate.');
  const [bare] = cleanReminders({ reminders: [row({ text: '' })] });
  assert.deepEqual(customReminderPush('en', bare, undefined), { title: 'Reminder', body: '', tag: 'reminder-r1' });
  assert.equal(customReminderPush('ru', bare).title, 'Напоминание');
});
