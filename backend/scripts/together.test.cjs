const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * lib/together.js is pure and import-free, so the production module is loaded
 * directly — no source rewriting, no stubs. What is under test is the part that
 * has to survive a stranger editing the query string they were sent.
 */
const file = path.resolve(__dirname, '../../frontend/src/lib/together.js');
const t = async () => import(pathToFileURL(file).href);

test('room codes are readable and nothing else is accepted', async () => {
  const { newRoomCode, validRoomCode } = await t();
  const code = newRoomCode();
  assert.equal(code.length, 6);
  assert.ok(validRoomCode(code));
  assert.match(code, /^[A-Z2-9]+$/);
  for (const bad of ['', 'ABC', 'abcdefg', 'A'.repeat(5), 'A'.repeat(7), 'IOIOIO', '010101', null, 123456, ['A']]) {
    assert.equal(validRoomCode(bad), false, String(bad));
  }
});

test('a link carries title, episode and server, and no invented position', async () => {
  const { togetherLink } = await t();
  const url = togetherLink({
    origin: 'https://zenithflix.example/',
    type: 'tv',
    id: 1396,
    season: 2,
    episode: 3,
    provider: 'vidsrcpm',
    youtubeKey: 'abc123',
    code: 'K3F9QA',
    startAt: 1793000000000.7,
  });
  assert.ok(url.startsWith('https://zenithflix.example/watch/tv/1396?'));
  const q = new URLSearchParams(new URL(url).search);
  assert.equal(q.get('season'), '2');
  assert.equal(q.get('episode'), '3');
  assert.equal(q.get('provider'), 'vidsrcpm');
  assert.equal(q.get('together'), 'K3F9QA');
  assert.equal(q.get('start'), '1793000000001');
  assert.equal(q.get('at'), null, 'position is not invented for an iframe host');
  assert.equal(togetherLink({ origin: '', type: 'movie', id: 1, code: 'K3F9QA', startAt: 1 }), '');
  assert.equal(togetherLink({ origin: 'https://x.test', type: 'movie', id: 1, code: 'bad', startAt: 1 }), '');
});

test('a hand-edited query string is refused rather than trusted', async () => {
  const { readTogether } = await t();
  const good = new URLSearchParams('together=K3F9QA&start=1793000000000');
  assert.deepEqual(readTogether(good), { code: 'K3F9QA', startAt: 1793000000000, at: null, invite: false, stale: true });
  assert.equal(readTogether(new URLSearchParams('together=K3F9QA&start=1793000000000&invite=1')).invite, true);
  for (const raw of ['', 'together=K3F9QA', 'start=1793000000000', 'together=IOIOIO&start=1793000000000', 'together=K3F9QA&start=banana', 'together=K3F9QA&start=99999999999999999']) {
    assert.equal(readTogether(new URLSearchParams(raw)), null, raw);
  }
  assert.equal(readTogether(null), null);
  assert.equal(readTogether({}), null);
});

test('an out-of-range position is dropped, a sane one is kept', async () => {
  const { readTogether } = await t();
  const q = new URLSearchParams(`together=K3F9QA&start=${Date.now()}&at=1234.6`);
  assert.equal(readTogether(q).at, 1235);
  for (const at of ['-5', '99999999', 'NaN']) {
    assert.equal(readTogether(new URLSearchParams(`together=K3F9QA&start=${Date.now()}&at=${at}`)).at, null, at);
  }
});

test('the countdown knows the difference between waiting, go and already rolling', async () => {
  const { countdown } = await t();
  const now = 1793000000000;
  assert.deepEqual(countdown(now + 45000, now), { phase: 'waiting', seconds: 45, delta: 45000 });
  assert.equal(countdown(now + 1500, now).phase, 'go');
  assert.equal(countdown(now - 1500, now).phase, 'go');
  const after = countdown(now - 90000, now);
  assert.equal(after.phase, 'after');
  assert.equal(after.seconds, 90);
});

test('times are said the way a person says them', async () => {
  const { humanTime } = await t();
  assert.equal(humanTime(0), '0 sec');
  assert.equal(humanTime(-10), '0 sec');
  assert.equal(humanTime(59), '59 sec');
  assert.equal(humanTime(60), '1 min');
  assert.equal(humanTime(252), '4 min 12 sec');
});

/**
 * The link flow is the only sharing path that works with nothing but this
 * deploy, so the room surfaces must not advertise a backend that is not there.
 * This checks the shipped source, because the door closing is a build-time
 * decision (VITE_PARTY_BASE), not something a runtime can discover.
 */
test('live-room doors stay shut until an always-on backend is configured', () => {
  const src = (rel) => fs.readFileSync(path.resolve(__dirname, '../../frontend/src', rel), 'utf8');
  assert.match(src('pages/TheatreRoom.jsx'), /return PARTY_ORIGIN \? <TheatreRoomInner \/> : <NeedsBackend \/>;/);
  assert.match(src('pages/GroupCreation.jsx'), /PARTY_ORIGIN\s*\n?\s*\?\s*<GroupCreationInner \/>/);
  for (const file of ['components/TopNav.jsx', 'pages/Browse.jsx', 'pages/Watch.jsx', 'components/DetailSheet.jsx']) {
    const code = src(file);
    assert.ok(code.includes('PARTY_ORIGIN'), `${file} must import the backend flag`);
    if (code.includes('/create-group')) assert.ok(code.includes('Live room'), `${file}: the room door is labelled honestly`);
  }
  assert.ok(!src('pages/Browse.jsx').includes('7-character'), 'the old room-ID copy is gone');
});
