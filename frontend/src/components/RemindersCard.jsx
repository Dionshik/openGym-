import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DAYS, weekOrder, weekStartOf } from '../lib/format.js'
import { remindersOf, canAddReminder, daysSummary, LINKS, MAX_REMINDERS, MAX_TEXT } from '../lib/reminders.js'
import { MOBILE, syncReminder } from '../lib/mobile.js'
import { putReminder, toggleReminder, deleteReminder } from '../reminder-actions.js'
import Icon from './Icon.jsx'
import { Section, Row, Switch, Button, TextField } from './ui.jsx'

// Names live here, in t() calls, so the string check finds them.
const LINK_COPY = {
  nutrition: () => ({ label: t('Food diary'), icon: 'utensils', preset: t('Log your food') }),
  weight: () => ({ label: t('Body weight'), icon: 'scale', preset: t('Weigh in') }),
  body: () => ({ label: t('Measurements'), icon: 'chartLine', preset: t('Take measurements') }),
  photos: () => ({ label: t('Progress photos'), icon: 'camera', preset: t('Progress photo') })
}
const dayShort = d => t(DAYS[d])

function whenText(r, order) {
  const s = daysSummary(r, order)
  const days = s === 'daily' ? t('every day') : s === 'weekdays' ? t('on weekdays') : s === 'weekend' ? t('at the weekend') : s.days.map(dayShort).join(' ')
  return r.time + ' · ' + days
}

// After a change on the native app: the phone itself delivers these, and the first one is the
// moment to ask for the permission — a background resync never raises that dialog.
const resyncNative = () => { if (MOBILE) syncReminder(useStore.getState().S, true).catch(() => {}) }

/**
 * The person's own reminders: a list with a switch each, and a sheet to write one.
 * `links` narrows which sections one can point at — progress photos only where the instance
 * stores them.
 */
export default function RemindersCard({ S, links = LINKS }) {
  const list = remindersOf(S)
  const order = weekOrder(weekStartOf(S))
  const add = () => {
    if (!canAddReminder(S)) { useUI.getState().toast(t('At most {0} reminders', MAX_REMINDERS)); return }
    reminderSheet(null, { links, order })
  }
  return (
    <Section title={t('My reminders')}
      footer={MOBILE
        ? t('Delivered by this phone at the time you set, with or without a connection.')
        : t('Sent as push notifications, so the switch above has to be on. On an iPhone they only arrive once openGym is on the Home Screen.')}>
      {list.map(r => (
        <Row key={r.id} icon={LINK_COPY[r.link] ? LINK_COPY[r.link]().icon : 'bell'} iconTint="var(--blue)"
          title={r.text || t('Reminder')} subtitle={whenText(r, order)} onClick={() => reminderSheet(r, { links, order })}>
          <span onClick={ev => ev.stopPropagation()}>
            <Switch checked={r.on === true} onChange={on => { toggleReminder(r, on); resyncNative() }} />
          </span>
        </Row>
      ))}
      <Row icon="plus" iconTint="var(--acc)" title={t('Add reminder')} accessory="chevron" onClick={add} />
    </Section>
  )
}

function ReminderSheet({ reminder, links, order, close }) {
  const [text, setText] = useState(reminder?.text || '')
  const [time, setTime] = useState(reminder?.time || '09:00')
  const [days, setDays] = useState(reminder?.days || [])
  const [link, setLink] = useState(reminder?.link || null)
  const [skip, setSkip] = useState(!!reminder?.skipIfLogged)
  const toggleDay = d => setDays(x => (x.includes(d) ? x.filter(v => v !== d) : [...x, d]))
  // Picking a section fills in the words for it, unless the person has already written their own.
  const pick = l => {
    const presets = links.map(k => LINK_COPY[k]().preset)
    if (l && (!text.trim() || presets.includes(text.trim()))) setText(LINK_COPY[l]().preset)
    setLink(l)
    setSkip(!!l && (link === l ? skip : true))
  }
  const save = () => {
    if (!putReminder({ id: reminder?.id, text, time, days, on: reminder ? reminder.on : true, link, skipIfLogged: skip })) {
      useUI.getState().toast(t('Pick a time for the reminder'))
      return
    }
    resyncNative()
    close()
  }
  return <>
    <h3>{reminder ? t('Reminder') : t('New reminder')}</h3>
    <div className="sect-t" style={{ marginTop: 6 }}>{t('About')}</div>
    <div className="chips nt-chips" style={{ marginBottom: 10 }}>
      <button className={'chip' + (!link ? ' on' : '')} onClick={() => pick(null)}>{t('Anything')}</button>
      {links.map(l => { const c = LINK_COPY[l](); return <button key={l} className={'chip' + (link === l ? ' on' : '')} onClick={() => pick(l)}><Icon name={c.icon} />{c.label}</button> })}
    </div>
    <TextField value={text} maxLength={MAX_TEXT} placeholder={t('What to remind you of')} aria-label={t('What to remind you of')} onChange={e => setText(e.target.value)} />
    <div className="row between" style={{ marginTop: 14 }}>
      <div className="sect-t" style={{ margin: 0 }}>{t('Time')}</div>
      <input type="time" className="timef" value={time} aria-label={t('Time')} onChange={e => setTime(e.target.value)} />
    </div>
    <div className="sect-t" style={{ marginTop: 14 }}>{t('Days')}</div>
    <div className="wd-row">
      {order.map(d => <button key={d} className={'wd' + (days.includes(d) ? ' on' : '')} aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>{dayShort(d)}</button>)}
    </div>
    <div className="dim small" style={{ marginTop: 6 }}>{days.length ? '' : t('No day selected means every day.')}</div>
    {link && <div className="row between" style={{ marginTop: 12, gap: 12 }}>
      <div>
        <div>{t('Skip if already logged')}</div>
        <div className="dim small">{t('Stays quiet on a day that already has an entry there.')}</div>
      </div>
      <Switch checked={skip} onChange={setSkip} />
    </div>}
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {reminder && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { deleteReminder(reminder.id); resyncNative(); close() }}>{t('Delete')}</Button></>}
  </>
}
const reminderSheet = (reminder, opts) => useUI.getState().openSheet(close => <ReminderSheet reminder={reminder} {...opts} close={close} />)
