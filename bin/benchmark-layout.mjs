#!/usr/bin/env node
// Time the parse and the layout of fonts: opentype.parse of the whole file and the parse followed by the first draw of
// every glyph, as a glyph grid does (lowMemory false and true), and font.shape, stringToGlyphs, getPath,
// getAdvanceWidth and getKerningValue (each pair of glyphs of the text) on a Latin, a Japanese and an Arabic text, the
// ones whose characters the font has, with the layout cache on and off (the layoutCache option of parse). Each time is
// the median of the runs, after five runs to warm up. Not run by npm test.
//
//     node bin/benchmark-layout.mjs [--runs 30] [--json times.json] font.otf...

import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import process from 'process';
import { performance } from 'perf_hooks';
import { parse } from '../src/opentype.mjs';

const WARM_UP_RUNS = 5;
const FONT_SIZE = 72;

const TEXTS = {
    latin: 'Typography is the craft of arranging type to make written language legible, readable and appealing ' +
        'when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, ' +
        'line spacing (leading) and letter spacing (tracking), as well as adjusting the space between pairs ' +
        'of letters (kerning). In 1450, Johannes Gutenberg introduced movable type in Europe; within fifty ' +
        'years, printers in Venice, Basel, Paris and Lyon had published thousands of books. Early typefaces ' +
        'imitated the handwriting of scribes, with ligatures such as "fi", "fl", "ff", "ffi" and "ffl" ' +
        'that joined letters which would otherwise collide. Today a type designer draws every glyph of a ' +
        'family, from the regular weight to the black italic, and tests each one in words like "AVATAR", ' +
        '"Wave", "Tokyo", "LT", "To", "Yo" and "P.A." to find the pairs that need kerning. A good text ' +
        'face disappears: readers notice the meaning, not the letters. Display faces, on the other hand, ' +
        'are made to be noticed: they shout from posters, book covers and signs. Variable fonts let a ' +
        'single file hold many styles along axes such as weight (wght), width (wdth) and optical size ' +
        '(opsz), so a web page can ask for a weight of 437 or a width of 87.5% without loading another ' +
        'file. OpenType features, finally, give the reader small capitals, old-style figures (0123456789), ' +
        'fractions like 1/2 and 3/4, and contextual alternates that make a script face flow naturally. ' +
        'Quick zephyrs blow, vexing daft Jim; the five boxing wizards jump quickly over the lazy dog.',
    japanese: ('活字の歴史は、文字を一つずつ組み合わせて文章を作るという考え方から始まりました。日本では明治時代に活版' +
        '印刷が広まり、新聞や雑誌、教科書が大量に作られるようになりました。ひらがな、カタカナ、漢字を混ぜて書く日本語' +
        'は、文字の種類がとても多いため、書体を作るには何年もかかります。現在ではデジタルフォントが主流となり、ウェブ' +
        'サイトやスマートフォンの画面でも美しい文字を表示できるようになりました。デザイナーは、行間や文字間のバランス、' +
        '句読点の位置、縦書きと横書きの違いなど、細かな点に注意を払いながら、読みやすい組版を目指しています。「読みや' +
        'すさ」と「美しさ」を両立させることは、今も昔も変わらない大切な目標です。').repeat(2),
    arabic: ('الخط العربي فن قديم يجمع بين الجمال والوظيفة، وقد تطور عبر القرون في مدن كثيرة مثل بغداد والقاهرة ' +
        'ودمشق وإسطنبول. يكتب الخطاط الحروف متصلة من اليمين إلى اليسار، وتتغير صورة الحرف بحسب موقعه في ' +
        'الكلمة: في أولها أو وسطها أو آخرها أو منفردا. وتساعد الحركات على قراءة النص بدقة، كما في قولنا: ' +
        'الْخَطُّ الْعَرَبِيُّ فَنٌّ جَمِيلٌ يُحِبُّهُ النَّاسُ. واليوم يصمم المصممون خطوطا رقمية تحافظ على روح ' +
        'الخط التقليدي وتعمل جيدا على الشاشات والطابعات. ').repeat(2)
};

/**
 * The options of the command line: the number of runs, the JSON file of the times and the font files
 * @param {string[]} commandArguments
 * @returns {{runs: number, jsonPath: string|undefined, fontPaths: string[]}}
 */
function parseCommandArguments(commandArguments) {
    const options = { runs: 30, jsonPath: undefined, fontPaths: [] };
    for (let i = 0; i < commandArguments.length; i++) {
        const commandArgument = commandArguments[i];
        if (commandArgument === '--runs') {
            options.runs = Number(commandArguments[++i]);
        } else if (commandArgument === '--json') {
            options.jsonPath = commandArguments[++i];
        } else {
            options.fontPaths.push(commandArgument);
        }
    }
    if (!options.fontPaths.length || !(options.runs > 0)) {
        throw new Error('Usage: node bin/benchmark-layout.mjs [--runs 30] [--json times.json] font.otf...');
    }
    return options;
}

/**
 * The median of a list of numbers
 * @param {number[]} values
 * @returns {number}
 */
function getMedian(values) {
    const sortedValues = values.slice().sort((valueA, valueB) => valueA - valueB);
    const middle = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

/**
 * The median time of a function in milliseconds, after the runs to warm up
 * @param {function(): any} operation
 * @param {number} runs
 * @returns {number}
 */
function timeOperation(operation, runs) {
    for (let i = 0; i < WARM_UP_RUNS; i++) {
        operation();
    }
    const times = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        operation();
        times.push(performance.now() - start);
    }
    return getMedian(times);
}

/**
 * Whether the font has a glyph for every character of a text but the spaces
 * @param {opentype.Font} font
 * @param {string} text
 * @returns {boolean}
 */
function hasTextCharacters(font, text) {
    return Array.from(text).every(character => character === ' ' || font.hasChar(character));
}

/**
 * Parse a font file and draw the outline of each of its glyphs, the outlines a font reads on demand included
 * @param {Buffer} buffer
 * @param {boolean} lowMemory
 */
function parseAndDrawGlyphs(buffer, lowMemory) {
    const font = parse(buffer, { lowMemory });
    for (let i = 0; i < font.numGlyphs; i++) {
        font.glyphs.get(i).getPath(0, 0, FONT_SIZE);
    }
}

/**
 * The layout operations timed on a font and a text
 * @param {opentype.Font} font
 * @param {string} text
 * @returns {Object<string, function(): any>}
 */
function getLayoutOperations(font, text) {
    const glyphs = font.stringToGlyphs(text);
    return {
        shape: () => font.shape(text),
        stringToGlyphs: () => font.stringToGlyphs(text),
        getPath: () => font.getPath(text, 0, 0, FONT_SIZE),
        getAdvanceWidth: () => font.getAdvanceWidth(text, FONT_SIZE),
        getKerningValue: () => {
            for (let i = 1; i < glyphs.length; i++) {
                font.getKerningValue(glyphs[i - 1], glyphs[i]);
            }
        }
    };
}

/**
 * Time the parse and the layout of a font file
 * @param {string} fontPath
 * @param {number} runs
 * @returns {Array<{font: string, text: string, operation: string, cache: string, milliseconds: number}>}
 */
function benchmarkFont(fontPath, runs) {
    const fontName = basename(fontPath);
    const buffer = readFileSync(fontPath);
    const times = [];
    for (const lowMemory of [false, true]) {
        times.push({
            font: fontName,
            text: '',
            operation: lowMemory ? 'parse lowMemory' : 'parse',
            cache: '',
            milliseconds: timeOperation(() => parse(buffer, { lowMemory }), runs)
        });
        times.push({
            font: fontName,
            text: '',
            operation: lowMemory ? 'parse and draw every glyph lowMemory' : 'parse and draw every glyph',
            cache: '',
            milliseconds: timeOperation(() => parseAndDrawGlyphs(buffer, lowMemory), runs)
        });
    }
    for (const layoutCache of [true, false]) {
        const font = parse(buffer, { layoutCache });
        for (const [textName, text] of Object.entries(TEXTS)) {
            if (!hasTextCharacters(font, text)) {
                continue;
            }
            for (const [operation, runOperation] of Object.entries(getLayoutOperations(font, text))) {
                times.push({
                    font: fontName,
                    text: textName,
                    operation,
                    cache: layoutCache ? 'on' : 'off',
                    milliseconds: timeOperation(runOperation, runs)
                });
            }
        }
    }
    return times;
}

const options = parseCommandArguments(process.argv.slice(2));
const allTimes = [];
console.log('| font | text | operation | layout cache | median ms |');
console.log('|---|---|---|---|---:|');
for (const fontPath of options.fontPaths) {
    for (const time of benchmarkFont(fontPath, options.runs)) {
        allTimes.push(time);
        console.log(`| ${time.font} | ${time.text} | ${time.operation} | ${time.cache} | ${time.milliseconds.toFixed(3)} |`);
    }
}
if (options.jsonPath) {
    writeFileSync(options.jsonPath, JSON.stringify(allTimes, null, 4));
}
