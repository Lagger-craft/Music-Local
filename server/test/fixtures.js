// Synthetic media fixtures generated in code (no ffmpeg, no binary files in git).

/**
 * Build a minimal but valid RIFF/WAVE file: fmt + data (silence) + LIST INFO
 * chunk carrying artist (IART), title (INAM) and album (IPRD) tags.
 */
export function makeWav({ title, artist, album, sampleRate = 8000, seconds = 0.1 } = {}) {
  const numSamples = Math.round(sampleRate * seconds);
  const dataSize = numSamples * 2; // 16-bit mono PCM
  const data = Buffer.alloc(dataSize); // silence

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // channels
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8); // byte rate
  fmt.writeUInt16LE(2, 12); // block align
  fmt.writeUInt16LE(16, 14); // bits per sample

  const infoSubchunks = [];
  const infoChunk = (id, text) => {
    if (text === undefined) return null;
    const textBuf = Buffer.concat([Buffer.from(text, 'latin1'), Buffer.from([0])]);
    const padded = textBuf.length % 2 === 0 ? textBuf : Buffer.concat([textBuf, Buffer.from([0])]);
    const header = Buffer.alloc(8);
    header.write(id, 0, 'latin1');
    header.writeUInt32LE(padded.length, 4);
    return Buffer.concat([header, padded]);
  };
  for (const chunk of [
    infoChunk('INAM', title),
    infoChunk('IART', artist),
    infoChunk('IPRD', album),
  ]) {
    if (chunk) infoSubchunks.push(chunk);
  }
  const infoBody = Buffer.concat([Buffer.from('INFO', 'latin1'), ...infoSubchunks]);

  const list = Buffer.alloc(8);
  list.write('LIST', 0, 'latin1');
  list.writeUInt32LE(infoBody.length, 4);

  const riffBody = Buffer.concat([
    Buffer.from('WAVE', 'latin1'),
    chunk('fmt ', fmt),
    chunk('data', data),
    list,
    infoBody,
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(riffBody.length, 4);
  return Buffer.concat([header, riffBody]);
}

function chunk(id, body) {
  const padded = body.length % 2 === 0 ? body : Buffer.concat([body, Buffer.from([0])]);
  const header = Buffer.alloc(8);
  header.write(id, 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, padded]);
}

/** Tiny JPEG (SOI + JFIF APP0 + EOI), enough to store/serve as cover bytes. */
export function makeJpeg(seed = 0) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([
      0xff, 0xe0, 0x00, 0x10, // APP0, length 16
      0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
      0x01, 0x01, // version
      0x00, // density units
      0x00, 0x01, 0x00, 0x01, // X/Y density
      0x00, 0x00, // thumbnail size
    ]),
    Buffer.from([seed & 0xff]), // payload byte so different covers differ
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

const SYNCSAFE = (n) => [
  (n >> 21) & 0x7f,
  (n >> 14) & 0x7f,
  (n >> 7) & 0x7f,
  n & 0x7f,
];

function id3Frame(id, payload) {
  // ID3v2.3: 4-byte id, big-endian 32-bit size, 2 flag bytes.
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function textFrame(id, text) {
  return id3Frame(id, Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1')]));
}

function apicFrame(jpegBytes, { type = 0x03, description = '' } = {}) {
  const payload = Buffer.concat([
    Buffer.from([0x00]), // ISO-8859-1 encoding
    Buffer.from('image/jpeg', 'latin1'),
    Buffer.from([0x00]),
    Buffer.from([type]), // picture type: front cover
    Buffer.from(description, 'latin1'),
    Buffer.from([0x00]),
    jpegBytes,
  ]);
  return id3Frame('APIC', payload);
}

/** MPEG-1 Layer III, 128 kbps, 44100 Hz, no padding; frame length = 417 bytes. */
function silentMp3Frames(count = 3) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const frame = Buffer.alloc(417);
    frame[0] = 0xff;
    frame[1] = 0xfb; // MPEG-1 Layer III
    frame[2] = 0x90; // 128 kbps, 44100 Hz, no padding
    frame[3] = 0x00;
    frames.push(frame);
  }
  return Buffer.concat(frames);
}

/**
 * Build a minimal MP3: optional ID3v2.3 tag (TIT2/TPE1/TALB + APIC picture)
 * followed by silent MPEG-1 Layer III frames.
 */
export function makeMp3({ title, artist, album, track, picture } = {}) {
  const frames = [];
  if (title !== undefined) frames.push(textFrame('TIT2', title));
  if (artist !== undefined) frames.push(textFrame('TPE1', artist));
  if (album !== undefined) frames.push(textFrame('TALB', album));
  if (track !== undefined) frames.push(textFrame('TRCK', String(track)));
  if (picture) frames.push(apicFrame(picture.data, picture));

  const audio = silentMp3Frames(3);
  if (frames.length === 0) return audio;

  const tagBody = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = 0x03; // v2.3
  header[4] = 0x00;
  header[5] = 0x00;
  for (let i = 0; i < 4; i++) header[6 + i] = SYNCSAFE(tagBody.length)[i];
  return Buffer.concat([header, tagBody, audio]);
}

let boundaryCounter = 0;

/**
 * Build a raw multipart/form-data body. `parts` is an ordered array of
 * { name, value } fields and { name, filename, contentType, data } files,
 * so callers can reproduce the alternating files/paths contract exactly.
 */
export function multipart(parts, boundary = `testboundary${Date.now()}${boundaryCounter++}`) {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'latin1'));
    if (part.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`,
          'latin1',
        ),
      );
      chunks.push(part.data);
      chunks.push(Buffer.from('\r\n', 'latin1'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`, 'latin1'));
      chunks.push(Buffer.from(String(part.value), 'latin1'));
      chunks.push(Buffer.from('\r\n', 'latin1'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
