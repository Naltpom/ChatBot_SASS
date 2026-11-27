// node pilotes.mjs [ids…] : vidéos promo v2 (pilotes). Voix traitée → plan calé sur les mots → rendu Remotion → -14 LUFS → contrôles.
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
const R = path.resolve('.'); const P = process.env.PILOTES || path.resolve('../pilotes'); const OUT = `${P}/videos`; fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(`${R}/public/voix`, { recursive: true })
const sh = (c, a) => execFileSync(c, a, { maxBuffer: 1e8 }).toString()
const shErr = (c, a) => { try { return execFileSync(c, a, { maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'pipe'] }).toString() } catch (e) { return String(e.stderr) } }
import { spawnSync } from 'node:child_process'
function require_spawn(c, a) { return spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1e8 }).stderr }

const norm = w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')

// ---------- Plans des 3 vidéos (coordonnées en px CSS de l'écran mobile 390×844, boîtes mesurées par la capture) ----------
const CASE = { x: 44, y: 456, w: 22, h: 22 }            // case « Atelier Lumen » (Groupes), composer-2
const PUCES = [{ x: 34, y: 188, w: 172, h: 36 }, { x: 34, y: 230, w: 172, h: 36 }, { x: 34, y: 272, w: 166, h: 36 }]
const VIDEOS = {
  pov: {
    musique: 'musique/voxel.mp3', accroche: 'POV : CM débordé',
    cles: ['huit', 'trois', 'seule', 'comptes', 'heure', 'semaine', 'gratuit'],
    plans: (L, at) => [
      { type: 'chaos', lignes: [0, 1], horloge: 0, apparitions: [at(1, 'tiktok'), at(1, 'youtube'), at(1, 'instagram')], comptes8: [at(0, 'huit'), at(0, 'remplir')] },
      { type: 'ecran', lignes: [2], ecran: 'composer-1', entree: 'punch', cam: [[0, 195, 430, 0.82, 12, -20], [at(2, 'chapote'), 195, 400, 1.0, 4, -6], [at(2, 'une'), 190, 190, 2.1, 0, 0], [1, 200, 205, 2.25, 0, 0]],
        hl: [[at(2, 'envoies'), 1, 16, 128, 358, 118]], sons: [[0, 'sons/punch.ogg', 0.5]] },
      { type: 'ecran', lignes: [3], ecran: 'composer-2', entree: 'whip', cam: [[0, 195, 520, 1.9], [at(3, 'coches'), 170, 470, 2.2], [1, 150, 250, 2.0]],
        taps: [[at(3, 'coches'), CASE.x + 11, CASE.y + 11]], masques: [[at(3, 'coches') + 0.12, CASE.x - 3, CASE.y - 3, CASE.w + 6, CASE.h + 6, 'case'], [at(3, 'coches') + 0.12, 32, 150, 330, 162, 'blanc']] },
      { type: 'ecran', lignes: [4], ecran: 'composer-2-date', entree: 'whip', cam: [[0, 195, 430, 1.3, 6, 8], [at(4, 'jour'), 195, 520, 2.0], [1, 230, 545, 2.4]],
        taps: [[at(4, 'jour'), 60, 543], [at(4, 'heure'), 271, 543]], hl: [[at(4, 'jour') + 0.1, 1, 34, 482, 322, 30]] },
      { type: 'ecran', lignes: [5], ecran: 'publication-plateformes', entree: 'whip', cam: [[0, 195, 560, 1.25, 8, -10], [0.45, 195, 670, 1.8], [1, 200, 680, 1.95]],
        badges: [[0.25, 24, 602], [0.45, 24, 679], [0.65, 24, 757]] },
      { type: 'fin', lignes: [6] },
    ],
  },
  resultat: {
    musique: 'musique/werq.mp3', accroche: '1 vidéo → 3 réseaux',
    cles: ['trois', 'une', 'bibliotheque', 'legende', 'tiktok', 'dixhuit', 'part', 'gratuit'],
    plans: (L, at) => [
      { type: 'ecran', lignes: [0], ecran: 'publication-plateformes', entree: 'punch', cam: [[0, 195, 600, 1.15, 10, -14], [0.5, 195, 680, 1.75], [1, 195, 690, 1.9]],
        badges: [[at(0, 'partir'), 24, 602], [at(0, 'trois'), 24, 679], [at(0, 'reseaux'), 24, 757]] },
      { type: 'texte', lignes: [1], cles: ['quune'], sansSousTitres: true },
      { type: 'ecran', lignes: [2], ecran: 'bibliotheque-videos', entree: 'whip', cam: [[0, 195, 400, 1.05, 6, 10], [0.55, 103, 380, 1.9], [1, 103, 390, 2.05]],
        taps: [[at(2, 'bibliotheque'), 103, 400]], hl: [[at(2, 'bibliotheque') + 0.1, 1, 18, 254, 172, 268]] },
      { type: 'ecran', lignes: [3], ecran: 'composer-1', entree: 'whip', cam: [[0, 195, 420, 1.4], [0.5, 195, 590, 2.1], [1, 195, 600, 2.25]],
        taps: [[at(3, 'legende') - 0.2, 195, 590]], hl: [[at(3, 'legende'), 1, 34, 529, 322, 128]] },
      { type: 'ecran', lignes: [4], ecran: 'composer-2', entree: 'whip', cam: [[0, 195, 500, 2.0], [at(4, 'coche'), 170, 470, 2.2], [at(4, 'tiktok'), 120, 230, 2.4], [1, 120, 250, 2.4]],
        taps: [[at(4, 'coche'), CASE.x + 11, CASE.y + 11]], masques: [[at(4, 'coche') + 0.12, CASE.x - 3, CASE.y - 3, CASE.w + 6, CASE.h + 6, 'case'], [at(4, 'coche') + 0.12, 32, 150, 330, 162, 'blanc']],
        hl: [[at(4, 'tiktok'), at(4, 'youtube'), ...Object.values(PUCES[0])], [at(4, 'youtube'), at(4, 'instagram'), ...Object.values(PUCES[1])], [at(4, 'instagram'), 1, ...Object.values(PUCES[2])]] },
      { type: 'ecran', lignes: [5], ecran: 'composer-2-date', entree: 'whip', cam: [[0, 195, 450, 1.4, 6, 8], [0.4, 240, 540, 2.3], [1, 250, 545, 2.5]],
        taps: [[at(5, 'dixhuit'), 271, 543]], hl: [[at(5, 'dixhuit') + 0.1, 1, 240, 514, 63, 63]] },
      { type: 'texte', lignes: [6], cles: ['part'], sansSousTitres: true },
      { type: 'texte', lignes: [7], cles: ['tiktok'], sansSousTitres: true },
      { type: 'fin', lignes: [7], debut: at(7, 'gratuit') },
    ],
  },
  'avant-apres': {
    musique: 'musique/newerwave.mp3', accroche: 'Tu fais encore ça ?',
    cles: ['alarmes', 'seul', 'une', 'ecran', 'gratuit'],
    plans: (L, at) => [
      { type: 'texte', lignes: [0], cles: ['avant'], sansSousTitres: true },
      { type: 'chaos', lignes: [1], horloge: 0, apparitions: [at(1, 'envois'), at(1, 'legendes'), at(1, 'alarmes')] },
      { type: 'split', lignes: [2], sons: [[0, 'sons/impact.wav', 0.5]] },
      { type: 'ecran', lignes: [3], ecran: 'composer-2', entree: 'whip', cam: [[0, 195, 500, 1.9, 4, 8], [at(3, 'fois'), 170, 470, 2.2], [at(3, 'tous'), 120, 240, 2.3], [1, 120, 250, 2.35]],
        taps: [[at(3, 'fois'), CASE.x + 11, CASE.y + 11]], masques: [[at(3, 'fois') + 0.12, CASE.x - 3, CASE.y - 3, CASE.w + 6, CASE.h + 6, 'case'], [at(3, 'fois') + 0.12, 32, 150, 330, 162, 'blanc']] },
      { type: 'ecran', lignes: [4], ecran: 'planning', entree: 'whip', cam: [[0, 195, 422, 0.9, 14, -18], [0.4, 195, 600, 1.7, 0, 0], [0.75, 195, 720, 1.9], [1, 195, 730, 1.95]],
        hl: [[at(4, 'semaine'), 1, 16, 569, 358, 67]] },
      { type: 'fin', lignes: [5] },
    ],
  },
}

function son(t, src, vol) { return { t, src, vol } }

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIDEOS)
  const prets = []
  for (const id of ids) {
    const src = `${P}/voix/${id}.mp3.mp3`, wj = `${P}/voix/${id}.mp3.words.json`
    if (!fs.existsSync(src) || !fs.existsSync(wj)) { console.log('pas de voix', id); continue }
    let mots = JSON.parse(fs.readFileSync(wj, 'utf8')).filter(m => /[\p{L}\p{N}]/u.test(m.word))
    // 1. Voix : débit naturel (aucune accélération, silences gardés), une respiration ajoutée entre les phrases
    //    (0,5 s entre deux lignes du script, 0,25 s après un point dans une ligne), premier mot à 0,1 s ; puis chaîne radio.
    const total = +sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])
    const lignesTxt = fs.readFileSync(`${P}/voix/${id}.txt`, 'utf8').trim().split('\n')
    const finsLigne = new Set(); { let k = 0; for (const l of lignesTxt) { k += l.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length; finsLigne.add(k - 1) } }
    const debut = Math.max(0, mots[0].start - 0.1)
    const coupes = []   // [temps de coupe, silence ajouté]
    mots.forEach((m, i) => {
      if (i === mots.length - 1) return
      const pause = finsLigne.has(i) ? 0.5 : /[.!?]$/.test(m.word) ? 0.25 : 0
      if (pause) coupes.push([(m.end + mots[i + 1].start) / 2, pause])
    })
    const garde = []; let cur = debut
    for (const [c, p] of coupes) { garde.push([cur, c, p]); cur = c }
    garde.push([cur, total, 0])
    const remap = t => { let off = 0; for (const [a, b, p] of garde) { if (t <= b) return off + Math.max(0, t - a); off += b - a + p } return off }
    mots = mots.map(m => ({ ...m, start: +remap(m.start).toFixed(3), end: +remap(Math.max(m.start + 0.05, m.end)).toFixed(3) }))
    const fc = garde.map(([a, b, p], i) => `[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS${p ? `,apad=pad_dur=${p}` : ''}[s${i}]`).join(';') + ';' + garde.map((_, i) => `[s${i}]`).join('') + `concat=n=${garde.length}:v=0:a=1,` +
      'highpass=f=90,equalizer=f=220:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=1.2:g=3.5,equalizer=f=9000:t=q:w=1:g=1.5,acompressor=threshold=-21dB:ratio=3.5:attack=4:release=90:makeup=5dB,deesser=i=0.35,alimiter=limit=0.89[o]'
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-filter_complex', fc, '-map', '[o]', '-ar', '48000', `${R}/public/voix/${id}.wav`])
    console.log(`  ${id} : voix ${total.toFixed(2)} s → ${garde.reduce((x, [a, b, p]) => x + b - a + p, 0).toFixed(2)} s`)
    prets.push({ id, mots })
  }
  const serve = await bundle({ entryPoint: `${R}/src/index.ts`, publicDir: `${R}/public` })
  for (const { id, mots: mots0 } of prets) {
    const V = VIDEOS[id]
    const texte = fs.readFileSync(`${P}/voix/${id}.txt`, 'utf8').trim().split('\n')
    // 2. Mots → phrases (compte des mots qui ont des lettres), mot-clé (un seul orange par phrase).
    let k = 0; const L = []
    texte.forEach((ligne, i) => {
      const n = ligne.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
      const ws = mots0.slice(k, k + n); k += n
      ws.forEach(w => { w.ligne = i })
      const c = ws.find(w => V.cles.includes(norm(w.word))); if (c) c.cle = true
      L.push({ start: ws[0].start, end: ws[ws.length - 1].end, ws })
    })
    if (k !== mots0.length) console.log(`  attention ${id} : ${mots0.length} mots horodatés, ${k} dans le texte`)
    // Ancre : fraction de la phrase (nombre ≤ 1) ou début d'un mot (« dixhuit » = dix-huit, recherché sans accents ni tirets).
    const at = (i, mot) => {
      const ws = L[i].ws
      const cible = norm(mot)
      for (let a = 0; a < ws.length; a++) { let s = ''; for (let b = a; b < ws.length && s.length < cible.length; b++) { s += norm(ws[b].word); if (s === cible) return 1000 + ws[a].start } }
      const w = ws.find(x => norm(x.word).startsWith(cible) || norm(x.word.split(/['’]/).pop()) === cible); if (w) return 1000 + w.start
      throw new Error(`${id} : mot « ${mot} » absent de la phrase ${i}`)
    }
    const dureeVoix = mots0[mots0.length - 1].end
    const duree = +(dureeVoix + 1.6).toFixed(2)
    const bruts = V.plans(L, at)
    const sons = [son(0, 'sons/impact.wav', 0.45)]
    const plans = bruts.map((b, j) => {
      const debut = x => x.debut !== undefined ? x.debut - 1000 - 0.08 : Math.max(0, L[x.lignes[0]].start - 0.12)
      const start = j === 0 ? 0 : debut(b)
      const next = bruts[j + 1]; const end = next ? debut(next) : duree
      // ancre de mot = 1000 + temps absolu ; sinon fraction du plan (0 = début, 1 = fin)
      const tt = x => (x >= 500 ? x - 1000 : start + (end - start) * x)
      const p = { type: b.type, start, end, etapes: undefined, ecran: b.ecran, entree: b.entree, cles: b.cles, sansSousTitres: b.sansSousTitres }
      if (b.cam) p.cam = b.cam.map(([t, x, y, z, rx = 0, ry = 0]) => ({ t: tt(t), x, y, z, rx, ry }))
      if (b.taps) p.taps = b.taps.map(([t, x, y]) => ({ t: tt(t), x, y }))
      if (b.hl) p.hl = b.hl.map(([t0, t1, x, y, w, h]) => ({ t0: tt(t0), t1: tt(t1), x, y, w, h }))
      if (b.masques) p.masques = b.masques.map(([t1, x, y, w, h, style]) => ({ t1: tt(t1), x, y, w, h, style }))
      if (b.badges) p.badges = b.badges.map(([t, x, y]) => ({ t: tt(t), x, y }))
      if (b.type === 'chaos') { p.horloge = tt(b.horloge); p.apparitions = b.apparitions.map(tt); p.comptes8 = b.comptes8 && b.comptes8.map(tt); p.etapes = [p.horloge, ...(p.comptes8 ? Array.from({ length: 8 }, (_, i) => p.comptes8[0] + (p.comptes8[1] - p.comptes8[0]) * i / 8) : [])]; if (p.comptes8) sons.push(son(p.comptes8[0], 'sons/pop.wav', 0.3), son(p.comptes8[0] + (p.comptes8[1] - p.comptes8[0]) / 2, 'sons/pop.wav', 0.3)) }
      // Sons : whoosh à chaque entrée glissée, clic sur chaque tap, ding sur chaque ✓, pop sur chaque carte.
      if (j > 0 && b.type !== 'fin') sons.push(son(start, b.entree === 'punch' ? 'sons/punch.ogg' : 'sons/whoosh.wav', 0.35))
      ;(p.taps || []).forEach(x => sons.push(son(x.t, 'sons/clic.wav', 0.6)))
      ;(p.badges || []).forEach(x => sons.push(son(x.t, 'sons/ding.wav', 0.22)))
      ;(p.hl || []).forEach(x => sons.push(son(x.t0, 'sons/pop.wav', 0.25)))
      ;(p.apparitions || []).forEach(x => sons.push(son(x, 'sons/pop.wav', 0.35)))
      ;(b.sons || []).forEach(([t, s, v]) => sons.push(son(tt(t), s, v)))
      if (b.type === 'split') { sons.push(son(start + 0.45, 'sons/punch.ogg', 0.4)); p.etapes = [start, start + 0.45, start + 1.0] }
      if (b.type === 'fin') { sons.push(son(start - 1.2, 'sons/riser.wav', 0.25)); sons.push(son(start, 'sons/impact.wav', 0.5)); sons.push(son(start + 0.3, 'sons/pop.wav', 0.3)); sons.push(son(start + 0.6, 'sons/pop.wav', 0.3)); p.etapes = [start, start + 0.3, start + 0.6, start + 1.6]; sons.push(son(start + 1.6, 'sons/ding.wav', 0.15)) }
      return p
    })
    const accroche = { texte: V.accroche, fin: Math.min(2.6, L[1] ? L[1].start : 2.4) }
    const props = { audio: `voix/${id}.wav`, musique: V.musique, volMusique: 0.32, duree, mots: mots0, accroche, plans, sons: sons.filter(s => s.t >= 0) }
    fs.writeFileSync(`${OUT}/${id}.props.json`, JSON.stringify(props, null, 1))
    const comp = await selectComposition({ serveUrl: serve, id: 'Pilote', inputProps: props })
    if (process.env.IMAGES) {
      for (const s of process.env.IMAGES.split(',').map(Number).concat(plans.flatMap(p => [p.start + 0.05, (p.start + p.end) / 2]))) {
        await renderStill({ composition: comp, serveUrl: serve, output: `${OUT}/${id}-${s.toFixed(2)}.png`, inputProps: props, frame: Math.min(comp.durationInFrames - 1, Math.round(s * 30)), scale: 0.5 })
      }
      console.log('images', id); continue
    }
    const brut = `${OUT}/${id}.brut.mp4`
    const t0 = Date.now()
    await renderMedia({ composition: comp, serveUrl: serve, codec: 'h264', outputLocation: brut, inputProps: props, concurrency: 3, logLevel: 'error', crf: 16 })
    // 3. Mix final à -14 LUFS / -1 dBTP (deux passes), 1080×1920.
    const m = require_spawn('ffmpeg', ['-i', brut, '-af', 'loudnorm=I=-14:TP=-1:LRA=9:print_format=json', '-f', 'null', '-'])
    const j = JSON.parse(m.slice(m.lastIndexOf('{')))
    const final = `${OUT}/${id}.mp4`
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', brut, '-af', `loudnorm=I=-14:TP=-1:LRA=9:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.8:level=false,aresample=48000`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final])
    fs.rmSync(brut)
    // 4. Contrôles automatiques.
    const lu = require_spawn('ffmpeg', ['-i', final, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
    const I = +(lu.match(/I:\s+(-?[\d.]+) LUFS/g) || ['']).pop().match(/-?[\d.]+/)[0]
    const TP = +(lu.match(/Peak:\s+(-?[\d.]+) dBFS/g) || ['']).pop().match(/-?[\d.]+/)[0]
    const fr = require_spawn('ffmpeg', ['-i', final, '-vf', 'freezedetect=n=0.002:d=1.5', '-map', '0:v', '-f', 'null', '-'])
    const figes = (fr.match(/freeze_duration: [\d.]+/g) || []).map(x => +x.split(' ')[1])
    const evts = [...plans.flatMap(p => p.etapes || []), ...mots0.filter((m, i) => plans.find(p => p.type === 'texte' && m.start >= p.start && m.start < p.end)).map(m => m.start), ...plans.map(p => p.start), ...sons.map(s => s.t), ...plans.flatMap(p => [...(p.cam || []).map(c => c.t), ...(p.taps || []).map(x => x.t)])].sort((a, b) => a - b)
    let trou = 0; for (let i = 1; i < evts.length; i++) trou = Math.max(trou, evts[i] - evts[i - 1]); trou = Math.max(trou, duree - evts[evts.length - 1])
    const motsS = mots0.length / dureeVoix
    const ctrl = { duree, premier_mot_s: mots0[0].start, mots_par_s: +motsS.toFixed(2), accroche_mots: V.accroche.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length,
      lufs: I, true_peak: TP, images_figees_1_5s: figes, plus_long_sans_evenement_s: +trou.toFixed(2), plans: plans.length, taps: plans.reduce((a, p) => a + (p.taps || []).length, 0) }
    const ok = ctrl.premier_mot_s <= 0.3 && Math.abs(I + 14) <= 1 && TP <= -0.9 && !figes.length && ctrl.accroche_mots <= 6 && trou <= 2.2
    fs.writeFileSync(`${OUT}/${id}.controles.json`, JSON.stringify({ ...ctrl, ok }, null, 1))
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '0.5', '-i', final, '-frames:v', '1', '-q:v', '4', `${OUT}/${id}.jpg`])
    console.log(ok ? 'OK' : 'À REVOIR', id, JSON.stringify(ctrl), Math.round((Date.now() - t0) / 1000) + ' s')
  }
}
main()
