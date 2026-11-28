// Generates demo.wav (soft synthwave with A-minor pads) and lyrics.json
// (word-timed lines; one line-timed-only line; background vocals; two instrumental gaps).
import { writeFileSync } from "node:fs";

const SR = 22050;
const DUR = 96;
const out = new Float32Array(SR * DUR);

const NOTE = { A2: 110.0, B2: 123.47, C3: 130.81, D3: 146.83, E3: 164.81, F2: 87.31, G2: 98.0, A3: 220.0, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F3: 174.61, G3: 196.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G4: 392.0, F4: 349.23 };
// chord: [root, third, fifth] per 4.5 s segment, A minor feel
const progression = [
  ["A2", "C3", "E3"], ["A2", "C3", "E3"], ["F2", "A2", "C3"], ["F2", "A2", "C3"],
  ["C3", "E3", "G3"], ["C3", "E3", "G3"], ["G2", "B2", "D3"], ["G2", "B2", "D3"],
  ["A2", "C3", "E3"], ["F2", "A2", "C3"], ["C3", "E3", "G3"], ["G2", "B2", "D3"],
  ["A2", "C3", "E3"], ["F2", "A2", "C3"], ["C3", "E3", "G3"], ["G2", "B2", "D3"],
];
const SEG = DUR / progression.length;

function env(t, a, d, s, r, len) {
  if (t < 0 || t > len) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len - r) return s;
  return s * Math.max(0, (len - t) / r);
}

function addTone(freq, t0, dur, amp, type = "sine", attack = 0.08, release = 0.4) {
  const start = Math.floor(t0 * SR), end = Math.min(out.length, Math.floor((t0 + dur) * SR));
  for (let i = start; i < end; i++) {
    const t = (i - start) / SR;
    const e = env(t, attack, dur * 0.3, 0.75, release, dur);
    const ph = 2 * Math.PI * freq * t;
    let v;
    if (type === "sine") v = Math.sin(ph);
    else if (type === "triangle") v = (2 / Math.PI) * Math.asin(Math.sin(ph));
    else if (type === "square") v = Math.tanh(2.2 * Math.sin(ph));
    else v = Math.sin(ph);
    out[i] += v * amp * e;
  }
}

progression.forEach((chord, idx) => {
  const t0 = idx * SEG;
  // pad
  for (const n of chord) addTone(NOTE[n] * 2, t0 + 0.05, SEG + 0.4, 0.075, "sine", 1.2, 1.4);
  // bass
  addTone(NOTE[chord[0]] / 2, t0 + 0.02, SEG * 0.55, 0.16, "sine", 0.03, 0.5);
  addTone(NOTE[chord[0]] / 2, t0 + SEG * 0.5 + 0.03, SEG * 0.4, 0.12, "sine", 0.03, 0.4);
  // arpeggio: chord tones up two octaves, eighth notes
  const arp = [chord[0], chord[1], chord[2], chord[0], chord[2], chord[1], chord[2], chord[0]];
  const beat = SEG / 8;
  arp.forEach((n, k) => addTone(NOTE[n] * 4, t0 + k * beat + 0.02, beat * 0.92, k % 4 === 0 ? 0.055 : 0.038, "triangle", 0.01, 0.09));
  // soft kick on 1 and 3
  addTone(58, t0 + 0.01, 0.32, 0.5, "sine", 0.005, 0.28);
  addTone(58, t0 + SEG / 2 + 0.01, 0.32, 0.4, "sine", 0.005, 0.28);
});

// gentle overall fade in/out + soft clip
const fi = Math.floor(0.6 * SR), fo = Math.floor((DUR - 2.5) * SR);
for (let i = 0; i < out.length; i++) {
  if (i < fi) out[i] *= i / fi;
  if (i > fo) out[i] *= Math.max(0, (out.length - i) / (out.length - fo));
  out[i] = Math.tanh(out[i] * 1.15) * 0.9;
}

const pcm = Buffer.alloc(out.length * 2);
for (let i = 0; i < out.length; i++) {
  const v = Math.max(-1, Math.min(1, out[i]));
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8);
hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
const DIR = new URL(".", import.meta.url).pathname;
writeFileSync(DIR + "demo.wav", Buffer.concat([hdr, pcm]));

// ---- lyrics ----
const LINE = (t, text, dur, opts = {}) => ({ t, text, dur, ...opts });
const raw = [
  LINE(9.0, "тихий гул над спящим городом", 4.2),
  LINE(13.5, "рельсы поют под колёсами", 4.0),
  LINE(18.0, "ночь собирает свои голоса", 4.3, { bg: "шё-о-ом" }),
  LINE(22.5, "а мы летим в завтрашний день", 4.1),
  LINE(27.0, "mile after mile of neon light", 4.2),
  LINE(31.5, "we don't know where this ride goes", 4.3, { lineOnly: true }),
  // instrumental break 36.0–40.5
  LINE(40.5, "город давно уснул в зеркалах", 4.2),
  LINE(45.0, "только вокзал машет рукой", 4.1),
  LINE(49.5, "и радио шепчет на старой волне", 4.4, { bg: "ла-ла-ла" }),
  LINE(54.0, "мы дети ночного поезда", 4.0),
  LINE(58.5, "stay with me till the morning comes", 4.4),
  LINE(63.0, "когда рассвет откроет глаза", 4.2),
  // instrumental break 67.5–72.0
  LINE(72.0, "и всё начнётся сначала", 4.0),
  LINE(76.5, "mile after mile, but the night is ours", 4.5),
  LINE(81.0, "мы вернёмся домой на рассвете", 4.2),
  LINE(85.5, "пока город спит до утра", 4.6),
];
const spread = (l) => {
  // word times shared out by length over (dur - 0.5), small gaps between words
  const words = l.text.split(" ");
  if (l.bg) words.push(l.bg);
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = l.dur - 0.4;
  let at = l.t + 0.1;
  const outWords = [];
  for (let i = 0; i < words.length; i++) {
    const w = (weights[i] / total) * span;
    const end = at + w - 0.04;
    outWords.push({ t: +at.toFixed(2), end: +end.toFixed(2), text: i < words.length - 1 ? words[i] + " " : words[i], ...(words[i] === l.bg ? { bg: true } : {}) });
    at = end + 0.04;
  }
  return outWords;
};
const synced = raw.map((l) => {
  const line = { t: l.t, text: l.bg ? `${l.text} (${l.bg})` : l.text };
  if (!l.lineOnly) line.words = spread(l);
  return line;
});
const plain = synced.map((l) => l.text).join("\n");
writeFileSync(DIR + "lyrics.json", JSON.stringify({ synced, plain }, null, 2));
console.log("wav + lyrics written;", synced.length, "lines,", synced.filter((l) => l.words).length, "word-timed");
