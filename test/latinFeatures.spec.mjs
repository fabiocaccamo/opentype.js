import assert from 'assert';
import { Font, Glyph, Path, parse } from '../src/opentype.mjs';
import { Parser } from '../src/parse.mjs';
import { unhex } from './testutil.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

/**
 * Latin features applied like HarfBuzz: the default features of browsers, their lookups
 * in lookup list order, on the whole text that is not arabic or thai.
 *
 * Glyphs:
 *   0: .notdef, 1: a, 2: b, 3: c, 4: hyphen, 5: greater (mapped to "a", "b", "c", "-", ">")
 *   6: a.alt, 7: b.alt, 8: a_b, 9: arrow, 10: c.alt
 */
const glyphNames = ['.notdef', 'a', 'b', 'c', 'hyphen', 'greater', 'a.alt', 'b.alt', 'a_b', 'arrow', 'c.alt'];
const characters = [null, 'a', 'b', 'c', '-', '>'];

function single(from, to) {
    return { lookupType: 1, lookupFlag: 0, subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [from] }, substitute: [to] }] };
}

function ligature(first, components, ligGlyph) {
    return { lookupType: 4, lookupFlag: 0, subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [first] }, ligatureSets: [[{ ligGlyph, components }]] }] };
}

// chaining context format 1: input glyphs with a lookahead, the nested lookup applied to the first glyph
function chainingFormat1(input, lookahead, lookupListIndex) {
    return {
        lookupType: 6,
        lookupFlag: 0,
        subtables: [{
            substFormat: 1,
            coverage: { format: 1, glyphs: [input[0]] },
            chainRuleSets: [[{ backtrack: [], input: input.slice(1), lookahead, lookupRecords: [{ sequenceIndex: 0, lookupListIndex }] }]]
        }]
    };
}

function createFont(features, lookups) {
    const glyphs = glyphNames.map((name, index) => {
        const unicodes = characters[index] ? [characters[index].codePointAt(0)] : [];
        return new Glyph({ index, name, unicode: unicodes[0], unicodes, advanceWidth: 500, path: new Path() });
    });
    const font = new Font({ familyName: 'LatinFeatures', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
    font.tables.gsub = {
        version: 1,
        scripts: [{
            tag: 'latn',
            script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: features.map((feature, index) => index) }, langSysRecords: [] }
        }],
        features: features.map(([tag, lookupListIndexes]) => ({ tag, feature: { featureParams: 0, lookupListIndexes } })),
        lookups
    };
    return font;
}

const shape = (font, text, options) => font.stringToGlyphs(text, options).map(glyph => glyph.name);

describe('latin features', function() {
    it('applies the default features of browsers, including calt', function() {
        // calt: a followed by b becomes a.alt
        const font = createFont([['calt', [1]]], [single(1, 6), chainingFormat1([1], [2], 0)]);
        assert.deepEqual(shape(font, 'abab'), ['a.alt', 'b', 'a.alt', 'b']);
        assert.deepEqual(shape(font, 'ac'), ['a', 'c']);
    });

    it('applies the lookups in lookup list order, not feature by feature', function() {
        // liga (lookup 2) forms a_b, calt (lookup 1, applied before) turns a into a.alt first
        const font = createFont([['liga', [2]], ['calt', [1]]], [single(1, 6), chainingFormat1([1], [2], 0), ligature(1, [2], 8)]);
        assert.deepEqual(shape(font, 'ab'), ['a.alt', 'b']);
        // the same lookups in the other order: the ligature wins
        const ligatureFirst = createFont([['liga', [1]], ['calt', [2]]], [single(1, 6), ligature(1, [2], 8), chainingFormat1([1], [2], 0)]);
        assert.deepEqual(shape(ligatureFirst, 'ab'), ['a_b']);
    });

    it('applies the features to punctuation and across words', function() {
        // calt code ligature: - > becomes arrow
        const font = createFont([['calt', [0]]], [ligature(4, [5], 9)]);
        assert.deepEqual(shape(font, 'a->b c->'), ['a', 'arrow', 'b', '.notdef', 'c', 'arrow']);
    });

    it('enables and disables features through the features option', function() {
        const font = createFont([['liga', [0]], ['ss01', [1]]], [ligature(1, [2], 8), single(3, 10)]);
        assert.deepEqual(shape(font, 'abc'), ['a_b', 'c']);
        assert.deepEqual(shape(font, 'abc', { features: { liga: false } }), ['a', 'b', 'c']);
        assert.deepEqual(shape(font, 'abc', { features: { ss01: true } }), ['a_b', 'c.alt']);
    });

    it('applies a multiple substitution, with every glyph in the cluster of its character', function() {
        const multiple = { lookupType: 2, lookupFlag: 0, subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [3] }, sequences: [[6, 7]] }] };
        const font = createFont([['ccmp', [0]]], [multiple]);
        assert.deepEqual(shape(font, 'acb'), ['a', 'a.alt', 'b.alt', 'b']);
        const clusters = font.stringToGlyphClusters('acb');
        assert.deepEqual(clusters.map(cluster => [cluster.glyph.name, cluster.start, cluster.end]),
            [['a', 0, 1], ['a.alt', 1, 2], ['b.alt', 1, 2], ['b', 2, 3]]);
    });

    it('applies the ligatures in getPath and getAdvanceWidth too', function() {
        const font = loadSync('./test/fonts/FiraSansMedium.woff');
        const glyphs = [];
        font.forEachGlyph('fi', 0, 0, 72, {}, glyph => glyphs.push(glyph.name));
        assert.deepEqual(glyphs, ['f_i']);
        assert.equal(font.getAdvanceWidth('fi', 1000), font.getAdvanceWidth('fi', 1000, { features: {} }));
        assert.notEqual(font.getAdvanceWidth('fi', 1000), font.getAdvanceWidth('fi', 1000, { features: { liga: false } }));
    });
});

describe('GSUB feature variations', function() {
    it('parses the conditions and the alternate feature tables', function() {
        const data = unhex(
            '00000004' +                                  // FeatureVariations offset
            '0001 0000 00000001' +                        // version 1.0, 1 record
            '00000010 0000001E' +                         // ConditionSet and FeatureTableSubstitution offsets
            '0001 00000006' +                             // ConditionSet: 1 condition
            '0001 0000 2000 4000' +                       // format 1, axis 0, from 0.5 to 1
            '0001 0000 0001 0003 0000000C' +              // FeatureTableSubstitution: feature 3
            '0000 0002 0004 0005'                         // alternate Feature: lookups 4 and 5
        );
        assert.deepEqual(new Parser(data, 0).parseFeatureVariationsList(), [{
            conditionSetOffset: 0x10,
            featureTableSubstitutionOffset: 0x1E,
            conditions: [{ format: 1, axisIndex: 0, filterRangeMinValue: 0.5, filterRangeMaxValue: 1 }],
            substitutions: [{ featureIndex: 3, feature: { featureParams: 0, lookupListIndexes: [4, 5] } }]
        }]);
    });

    it('applies the alternate features of the first record matching the variation coordinates', function() {
        const font = createFont([['liga', [0]]], [ligature(1, [2], 8), single(1, 6)]);
        font.tables.gsub.variations = [
            { conditions: [{ format: 1, axisIndex: 0, filterRangeMinValue: 0.5, filterRangeMaxValue: 1 }],
                substitutions: [{ featureIndex: 0, feature: { featureParams: 0, lookupListIndexes: [1] } }] }
        ];
        let normalizedCoordinates = [0];
        font.variation = { process: { getNormalizedCoords: () => normalizedCoordinates } };
        assert.deepEqual(shape(font, 'ab'), ['a_b']);
        normalizedCoordinates = [0.75];
        assert.deepEqual(shape(font, 'ab'), ['a.alt', 'b']);
    });
});
