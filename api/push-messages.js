const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ — this is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan — let's go 💪",
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
    testBody: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano — vamos treinar 💪',
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
