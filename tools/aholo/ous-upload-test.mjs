import { readFileSync } from 'node:fs';
const bytes = readFileSync('docs/evidence/aholo/world-3FO4K4QI6N4V/panorama.jpg');
const res = await fetch('http://127.0.0.1:3199/recon-upload?name=' + encodeURIComponent('panorama.jpg'), { method: 'POST', body: bytes });
console.log('status:', res.status);
console.log((await res.text()).slice(0, 400));
