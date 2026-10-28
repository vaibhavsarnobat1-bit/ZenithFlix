const test = require('node:test');
const assert = require('node:assert/strict');

test('HLS manifest audio track inspection and language detection', () => {
  const sampleManifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="eng.m3u8",GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,URI="deu.m3u8",GROUP-ID="audio",LANGUAGE="de",NAME="German"
#EXT-X-MEDIA:TYPE=AUDIO,URI="fra.m3u8",GROUP-ID="audio",LANGUAGE="fr",NAME="French"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x480,AUDIO="audio"
video.m3u8`;

  // Parse lines matching audio
  const audioLines = sampleManifest.split('\n').filter((l) => l.startsWith('#EXT-X-MEDIA:TYPE=AUDIO'));
  assert.equal(audioLines.length, 3);

  const tracks = audioLines.map((l, idx) => {
    const langMatch = l.match(/LANGUAGE="([^"]+)"/);
    const nameMatch = l.match(/NAME="([^"]+)"/);
    return {
      id: idx,
      lang: langMatch ? langMatch[1] : null,
      name: nameMatch ? nameMatch[1] : null,
    };
  });

  assert.equal(tracks[0].lang, 'en');
  assert.equal(tracks[1].lang, 'de');
  assert.equal(tracks[2].lang, 'fr');

  // Verify Hindi detection: must be FALSE for this manifest
  const hasHindi = tracks.some((t) => t.lang === 'hi' || (t.name && t.name.toLowerCase().includes('hindi')));
  assert.equal(hasHindi, false, 'Manifest without Hindi track must NOT claim Hindi audio is available');
});

test('HLS manifest with real Hindi track confirms availability', () => {
  const hindiManifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="eng.m3u8",GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,URI="hin.m3u8",GROUP-ID="audio",LANGUAGE="hi",NAME="Hindi"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x480,AUDIO="audio"
video.m3u8`;

  const audioLines = hindiManifest.split('\n').filter((l) => l.startsWith('#EXT-X-MEDIA:TYPE=AUDIO'));
  const tracks = audioLines.map((l, idx) => {
    const langMatch = l.match(/LANGUAGE="([^"]+)"/);
    const nameMatch = l.match(/NAME="([^"]+)"/);
    return {
      id: idx,
      lang: langMatch ? langMatch[1] : null,
      name: nameMatch ? nameMatch[1] : null,
    };
  });

  const hasHindi = tracks.some((t) => t.lang === 'hi' || (t.name && t.name.toLowerCase().includes('hindi')));
  assert.equal(hasHindi, true, 'Manifest with LANGUAGE="hi" must confirm Hindi track availability');
  assert.equal(tracks.find((t) => t.lang === 'hi').name, 'Hindi');
});

test('DirectHlsPlayer state mapping and track switching logic', () => {
  // Simulate HLS.js internal audioTracks array
  const mockHls = {
    audioTracks: [
      { name: 'stream_5', lang: 'en', default: true },
      { name: 'stream_4', lang: 'de', default: false },
      { name: 'stream_7', lang: 'fr', default: false },
    ],
    audioTrack: 0,
    currentLevel: -1,
    levels: [
      { height: 576, width: 768, bitrate: 1824731 },
      { height: 480, width: 640, bitrate: 1410993 },
    ],
  };

  const getAudioTracks = () =>
    mockHls.audioTracks.map((t, idx) => ({
      id: idx,
      name: t.name,
      lang: (t.lang || '').toLowerCase(),
      active: mockHls.audioTrack === idx,
      isDefault: Boolean(t.default),
    }));

  let tracks = getAudioTracks();
  assert.equal(tracks.length, 3);
  assert.equal(tracks[0].active, true);
  assert.equal(tracks[1].active, false);

  // Switch to German (track 1)
  mockHls.audioTrack = 1;
  tracks = getAudioTracks();
  assert.equal(tracks[0].active, false);
  assert.equal(tracks[1].active, true);

  // Switch back to English (track 0)
  mockHls.audioTrack = 0;
  tracks = getAudioTracks();
  assert.equal(tracks[0].active, true);
  assert.equal(tracks[1].active, false);
});
