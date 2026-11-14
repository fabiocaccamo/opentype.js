<div align="center">
  <h1>opentype.js</h1>
  <a href="https://www.npmjs.com/package/opentype.js"><img alt="Latest version on npm" src="https://img.shields.io/npm/v/opentype.js.svg?style=flat" /></a>
  <a href="https://www.npmjs.com/package/opentype.js"><img alt="npm downloads, yearly" src="https://img.shields.io/npm/dy/opentype.js.svg?style=flat" /></a>
  <a href="https://github.com/opentypejs/opentype.js/blob/master/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/opentypejs/opentype.js" /></a>
  <a href="https://github.com/opentypejs/opentype.js/actions/workflows/ci.yml?query=branch%3Amaster"><img alt="GitHub Workflow Status (with event)" src="https://img.shields.io/github/actions/workflow/status/opentypejs/opentype.js/ci.yml"></a>
  <br /><br />
</div>

It gives you access to the **letterforms** of text from the browser or Node.js.

See [https://opentype.js.org/](https://opentype.js.org/) for a live demo.

## Features

* Create a bézier path out of a piece of text.
* Support for composite glyphs (accented letters).
* Support for WOFF, OTF, TTF (both with TrueType `glyf` and PostScript `cff` outlines)
* Support for kerning (Using GPOS or the kern table).
* Support for ligatures.
* Support for TrueType font hinting.
* Support arabic text rendering (See issue #364 & PR #359 #361)
* Support for emojis and other SVG or COLR/CPAL color glyphs
* A low memory mode is available as an option (see #329)
* Runs in the browser and Node.js.

## Installation

### via CDN

Select one of the following sources in the next example:

- https://opentype.js.org/dist/opentype.js
- https://cdn.jsdelivr.net/npm/opentype.js
- https://unpkg.com/opentype.js

```html
<!-- using global declaration -->
<script src="https://your.favorite.cdn/opentype.js"></script>
<script>opentype.parse(...)</script>

<!-- using module declaration (need full path) -->
<script type=module>
import { parse } from "https://unpkg.com/opentype.js/dist/opentype.module.js";
parse(...);
</script>
```

### via [npm](http://npmjs.org/) package manager

```sh
npm install opentype.js
```
 
```js
const opentype = require('opentype.js');

import opentype from 'opentype.js'

import { load } from 'opentype.js'
```

Using TypeScript? [See this example](./docs/examples/typescript)

## Contribute

If you plan on improving or debugging opentype.js, you can:

- Fork the [opentype.js](https://github.com/opentypejs/opentype.js) repo
- clone your fork `git clone git://github.com/yourname/opentype.js.git`
- move into the project `cd opentype.js`
- install needed dependencies with `npm install`
- make your changes
    - **option A:** for a simple build, use `npm run build`
    - **option B:** for a development server, use `npm run start` and navigate to the `/docs` folder
- check if all still works fine with `npm run test`
- commit and open a Pull Request with your changes. Thank you!

## Maintainer Releases

Releases are published from the manual [Publish package to npm](https://github.com/opentypejs/opentype.js/actions/workflows/release.yml) workflow.

1. Confirm the target version, for example `1.3.5`, and make sure `master` is green.
2. Run the workflow from `master` with `dryRun: true` and `npmDistTag: latest`.
3. Inspect the dry-run output, especially the package version and packed files.
4. Re-run the workflow with the same version and `dryRun: false`.

The release workflow runs preflight checks, publishes to npm, then creates the matching git tag and GitHub release.

## Usage

### Loading a WOFF/OTF/TTF font

This is done in two steps: first, we load the font file into an `ArrayBuffer` ...
```js
// either from an URL
const buffer = fetch('/fonts/my.woff').then(res => res.arrayBuffer());
// ... or from filesystem (node)
const buffer = require('fs').promises.readFile('./my.woff');
// ... or from an <input type=file id=myfile> (browser)
const buffer = document.getElementById('myfile').files[0].arrayBuffer();
```

... then we `.parse()` it into a `Font` instance
```js
// if running in async context:
const font = opentype.parse(await buffer);
console.log(font);

// if not running in async context:
buffer.then(data => {
    const font = opentype.parse(data);
    console.log(font);
})
```

`opentype.parse(buffer, options)` takes the option `layoutCache` (default `true`): with `false` the layout does not cache the lookups of the GSUB and GPOS tables of the font (see `Font.getPath()`), so a change made directly to the objects of `font.tables.gsub` or `font.tables.gpos`, or of a table assigned to them later (also the tables that `font.substitution` and `font.position` create), applies at the next layout, at the cost of computing the lookups of the features at every layout. Any value other than a boolean or `undefined` throws a `TypeError`.

<details>
<summary>Loading a WOFF2 font</summary>

WOFF2 Brotli compression perform [29% better](https://www.w3.org/TR/WOFF20ER/#appendixB) than it WOFF predecessor.
But this compression is also more complex, and would result in a much heavier (&gt;10×!) opentype.js library (≈120KB => ≈1400KB).

To solve this: Decompress the font beforehand (for example with [fontello/wawoff2](https://github.com/fontello/wawoff2)).

```js
// promise-based utility to load libraries using the good old <script> tag
const loadScript = (src) => new Promise((onload) => document.documentElement.append(
  Object.assign(document.createElement('script'), {src, onload})
));

const buffer = //...same as previous example...

// load wawoff2 if needed, and wait (!) for it to be ready
if (!window.Module) {
  const path = 'https://unpkg.com/wawoff2@2.0.1/build/decompress_binding.js'
  const init = new Promise((done) => window.Module = { onRuntimeInitialized: done});
  await loadScript(path).then(() => init);
}
// decompress before parsing
const font = opentype.parse(Module.decompress(await buffer));
```
</details>

### Craft a font

It is also possible to craft a Font from scratch by defining each glyph bézier paths.

```javascript
// this .notdef glyph is required.
const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    advanceWidth: 650,
    path: new opentype.Path()
});

const aPath = new opentype.Path();
aPath.moveTo(100, 0);
aPath.lineTo(100, 700);
// more drawing instructions...
const aGlyph = new opentype.Glyph({
    name: 'A',
    unicode: 65,
    advanceWidth: 650,
    path: aPath
});

const font = new opentype.Font({
    familyName: 'OpenTypeSans',
    styleName: 'Medium',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdefGlyph, aGlyph]});
```

### Saving a Font

Once you have a `Font` object (from crafting or from `.parse()`) you can save it back out as file.

```js
// using node:fs
fs.writeFileSync("out.otf", Buffer.from(font.toArrayBuffer()));

// using the browser to createElement a <a> that will be clicked 
const href = window.URL.createObjectURL(new Blob([font.toArrayBuffer()]), {type: "font/opentype"});
Object.assign(document.createElement('a'), {download: "out.otf", href}).click();
```

### The Font object
A Font represents a loaded OpenType font file. It contains a set of glyphs and methods to draw text on a drawing context, or to get a path representing the text.

* `glyphs`: an indexed list of Glyph objects.
* `unitsPerEm`: X/Y coordinates in fonts are stored as integers. This value determines the size of the grid. Common values are `2048` and `4096`.
* `ascender`: Distance from baseline of highest ascender. In font units, not pixels.
* `descender`: Distance from baseline of lowest descender. In font units, not pixels.
* `tableTags`: the tags of all the tables of the parsed font file, including the ones opentype.js does not parse (e.g. the color bitmap tables `sbix`, `CBDT` and `CBLC`).
* `isGdefIgnoredByLayout`: true when the GDEF table of the parsed font is one of the tables with wrong glyph classes that HarfBuzz ignores, which the layout then does not use either (`font.tables.gdef` still holds it), see `Font.getPath()`.
* `isLayoutCacheEnabled`: false when the font was parsed with the option `layoutCache: false`, whose layout does not cache the lookups of the GSUB and GPOS tables (see `opentype.parse()`), true otherwise; set by the option when the font is parsed, changing it afterwards is not supported.

#### `Font.getPath(text, x, y, fontSize, options)`
Create a Path that represents the given text.
* `x`: Horizontal position of the beginning of the text. (default: `0`)
* `y`: Vertical position of the *baseline* of the text. (default: `0`)
* `fontSize`: Size of the text in pixels (default: `72`).
* `options`: _{GlyphRenderOptions}_ passed to each glyph, see below

Options is an optional _{GlyphRenderOptions}_ object containing:
* `script`: the [OpenType script tag](https://learn.microsoft.com/en-us/typography/opentype/spec/scripttags) of the GSUB and GPOS features (and of the `kern` table fallback) of the whole text, e.g. `"latn"` or `"cyrl"`, taken literally (`"deva"` selects the language systems of the first version of the Indic tags, `"dev2"` those of the second one, unlike the itemization below): like HarfBuzz with the script of a buffer, the text is then one script run, shaped with the Arabic features for `"arab"`, the Thai features for `"thai"` and the latin features otherwise, whatever the script of its characters. Without it, like HarfBuzz after the itemization of a browser, the text is split into script runs by the Unicode Script property of its characters (Unicode 16.0.0): the characters of no script (Common, Inherited and Unknown: digits, punctuation, spaces, most combining marks) and the variation selectors are in the run of the character before them, or of the first character of a script after them at the start of the text; like the itemization of Chromium, a character of the Common script whose Unicode Script_Extensions have the script of the run after it and not the one of the run before it is in the run after it (e.g. a tatweel or an Arabic comma between a Latin word and an Arabic letter), while a combining mark of the Inherited script stays in the run of the character before it, its base, like the browsers (e.g. the U+030C of `Π̌ W` in the Greek run). Not yet the direction of a nonspacing mark from its base (rule W1 of the Unicode Bidirectional Algorithm): a haraka after a Latin letter or a whitespace is laid out in the right-to-left sentence after it (e.g. the U+064E of `aَسد`), and a mark that is not an Arabic one after an Arabic letter ends its sentence (e.g. the U+0301 of `سد́`). Not yet the resolution of the weak and neutral bidi classes: an Arabic character of a weak or neutral bidi class (e.g. U+066A ARABIC PERCENT SIGN, U+060C ARABIC COMMA), with its marks, is laid out from right to left in a Latin text (e.g. the two U+066A of `ab ٪٪`) and after Arabic letters at the end of their right-to-left sentence (e.g. the U+066A of `سد٪ ab`). Unlike the itemization of the browsers (Unicode Standard Annex #24), the paired brackets are not resolved yet: a closing bracket is in the run of the character before it, not in the run of its opening bracket (e.g. the `)` of `Hello (Привет)` is in the Cyrillic run). Each run takes the OpenType tag of its script, like HarfBuzz: `"latn"`, `"cyrl"`, `"grek"`, `"armn"`, `"cham"`... (`"kana"` for Hiragana and Katakana, the third and the second version of the tag before the first one for the Indic scripts, e.g. `"dev3"`, `"dev2"` then `"deva"`, the first one the font has; `"DFLT"` for a text of no script). Each script run is shaped on its own, like HarfBuzz: its GSUB lookups and its kerning pairs never cross the run (e.g. a Latin pair around a Thai mark is not kerned). The Arabic runs take the Arabic features, the Thai runs the Thai features, the other runs the latin features (see `features`). A script the font does not have falls back to `"DFLT"`, `"dflt"`, then `"latn"`, like HarfBuzz; with `"hebr"` and no `hebr` script in GPOS, no GPOS lookup applies and the `kern` table does, like the Hebrew shaper of HarfBuzz. Like HarfBuzz, the GPOS lookups apply to a right-to-left run in the order of the text (the value records of a pair to its glyphs in the order of the text, e.g. the x advance of the first one to the glyph on the right), the `kern` table in visual order, see `Font.shape()`.
* `language`: the [OpenType language system tag](https://learn.microsoft.com/en-us/typography/opentype/spec/languagetags) of the GSUB features (their `"locl"` included) and of the GPOS features (default: `"dflt"`), e.g. `"TRK "` or `"TRK"` for Turkish (a tag of three letters is the tag with its trailing space), `"SRB"` for Serbian, `"URD"` for Urdu; not a BCP 47 language tag (`"tr"`): map the language of the text to its OpenType tag. A language system the script does not have falls back to the default language system of the script: like HarfBuzz, its language system tagged `"dflt"` if it has one, otherwise its DefaultLangSys.
* `kerning`: if true takes kerning information into account (default: `true`): the lookups of the GPOS `kern` feature, their single adjustments (lookup type 1) adjusting a glyph and their pair adjustments (lookup type 2) a glyph and the next glyph its `lookupFlag` does not ignore (e.g. across the marks of a lookup with `IgnoreMarks`, like HarfBuzz) in the same run, or the `kern` table when GPOS has no `kern` feature for the script and language, which kerns a glyph with the next glyph that is not a GDEF mark, like HarfBuzz (see `Font.shape()`). The marks are the ones of the glyph classes of GDEF (its `GlyphClassDef`): without them no glyph is a mark, for the GPOS lookups (but the mark-to-base and mark-to-ligature attachments, see `Font.shape()`) and for the `kern` table, unlike HarfBuzz, which then takes the nonspacing marks of Unicode as marks (e.g. in a font with the `kern` table and no GDEF, a letter is kerned with a U+0301 after it, where HarfBuzz kerns it with the letter after the U+0301). Like HarfBuzz, which shapes each script run and each direction run on its own, two glyphs of two script runs, or of a left-to-right run and of a right-to-left run (an Arabic text), are never kerned together. Not yet the composition of HarfBuzz: a letter and a combining mark (e.g. `A` and U+0300) are not composed into the precomposed glyph of the font (`Agrave`), so the `kern` table and the GPOS lookups with `IgnoreMarks` kern the letter across the mark, where HarfBuzz kerns the precomposed glyph. `{ kerning: false }` is `{ features: { kern: false } }`: the other GPOS features still apply
* `features`: an object with [OpenType feature tags](https://docs.microsoft.com/en-us/typography/opentype/spec/featuretags) as keys, and a boolean or a number as value to enable or disable each feature over the default ones (e.g. `{ liga: false, ss01: true, cv01: 2 }`), in every script run (`{ ccmp: false }` turns off the `"ccmp"` of the Latin, Arabic and Thai text). Like `font-feature-settings` and the feature values of HarfBuzz (`hb-shape --features=cv01=2`), a number is the value of the feature: `0` turns it off like `false`, any other integer turns it on, and `true` is `1`; the value is the alternate index of the alternate substitutions (GSUB lookup type 3) of the feature, `1` for the first alternate of a glyph (e.g. `{ aalt: 2 }` for the second alternate of `"aalt"`, `{ salt: 3 }`, `{ cv01: 2 }`, `{ ss01: 2 }`, `{ swsh: 2 }`, `{ ornm: 4 }`): like HarfBuzz, an index past the alternates of a glyph leaves the glyph unchanged (another subtable of the lookup that has more alternates for the glyph can still substitute it), the other lookups of the feature (e.g. its single substitutions) apply whatever the value, a lookup record of a contextual rule applies an alternate substitution with the value of the feature of the contextual lookup at the glyph it applies at, a value keeps its 8 lowest bits (`257` is `1`, `256` turns a feature off), and like a feature of the user of HarfBuzz, an Arabic form (`"isol"`, `"fina"`, `"medi"`, `"init"`) that the option sets applies at every glyph of an Arabic run with its value, and sets the bit 1 of its form mask in its value (a bitwise OR) at the letters of the form (`{ fina: 2 }` gives the second alternate of a teh, the third one of a final teh; `{ fina: 3 }` the third one of a final teh too; `{ fina: 256 }` the first alternate of a final teh only, like the default), and `"rtlm"` sets the bit 1 of its mask in its value in a run of a right-to-left script (`{ rtlm: 2 }` and `{ rtlm: 3 }` give the third alternate there, `{ rtlm: 256 }` the first one), so a value whose 8 lowest bits are 0 does not turn them off there. Not yet like HarfBuzz for a lookup of several features: it takes the value of the first enabled one, where HarfBuzz joins the masks of the features, an alternate index past the alternates unless the value of each feature is the global value 1 (e.g. with `{ ss03: 1, ss04: 2 }` and a lookup of both, HarfBuzz leaves a glyph with 3 alternates unchanged; a lookup that the required feature of the language system shares with `{ salt: 2 }`, or with an Arabic form that the option does not set, substitutes no alternate in HarfBuzz). Any other value (a negative number, a number that is not an integer, a string, `null`) throws a `TypeError`; an `undefined` value is no value.
For the latin features (the text of the scripts other than Arabic and Thai) the GSUB features browsers enable by default are applied: `"ccmp"`, `"locl"`, `"rlig"`, `"rclt"`, `"calt"`, `"liga"` and `"clig"`, with their lookups in lookup list order, after the lookups of `"rvrn"` (the required variation alternates), which like HarfBuzz is on by default, in a stage of its own before the other features (it can be turned off with `{ rvrn: false }`). Like HarfBuzz, `"rand"` is on by default too, with the value 255: its alternate substitutions take a random alternate of each glyph, from the random numbers of HarfBuzz (its minimal standard generator, from the random state 1 of a buffer at the start of each script run), so the same text gives the same alternates as HarfBuzz and every time; `{ rand: 2 }` takes the second alternate, `{ rand: false }` turns it off. Like HarfBuzz, the direction features are on by default in the script runs of their direction, the horizontal direction HarfBuzz gives the script of the run (`hb_script_get_horizontal_direction`) whatever the order its glyphs are laid out in: `"rtla"` and `"rtlm"` in a run of a right-to-left script (Arabic, Hebrew, Syriac, Thaana, NKo...), its digits and punctuation included, `"ltra"` and `"ltrm"` in the other runs; the `features` option turns them off (`{ ltra: false }`), or on in every run (`{ rtla: true }`). Not yet the mirroring of HarfBuzz, which applies `"rtlm"` only to the characters it does not replace by their Unicode mirror (no character is mirrored). Like HarfBuzz, the required feature of the language system (its `ReqFeatureIndex`) applies whatever the `features` option, at every glyph, with the features of its tag when its tag is enabled, otherwise with `"rvrn"`. Not yet the other features HarfBuzz enables by default: the automatic fractions (`"numr"`, `"dnom"` and `"frac"` around U+2044 FRACTION SLASH), and the GSUB lookups of `"abvm"`, `"blwm"`, `"curs"`, `"dist"`, `"kern"` (with the `kerning` option), `"mark"` and `"mkmk"`, which HarfBuzz looks up in GSUB too (see the GPOS features below). The GSUB feature variations are the ones of the variation coordinates of the `variation` option, the current variation of the font without it.
The lookups of the features of each script, language, set of enabled features and GSUB feature variation are computed once for the GSUB and the GPOS tables of the font, then reused by the following calls: the methods of `font.substitution` and `font.position` that add a script, a language system, a feature or a lookup (`add`, `addSingle`, `addAlternate`, `addLigature`... and `getScriptTable`, `getLangSysTable`, `getFeatureTable`, `getLookupTables` with `create`) recompute them, and the substitutions added to a lookup apply at the next call; a table that replaces `font.tables.gsub` or `font.tables.gpos` has lookups of its own. A change made directly to the objects of these tables after a text was laid out (e.g. a feature tag, the `lookupListIndexes` of a feature, the `featureIndexes` of a language system) is not seen: make it before, or through these methods, or replace the table (`font.tables.gsub = Object.assign({}, font.tables.gsub)`), or parse the font with the option `layoutCache: false` (see `opentype.parse()`), which computes the lookups at every layout.
Like HarfBuzz, each GSUB lookup applies with its `lookupFlag`: the glyphs it ignores by their GDEF class (`IgnoreBaseGlyphs`, `IgnoreLigatures`, `IgnoreMarks`), their mark attachment class (`MarkAttachmentType`) or its mark filtering set (`UseMarkFilteringSet`) are skipped in the input, the backtrack and the lookahead of its contextual rules and between the components of its ligatures, where they stay after the ligature glyph, and the lookup does not apply at them. Without the glyph classes of GDEF no glyph is ignored, unlike HarfBuzz, which then takes the nonspacing marks of Unicode as marks; the same for the GPOS lookups (but the mark-to-base and mark-to-ligature attachments, see `Font.shape()`) and the `kern` table (see the `kerning` option). Like HarfBuzz, the GDEF table of a few fonts known to have wrong glyph classes (some versions of Times New Roman Italic, Tahoma, Courier New...), recognized by the lengths of their GDEF, GSUB and GPOS tables, is ignored by the layout (the GSUB and GPOS lookups and the kerning): `font.tables.gdef` still holds it, and `font.isGdefIgnoredByLayout` is true.
For Thai text, the same features are applied the same way, like the Thai shaper of HarfBuzz: `"rvrn"` first, then `"ccmp"`, `"locl"`, `"rlig"`, `"rclt"`, `"calt"`, `"liga"`, `"clig"`, `"rand"` and the direction features, their lookups together in lookup list order. For Arabic text, like the Arabic shaper of HarfBuzz, each stage after the one before it, the lookups of a stage together in lookup list order: `"rvrn"`, then the direction features of the run (`"rtla"` and `"rtlm"`) and `"rand"`, then `"ccmp"` and `"locl"`, then each form in a stage of its own (`"isol"`, `"fina"`, `"medi"`, then `"init"`), then `"rlig"`, then `"calt"`, then `"liga"`, `"clig"`, `"mset"`, `"rclt"` and the other features enabled by the `features` option (`"calt"` with them when the language system has `"rclt"`, like HarfBuzz; a direction feature of the other direction that the `features` option turns on is one of them). Like HarfBuzz, a form applies to the letters of the Arabic block that take it by their Unicode Joining_Type: a dual-joining or right-joining letter (the tatweel and the zero width joiner U+200D join as dual-joining ones) joins the dual-joining letter before it, a dual-joining letter joins the dual-joining or right-joining letter after it, the transparent characters between them skipped (the nonspacing and enclosing marks and the format characters, e.g. the harakat, U+0300, U+00AD SOFT HYPHEN, U+200F RIGHT-TO-LEFT MARK, U+2060 WORD JOINER, but the format characters that Unicode lists as non-joining), and the non-joining characters (e.g. the hamza, the digits, the spaces, U+0600 ARABIC NUMBER SIGN, the zero width non-joiner U+200C) take no form and break the joining. Not yet the `"stch"` of the Arabic shaper of HarfBuzz. The characters of no script in a Thai or Arabic run (digits, punctuation...) take the features of the run.
Like HarfBuzz, the lookups of a feature apply one after the other in lookup list order, each one once and at every glyph, and each glyph of a multiple substitution, applied by a lookup or by a lookup record of a contextual rule, is a glyph of its own for the following lookup records of the rule, whose sequence index counts it, and for the following lookups; after a contextual rule that matches, even one that substitutes nothing (e.g. an exception rule, `ignore sub`), the lookup goes on after the input glyphs of the rule. A lookup record of a contextual rule can also apply a ligature, whose components can be glyphs after the input of the rule: like HarfBuzz, the following lookup records of the rule count on an input that loses as many input glyphs after the ligature glyph as its other components, whichever glyphs these components were (e.g. after a ligature with a mark that the rule skips, the input glyph after the ligature glyph leaves the input), and the input never ends before the glyph the nested lookup applied at, so after a ligature that took glyphs past the input the lookup goes on at the ligature glyph. Like HarfBuzz, the lookup of a lookup record applies at its glyph even when its own `lookupFlag` ignores that glyph: its `lookupFlag` only selects the following components of a ligature. The Arabic forms (`"isol"`, `"fina"`, `"medi"`, `"init"`) apply the same way, like HarfBuzz with its form masks: each lookup of a form feature applies once, in lookup list order, over the glyphs of the whole Arabic run, its rules and ligatures starting at the glyphs of the letters that take the form only (each glyph of a multiple substitution of the letter included), the other glyphs being the context of its rules; so a lookup of a form sees the glyphs the lookups before it substituted, and after a contextual rule that matches it goes on after the input glyphs of the rule. Unlike HarfBuzz, whose form masks apply to every input glyph, the later input glyphs of a rule and the components of a ligature are not yet required to take the form (e.g. a ligature of `"init"` of a lam and the final alef after it forms). A required feature of the language system tagged as a form applies with the lookups of the form, in lookup list order, at every glyph, like HarfBuzz. Like the `max_len` of the buffer of each script run of a browser with HarfBuzz, the multiple substitutions can grow the glyphs of a script run up to 64 times its number of characters, at least 16384 glyphs: a GSUB lookup that would grow them past it leaves the glyphs, their clusters and their ligature components as they were before it, and no GSUB lookup applies to the rest of the run (e.g. in a broken font whose lookups double a glyph again and again); the other runs of the text have a maximum of their own. Not yet like HarfBuzz: the GPOS lookups of the run still apply after it, where HarfBuzz applies none; HarfBuzz keeps the changes the lookup made in place (e.g. a ligature of one of its contextual rules); and the maximum is exact, where HarfBuzz checks it only when its buffer has to grow, so that its glyphs can end past it (e.g. 16385 glyphs for `ab` where the lookups double `a` again and again, 8193 here).
For GPOS, like HarfBuzz, which looks each feature up in GSUB and in GPOS, the default GSUB features of the run above (e.g. the GPOS lookups of `"calt"`, `"liga"`, `"locl"` or `"rand"`, which `{ liga: false }` turns off with the GSUB ones) but the Arabic forms, the direction features of the script of the run, the same ones as in GSUB (`"rtla"` and `"rtlm"` in a run of a right-to-left script, `"ltra"` and `"ltrm"` in the other runs), and `"abvm"`, `"blwm"`, `"curs"`, `"dist"`, `"kern"` (with the `kerning` option), `"mark"` and `"mkmk"`, with the features the `features` option enables (e.g. `{ ss01: true }`), and the required feature of the GPOS language system (its `ReqFeatureIndex`) whatever the `features` option, their lookups together in lookup list order, each one once (see `Font.shape()`). The single adjustments (lookup type 1, e.g. of `"case"`, `"cpsp"`, `"palt"`, `"halt"` or `"vpal"`, which the `features` option enables, or of `"kern"`), the pair adjustments (lookup type 2), the cursive attachments (lookup type 3, e.g. of `"curs"`) and the mark attachments (lookup types 4, 5 and 6, e.g. of `"mark"` and `"mkmk"`) are applied: a mark, of the text or substituted by GSUB (e.g. the dot that `"ccmp"` or `"rclt"` decomposes an Arabic letter into), is drawn on its base at their GPOS anchors, and like HarfBuzz the advance of a GDEF mark is set to 0 in the runs of its default, Arabic, Hebrew, Thai, USE and Myanmar shapers (see `Font.shape()`). The contextual positionings (lookup types 7 and 8, e.g. the contextual kerning of `"kern"`, its exceptions in context, or the marks of `"mark"` placed in context) are applied too, with the lookups of their rules (see `Font.shape()`). Not yet the GPOS lookups of the Arabic forms (`"isol"`, `"init"`, `"medi"`, `"fina"`), which HarfBuzz applies at the glyphs of each form only: a form that the `features` option enables applies at every glyph, like a feature that the user of HarfBuzz enables. Not yet the GPOS feature variations.
* `variation`: variation coordinates (e.g. `{ wght: 700 }`) of the advances, of the GPOS values, of the GSUB feature variations (not yet the GPOS feature variations, see `Font.shape()`) and of the outlines drawn by `getPath`, `getPaths`, `draw` and `drawPoints`, the current variation of the font if omitted.
* `hinting`: if true uses TrueType font hinting if available (default: `false`).
* `colorFormat`: the format colors are converted to for rendering (default: `"hexa"`). Can be `"rgb"`/`"rgba"` for `rgb()`/`rgba()` output, `"hex"`/`"hexa"` for 6/8 digit hex colors, or `"hsl"`/`"hsla"` for `hsl()`/`hsla()` output. `"bgra"` outputs an object with r, g, b, a keys (r/g/b from 0-255, a from 0-1). `"raw"` outputs an integer as used in the CPAL table.
* `fill`: font color, the color used to render each glyph (default: `"black"`)

_**Note:** there is also `Font.getPaths()` with the same arguments, which returns a list of Paths._

#### `Font.draw(ctx, text, x, y, fontSize, options)`
Create a Path that represents the given text.
* `ctx`: A 2D drawing context, like Canvas.
* `x`: Horizontal position of the beginning of the text. (default: `0`)
* `y`: Vertical position of the *baseline* of the text. (default: `0`)
* `fontSize`: Size of the text in pixels (default: `72`).
* `options`: _{GlyphRenderOptions}_ passed to each glyph, see `Font.getPath()`

Options is an optional object containing:
* `kerning`: if `true`, takes kerning information into account (default: `true`)
* `features`: an object with [OpenType feature tags](https://docs.microsoft.com/en-us/typography/opentype/spec/featuretags) as keys, and a boolean or a number as value to enable or disable each feature over the default ones (e.g. `{ liga: false, ss01: true, cv01: 2 }`, a number being the alternate index of the alternate substitutions of the feature), in every script run, see `Font.getPath()`.
* `script`, `language`, `variation`: see `Font.getPath()`.
* `hinting`: if true uses TrueType font hinting if available (default: `false`).

#### `Font.drawPoints(ctx, text, x, y, fontSize, options)`
Draw the points of all glyphs in the text. On-curve points will be drawn in blue, off-curve points will be drawn in red. The arguments are the same as `Font.draw()`.

#### `Font.drawMetrics(ctx, text, x, y, fontSize, options)`
Draw lines indicating important font measurements for all glyphs in the text.
Black lines indicate the origin of the coordinate system (point 0,0).
Blue lines indicate the glyph bounding box.
Green line indicates the advance width of the glyph.

#### `Font.shape(text, options)`
Shape the text like `hb-shape` of HarfBuzz: its glyphs after the GSUB features, in visual order (the glyphs of `Font.stringToGlyphClusters()`), each one with its cluster and its position after the GPOS features, in font units, at the variation of the options (or of the font).
* `options`: (optional) the `features`, `kerning`, `script`, `language` and `variation` options of `Font.getPath()`.

Returns a list of `{ glyph, start, end, xAdvance, yAdvance, xOffset, yOffset }`:
* `glyph`: the Glyph object; `start`, `end`: the UTF-16 offsets of the characters of its cluster, `text.slice(start, end)` (see `Font.stringToGlyphClusters()`);
* `xAdvance`: how far the pen moves after the glyph: its advance width (with `HVAR` or the `gvar` phantom points of a variable font), plus the GPOS and `kern` table adjustments. Like HarfBuzz, the glyph of U+0020 that draws a space the font has not (see `Font.stringToGlyphs()`), and the glyphs the GSUB features replace it with but a ligature, take the advance of its kind of space before the GPOS and `kern` table adjustments: 1/2 em for U+2000 and U+2002, an em for U+2001, U+2003 and U+3000, 1/3, 1/4, 1/5, 1/6 and 1/16 em for U+2004, U+2005, U+2009, U+2006 and U+200A (rounded like HarfBuzz, e.g. 683 for 1/3 of 2048 units), 4/18 em (truncated) for U+205F, the advance of the first digit of the font for U+2007 FIGURE SPACE, of the period, or else of the comma, for U+2008 PUNCTUATION SPACE, half the advance of the glyph (truncated) for U+202F, and the advance of the glyph for U+00A0;
* `yAdvance`: how far the pen moves up after the glyph, `0` in horizontal text (the y advance of a GPOS value record is for vertical text, like HarfBuzz);
* `xOffset`, `yOffset`: where the glyph is drawn from the pen position, the y axis going up, like the `@x,y` offsets of `hb-shape`: a glyph attached to another one by GPOS (a mark on its base, a glyph of a cursive attachment) is drawn from its own pen position, after the advances of the glyphs before it, at the offset that puts it on its anchor.

Like HarfBuzz, each run of one script and one direction is positioned on its own: the lookups of its GPOS features (see the `features` option) and of the required feature of its GPOS language system for its script and language apply to its glyphs in the order of the text (the reverse of the visual order in a right-to-left run), in lookup list order, the extension lookups (type 9) included, each one from the first glyph of the run at each glyph its `lookupFlag` does not ignore. A single adjustment (lookup type 1) adjusts a glyph: in each lookup the first subtable that covers the glyph applies, its value record (format 1) or the value record of the glyph (format 2; a format 2 subtable with fewer value records than glyphs does not apply to the glyphs past them, like HarfBuzz) to the glyph, like the value records of a pair below. A pair adjustment (lookup type 2) adjusts a glyph and the next glyph its lookup does not ignore: in each lookup the first subtable that has the pair applies, its first value record to the first glyph and its second value record to the second glyph (the x placement to `xOffset`, the y placement to `yOffset`, the x advance to `xAdvance`, each one with the delta of its VariationIndex table in a variable font; the hinting deltas of a Device table are not applied, like HarfBuzz in font units); after a subtable with a second value record the lookup goes on after the second glyph, otherwise at the second glyph. The values of the lookups add up. The anchors of the attachments are their coordinates, with the deltas of the VariationIndex tables of an anchor of format 3 in a variable font (like HarfBuzz in font units: not its Device tables, nor the contour point of an anchor of format 2). A mark-to-base attachment (lookup type 4) attaches a mark to the glyph before it that is not a GDEF mark, whatever the `lookupFlag` of its lookup, like HarfBuzz: in each lookup the first subtable that covers both glyphs and has an anchor of the base for the class of the mark moves the mark so that its anchor is on the anchor of the base. A mark-to-ligature attachment (lookup type 5) attaches a mark the same way to a ligature, at the anchor of the component the mark follows: like HarfBuzz, a ligature substitution records the component of the ligature that each mark it skipped follows (and of the ligatures of ligatures, and for a mark of a multiple substitution the component its index in the substitution gives it), and a mark after a ligature attaches to its last component. Without the glyph classes of GDEF (see the `kerning` option), a mark-to-base or mark-to-ligature lookup with `IgnoreMarks`, a `MarkAttachmentType`, or `UseMarkFilteringSet` and a mark glyph set that does not cover the mark, takes every glyph its subtable covers as a mark and does not apply at it, like HarfBuzz for the glyphs of the nonspacing marks of Unicode (general category Mn), which it then takes as marks of no mark attachment class (a contextual rule that applies the lookup at the mark attaches it, see below); not yet like HarfBuzz, which takes the glyphs of the other characters as base glyphs, the glyph of a spacing character that the subtable covers as a mark (e.g. U+00B4 ACUTE ACCENT mapped to the glyph of U+0301) is not attached either, where HarfBuzz attaches it. Like HarfBuzz, a mark record without anchor (a NULL offset) has its anchor at 0 0. A mark-to-mark attachment (lookup type 6) attaches a mark to the glyph before it that the mark filtering set and the mark attachment type of its lookup do not skip, when that glyph is a GDEF mark of the same base (or of the same component of a ligature, or when one of them is itself a ligature: a glyph that a ligature substitution formed, not a ligature of marks only, which keeps the ligature properties of its first mark), like HarfBuzz. A cursive attachment (lookup type 3) joins the entry anchor of a glyph to the exit anchor of the glyph before it that its lookup does not ignore: the advance of the glyph that comes first in the text ends at its exit anchor (the glyph after it starts at its entry anchor in a right-to-left run), and across the line one glyph follows the y offset of the other one, the glyph before following the glyph after with the `RightToLeft` flag of its `lookupFlag` and the glyph after following the glyph before without it, like HarfBuzz (a chain of glyphs adds up its offsets over 64 glyphs at most, like HarfBuzz). After all the lookups, like HarfBuzz, the offsets of a glyph attached to another one follow the offsets of that glyph, and a mark moves back over the advances of the glyphs from its base to it (forward in a right-to-left run), so that it stays on its anchor whatever the kerning between them. A contextual positioning (lookup type 7, and the chained contextual positioning of lookup type 8, formats 1, 2 and 3) applies at a glyph the lookups of its first rule that matches there, like HarfBuzz: its rules are matched like the contextual substitutions of GSUB (the rules of the glyph in format 1, of its class in format 2, the coverage of each glyph in format 3), on the glyphs its `lookupFlag` does not ignore, the backtrack from the glyph before the input and the lookahead from the glyph after it; each lookup record of the rule, in order, applies its lookup at the input glyph of its sequence index (the glyphs the rule skips are not counted, a sequence index past the input applies nothing), with the `lookupFlag` of that lookup, even at a glyph that this `lookupFlag` ignores, like HarfBuzz: a pair adjustment pairs that glyph with the next glyph its lookup does not ignore, past the input too, a mark attachment attaches it as above (with or without the glyph classes of GDEF), and a contextual lookup applies its own rules there, its lookups nested up to 64 levels, and at most 1024 nested lookups by glyph of the run (16384 at least), like HarfBuzz (its `max_ops`), so that the lookups of a font that nest themselves several times end. A rule that matches ends the lookup at the glyph even without lookup records (the exceptions of a contextual kerning), and the lookup goes on after its input. Not yet like HarfBuzz: a mark after the second glyph of a multiple substitution attaches to that glyph when the subtable covers it, otherwise to nothing, where HarfBuzz attaches it to the first glyph of the substitution. When the `kern` feature is on and GPOS has no `kern` feature for the script and language, the `kern` table applies, like HarfBuzz: in visual order, each glyph kerned with the next glyph that is not a GDEF mark (a mark of the `GlyphClassDef` of GDEF, see the `kerning` option), half of the value of the pair (rounded down) added to the `xAdvance` of the first glyph and the rest to the `xAdvance` and the `xOffset` of the second one. Unlike HarfBuzz, which splits the value of a pair in each subtable on its own (each half rounded down), the values of a pair in several subtables are added up before the split: the glyphs are at the same positions and the pen ends at the same place, but their advances can differ by a few units from the ones of HarfBuzz (up to half the number of subtables with an odd value for the pair, e.g. 2 units with four subtables of -15). Like HarfBuzz, the `xAdvance` of a GDEF mark is set to 0 as the shaper HarfBuzz picks for the run, from its script and from the GSUB script it chose for it: after the GPOS lookups and the `kern` table with its default, Arabic, Hebrew and Thai shapers, before them (keeping their adjustments) with its USE shaper (the scripts of the Universal Shaping Engine, and an Indic script whose GSUB script is a tag of the third version, e.g. `dev3`) and its Myanmar shaper; never with its Indic shaper (an Indic script whose GSUB script is a tag of the first or second version, or none), its Khmer and its Hangul shapers. An Indic, USE or Myanmar run takes the default shaper when that GSUB script is `DFLT` or `latn` (or `mymr`, for Myanmar). Like HarfBuzz, without a GPOS table the `xOffset` of a mark of a left-to-right run moves back by the advance it loses. Not yet the fallback mark positioning of HarfBuzz: in a font without a GPOS table (e.g. a font with the `kern` table only, with or without GDEF), its default, Arabic and Hebrew shapers place each mark over or under its base, by the Unicode combining class of the mark and the extents of the glyphs, where the mark is drawn at the pen position. Not yet the default ignorables of HarfBuzz (e.g. U+200D ZERO WIDTH JOINER, U+00AD SOFT HYPHEN), which it skips in the GPOS and `kern` table pairs, in the backtrack, the input and the lookahead of the contextual rules of GPOS and GSUB, and when it looks for the base of a mark, and hides with an advance of 0: they are drawn with their glyph (`.notdef` without one) and their advance, no pair and no contextual rule matches across them (e.g. a contextual kerning or its exception across U+00AD), and a mark after one of them but U+200D (e.g. U+00AD, U+200C, U+034F) is not attached to the base before it. Not yet the composition of a letter and a combining mark into the precomposed glyph of the font (see the `kerning` option). The GPOS feature variations (the `FeatureVariations` of the GPOS table), which HarfBuzz applies at the variation like the GSUB ones, are not applied yet: the lookups of a GPOS feature are the ones of its `FeatureList` record at every variation.

#### `Font.forEachGlyph(text, x, y, fontSize, options, callback)`
Call `callback(glyph, glyphX, glyphY, fontSize, options)` for each glyph of the text shaped by `Font.shape()`, at its position scaled to the font size: `glyphX` is the pen position plus the `xOffset` of the glyph, `glyphY` the baseline `y` minus its `yOffset` (the y axis of the callback goes down, like a canvas); the pen then moves by the `xAdvance` of the glyph, and by the `letterSpacing` (in em) or `tracking` (in thousandths of an em) option. Returns the x of the pen after the last glyph. `Font.getPath()`, `Font.draw()`, `Font.getAdvanceWidth()`, `Font.drawPoints()` and `Font.drawMetrics()` lay out the text with it.

#### `Font.stringToGlyphs(string, options)`
Convert the string to a list of glyph objects.
Note that there is no strict 1-to-1 correspondence between the string and glyph list due to
possible substitutions such as ligatures. The list of returned glyphs can be larger or smaller than the length of the given string.
The glyphs are in visual order, like HarfBuzz: the glyphs of an Arabic text in reverse order, the glyphs of a multiple substitution included (e.g. a letter and the mark that `"ccmp"` decomposed it into, the mark first).
A character is mapped to the glyph of the cmap (see `Font.charToGlyph()`), with the fallbacks of HarfBuzz for a character the font has no glyph for: a space (U+00A0 NO-BREAK SPACE, U+2000 to U+200A, U+202F NARROW NO-BREAK SPACE, U+205F MEDIUM MATHEMATICAL SPACE, U+3000 IDEOGRAPHIC SPACE, not U+1680 OGHAM SPACE MARK) takes the glyph of U+0020 SPACE, with the advance of its kind of space in `Font.shape()`, and U+2011 NON-BREAKING HYPHEN the glyph of U+2010 HYPHEN; the GSUB features then apply to these glyphs. Other characters the font has not are drawn with `.notdef`, and so is a space or U+2011 followed by a variation selector (U+FE00 to U+FE0F, U+E0100 to U+E01EF) without a glyph for the variation sequence in the cmap, like HarfBuzz, which maps it to the glyph of the cmap without these fallbacks; a Mongolian free variation selector (U+180B to U+180D, U+180F) after it keeps the fallbacks, like HarfBuzz. Not yet like HarfBuzz, which first maps such a character to the glyphs of its canonical decomposition (e.g. U+2001 EM QUAD to the glyph of U+2003 EM SPACE), nor for a space followed by combining marks and then a variation selector, which HarfBuzz draws with `.notdef`.
* `options`: (optional) the `features`, `script`, `language` and `variation` of the GSUB features, see `Font.getPath()`.

#### `Font.stringToGlyphClusters(string, options)`
Convert the string to the list of glyph objects of `stringToGlyphs`, each one with the characters of the string it represents (its cluster), as `{ glyph, start, end }` where `string.slice(start, end)` are the characters of the glyph (UTF-16 offsets). Like the clusters of HarfBuzz (`--cluster-level=1`), a ligature represents all its component characters, and the glyphs between its components (e.g. the marks its lookup skips) are in its cluster; each glyph of a multiple substitution represents the characters of the glyph it replaces; a character with no glyph of its own (e.g. a variation selector) belongs to the glyph before it.
* `options`: (optional) the options of `Font.stringToGlyphs()`.

#### `Font.charToGlyph(char)`
Convert the character to a Glyph object. Returns `null` if the glyph could not be found. Note that this function assumes that there is a one-to-one mapping between the given character and a glyph; for complex scripts, this might not be the case.

#### `Font.getKerningValue(leftGlyph, rightGlyph, variation)`
Retrieve the value of the [kerning pair](https://en.wikipedia.org/wiki/Kerning) between the left glyph (or its index) and the right glyph (or its index). If no kerning pair is found, return `0`. The kerning value gets added to the advance width when calculating the spacing between glyphs.
* `variation`: (optional) variation coordinates for GPOS kerning (e.g. `{ wght: 700 }`), the current variation of the font if omitted.

The value is the one of the GPOS `kern` feature of the default language system of the script of the characters the cmap maps to the two glyphs, with the fallbacks of the `script` option. The script of a glyph is the Unicode script of its characters, none for characters of no script (Common, Inherited or Unknown, like digits and punctuation), and Latin for a glyph shared by characters of several scripts, a character of no script counting as one (like a micro sign that is also the Greek mu, or a schwa that is also the Cyrillic one). The pair takes the first of Thai, Arabic, Hebrew, Cyrillic and Greek that one of its glyphs has, otherwise its first script that is not Latin, otherwise Latin, with the OpenType tag of that script that GPOS has (see the `script` option: `"thai"`, `"arab"`, `"cham"`...), or `"DFLT"` when neither glyph has a script (e.g. digits, or glyphs no character maps to, like alternates), like HarfBuzz for a text of these characters; in a text two glyphs of two scripts are two script runs, which are not kerned together; the values of all its pair adjustment lookups (lookup type 2, see `getKerningTables`) are added up, in the order of the lookup list: its single adjustments (lookup type 1) and its contextual positionings (lookup types 7 and 8, e.g. a contextual kerning and its exceptions) are in the positions of `Font.shape()` only (and so of `Font.getAdvanceWidth()` and `Font.forEachGlyph()`). The pair is the left glyph then the right glyph: for a GPOS pair of right-to-left text, pass the glyphs in the order of the text. For another script or language, `font.position.getKerningValue(font.position.getKerningTables(script, language), leftIndex, rightIndex, variation)` gives the value: `getKerningTables` (default script `"latn"`, default language `"dflt"`, with the fallbacks of the `script` and `language` options) returns the kerning lookups (the pair adjustment lookups of the `kern` feature, without its contextual positionings), or `undefined` when GPOS has no `kern` feature for the script and language, which makes `getKerningValue` read the `kern` table. The `kern` table is used when GPOS has no `kern` feature for that script, like HarfBuzz, which kerns a glyph with the next glyph that is not a GDEF mark there: a pair whose right glyph is a GDEF mark gives `0`. The values of a pair in its horizontal format 0 subtables add up, like in HarfBuzz (its format 2 subtables are not read yet), a pair listed twice in a subtable keeps its first record, and a table with a subtable shorter than its header, or than its pairs when it is not the last one, gives no kerning, like in HarfBuzz.

A GPOS lookup whose `lookupFlag` ignores one of the two glyphs (e.g. a GDEF mark in a lookup with `IgnoreMarks`) adds nothing to the value of the pair: it is the value of the two glyphs next to each other. To kern the glyphs of a text across the glyphs a lookup ignores, like HarfBuzz, lay out the text (`Font.shape()`, `Font.forEachGlyph`, `Font.getAdvanceWidth`...). `font.position.getGlyphRunKerningValue(kerningLookups, glyphIndexes, position, variation)` gives the value of one glyph: each call applies the lookups to the run up to the glyph, so its cost grows with the position of the glyph, and `Font.shape()` positions all the glyphs of a text at once. It is the kerning value of the glyph at `position` in the run of glyph indexes `glyphIndexes` (in the order of the text), each lookup of `kerningLookups` (see `getKerningTables`) that does not ignore the glyph kerning it with the next glyph of the run that the lookup does not ignore; the value of the glyph is what the lookups add to its advance: the x advance of the first value record of its pairs and of the second value record of the pair it ends (after a pair with a second value record a lookup goes on after its second glyph, like HarfBuzz). Without lookups (`undefined`), the value of the `kern` table pair of the glyph and the next glyph that is not a GDEF mark, like HarfBuzz (`Font.shape()` splits it between the two glyphs, like HarfBuzz); like HarfBuzz, a pair of the `kern` table starts only at the first glyph of the run and at a glyph that is not a GDEF mark, so a GDEF mark after the first glyph gets `0`. A position outside the run gets `0`. The value of a GPOS pair given by `getKerningValue` is the x advance of its first value record: its placements and its second value record are in the positions of `Font.shape()`.

#### `Font.getAdvanceWidth(text, fontSize, options)`
Returns the advance width of a text.

This is something different than `Path.getBoundingBox()`; for example a
suffixed whitespace increases the advancewidth but not the bounding box
or an overhanging letter like a calligraphic 'f' might have a quite larger
bounding box than its advance width.

This corresponds to `canvas2dContext.measureText(text).width`
* `fontSize`: Size of the text in pixels (default: `72`).
* `options`: _{GlyphRenderOptions}_, see `Font.getPath()`

#### The `Font.palettes` object (`PaletteManager`)

This allows to manage the palettes and colors in the CPAL table, without having to modify the table manually.

###### `Font.palettes.add(colors)`
Add a new palette.
* `colors`: (optional) colors to add to the palette, differences to existing palettes will be filled with the defaultValue.

###### `Font.palettes.delete(paletteIndex)`
Deletes a palette by its zero-based index
* `paletteIndex`: zero-based palette index

###### `Font.palettes.deleteColor(colorIndex, replacementIndex)`
Deletes a specific color index in all palettes and updates all layers using that color with the color currently held in the replacement index
* `colorIndex`: index of the color that should be deleted
* `replacementIndex`: index (according to the palette before deletion) of the color to replace in layers using the color to be to deleted

###### `Font.palettes.cpal()`
Returns the font's cpal table, or false if it does not exist. Used internally.

###### `Font.palettes.ensureCPAL(colors)`
Mainly used internally. Makes sure that the CPAL table exists or is populated with default values.
* `colors`: (optional) colors to populate on creation
returns `true` if it was created, `false` if it already existed.

###### `Font.palettes.extend(num)`
Extend all existing palettes and the numPaletteEntries value by a number of color slots
* `num`: number of additional color slots to add to all palettes

###### `Font.palettes.fillPalette(palette, colors, colorCount)`
Fills a set of palette colors (from a palette index, or a provided array of CPAL color values) with a set of colors, falling back to the default color value, until a given count. *It does not modify the existing palette, returning a new array instead!* Use `Font.palettes.setColor()` instead if needed.
* `palette`: palette index or an Array of CPAL color values to fill the palette with, the rest will be filled with the default color
* `colors`: array of color values to fill the palette with, in a format supported as an output of `colorFormat` in _{GlyphRenderOptions}_, see `Font.getPath()`. CSS color names are also supported in browser context.
* `colorCount`: Number of colors to fill the palette with, defaults to the value of the numPaletteEntries field

###### `Font.palettes.getAll(colorFormat)`
Returns an array of arrays of color values for each palette, optionally in a specified color format
* `colorFormat`: (optional) See _{GlyphRenderOptions}_ at `Font.getPath()`, (default: `"hexa"`)

###### `Font.palettes.getColor(index, paletteIndex, colorFormat)`
Get a specific palette by its zero-based index
* `index`: zero-based index of the color in the palette
* `paletteIndex`: zero-based palette index (default: 0)
* `colorFormat`: (optional) See _{GlyphRenderOptions}_ at `Font.getPath()`, (default: `"hexa"`)

###### `Font.palettes.get(paletteIndex, colorFormat)`
Get a specific palette by its zero-based index
* `paletteIndex`: zero-based palette index
* `colorFormat`: (optional) See _{GlyphRenderOptions}_ at `Font.getPath()`, (default: `"hexa"`)

###### `Font.palettes.setColor(index, colors, paletteIndex)`
Set one or more colors on a specific palette by its zero-based index
* `index`: zero-based color index to start filling from
* `color`: color value or array of color values in a color notation supported as an output of `colorFormat` in _{GlyphRenderOptions}_, see `Font.getPath()`. CSS color names are also supported in browser context.
* `paletteIndex`: zero-based palette index (default: 0)

###### `Font.palettes.toCPALcolor(color)`
Converts a color value string to a CPAL integer color value
* `color`: string in a color notation supported as an output of `colorFormat` in _{GlyphRenderOptions}_, see `Font.getPath()`. CSS color names are also supported in browser context.


##### The `Font.layers` object (`LayerManager`)

This allows to manage the color glyph layers in the COLR table, without having to modify the table manually.

###### `Font.layers.add(glyphIndex, layers, position)`
Adds one or more layers to a glyph, at the end or at a specific position.
* `glyphIndex`: glyph index to add the layer(s) to.
* `layers`: layer object {glyph, paletteIndex}/{glyphID, paletteIndex} or array of layer objects.
* `position`: position to insert the layers at (will default to adding at the end).

###### `Font.layers.ensureCOLR()`
Mainly used internally. Ensures that the COLR table exists and is populated with default values.

###### `Font.layers.get(glyphIndex)`
Gets the layers for a specific glyph
* `glyphIndex`
Returns an array of `{glyph, paletteIndex}` layer objects.

###### `Font.layers.remove(glyphIndex, start, end = start)`
Removes one or more layers from a glyph.
* `glyphIndex`: glyph index to remove the layer(s) from
* `start`: index to remove the layer at
* `end`: (optional) if provided, removes all layers from start index to (and including) end index

###### `Font.layers.setPaletteIndex(glyphIndex, layerIndex, paletteIndex)`
Sets a color glyph layer's paletteIndex property to a new index
* `glyphIndex`: glyph in the font by zero-based glyph index
* `layerIndex`: layer in the glyph by zero-based layer index
* `paletteIndex`: new color to set for the layer by zero-based index in any palette

###### `Font.layers.updateColrTable(glyphIndex, layers)`
Mainly used internally. Updates the colr table, adding a baseGlyphRecord if needed, ensuring that it's inserted at the correct position, updating numLayers, and adjusting firstLayerIndex values for all baseGlyphRecords according to any deletions or insertions.


##### The `Font.variation` object (`VariationManager`)
The `VariationManager` handles variable font properties using the OpenType font variation tables.

###### `Font.variation.activateDefaultVariation()`
Activates the default variation by setting its variation data as the font's default render options. Uses the default instance if available; otherwise, it defaults to the coordinates of all axes.
 
###### `Font.variation.getDefaultCoordinates()`
Returns the default coordinates for the font's variation axes.
* Returns: An object mapping axis tags to their default values.

###### `Font.variation.getDefaultInstanceIndex()`
Determines and returns the index of the default variation instance. Returns `-1` if it cannot be determined.
* Returns: Integer representing the default instance index or `-1`.

###### `Font.variation.getTransform(glyph, coords)`
Just a shortcut for [`Font.variation.process.getTransform()`](#fontvariationprocessgettransformglyph-coords).

###### `Font.variation.getInstanceIndex(coordinates)`
Finds the index of the variation instance that matches the provided coordinates, or `-1` if none match.
* `coordinates`: Object with axis tags as keys and variation values as corresponding values.
* Returns: Integer of the matching instance index or `-1`.

###### `Font.variation.getInstance(index)`
Retrieves a specific variation instance by its zero-based index.
* `index`: Zero-based index of the variation instance.
* Returns: Object representing the variation instance, or `null` if the index is invalid.

###### `Font.variation.set(instanceIdOrObject)`
Sets the variation coordinates to be used by default for rendering in the font's default render options.
* `instanceIdOrObject`: Either the zero-based index of a variation instance or an object mapping axis tags to variation values.

###### `Font.variation.get()`
Gets the current variation settings from the font's default render options.
* Returns: Object with the current variation settings.

###### `Font.variation.getMetricAdjustment(tag, coords)`
Just a shortcut for [`Font.variation.process.getMetricAdjustment()`](#fontvariationprocessgetmetricadjustmenttag-coords).

###### `Font.variation.getAdvanceWidth(glyph, coords)`
Returns the advance width of a glyph at the given variation coordinates, without modifying the glyph: from the `HVAR` table when the font has one, otherwise from the `gvar` phantom points, never below 0, like HarfBuzz.
* `glyph`: Glyph or index of glyph.
* `coords`: Variation coords object (or the variation coords in the font's `defaultRenderOptions` by default)
* Returns: Advance width in font units.

###### `Font.variation.getLeftSideBearing(glyph, coords)`
Returns the left side bearing of a glyph at the given variation coordinates, without modifying the glyph: from the LSB map of the `HVAR` table when it has one, otherwise in a `gvar` font from the varied outline and the varied left phantom point, otherwise the one of `hmtx`.
* `glyph`: Glyph or index of glyph.
* `coords`: Variation coords object (or the variation coords in the font's `defaultRenderOptions` by default)
* Returns: Left side bearing in font units.


##### The `Font.variation.process` object (`VariationProcessor`)
The `VariationProcessor` is a component of the `VariationManager`, used mainly internally for computing and applying variations to the glyphs in a variable font. It handles transformations and adjustments based on the font's variable axes and instances.

###### `Font.variation.process.getNormalizedCoords(coords)`
Returns normalized coordinates for the variation axes based on the current settings, with the precision and rounding requirements of the OpenType normalization (steps 1 to 5, on the user value as given): each value is converted to 16.16, clamped to the range of its axis (a value out of the range gives the coordinate of the minimum or of the maximum), normalized to -1..0..1 in 16.16, mapped through the `avar` table in 16.16 and converted once to F2Dot14 (add 2, shift right by 2). A missing axis gets its default value. Like HarfBuzz, the `avar` result is not clamped to -1..1 and a segment map lacking its -1, 0 or 1 entry is applied all the same (the specification clamps, and leaves such an axis unmapped), so only a malformed map gives a value out of -1..1. HarfBuzz also normalizes in 16.16 and converts once to F2Dot14, but it reads the user value as a 32-bit float, so at some user values the two differ by 1/16384 (for example a `wght` of 650.316615 on 100..400..900 gives 8203/16384 here and 8202/16384 in HarfBuzz).
* `coords`: The coordinates object to normalize (or the variation coords in the font's `defaultRenderOptions` by default)
* Returns: Array of the normalized coordinates, in the order of the axes of the `fvar` table.

###### `Font.variation.process.interpolatePoints(points, deltas, scalar)`
Interpolates points based on provided deltas and a scalar value.
* `points`: Array of original points.
* `deltas`: Array of point deltas.
* `scalar`: Scalar value for interpolation.
* Returns: Array of interpolated points.

###### `Font.variation.process.deltaInterpolate(original, deltaValues, scalar)`
Calculates the interpolated value for a single point given original values, deltas, and a scalar.
* `original`: Original value of the point.
* `deltaValues`: Array of delta values for the point.
* `scalar`: Scalar value for interpolation.
* Returns: Interpolated value.

###### `Font.variation.process.deltaShift(points, deltas)`
Applies delta values to shift points.
* `points`: Array of original points.
* `deltas`: Array of deltas to apply.
* Returns: Array of shifted points.

###### `Font.variation.process.transformComponents(components, transformation)`
Transforms components of a glyph using a specified transformation matrix.
* `components`: Components of the glyph.
* `transformation`: Transformation matrix to apply.
* Returns: Transformed components.

###### `Font.variation.process.getTransform(glyph, coords)`
Retrieves a transformed copy of a glyph based on the provided variation coordinates: its varied outline (the deltas of all the active `gvar` tuples added up and rounded once) and, in a font with `HVAR` or `gvar`, its varied `advanceWidth` and `leftSideBearing`, also for a glyph without points. Returns the glyph itself when the font varies neither its outline nor its metrics.
* `glyph`: Glyph or index of glyph to transform.
* `coords`: Variation coords object (or the variation coords in the font's `defaultRenderOptions` by default)
* Returns: `opentype.Glyph`

###### `Font.variation.process.getVariableAdjustment(adjustment)`
Calculates the variable adjustment for a given adjustment parameter.
* `adjustment`: Adjustment parameter.
* Returns: Adjusted value based on current variation settings.

###### `Font.variation.process.getMetricAdjustment(tag, coords)`
Calculates the variation adjustment of a font-wide metric from the MVAR table, by its value tag (e.g. `'hcrs'` and `'hcrn'`, the caret slope rise and run of the hhea table, or `'xhgt'`, the x-height of the OS/2 table): the value to add to the one of the metric in its table, not rounded.
* `tag`: Value tag of the metric.
* `coords`: Variation coords object (or the variation coords in the font's `defaultRenderOptions` by default)
* Returns: The adjustment, or `0` when the font does not vary the metric.

###### `Font.variation.process.getDelta(deltas)`
Selects the appropriate delta values from a collection of deltas based on the current variation settings.
* `deltas`: Collection of delta values.
* Returns: Appropriate delta values for the current settings.

###### `Font.variation.process.getBlendVector()`
Computes the blend vector for interpolations based on the current settings.
* Returns: Blend vector used for interpolation calculations.


#### The Glyph object
A Glyph is an individual mark that often corresponds to a character. Some glyphs, such as ligatures, are a combination of many characters. Glyphs are the basic building blocks of a font.

* `font`: A reference to the Font object.
* `name`: The glyph name (e.g. `"Aring"`, `"five"`)
* `unicode`: The primary unicode value of this glyph (can be `undefined`).
* `unicodes`: The list of unicode values for this glyph (most of the time this will be `1`, can also be empty).
* `index`: The index number of the glyph.
* `advanceWidth`: The width to advance the pen when drawing this glyph.
* `leftSideBearing`: The horizontal distance from the previous character to the origin (`0, 0`); a negative value indicates an overhang
* `xMin`, `yMin`, `xMax`, `yMax`: The bounding box of the glyph.
* `path`: The raw, unscaled path of the glyph.

##### `Glyph.getPath(x, y, fontSize, options, font)`
Get a scaled glyph Path object for use on a drawing context.
* `x`: Horizontal position of the glyph. (default: `0`)
* `y`: Vertical position of the *baseline* of the glyph. (default: `0`)
* `fontSize`: Font size in pixels (default: `72`).
* `options`: _{GlyphRenderOptions}_, see `Font.getPath()`
* `font`: a font object, needed for rendering COLR/CPAL fonts to get the layers and colors

##### `Glyph.getBoundingBox()`
Calculate the minimum bounding box for the unscaled path of the given glyph. Returns an `opentype.BoundingBox` object that contains `x1`/`y1`/`x2`/`y2`.
If the glyph has no points (e.g. a space character), all coordinates will be zero.

##### `Glyph.draw(ctx, x, y, fontSize, options, font)`
Draw the glyph on the given context.
* `ctx`: The drawing context.
* `x`: Horizontal position of the glyph. (default: `0`)
* `y`: Vertical position of the *baseline* of the glyph. (default: `0`)
* `fontSize`: Font size, in pixels (default: `72`).
* `options`: _{GlyphRenderOptions}_, see `Font.getPath()`
* `font`: a font object, needed for rendering COLR/CPAL fonts to get the layers and colors

##### `Glyph.drawPoints(ctx, x, y, fontSize, options, font)`
Draw the points of the glyph on the given context.
On-curve points will be drawn in blue, off-curve points will be drawn in red.
The arguments are the same as `Glyph.draw()`.

##### `Glyph.drawMetrics(ctx, x, y, fontSize)`
Draw lines indicating important font measurements for all glyphs in the text.
Black lines indicate the origin of the coordinate system (point 0,0).
Blue lines indicate the glyph bounding box.
Green line indicates the advance width of the glyph.
The arguments are the same as `Glyph.draw()`.

##### `Glyph.toPathData(options)`, `Glyph.toDOMElement(options)`, `Glyph.toSVG(options)`, `Glyph.fromSVG(pathData, options)`,
These are currently only wrapper functions for their counterparts on Path objects (see documentation there), but may be extended in the future to pass on Glyph data for automatic calculation.

##### `Glyph.getLayers(font)`
Gets the color glyph layers for this glyph from the specified font's COLR/CPAL tables

### The Path object
Once you have a path through `Font.getPath()` or `Glyph.getPath()`, you can use it.

* `commands`: The path commands. Each command is a dictionary containing a type and coordinates. See below for examples.
* `fill`: The fill color of the Path. Color is a string representing a [CSS color](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value). (default: `'black'`)
* `stroke`: The stroke color of the `Path`. Color is a string representing a [CSS color](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value). (default: `null`; the path will not be stroked)
* `strokeWidth`: The line thickness of the `Path`. (default: `1`, but if `stroke` is `null` no stroke will be drawn)

##### `Path.draw(ctx)`
Draw the path on the given 2D context. This uses the `fill`, `stroke`, and `strokeWidth` properties of the Path object.
* `ctx`: The drawing context.

##### `Path.getBoundingBox()`
Calculate the minimum bounding box for the given path. Returns an `opentype.BoundingBox` object that contains `x1`/`y1`/`x2`/`y2`.
If the path is empty (e.g. a space character), all coordinates will be zero.

##### `Path.toPathData(options)`
Convert the Path to a string of path data instructions.
See https://www.w3.org/TR/SVG/paths.html#PathData
* `options`:
  * `decimalPlaces`: The amount of decimal places for floating-point values. (default: `2`)
  * `optimize`: apply some optimizations to the path data, e.g. removing unnecessary/duplicate commands (true/false, default: `true`)
  * `flipY`: whether to flip the Y axis of the path data, because SVG and font paths use inverted Y axes. (`true`: calculate from bounding box, `false`: disable; default: `true`)
  * `flipYBase`: Base value for the base flipping calculation. You'll probably want to calculate this from the font's ascender and descender values. (default: automatically calculate from the path data's bounding box)


##### `Path.toSVG(options)`
Convert the path to an SVG `<path>` element, as a string.
* `options`: see `Path.toPathData()`

##### `Path.fromSVG(pathData, options)`
Retrieve path from SVG path data. 

Either overwriting the path data for an existing path:
```js
const path = new Path();
path.fromSVG('M0 0');
```
Or creating a new Path directly:
```js
const path = Path.fromSVG('M0 0');
```
* `pathData`: Either a string of SVG path commands, or (only in browser context) an `SVGPathElement`
* `options`:
  * `decimalPlaces`, `optimize`, `flipY`, `flipYBase`: see `Path.toPathData()`
  * `scale`: scaling value applied to all command coordinates (default: `1`)
  * `x`/`y`: offset applied to all command coordinates on the x or y axis (default: `0`)

#### Path commands
* **Move To**: Move to a new position. This creates a new contour. Example: `{type: 'M', x: 100, y: 200}`
* **Line To**: Draw a line from the previous position to the given coordinate. Example: `{type: 'L', x: 100, y: 200}`
* **Curve To**: Draw a bézier curve from the current position to the given coordinate. Example: `{type: 'C', x1: 0, y1: 50, x2: 100, y2: 200, x: 100, y: 200}`
* **Quad To**: Draw a quadratic bézier curve from the current position to the given coordinate. Example: `{type: 'Q', x1: 0, y1: 50, x: 100, y: 200}`
* **Close**: Close the path. If stroked, this will draw a line from the first to the last point of the contour. Example: `{type: 'Z'}`


## Versioning

We use [SemVer](https://semver.org/) for versioning.

## License

MIT


Thanks
======
We would like to acknowledge the work of others without which opentype.js wouldn't be possible:

* [pdf.js](https://mozilla.github.io/pdf.js/): for an awesome implementation of font parsing in the browser.
* [FreeType](https://www.freetype.org/): for the nitty-gritty details and filling in the gaps when the spec was incomplete.
* [ttf.js](https://ynakajima.github.io/ttf.js/demo/glyflist/): for hints about the TrueType parsing code.
* [CFF-glyphlet-fonts](https://pomax.github.io/CFF-glyphlet-fonts/): for a great explanation/implementation of CFF font writing.
* [fontkit](https://github.com/foliojs/fontkit/): for a great implementation of CFF2 parsing and variable font features
* [tiny-inflate](https://github.com/foliojs/tiny-inflate): for WOFF decompression.
* [Microsoft Typography](https://docs.microsoft.com/en-us/typography/opentype/spec/otff): the go-to reference for all things OpenType.
* [Adobe Compact Font Format spec](http://download.microsoft.com/download/8/0/1/801a191c-029d-4af3-9642-555f6fe514ee/cff.pdf) and the [Adobe Type 2 Charstring spec](http://download.microsoft.com/download/8/0/1/801a191c-029d-4af3-9642-555f6fe514ee/type2.pdf): explains the data structures and commands for the CFF glyph format.
* All [contributors](https://github.com/opentypejs/opentype.js/graphs/contributors).
