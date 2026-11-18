const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '../../frontend/node_modules/jsdom'));
const vm = require('vm');

const report = path.join(__dirname, '../../deliverables/oneplan-replica-geo-report-2026-11-17.html');
const html = fs.readFileSync(report, 'utf8');
const doc = new JSDOM(html).window.document;
const sections = [...doc.querySelectorAll('section.case')];
const last = sections[sections.length - 1];
const casesRaw = html.match(/const CASES = (\{.*?\});\s*\n/s)[1];
const cases = JSON.parse(casesRaw);
let scriptsOk = true;
for (const el of doc.querySelectorAll('script')) {
  try { new vm.Script(el.textContent); } catch (e) { scriptsOk = false; console.log('script error', e.message); }
}
const counts = {};
for (const [k, v] of Object.entries(cases)) counts[k] = (v.g && v.g.f ? v.g.f.length : 0);
console.log(JSON.stringify({
  bytes: fs.statSync(report).size,
  sections: sections.length,
  mapboxes: doc.querySelectorAll('.mapbox').length,
  lastId: last.id,
  lastTitle: last.querySelector('h2').textContent.trim(),
  hasNewCopy: last.textContent.includes('本次重描的平面'),
  cases: Object.keys(cases).length,
  slugFacilities: counts['start-on-the-street'],
  scotiaFacilities: counts['scotiabank-hockey-day-canada'],
  scriptsOk,
  lede: doc.querySelector('.lede') ? doc.querySelector('.lede').textContent.slice(0, 80) : null,
}, null, 2));
