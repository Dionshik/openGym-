import { NUDGE_COPY } from './nudge-copy.js';
import { lineIndex } from './nudge.js';

const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ This is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan. Let's go 💪",
    // A member's own reminder (customReminderPush): the fallback title, and one line per section
    // it can point at. A language without these two keys gets the English ones.
    reminderTitle: 'Reminder',
    hint: {
      nutrition: 'Log what you ate.',
      weight: 'Step on the scale and log it.',
      body: 'Time to take your measurements.',
      photos: 'Time for a progress photo.',
    },
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ É assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano. Bora treinar 💪',
  },
  ru: {
    restTitle: 'Отдых окончен 💪',
    restBody: 'Пора делать следующий подход.',
    testBody: 'Тестовое уведомление ✅ — так выглядят оповещения.',
    dayFallbackTitle: 'Сегодня тренировка по плану',
    dayRoutineSuffix: 'сегодня',
    dayBody: 'Она в вашем плане — вперёд 💪',
    reminderTitle: 'Напоминание',
    hint: {
      nutrition: 'Запишите, что вы ели.',
      weight: 'Встаньте на весы и запишите вес.',
      body: 'Пора сделать замеры.',
      photos: 'Пора сделать фото прогресса.',
    },
  },
};

const copyFor = lang => COPY[lang] || COPY.en;

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

export function testPush(lang) {
  return { title: 'openGym', body: copyFor(lang).testBody, tag: 'test' };
}

export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine
      ? `${routine.emoji || '🏋️'} ${routine.name} ${copy.dayRoutineSuffix}`
      : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
  };
}

/**
 * A reminder the member wrote (reminders.js): their own words as the title, a short line about
 * the section it points at, and that section's address for the tap. One tag per reminder, so two
 * different reminders both stay in the tray while a repeat of one replaces itself.
 * `r` is a row from cleanReminders; `url` is LINK_URL[r.link] — never anything the member typed.
 */
export function customReminderPush(lang, r, url) {
  const copy = copyFor(lang);
  const hint = (copy.hint || COPY.en.hint)[r.link] || '';
  const payload = {
    title: r.text || copy.reminderTitle || COPY.en.reminderTitle,
    body: hint,
    tag: 'reminder-' + r.id,
  };
  if (url) payload.url = url;
  return payload;
}

// The missed-workout nudge (nudge.js). Its copy is translated in the frontend packs and generated
// into nudge-copy.js, so every language the app speaks has it — unlike the strings above, which
// predate that and fall back to English. de-CH is de with ß written ss, as in the frontend
// (lib/i18n-core.js DERIVED_LOCALES).
const nudgeCopyFor = lang => {
  if (lang === 'de-CH') {
    const ch = s => s.replace(/ß/g, 'ss');
    return Object.fromEntries(Object.entries(NUDGE_COPY.de).map(([k, c]) => [k, { title: ch(c.title), lines: c.lines.map(ch) }]));
  }
  return NUDGE_COPY[lang] || NUDGE_COPY.en;
};
export function nudgePush(lang, tone, routine, iso) {
  const copy = nudgeCopyFor(lang)[NUDGE_COPY.en[tone] ? tone : 'friendly'];
  const line = copy.lines[lineIndex(iso, copy.lines.length)];
  const name = routine?.name || 'openGym';
  return { title: copy.title, body: line.replace('{0}', () => name), tag: 'nudge' };
}
