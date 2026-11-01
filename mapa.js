// Mapa Kella — dvě úrovně nad grafem analyzátoru.
//
// Proč vůbec: graf má 15 381 uzlů a 32 711 hran. Nakreslit je naráz nejde
// (bylo by ~400 000 SVG prvků) a hlavně to nemá smysl — z takového obrázku
// se nic nepřečte. Mapa proto nikdy nekreslí víc než ~150 uzlů:
//
//   L0  podsystémy          — kdo s kým mluví v celém systému
//   L1  programy jednoho podsystému + jeho sousedé
//   L2  vnitřek jednoho programu v měřítku řádků (jiná kresba, táž stránka)
//
// O KTERÉM systému to je, tenhle soubor NEVÍ. Nadpisy, popisy a poznámky jdou
// z data/mapa.json (blok `meta`), vnitřky programů z data/program/<ID>.json.
// Pro jinou codebase se vymění data, ne tahle šablona.
//
// Rozmístění je DETERMINISTICKÉ: pevné pořadí, pevný počet iterací, žádná
// náhoda a žádný čas. Dvě načtení musí dát tentýž obrázek, jinak se o mapě
// nedá mluvit („ten uzel vpravo nahoře“) a nejdou porovnat dva stavy.

const S = { data: null, uroven: 'L0', podsystem: null, program: null, pd: null,
  vybrany: null, vybranaCast: null, k: 1, x: 0, y: 0, fit: true,
  // Filtry. `prah` je nejmenší počet volání, aby se hrana kreslila — bez něj je
  // L0 chuchvalec, kde 130 vazeb vypadá stejně silně jako čtyři podstatné.
  filtr: { call: true, data: false, prah: 1, bezOsirelych: false } };
const SVG = 'http://www.w3.org/2000/svg';
const el = (t, a = {}) => { const e = document.createElementNS(SVG, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

// ---------------------------------------------------------------- rozmístění
/* Soustředné prstence podle HLOUBKY VOLÁNÍ, ne silový chuchvalec.
 *
 * Silový layout byl deterministický, ale poloha uzlu nic neznamenala. Tohle
 * čte strukturu systému: oloupe se graf volání od listů (ti, kdo už nikoho
 * nevolají) a každá slupka je jeden prstenec.
 *
 *   střed   = nejhlubší vrstva — utility, do kterých se jen padá (GR)
 *   okraj   = spouštěcí konec — kdo volá a nikdo nevolá jeho
 *
 * Je to tedy „od spustitelného souboru dál stromem", jen kreslené dovnitř:
 * čím blíž ke středu, tím hlouběji v závislostech. GR skončí uprostřed proto,
 * že tam PATŘÍ, ne proto, že jsme ho tam dali.
 *
 * Cykly: když nikdo nemá všechny cíle hotové, vezme se uzel s nejmenším
 * počtem nehotových cílů (a při shodě abecedně) — pevné pravidlo, žádná náhoda.
 */
function prstence(uzly) {
  /* JEDNO pravidlo, které jde vysvětlit jednou větou:
   *   vzdálenost od středu = jak moc na tom uzlu visí zbytek systému.
   *
   *   střed  = nejvíc volané (do GR padá 1 931 volání z celého systému)
   *   okraj  = spouštěcí konec — uzly, které NIKDO nevolá (vstupní body)
   *
   * Je to tedy „od spustitelného souboru dál stromem", kreslené dovnitř.
   * Uzly s nulovým fan-in jdou vždy do krajního prstence; zbytek se rozdělí
   * na stejně velké skupiny podle počtu příchozích volání. Žádná náhoda,
   * žádné ladění konstant — jen pořadí podle jednoho čísla.
   */
  const PRSTENCU = 5;
  const bez = uzly.filter((u) => !(u.volanoZ > 0));
  const sVazbou = uzly.filter((u) => u.volanoZ > 0)
    .sort((a, b) => b.volanoZ - a.volanoZ || (a.id < b.id ? -1 : 1));
  const vrstva = new Map();
  // Úplný střed patří JEDNOMU uzlu — tomu, na kterém visí nejvíc. Kdyby tam
  // stála celá první skupina, střed by byl chuchvalec a tvrzení „uprostřed je
  // to, na čem to stojí" by přestalo platit.
  const stred = sVazbou.length ? sVazbou[0] : null;
  if (stred) vrstva.set(stred.id, 0);
  const zbytek = sVazbou.slice(1);
  for (const u of bez) vrstva.set(u.id, PRSTENCU - 1);
  const naSkupinu = Math.ceil(zbytek.length / (PRSTENCU - 2)) || 1;
  zbytek.forEach((u, i) => vrstva.set(u.id, 1 + Math.min(PRSTENCU - 3, Math.floor(i / naSkupinu))));
  const vrstev = Math.max(...uzly.map((u) => vrstva.get(u.id))) + 1;
  return { vrstva, vrstev, stred: stred ? stred.id : null };
}

function rozmisti(uzly, hrany, sirka, vyska) {
  const n = uzly.length;
  if (n === 0) return;
  const { vrstva, vrstev } = prstence(uzly);
  for (const u of uzly) u.vrstva = vrstva.get(u.id) || 0;

  // uzly po prstencích, uvnitř prstence zatím abecedně (pevný start)
  const po = Array.from({ length: vrstev }, () => []);
  for (const u of [...uzly].sort((a, b) => (a.id < b.id ? -1 : 1))) po[u.vrstva].push(u);

  // Prstence jsou ELIPSY podle poměru plátna, ne kružnice. Obrazovky jsou na
  // šířku; kružnice se vejde jen na výšku, po stranách zůstane prázdno a
  // uživatel si musí ručně přiblížit, aby viděl to, co měl vidět hned.
  const Rx = sirka * 0.44, Ry = vyska * 0.44;
  const kroky = vrstev > 1 ? 1 / (vrstev - 1) : 0;
  const sousedi = new Map(uzly.map((u) => [u.id, []]));
  for (const h of hrany) {
    if (h.druh === 'data') continue;
    if (sousedi.has(h.z) && sousedi.has(h.do)) {
      sousedi.get(h.z).push(h.do); sousedi.get(h.do).push(h.z);
    }
  }

  // výchozí úhly: rovnoměrně po prstenci
  const uhel = new Map();
  po.forEach((ring, r) => ring.forEach((u, i) => {
    uhel.set(u.id, ring.length === 1 ? 0 : (2 * Math.PI * i) / ring.length);
  }));
  // Barycentrické srovnání: uzel se posune k průměrnému úhlu svých sousedů,
  // aby čáry nešly napříč mapou. Pevný počet průchodů, žádná náhoda.
  for (let it = 0; it < 24; it++) {
    for (const u of uzly) {
      const s = sousedi.get(u.id);
      if (!s.length) continue;
      let sx = 0, sy = 0;
      for (const id of s) { const a = uhel.get(id); sx += Math.cos(a); sy += Math.sin(a); }
      if (sx === 0 && sy === 0) continue;
      const cil = Math.atan2(sy, sx);
      let d = cil - uhel.get(u.id);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      uhel.set(u.id, uhel.get(u.id) + d * 0.25);
    }
  }
  // rozestupy uvnitř prstence, ať se karty nepřekrývají
  po.forEach((ring, r) => {
    const t2 = r * kroky;
    const rx = Rx * t2, ry = Ry * t2;
    ring.sort((a, b) => uhel.get(a.id) - uhel.get(b.id));
    ring.forEach((u, i) => {
      // Při víc než jednom uzlu v prstenci se rozmístí rovnoměrně — barycentrické
      // srovnání jen určilo POŘADÍ, ne výsledné úhly (jinak se karty shlukují).
      const a = ring.length === 1 ? 0 : (2 * Math.PI * i) / ring.length;
      u.x = sirka / 2 + rx * Math.cos(a);
      u.y = vyska / 2 + ry * Math.sin(a);
      if (ring.length === 1 && r === 0) { u.x = sirka / 2; u.y = vyska / 2; }
    });
  });

  normalizuj(uzly, sirka, vyska);
  // rozražení překryvů obdélníků (karty, ne kruhy), pevný počet průchodů
  for (let p = 0; p < 120; p++) {
    let hnuto = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = uzly[i], b = uzly[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const minx = (a.w + b.w) / 2 + 16, miny = (a.h + b.h) / 2 + 14;
      if (Math.abs(dx) < minx && Math.abs(dy) < miny) {
        const px = minx - Math.abs(dx), py = miny - Math.abs(dy);
        if (px < py) { const s = (dx >= 0 ? 1 : -1) * px / 2; a.x -= s; b.x += s; }
        else { const s = (dy >= 0 ? 1 : -1) * py / 2; a.y -= s; b.y += s; }
        hnuto = true;
      }
    }
    if (!hnuto) break;
  }
}

/** Přeškáluje rozmístění tak, aby přesně vyplnilo plátno.
 *
 * Bez tohohle kroku vycházel silový layout několikanásobně větší než plátno,
 * „celek" ho musel zmenšit na 13 % a popisky uzlů se staly nečitelnými.
 * Tvar mapy (kdo je u koho) se normalizací nemění — mění se jen měřítko.
 */
function normalizuj(uzly, sirka, vyska) {
  if (uzly.length < 2) return;
  const x1 = Math.min(...uzly.map((u) => u.x)), x2 = Math.max(...uzly.map((u) => u.x));
  const y1 = Math.min(...uzly.map((u) => u.y)), y2 = Math.max(...uzly.map((u) => u.y));
  const okraj = Math.max(...uzly.map((u) => Math.max(u.w, u.h))) / 2 + 30;
  // Jedno měřítko pro obě osy — natažení jen v jedné by z elips udělalo
  // nečitelné ovály. Tvar už je eliptický ze samotného rozmístění.
  const s = Math.min((sirka - 2 * okraj) / Math.max(1, x2 - x1),
                     (vyska - 2 * okraj) / Math.max(1, y2 - y1));
  const px = (sirka - (x2 - x1) * s) / 2, py = (vyska - (y2 - y1) * s) / 2;
  for (const u of uzly) {
    u.x = px + (u.x - x1) * s;
    u.y = py + (u.y - y1) * s;
  }
}

// ------------------------------------------------------------------ podklady
/* Karta místo kruhu. Kruh nesl jediný údaj (velikost) a půlka plochy byla
   prázdná. Karta nese jméno, počty, podíl programů závislých na Dialog Systemu
   a při přiblížení i fan-in/fan-out — a hlavně má kam ten text napsat. */
const mN = () => (S.n ? S.n.karty / 100 : 1);   // měřítko karet z nastavení

/* --------------------------------------------- UKAZATEL NÁROČNOSTI PŘEPISU
 *
 * Budík na kartě podsystému původně ukazoval PODÍL PROGRAMŮ VÁZANÝCH NA GUI.
 * Jako „náročnost" to nefunguje a je to změřené: u většiny podsystémů je ten
 * podíl 97–100 % (COP 98, CRP 99, CHP 100, RCP 100, CPP 100, REP 100,
 * BANKS 100), takže ručička stála pořád na témže místě a karty se podle ní
 * nedaly porovnat. Podíl GUI je pravda o systému, ale ne rozdíl mezi jeho
 * částmi — a budík má ukazovat rozdíl.
 *
 * Náročnost se proto skládá ze TŘÍ MĚŘENÝCH VSTUPŮ, které se mezi podsystémy
 * doopravdy liší:
 *
 *   U  jedinečných řádků  = řádky bez komentářů MÍNUS řádky, které jsou kopií
 *                           jiného souboru (data/narocnost.json)
 *   O  obrazovek k přepsání (tytéž obrazovky, které počítá fáze 0)
 *
 * a sečtou se po normalizaci na nejtěžší podsystém, v poměru 2 : 1:
 *
 *   index = ( 2·(U / U_max)  +  1·(O / O_max) ) / 3
 *
 * 100 % tedy znamená „nejhorší v obou vstupech naráz" — je to dosažitelné,
 * ale ne automatické. Poměr 2 : 1 je VOLBA, ne měření: objem kódu je větší a
 * poctivěji změřený driver než počet obrazovek. Proto se na stránce rozpad na
 * vstupy ukazuje vždycky vedle výsledku — kdo s poměrem nesouhlasí, vidí
 * čísla, ze kterých si ho přepočítá.
 *
 * ⚠️ Je to UKAZATEL, ne měření. Vstupy jsou měřené, složenina je náš návrh.
 * Stránka to tak musí i pojmenovat.
 */
const VAHA_KODU = 2, VAHA_OBRAZOVEK = 1;
// GALHO je mimo rozsah modernizace (rozhodnutí z 30. 10. 2026). Z ukazatele
// se nevyřazuje potichu: karta budík má, ale místo ručičky nese „out of scope",
// a do normalizace nevstupuje, aby neposouvala stupnici ostatním.
const MIMO_SCOPE = new Set(['GALHO']);

/** Načte vstupy ukazatele a spočítá index pro každý podsystém.
 *  Podklad je NEPOVINNÝ — bez něj se budík nekreslí a mapa jede dál. */
async function nactiNarocnost() {
  // ⚠️ Samotné `.json()` v try nestačí: server mapy vrací na 404 tělo „404",
  // a to je platný JSON. Chybějící podklad se pozná ze stavu odpovědi A z
  // tvaru dat. (Táž past jako u vykon.json a faze0.json.)
  let d = null;
  try {
    const o = await fetch('data/narocnost.json');
    if (o.ok) { const x = await o.json(); if (x && Array.isArray(x.podsystemy)) d = x; }
  } catch { /* duplicita se neměřila */ }
  if (!d) return;
  S.narocnost = d;
  const vScope = d.podsystemy.filter((p) => !MIMO_SCOPE.has(p.id));
  const jedinecnych = (p) => Math.max(0, p.radkuBezKomentaru - p.kopiiRadku);
  const maxU = Math.max(1, ...vScope.map(jedinecnych));
  const maxO = Math.max(1, ...vScope.map((p) => p.obrazovek));
  S.nar = new Map(d.podsystemy.map((p) => [p.id, {
    bezKomentaru: p.radkuBezKomentaru, kopiiRadku: p.kopiiRadku,
    kopiiSouboru: p.kopiiSouboru, obrazovek: p.obrazovek,
    jedinecnych: jedinecnych(p), mimoScope: MIMO_SCOPE.has(p.id),
    index: (VAHA_KODU * (jedinecnych(p) / maxU)
            + VAHA_OBRAZOVEK * (p.obrazovek / maxO)) / (VAHA_KODU + VAHA_OBRAZOVEK),
  }]));
  S.narMax = { u: maxU, o: maxO };
}

/** Vzorec ukazatele jednou větou. Je na třech místech (legenda, panel, úvod),
 *  takže je na JEDNOM místě v kódu — jinak se ta tři místa rozejdou. */
const VZOREC = `index = ( ${VAHA_KODU} × unique lines ÷ largest`
  + ` + ${VAHA_OBRAZOVEK} × screens ÷ largest ) ÷ ${VAHA_KODU + VAHA_OBRAZOVEK}`;

/** Půlkruhový budík 0–100 %. Dráha, stupnice, naplněná část a ručička.
 *  Úhly: 180° = 0 %, 0° = 100 % (čte se zleva doprava jako každá stupnice).
 *  `o.trida` mění velikost písma, `o.mimoScope` kreslí budík bez ručičky. */
function tachometr(podil, cx, cy, r, o = {}) {
  const g = el('g', { class: `tacho${o.trida ? ` ${o.trida}` : ''}${o.mimoScope ? ' mimo' : ''}` });
  const bod = (uhel, polomer) => [
    (cx + polomer * Math.cos((Math.PI * uhel) / 180)).toFixed(2),
    (cy - polomer * Math.sin((Math.PI * uhel) / 180)).toFixed(2),
  ];
  const oblouk = (odUhel, doUhel, polomer) => {
    const a = bod(odUhel, polomer), b = bod(doUhel, polomer);
    return `M ${a[0]} ${a[1]} A ${polomer} ${polomer} 0 0 1 ${b[0]} ${b[1]}`;
  };
  g.appendChild(el('path', { class: 'draha', d: oblouk(180, 0, r) }));
  // Stupnice: bez rysek je to jen oblouk a úhel ručičky se nedá odečíst.
  // Pět rysek po 25 %, aby šly dvě karty vedle sebe porovnat na pohled.
  if (o.rysky !== false) {
    for (let i = 0; i <= 4; i++) {
      const u = 180 - 45 * i;
      const a = bod(u, r - r * 0.26), b = bod(u, r);
      g.appendChild(el('line', { class: 'ryska', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
    }
  }
  if (!o.mimoScope) {
    if (podil > 0.001) {
      g.appendChild(el('path', { class: 'naplneno', d: oblouk(180, 180 - 180 * podil, r) }));
    }
    const sp = bod(180 - 180 * podil, r * 0.82);
    g.appendChild(el('line', { class: 'rucicka', x1: cx, y1: cy, x2: sp[0], y2: sp[1] }));
    g.appendChild(el('circle', { class: 'cep', cx, cy, r: (r * 0.13).toFixed(2) }));
  }
  const t2 = el('text', { class: 'tacho-popis', x: cx, y: (cy + r * 0.70).toFixed(1), 'text-anchor': 'middle' });
  t2.textContent = o.mimoScope ? 'n/a' : `${Math.round(podil * 100)}%`;
  g.appendChild(t2);
  if (o.nadpis) {
    const t3 = el('text', { class: 'tacho-nadpis', x: cx, y: (cy + r * 1.22).toFixed(1), 'text-anchor': 'middle' });
    t3.textContent = o.nadpis;
    g.appendChild(t3);
  }
  g.appendChild(titulekSVG(o.titulek || '', o.text || ''));
  return g;
}

/** Budík náročnosti pro kartu podsystému. Vrací null, když podklad chybí. */
function budikNarocnosti(id, cx, cy, r) {
  const n = S.nar && S.nar.get(id);
  if (!n) return null;
  return tachometr(n.index, cx, cy, r, {
    trida: 'velky',
    mimoScope: n.mimoScope,
    nadpis: 'REWRITE EFFORT',
    titulek: n.mimoScope
      ? `${id} — out of scope`
      : `Rewrite effort ${Math.round(n.index * 100)} % of the heaviest subsystem`,
    text: n.mimoScope
      ? 'This subsystem is outside the scope of the modernisation, so it carries no '
        + 'effort figure and does not enter the scale of the others.'
      : `Indicator, not a measurement — built from measured inputs: `
        + `${čísl(n.jedinecnych)} unique lines (${čísl(n.bezKomentaru)} without comments, `
        + `of which ${čísl(n.kopiiRadku)} are a copy of other code) and `
        + `${n.obrazovek} screens. ${VZOREC}. 100 % = worst on both counts.`,
  });
}

// Budík na kartě podsystému. Je nahoře, NAD jménem, a karta mu na to dostane
// vlastní pás — tím je velký na pohled a nepřekrývá text (předtím seděl v rohu
// o poloměru 12 px přes čísla karty). Bez podkladu je pás nulový a karta
// vypadá jako dřív.
const R_BUDIK = 21;      // poloměr budíku před měřítkem karet
const PAS_BUDIK = 56;    // výška pásu nad jménem: oblouk + hodnota + popisek
// Pás dostane jen karta, pro kterou budík doopravdy je. Podsystém, který
// v podkladu chybí (nový, přejmenovaný), by jinak měl nahoře prázdné místo
// a vypadalo by to jako vada vykreslení.
const pasBudiku = (id) => (S.nar && S.nar.has(id) ? PAS_BUDIK * mN() : 0);

function uzlyL0() {
  const max = Math.max(...S.data.podsystemy.map((p) => p.radku));
  return S.data.podsystemy.map((p) => ({
    id: p.id, popis: p.id, druh: 'podsystem',
    w: (92 + 86 * Math.sqrt(p.radku / max)) * mN(),
    h: (44 + 26 * Math.sqrt(p.radku / max)) * mN() + pasBudiku(p.id),
    radku: p.radku, programu: p.programu, uzlu: p.uzlu || 0,
    volaDo: p.volaDo || 0, volanoZ: p.volanoZ || 0,
    sGui: p.sGui || 0, osirelych: p.osirelych || 0, fragmentu: p.fragmentu || 0,
    gui: p.programu ? (p.sGui || 0) / p.programu : 0,
  }));
}
function hranyL0() {
  const m = new Map();
  for (const v of S.data.vazbyPodsystemu) {
    const k = v.z < v.do ? `${v.z} ${v.do}` : `${v.do} ${v.z}`;
    m.set(k, (m.get(k) || 0) + v.volani);
  }
  const volani = [...m].map(([k, vaha]) => {
    const [z, d] = k.split(' ');
    return { z, do: d, vaha, druh: 'call' };
  });
  // Sdílená data jsou JINÝ JEV než volání: dva podsystémy spolu nemluví,
  // ale popisují data stejným copybookem. Proto vlastní druh a vlastní barva.
  const data = (S.data.sdileneCopybooky || []).map((v) => ({
    z: v.a, do: v.b, vaha: v.copybooku, druh: 'data',
  }));
  return [...volani, ...data];
}
function uzlyL1(pod) {
  const vlastni = S.data.programy.filter((p) => p.podsystem === pod);
  const jmena = new Set(vlastni.map((p) => p.id));
  const sousedi = new Set();
  for (const v of S.data.vazbyProgramu) {
    if (jmena.has(v.z) && !jmena.has(v.do)) sousedi.add(v.do);
    if (jmena.has(v.do) && !jmena.has(v.z)) sousedi.add(v.z);
  }
  const vse = [...vlastni, ...S.data.programy.filter((p) => sousedi.has(p.id))];
  const max = Math.max(...vse.map((p) => p.radku), 1);
  return vse.map((p) => ({
    id: p.id, popis: p.id,
    w: (74 + 62 * Math.sqrt(p.radku / max)) * mN(),
    h: (36 + 18 * Math.sqrt(p.radku / max)) * mN(),
    radku: p.radku, uzlu: p.uzlu, volaDo: p.volaDo, volanoZ: p.volanoZ,
    podsystem: p.podsystem, cesta: p.cesta, typ: p.druh || 'program',
    gui: p.gui ? 1 : 0,
    druh: jmena.has(p.id) ? 'program' : 'soused',
  }));
}
/* Fan-in se na L1 počítá JEN z vazeb uvnitř pohledu. Globální číslo by do
   středu posadilo utility podle toho, jak moc je volá celý systém, i kdyby
   v tomhle podsystému skoro nefigurovaly — a vlastní programy podsystému by
   skončily na kraji bez ohledu na to, jak jsou pro něj důležité. */
function fanInVPohledu(uzly) {
  const je = new Set(uzly.map((u) => u.id));
  const n = new Map(uzly.map((u) => [u.id, 0]));
  for (const v of S.data.vazbyProgramu) {
    if (je.has(v.z) && je.has(v.do)) n.set(v.do, n.get(v.do) + v.n);
  }
  for (const u of uzly) u.volanoZ = n.get(u.id);
  return uzly;
}

function hranyL1(uzly) {
  const je = new Set(uzly.map((u) => u.id));
  const volani = S.data.vazbyProgramu.filter((v) => je.has(v.z) && je.has(v.do))
    .map((v) => ({ z: v.z, do: v.do, vaha: v.n, druh: 'call' }));
  const data = (S.data.sdileneCopybookyProgramu || [])
    .filter((v) => je.has(v.a) && je.has(v.b))
    .map((v) => ({ z: v.a, do: v.b, vaha: v.copybooku, druh: 'data' }));
  return [...volani, ...data];
}

/** Filtr se uplatní až TADY, na hotovém seznamu hran — čísla v liště tak
 *  ukazují totéž, co je na plátně, a nemůžou se rozejít. Práh platí jen na
 *  volání: u sdílených dat je váha počet copybooků, ne počet volání. */
function proFiltr(hrany) {
  return hrany.filter((h) => {
    if (!S.filtr[h.druh]) return false;
    if (h.druh === 'call' && h.vaha < S.filtr.prah) return false;
    return true;
  });
}

// ----------------------------------------------------------------- vykreslení
function kresli() {
  document.body.classList.toggle('L2', S.uroven === 'L2');
  for (const id of ['f-call', 'f-data', 'f-prah', 'f-osirele']) {
    document.getElementById(id).disabled = S.uroven === 'L2';
  }
  document.getElementById('filtry').classList.toggle('vyp', S.uroven === 'L2');
  document.getElementById('celek').style.display = S.uroven === 'L2' ? 'none' : '';
  document.getElementById('zpet').style.display = S.uroven === 'L0' ? 'none' : 'inline-block';
  if (S.uroven === 'L2') { kresliProgram(); return; }

  const svg = document.getElementById('platno');
  svg.innerHTML = '';
  const W = svg.clientWidth || 1000, H = svg.clientHeight || 700;
  let uzly = S.uroven === 'L0' ? uzlyL0() : fanInVPohledu(uzlyL1(S.podsystem));
  if (S.uroven === 'L1' && S.filtr.bezOsirelych) {
    const zbyle = uzly.filter((u) => u.druh !== 'program' || u.volanoZ > 0);
    if (zbyle.length) uzly = zbyle;   // nikdy nenechat prázdné plátno
  }
  const hrany = proFiltr(S.uroven === 'L0' ? hranyL0() : hranyL1(uzly));
  pocitadla(uzly);
  rozmisti(uzly, hrany, W, H, S.uroven === 'L0' ? 500 : 320);

  // „Celek" musí celek OPRAVDU vejít. Dřív to jen nulovalo posun a nastavilo
  // měřítko 1 — při rozmístění větším než plátno zůstal vidět jeden uzel
  // a tlačítko lhalo. Teď se spočítá obálka obsahu a dopočítá transformace.

  const g = el('g', { id: 'svet', transform: `translate(${S.x},${S.y}) scale(${S.k})` });
  // Vodicí kružnice: bez nich prstence splynou a z mapy je zase konstelace.
  const sx = uzly.reduce((s, u) => s + u.x, 0) / uzly.length;
  const sy = uzly.reduce((s, u) => s + u.y, 0) / uzly.length;
  const gk = el('g', { class: 'prstence' });
  const polomery = [...new Set(uzly.map((u) => Math.round(Math.hypot(u.x - sx, u.y - sy) / 10) * 10))]
    .filter((r) => r > 20).sort((a, b) => a - b);
  for (const u of uzly) u.R = Math.hypot(u.x - sx, u.y - sy);
  for (let r = 1; r < 5; r++) {
    const v = uzly.filter((x) => x.vrstva === r);
    if (!v.length) continue;
    const R = v.reduce((s, x) => s + x.R, 0) / v.length;
    gk.appendChild(el('circle', { cx: sx.toFixed(1), cy: sy.toFixed(1), r: R.toFixed(1) }));
  }
  g.appendChild(gk);
  const poz = new Map(uzly.map((u) => [u.id, u]));
  const maxV = Math.max(...hrany.map((h) => h.vaha), 1);

  const gh = el('g', { class: 'hrany' });
  for (const h of hrany) {
    const a = poz.get(h.z), b = poz.get(h.do);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    // prohnutí kolmo na směr — A→B a B→A se nepřekryjí
    const mx = (a.x + b.x) / 2 - dy * 0.11, my = (a.y + b.y) / 2 + dx * 0.11;
    const zvyraznit = S.vybrany && (h.z === S.vybrany || h.do === S.vybrany);
    gh.appendChild(el('path', {
      d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`,
      class: `hrana${h.druh === 'data' ? ' data' : ''}` +
        `${zvyraznit ? ' zvyrazneno' : ''}${S.vybrany && !zvyraznit ? ' ztlumeno' : ''}`,
      // Tloušťka = počet volání. Odmocnina, ne lineárně: GR má 903 volání
      // a lineárně by jedna čára byla tlustá jako prst a zbytek neviditelný.
      'stroke-width': (0.7 + 5.2 * Math.sqrt(h.vaha / maxV)).toFixed(2),
    }));
  }
  g.appendChild(gh);

  // Sémantický zoom: čím blíž, tím víc údajů. V oddáleném pohledu by stejný
  // text překážel a mapa by byla nečitelná, proto se přidává po prazích.
  const detail = S.n && S.n.cisla ? Math.max(1, urovenDetailu()) : urovenDetailu();
  S.detail = urovenDetailu();
  for (const u of uzly) {
    const zvyraznit = S.vybrany === u.id;
    const gu = el('g', { class: `uzel ${u.druh}${u.typ && u.typ !== 'program' ? ' fragment' : ''}` +
      `${zvyraznit ? ' vybrany' : ''}`, transform: `translate(${u.x.toFixed(1)},${u.y.toFixed(1)})`, 'data-id': u.id });
    const w = u.w, h = u.h;
    gu.appendChild(el('rect', { x: (-w / 2).toFixed(1), y: (-h / 2).toFixed(1),
      width: w.toFixed(1), height: h.toFixed(1), rx: 7 }));
    // Budík NÁROČNOSTI PŘEPISU: nahoře, nad jménem, přes celou šířku karty.
    // Dvě karty vedle sebe se porovnají podle úhlu ručičky, ne podle délky
    // proužku — a stupnice po 25 % se dá odečíst i bez legendy.
    const pas = u.druh === 'podsystem' ? pasBudiku(u.id) : 0;
    if (pas) {
      const b = budikNarocnosti(u.id, 0, -h / 2 + (7 + R_BUDIK) * mN(), R_BUDIK * mN());
      if (b) gu.appendChild(b);
    }
    // Program vázaný na Dialog System (L1). Budík by tu byl na dvě polohy —
    // program GUI buď volá, nebo ne — a na kartě podsystému vedle něj by se
    // četl jako táž veličina. Proto je to proužek: přítomnost, ne stupnice.
    if (u.druh !== 'podsystem' && u.gui > 0) {
      const pr = el('rect', { class: 'pruh-gui', x: (-w / 2 + 7).toFixed(1),
        y: (-h / 2 + 4).toFixed(1), width: (w - 14).toFixed(1), height: 3, rx: 1.5 });
      pr.appendChild(titulekSVG('Tied to the Dialog System GUI',
        'This program calls DSRUN, the Dialog System runtime. Its business logic and '
        + 'its screen handling are the same code, so it cannot be ported on its own.'));
      gu.appendChild(pr);
    }
    const vrch = -h / 2 + pas;             // horní hrana textové části karty
    const t = el('text', { class: 'jmeno', y: detail === 0 ? (pas / 2 + 4).toFixed(1) : (vrch + 17).toFixed(1) });
    t.textContent = u.popis;
    gu.appendChild(t);
    if (detail >= 1) {
      const t2 = el('text', { class: 'cis1', y: (vrch + 31).toFixed(1) });
      t2.textContent = u.druh === 'podsystem'
        ? `${u.programu} prg · ${(u.radku / 1000).toFixed(1)}k ln.`
        : `${u.radku.toLocaleString('en')} ln.`;
      gu.appendChild(t2);
    }
    if (detail >= 2) {
      const t3 = el('text', { class: 'cis2', y: (vrch + 44).toFixed(1) });
      const n = S.nar && S.nar.get(u.id);
      t3.textContent = u.druh === 'podsystem'
        ? (n && !n.mimoScope
            ? `${čísl(n.jedinecnych)} unique ln. · ${n.obrazovek} screens`
            : `in ${u.volanoZ} · out ${u.volaDo} · GUI ${Math.round(u.gui * 100)} %`)
        : `in ${u.volanoZ} · out ${u.volaDo}${u.typ && u.typ !== 'program' ? ' · ' + u.typ : ''}`;
      gu.appendChild(t3);
    }
    gu.addEventListener('click', (e) => { e.stopPropagation(); vyber(u); });
    gu.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (S.uroven === 'L0') { S.uroven = 'L1'; S.podsystem = u.id; S.vybrany = null; doAdresy(); panelUvod(); fit(); }
      else if (u.druh === 'program' || u.druh === 'soused') otevriProgram(u.id, u.podsystem);
    });
    g.appendChild(gu);
  }
  svg.appendChild(g);
  if (S.fit) { S.fit = false; fitDoObsahu(); }
  document.getElementById('stav').textContent =
    S.uroven === 'L0'
      ? `${uzly.length} subsystems · ${hrany.length} links · ${Math.round(S.k * 100)} %`
      : `${S.podsystem}: ${uzly.filter((u) => u.druh === 'program').length} programs + ${uzly.filter((u) => u.druh === 'soused').length} neighbours · ${hrany.length} links · ${Math.round(S.k * 100)} %`;
}

function fit() { S.fit = true; kresli(); }

/** Překreslí mapu jen tehdy, když se změnila úroveň detailu — jinak by každé
 *  cuknutí kolečkem stavělo celé SVG znovu. Sloučeno do jednoho snímku. */
let detailCeka = false;
function prekresliPriZmeneDetailu() {
  if (S.uroven === 'L2' || detailCeka) return;
  detailCeka = true;
  requestAnimationFrame(() => {
    detailCeka = false;
    if (urovenDetailu() !== S.detail) kresli();
  });
}
const urovenDetailu = () => (S.k >= 1.25 ? 2 : S.k >= 0.72 ? 1 : 0);

/** Úroveň v adrese: #CRP otevře podsystém rovnou. Pohled jde poslat odkazem
 *  a dá se na něj udělat snímek bez proklikávání. */
function doAdresy() {
  const cil = S.uroven === 'L2' ? `#${S.podsystem}/${S.program}`
    : S.uroven === 'L1' ? `#${S.podsystem}` : '#';
  if (location.hash !== cil) history.replaceState(null, '', location.search + cil);
}
function zAdresy() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')).toUpperCase();
  const [pod, prg] = h.split('/');
  if (pod && S.data.podsystemy.some((p) => p.id === pod)) { S.uroven = 'L1'; S.podsystem = pod; }
  else { S.uroven = 'L0'; S.podsystem = null; S.program = null; return null; }
  return prg || null;   // program řeší volající — jeho načtení je asynchronní
}

function vyber(u) {
  S.vybrany = S.vybrany === u.id ? null : u.id;
  panel(u);
  kresli();
}

/* Rozpad ukazatele náročnosti pro jeden podsystém. Ukazuje VSTUPY, ne jen
   výsledek, a rovnou dosazené do vzorce — jediný způsob, jak si čtenář může
   číslo přepočítat a případně s naším poměrem 2 : 1 nesouhlasit se znalostí
   věci. Prázdný řetězec, když podklad chybí. */
function rozpadNarocnosti(id) {
  const n = S.nar && S.nar.get(id);
  if (!n) return '';
  if (n.mimoScope) {
    return `<h3>Rewrite effort</h3>
      <p class="pozn"><b>Out of scope.</b> This subsystem is not part of the
      modernisation, so it carries no effort figure and does not enter the scale
      of the others. Its ${čísl(n.bezKomentaru)} lines are still counted everywhere
      the whole tree is counted.</p>`;
  }
  const kopiiProcent = n.bezKomentaru
    ? Math.round((n.kopiiRadku / n.bezKomentaru) * 100) : 0;
  return `
    <h3>Rewrite effort — ${Math.round(n.index * 100)} %</h3>
    <p class="pozn"><b>An indicator, not a measurement.</b> The inputs below are
      measured; putting them together in this ratio is our choice. 100 % would be
      the worst subsystem on both counts at once.</p>
    <ul>
      <li>lines, comments excluded<span>${čísl(n.bezKomentaru)}</span></li>
      <li>of those, a copy of other code<span>${čísl(n.kopiiRadku)} · ${kopiiProcent} %</span></li>
      <li><b>unique lines to rewrite</b><span>${čísl(n.jedinecnych)}</span></li>
      <li>screens to rebuild<span>${n.obrazovek}</span></li>
    </ul>
    <p class="pozn">(${VAHA_KODU} × ${čísl(n.jedinecnych)} ÷ ${čísl(S.narMax.u)}
      + ${VAHA_OBRAZOVEK} × ${n.obrazovek} ÷ ${S.narMax.o})
      ÷ ${VAHA_KODU + VAHA_OBRAZOVEK} = <b>${Math.round(n.index * 100)} %</b>.
      The divisors are the largest subsystem in each input.
      ${n.kopiiSouboru ? `${n.kopiiSouboru} of its files are near-identical to another
      file in the tree (${Math.round(S.narocnost.metoda.prahShody * 100)} % of lines
      or more) — those are counted once, not twice.` : ''}</p>`;
}

/* Na L1 je „úvodní" panel o PODSYSTÉMU, ve kterém jsme — ne o celém systému.
   Dřív se po prokliku dovnitř ukázal souhrn za celé Legacy COBOL system a detail prvku, do
   kterého uživatel vlezl, zmizel. */
function panelPodsystem() {
  const p = S.data.podsystemy.find((x) => x.id === S.podsystem);
  const el2 = document.getElementById('panel');
  if (!p) { el2.innerHTML = ''; return; }
  const ven = S.data.vazbyPodsystemu.filter((v) => v.z === p.id).sort((a, b) => b.volani - a.volani);
  const dov = S.data.vazbyPodsystemu.filter((v) => v.do === p.id).sort((a, b) => b.volani - a.volani);
  const gui = p.programu ? Math.round(((p.sGui || 0) / p.programu) * 100) : 0;
  el2.innerHTML = `
    <h2>${p.id}</h2>
    <p class="cis"><b>${p.programu}</b> programs · <b>${p.radku.toLocaleString('en')}</b> lines
      · <b>${gui} %</b> of them touch the GUI</p>
    ${p.fragmentu ? `<p class="pozn">${p.fragmentu} of those files are data descriptions,
      not programs (dashed cards).</p>` : ''}
    <p class="pozn">${p.osirelych} of its programs are called by nobody — entry points
      <b>or</b> dead code; the call graph cannot tell them apart. Which of them is
      <b>provably</b> reachable is a different measurement and it is on the
      <b>Proof</b> tab.</p>
    ${rozpadNarocnosti(p.id)}
    <h3>Calls out to (${ven.length})</h3><ul>${ven.slice(0, 12).map((v) => `<li>${v.do}<span>${v.volani}×</span></li>`).join('') || '<li class="nic">nothing</li>'}</ul>
    <h3>Called from (${dov.length})</h3><ul>${dov.slice(0, 12).map((v) => `<li>${v.z}<span>${v.volani}×</span></li>`).join('') || '<li class="nic">nothing</li>'}</ul>
    <p class="tip">Click a card for its detail · double-click to open the program ·
      “← back” returns to the whole system.</p>`;
}

/* Tlačítko „Open ▸" v panelu. Dvojklik na kartu funguje taky, ale není na něm
   nic vidět — uživatel ho nemá jak uhodnout a L1 ani L2 pak nenajde. */
function zapojOtevri() {
  const b = document.getElementById('panel').querySelector('.otevri');
  if (!b) return;
  b.addEventListener('click', () => {
    if (b.dataset.prg) {
      const prg = S.data.programy.find((x) => x.id === b.dataset.cil);
      otevriProgram(b.dataset.cil, prg ? prg.podsystem : S.podsystem);
    } else {
      S.uroven = 'L1'; S.podsystem = b.dataset.cil; S.vybrany = null;
      doAdresy(); panelUvod(); fit();
    }
  });
}

function panel(u) {
  const p = document.getElementById('panel');
  if (!S.vybrany) { panelUvod(); return; }
  if (u.druh === 'podsystem') {
    const ven = S.data.vazbyPodsystemu.filter((v) => v.z === u.id).sort((a, b) => b.volani - a.volani);
    const dov = S.data.vazbyPodsystemu.filter((v) => v.do === u.id).sort((a, b) => b.volani - a.volani);
    p.innerHTML = `<h2>${u.id}</h2>
      <p class="cis"><b>${u.programu}</b> programs · <b>${u.radku.toLocaleString('en')}</b> lines</p>
      ${rozpadNarocnosti(u.id)}
      <h3>Calls out to (${ven.length})</h3><ul>${ven.map((v) => `<li>${v.do}<span>${v.volani}×</span></li>`).join('') || '<li class="nic">nothing</li>'}</ul>
      <h3>Called from (${dov.length})</h3><ul>${dov.map((v) => `<li>${v.z}<span>${v.volani}×</span></li>`).join('') || '<li class="nic">nothing</li>'}</ul>
      <button class="otevri" data-cil="${u.id}">Open subsystem ▸</button>
      <p class="tip">Or double-click the card on the map.</p>`;
  } else {
    const ven = S.data.vazbyProgramu.filter((v) => v.z === u.id).sort((a, b) => b.n - a.n);
    const dov = S.data.vazbyProgramu.filter((v) => v.do === u.id).sort((a, b) => b.n - a.n);
    p.innerHTML = `<h2>${u.id}</h2>
      <p class="cis"><b>${u.radku.toLocaleString('en')}</b> lines · <b>${u.uzlu}</b> internal nodes · subsystem <b>${u.podsystem}</b></p>
      ${u.typ && u.typ !== 'program' ? `<p class="pozn"><b>Not a program.</b> This .cbl file has no
        PROCEDURE DIVISION — it is a ${u.typ === 'empty' ? 'an empty file' : 'data description (FD / SELECT) copied into other programs'}.</p>` : ''}
      <p class="cesta">${u.cesta}</p>
      <h3>Calls (${ven.length})</h3><ul>${ven.slice(0, 40).map((v) => `<li>${v.do}<span>${v.n}×</span></li>`).join('') || '<li class="nic">nothing</li>'}</ul>
      <h3>Called from (${dov.length})</h3><ul>${dov.slice(0, 40).map((v) => `<li>${v.z}<span>${v.n}×</span></li>`).join('') || '<li class="nic">nobody</li>'}</ul>
      <button class="otevri" data-cil="${u.id}" data-prg="1">Open program ▸</button>
      <p class="tip">Or double-click the card on the map.</p>`;
  }
  zapojOtevri();
}

function panelUvod() {
  if (S.uroven === 'L1') return panelPodsystem();
  if (S.uroven === 'L2') return panelProgram();
  const d = S.data, z = d.zdroj;
  const osirele = d.programy.filter((p) => p.volanoZ === 0);
  const huby = [...d.programy].sort((a, b) => b.volanoZ - a.volanoZ).slice(0, 10);
  const velke = [...d.programy].sort((a, b) => b.radku - a.radku).slice(0, 10);
  document.getElementById('panel').innerHTML = `
    <h2>Legacy COBOL system — analysis</h2>
    ${/* ⚠️ Tohle číslo je „kolik uzlů má graf", ne „kolik má systém programů".
          Liší se od počtu na Dashboardu, a bez vysvětlení to vypadá jako
          rozpor. Říká se to proto rovnou tady — jedním slovem navíc. */ ''}
    <p class="cis"><b>${z.programu}</b> files in the graph · <b>${z.uzlu.toLocaleString('en')}</b> internal nodes ·
       <b>${z.hran.toLocaleString('en')}</b> edges · <b>${z.nevyresenych}</b> unresolved</p>
    <h3>Most called (fan-in)</h3>
    <ul>${huby.map((p) => `<li>${p.id}<span>${p.volanoZ}×</span></li>`).join('')}</ul>
    <h3>Largest files</h3>
    <ul>${velke.map((p) => `<li>${p.id}<span>${p.radku.toLocaleString('en')} ln.</span></li>`).join('')}</ul>
    <h3>Nobody calls them (${osirele.length})</h3>
    <p class="pozn">Entry points <b>or</b> dead code — the call graph cannot tell
       them apart, and that is a property of the graph, not a finding. Which code is
       <b>provably</b> reachable was measured separately and is on the <b>Proof</b>
       tab (Phase 0).</p>
    <h3>Calls outside the corpus (${d.vnejsiVolani.length})</h3>
    <ul>${d.vnejsiVolani.slice(0, 8).map((v) => `<li>${v.cil}<span>${v.volani}×</span></li>`).join('')}</ul>
    <h3>Two different things, two different encodings</h3>
    <p class="pozn"><b>Where a card sits</b> answers <i>who needs it.</i> Distance
      from the centre = how much the rest of the system depends on it. The middle
      is the most-called part — everything falls into it. The outer ring is the
      launch end: nodes <b>nobody</b> calls, i.e. the entry points.</p>
    ${S.nar ? `<p class="pozn"><b>The dial above the card name</b> answers something
      else entirely — <i>how much work it is to rewrite that part.</i> It is an
      <b>indicator, not a measurement</b>: the inputs are measured, the way they are
      put together is our choice, and both are shown. 100 % is the heaviest
      subsystem of this system, not an absolute scale.</p>
    <p class="pozn">It is built from what actually <b>differs</b> between the parts:
      <b>unique lines</b> (lines without comments, minus lines that are a copy of
      another file in the tree) and <b>screens to rebuild</b>, each scaled against
      the largest subsystem and weighted ${VAHA_KODU} : ${VAHA_OBRAZOVEK}. Click a
      card and the panel shows the arithmetic with its own numbers in it.</p>
    <p class="pozn"><b>Why not the share of programs tied to the GUI</b>, which the
      dial used to show: it is 97–100 % almost everywhere, so it says something true
      about the system and nothing about the difference between its parts. The
      whole-system figure is on the <b>Dashboard</b>.</p>
    <p class="pozn">That is why <b>a card can sit on the outer ring (nothing depends
      on it) and still be expensive</b>, and why a central card with a low dial is
      the cheap kind of important.</p>` : ''}
    <p class="pozn"><b>Zoom in for more.</b> Cards show only names when zoomed out;
      counts appear at ~75 %, and the inputs behind the dial at ~125 %.</p>
    <p class="tip">Click = detail · double-click a subsystem = go inside ·
      double-click a program = open it · wheel = zoom · 0 = fit all</p>`;
}

// -------------------------------------------------------------------- filtry
/** Počty v liště se počítají ze STEJNÉHO seznamu hran, ze kterého se kreslí —
 *  jinak se číslo a obrázek rozejdou a nikdo si toho nevšimne. */
function pocitadla(uzly) {
  const vse = S.uroven === 'L0' ? hranyL0() : hranyL1(uzly);
  const call = vse.filter((h) => h.druh === 'call' && h.vaha >= S.filtr.prah).length;
  const data = vse.filter((h) => h.druh === 'data').length;
  document.getElementById('n-call').textContent = call.toLocaleString('en');
  document.getElementById('n-data').textContent = data.toLocaleString('en');
  // Na přehledu podsystémů nemá smysl — proto se neukazuje vůbec, místo aby
  // seděl zašedlý a zvyšoval složitost lišty.
  document.getElementById('l-osirele').hidden = S.uroven !== 'L1';
  // Legenda karty se mění s úrovní: budík náročnosti je vlastnost podsystému,
  // proužek GUI vlastnost programu. Ukázat obojí naráz by znamenalo tvrdit,
  // že karta nese obojí — a nenese.
  const ln = document.getElementById('l-narocnost'), lg = document.getElementById('l-gui');
  ln.hidden = S.uroven !== 'L0' || !S.nar;
  lg.hidden = S.uroven !== 'L1';
  // Nadpis skupiny bez jediné položky je jen zbytek po něčem, co tu není.
  document.getElementById('l-karta').hidden = ln.hidden && lg.hidden;
  if (!ln.title) {
    ln.title = 'How much work it is to rewrite this subsystem, relative to the heaviest one. '
      + 'An indicator, not a measurement: it is built from measured inputs — unique lines '
      + '(lines without comments, minus lines that are a copy of another file) and screens '
      + `to rebuild. ${VZOREC}.`;
  }
}

/* Nastavení filtrů žije i v adrese — stejný důvod jako u #CRP: pohled jde
   poslat odkazem a dá se na něj udělat snímek bez proklikávání.
   …?links=call,data&min=5&hideuncalled=1 */
function filtrZAdresy() {
  const q = new URLSearchParams(location.search);
  if (q.has('links')) {
    const k = q.get('links').split(',').map((s) => s.trim());
    S.filtr.call = k.includes('call');
    S.filtr.data = k.includes('data');
  }
  if (q.has('min')) S.filtr.prah = Math.max(1, Number(q.get('min')) || 1);
  if (q.has('hideuncalled')) S.filtr.bezOsirelych = true;
  document.getElementById('f-call').checked = S.filtr.call;
  document.getElementById('f-data').checked = S.filtr.data;
  document.getElementById('f-prah').value = String(S.filtr.prah);
  document.getElementById('f-osirele').checked = S.filtr.bezOsirelych;
}

function filtrDoAdresy() {
  const q = new URLSearchParams(location.search);
  const druhy = [S.filtr.call && 'call', S.filtr.data && 'data'].filter(Boolean);
  q.set('links', druhy.join(',') || 'none');
  if (S.filtr.prah > 1) q.set('min', S.filtr.prah); else q.delete('min');
  if (S.filtr.bezOsirelych) q.set('hideuncalled', '1'); else q.delete('hideuncalled');
  history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
}

function filtry() {
  const zmena = () => {
    S.filtr.call = document.getElementById('f-call').checked;
    S.filtr.data = document.getElementById('f-data').checked;
    S.filtr.prah = Number(document.getElementById('f-prah').value);
    S.filtr.bezOsirelych = document.getElementById('f-osirele').checked;
    filtrDoAdresy();
    fit();
  };
  for (const id of ['f-call', 'f-data', 'f-prah', 'f-osirele']) {
    document.getElementById(id).addEventListener('change', zmena);
  }
  filtrZAdresy();
}


// ------------------------------------------------------------------ nastavení
/* Vzhled mapy si uživatel přizpůsobí a volba mu zůstane — drží se v prohlížeči
   (localStorage), ne v adrese: je to nastavení člověka, ne pohledu, a odkaz
   na konkrétní pohled se tím nemá měnit. */
const VYCHOZI_N = { barva: 'cihla', hrany: 26, karty: 100, prstence: true, cisla: false, rezim: null };
const BARVY = [
  ['cihla', '#B0532C', '#d95926'],
  ['modra', '#2a78d6', '#3987e5'],
  ['zelena', '#1baf7a', '#199e70'],
  ['fialova', '#4a3aa7', '#9085e9'],
  ['sediva', '#6e6878', '#c3c2b7'],
];

function nactiNastaveni() {
  try { S.n = { ...VYCHOZI_N, ...JSON.parse(localStorage.getItem('Legacy COBOL system-mapa') || '{}') }; }
  catch { S.n = { ...VYCHOZI_N }; }
}
function ulozNastaveni() {
  try { localStorage.setItem('Legacy COBOL system-mapa', JSON.stringify(S.n)); } catch { /* bez paměti to taky jde */ }
}
function pouzijNastaveni() {
  const k = document.documentElement.style;
  const b = BARVY.find((x) => x[0] === S.n.barva) || BARVY[0];
  const tmavy = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme')
        && matchMedia('(prefers-color-scheme: dark)').matches);
  k.setProperty('--akc', tmavy ? b[2] : b[1]);
  // Proužek GUI na kartě i jeho vzorek v legendě jdou s akcentem — je to táž
  // mapa, ne dvě. Paleta rolí uvnitř programu (L2) zůstává, ta je validovaná
  // jako celek a vytrhnout z ní jeden slot by rozbila odstupy.
  k.setProperty('--gui', tmavy ? b[2] : b[1]);
  k.setProperty('--hrana-op', String(S.n.hrany / 100));
  k.setProperty('--karty', String(S.n.karty / 100));
  document.body.classList.toggle('bez-prstencu', !S.n.prstence);
  for (const [id, v] of [['n-hrany', S.n.hrany], ['n-karty', S.n.karty]]) {
    const e = document.getElementById(id); if (e) e.value = String(v);
  }
  const p = document.getElementById('n-prstence'); if (p) p.checked = S.n.prstence;
  const c = document.getElementById('n-cisla'); if (c) c.checked = S.n.cisla;
  const po = document.getElementById('n-popisky'); if (po) po.checked = S.n.cisla;
  for (const b2 of document.querySelectorAll('#n-barvy button')) {
    b2.setAttribute('aria-pressed', String(b2.dataset.barva === S.n.barva));
  }
}

function nastaveni() {
  const panel = document.getElementById('panel-nastaveni');
  document.getElementById('nastaveni').addEventListener('click', (e) => {
    e.stopPropagation(); panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true;
  });
  document.getElementById('n-barvy').innerHTML = BARVY
    .map(([jm, svetla]) => `<button data-barva="${jm}" style="background:${svetla}" title="${jm}"></button>`)
    .join('');
  document.getElementById('n-barvy').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.n.barva = b.dataset.barva; ulozNastaveni(); pouzijNastaveni();
  });
  const zmena = (id, klic, prevod) => document.getElementById(id).addEventListener('input', (e) => {
    S.n[klic] = prevod(e.target); ulozNastaveni(); pouzijNastaveni();
    if (klic === 'karty' || klic === 'cisla') fit();
  });
  zmena('n-hrany', 'hrany', (e) => Number(e.value));
  zmena('n-karty', 'karty', (e) => Number(e.value));
  zmena('n-prstence', 'prstence', (e) => e.checked);
  zmena('n-popisky', 'cisla', (e) => e.checked);
  document.getElementById('n-reset').addEventListener('click', () => {
    S.n = { ...VYCHOZI_N }; ulozNastaveni(); pouzijNastaveni(); fit();
  });
  pouzijNastaveni();
}

// --------------------------------------------------------------------- režim
/* Světlý / tmavý. Přepínač musí přebít systémové nastavení v OBOU směrech,
   proto se na <html> stampuje data-theme a CSS má obě větve. Režim jde zvolit
   i adresou (…?tmavy) — kvůli snímkům z headless prohlížeče, kde se na
   tlačítko nedá kliknout. */
/* Režim je součást vzhledu, proto sedí v nastavení, ne jako tlačítko v liště.
   Stamp na <html> přebíjí systémové nastavení v OBOU směrech. */
function nastavRezim(jm) {
  document.documentElement.setAttribute('data-theme', jm);
  for (const b of document.querySelectorAll('.prepinac-rezim button')) {
    b.setAttribute('aria-pressed', String(b.dataset.rezim === jm));
  }
  if (S.n) { S.n.rezim = jm; ulozNastaveni(); pouzijNastaveni(); }
}

function rezim() {
  const systemTmavy = matchMedia('(prefers-color-scheme: dark)').matches;
  const vychozi = (S.n && S.n.rezim) || (systemTmavy ? 'dark' : 'light');
  nastavRezim(/tmav|dark/i.test(location.search) ? 'dark' : vychozi);
  for (const b of document.querySelectorAll('.prepinac-rezim button')) {
    b.addEventListener('click', () => nastavRezim(b.dataset.rezim));
  }
}

// ------------------------------------------------------------------- ovládání
function ovladani() {
  const svg = document.getElementById('platno');
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();                       // pinch na trackpadu chodí jako wheel+Ctrl
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015), nk = Math.min(8, Math.max(0.15, S.k * f));
    S.x = mx - ((mx - S.x) * nk) / S.k;        // zoom kotvený na kurzoru, ne na střed
    S.y = my - ((my - S.y) * nk) / S.k;
    S.k = nk;
    document.getElementById('svet')?.setAttribute('transform', `translate(${S.x},${S.y}) scale(${S.k})`);
    document.getElementById('stav').textContent = document.getElementById('stav').textContent.replace(/\d+ %$/, `${Math.round(S.k * 100)} %`);
    // Posun a měřítko stačí přepsat v transformaci, ale ÚROVEŇ DETAILU se
    // rozhoduje při kreslení. Bez překreslení se po přiblížení (i gestem na
    // touchpadu) nic nepřidalo, dokud uživatel někam neklikl.
    prekresliPriZmeneDetailu();
  }, { passive: false });

  let tah = null;
  svg.addEventListener('pointerdown', (e) => { tah = { x: e.clientX, y: e.clientY, x0: S.x, y0: S.y, hnuto: false }; });
  svg.addEventListener('pointermove', (e) => {
    if (!tah) return;
    const dx = e.clientX - tah.x, dy = e.clientY - tah.y;
    if (!tah.hnuto && Math.hypot(dx, dy) > 3) { tah.hnuto = true; svg.setPointerCapture(e.pointerId); }
    if (!tah.hnuto) return;
    S.x = tah.x0 + dx; S.y = tah.y0 + dy;
    document.getElementById('svet')?.setAttribute('transform', `translate(${S.x},${S.y}) scale(${S.k})`);
  });
  // Zachycení ukazatele se dává AŽ když tažení začne. Na pointerdown by
  // přesměrovalo i následný klik na celé plátno a výběr uzlů by přestal fungovat.
  svg.addEventListener('pointerup', (e) => {
    // ⚠️ Odznačit se smí JEN klik do prázdna. Dřív se překreslovalo při každém
    // pointerup — i při kliku na kartu. Překreslení vyhodí původní element
    // z dokumentu dřív, než na něj dojde `click`, takže se výběr ani dvojklik
    // nikdy neprovedly. Z venku to vypadalo, že karty nejsou klikací.
    const doPrazdna = e.target === svg || e.target.closest('.uzel') === null;
    if (tah && !tah.hnuto && doPrazdna && S.vybrany) { S.vybrany = null; panelUvod(); kresli(); }
    if (tah?.hnuto) svg.releasePointerCapture(e.pointerId);
    tah = null;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '0') fit();
    if (e.key === 'Escape') { if (S.uroven === 'L1') { S.uroven = 'L0'; S.podsystem = null; } S.vybrany = null; doAdresy(); panelUvod(); fit(); }
    if (e.key === '+' || e.key === '=') { S.k = Math.min(8, S.k * 1.2); kresli(); }
    if (e.key === '-') { S.k = Math.max(0.15, S.k / 1.2); kresli(); }
  });
  document.getElementById('zpet').addEventListener('click', () => {
    // Návrat VYBERE prvek, ze kterého jsme vyšli — jinak se uživatel vrátí
    // „někam" a musí ho hledat znovu.
    if (S.uroven === 'L2') {
      const prg = S.program;
      S.uroven = 'L1'; S.program = null; S.pd = null; S.vybrany = prg;
      doAdresy(); fit();
      const u = (fanInVPohledu(uzlyL1(S.podsystem))).find((x) => x.id === prg);
      if (u) panel(u); else panelUvod();
      return;
    }
    const pod = S.podsystem;
    S.uroven = 'L0'; S.podsystem = null; S.vybrany = pod;
    doAdresy(); fit();
    const u = uzlyL0().find((x) => x.id === pod);
    if (u) panel(u); else panelUvod();
  });
  addEventListener('hashchange', () => { zAdresy(); S.vybrany = null; panelUvod(); fit(); });
  document.getElementById('celek').addEventListener('click', fit);
}

fetch('data/mapa.json').then((r) => r.json()).then(async (d) => {
  S.data = d;
  const m = d.meta || {};
  document.getElementById('nadpis').innerHTML =
    `${m.nazev || 'Code map'} <span>— ${m.podnadpis || ''}</span>`;
  document.getElementById('podtitul').textContent = m.popisSystemu || '';
  document.getElementById('patka-text').innerHTML =
    '<b>What this picture is built from:</b> it is drawn from the output of static ' +
    'analysis of the source code; nothing is computed in the browser. ' + (m.poznamka || '');
  document.title = [m.nazev, m.podnadpis].filter(Boolean).join(' — ') || 'Code map';

  const naMapu = zalozky();
  const dashVychozi = !location.hash || /^#dashboard$/i.test(location.hash);
  const prg = zAdresy();
  // Vstupy ukazatele náročnosti musí být dřív než první kreslení: na nich visí
  // výška karty (pás budíku), takže dotažení „až potom" by mapu překreslilo.
  await nactiNarocnost();
  panelUvod();
  nactiNastaveni();
  ovladani();
  rezim();
  nastaveni();
  filtry();
  await dashboard();
  await meridlo();
  if (prg) await otevriProgram(prg, S.podsystem); else kresli();
  const prvni = /^#proof$/i.test(location.hash) ? 'proof'
    : /^#application$/i.test(location.hash) ? 'aplikace'
    : (dashVychozi ? 'dash' : 'mapa');
  naMapu(prvni);
  addEventListener('resize', () => { if (S.uroven !== 'L2') kresli(); });
});


/* ===========================================================================
   L2 — vnitřek jednoho programu v měřítku řádků.

   Jiná kresba než L0/L1 (tam konstelace, tady svislý soubor), ale TÁŽ stránka,
   táž paleta a tentýž přepínač režimu. Podklad se dotahuje až při otevření —
   707 souborů dohromady má 19 MB a stahovat je dopředu by nemělo smysl.
   =========================================================================== */
const PŠ = 1600, PV = 900;                // vnitřní souřadnice plátna (na šířku)
const P_OKRAJ = 44;                       // boční okraje
const P_DATA_Š = 92;                      // stlačená datová část — viz pX()
const Y_PAS = 318, V_PAS = 46;            // vodorovný pás = celý soubor
const Y_PAS_D = Y_PAS + V_PAS;
const Y_VNEJSI = 38;                      // řádek s volanými programy nahoře
const P_MEZERA = 40;                      // rozestup popisků po VODOROVNÉ ose
const UHEL_POPISKU = -58;                 // sklon popisků pod pásem
const čísl = (n) => n.toLocaleString('en-GB');
const zkrať = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function otevriProgram(id, podsystem) {
  try {
    const r = await fetch(`data/program/${encodeURIComponent(id)}.json`);
    if (!r.ok) throw new Error(r.status);
    S.pd = await r.json();
  } catch {
    document.getElementById('stav').textContent = `no detail available for ${id}`;
    return;
  }
  S.uroven = 'L2';
  S.program = id;
  if (podsystem) S.podsystem = podsystem;
  else {
    const p = S.data.programy.find((x) => x.id === id);
    if (p) S.podsystem = p.podsystem;
  }
  S.vybranaCast = null;
  doAdresy();
  kresli();
  scrollTo(0, 0);
}

/* Vodorovná osa = řádky souboru.
 *
 * Datová část (všechno před PROCEDURE DIVISION) je u COBOLu klidně čtvrtina
 * souboru, ale NENÍ v ní žádný tok — jen popis tvaru dat. V měřítku by sežrala
 * čtvrtinu šířky a vazby by se stlačily do zbytku. Dostává proto pevný úzký
 * blok a ZLOM MĚŘÍTKA je na obrázku vyznačený, aby se to nedalo splést s poměrem.
 */
function pX(radek) {
  const start = S.pd.procedureOd;
  const sirkaKodu = PŠ - 2 * P_OKRAJ - P_DATA_Š;
  if (radek < start) {
    return P_OKRAJ + (P_DATA_Š * (radek - 1)) / Math.max(1, start - 1);
  }
  return P_OKRAJ + P_DATA_Š + (sirkaKodu * (radek - start)) / Math.max(1, S.pd.radku - start + 1);
}

function kresliProgram() {
  const D = S.pd;
  const svg = document.getElementById('platno');
  svg.innerHTML = '';
  // Plátno v pixelech okna, ne pevný viewBox — kresba pak jde posouvat
  // a přibližovat úplně stejně jako na L0/L1 (táž skupina #svet, táž obsluha).
  const W = svg.clientWidth || PŠ, H = svg.clientHeight || PV;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.removeAttribute('preserveAspectRatio');
  dlazdiceProgramu();
  panelProgram();
  document.getElementById('stav').textContent =
    `${S.podsystem} / ${D.program} · ${čísl(D.radku)} lines · ${D.souhrn.sekci} parts`;

  const vOblouky = el('g'), vPasy = el('g'), vPopisky = el('g'), vVnejsi = el('g');
  const nad = (x, y, text, konec) => {
    const e = el('text', { x, y, class: 'nadpisek' });
    if (konec) e.setAttribute('text-anchor', 'end');
    e.textContent = text; return e;
  };
  // Nadpisky sloupců drží u levého okraje; zarovnané na pravý okraj plátna se
  // po dopočítání výřezu lepila na kraj a ořezávala.
  svg.append(nad(P_OKRAJ, 16, 'calls out ↑'),
             nad(P_OKRAJ + 360, 16, 'jumps between parts (PERFORM) ↓'),
             nad(P_OKRAJ, Y_PAS - 44, 'the whole source file, left to right, to line scale'));

  // --- datová část (stlačená) + zlom měřítka
  const xProc = pX(D.procedureOd);
  const dat = el('rect', { x: P_OKRAJ, y: Y_PAS, width: Math.max(1, xProc - P_OKRAJ),
    height: V_PAS, fill: 'var(--neutral)', rx: 3 });
  dat.append(titulekSVG(`Data description — lines 1–${D.procedureOd - 1}`,
    'File and variable declarations. No executable code. Drawn narrower than ' +
    'its real share of the file — the scale break is marked.'));
  vPasy.append(dat);
  // zlom měřítka: klikatá čára přes pás
  const zx = xProc;
  vPasy.append(el('path', { class: 'zlom',
    d: `M ${zx - 5} ${Y_PAS - 6} l 10 8 l -10 8 l 10 8 l -10 8 l 10 8 l -10 8` }));
  const pdl = el('text', { x: (P_OKRAJ + xProc) / 2, y: Y_PAS_D + 15, class: 'osa',
    'text-anchor': 'middle' });
  pdl.textContent = `data · 1–${čísl(D.procedureOd - 1)}`;
  const pdl2 = el('text', { x: (P_OKRAJ + xProc) / 2, y: Y_PAS_D + 27, class: 'osa',
    'text-anchor': 'middle', 'font-style': 'italic' });
  pdl2.textContent = 'not to scale';
  vPopisky.append(pdl, pdl2);

  // --- pásy částí
  const podleJmena = new Map(D.sekce.map((s) => [s.nazev, s]));
  for (const s of D.sekce) {
    if (s.druh !== 'sekce') continue;
    const x1 = pX(s.od), w = Math.max(2, pX(s.do + 1) - x1);
    const g = el('g', { class: 'pas', 'data-sekce': s.nazev });
    g.append(el('rect', { x: x1, y: Y_PAS, width: w, height: V_PAS, rx: 2, fill: `var(--${s.role})` }));
    g.append(titulekSVG(`${s.nazev}${s.preklad ? ' — ' + s.preklad : ''}`,
      `lines ${s.od}–${s.do} · ${s.radku} lines (${s.radkuKodu} of them code) · ` +
      `jumped into ${s.volanoZ}×, jumps out ${s.volaDo}×`));
    g.addEventListener('mouseenter', () => zvyrazniCast(s.nazev));
    g.addEventListener('mouseleave', () => { if (!S.vybranaCast) odznacCast(true); });
    g.addEventListener('click', (ev) => { ev.stopPropagation(); vyberCast(s); });
    vPasy.append(g);
  }

  // --- rysky měřítka po 100 řádcích (jen v kódové části, kde měřítko platí)
  for (let r = Math.ceil(D.procedureOd / 100) * 100; r < D.radku; r += 100) {
    const xr = pX(r), stovka = r % 500 === 0;
    vPasy.append(el('line', { x1: xr, x2: xr, y1: Y_PAS, y2: Y_PAS + (stovka ? 9 : 5),
      stroke: 'var(--platno)', 'stroke-width': stovka ? 1.4 : 0.8, 'stroke-opacity': .85 }));
  }
  const znacka = (xx, yy, text, kotva) => {
    const e = el('text', { x: xx, y: yy, class: 'osa', 'text-anchor': kotva || 'middle' });
    e.textContent = text; return e;
  };
  vPopisky.append(znacka(P_OKRAJ, Y_PAS - 8, 'line 1', 'start'),
                  znacka(PŠ - P_OKRAJ, Y_PAS - 8, `line ${čísl(D.radku)}`, 'end'),
                  znacka(xProc + 8, Y_PAS - 8, `line ${D.procedureOd} — code starts`, 'start'));

  // --- popisky částí: šikmo pod pásem, rozsunuté po VODOROVNÉ ose
  const casti = D.sekce.filter((s) => s.druh === 'sekce');
  const cile = casti.map((s) => (pX(s.od) + pX(s.do + 1)) / 2);
  const mista = rozsun(cile, P_MEZERA, P_OKRAJ + 10, PŠ - P_OKRAJ - 10);
  casti.forEach((s, i) => {
    const xc = cile[i], xp = mista[i], yp = Y_PAS_D + 44;
    const g = el('g', { class: 'popisek sikmy', 'data-popisek': s.nazev,
      transform: `translate(${xp.toFixed(1)},${yp}) rotate(${UHEL_POPISKU})` });
    const t1 = el('text', { x: 0, y: 0 });
    t1.textContent = s.nazev;
    const t2 = el('text', { x: 0, y: 12, class: 'cz' });
    t2.textContent = zkrať(s.preklad || '', 34);
    const t3 = el('text', { x: 0, y: 23, class: 'radky' });
    t3.textContent = `${čísl(s.od)}–${čísl(s.do)} · ${čísl(s.radku)} ln.`;
    g.append(el('rect', { x: 5, y: -9, width: 9, height: 9, rx: 2, fill: `var(--${s.role})` }),
             t1, t2, t3);
    vPopisky.append(el('path', { class: 'vodic', 'data-popisek': s.nazev,
      d: `M ${xc} ${Y_PAS_D} L ${xc} ${Y_PAS_D + 12} L ${xp} ${yp - 16} L ${xp} ${yp - 6}`,
      stroke: `var(--${s.role})`, 'stroke-opacity': 0.75, 'stroke-width': 1.1 }), g);
  });

  // --- oblouky skoků POD pásem (prohnuté dolů), každý z konkrétního řádku
  for (const s of D.skoky) {
    const cil = podleJmena.get(s.do);
    if (!cil) continue;
    const x1 = pX(s.zRadek), x2 = pX(cil.od);
    const vyboc = Math.min(250, Math.max(18, Math.abs(x2 - x1) * 0.42));
    const o = el('path', {
      class: 'oblouk', stroke: `var(--${cil.role})`,
      d: `M ${x1} ${Y_PAS} C ${x1} ${Y_PAS - vyboc}, ${x2} ${Y_PAS - vyboc}, ${x2} ${Y_PAS}`,
      'stroke-width': s.varianta === 'until' ? 2.6 : 1.3,
      'stroke-opacity': s.varianta === 'until' ? 0.9 : 0.42,
      'data-z': s.z, 'data-do': s.do,
    });
    o.addEventListener('mouseenter', (ev) => bublina(ev, `${s.z} → ${s.do}`,
      `jump from line ${s.zRadek}` + (s.varianta === 'until' ? ' · repeats in a loop' : ''), s.text));
    o.addEventListener('mouseleave', skryjBublinu);
    vOblouky.append(o);
  }

  // --- volání ven: řádek nahoře, spojnice dolů k řádku volání
  const mistaV = rozsun(D.vnejsi.map((v) => pX(v.radky.reduce((a, b) => a + b, 0) / v.radky.length)),
    118, P_OKRAJ + 60, PŠ - P_OKRAJ - 60);
  D.vnejsi.forEach((v, i) => {
    const xv = mistaV[i];
    const duraz = /^DSRUN$/i.test(v.cil);
    const g = el('g', { class: 'vnejsi-uzel' + (duraz ? ' duraz' : '') });
    for (const r of v.radky) {
      const x1 = pX(r);
      g.append(el('path', { class: 'vodic', 'stroke-opacity': 0.8,
        d: `M ${x1} ${Y_PAS} C ${x1} ${Y_VNEJSI + 80}, ${xv} ${Y_VNEJSI + 90}, ${xv} ${Y_VNEJSI + 14}` }));
    }
    g.append(el('circle', { cx: xv, cy: Y_VNEJSI + 10, r: duraz ? 6 : 4,
      fill: duraz ? 'var(--gui,var(--obrazovka))' : 'var(--sed2)' }));
    const t1 = el('text', { x: xv, y: Y_VNEJSI - 10, 'text-anchor': 'middle' });
    t1.textContent = `${v.cil} · ${v.n}×`;
    const t2 = el('text', { x: xv, y: Y_VNEJSI + 1, 'text-anchor': 'middle',
      'font-size': 10, fill: 'var(--sed2)' });
    t2.textContent = v.co ? zkrať(v.co, 26) : '';
    g.append(t1, t2, titulekSVG(`${v.cil} — called ${v.n}×`,
      v.co || 'what it is does not follow from the code'));
    vVnejsi.append(g);
  });

  const svet = el('g', { id: 'svet' });
  svet.append(vOblouky, vPasy, vVnejsi, vPopisky);
  svg.appendChild(svet);
  if (S.fit) { S.fit = false; fitDoObsahu(); }
  else svet.setAttribute('transform', `translate(${S.x},${S.y}) scale(${S.k})`);
  svg.addEventListener('click', (e) => { if (e.target === svg) odznacCast(); });
}

/* Dopočítá posun a měřítko tak, aby OBSAH vyplnil plátno.
 *
 * Dřív se počítalo z pozic uzlů, jenže obsah je víc než uzly: popisky, oblouky,
 * řádek volání ven. U L2 to znamenalo kresbu v horní půlce a prázdno kolem,
 * u L0/L1 zbytečný okraj. `getBBox()` měří, co je opravdu nakreslené. */
function fitDoObsahu(okraj = 14) {
  const svg = document.getElementById('platno');
  const svet = document.getElementById('svet');
  if (!svet) return;
  svet.setAttribute('transform', 'translate(0,0) scale(1)');
  const b = svet.getBBox();
  const W = svg.clientWidth || 1000, H = svg.clientHeight || 700;
  if (!b.width || !b.height) return;
  S.k = Math.min((W - 2 * okraj) / b.width, (H - 2 * okraj) / b.height, 8);
  S.x = (W - b.width * S.k) / 2 - b.x * S.k;
  S.y = (H - b.height * S.k) / 2 - b.y * S.k;
  svet.setAttribute('transform', `translate(${S.x},${S.y}) scale(${S.k})`);
  const st = document.getElementById('stav');
  st.textContent = st.textContent.replace(/\d+ %$/, `${Math.round(S.k * 100)} %`);
}

/* Rozsune body tak, aby mezi sousedy byla aspoň `mez`, a drží je v mezích.
   Oboustranně: kde jsou dva popisky blíž, rozestrčí se OBA o půlku schodku.
   Jednostranné tlačení dolů odsune celou spodní půlku od jejích pásů;
   globální posun zase rozhodí horní část, kde se nic nekřížilo. */
function rozsun(body, mez, min, max) {
  const v = body.slice();
  if (!v.length) return v;
  for (let it = 0; it < 80; it++) {
    let pohyb = 0;
    for (let i = 0; i < v.length - 1; i++) {
      const d = v[i + 1] - v[i];
      if (d < mez) { const p = (mez - d) / 2; v[i] -= p; v[i + 1] += p; pohyb += p; }
    }
    if (pohyb < 0.01) break;
  }
  if (v[0] < min) { v[0] = min; for (let i = 1; i < v.length; i++) v[i] = Math.max(v[i], v[i - 1] + mez); }
  if (v[v.length - 1] > max) {
    v[v.length - 1] = max;
    for (let i = v.length - 2; i >= 0; i--) v[i] = Math.min(v[i], v[i + 1] - mez);
  }
  return v;
}

function titulekSVG(nadpis, text) {
  const e = el('title'); e.textContent = `${nadpis}\n${text}`; return e;
}

function dlazdiceProgramu() {
  const D = S.pd, s = D.souhrn;
  const d = [
    [čísl(D.radku), 'lines in the file', `${čísl(s.radkuDat)} data description · ${čísl(s.radkuKodu)} executable code`],
    [čísl(s.sekci), 'parts of the program', `+ ${s.odstavcu} nested paragraphs`],
    [čísl(s.skoku), 'jumps between parts', 'each from a specific line'],
    [čísl(D.vnejsi.length), 'external programs', `${s.volaniVen} calls out`],
    [čísl(D.copybooky.length), 'included copybooks', 'shared data descriptions'],
  ];
  document.getElementById('dlazdice').innerHTML = d
    .map(([b, p, i]) => `<div class="dl"><b>${b}</b><span>${p}</span><i>${i}</i></div>`).join('');
}

function panelProgram() {
  const D = S.pd;
  const pocty = new Map();
  for (const s of D.sekce) pocty.set(s.role, (pocty.get(s.role) || 0) + 1);
  const legenda = Object.entries(D.popisRoli || {}).filter(([k]) => pocty.get(k))
    .map(([k, v]) => `<li><span class="tecka" style="background:var(--${k})"></span>${v}` +
      `<span class="pocet">${pocty.get(k)}</span></li>`).join('');
  const vnejsi = D.vnejsi.map((v) => `<li class="${/^DSRUN$/i.test(v.cil) ? 'duraz' : ''}">` +
    `<span class="kolik">${v.n}×</span><span class="cil">${v.cil}</span>` +
    (v.co ? `<span class="co">${v.co}</span>` : '') + '</li>').join('');
  const sdilene = D.copybooky.filter((c) => c.sdiliS.length);
  const nej = sdilene.slice().sort((a, b) => b.sdiliS.length - a.sdiliS.length)[0];
  const nejvetsi = D.sekce.filter((s) => s.druh === 'sekce')
    .slice().sort((a, b) => b.radku - a.radku).slice(0, 5);
  const gui = D.vnejsi.find((v) => /^DSRUN$/i.test(v.cil));

  /* Pořadí podle toho, co je o TOMHLE programu, ne o mapě: čím se zabývá,
     co je v něm největší, co volá ven, s kým sdílí data. Výklad, jak se
     obrázek čte, je stejný pro všech 707 programů — patří tedy dolů
     a sbalený, ne nad konkrétní čísla. */
  document.getElementById('panel').innerHTML = `
    <h2>${D.program}</h2>
    <p class="cesta">${D.cesta} · ${S.podsystem}</p>
    ${gui ? `<p class="pozn duraz-gui"><b>Tied to the GUI.</b> Calls
      <code>DSRUN</code> ${gui.n}× — the Dialog System runtime. This program cannot be
      moved without rebuilding its screens.</p>` : ''}
    <h3>Biggest parts</h3>
    <ul>${nejvetsi.map((s) => `<li>${s.preklad || s.nazev}<span>${s.radku.toLocaleString('en')} ln.</span></li>`).join('')}</ul>
    <h3>Parts by role</h3><ul class="legenda">${legenda || '<li class="nic">no parts</li>'}</ul>
    <h3>Calls out to</h3><ul class="seznam">${vnejsi || '<li class="nic">nothing</li>'}</ul>
    <h3>Shared data</h3>
    <p class="pozn">${D.copybooky.length} copybooks included; ${sdilene.length} of them
      shared with other programs${nej ? `. <b>${nej.nazev}</b> is shared with
      ${nej.sdiliS.length} more — changing it hits every one of them.` : '.'}</p>
    <details class="vyklad">
      <summary>How to read this picture</summary>
      <p class="pozn">The horizontal bar is <b>the whole source file to line scale</b> —
        first line on the left, last on the right. Every coloured block is one part and is
        <b>exactly as wide as it has lines</b>. The arcs above are jumps between parts,
        each starting at the line where that jump actually sits in the code.</p>
      <p class="pozn">The grey block on the left is the <b>data description</b> — the part
        of a COBOL file that only declares the shape of the data. It is drawn
        <b>narrower than its real share</b> (the scale break is marked) so the executable
        code gets the width; its true size is in the tiles above.</p>
      <p class="pozn">That tangle is not decoration. This is how the program runs.</p>
    </details>
    <p class="tip">Hover any part or any arc · “← back” returns to the subsystem.</p>`;
}

function zvyrazniCast(nazev) {
  const svg = document.getElementById('platno');
  for (const o of svg.querySelectorAll('.oblouk')) {
    const patri = o.dataset.z === nazev || o.dataset.do === nazev;
    o.classList.toggle('ztlumeno', !patri);
    o.setAttribute('stroke-opacity', patri ? 0.95 : 0.1);
    o.setAttribute('stroke-width', patri ? 2.4 : 1.3);
  }
  for (const p of svg.querySelectorAll('.pas')) p.classList.toggle('ztlumeno', p.dataset.sekce !== nazev);
  for (const p of svg.querySelectorAll('[data-popisek]')) p.classList.toggle('ztlumeno', p.dataset.popisek !== nazev);
}

function odznacCast(jenHover) {
  const svg = document.getElementById('platno');
  if (!jenHover) S.vybranaCast = null;
  for (const o of svg.querySelectorAll('.oblouk')) {
    o.classList.remove('ztlumeno');
    const smycka = o.getAttribute('stroke-width') === '2.6';
    o.setAttribute('stroke-opacity', smycka ? 0.9 : 0.42);
    o.setAttribute('stroke-width', smycka ? 2.6 : 1.3);
  }
  for (const p of svg.querySelectorAll('.pas,[data-popisek]')) p.classList.remove('ztlumeno');
  if (!jenHover) panelProgram();
}

function vyberCast(s) {
  const D = S.pd;
  S.vybranaCast = s.nazev;
  zvyrazniCast(s.nazev);
  const dovnitr = D.skoky.filter((x) => x.do === s.nazev);
  const ven = D.skoky.filter((x) => x.z === s.nazev);
  const vola = D.vnejsi.filter((v) => v.zSekci.includes(s.nazev));
  const sez = (nadpis, polozky) => (polozky.length
    ? `<h3>${nadpis} (${polozky.length})</h3><ul class="seznam">` +
      polozky.map((p) => `<li><code>${p}</code></li>`).join('') + '</ul>' : '');
  document.getElementById('panel').innerHTML = `
    <h2>${s.nazev}</h2>
    <p class="uvod">${s.preklad || '<i>not translated</i>'}${s.prekladMuj
      ? ' <span style="opacity:.6">(our translation)</span>' : ''}</p>
    <dl>
      <dt>lines</dt><dd>${čísl(s.od)}–${čísl(s.do)}</dd>
      <dt>size</dt><dd>${čísl(s.radku)} ln. · ${čísl(s.radkuKodu)} of them code</dd>
      <dt>role</dt><dd>${(D.popisRoli || {})[s.role] || s.role}</dd>
      <dt>jumped into</dt><dd>${s.volanoZ}×</dd>
      <dt>jumps out</dt><dd>${s.volaDo}×</dd>
    </dl>
    ${sez('Jumped into from', dovnitr.map((x) => `${x.z} · ln. ${x.zRadek}`))}
    ${sez('Jumps out to', ven.map((x) => `${x.do} · ln. ${x.zRadek}`))}
    ${vola.length ? sez('Calls an external program', vola.map((v) => `${v.cil} · ${v.n}×`)) : ''}
    <button id="zpet-cast">← back to the whole program</button>`;
  document.getElementById('zpet-cast').onclick = () => odznacCast();
}

function bublina(ev, nadpis, text, kod) {
  const b = document.getElementById('bublina');
  b.innerHTML = `<b>${nadpis}</b>${text}` +
    (kod ? `<code>${kod.replace(/</g, '&lt;')}</code>` : '');
  b.hidden = false;
  b.style.left = Math.min(ev.clientX + 16, innerWidth - 350) + 'px';
  b.style.top = Math.max(8, ev.clientY - 20) + 'px';
}
const skryjBublinu = () => { document.getElementById('bublina').hidden = true; };


/* =============================================================================
   DASHBOARD — domovská záložka.

   Ukazuje, CO analýza zvládla a ZA JAK DLOUHO. Všechna čísla jdou z
   data/metriky.json, který vzniká měřením (nastroje/metriky.py); do stránky
   se žádné číslo nepíše rukou.

   ⚠️ JEDINÁ VĚC NA TÉHLE STRÁNCE, KTERÁ NENÍ MĚŘENÁ, je srovnání s člověkem
   (sekce `srovnani()`). Stojí na jednom jediném předpokladu — rychlosti čtení
   kódu — a ten si čtenář může sám přestavit posuvníkem. Je proto vizuálně
   oddělené (šrafovaný rámec, štítek ESTIMATE) a nikdy nesmí splývat
   s dlaždicemi měřených hodnot. Kdo to splete, vydá náš odhad za náš výsledek.
   ========================================================================== */
const čís = (n) => Number(n).toLocaleString('en-GB');

/* Výchozí předpoklad srovnání: kolik řádků nedokumentovaného COBOLu přečte
   člověk za hodinu soustředěné práce. Posuvník jde od 250 (hustý kód, který
   se musí rozkreslovat) po 2 000 (zběžné čtení). */
const ČTENÍ_VÝCHOZÍ = 1000;

async function dashboard() {
  const cil = document.getElementById('dash');
  let M;
  try { M = await (await fetch('data/metriky.json')).json(); }
  catch { cil.innerHTML = '<p class="pozn">data/metriky.json is missing — run nastroje/pruchod.py.</p>'; return; }
  // Podklad o hotovém převodu je nepovinný: analýza dává smysl i dřív, než se
  // cokoli přepíše. Chybí-li, sekce o migraci se prostě nevykreslí.
  let P = null;
  try { P = await (await fetch('data/prevod.json')).json(); } catch { /* ještě se nepřevádělo */ }
  const m = M.mereno, k = M.korpus, g = M.graf, mp = M.mapa;
  // Duplicita uvnitř stromu a obrazovky po podsystémech. Nepovinné — podklad
  // vyrábí nastroje/duplicita.py a bez něj dashboard jen vynechá, co z něj je.
  const N = S.narocnost || null;
  const meta = (S.data && S.data.meta) || {};
  const guiPodil = k.programu ? M.guiZavislost.programuSGui / k.programu : 0;

  const kpi = (b, popis, pod, trida) =>
    `<div class="k ${trida || ''}"><b>${b}</b><span>${popis}</span>${pod ? `<i>${pod}</i>` : ''}</div>`;

  const nej = [...S.data.podsystemy].sort((a, b) => b.radku - a.radku).slice(0, 10);
  const maxR = Math.max(...nej.map((p) => p.radku));
  const pruh = (p) => {
    const podil = p.programu ? (p.sGui || 0) / p.programu : 0;
    return `<li><span class="jm">${p.id}</span>
      <span><span class="bar" style="width:${Math.max(2, (p.radku / maxR) * 100)}%"></span></span>
      <span class="cis">${čís(p.radku)} ln.</span></li>`;
  };
  /* Žebříček NÁROČNOSTI místo podílu GUI.
     Původní žebříček „Most tied to the GUI" měl u prvních deseti podsystémů
     samé 100 % — deset stejně dlouhých proužků neříká nic o pořadí, a přitom
     vedle sebe seděl s nadpisem, který pořadí slibuje. Celosystémový podíl GUI
     zůstává o dlaždici výš, tam smysl dává. */
  const pruhNar = S.nar
    ? [...S.nar.entries()].filter(([, n]) => !n.mimoScope)
        .map(([id, n]) => ({ id, ...n }))
        .sort((a, b) => b.index - a.index).slice(0, 10)
    : [];

  cil.innerHTML = `
    <h2>${meta.nazev || 'Code'} — scale of the system, and of the migration</h2>
    <p class="lead">Three questions decide whether a legacy migration is worth starting:
      <b>how big is the system</b>, <b>how long does it take to understand it</b>, and
      <b>what does it cost to rewrite a piece of it</b>. This page answers all three with
      measured figures from this codebase — not estimates, except where it says so.</p>

    <h3>The run</h3>
    <div class="kpi">
      ${kpi(`${m.celkemS}<small> s</small>`, 'delivery → working map',
            `all ${(m.krokySekundy || []).length} steps, from sizing up the delivered tree to
             placing the map template next to the data${
              m.rozptyl ? ` — median of ${m.opakovani} runs, ${m.rozptyl.minS}–${m.rozptyl.maxS} s` : ''}`)}
      ${kpi(čís(m.radkuZaSekundu), 'lines per second', 'measured against the whole run, not just the reading step')}
      ${kpi(`${g.uspesnostProcent}<small> %</small>`, 'of call links resolved',
            `${čís(g.nevyresenych)} of ${čís(g.hran)} left unresolved`)}
      ${kpi(čís(k.souboruCbl), 'source files read', `${čís(k.copybooku)} copybooks · ${čís(k.screensetu)} screensets`)}
    </div>

    <h3>What was analysed</h3>
    <div class="kpi">
      ${kpi(čís(k.radkuKodu), 'lines of COBOL', `+ ${čís(k.radkuCopybooku)} lines of shared data descriptions`)}
      ${/* ⚠️ Na stránce jsou ČTYŘI počty „programů" — 711, 707, 706, 681 —
            a všechny jsou pravdivé. Bez věty, která je dá do řady, to vypadá,
            že si stránka protiřečí; čtenář si pak nevěří ani u zbytku.
            Řetěz se proto píše celý tady, na jednom místě, a ostatní čísla
            na něj ukazují. Doplněno 1. 11. 2026. */ ''}
      ${kpi(čís(k.programu), 'real programs',
            `out of the ${čís(k.souboruCbl)} files read — ${k.fragmentu} are data descriptions ` +
            `(FD / SELECT) copied into other programs, the remaining ` +
            `${k.souboruCbl - k.programu - k.fragmentu} sit in the copybook folder or are empty`)}
      ${kpi(čís(g.uzlu), 'parts inside programs', `sections and paragraphs, each with its line range`)}
      ${kpi(čís(g.hran), 'links between them', `${čís(mp.vazebProgramu)} program-to-program · ${čís(mp.sdilenychDvojic)} sharing data`)}
    </div>

    <h3>What it found</h3>
    <div class="kpi">
      ${kpi(`${Math.round(guiPodil * 100)}<small> %</small>`, 'of programs tied to the GUI',
            `${čís(M.guiZavislost.programuSGui)} programs call DSRUN ${čís(M.guiZavislost.volaniDsrun)}× — they cannot be ported separately from their screens`, 'duraz')}
      ${N ? kpi(`${N.souhrn.kopiiProcent}<small> %</small>`, 'of the code inside the tree is a copy',
            `${čís(N.souhrn.kopiiSouboru)} of ${čís(N.mereno.souboru)} files are near-identical to
             another file (${Math.round(N.metoda.prahShody * 100)} % of lines or more), measured
             over ${čís(N.mereno.radkuBezKomentaru)} lines with comments excluded`)
          : kpi(čís(mp.podsystemu), 'subsystems', 'taken from the folders the authors themselves used')}
      ${kpi(`${(k.radkuVsechKopii / k.radkuKodu).toFixed(1)}×`, 'copies of the whole tree in the delivery',
            `${čís(k.souboruCblVRepu)} .cbl files in the delivery hold ${čís(k.souboruCbl)} distinct
             programs — the same tree packed several times over`)}
      ${N ? kpi(čís(mp.podsystemu), 'subsystems', 'taken from the folders the authors themselves used') : ''}
    </div>
    <p class="pozn"><b>Two different things with a similar name, and both are true.</b>
      ${(k.radkuVsechKopii / k.radkuKodu).toFixed(1)}× is about the <b>delivery</b>: the same
      source tree is in it several times over, and the run works out for itself which copy to
      read. That costs disk space, not rewriting.${N ? ` ${N.souhrn.kopiiProcent} % is about the
      inside of that one tree: files that are near-copies of another file — work that would
      otherwise be paid for twice.` : ''}</p>
    <p class="pozn"><b>Whether that code is still reachable is a third question, and it is not
      answered here.</b> A call graph can only say that nobody calls a program, and that is an
      entry point as often as it is dead code. What is <b>provably</b> reachable was measured
      separately, from three sides, and it is on the <b>Proof</b> tab (Phase 0).</p>

    <div class="dvojice">
      <div>
        <h3>Biggest subsystems</h3>
        <ul class="pruhy">${nej.map(pruh).join('')}</ul>
        <p class="pozn">All lines of the delivered source, comments included.</p>
      </div>
      ${pruhNar.length ? `<div>
        <h3>Hardest to rewrite — indicator</h3>
        <ul class="pruhy">${pruhNar.map((p) => `<li><span class="jm">${p.id}</span>
          <span><span class="bar gui" style="width:${Math.max(2, p.index * 100)}%"></span></span>
          <span class="cis">${Math.round(p.index * 100)} %</span></li>`).join('')}</ul>
        <p class="pozn"><b>An indicator, not a measurement.</b> ${VAHA_KODU} parts unique lines
          (comments excluded, minus lines that are a copy of another file) and
          ${VAHA_OBRAZOVEK} part screens to rebuild, each scaled against the largest subsystem;
          100 % would be the worst on both counts at once. The inputs are measured, the ratio
          between them is our choice — the <b>Code map</b> shows the arithmetic per subsystem.
          ${[...MIMO_SCOPE].join(', ')} is outside the scope of the modernisation and is left
          out of this list.</p>
      </div>` : ''}
    </div>

    ${prevodSekce(P, M)}

    ${srovnani(M)}

    <h3>Every step, start to finish</h3>
    <table class="kroky">
      ${(m.krokySekundy || []).map((kr) => `<tr>
        <td><b>${kr.klic}</b> — ${kr.popis}</td>
        <td>${kr.s.toFixed(2)} s</td>
        <td class="podil"><span style="width:${Math.max(1, (kr.s / m.celkemS) * 100)}%"></span></td>
      </tr>`).join('')}
      <tr class="soucet"><td>whole run</td><td>${m.celkemS} s</td><td></td></tr>
    </table>
    ${M.inventura ? `<p class="pozn">Nothing here is prepared by hand beforehand. The run is
      given the delivery as it arrived and works out for itself which part of it is the real
      source tree — here <b>${M.inventura.kanonickyStrom}</b>, because ${M.inventura.duvod}.
      Every program sits in the delivery <b>${M.inventura.kopiiProgramu}× over</b>; telling the
      copies apart is part of the run.</p>` : ''}
    ${kodovaniSekce(M)}

    <h3>The rest of the picture</h3>
    <table>
      <tr><td>Map data written</td><td>${čís(mp.podkladKB)} kB · ${mp.podkladProgramuMB} MB of program views</td></tr>
      <tr><td>Delivery size on disk</td><td>${(k.bajtuVRepu / 1024 / 1024 / 1024).toFixed(2)} GB · ${čís(k.souboruVRepu)} files</td></tr>
      <tr><td>Analyser regression tests</td><td>142 / 142</td></tr>
      ${M.stroj ? `<tr><td>Measured on</td><td>${[M.stroj.cpu, M.stroj.jader && `${M.stroj.jader} cores`,
        M.stroj.pametGB && `${M.stroj.pametGB} GB`, M.stroj.node && `Node ${M.stroj.node}`]
        .filter(Boolean).join(' · ')}</td></tr>` : ''}
    </table>
    ${rozsahMereni(M)}`;

  posuvnikCteni(M);
}

/* ---------------------------------------------------------------------------
   Rozsah měřeného času — co do těch sekund patří a co ne.

   Je tu proto, že samotné číslo „8,5 s" slibuje víc, než co se měří: stažení
   repozitáře, rozhodnutí, který ze tří stromů je kanonický, a napsání slovníku
   jsou lidská práce na hodiny a v tom čase NEJSOU. Oba seznamy jsou v
   data/metriky.json, tedy vedle měřicího kódu — kdo změní, co se časuje,
   vidí ten seznam na témž místě.
   ------------------------------------------------------------------------ */
function rozsahMereni(M) {
  const r = M.rozsah;
  if (!r) return '';
  const li = (xs) => xs.map((x) => `<li>${x}</li>`).join('');
  return `
    <div class="rozsah">
      <div>
        <h4>Inside the ${M.mereno.celkemS} s</h4>
        <ul class="ano">${li(r.zahrnuto)}</ul>
      </div>
      <div>
        <h4>Not inside it</h4>
        <ul class="ne">${li(r.nezahrnuto)}</ul>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------------------
   KÓDOVÁNÍ — doklad, že se nic neztratilo.

   Legacy dodávka bývá namíchaná z kódování, která vznikala třicet let.
   Přečíst ji „nějak" umí každý; podstatné je **umět doložit, že nevypadlo nic**.
   Proto je tady `neprecteno` jako samostatné číslo, ne jako poznámka: nula je
   tvrzení, které se dá ověřit, a nenulová hodnota se musí dát dohledat.
   ------------------------------------------------------------------------ */
function kodovaniSekce(M) {
  const k = M.kodovani;
  if (!k) return '';
  const vypis = k.podleKodovani
    .map((x) => `<b>${čís(x.souboru)}</b> ${x.jmeno}`)
    .join(' · ');
  const vada = k.neprecteno > 0;
  return `
    <p class="pozn"><b>${vada ? '⚠ ' : ''}Encodings found in the delivery:</b> ${vypis}${
      k.binarnich ? ` · ${čís(k.binarnich)} carrying NUL control bytes inside literals` : ''}.
      ${k.normalizovano
        ? 'Because the delivery mixes encodings, every file was converted to UTF-8 before analysis, line numbers unchanged. '
        : 'The delivery uses one encoding throughout, so no conversion was needed. '}
      <b>Files that could not be read safely: ${čís(k.neprecteno)}.</b>${
        vada
          ? ` They are listed rather than skipped quietly — ${k.neprectene
              .slice(0, 3).map((c) => `<code>${c.split('/').pop()}</code>`).join(', ')}${
              k.neprecteno > 3 ? ` and ${čís(k.neprecteno - 3)} more` : ''}.`
          : ' Nothing was dropped on the way in.'}</p>`;
}

/* ---------------------------------------------------------------------------
   OD ANALÝZY K BĚŽÍCÍ APLIKACI.

   Analýza odpovídá na „co tam je". Zákazník se ale ptá dál: **a co stojí to
   přepsat.** Na to se nedá odpovědět odhadem — odpovídá se jediným hotovým
   kusem, u kterého jde změřit, co z něj vzniklo. Čísla jdou z
   data/prevod.json (nastroje/prevod-metriky.py), ne ze stránky.

   ⚠️ Co tu NENÍ: lidský čas. Neměříme ho, takže ho stránka nesmí předstírat.
   ------------------------------------------------------------------------ */
function prevodSekce(P, M) {
  if (!P || !P.original.prevedenoSouboru) return '';
  const o = P.original, v = P.vysledek;
  const pomer = o.prevedenoRadku ? v.radkuObchodniVrstvy / o.prevedenoRadku : 0;
  const guiPodil = M.korpus.programu
    ? Math.round((M.guiZavislost.programuSGui / M.korpus.programu) * 100) : 0;

  const kpi = (b, popis, pod, trida = '') =>
    `<div class="k ${trida}"><b>${b}</b><span>${popis}</span>${pod ? `<i>${pod}</i>` : ''}</div>`;

  return `
    <section id="prevod">
    <h3>From analysis to a working application</h3>
    <p class="pozn" style="margin-bottom:12px">One subsystem of this system —
      <b>${P.podsystem}</b>, the part that talks to the banks — has been rewritten and runs.
      It is the only honest basis for estimating the rest, so here is exactly what it was
      and what came out.</p>
    <div class="kpi">
      ${kpi(`${čís(o.prevedenoRadku)}`, 'lines of COBOL rewritten',
            `${o.prevedenoSouboru} of the ${o.souboru} files in ${P.podsystem} (${čís(o.radku)} lines)`)}
      ${kpi(čís(v.radkuObchodniVrstvy), 'lines of business logic',
            `${pomer.toFixed(2)} lines of TypeScript per line of COBOL`)}
      ${kpi(čís(v.radkuAplikace), 'lines of application around it',
            'web interface, server and test data — none of which existed before')}
      ${kpi(čís(v.testu), 'tests', v.testyProsly ? 'all passing' : '⚠ not all passing',
            v.testyProsly ? '' : 'duraz')}
    </div>
    <p class="pozn"><b>Read this as a sample, not as a rate.</b> The rewritten part is the
      batch-file logic, which has no screens attached to it. ${guiPodil} % of the whole
      system does have screens — those programs cannot be ported without rebuilding the
      user interface with them, and that is a different kind of work with a different cost.
      The figure that <i>does</i> carry over is the dependency count: <b>${v.zavislosti}</b>.
      Nothing was added to the stack that has to be maintained, upgraded or licensed.</p>
    </section>`;
}

/* ---------------------------------------------------------------------------
   SROVNÁNÍ S ČLOVĚKEM — jediná nemětřená část stránky.

   Celé to stojí na JEDNOM předpokladu: kolik řádků kódu přečte člověk za
   hodinu. Nic dalšího si nevymýšlím — žádnou rychlost kreslení grafu, žádnou
   produktivitu týmu. Předpoklad je navíc posuvníkem k přestavění, takže
   zákazník nemusí věřit našemu číslu a může dosadit svoje.

   Odhad záměrně pokrývá jen ČTENÍ, tedy méně než co průchod doopravdy udělá.
   Je to tedy dolní mez lidské práce, ne horní — a tak je i popsaný.
   ------------------------------------------------------------------------ */
function srovnani(M) {
  const k = M.korpus, g = M.graf;
  return `
    <h3 class="srov-h3">Compared with doing it by hand</h3>
    <section class="srovnani" id="srovnani">
      <div class="stitek">Estimate — <b>not</b> a measurement</div>
      <p class="uvod">Everything above this line is measured. Everything inside this
        frame is arithmetic on top of <b>one assumption</b>: how fast a person reads
        undocumented COBOL. Move the slider and the figures follow — the number is
        yours to choose, not ours to assert.</p>

      <div class="odh-kpi">
        <div class="k"><b>≈ <span id="s-hodin"></span><small> h</small></b>
          <span>of reading, one person</span>
          <i><span id="s-arit"></span></i></div>
        <div class="k"><b>≈ <span id="s-dnu"></span><small> days</small></b>
          <span>of focused work</span><i>at 8 productive hours a day</i></div>
        <div class="k"><b>≈ <span id="s-mesicu"></span><small> months</small></b>
          <span>of one engineer's time</span><i>at 21 working days a month</i></div>
        <div class="k vysledek"><b>≈ <span id="s-nasobek"></span><small>×</small></b>
          <span>faster, this run</span>
          <i>the estimate divided by the measured ${M.mereno.celkemS} s —
            an estimate too, because the number above it is one</i></div>
      </div>

      <label class="posuvnik">
        <span>Reading speed assumed</span>
        <input type="range" id="s-rychlost" min="250" max="2000" step="50" value="${ČTENÍ_VÝCHOZÍ}">
        <output id="s-rychlost-v"></output>
        <button type="button" class="maly" id="s-reset">Reset</button>
      </label>

      <p class="pozn">The estimate covers <b>reading only</b>. Writing down what was
        found — ${čís(g.hran)} links, ${čís(g.uzlu)} parts with their line ranges and
        ${čís(k.souboruCbl)} per-program views — is further human work we have
        <b>not</b> estimated at all. Read it as a floor, not a ceiling. And it is
        one-off: after every change to the code a person starts over, while the pass
        above re-runs in ${M.mereno.celkemS} seconds.</p>
    </section>`;
}

/* Obsluha posuvníku. Přepisuje jen hodnoty, ne strukturu — proto adresně
   přes id a ne přes innerHTML celé sekce. */
function posuvnikCteni(M) {
  const vst = document.getElementById('s-rychlost');
  if (!vst) return;
  const k = M.korpus, sekundStroje = M.mereno.celkemS;
  const prekresli = () => {
    const rychlost = Number(vst.value);
    const hodin = k.radkuKodu / rychlost;
    const nasobek = (hodin * 3600) / Math.max(0.01, sekundStroje);
    document.getElementById('s-hodin').textContent = čís(Math.round(hodin));
    document.getElementById('s-dnu').textContent = čís(Math.round(hodin / 8));
    document.getElementById('s-mesicu').textContent = (hodin / 8 / 21).toFixed(1);
    // Na stovky tisíc je přesnost na jednotky klamná — zaokrouhluju na tisíce,
    // ať se nikdo nechytá čísla, které stejně stojí na odhadu.
    document.getElementById('s-nasobek').textContent =
      čís(nasobek >= 10000 ? Math.round(nasobek / 1000) * 1000 : Math.round(nasobek));
    document.getElementById('s-rychlost-v').textContent = `${čís(rychlost)} lines / hour`;
    document.getElementById('s-arit').textContent =
      `${čís(k.radkuKodu)} lines ÷ ${čís(rychlost)} per hour`;
  };
  vst.addEventListener('input', prekresli);
  document.getElementById('s-reset').addEventListener('click', () => {
    vst.value = String(ČTENÍ_VÝCHOZÍ); prekresli();
  });
  prekresli();
}

/* Záložky: dashboard je domovská stránka, mapa je druhá. Mapa má svoje adresy
   (#BANKS/CAIXA2), takže dashboard dostal vlastní (#dashboard) a výchozí
   stav bez adresy je dashboard. */
function zalozky() {
  // Mapa je jediná záložka s vlastními adresami (#BANKS/CAIXA2); ostatní jsou
  // stránky textu a čísel, takže mají prostou kotvu. Seznam je tady jeden,
  // ať přidání další záložky znamená jeden řádek, ne čtyři místa.
  const STRANKY = { dash: 'dashboard', proof: 'proof', aplikace: 'application' };
  const prepni = (tab) => {
    const naStrance = tab in STRANKY;
    document.body.classList.toggle('dash-aktivni', naStrance);
    for (const id of Object.keys(STRANKY)) {
      document.getElementById(id).hidden = id !== tab;
    }
    for (const b of document.querySelectorAll('#zalozky button[data-tab]')) {
      b.classList.toggle('aktivni', b.dataset.tab === tab);
    }
    // Aplikace je samostatný build za rámem; adresu dostane až při prvním
    // přepnutí, aby se její WASM nestahoval lidem, kteří ji neotevřou.
    if (tab === 'aplikace') {
      const ram = document.getElementById('ram-aplikace');
      if (ram && !ram.src) ram.src = 'aplikace/index.html';
    }
    if (naStrance) {
      history.replaceState(null, '', `${location.pathname}${location.search}#${STRANKY[tab]}`);
    } else { doAdresy(); fit(); }
  };
  for (const b of document.querySelectorAll('#zalozky button[data-tab]')) {
    b.addEventListener('click', () => prepni(b.dataset.tab));
  }
  return prepni;
}


/* ===========================================================================
   PROOF — výsledek měřidla.

   Záložka ukazuje jedinou věc: původní COBOL a modernizovaná aplikace dostaly
   týž vstup a vyrobily týž soubor, bajt po bajtu. Všechna čísla jdou
   z `data/meridlo.json`, který vyrábí `nastroje/meridlo-export.py` ze
   skutečných běhů — na téhle stránce není ručně napsané ani jedno.

   Mez měřidla je tu schválně stejně viditelná jako výsledek. Prezentace, která
   ukáže jen to hezké, se zákazníkovi vrátí v první technické due diligence.
   =========================================================================== */
async function meridlo() {
  const cil = document.getElementById('proof');
  if (!cil) return;
  let D;
  try { D = await (await fetch('data/meridlo.json')).json(); }
  catch {
    cil.innerHTML = '<p class="pozn">data/meridlo.json is missing — run nastroje/meridlo-export.py.</p>';
    return;
  }
  // Propustnost je nepovinná: shoda bajt po bajtu je doklad sama o sobě a dává
  // smysl i bez měření výkonu. Chybí-li podklad, sekce se vynechá — záložka
  // nesmí spadnout kvůli tomu, co je na ní navíc.
  //
  // ⚠️ `.json()` v `try` na to NESTAČÍ — viz past popsaná u fáze 0 o pár
  // řádků níž. `server.mjs` vrací na 404 tělo `404`, což je **platný JSON**,
  // takže `catch` nechytí nic a `V` není `null`, ale číslo. Sekce pak spadne
  // uprostřed vykreslování a **vezme s sebou celou záložku Proof**.
  // Opraveno 30. 10. 2026; na veřejné adrese se to neprojevilo, protože
  // GitHub Pages vrací na 404 stránku v HTML, na které `.json()` spadne.
  let V = null;
  try {
    const o = await fetch('data/vykon.json');
    if (o.ok) { const d = await o.json(); if (d && d.mereno) V = d; }
  } catch { /* neměřilo se */ }
  // Stejně nepovinná je fáze 0: podklad vzniká jen tam, kde se nad databází
  // doopravdy běželo (`nastroje/faze0-export.py` potřebuje běžící PostgreSQL).
  // Chybí-li, sekce se vynechá a zbytek záložky stojí.
  //
  // ⚠️ Samotné `.json()` v `try` na to NESTAČÍ a je to past, na kterou jsem
  // naletěl: server mapy vrací na 404 tělo „404" — a to je **platný JSON**
  // (číslo). `catch` se tedy nespustí, podklad není null, sekce se začne
  // vykreslovat, spadne na prvním poli a vezme s sebou CELOU záložku. Proto
  // se chybějící podklad pozná ze stavu odpovědi **a** z tvaru dat.
  let F = null;
  try {
    const o = await fetch('data/faze0.json');
    if (o.ok) { const d = await o.json(); if (d && d.mereno) F = d; }
  } catch { /* nebyla fáze 0 */ }
  const s = D.souhrn, v = D.vyriznuti || {}, impl = D.implementace || {};
  const meta = (S.data && S.data.meta) || {};
  const kpi = (b, popis, pod, trida) =>
    `<div class="k ${trida || ''}"><b>${b}</b><span>${popis}</span>${pod ? `<i>${pod}</i>` : ''}</div>`;
  // Mezery se v pevné šířce nepoznají, a přitom jsou v souboru pro banku
  // polovina obsahu — proto se kreslí jako tečka.
  const vidt = (t) => t.replace(/ /g, '<span class="pad">·</span>');

  const pripady = D.pripady.map((p) => `<tr>
      <td class="kod">${p.carteira}</td><td class="kod">${p.especie}</td>
      <td class="cis">${čís(p.vet)}</td><td class="cis">${čís(p.bajtu)}</td>
      <td class="kod">${p.prvniNossoNumero || ''}</td>
      <td>${p.shoda ? '<span class="ok">identical</span>' : '<b>DIFFERS</b>'}</td>
    </tr>`).join('');

  const pole = D.ukazkovaVeta.map((f) => `<tr>
      <td class="kod">${f.jmeno}</td>
      <td class="cis">${f.od}–${f.do}</td>
      <td class="kod">${f.pic}</td>
      <td class="kod">${vidt(f.sonda)}</td>
      <td class="kod">${vidt(f.aplikace)}</td>
      <td>${f.sonda === f.aplikace ? '<span class="ok">=</span>' : '<b>≠</b>'}</td>
    </tr>`).join('');

  cil.innerHTML = `
    <h2>${meta.nazev || 'The system'} — proof that the rewrite behaves like the original</h2>
    <p class="lead">A rewrite is only worth as much as the evidence that it does the same thing.
      Here the original COBOL and the new implementation were given <b>the same input</b> and
      their output files were compared <b>byte for byte</b> — not screenshot by screenshot,
      not test by test.</p>

    <h3>The measurement</h3>
    <div class="kpi">
      ${kpi(čís(s.vet), 'records compared', `across ${s.pripadu} independent cases`)}
      ${kpi(čís(s.bajtu), 'bytes compared', 'every byte of every record, including the line endings')}
      ${kpi(s.shodaVsude ? 'identical' : 'DIFFERS', 'result',
            s.shodaVsude ? `not one byte apart${impl.jazyk ? ` — the rewrite runs on <b>${impl.jazyk}</b>` : ''}`
                         : 'see the field table below', s.shodaVsude ? '' : 'duraz')}
      ${kpi(čís(s.poliVeVete), 'fields per record', 'each one carrying a line reference into the original COBOL')}
    </div>

    <h3>How the original was run at all</h3>
    <p class="lead">The original program cannot be started: its control flow lives in a GUI
      runtime we do not have, and the delivery contains no data. So it was not started —
      <b>the part that builds the record was cut out of it mechanically</b>, compiled, and run
      on its own. The cut is done by a script, so every line can be traced back.</p>
    <div class="kpi">
      ${kpi(čís(v.radkuZOriginalu || 0), 'lines taken from the original', `out of ${čís(v.useku || 0)} marked ranges`)}
      ${kpi(čís(v.radkuObsluhy || 0), 'lines of harness around it', 'open the files, feed the case in, write the result out')}
      ${kpi(čís(v.odchylek || 0), 'documented deviations', 'compiler dialect only — none of them touches the arithmetic')}
      ${kpi('3', 'negative controls', 'deliberate defects injected; the measurement caught all three')}
    </div>

    <h3>The cases</h3>
    <table class="tab">
      <tr><th class="kod">carteira</th><th class="kod">espécie</th><th>records</th><th>bytes</th>
          <th class="kod">first nosso número</th><th>result</th></tr>
      ${pripady}
    </table>
    <p class="pozn">Carteira 12 is the only value where the original overwrites the first digit of
      the boleto number with a 9. Measuring only that one would leave the other branch of the
      check digit — the one most receivables get — untested.</p>

    <h3>One record, field by field</h3>
    <p class="lead">This is the first record of the first case, as both sides produced it.
      Spaces are drawn as <span class="pad">·</span> so that padding is visible.</p>
    <table class="tab">
      <tr><th class="kod">field</th><th>bytes</th><th class="kod">PIC</th>
          <th class="kod">original COBOL</th><th class="kod">rewrite${impl.jazyk ? ` (${impl.jazyk})` : ''}</th><th></th></tr>
      ${pole}
    </table>

    ${vykonSekce(V)}

    ${faze0Sekce(F)}

    <h3>What this does not prove</h3>
    <ul class="mez">
      <li><b>Which receivables go into the batch, and in what order.</b> The probe gets them
        already selected. Order decides the boleto numbers, so this is not a detail.</li>
      <li><b>The customer checks</b> (tax number, postcode, address) — the subprogram that does
        them is not in the delivery.</li>
      <li><b>That the production compiler computes the same thing.</b> The probe runs on
        GnuCOBOL, not on the Micro Focus runtime the system runs on today.</li>
      <li><b>That the record is what the bank accepts.</b> This proves sameness with the
        original, not correctness of the original.</li>
      ${vykonMeze(V)}
      ${faze0Meze(F)}
    </ul>`;
}

/* ---------------------------------------------------------------------------
   PROPUSTNOST — co stojí hranice mezi aplikací a jádrem.

   Patří to do Proof, ne do vlastní záložky: je to měření a musí stát na téže
   stránce jako jeho meze. Čísla jdou z `data/vykon.json`
   (`nastroje/vykon-export.py`), který spouští dvě skutečná měření — nativní
   Rust a srovnání TypeScript / WASM — a ukládá MEDIÁN ze tří běhů i rozsah.

   ⚠️ Smysl tabulky je jediný: mezi řádky se nemění ani logika, ani vstup —
   mění se **hranice** a **virtuální stroj**. Dokud hranice byla JSON, byl celý
   Rust přes WASM POMALEJŠÍ než původní TypeScript; to se na stránce neschovává
   (viz `vykonMeze`), protože přesně to dává tabulce smysl.
   ------------------------------------------------------------------------ */
function vykonSekce(V) {
  if (!V) return '';
  const m = V.mereno, s = V.sklad, h = V.hranice, c = V.cena, p = V.prohlizec, n = V.nativni;
  const kpi = (b, popis, pod, trida) =>
    `<div class="k ${trida || ''}"><b>${b}</b><span>${popis}</span>${pod ? `<i>${pod}</i>` : ''}</div>`;
  // Cena hranice umí při nepříznivém rozptylu vyjít i pod jedno procento (nebo
  // pod nulu). Vypsat ji pak jako změřený rozdíl by bylo tvrzení nad rozlišení
  // měření — proto se v takovém případě říká jen „pod jedno procento".
  const procent = (x) => (x >= 1 ? `${x.toFixed(0)}<small> %</small>` : `&lt; 1<small> %</small>`);
  const rada = (v, co, hranice, kde) => `<tr>
      <td><b>${co}</b></td><td>${hranice}</td><td>${kde}</td>
      <td class="cis">${čís(v.vetZaS)}</td><td class="cis">${v.mikro.toFixed(1)}</td>
    </tr>`;
  const rozsah = (jm, v) => `${jm} ${čís(v.min)}–${čís(v.max)}`;

  // Vlastní `section` se jmenovkou — stejně jako `prevodSekce`. Je to jediný
  // způsob, jak si na tuhle část udělat snímek výřezem (`nastroje/snimek.mjs`).
  return `
    <section id="propustnost">
    <h3>Throughput — the same logic across four paths</h3>
    <p class="lead">The same business logic, the same input, ${čís(s.vetVDavce)} records per
      batch. Between the rows below only two things change: <b>where the boundary between the
      application and the engine is</b>, and whether Rust runs natively or as WebAssembly in
      the browser. Nothing else — not the algorithm, not the data.</p>
    <div class="kpi">
      ${kpi(čís(p.wasmBin.vetZaS), 'records / s in the browser',
            `Rust → WASM across the binary boundary — median of ${m.behu} runs,
             ${rozsah('', p.wasmBin)} records/s`)}
      ${kpi(čís(n.B.vetZaS), 'records / s native, one thread',
            'the ceiling of this logic: same code, no boundary and no virtual machine')}
      ${kpi(procent(c.binarniProcentStropu), 'is what the binary boundary costs',
            `the JSON boundary it replaced cost ${c.jsonovaProcentStropu.toFixed(0)} % of the
             same ceiling`)}
      ${kpi(`${čís(s.vetaB)}<small> B</small>`, 'per input record',
            `original <b>REG-CRD020</b> records — the same bytes the COBOL probe above
             was given`)}
    </div>
    <table class="tab vykon">
      <tr><th>path</th><th>boundary, on every call</th><th>runs in</th>
          <th>records / s</th><th class="jednotka">µs / record</th></tr>
      ${rada(p.typescript, 'TypeScript', 'none — the engine is handed JavaScript objects',
             'browser')}
      ${rada(p.wasmJson, 'Rust → WASM',
             `JSON: ${čís(h.jsonDovnitrB)} B in, ${čís(h.jsonVenB)} B out`, 'browser')}
      ${rada(p.wasmBin, 'Rust → WASM',
             `binary: ${čís(h.zadaniB)} B in, one envelope of ${čís(h.binarniObalkaB)} B out`,
             'browser')}
      ${rada(n.B, 'Rust, native', 'none — the ceiling of this logic', 'server, one thread')}
    </table>
    <p class="pozn">Each figure is the <b>median of ${m.behu} runs</b>
      (${čís(m.opakovaniProhlizec)} batches per run in the browser,
      ${čís(m.opakovaniNativne)} natively), measured on ${m.jader} cores under ${m.os}
      at load ${m.zatizeniMin}–${m.zatizeniMax}${m.node ? `, Node ${m.node}` : ''},
      ${m.datum}. Spread between runs, records/s:
      ${[rozsah('TypeScript', p.typescript), rozsah('WASM + JSON', p.wasmJson),
         rozsah('WASM binary', p.wasmBin), rozsah('native', n.B)].join(' · ')}.</p>

    <p class="pozn"><b>The boundary, not the language.</b> The JSON boundary cost
      ${c.jsonovaProcentStropu.toFixed(0)} % of the ceiling, the binary one costs
      ${c.binarniProcentStropu >= 1 ? `${c.binarniProcentStropu.toFixed(0)} %`
                                    : 'less than 1 %'}. Per call it carried
      ${čís(h.jsonDovnitrB)} B in and ${čís(h.jsonVenB)} B out; it now carries
      ${čís(h.zadaniB)} B in and a single ${čís(h.binarniObalkaB)} B envelope out — and that
      envelope <i>is</i> the batch, read where it lies, not a copy of it.</p>
    <p class="pozn"><b>The input is the original records.</b> The application is fed
      ${čís(s.pohledavek)} × ${s.vetaB} B of REG-CRD020 (${čís(s.souborB)} B in one file),
      byte for byte the same input the COBOL probe above was given — not a JSON export of
      ours. Reading and parsing them is inside every figure in the table.</p>
    <p class="pozn"><b>What is left is the virtual machine.</b> On the identical path, with
      the identical boundary, WASM in the browser is <b>${c.wasmBinProtiNativniKrat.toFixed(1)}×
      slower</b> than the native binary (${čís(p.wasmBin.vetZaS)} against
      ${čís(n.C.vetZaS)} records/s). That difference is no longer the boundary, and no
      change of data format will close it.</p>

    <div class="volba">
      <b>One decision this measurement does not make for you.</b> In the browser what you get
      is that <b>it all runs on your machine</b> — the three input files are loaded once, the
      batch is built locally, nothing is sent anywhere, there is no server to operate. On a
      server what you get is <b>throughput</b>: native Rust does ${čís(n.B.vetZaS)} records/s
      in a single thread, and that figure is not reachable in a browser, because there Rust
      runs as WASM. The same code can be deployed either way — but the number follows the
      deployment, and you cannot have both at once.
    </div>
    </section>`;
}

/* Meze měření propustnosti. Jsou ve společném seznamu „What this does not
   prove", protože mez měření patří k měření, ne do petitu pod ním. */
function vykonMeze(V) {
  if (!V) return '';
  const m = V.mereno, s = V.sklad, c = V.cena;
  // „0,7× rychlejší" se čte jako zrychlení, přitom je to zpomalení — poměr se
  // proto pojmenuje slovem, ne znaménkem.
  const pomer = (x) => (x >= 1 ? `${x.toFixed(1)}× faster` : `${(1 / x).toFixed(1)}× slower`);
  return `
      <li><b>Any throughput other than on this machine, with this input.</b> One machine
        (${m.jader} cores, ${m.os}) and one synthetically built warehouse of
        ${čís(s.pohledavek)} receivables — not a production volume. On a machine doing
        something else at the same time the spread runs into tens of per cent.</li>
      <li><b>I/O, the network or rendering.</b> Only building the batch is timed. The input
        is read once beforehand and the output is thrown away, so none of the figures
        contains a disk, a request or a screen.</li>
      <li><b>Scaling across cores.</b> Every figure is single-threaded. More threads were
        not measured, so nothing here says anything about them.</li>
      <li><b>That a few passes are enough to measure a JavaScript path.</b> Each variant runs
        ${čís(m.opakovaniProhlizec)} batches or more, because V8 needs dozens of passes before
        it optimises the TypeScript one. Our own earlier measurement, run over ten passes,
        had Rust → WASM coming out faster than TypeScript; that was an artefact of the short
        run, and it is corrected here. With enough passes, WASM across the <i>JSON</i>
        boundary came out
        ${pomer(c.wasmJsonProtiTsKrat)} than TypeScript — it is the binary boundary that
        makes it faster (${pomer(c.wasmBinProtiTsKrat)}), not the language.</li>`;
}

/* ---------------------------------------------------------------------------
   FÁZE 0 — ucelený výřez agendy přesunutý z indexovaných souborů do PostgreSQL.

   Všechna čísla jdou z `data/faze0.json` (`nastroje/faze0-export.py`), který
   spouští čtyři skutečné běhy nad běžící databází a dočítá statické podklady.
   Na stránce není ručně napsané ani jedno číslo — s jedinou výjimkou, kterou
   JSON sám označuje jako `prevzato`: náklad proběhlé práce a odhad lidské
   strany. Ty se kreslí v šrafovaném rámci se štítkem ESTIMATE, stejně jako
   srovnání s člověkem na dashboardu.

   ⚠️ **Rámec je VZOR, ne obžaloba.** Co se tu popisuje — čítač v souboru,
   mrtvé kopie vedle živého kódu, přípony, na kterých padá překlad — je to, co
   u systémů téhle generace vídáme běžně. Tak to taky rozhodl zákazník
   (30. 10. 2026) a tak je to napsané: vzor doby, ke kterému patří konkrétní
   čísla, ne soupis cizích hříchů.

   ⚠️ **Čtyři varianty jedné dávky NEJSOU čtyřnásobný doklad** a stránka to
   nesmí tvrdit. Jsou tam proto, že jedna z nich chodí jinou větví výpočtu
   kontrolní číslice — to je důvod, který se musí říct, jinak si čtenář odnese
   čtyřnásobek vzorku.
   ------------------------------------------------------------------------ */
function faze0Sekce(F) {
  if (!F) return '';
  const m = F.mereno, s = F.schema, mi = F.migrace, p = F.prejimka, sb = F.soubeh;
  const c = F.cena, k = F.korpus, d = F.dosazitelnost, o = F.obrazovky;
  const r = F.rozsah, pv = F.prevzato;
  const kpi = (b, popis, pod, trida) =>
    `<div class="k ${trida || ''}"><b>${b}</b><span>${popis}</span>${pod ? `<i>${pod}</i>` : ''}</div>`;
  const ms = (x) => `${x.toFixed(1)}<small> ms</small>`;
  const cesta = (x, co) => `<tr>
      <td><b>${x.jmeno}</b></td><td>${co}</td>
      <td class="cis">${x.medianMs.toFixed(1)}</td>
      <td class="cis">${x.minMs.toFixed(1)}–${x.maxMs.toFixed(1)}</td>
    </tr>`;
  const carteiry = p.pripady.map((x) => x.carteira).join(' / ');

  return `
    <section id="faze0">
    <h3>Phase 0 — one agenda off the indexed files, into a database</h3>
    <p class="lead">One <b>complete agenda</b> — the receivables and the batch file that goes
      to the bank — was moved out of indexed files (ISAM) into PostgreSQL ${m.postgres},
      ${s.tabulek} tables. The question was never whether that can be done. The question was
      whether <b>the behaviour changes</b> — and that is what the evidence below answers.</p>
    <div class="kpi">
      ${kpi(čís(mi.vet), 'records reassembled byte for byte', `out of the database and back into
             the original ${mi.vetaB} B layout — not one of them differs`)}
      ${kpi(čís(p.vetCelkem), 'records compared with the original COBOL',
            `${čís(p.bajtuCelkem)} B, built <b>from the database</b> — ${čís(p.vetVPripadu)}
             records in ${p.pripadu} variants of one parameter`)}
      ${kpi(čís(sb.cisel), 'numbers issued by two concurrent batches',
            `${čís(sb.ruznych)} of them different — the second caller waited
             ${sb.cekalMs} ms on the row lock`)}
      ${kpi(ms(c.cesty.postgres.medianMs), 'per batch out of the database',
            `against ${c.cesty.memory.medianMs.toFixed(1)} ms from memory — median of
             ${c.behu} runs`)}
    </div>

    <h4>1 · The migration lost nothing — and here is why it did not work first time</h4>
    <p class="pozn">All ${čís(mi.vet)} records of the ${mi.vetaB} B layout are reassembled out
      of the database <b>byte for byte</b>, and so is the ${mi.parametryVetaB} B parameter
      record (${mi.parametryPoli} fields → ${mi.parametrySloupcu} columns). It did not hold at
      the first attempt, and that is the part worth taking away: the reading layer we already
      had was written <b>for the computation</b>, so it is <b>deliberately lossy</b> — it
      carries what the batch needs and drops the rest. Good enough to compute with, not good
      enough to migrate with. The table therefore has to carry <b>all ${mi.poliCopybooku}
      fields of the copybook</b>, useful or not — <b>${s.sloupcuPohledavka} columns</b> with
      the key. Anyone weighing a similar migration pays this once: an existing reader is not
      a migration.</p>

    <h4>2 · The behaviour did not change</h4>
    <p class="pozn">The batch is built <b>from the database</b> — selection, client checks,
      numbering, the ${čís(p.bajtuVPripadu / p.vetVPripadu)} B records — and the file it
      produces is byte-identical with the one the original COBOL produces from the same input.
      <b>${čís(p.vetCelkem)} records, ${čís(p.bajtuCelkem)} B</b> in total, and a flipped digit
      is located down to the field of the record, so the check can fail.</p>
    <p class="pozn"><b>Read the four variants for what they are.</b> It is
      ${čís(p.vetVPripadu)} records measured ${p.pripadu}× over, with one bank parameter
      changed (carteira ${carteiry}) — <b>not four times the evidence</b>. They are there
      because one of those values, 12, is the only one where the original overwrites the first
      digit of the boleto number; measuring only it, or only the others, would leave one branch
      of the check digit untested.</p>

    <h4>3 · The defect the move removes</h4>
    <p class="pozn"><b>The pattern.</b> In systems of this generation the sequential number
      that identifies a document at the bank is kept <b>in a file</b>: it is read into memory
      when the screen opens, incremented in memory, and written back only by a <b>separate
      action of the operator</b> — with the whole session running in between. Two people
      starting a batch at the same time is then the textbook lost update, and what the bank
      receives is <b>the same identifier twice</b>.</p>
    <p class="pozn"><b>Here it cannot happen, and that was tried.</b> Four guards hold the
      counter, and the test does not check that they exist — it <b>attempts to break each
      one</b>: ${mi.zamky.map((z) => z.jmeno).join(' · ')}. All ${mi.zamky.length} held.
      Two batches run at once came out as <b>${čís(sb.cisel)} numbers,
      ${čís(sb.ruznych)} of them different</b>, in two consecutive ranges.</p>

    <h4>4 · What real persistence costs</h4>
    <table class="tab vykon">
      <tr><th>path</th><th>what happens on the way</th><th>median, ms</th>
          <th class="jednotka">min–max, ms</th></tr>
      ${cesta(c.cesty.memory, 'nothing — the records are already in memory')}
      ${cesta(c.cesty.postgres, `read, compute, number, record, commit — one transaction`)}
      ${cesta(c.cesty.http, 'the same, requested over HTTP as a file')}
    </table>
    <p class="pozn">The same batch of ${čís(c.vetVDavce)} records
      (${čís(c.bajtuDavky)} B) over a warehouse of ${čís(c.pohledavekVeSkladu)} receivables,
      median of ${c.behu} runs on ${m.jader} cores under ${m.os} at load ${m.zatizeni1min},
      ${m.datum}. <b>The database costs ${c.rozdilProtiPametiMs.toFixed(1)} ms more per
      batch</b> (${c.krat.toFixed(1)}× the in-memory path).</p>
    <p class="pozn"><b>And why that does not matter here.</b> This is an agenda where the
      operator presses the button <b>once a day</b>; tens of milliseconds have no meaning at
      that rate. What is bought for them is a transaction (either the whole batch is recorded
      or none of it), integrity enforced by the database rather than by every program that
      touches the data, and a number that <b>cannot</b> be issued twice. The figure would
      matter if the same logic ran per request; then the in-memory path is still there — it is
      the same code.</p>

    <h4>5 · What phase 0 found out about the rest of the system</h4>
    <p class="pozn"><b>One copybook stands between the corpus and a compiler.</b> Of
      ${čís(k.programu)} programs ${čís(k.prelozeno)} compile today; of the
      ${čís(k.neproslo)} that do not, <b>${čís(k.blokujeProgramu)} fail on a single cause</b> —
      one copybook of GUI-framework macros, copied by ${čís(k.copy.programuKopirujicichMakra)}
      programs, written in a dialect extension the current compiler does not know. Expanding
      those macros is a bounded piece of work, and it is what unlocks the rest.</p>
    <p class="pozn"><b>And the "missing" copybooks are not missing.</b> Of all
      ${čís(k.copy.jmen)} <code>COPY</code> names used in the tree,
      <b>${k.copy.chybiVeStromu} are absent</b>. They resolve across
      ${k.copy.priponCelkem} different suffixes — ${čís(k.copy.vyskytuMimoObvyklePripony)} of
      the ${čís(k.copy.vyskytu)} occurrences under something other than the two a compiler
      tries by itself. In a system built when the file system cared about neither case nor
      suffix, that is the normal state, and it is why "file not found" has to be read twice
      before it goes into an estimate as the cost of a migration.</p>
    <p class="pozn"><b>${d.nedosazitelneProcent} % of the code is provably unreachable</b>
      (${čís(d.nedosazitelneRadku)} of ${čís(d.radku)} lines in
      ${čís(d.nedosazitelneSouboru)} files), ${d.nerozhodnutoProcent} % is undecided. These
      are dead copies kept next to the live file — the pattern of the years before version
      control, when a copy <i>was</i> the backup. It matters because dead code is the single
      largest unknown in any estimate for a system this size.</p>
    <p class="pozn"><b>${čís(o.obrazovek)} screens, ${čís(o.poli)} fields</b>, median
      ${o.poliMedian} fields per screen, ${čís(o.poliMaximum)} at the largest. That is the
      interface that gets rewritten, and it is countable rather than guessable — the labels,
      buttons and drop-downs come out of the screen definitions mechanically.</p>

    <h4>6 · What phase 0 cost</h4>
    <p class="pozn">What was built: ${čís(r.radku)} lines across ${r.casti.length} components
      (${čís(r.kodu)} of them code, comments and blank lines excluded), ${r.tabulek} tables,
      ${r.testu} tests. ${r.casti.map((x) => `<b>${čís(x.radku)}</b> ln. — ${x.jmeno}${
        x.jenPridaneRadky ? ' (lines added to an existing repository)' : ''}`).join(' · ')}.</p>
    <div class="srovnani">
      <div class="stitek">Machine time measured · human side an <b>estimate</b></div>
      <p class="uvod">Two numbers of different kinds, side by side, because the comparison is
        the reader's to make and not ours to assert.</p>
      <div class="odh-kpi">
        <div class="k vysledek"><b>${pv.strojovyCasH.toFixed(1)}<small> h</small></b>
          <span>of machine time, measured</span>
          <i>${pv.strojovyCasRozpad.map((x) => `${x.h.toFixed(2)} h ${x.co}${
            x.zmereno ? '' : ' <b>(not measured — estimated)</b>'}`).join(' · ')}</i></div>
        <div class="k"><b>≈ ${pv.lidskyOdhadMdOd}–${pv.lidskyOdhadMdDo}<small> person-days</small></b>
          <span>for the same slice by hand</span>
          <i>bottom-up estimate over analysis, schema, migration, service, interface and
            tooling, plus review, coordination and onboarding — an estimate, not a
            measurement, and nobody has run the other side</i></div>
      </div>
      <p class="pozn">Deliberately without a ratio. One side is measured and has one
        unmeasured item in it; the other is an estimate with a range of 1.6× — a single
        multiple out of that pair would look far more precise than either number is, and it
        would be a ceiling taken from one bounded, machine-checkable task rather than
        a property of the method.</p>
    </div>
    </section>`;
}

/* Meze fáze 0. Patří do společného seznamu „What this does not prove" —
   mez měření stojí u měření, ne v petitu pod ním. */
function faze0Meze(F) {
  if (!F) return '';
  const c = F.cena, p = F.prejimka;
  return `
      <li><b>Anything about production volume.</b> Phase 0 ran on
        ${čís(c.pohledavekVeSkladu)} receivables. The batch reads the whole table, because the
        original computes one of its fields by walking all records — on a production volume
        that is an order of magnitude more work, and it was not measured.</li>
      <li><b>More than one bank.</b> ${p.pripadu} variants of one parameter, one bank, one file
        layout. The others have a different layout and a different algorithm and are not
        converted.</li>
      <li><b>Security.</b> The HTTP API has <b>no authentication</b> — the user is whatever the
        client claims. No rate limit, no CORS policy, no HTTPS. It is a measurement harness,
        not a deployment.</li>
      <li><b>Operational resilience.</b> A process dying in the middle of a transaction was
        never tried, and the connection pool has neither a ceiling nor a health check.</li>
      <li><b>That the defects of the original were fixed.</b> They are <b>reproduced on
        purpose</b>: byte-for-byte sameness is the acceptance criterion, so the original's own
        quirks come across with everything else. Each of them changes a boleto number or an
        amount, which makes fixing them a business decision, not ours.</li>`;
}
