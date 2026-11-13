# Regression fixtures

The fonts of the specs of `test/regression/`: subsets of freely licensed fonts, and fonts generated for the tests. The reference values of the specs are measured on these files with hb-shape (HarfBuzz 11.3.2) and fontTools.

- The license of each file is in `test/fonts/LICENSE` (entries `regression/...`). A new fixture needs its entry there, and its section here.
- A subset is a Modified Version under the SIL Open Font License: when the license of the source declares a Reserved Font Name and the font uses it in its name, the subset is renamed with `test/rename-reserved-font-name.py` (files `Test...-subset.otf`), which does not write the font when one of its font names still has a reserved word given with `--reserved`.

## How to rebuild a fixture

Each section below has the commands that rebuild its file. They run from the root of the repository, with fontTools 4.63.0 (`python -m fontTools.subset`) and HarfBuzz 11.3.2 (`hb-subset`). The sources are downloaded to `download/`, a folder that is not committed and that git does not ignore: delete it after the rebuild (`rm -r download`), or download outside the repository (replace `download/` in the commands with a folder outside it), so that the full sources are never committed.

```sh
mkdir -p download
```

With these versions, and a download that has the sha256 of its section, each recipe gives the committed file byte for byte: after a rebuild `git diff` is empty. The URLs of google/fonts and adobe-fonts are pinned to the commit whose file has the sha256 of the section, so they keep giving the same file when the branch of the repository moves on: a download with another sha256 is another version of the font, and its subset differs.

`fontTools.subset` and `hb-subset` keep the dates of the source. fontTools sets `head.modified` to the time of the build when a font is saved by a script (`test/rename-reserved-font-name.py`, the correction of the names of Noto Sans JP): those recipes set `SOURCE_DATE_EPOCH` to the `head.modified` of the committed file. Without it the result differs in the `head` table only (`modified` and `checkSumAdjustment`).

## EBGaramond-VF-kern-subset.ttf

- Source: EB Garamond, variable (wght), `Version 1.003`
- URL: https://raw.githubusercontent.com/google/fonts/f8c1d3d6cc75e30d77130bdcbfbff27e3b6233fe/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf
- sha256 of the download: `ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027`
- Used by: `kerningExtensionLookups.spec.mjs` (GPOS kerning in an Extension lookup next to a plain Pair Adjustment lookup, upstream issue #515) and `helpers.spec.mjs`

```sh
curl -sSL -o download/EBGaramond-wght.ttf 'https://raw.githubusercontent.com/google/fonts/f8c1d3d6cc75e30d77130bdcbfbff27e3b6233fe/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf'
python -m fontTools.subset download/EBGaramond-wght.ttf \
    --unicodes=U+0041,U+0056,U+0054,U+006F,U+0079,U+004C,U+0050,U+002E,U+002C,U+0058,U+002D,U+0067,U+006A,U+003A \
    --glyphs=a.01 --layout-features='*' --no-layout-closure --no-hinting \
    --name-IDs=0,1,2,3,4,5,6,13,14 --notdef-outline \
    --output-file=test/fonts/regression/EBGaramond-VF-kern-subset.ttf
```

`--glyphs=a.01` keeps a glyph that is not in the cmap: the plain Pair Adjustment lookup of the kern feature kerns only period and comma before it, and is left without values when the glyph is not in the subset.

## NotoSans-VF-composite-diacritics-subset.ttf

- Source: Noto Sans, variable (wdth, wght), `Version 2.015`
- URL: https://raw.githubusercontent.com/google/fonts/2984c575fdce412ee02b2baaba67672b9a9434d8/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf
- sha256 of the download: `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`
- Used by: `compositeDiacritics.spec.mjs` (gvar deltas of the component offsets of composite glyphs, upstream issue #783)

```sh
curl -sSL -o download/NotoSans-wdth-wght.ttf 'https://raw.githubusercontent.com/google/fonts/2984c575fdce412ee02b2baaba67672b9a9434d8/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf'
hb-subset download/NotoSans-wdth-wght.ttf \
    --unicodes=U+00C1,U+00E4,U+00E7,U+00F6,U+0160 \
    --layout-features='*' --name-IDs='*' --glyph-names \
    --output-file=test/fonts/regression/NotoSans-VF-composite-diacritics-subset.ttf
```

## NotoSansJP-Regular-astral-subset.ttf

- Source: Noto Sans JP, variable (wght), `Version 2.004-H2;hotconv 1.0.118;makeotfexe 2.5.65603`
- URL: https://raw.githubusercontent.com/google/fonts/295d98a7a0c17c68f1341eaeea354e7960ea70d3/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf
- sha256 of the download: `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f`
- Used by: `surrogatePairClusters.spec.mjs` (clusters of characters outside the BMP and of variation sequences: cmap formats 12 and 14)

```sh
curl -sSL -o download/NotoSansJP-wght.ttf 'https://raw.githubusercontent.com/google/fonts/295d98a7a0c17c68f1341eaeea354e7960ea70d3/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf'
hb-subset download/NotoSansJP-wght.ttf \
    --unicodes=20,61,62,66,69,AD,E1,301,2000B,29E3D,242EE,1F21A,FE00,E0100,E0101 \
    --layout-features='*' --variations=wght=400 --no-hinting --name-IDs='*' --glyph-names \
    --output-file=download/NotoSansJP-Regular-astral-subset.ttf
SOURCE_DATE_EPOCH=1794406866 python -c "
from fontTools.ttLib import TTFont
font = TTFont('download/NotoSansJP-Regular-astral-subset.ttf')
names = font['name']
unique_identifier = names.getDebugName(3).replace('NotoSansJP-Thin', 'NotoSansJP-Regular')
for name_id, text in {1: 'Noto Sans JP', 2: 'Regular', 3: unique_identifier, 4: 'Noto Sans JP Regular', 6: 'NotoSansJP-Regular'}.items():
    names.setName(text, name_id, 3, 1, 0x409)
names.removeNames(nameID=16)
names.removeNames(nameID=17)
font.save('test/fonts/regression/NotoSansJP-Regular-astral-subset.ttf')
"
```

`hb-subset` pins the font at wght 400 and keeps the names of the default instance of the source (Thin): the python step writes the names of the Regular. The Reserved Font Name of the license ('Source') is not in the name of the font, which is not renamed.

## NotoSansMasaramGondi-Regular-dist-subset.ttf

- Source: Noto Sans Masaram Gondi, `Version 1.004; ttfautohint (v1.8.4.7-5d5b)`
- URL: https://raw.githubusercontent.com/google/fonts/b8db033c59419d257ba710f6eba0e0089879feea/ofl/notosansmasaramgondi/NotoSansMasaramGondi-Regular.ttf
- sha256 of the download: `a606b4b22cc4e562473c6defc9c57b6455dd7163c87ce6e657a3cd0c5060c214`
- Used by: `masaramGondiDistances.spec.mjs` (the GPOS dist feature of a script without a kern feature, positioned by `Font.shape`)

```sh
curl -sSL -o download/NotoSansMasaramGondi-Regular.ttf 'https://raw.githubusercontent.com/google/fonts/b8db033c59419d257ba710f6eba0e0089879feea/ofl/notosansmasaramgondi/NotoSansMasaramGondi-Regular.ttf'
hb-subset download/NotoSansMasaramGondi-Regular.ttf \
    --unicodes=U+11D10,U+11D11 \
    --layout-features='*' --name-IDs='*' --glyph-names \
    --output-file=test/fonts/regression/NotoSansMasaramGondi-Regular-dist-subset.ttf
```

## NotoSansModi-Regular-kern-subset.ttf

- Source: Noto Sans Modi, `Version 2.004; ttfautohint (v1.8.4.7-5d5b)`
- URL: https://raw.githubusercontent.com/google/fonts/b8db033c59419d257ba710f6eba0e0089879feea/ofl/notosansmodi/NotoSansModi-Regular.ttf
- sha256 of the download: `df1b8c6736fde0e7d8838370b336e4b22f84b465c81c817a8eceaab5d41ff33f`
- Used by: `pairPositioningValueRecords.spec.mjs` (GPOS pair adjustments with a second value record, x placement and x advance, of `Font.shape`)

```sh
curl -sSL -o download/NotoSansModi-Regular.ttf 'https://raw.githubusercontent.com/google/fonts/b8db033c59419d257ba710f6eba0e0089879feea/ofl/notosansmodi/NotoSansModi-Regular.ttf'
hb-subset download/NotoSansModi-Regular.ttf \
    --unicodes=U+11615,U+11621,U+11631,U+11632 \
    --layout-features='*' --name-IDs='*' --glyph-names \
    --output-file=test/fonts/regression/NotoSansModi-Regular-kern-subset.ttf
```

## NotoSansThaiLooped-VF-gsub-chaining-subset.ttf

- Source: Noto Sans Thai Looped, variable (wdth, wght), `Version 2.000`
- URL: https://raw.githubusercontent.com/google/fonts/e1652b5bc0a863e8a239f0a1bf19d07d816e85e5/ofl/notosansthailooped/NotoSansThaiLooped%5Bwdth%2Cwght%5D.ttf
- sha256 of the download: `a6d220ea215bc2c4bfcd5c5efc4103e20302443f87f6dca7a9ce733a11f2cfbd`
- Used by: `robotoGsubChaining.spec.mjs` (GSUB chaining context format 3 with a nested Single substitution format 1, upstream issue #860 and PR #870) and `test/position.spec.mjs` (the GPOS mark attachments, with the variation deltas of their anchors)

```sh
curl -sSL -o download/NotoSansThaiLooped-wdth-wght.ttf 'https://raw.githubusercontent.com/google/fonts/e1652b5bc0a863e8a239f0a1bf19d07d816e85e5/ofl/notosansthailooped/NotoSansThaiLooped%5Bwdth%2Cwght%5D.ttf'
python -m fontTools.subset download/NotoSansThaiLooped-wdth-wght.ttf \
    --unicodes=U+0E01,U+0E2C,U+0E34,U+0E38,U+0E49 \
    --layout-features='*' --name-IDs='*' --notdef-outline --no-hinting \
    --output-file=test/fonts/regression/NotoSansThaiLooped-VF-gsub-chaining-subset.ttf
```

## Pacifico-Regular-calt-kern-subset.ttf

- Source: Pacifico Regular, `Version 3.001`
- URL: https://raw.githubusercontent.com/google/fonts/34ce35e2b6d7a1467c0ecfd9cd13082a87ffd23e/ofl/pacifico/Pacifico-Regular.ttf
- sha256 of the download: `5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701`
- Used by: `pacificoContextualAlternates.spec.mjs` (final forms of the calt feature and GPOS pair kerning, upstream issues #372 and #253) and `test/position.spec.mjs` (a GPOS mark attachment)

```sh
curl -sSL -o download/Pacifico-Regular.ttf 'https://raw.githubusercontent.com/google/fonts/34ce35e2b6d7a1467c0ecfd9cd13082a87ffd23e/ofl/pacifico/Pacifico-Regular.ttf'
python -m fontTools.subset download/Pacifico-Regular.ttf \
    --text='nn n Hello Pacifico os off a,b (H)' --unicodes=U+0301 \
    --layout-features='*' --no-hinting --glyph-names --notdef-outline \
    --name-IDs=0,1,2,3,4,5,6,13,14 \
    --output-file=test/fonts/regression/Pacifico-Regular-calt-kern-subset.ttf
```

## PlaywriteUSTrad-VF-calt-subset.ttf

- Source: Playwrite US Trad, variable (wght), `Version 1.003`
- URL: https://raw.githubusercontent.com/google/fonts/7f36bed59352c1b52752f8fbbcd6da7643f5b02c/ofl/playwriteustrad/PlaywriteUSTrad%5Bwght%5D.ttf
- sha256 of the download: `6f2b0ba3c262a4d23bc06ea78ff5eccd45ebf324635d81bac25165eb2a2f1960`
- Used by: `playwriteCursive.spec.mjs` (calt of a connected cursive font, upstream PR #848 and issue #801) and `test/position.spec.mjs` (a GPOS mark attachment after a connector of calt)

```sh
curl -sSL -o download/PlaywriteUSTrad-wght.ttf 'https://raw.githubusercontent.com/google/fonts/7f36bed59352c1b52752f8fbbcd6da7643f5b02c/ofl/playwriteustrad/PlaywriteUSTrad%5Bwght%5D.ttf'
hb-subset download/PlaywriteUSTrad-wght.ttf \
    --unicodes=2E,37,50,65,68,69,6C,6D,6E,6F,75,77,E9 \
    --gids=0,70,79,278,419,556,558,588,590,591,614,616,617,654,657,807,808,809,810,839,840,884,907,908,936,937,938,944,946,948,956,957,958,959,960,961,962,964,966,1010,1012,1207 \
    --no-layout-closure --layout-features='*' --glyph-names \
    --name-IDs=0,1,2,3,4,5,6,13,14 \
    --output-file=test/fonts/regression/PlaywriteUSTrad-VF-calt-subset.ttf
```

The glyph ids are .notdef and the glyphs of the buffers of `hb-shape --trace` (the glyphs of the cmap, of each GSUB lookup and of the result) for the texts `hello`, `minimum`, `Phone`, `who`, `élu` and `7.`, with and without calt, at wght 400 and 100. The layout closure of the characters keeps 165 glyphs (48 KB) instead of 46 (17 KB).

## ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf

- Source: Readex Pro, variable (HEXP, wght), `Version 1.205`
- URL: https://raw.githubusercontent.com/google/fonts/d81dbc630ed0e3cfd8d1af36893674157c2e6b88/ofl/readexpro/ReadexPro%5BHEXP%2Cwght%5D.ttf
- sha256 of the download: `268bba7e1e8f3b14d798b3fb0e40ebaa3fc39308c9ac0020e2faf6df181cc30e`
- Used by: `readexProVariable.spec.mjs` (the subset below without HVAR: the advance widths vary through the gvar phantom points, upstream issue #754)

```sh
curl -sSL -o download/ReadexPro-HEXP-wght.ttf 'https://raw.githubusercontent.com/google/fonts/d81dbc630ed0e3cfd8d1af36893674157c2e6b88/ofl/readexpro/ReadexPro%5BHEXP%2Cwght%5D.ttf'
python -m fontTools.subset download/ReadexPro-HEXP-wght.ttf \
    --unicodes=U+0020,U+0048,U+0065,U+0069,U+006C,U+006F,U+013A,U+066A \
    --layout-features='*' --glyph-names --notdef-outline --name-IDs='*' --name-languages='*' \
    --drop-tables+=HVAR \
    --output-file=test/fonts/regression/ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf
```

The Reserved Font Name of the license ('RevReading Lexend') is not in the name of the font, which is not renamed.

## ReadexPro-VF-gvar-shared-points-subset.ttf

- Source: Readex Pro, variable (HEXP, wght), `Version 1.205`
- URL: https://raw.githubusercontent.com/google/fonts/d81dbc630ed0e3cfd8d1af36893674157c2e6b88/ofl/readexpro/ReadexPro%5BHEXP%2Cwght%5D.ttf
- sha256 of the download: `268bba7e1e8f3b14d798b3fb0e40ebaa3fc39308c9ac0020e2faf6df181cc30e`
- Used by: `readexProVariable.spec.mjs` (gvar tuples with private point numbers for all points in a glyph that has shared point numbers, upstream issue #754)

```sh
curl -sSL -o download/ReadexPro-HEXP-wght.ttf 'https://raw.githubusercontent.com/google/fonts/d81dbc630ed0e3cfd8d1af36893674157c2e6b88/ofl/readexpro/ReadexPro%5BHEXP%2Cwght%5D.ttf'
python -m fontTools.subset download/ReadexPro-HEXP-wght.ttf \
    --unicodes=U+0020,U+0048,U+0065,U+0069,U+006C,U+006F,U+013A,U+066A \
    --layout-features='*' --glyph-names --notdef-outline --name-IDs='*' --name-languages='*' \
    --output-file=test/fonts/regression/ReadexPro-VF-gvar-shared-points-subset.ttf
```

The Reserved Font Name of the license ('RevReading Lexend') is not in the name of the font, which is not renamed.

## Roboto-VF-gsub-chaining-subset.ttf

- Source: Roboto, variable (wdth, wght), `Version 3.015; 2026`
- URL: https://raw.githubusercontent.com/google/fonts/6183fc0d26361f6ddfd6f6b7a736e1467c6d8a43/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf
- sha256 of the download: `d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134`
- Used by: `robotoGsubChaining.spec.mjs` (GSUB chaining context formats 2 and 3, upstream PRs #816 and #861, issue #874, and the GPOS mark attachment of an acute on the dotless j) and `test/position.spec.mjs` (the GPOS mark attachments, with the variation deltas of their anchors)

```sh
curl -sSL -o download/Roboto-wdth-wght.ttf 'https://raw.githubusercontent.com/google/fonts/6183fc0d26361f6ddfd6f6b7a736e1467c6d8a43/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf'
python -m fontTools.subset download/Roboto-wdth-wght.ttf \
    --unicodes=U+0061,U+0066,U+0069,U+006A,U+006E,U+0074,U+0079,U+002F,U+0031,U+0032,U+00ED,U+012F,U+0301,U+0323 \
    --layout-features=ccmp,locl,liga,dlig,frac,kern,mark,mkmk \
    --name-IDs='*' --notdef-outline --no-hinting \
    --output-file=test/fonts/regression/Roboto-VF-gsub-chaining-subset.ttf
```

The features are listed to keep the file small: `--layout-features='*'` adds the glyphs of the other features (22 KB instead of 17 KB).

## Roboto-VF-gvar-private-points-noHVAR-subset.ttf

- Source: Roboto, variable (wdth, wght), `Version 3.015; 2026`
- URL: https://raw.githubusercontent.com/google/fonts/6183fc0d26361f6ddfd6f6b7a736e1467c6d8a43/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf
- sha256 of the download: `d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134`
- Used by: `gvarPrivatePoints.spec.mjs` (the subset below without HVAR: the advance widths vary through the gvar phantom points)

```sh
curl -sSL -o download/Roboto-wdth-wght.ttf 'https://raw.githubusercontent.com/google/fonts/6183fc0d26361f6ddfd6f6b7a736e1467c6d8a43/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf'
python -m fontTools.subset download/Roboto-wdth-wght.ttf \
    --unicodes=U+002D,U+002E,U+003A,U+0048,U+007A,U+00C9 \
    --layout-features='*' --name-IDs='*' --no-hinting --notdef-outline \
    --drop-tables+=HVAR \
    --output-file=test/fonts/regression/Roboto-VF-gvar-private-points-noHVAR-subset.ttf
```

## Roboto-VF-gvar-private-points-subset.ttf

- Source: Roboto, variable (wdth, wght), `Version 3.015; 2026`
- URL: https://raw.githubusercontent.com/google/fonts/6183fc0d26361f6ddfd6f6b7a736e1467c6d8a43/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf
- sha256 of the download: `d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134`
- Used by: `gvarPrivatePoints.spec.mjs` (gvar tuples with private point numbers for all points in a glyph that has shared point numbers, upstream PR #856)

```sh
curl -sSL -o download/Roboto-wdth-wght.ttf 'https://raw.githubusercontent.com/google/fonts/6183fc0d26361f6ddfd6f6b7a736e1467c6d8a43/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf'
python -m fontTools.subset download/Roboto-wdth-wght.ttf \
    --unicodes=U+002D,U+002E,U+003A,U+0048,U+007A,U+00C9 \
    --layout-features='*' --name-IDs='*' --no-hinting --notdef-outline \
    --output-file=test/fonts/regression/Roboto-VF-gvar-private-points-subset.ttf
```

## TestCFF1-CIDKeyed-subset.otf

- Source: Source Han Sans KR Regular (the region specific subset OTF), `Version 2.005;addfeatures 5.0.0b21`
- URL: https://raw.githubusercontent.com/adobe-fonts/source-han-sans/6c709ca72d3d7c46ab42ebecc1a26e7d69595a37/SubsetOTF/KR/SourceHanSansKR-Regular.otf
- sha256 of the download: `d8299926a5284f7461b46fa0617cc05d4f1fce8f034ffff78084225ce8b38071`
- Used by: `cffAdvanceWidth.spec.mjs` (CID-keyed CFF: Font DICTs with their own nominalWidthX and defaultWidthX) and `test/position.spec.mjs` (the GPOS single adjustments of palt, vpal and vert)

```sh
curl -sSL -o download/SourceHanSansKR-Regular.otf 'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/6c709ca72d3d7c46ab42ebecc1a26e7d69595a37/SubsetOTF/KR/SourceHanSansKR-Regular.otf'
python -m fontTools.subset download/SourceHanSansKR-Regular.otf \
    --unicodes=U+0020,U+0041,U+0056,U+004F,U+AC00,U+4E00,U+02C7,U+00B1,U+31B4,U+3105,U+FF76 \
    --layout-features='*' --name-IDs='*' --notdef-outline \
    --output-file=download/SourceHanSansKR-Regular-subset.otf
SOURCE_DATE_EPOCH=1794406865 python test/rename-reserved-font-name.py \
    download/SourceHanSansKR-Regular-subset.otf test/fonts/regression/TestCFF1-CIDKeyed-subset.otf \
    'Test CFF CID Keyed' TestCFF1-CIDKeyed SourceHanSansKR-Regular SourceHanSansKR --reserved Source
```

Renamed: the license of the source reserves the font name 'Source'.

## TestCFF1-EmptyPrivateDict.otf

- Source: none, the font is generated by `test/generate-cff-width-fonts.py` (fontTools FontBuilder, fixed `head` dates)
- Used by: `cffAdvanceWidth.spec.mjs` (CFF with an empty Private DICT, each glyph gives its width with a different charstring operator, upstream issues #417, #440 and #397) and `helpers.spec.mjs`

```sh
python test/generate-cff-width-fonts.py test/fonts/regression/TestCFF1-EmptyPrivateDict.otf
```

## TestCFF1-WidthMismatch.otf

- Source: none, the font is generated by `test/generate-cff-width-fonts.py` (fontTools FontBuilder, fixed `head` dates)
- Used by: `cffAdvanceWidth.spec.mjs`, `test/tables/cff.spec.mjs` and `test/tables/sfnt.spec.mjs` (the font above with hmtx advances of A and V that differ from the widths of their charstrings)

```sh
python test/generate-cff-width-fonts.py test/fonts/regression/TestCFF1-WidthMismatch.otf --hmtx-mismatch
```

## TestCFF1-WidthOperators.otf

- Source: none, the font is generated by `test/generate-cff-width-operators-font.py` (fontTools FontBuilder, fixed `head` dates)
- Used by: `test/tables/cff.spec.mjs` (CFF with a nominalWidthX and a defaultWidthX, charstrings that give their width before a seac endchar, through a local or a global subroutine, or begin with a hintmask with implicit vstems, an hmoveto or a vmoveto without a width)

```sh
python test/generate-cff-width-operators-font.py test/fonts/regression/TestCFF1-WidthOperators.otf
```

## TestCFF2-HintedVariable-subset.otf

- Source: Source Serif 4 Variable Roman, variable (opsz, wght), `Version 4.005;hotconv 1.1.0;makeotfexe 2.6.0`
- URL: https://github.com/adobe-fonts/source-serif/raw/2823e993c53fca27c5c8749f529b56a5a7c77b6b/VAR/SourceSerif4Variable-Roman.otf
- sha256 of the download: `867b73c6a954a4a64616906d179f94572a748790a1d022ebeeff07f56ea0221a`
- Used by: `cffAdvanceWidth.spec.mjs` and `test/tables/cff.spec.mjs` (CFF2 with hint operators, HVAR and GPOS pair kerning with variations)

```sh
curl -sSL -o download/SourceSerif4Variable-Roman.otf 'https://github.com/adobe-fonts/source-serif/raw/2823e993c53fca27c5c8749f529b56a5a7c77b6b/VAR/SourceSerif4Variable-Roman.otf'
python -m fontTools.subset download/SourceSerif4Variable-Roman.otf \
    --unicodes=U+0020,U+0041,U+0056,U+006F \
    --layout-features='*' --no-layout-closure --name-IDs='*' --notdef-outline \
    --output-file=download/SourceSerif4Variable-Roman-subset.otf
SOURCE_DATE_EPOCH=1794406865 python test/rename-reserved-font-name.py \
    download/SourceSerif4Variable-Roman-subset.otf test/fonts/regression/TestCFF2-HintedVariable-subset.otf \
    'Test CFF2 Hinted Variable' TestCFF2-HintedVariable SourceSerif4Variable --reserved Source
```

Renamed: the license of the source reserves the font name 'Source'.

## TestGPOS-KernTwoLookups.ttf

- Source: none, the font is generated by `test/generate-kern-lookups-font.py` (fontTools FontBuilder and feaLib, fixed `head` dates)
- Used by: `kerningExtensionLookups.spec.mjs` (a kern feature with two lookups that adjust the same pairs, a Pair Adjustment lookup and an Extension lookup with PairPos formats 1 and 2 in each: HarfBuzz applies both lookups and moves the pair by the sum of their values)

```sh
python test/generate-kern-lookups-font.py test/fonts/regression/TestGPOS-KernTwoLookups.ttf
```

## TestGSUB-ChainingLigatures-subset.otf

- Source: Lobster Two Bold, `Version 1.006`, the OTF attached to upstream issue #590 (google/fonts has only the TTF)
- URL: https://github.com/opentypejs/opentype.js/files/11026888/minimalexample.zip
- sha256 of the download: `260fad59e2ec94fb42d5787535e19e8f838f6a06c100e6513f0d493ebc8ecce8` (the zip), `a01ff7c6f26a249a491974c397cef4ea126c82f39e55db937ef6ed6d92f56a3e` (`LobsterTwo-Bold.otf`)
- Used by: `chainingLigatures.spec.mjs` (liga feature with ligature and chaining context lookups, upstream issue #590, whose error 'Substitution type 11 is not supported in chaining substitution' was added by PR #486)

```sh
curl -sSL -o download/minimalexample.zip 'https://github.com/opentypejs/opentype.js/files/11026888/minimalexample.zip'
unzip -o -q download/minimalexample.zip LobsterTwo-Bold.otf -d download
python -m fontTools.subset download/LobsterTwo-Bold.otf \
    --text='dz uz AAfftAA and no fuzz fu To Ty fix k' \
    --layout-features='*' --name-IDs='*' --glyph-names --notdef-outline \
    --output-file=download/LobsterTwo-Bold-subset.otf
SOURCE_DATE_EPOCH=1794406865 python test/rename-reserved-font-name.py \
    download/LobsterTwo-Bold-subset.otf test/fonts/regression/TestGSUB-ChainingLigatures-subset.otf \
    'Test GSUB Chaining Ligatures' TestGSUB-ChainingLigatures LobsterTwo --reserved Lobster
```

Renamed: the license embedded in the source reserves the font name 'Lobster', the OFL.txt of the family (google/fonts ofl/lobstertwo, same `Version 1.006`) reserves 'Lobster' and 'Lobster Two' and names a second copyright holder, Igino Marini.

## WorkSans-VF-kern-subset.ttf

- Source: Work Sans, variable (wght), `Version 2.012`
- URL: https://raw.githubusercontent.com/google/fonts/f9a520d3956150b929616354dc7ec915be39e3b4/ofl/worksans/WorkSans%5Bwght%5D.ttf
- sha256 of the download: `f50f61f2ba738e239442d40bf1069adb195c224b6a5a73a581fc2f3ed62a9f63`
- Used by: `kerningExtensionLookups.spec.mjs` (GPOS kerning in an Extension lookup only, upstream PR #491)

```sh
curl -sSL -o download/WorkSans-wght.ttf 'https://raw.githubusercontent.com/google/fonts/f9a520d3956150b929616354dc7ec915be39e3b4/ofl/worksans/WorkSans%5Bwght%5D.ttf'
python -m fontTools.subset download/WorkSans-wght.ttf \
    --unicodes=U+0041,U+0056,U+0054,U+006F,U+0079,U+004C,U+0050,U+002E,U+0024 \
    --glyphs=dollar.BRACKET.202 --layout-features='*' --no-layout-closure --no-hinting \
    --name-IDs=0,1,2,3,4,5,6,13,14 --notdef-outline \
    --output-file=test/fonts/regression/WorkSans-VF-kern-subset.ttf
```

U+0024 and `--glyphs=dollar.BRACKET.202` keep the rvrn feature of GSUB and its FeatureVariations, which the subset loses without one of them; the spec also uses their pairs with V, in both format 1 subtables.
