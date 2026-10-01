import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable, hasConsent, OPTIONAL_TEXT } from '../lib/coach.js'
import { Section, Row, Switch } from './ui.jsx'

/* What of the body profile and the food diary the Coach may read.
 *
 * Two switches, both off until turned on. Agreeing to the Coach covered the plan, the training
 * log and the weigh-ins — it did not cover how tall someone is or how much they eat, and it
 * must not start to because a new version of the app learned to send it. So each of these is
 * asked for here, by name, next to the data it is about; the payload builder checks the switch
 * itself (api/coach/core/extras.js), on the server's own copy of the profile.
 *
 * Shown only where there is a Coach and the person has already agreed to it: with no Coach
 * consent nothing is sent at all, and a switch here would promise something it cannot do.
 */
export default function CoachSharing() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachLocal = useStore(s => s.coachLocal)
  const update = useStore(s => s.update)
  if (!coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode: coachLocal?.mode }) || !hasConsent(S)) return null
  const extra = S.coach?.consent?.extra || {}
  const set = (key, on) => update(s => {
    const next = { ...(s.coach.consent.extra || {}) }
    if (on) next[key] = new Date().toISOString(); else delete next[key]
    s.coach = { ...s.coach, consent: { ...s.coach.consent, extra: next } }
  })
  return <Section title={t('Share with the Coach')}
    footer={t('Off by default. When on, the Coach sees a summary each time it reads your training — and uses it to judge recovery and progress, not to tell you what to eat.')}>
    {Object.entries(OPTIONAL_TEXT).map(([key, [title, sub]]) => (
      <Row key={key} title={t(title)} subtitle={t(sub)}>
        <Switch checked={!!extra[key]} onChange={v => set(key, v)} />
      </Row>
    ))}
  </Section>
}
