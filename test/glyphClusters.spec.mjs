import assert from 'assert';
import { parse } from '../src/opentype.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

// the glyph names with the characters of the text they represent
function describeClusters(font, text) {
    return font.stringToGlyphClusters(text).map(cluster => cluster.glyph.name + ':' + text.slice(cluster.start, cluster.end));
}

describe('stringToGlyphClusters', function() {
    it('maps a ligature to all its component characters', function() {
        const font = loadSync('./test/fonts/FiraSansMedium.woff');
        // same clusters as HarfBuzz: o=0 f=1 f_i=2 c=4 e=5
        const clusters = font.stringToGlyphClusters('office');
        assert.deepEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[0, 1], [1, 2], [2, 4], [4, 5], [5, 6]]);
        assert.deepEqual(describeClusters(font, 'office'), ['o:o', 'f:f', 'f_i:fi', 'c:c', 'e:e']);
    });

    it('returns the glyphs of stringToGlyphs, in the same order', function() {
        const fonts = ['FiraSansMedium.woff', 'Scheherazade-Bold.ttf', 'NotoSansThai-Medium-Testing-v1.ttf', 'TestCMAP14.otf'];
        const texts = ['office affluent', 'Hello, world!', 'لا إله إلا الله abc', 'ภาษาไทย', '芦󠄀芦≩︀'];
        for (const fontFile of fonts) {
            const font = loadSync('./test/fonts/' + fontFile);
            for (const text of texts) {
                const clusters = font.stringToGlyphClusters(text);
                assert.deepEqual(clusters.map(cluster => cluster.glyph), font.stringToGlyphs(text), fontFile + ': ' + text);
                // every character of the text belongs to exactly one cluster
                const covered = new Array(text.length).fill(0);
                for (const cluster of clusters) {
                    assert.ok(cluster.start < cluster.end, fontFile + ': ' + text);
                    for (let i = cluster.start; i < cluster.end; i++) {
                        covered[i]++;
                    }
                }
                assert.deepEqual(covered, new Array(text.length).fill(1), fontFile + ': ' + text);
            }
        }
    });

    it('maps the reversed glyphs of arabic text to their characters', function() {
        const font = loadSync('./test/fonts/Scheherazade-Bold.ttf');
        const text = 'لا ب';
        const clusters = font.stringToGlyphClusters(text);
        // same clusters as HarfBuzz, in visual order: beh=3 space=2 alef=1 lam=0
        assert.deepEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[3, 4], [2, 3], [1, 2], [0, 1]]);
        assert.deepEqual(describeClusters(font, text), ['uni0628:ب', 'space: ', 'uni0627.fina.postLamIni:ا', 'uni0644.init.preAlef:ل']);
    });

    it('uses UTF-16 offsets for characters outside the BMP, and maps a variation selector to the glyph before it', function() {
        const font = loadSync('./test/fonts/TestCMAP14.otf');
        // 芦 followed by the variation selector U+E0100 (2 UTF-16 code units), then ≩ followed by U+FE00
        const text = [33446, 917760, 8809, 65024].map(codePoint => String.fromCodePoint(codePoint)).join('');
        const clusters = font.stringToGlyphClusters(text);
        assert.deepEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[0, 3], [3, 5]]);
        assert.deepEqual(clusters.map(cluster => cluster.glyph.index), font.stringToGlyphIndexes(text));
    });
});
