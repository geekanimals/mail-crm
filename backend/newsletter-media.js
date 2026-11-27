// Newsletter photos and videos: made email-ready once on upload, then used in any issue.
//  - photos: made at most 1200 px wide (shown at 250 px, so they stay sharp on phones); WebP / HEIC become JPG
//    because some email apps cannot show them
//  - videos: email apps do not play video, so a short moving GIF (with a play button) is made from the start
//    of the video. The video file is kept: a click opens it when the slot has no link of its own.
// Needs ffmpeg: the "ffmpeg-static" package (npm install), FFMPEG_PATH in .env, or ffmpeg on the server.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UPLOAD_DIR } from './routes/files.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_DIR = path.join(UPLOAD_DIR, 'newsletter');
export const ASSET_DIR = path.join(here, 'assets', 'newsletter');
const PLAY = path.join(ASSET_DIR, 'play.png');
const GIF_MAX = 2.5 * 1024 * 1024; // bigger GIFs load slowly and some apps cut them
export const MAX_UPLOAD = 150 * 1024 * 1024;
// Every photo / video gets a copy filled to each fixed box of the design (the edges may be cut a little, the middle is
// kept), so all photos in a section are the same size: h = Featured Highlights (4:5), s = Stories (2:3).
export const BOXES = { h: { w: 540, h: 675 }, s: { w: 540, h: 810 } };
export const BOX_V = 4; // version of the box copies (new file names, so no old cached copy is shown)
const fill = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1`;

let bin;
async function ffmpeg() {
  if (bin !== undefined) return bin;
  bin = process.env.FFMPEG_PATH || null;
  if (!bin) {
    try {
      const m = await import('ffmpeg-static');
      bin = m.default || null;
    } catch {
      bin = null;
    }
  }
  bin ||= 'ffmpeg';
  return bin;
}
function run(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    ffmpeg().then((b) => {
      const p = spawn(b, ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      const t = setTimeout(() => p.kill('SIGKILL'), timeout);
      p.stderr.on('data', (d) => (err = (err + d).slice(-6000)));
      p.on('error', (e) => (clearTimeout(t), reject(Object.assign(new Error(e.code === 'ENOENT' ? 'ffmpeg is not installed on the server, so photos and videos cannot be prepared. Run npm install in the backend folder.' : e.message), { status: 500 }))));
      p.on('close', (code) => (clearTimeout(t), code === 0 ? resolve(err) : reject(Object.assign(new Error(err.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || 'ffmpeg failed'), { status: 400 }))));
    });
  });
}
/** is ffmpeg there? (shown on the Newsletter page) */
export async function ffmpegReady() {
  try {
    await run(['-version'], 10000);
    return true;
  } catch {
    return false;
  }
}
/** width, height, seconds of a photo / video */
async function probe(file) {
  const out = await run(['-i', file, '-f', 'null', '-frames:v', '1', '-'], 60000).catch((e) => String(e.message));
  const m = String(out).match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const t = String(out).match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { width: m ? +m[1] : 0, height: m ? +m[2] : 0, seconds: t ? +t[1] * 3600 + +t[2] * 60 + +t[3] : 0 };
}
const size = async (f) => (await fs.stat(f)).size;
const rnd = () => crypto.randomBytes(12).toString('hex');

const IMAGE = /^(jpe?g|png|webp|gif|heic|heif|avif)$/i;
const VIDEO = /^(mp4|mov|m4v|webm|mkv|avi)$/i;

/** buffer -> { kind, file, video?, poster?, width, height, bytes } (files saved in MEDIA_DIR) */
export async function prepare(buffer, name, { start = 0 } = {}) {
  const ext = String(path.extname(name || '').slice(1) || '').toLowerCase();
  const kind = IMAGE.test(ext) ? 'image' : VIDEO.test(ext) ? 'video' : null;
  if (!kind) throw Object.assign(new Error('Upload a photo (JPG, PNG, WebP, GIF) or a video (MP4, MOV, WebM)'), { status: 400 });
  if (!buffer?.length) throw Object.assign(new Error('The file is empty'), { status: 400 });
  if (buffer.length > MAX_UPLOAD) throw Object.assign(new Error('The file is too big (150 MB at most)'), { status: 400 });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const id = rnd();
  const src = path.join(MEDIA_DIR, `${id}-src.${ext}`);
  await fs.writeFile(src, buffer);
  const made = [];
  try {
    if (kind === 'image') {
      const info = await probe(src);
      if (!info.width) throw Object.assign(new Error('This photo could not be read. Please upload a JPG or PNG.'), { status: 400 });
      let file;
      if (ext === 'gif') {
        // a moving GIF: kept as it is when it is small enough, else made smaller
        file = `${id}.gif`;
        if (buffer.length <= GIF_MAX && info.width <= 1200) await fs.copyFile(src, path.join(MEDIA_DIR, file));
        else await gif(src, path.join(MEDIA_DIR, file), { ...info, seconds: 0 });
      } else if (ext === 'png') {
        file = `${id}.png`;
        await run(['-i', src, '-vf', "scale='min(1200,iw)':-2", '-frames:v', '1', path.join(MEDIA_DIR, file)]);
      } else {
        file = `${id}.jpg`;
        await run(['-i', src, '-vf', "scale='min(1200,iw)':-2,format=yuvj420p", '-frames:v', '1', '-q:v', '3', path.join(MEDIA_DIR, file)]);
      }
      made.push(file);
      const boxes = await makeBoxes(src, id, ext, 'image');
      made.push(boxes.h, boxes.s);
      const out = await probe(path.join(MEDIA_DIR, file));
      await fs.rm(src, { force: true });
      return { kind, file, variants: boxes, width: out.width, height: out.height, bytes: await size(path.join(MEDIA_DIR, file)) };
    }

    // a video
    const info = await probe(src);
    if (!info.width) throw Object.assign(new Error('This video could not be read. Please upload an MP4.'), { status: 400 });
    const from = Math.max(0, Math.min(Number(start) || 0, Math.max(0, info.seconds - 1)));
    const poster = `${id}-poster.jpg`;
    await run(['-ss', String(Math.min(from + 0.5, Math.max(0, info.seconds - 0.1))), '-i', src, '-frames:v', '1', '-vf', "scale='min(800,iw)':-2,format=yuvj420p", '-q:v', '4', path.join(MEDIA_DIR, poster)]);
    made.push(poster);
    const file = `${id}.gif`; // its own shape, nothing cut
    await gif(src, path.join(MEDIA_DIR, file), { from, play: true, width: info.width, height: info.height });
    made.push(file);
    const boxes = await makeBoxes(src, id, ext, 'video', from);
    made.push(boxes.h, boxes.s);
    // the video itself, opened by a click: MP4 is kept as it is, other types become MP4 so every browser plays it
    let video = `${id}.mp4`;
    if (ext === 'mp4' || ext === 'm4v') await fs.rename(src, path.join(MEDIA_DIR, video));
    else {
      try {
        await run(['-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-movflags', '+faststart', '-vf', "scale='min(1280,iw)':-2", path.join(MEDIA_DIR, video)], 600000);
      } catch {
        video = `${id}.${ext}`; // could not convert: the original is kept
        await fs.rename(src, path.join(MEDIA_DIR, video));
      }
      await fs.rm(src, { force: true });
    }
    made.push(video);
    const out = await probe(path.join(MEDIA_DIR, file));
    return { kind, file, variants: boxes, video, poster, width: out.width, height: out.height, bytes: await size(path.join(MEDIA_DIR, file)) };
  } catch (e) {
    await fs.rm(src, { force: true }).catch(() => {});
    for (const f of made) await fs.rm(path.join(MEDIA_DIR, f), { force: true }).catch(() => {});
    throw e;
  }
}

/** a short looping GIF (4 seconds), made smaller step by step until it is light enough for email */
async function gif(src, out, { from = 0, play = false, seconds = 4, width = 0, height = 0, box = null } = {}) {
  const tries = [
    { w: 500, h: 640, fps: 10 },
    { w: 420, h: 540, fps: 9 },
    { w: 340, h: 440, fps: 8 },
    { w: 280, h: 360, fps: 7 },
  ];
  for (const [i, t] of tries.entries()) {
    // box: filled to that box; otherwise keeps its own shape (nothing cut), only made smaller
    const bw = t.w;
    const bh = box ? Math.round((t.w * box.h) / box.w / 2) * 2 : 0;
    const fit = box ? fill(bw, bh) : `scale='min(${t.w},iw)':'min(${t.h},ih)':force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    // the play button: about a quarter of the GIF's shorter side
    const r = width && height ? Math.min(t.w / width, t.h / height, 1) : 1;
    const shortSide = box ? Math.min(bw, bh) : Math.min((width || t.w) * r, (height || t.h) * r);
    const btn = Math.max(36, Math.round((shortSide * 0.26) / 2) * 2);
    const overlay = play ? `[1:v]scale=${btn}:${btn}[p];[v][p]overlay=(W-w)/2:(H-h)/2[o]` : '[v]null[o]';
    const args = [
      ...(seconds ? ['-ss', String(from), '-t', String(seconds)] : []),
      '-i', src,
      ...(play ? ['-i', PLAY] : []),
      '-filter_complex', `[0:v]fps=${t.fps},${fit}[v];${overlay};[o]split[a][b];[a]palettegen=max_colors=${i < 2 ? 128 : 96}:stats_mode=diff[pal];[b][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0',
      out,
    ];
    await run(args);
    if ((await size(out)) <= GIF_MAX || i === tries.length - 1) return;
  }
}

/** the box copies (a photo, a moving GIF, or a video's moving picture): { h, s, v } */
async function makeBoxes(src, id, ext, kind, from = 0) {
  const out = { v: BOX_V };
  for (const [k, b] of Object.entries(BOXES)) {
    if (kind === 'video' || ext === 'gif') {
      out[k] = `${id}-${k}${BOX_V}.gif`;
      await gif(src, path.join(MEDIA_DIR, out[k]), { from, play: kind === 'video', seconds: kind === 'video' ? 4 : 0, box: b });
    } else {
      out[k] = `${id}-${k}${BOX_V}.${ext === 'png' ? 'png' : 'jpg'}`;
      await run(['-i', src, '-vf', ext === 'png' ? fill(b.w, b.h) : `${fill(b.w, b.h)},format=yuvj420p`, '-frames:v', '1', ...(ext === 'png' ? [] : ['-q:v', '3']), path.join(MEDIA_DIR, out[k])]);
    }
  }
  return out;
}

/** media uploaded before the box copies (or with an older version): make them once, from the saved files */
export async function ensureBox(m) {
  if (m.variants?.h && m.variants?.s && m.variants?.v === BOX_V) return null;
  const id = path.basename(m.file).replace(/\.[a-z0-9]+$/i, '');
  const src = path.join(MEDIA_DIR, path.basename(m.kind === 'video' ? m.video || m.file : m.file));
  const ext = path.extname(src).slice(1).toLowerCase();
  const made = await makeBoxes(src, id, ext, m.kind);
  for (const old of [m.variants?.h, m.variants?.s]) if (old && old !== made.h && old !== made.s) await fs.rm(path.join(MEDIA_DIR, path.basename(old)), { force: true }).catch(() => {});
  return made;
}

export async function removeFiles(m) {
  for (const f of [m.file, m.video, m.poster, m.variants?.h, m.variants?.s] /* variants: cut copies from an earlier version */.filter(Boolean)) await fs.rm(path.join(MEDIA_DIR, path.basename(f)), { force: true }).catch(() => {});
}
