# Third-party notices

openGym — Copyright (C) 2026 Duarte Santos.
openGym's own code is licensed under the **GNU AGPL v3.0** (see [LICENSE](LICENSE)).

## App store exception

As an additional permission under section 7 of the AGPL v3.0, the copyright holder permits
distribution of the openGym mobile application through app store platforms (such as the
Apple App Store and Google Play) whose terms of service would otherwise be incompatible
with the AGPL, provided the corresponding source code remains available under the AGPL at
the project repository. This permission applies to the distribution channel only and does
not otherwise limit the license.

## Body diagram geometry

The muscle outlines the body maps are drawn from (`frontend/src/lib/body-paths.js`) are derived
from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the
**MIT License** and reproduced below. MuscleMap ships its path data as Swift source rather than
`.svg` files; the paths were converted to a JSON module, its sub-group shapes were dropped, and
nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Exercise media (stills and animations)

The exercise stills and animations in `catalogue/media/` (and inside the published container
images and app packages) are licensed to openGym by Gym visual. **They are not covered by
openGym's AGPL** and not by any licence of the exercise text below.

> © Aliaksandr Makatserchyk, Gym visual, gymvisual.com (reuse is governed by Gym visual's Terms & Conditions; obtain your own license there before reusing the media). NOTICE TO DEVELOPERS: The exercise animations included in this project are provided strictly for use within the openGym application. Third parties have no rights to reuse, extract, or integrate these media assets into independent apps, websites, or commercial products. To use these animations for your own software, you must obtain a license directly from gymvisual.com.

What that means in practice:

- The repository, websites and self-hosted servers carry the media at 180×180 px at most. Larger
  versions exist only inside the compiled openGym app packages.
- There is no public API, CDN or downloadable media pack. Don't hotlink the files or copy them out
  of this repository or a running instance.
- A non-commercial fork of openGym may keep the unmodified 180 px media together with this notice.
  A commercial fork, or any other use, needs its own licence from [gymvisual.com](https://gymvisual.com/).
- The media may not be used to train, prompt or feed any AI system, or as a basis for generated
  images, animations or video.

## Exercise text (names, muscles, descriptions, instructions)

The catalogue in `catalogue/` is openGym's own and is edited by its community (see
`catalogue/README.md`). Entries marked `"textSource": "exercisedb"` (the 1,324 exercises openGym
shipped before v1.4.0) keep names, muscles and instructions that originate from
[**ExerciseDB v1**](https://exercisedb.dev/) by AscendAPI and reached openGym through
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset), under the MIT
licence reproduced below. Everything else in the catalogue (the newer exercises, every description,
the muscle-map corrections and all translations) was written for openGym and is covered by
openGym's AGPL.

```
MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation and data files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Brazilian Portuguese exercise instructions and names (now in `catalogue/i18n/pt-BR.json`) are original translations of that
English source produced with OpenAI Codex and Anthropic Claude Code
language-model assistance. They are not copied from a separate Portuguese
dataset. Their review status and translation policy are documented alongside
the source files.

### Additional exercises — three more open sources

The dataset above lacks whole families of exercises (Olympic lifts, strongman, newer accessory
variants, mobility work). 535 further catalogue rows come from three other open sources, built
by `scripts/build-extra-exercises.mjs` into files of their own — the upstream file is untouched.
Only text is in this repository: names, muscles, equipment and step-by-step instructions, mapped
onto the vocabulary the catalogue already uses. None of these exercises has an animation, and
**no image from any of these sources is committed here**. What was kept, what was dropped as a
duplicate and every decision made by hand are in `scripts/exercise-extra-sources/`.

**Photographs fetched at run time — rights not established.** 294 of the free-exercise-db rows
name two photographs each (start and end position), which the app flips between in place of an
animation. Like the upstream images and animations above, the files are **downloaded by each
instance** — the `media` service in `docker-compose.yml`, or `scripts/fetch-media.sh` — from
[yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) at a pinned commit, into
`media/img/fedb/`, which is not tracked by git. openGym does not redistribute them.

That project licenses its *data* under The Unlicense, but it does not own these photographs and
says so: its maintainers state that the images were gathered from other websites and that they
do not know who holds the rights. openGym therefore makes no claim that they may be used, and
anyone running an instance decides for themselves. **To run without them**, create the empty
file `media/img/fedb/.complete` before the first start (or delete `media/img/fedb/*` and leave
that file): the download is skipped and those exercises show the same placeholder a custom
exercise does. The standalone mobile build and the demo build never fetch them.

**`frontend/src/lib/exercises-extra.js`** — two sources:

- [**yuhonas/free-exercise-db**](https://github.com/yuhonas/free-exercise-db), released into the
  public domain under **The Unlicense**. Its photographs are *not* used: by its own maintainers'
  account they were collected from other websites and are not theirs to license. The repository
  does not document where its instruction text came from.
- [**longhaul-fitness/exercises**](https://github.com/longhaul-fitness/exercises), under the
  **MIT License**, Copyright (c) 2023 Longhaul Fitness — the same permission and warranty text
  as the MIT notice reproduced above.

**`frontend/src/exercise-names/ru.js`, `frontend/src/instr-extra/ru.js`** — Russian names, search
aliases and instructions for the free-exercise-db rows, from
[**leadpioneer/RU-free-exercise-db**](https://github.com/leadpioneer/RU-free-exercise-db)
(**The Unlicense**). That overlay describes itself as a machine draft — names from a glossary
engine, instructions machine-translated and post-edited — and is used as such.

**`frontend/src/lib/exercises-extra-wger.js`** — 68 rows adapted from the
[**wger**](https://wger.de) exercise database. **These rows are not under openGym's AGPL**: each
is licensed by its authors under **Creative Commons Attribution-ShareAlike 4.0**
(<https://creativecommons.org/licenses/by-sa/4.0/>), four of them under **CC0**. The authors, the
licence and the source page of every row are listed in `licenses/wger-attribution.json`. Changes
made: the description was split into steps, and muscles and equipment were mapped onto the
catalogue's vocabulary. Anyone redistributing this file must keep that attribution and license
their adaptation of these rows the same way. wger is taken selectively — a vetted list, in
`scripts/exercise-extra-sources/overrides.json` — because its entries vary too much in quality
to import wholesale.

## Food data

### The built-in food list

`frontend/src/lib/foods-data.js` is generated by `scripts/build-foods.mjs` (see
[docs/NUTRITION.md](docs/NUTRITION.md)).

- **367 rows** take their energy, protein, fat and carbohydrate values from **USDA FoodData
  Central, SR Legacy (April 2018)** — U.S. Department of Agriculture, Agricultural Research
  Service, <https://fdc.nal.usda.gov>. That dataset is in the public domain (CC0 1.0); no
  attribution is required, and it is given here because it is due. The Russian names, short
  English names and search aliases of those rows were written for this project and are under
  this project's licence.
- **71 rows** (`s-…`) are foods that table does not have — tvorog, kefir, pelmeni, borscht and
  the like. Their values are typical figures, hand-authored for this project, and approximate.
  They are not taken from any published composition table.

### Open Food Facts — fetched at run time, never bundled

When an instance's admin turns on online food lookup, the server asks **Open Food Facts**
(<https://openfoodfacts.org>) for products by barcode or name and caches the answers in
`data/off-cache.json`. None of that data is in this repository.

> Contains data from Open Food Facts, available under the Open Database License.

The database is licensed under the **Open Database License (ODbL) 1.0**
(<https://opendatacommons.org/licenses/odbl/1-0/>) and its individual contents under the
Database Contents License. The app shows that attribution wherever such data is displayed, and
the cache is kept in a file of its own so it is never mixed into the built-in list above or
into anybody's profile without its source being recorded (`src: 'off'` on a product saved from
a lookup). Product images are not fetched.

## Gym check-in QR codes

The gym check-in feature (a saved membership code shown as a QR code on the phone, added by
typing, importing a photo, or scanning with the camera) uses three third-party packages. All are
permissively licensed and compatible with openGym's AGPL, and all load on demand: the QR renderer
and the browser decoder only when a card is shown or scanned, the ML Kit plugin only in the
Android/iOS app.

### QR/barcode rendering — `lean-qr`

openGym renders each saved code on the phone with [**lean-qr**](https://github.com/davidje13/lean-qr)
by David Evans, used under the **MIT License** and reproduced below. Only the code's stored value
is kept; the picture is generated fresh from that value each time it is shown, never stored.
It runs the same way in the app and in the browser/PWA.

```
MIT License

Copyright (c) 2021-2025 David Evans

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Camera scan & photo decode in the browser — `jsQR`

In a browser (including the installed PWA), reading a code from the camera or from an imported
photo uses [**jsQR**](https://github.com/cozmo/jsQR) by Cosmo Wolfe, under the **Apache License
2.0** (text at <https://www.apache.org/licenses/LICENSE-2.0> and in the package's own `LICENSE`).
Where the browser has a native `BarcodeDetector`, that is tried first and jsQR is the fallback.
Video frames are decoded in memory and never uploaded or stored.

### Camera scan & photo decode in the app — `@capacitor-mlkit/barcode-scanning`

In the Android/iOS app, reading a code — from the camera or from an imported photo — uses the
[**@capacitor-mlkit/barcode-scanning**](https://github.com/capawesome-team/capacitor-mlkit) plugin
by the Capawesome Team (Robin Genz), a Capacitor wrapper around Google's ML Kit, used under the
**Apache License 2.0**. openGym pins the `7.x` line to stay on Capacitor 7. The full license text is
available at <https://www.apache.org/licenses/LICENSE-2.0> and in the package's own `LICENSE` file.
The decoded string is what openGym keeps; the photo itself is never stored.
