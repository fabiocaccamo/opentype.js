// Generates the WOFF2 fixtures of test/woff2.spec.mjs with the reference
// encoder of Google (woff2_compress, through its WebAssembly build wawoff2):
// <name>.google.woff2 in test/fonts/woff2/ for each source font of
// generate-woff2-fonts.py (the fontTools fixtures).
//
// Usage: node test/generate-woff2-fonts-google.mjs <path of the wawoff2 package>
// (wawoff2 is not a dependency: install it anywhere, e.g. npm install --prefix /tmp/wawoff2 wawoff2)

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';

async function main() {
    const wawoff2Path = process.argv[2];
    if (!wawoff2Path) {
        console.error('Usage: node test/generate-woff2-fonts-google.mjs <path of the wawoff2 package>');
        process.exit(1);
    }
    const require = createRequire(import.meta.url);
    const compress = require(path.resolve(wawoff2Path, 'compress.js'));

    const fontsDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'fonts');
    const generator = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'generate-woff2-fonts.py'), 'utf8');
    const sources = [...generator.matchAll(/^ {4}"([^"]+\.(?:ttf|otf))",/gm)].map(match => match[1]);

    for (const source of sources) {
        const name = source.replace(/\.(ttf|otf)$/, '');
        const output = path.join(fontsDir, 'woff2', name + '.google.woff2');
        writeFileSync(output, await compress(readFileSync(path.join(fontsDir, source))));
        console.log(output);
    }
}

// only when run as a script: mocha imports every module of test/
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
