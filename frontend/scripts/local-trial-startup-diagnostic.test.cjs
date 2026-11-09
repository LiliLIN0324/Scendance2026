const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupDiagnostic } = require('./local-trial-startup-diagnostic.cjs');

test('startup diagnostics retain only a known stage and known error code', () => {
  assert.match(startupDiagnostic('监听试用端口', {code:'EADDRINUSE', message:'FAKE_SECRET'}), /监听试用端口（EADDRINUSE）/);
  assert.doesNotMatch(startupDiagnostic('FAKE_SECRET', {code:'FAKE_SECRET', message:'FAKE_SECRET'}), /FAKE_SECRET/);
});
