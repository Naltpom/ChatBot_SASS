# python3 recoller.py <dossier_voix> <id> <ancien_mp3> <ancien_words> <index_ligne> : refait une phrase et la recolle dans la voix.
import json, subprocess, sys, os, re
D, ID, MP3, WJ, I = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
PY = '/tmp/qwen-venv/bin/python'; TL = '/home/user/claude-cloud/scripts/tts_local.py'; REF = '/home/user/claude-cloud/voix/references/elevenlabs_saira.mp3'
lignes = open(f'{D}/{ID}.txt').read().strip().split('\n')
mots = [m for m in json.load(open(WJ))]
compte = lambda l: len([w for w in l.split() if re.search(r'\w', w)])
# mots (avec lettres) de chaque ligne dans l'ancienne voix (texte d'avant : même nombre de mots pour les autres lignes)
lettres = [m for m in mots if re.search(r'\w', m['word'])]
k = 0; bornes = []
for i, l in enumerate(lignes):
    n = compte(l) if i != I else None
    bornes.append(k); k += n if n is not None else 0
# la ligne I de l'ancienne voix : entre la fin de la ligne I-1 et le début de la ligne I+1
avant = lettres[:bornes[I]]; apres_debut = bornes[I + 1] if I + 1 < len(lignes) else None
nb_ancien = len(lettres) - bornes[I] - (sum(compte(l) for l in lignes[I + 1:]))
apres = lettres[bornes[I] + nb_ancien:]
t0 = avant[-1]['end'] + 0.05 if avant else 0.0
t1 = apres[0]['start'] - 0.05 if apres else None
txt = f'{D}/ligne{I}.txt'; open(txt, 'w').write(lignes[I] + '\n')
from difflib import SequenceMatcher
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower().replace('-', ' '))
best = None
if os.environ.get('WAV'):
    wv = os.environ['WAV']; best = (1.0, wv, json.load(open(wv + '.json')))
for essai in range(0 if best else 4):
    wav = f'{D}/ligne{I}-{essai}.wav'
    try:
        subprocess.run([PY, TL, '--engine', 'qwen3', '--text-file', txt, '--wav', wav, '--voice', REF], timeout=360, capture_output=True)
    except subprocess.TimeoutExpired:
        print('essai', essai, 'trop long'); continue
    if not os.path.exists(wav): continue
    js = wav + '.json'
    subprocess.run([PY, TL, '--engine', 'whisper', '--wav', wav, '--json', js], capture_output=True)
    w = json.load(open(js)); dit = ' '.join(x['word'] for x in w)
    r = SequenceMatcher(None, norm(dit), norm(lignes[I])).ratio()
    print('essai', essai, round(r, 3), dit, flush=True)
    if not best or r > best[0]: best = (r, wav, w)
    if r > 0.93: break
r, wav, w = best
fus = []
for x in w:
    if fus and (x['word'].startswith("'") or x['word'].startswith('’') or not re.search(r'\w', x['word'])): fus[-1] = {**fus[-1], 'word': fus[-1]['word'] + x['word'], 'end': x['end']}
    else: fus.append(dict(x))
w = fus
# recolle : [0, t0] ancien + nouvelle phrase + [t1, fin] ancien
seg = f'{D}/{ID}.recolle.wav'
dur_new = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], capture_output=True, text=True).stdout)
parts = ['-i', MP3, '-i', wav]
fc = f'[0:a]atrim=0:{t0:.3f},asetpts=PTS-STARTPTS,aresample=24000[a];[1:a]aresample=24000,apad=pad_dur=0.12[b];'
if t1 is not None: fc += f'[0:a]atrim={t1:.3f},asetpts=PTS-STARTPTS,aresample=24000[c];[a][b][c]concat=n=3:v=0:a=1[o]'
else: fc += '[a][b]concat=n=2:v=0:a=1[o]'
subprocess.run(['ffmpeg', '-v', 'error', '-y', *parts, '-filter_complex', fc, '-map', '[o]', '-b:a', '192k', f'{D}/{ID}.mp3.mp3'], check=True)
# mots : texte exact de la ligne posé sur les temps de Whisper (même nombre si possible)
cible = [x for x in lignes[I].split() if re.search(r'\w', x)]
if len(w) != len(cible): print('ATTENTION', len(w), 'mots entendus pour', len(cible))
nouveaux = [{'word': cible[j] if j < len(cible) else x['word'], 'start': round(t0 + x['start'], 3), 'end': round(t0 + x['end'], 3)} for j, x in enumerate(w[:len(cible)])]
dec = t0 + dur_new + 0.12 - (t1 if t1 is not None else 0)
apres2 = [{**m, 'start': round(m['start'] + dec, 3), 'end': round(m['end'] + dec, 3)} for m in apres] if t1 is not None else []
json.dump(avant + nouveaux + apres2, open(f'{D}/{ID}.mp3.words.json', 'w'), ensure_ascii=False)
print('OK', ID, 'ligne', I, 'ratio', round(r, 3))
