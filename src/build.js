// Builds ../index.html (the GitHub Pages site) from the sources in this folder.
// Run from the repository root:  node src/build.js
const fs = require('fs'), path = require('path');
const here = p => path.join(__dirname, p);
const { buildDemo } = require('./demo.js');
const demo = Buffer.from(buildDemo()).toString('base64');
const core = fs.readFileSync(here('charsets.js'), 'utf8') + '\n' + fs.readFileSync(here('core.js'), 'utf8');
let page = fs.readFileSync(here('template.html'), 'utf8');
page = page.replace('/*@@CORE@@*/', () => core).replace('@@DEMO@@', demo).replace('/*@@UI@@*/', () => fs.readFileSync(here('ui.js'), 'utf8'));
const html = fs.readFileSync(here('site_head.html'), 'utf8') + page + fs.readFileSync(here('site_tail.html'), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), html);
console.log('index.html written,', html.length, 'bytes');
