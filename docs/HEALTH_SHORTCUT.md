# Apple Health → openGym, with a Shortcut

openGym on an iPhone is a web app, and a web app cannot read the Health app. Apple gives that
access only to native apps with a HealthKit entitlement, which this project does not ship. What
every iPhone does have is **Shortcuts**, which can read Health samples and call a URL. So the
bridge is a small Shortcut that runs once a day and posts a few numbers to your own server.

> **Status: the server side is tested; the Shortcut is not.** The endpoint, the token and the
> parser have automated tests (`api/test/healthkit.test.js`, `server-extras.test.js`). The steps
> below were written from Apple's documentation without an iPhone to run them on. Action and
> field names differ a little between iOS versions and languages — the endpoint is deliberately
> forgiving about what it receives, and it answers with what it understood, so the first run
> tells you what to fix.

## What is sent, and where it goes

| Sent | Field | Stored as |
|---|---|---|
| body mass | `weight` | a weigh-in |
| body-fat percentage | `bodyFat` | a measurement |
| lean body mass | `leanMass` | a measurement |
| waist circumference | `waist` | a measurement |
| height | `height` | the body profile's height, if it is empty |

Nothing else is accepted. Steps, sleep, heart rate and workouts are ignored if sent — the app
has no use for them yet, and the answer lists them under `ignored`.

The data goes **from the phone to your server** and nowhere else. On the server it is kept in
`data/health/<uid>.json`, unencrypted like everything in `./data`, readable by the admin. The
app then copies new readings into the profile:

- a reading only fills an empty day or replaces an earlier reading from Health — a weigh-in you
  typed yourself that day wins;
- nothing is applied twice, so an entry you delete afterwards stays deleted;
- rows that came from Health are marked as such in the measurements list.

## 1. The admin turns it on

Admin dashboard → **Nutrition & Health** → *Apple Health*. Off by default.

## 2. Make a token

Body screen → **Apple Health** → **Connect**. A token starting with `ogh_` is shown **once** —
copy it. The server keeps only a hash of it.

The token can add body measurements to the one profile it was made for. It cannot read
anything — not the diary, not the workouts, not even what it delivered — and it is not a
session: no other route accepts it. Up to three per profile; revoke one on the same screen and
it stops working at once.

The same sheet shows the address to send to: `https://<your server>/api/healthkit/ingest`.

## 3. Build the Shortcut

On the iPhone, open **Shortcuts** → **+**. Add these actions in order. (Russian names of the
actions are given in brackets; yours may read slightly differently.)

1. **Find Health Samples** [«Найти образцы данных о здоровье»]
   - *Type*: **Weight** [«Вес»]
   - *Add Filter*: **Start Date** — **is today** [«Дата начала» — «сегодня»]
   - *Sort by*: **Start Date**, **Latest First**
   - *Limit*: on, **1**

   The "is today" filter is what makes the Shortcut safe to run daily: on a day without a
   weigh-in it finds nothing and sends an empty field, instead of sending last week's weight
   again as if it were today's.

2. *(optional)* The same action again with *Type*: **Body Fat Percentage** [«Процент жира в
   организме»].

3. *(optional)* The same action again with *Type*: **Waist Circumference** [«Окружность
   талии»].

4. **Get Contents of URL** [«Получить содержимое URL»]
   - *URL*: the address from step 2
   - tap **Show More**
   - *Method*: **POST**
   - *Headers*: add one — key `Authorization`, value `Bearer ogh_…your token…`
     (the word `Bearer`, a space, then the token)
   - *Request Body*: **JSON**. Add **Text** fields:

     | Key | Value |
     |---|---|
     | `weight` | the **Health Samples** variable from action 1 |
     | `bodyFat` | the Health Samples from action 2 |
     | `waist` | the Health Samples from action 3 |
     | `date` | the **Current Date** variable — tap it and set *Date Format* to **ISO 8601** |

     To insert a variable, tap the value field and pick it from the bar above the keyboard.

5. *(optional, for testing)* **Show Result** [«Показать результат»] with the output of
   action 4 — it displays what the server understood.

Name it, for example, "openGym Health", and run it once. iOS asks for permission to read each
Health type and to contact your server — allow them.

A successful answer looks like this:

```json
{ "ok": true, "accepted": [{ "metric": "weight", "d": "2026-10-01", "v": 80.5 }], "ignored": [], "warnings": [] }
```

Open the Body screen in openGym: *Last delivery* shows the time, and the weigh-in appears on
Home.

## 4. Run it every day

**Shortcuts** → **Automation** → **+** → **Time of Day** — pick a time when the phone is
normally unlocked and in your hand, e.g. 09:00 — **Daily** — **Run Immediately** — choose the
Shortcut.

**Health data cannot be read while the phone is locked.** An automation at 04:00 finds nothing.
If a time of day does not suit, good triggers are *When my alarm is stopped* or *When
\[an app I open every morning\] is opened*.

## Sharing one Shortcut with everyone on the instance

Build it once, then on the Shortcut: **Share** → **Copy iCloud Link**. Before sharing, under
the Shortcut's details → **Setup** → **Add Question**, attach an import question to the URL and
to the `Authorization` value, so each person is asked for their own address and token when
they add it. Paste the iCloud link into the admin dashboard (Nutrition & Health → *Link to your
shared Shortcut*); members then see a **Get the Shortcut** button instead of these steps.

## What the endpoint accepts

`POST /api/healthkit/ingest`, `Authorization: Bearer ogh_…`, JSON body, at most 64 KB.

```json
{ "date": "2026-10-01T08:15:00+03:00", "weight": "80,5 кг", "bodyFat": "18 %", "waist": "88" }
```

It reads generously, because a hand-built Shortcut on a phone set to its own language sends
what that phone writes:

- numbers with a comma or a point, with or without a unit: `80,5 кг`, `176.4 lb`, `18 %`;
- body fat as a percentage or as the fraction Health stores (`0.18`);
- height and waist in centimetres, metres (`1,8 м`) or inches;
- a list of samples, one per line — the first line is taken;
- dates as ISO 8601, `01.10.2026`, `10/1/2026`, `1 окт. 2026 г.`, `Oct 1, 2026`;
- field names in English or Russian (`weight` / `вес`, `height` / `рост` …);
- a metric's own date as `<name>Date` (`weightDate`), which wins over `date`; with no date at
  all, the day the request arrived.

And then it checks the result against what a body can be — a weight of 8050 or a body fat of
182 % is dropped with a warning rather than stored.

| Answer | Meaning |
|---|---|
| `200` | read; `accepted` lists what was stored, `warnings` what was not and why |
| `401 bad token` | wrong, revoked, or not a Health token |
| `403 disabled` | the admin switched the feature off |
| `413` | body over 64 KB |
| `429 throttled` | more than 30 deliveries in an hour from this token, or too many bad tokens instance-wide |

Test it without a phone:

```bash
curl -X POST https://your.server/api/healthkit/ingest \
  -H 'Authorization: Bearer ogh_…' -H 'Content-Type: application/json' \
  -d '{"weight":"80,5 кг","bodyFat":"18 %"}'
```

## Troubleshooting

- **`accepted` is empty, no warnings** — the Shortcut found no sample for today. Weigh in, or
  check the filter in action 1.
- **A warning "is not a value this can be"** — the field arrived as something other than a
  number. Tap the variable in the request body and make sure it is the Health Samples value,
  not its name or date.
- **Works when run by hand, nothing arrives from the automation** — the phone was locked.
- **`401`** — the header value must be `Bearer`, a space, and the whole token.
- **Deliveries arrive but the weight on Home does not change** — you already typed a weigh-in
  for that day; yours wins.

## Stopping

Revoke the token on the Body screen (the Shortcut then gets `401`), and delete the automation
on the phone. **Forget delivered data** removes the readings from the server; weigh-ins and
measurements already copied into the profile are the profile's and are deleted where you see
them.

## Other routes, for later

- **A native app** could read HealthKit directly and far more of it (sleep, resting heart rate,
  workouts). Apple's own table lists the HealthKit capability as available to a free Apple ID,
  so an owner with a Mac can build the Capacitor shell for their own phone and re-sign it
  weekly; distributing it to others needs the paid developer programme and TestFlight.
- **Health Auto Export** (a paid App Store app) can post Health data to a REST endpoint on a
  schedule. Its JSON format is not accepted here today.
- The Health app's own **Export All Health Data** archive: the importer under Settings reads
  body mass from `export.xml`.
