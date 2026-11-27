const http = require('http'), fs = require('fs'), path = require('path'); const { chromium } = require('playwright')
const D = path.join(__dirname, '..', 'mobile-web-promo'), OUT = path.join(__dirname, '..', 'app-ecrans-promo')
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json' }
http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); for (const c of [u, u + '.html', u + '/index.html', '/index.html']) { const f = path.join(D, c); if (fs.existsSync(f) && fs.statSync(f).isFile()) { r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); return r.end(fs.readFileSync(f)) } } r.writeHead(404); r.end() }).listen(4895, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  const p = await ctx.newPage()
  const shot = async n => { await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/${n}.png` });
    const bx = await p.evaluate(() => [...document.querySelectorAll('[role=button], button, a, input, textarea, div, span')].filter(e => e.children.length <= 3).map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), texte: (e.innerText || e.getAttribute('aria-label') || e.value || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 80), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }).filter(b => b.texte && b.w > 0 && b.h > 0 && b.y < 844 && b.y > -50 && b.h < 300))
    fs.writeFileSync(`${OUT}/${n}.boites.json`, JSON.stringify(bx)); const t = await p.evaluate(() => document.body.innerText.slice(0, 600)); console.log('==', n, '\n', t.replace(/\n+/g, ' | ')) }
  const clic = async txt => { const l = p.getByText(txt, { exact: false }).first(); await l.click({ timeout: 4000 }).catch(e => console.log('pas trouvé', txt)) }
  await p.goto('http://localhost:4895/new?demo=full', { waitUntil: 'networkidle' }); await shot('n1')
  await clic('Bibliothèque'); await shot('n2')
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('#')) await shot(a.slice(1))
    else if (a.startsWith('titre=')) await p.locator('input').first().fill(a.slice(6))
    else if (a.startsWith('legende=')) await p.locator('textarea').first().fill(a.slice(8).replace(/\\n/g, '\n'))
    else if (a.startsWith('scroll=')) { await p.mouse.move(195, 400); await p.mouse.wheel(0, +a.slice(7)); await p.waitForTimeout(500) }
    else if (a.startsWith('tape=')) { const [xy, v] = a.slice(5).split(':'); const [x, y] = xy.split(',').map(Number); await p.mouse.click(x, y); await p.keyboard.press('Control+A'); await p.keyboard.type(v); await p.mouse.click(195, 420); await p.waitForTimeout(400) }
    else if (a.startsWith('nth=')) { const [i, v] = a.slice(4).split(':'); const l = p.locator('input').nth(+i); await l.fill(v); await l.press('Tab'); await p.waitForTimeout(300) }
    else if (a.startsWith('champ=')) { const [lbl, v] = a.slice(6).split(':'); const l = p.locator(`input[aria-label="${lbl}"]`).first(); if (await l.count()) { await l.fill(v); await l.blur() } else console.log('champ absent', lbl) }
    else if (a.startsWith('url=')) { await p.goto('http://localhost:4895' + a.slice(4) + (a.includes('?') ? '&' : '?') + 'demo=full', { waitUntil: 'networkidle' }); }
    else if (a.startsWith('box=')) { const bx = await p.evaluate(t => [...document.querySelectorAll('div,span,input,textarea')].filter(e => (e.innerText || e.value || e.placeholder || '').trim().startsWith(t) && e.children.length <= 2).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }).slice(0, 3), a.slice(4)); console.log('BOX', a.slice(4), JSON.stringify(bx)) }
    else await clic(a)
  }
  await b.close(); process.exit(0)
})
