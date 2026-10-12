(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LOCALE = 'sk';

  /* ---------- Pravidlá premenovania ---------- */
  const SPECIAL = {'ł':'l','Ł':'L','đ':'d','Đ':'D','ø':'o','Ø':'O','ß':'ss','æ':'ae','Æ':'AE','œ':'oe','Œ':'OE','ı':'i','ð':'d','Ð':'D','þ':'th','Þ':'Th','ħ':'h','Ħ':'H'};
  const SPECIAL_RE = new RegExp('[' + Object.keys(SPECIAL).join('') + ']', 'g');
  const stripDia = (s) => s.replace(SPECIAL_RE, (c) => SPECIAL[c]).normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
  // Formát výkresu na konci názvu: -297x420, -420x594, -594x1260, -891x2100 …
  // voliteľne aj s počtom listov A4: -420x1050_10xA4
  const FORMAT_RE = /\s*-\s*(?:297|420|594|891)\s*[x×]\s*\d+(?:\s*[_ -]?\s*\d+\s*[x×]\s*A\d)?\s*$/i;
  // Znaky, ktoré Windows v názve súboru nepovolí
  const BAD_RE = /[<>:"/\\|?*\u0000-\u001F]/g;
  const COUNTER_RE = /\[C\]/gi;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function splitExt(name) {
    const i = name.lastIndexOf('.');
    if (i <= 0 || i === name.length - 1) return [name, ''];
    const ext = name.slice(i);
    return /\s/.test(ext) || ext.length > 12 ? [name, ''] : [name.slice(0, i), ext];
  }

  function applyCase(s, mode) {
    const up = (c) => c.toLocaleUpperCase(LOCALE);
    switch (mode) {
      case 'lower': return s.toLocaleLowerCase(LOCALE);
      case 'upper': return s.toLocaleUpperCase(LOCALE);
      case 'sentence': return s.toLocaleLowerCase(LOCALE).replace(/\p{L}/u, up);
      case 'title': return s.toLocaleLowerCase(LOCALE).replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (m, a, c) => a + up(c));
      default: return s;
    }
  }

  function counterText(i, o) {
    const v = o.numStart + i * o.numStep;
    const digits = String(Math.abs(v)).padStart(o.numPad, '0');
    return v < 0 ? '-' + digits : digits;
  }

  // Hľadaný text sa porovnáva s názvom po odstránení diakritiky, preto ju odstránime aj z neho.
  function compileRules(rules, dia) {
    return rules.map((r) => {
      if (!r.find) return null;
      const text = dia ? stripDia(r.find) : r.find;
      const src = r.rx ? text : escapeRe(text);
      const flags = r.cs ? 'g' : 'gi';
      try { return { re: new RegExp(src, flags + 'u'), rule: r }; }
      catch { try { return { re: new RegExp(src, flags), rule: r }; } catch (e) { return { error: e.message }; } }
    });
  }

  function renameOne(name, i, o, compiled) {
    let [base, ext] = splitExt(name);
    if (o.fmt) base = base.replace(FORMAT_RE, '');
    if (o.dia) { base = stripDia(base); ext = stripDia(ext); }
    base = applyCase(base, o.caseMode);
    if (o.extLower) ext = ext.toLocaleLowerCase(LOCALE);
    const num = counterText(i, o);
    for (const c of compiled) {
      if (!c || !c.re) continue;
      const repl = c.rule.repl.replace(COUNTER_RE, num);
      base = c.rule.rx ? base.replace(c.re, repl) : base.replace(c.re, () => repl);
    }
    if (o.spaces) base = base.replace(/\s{2,}/g, ' ').trim();
    base = (o.prefix.replace(COUNTER_RE, num) + base + o.suffix.replace(COUNTER_RE, num)).replace(BAD_RE, '_');
    ext = ext.replace(BAD_RE, '_');
    const out = (base + ext).replace(/[. ]+$/, '');
    if (!base.trim() || !out) return { name, err: true };
    return { name: out };
  }

  // Nové názvy pre celý zoznam; rovnaké názvy (bez ohľadu na veľkosť písmen) dostanú _2, _3 …
  // Súbory, ktorých názov sa nemení, si ho ponechajú a prípadné _2 dostane premenovaný súbor.
  function planNames(names, o) {
    const compiled = compileRules(o.rules, o.dia);
    const rows = names.map((n, i) => renameOne(n, i, o, compiled));
    const taken = new Set();
    const kept = new Set();
    rows.forEach((r, i) => {
      const key = r.name.toLocaleLowerCase(LOCALE);
      if (r.name === names[i] && !taken.has(key)) { taken.add(key); kept.add(r); }
    });
    for (const r of rows) {
      if (kept.has(r)) continue;
      let key = r.name.toLocaleLowerCase(LOCALE);
      if (taken.has(key)) {
        const [b, e] = splitExt(r.name);
        let k = 2;
        while (taken.has(`${b}_${k}${e}`.toLocaleLowerCase(LOCALE))) k++;
        r.name = `${b}_${k}${e}`;
        r.dup = `_${k}`;
        key = r.name.toLocaleLowerCase(LOCALE);
      }
      taken.add(key);
    }
    return { rows, ruleErrors: compiled.map((c) => (c && c.error) || '') };
  }

  // Porovnanie po znakoch: '=' rovnaké, '~' iná diakritika alebo veľkosť, '-' odstránené, '+' pridané
  const keyOf = (ch) => stripDia(ch).toLocaleLowerCase(LOCALE);
  function diff(a, b) {
    const A = Array.from(a), B = Array.from(b);
    const ka = A.map(keyOf), kb = B.map(keyOf);
    const n = A.length, m = B.length, W = m + 1;
    const L = new Uint16Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * W + j] = ka[i] === kb[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    const before = [], after = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ka[i] === kb[j]) {
        const t = A[i] === B[j] ? '=' : '~';
        before.push([t, A[i++]]); after.push([t, B[j++]]);
      } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) before.push(['-', A[i++]]);
      else after.push(['+', B[j++]]);
    }
    while (i < n) before.push(['-', A[i++]]);
    while (j < m) after.push(['+', B[j++]]);
    return [before, after];
  }

  function plural(n, one, few, many) {
    return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  }

  /* ---------- Nastavenia ---------- */
  const DEFAULTS = {
    dia: true, fmt: true, spaces: false, caseMode: 'keep', extLower: false,
    rules: [{ find: '', repl: '', cs: false, rx: false }],
    prefix: '', suffix: '', numStart: 1, numStep: 1, numPad: 2, sort: 'added',
  };
  const CASES = ['keep', 'lower', 'sentence', 'title', 'upper'];
  const SORTS = ['added', 'name', 'name-desc', 'date'];
  const STORE_KEY = 'pes.nastavenia.v1';
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

  function cleanOpts(raw) {
    const o = clone(DEFAULTS);
    if (!raw || typeof raw !== 'object') return o;
    for (const k of ['dia', 'fmt', 'spaces', 'extLower']) if (typeof raw[k] === 'boolean') o[k] = raw[k];
    for (const k of ['prefix', 'suffix']) if (typeof raw[k] === 'string') o[k] = raw[k];
    if (CASES.includes(raw.caseMode)) o.caseMode = raw.caseMode;
    if (SORTS.includes(raw.sort)) o.sort = raw.sort;
    o.numStart = int(raw.numStart, 1);
    o.numStep = int(raw.numStep, 1);
    o.numPad = Math.min(8, Math.max(1, int(raw.numPad, 2)));
    if (Array.isArray(raw.rules) && raw.rules.length) {
      o.rules = raw.rules.map((r) => ({ find: String(r.find ?? ''), repl: String(r.repl ?? ''), cs: !!r.cs, rx: !!r.rx }));
    }
    return o;
  }
  function loadOpts() {
    try { return cleanOpts(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); }
    catch { return clone(DEFAULTS); }
  }
  function saveOpts() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(opts)); } catch { /* bez úložiska */ }
  }

  let opts = loadOpts();
  let items = [];
  let seq = 0;
  let onlyChanged = false;
  let ruleEls = [];
  let busy = false;

  const SAMPLES = [
    'D.1.1-01 Situácia stavby-594x1260.pdf',
    'D.1.2-03 Pozdĺžny profil, vetva A-297x1470.pdf',
    'SO 201 Výkres tvaru mosta-420x594.pdf',
    'Vzorové priečne rezy-891x1050.pdf',
    'Technická správa.docx',
  ].map((name, i) => ({ id: 's' + i, name, sample: true }));

  const CASE_CAPTION = {
    keep: 'Veľkosť písmen ostane ako v pôvodnom názve.',
    lower: 'Všetko malými písmenami: výkres mosta',
    sentence: 'Prvé písmeno veľké, ostatné malé: Výkres mosta',
    title: 'Každé slovo s veľkým písmenom: Výkres Mosta',
    upper: 'Všetko veľkými písmenami: VÝKRES MOSTA',
  };

  const ui = {
    drop: $('drop'), picker: $('picker'), dropTitle: $('dropTitle'), dropHint: $('dropHint'), dropNote: $('dropNote'),
    dia: $('optDia'), fmt: $('optFmt'), spaces: $('optSpaces'), extLower: $('optExt'),
    caseCaption: $('caseCaption'), rules: $('rules'), ruleTpl: $('ruleTpl'),
    prefix: $('prefix'), suffix: $('suffix'), numStart: $('numStart'), numStep: $('numStep'), numPad: $('numPad'), numPreview: $('numPreview'),
    sort: $('sort'), onlyChanged: $('onlyChanged'), clear: $('clear'), count: $('count'), list: $('list'),
    actions: $('actions'), zipBtn: $('zipBtn'), copyList: $('copyList'), status: $('status'),
  };

  function syncControls() {
    ui.dia.checked = opts.dia;
    ui.fmt.checked = opts.fmt;
    ui.spaces.checked = opts.spaces;
    ui.extLower.checked = opts.extLower;
    document.querySelector(`input[name="case"][value="${opts.caseMode}"]`).checked = true;
    ui.prefix.value = opts.prefix;
    ui.suffix.value = opts.suffix;
    ui.numStart.value = opts.numStart;
    ui.numStep.value = opts.numStep;
    ui.numPad.value = opts.numPad;
    ui.sort.value = opts.sort;
    buildRules();
  }

  function buildRules(focusLast) {
    ui.rules.textContent = '';
    ruleEls = opts.rules.map((r, idx) => {
      const el = ui.ruleTpl.content.firstElementChild.cloneNode(true);
      const find = el.querySelector('.r-find'), repl = el.querySelector('.r-repl');
      const cs = el.querySelector('.r-cs'), rx = el.querySelector('.r-rx'), del = el.querySelector('.r-del'), err = el.querySelector('.r-err');
      find.id = `rule${idx}Find`; repl.id = `rule${idx}Repl`; err.id = `rule${idx}Err`;
      find.setAttribute('aria-describedby', err.id);
      find.value = r.find; repl.value = r.repl;
      cs.setAttribute('aria-pressed', String(r.cs));
      rx.setAttribute('aria-pressed', String(r.rx));
      find.addEventListener('input', () => { r.find = find.value; changed(); });
      repl.addEventListener('input', () => { r.repl = repl.value; changed(); });
      cs.addEventListener('click', () => { r.cs = !r.cs; cs.setAttribute('aria-pressed', String(r.cs)); changed(); });
      rx.addEventListener('click', () => { r.rx = !r.rx; rx.setAttribute('aria-pressed', String(r.rx)); changed(); });
      del.addEventListener('click', () => {
        opts.rules.splice(idx, 1);
        if (!opts.rules.length) opts.rules.push(clone(DEFAULTS.rules[0]));
        buildRules();
        (ruleEls[Math.min(idx, ruleEls.length - 1)] || {}).find?.focus();
        changed();
      });
      ui.rules.append(el);
      return { find, err };
    });
    if (focusLast) ruleEls[ruleEls.length - 1].find.focus();
  }

  /* ---------- Vykreslenie ---------- */
  const collator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: 'base' });
  function ordered(arr) {
    const a = arr.slice();
    if (opts.sort === 'name') a.sort((x, y) => collator.compare(x.name, y.name));
    else if (opts.sort === 'name-desc') a.sort((x, y) => collator.compare(y.name, x.name));
    else if (opts.sort === 'date') a.sort((x, y) => (x.file ? x.file.lastModified : 0) - (y.file ? y.file.lastModified : 0));
    return a;
  }
  function currentPlan() {
    const list = ordered(items.length ? items : SAMPLES);
    return { list, plan: planNames(list.map((x) => x.name), opts) };
  }

  function paint(el, ops) {
    let type = null, buf = '';
    const flush = () => {
      if (!buf) return;
      if (type === '=') el.append(buf);
      else {
        const t = document.createElement(type === '-' ? 'del' : type === '+' ? 'ins' : 'mark');
        t.textContent = buf;
        el.append(t);
      }
      buf = '';
    };
    for (const [t, ch] of ops) { if (t !== type) { flush(); type = t; } buf += ch; }
    flush();
  }
  function srOnly(text) {
    const s = document.createElement('span');
    s.className = 'sr-only';
    s.textContent = text;
    return s;
  }

  function rowEl(it, i, res, isChanged) {
    const li = document.createElement('li');
    li.className = 'row ' + (isChanged ? 'is-changed' : 'is-same');
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(i + 1);
    const names = document.createElement('div');
    names.className = 'names';
    if (isChanged) {
      const [before, after] = diff(it.name.normalize('NFC'), res.name);
      const oldEl = document.createElement('div'); oldEl.className = 'old';
      oldEl.append(srOnly('Pôvodný názov: ')); paint(oldEl, before);
      const newEl = document.createElement('div'); newEl.className = 'new';
      newEl.append(srOnly('Nový názov: ')); paint(newEl, after);
      names.append(oldEl, newEl);
    } else {
      const same = document.createElement('div'); same.className = 'new';
      same.append(srOnly('Bez zmeny: '), it.name);
      names.append(same);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    let chip = null;
    if (res.err) chip = ['chip-err', 'prázdny názov', 'Po úpravách by z názvu nič neostalo, preto ostáva pôvodný.'];
    else if (res.dup) chip = ['chip-warn', 'duplicita ' + res.dup, 'Rovnaký nový názov má aj iný súbor, preto sa pridalo ' + res.dup + '.'];
    else if (!isChanged) chip = ['chip-mute', 'bez zmeny', ''];
    if (chip) {
      const c = document.createElement('span');
      c.className = 'chip ' + chip[0];
      c.textContent = chip[1];
      if (chip[2]) c.title = chip[2];
      meta.append(c);
    }
    if (!it.sample) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'iconbtn rm';
      rm.setAttribute('aria-label', 'Odstrániť zo zoznamu: ' + it.name);
      rm.title = 'Odstrániť zo zoznamu';
      rm.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      rm.addEventListener('click', () => removeItem(it.id));
      meta.append(rm);
    }
    li.append(idx, names, meta);
    return li;
  }

  function render() {
    const sample = items.length === 0;
    const { list, plan } = currentPlan();

    ruleEls.forEach((r, i) => {
      const e = plan.ruleErrors[i];
      r.err.hidden = !e;
      r.err.textContent = e ? 'Neplatný regulárny výraz: ' + e : '';
      r.find.setAttribute('aria-invalid', e ? 'true' : 'false');
    });

    let changedN = 0, dupN = 0, errN = 0;
    const frag = document.createDocumentFragment();
    list.forEach((it, i) => {
      const res = plan.rows[i];
      const isChanged = res.name !== it.name;
      if (isChanged) changedN++;
      if (res.dup) dupN++;
      if (res.err) errN++;
      if (onlyChanged && !isChanged && !res.err) return;
      frag.append(rowEl(it, i, res, isChanged));
    });
    if (!frag.childNodes.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Žiadny názov sa nemení. Upravte nastavenia vľavo.';
      frag.append(li);
    }
    ui.list.textContent = '';
    ui.list.append(frag);

    if (sample) {
      ui.count.innerHTML = '<span class="badge">Ukážka</span>Vzorové názvy. Pridajte vlastné súbory.';
    } else {
      const n = list.length;
      let html = `<b>${n}</b> ${plural(n, 'súbor', 'súbory', 'súborov')} · <b>${changedN}</b> s novým názvom`;
      if (dupN) html += ` · <b>${dupN}</b> ${plural(dupN, 'duplicita', 'duplicity', 'duplicít')}`;
      if (errN) html += ` · <b>${errN}</b> ${plural(errN, 'chyba', 'chyby', 'chýb')}`;
      ui.count.innerHTML = html;
    }

    ui.drop.classList.toggle('compact', !sample);
    ui.dropTitle.textContent = sample ? 'Pretiahnite súbory sem' : 'Pridať ďalšie súbory';
    ui.dropHint.textContent = sample ? 'alebo kliknite a vyberte ich z počítača' : 'kliknite alebo ich pretiahnite kamkoľvek na stránku';
    ui.actions.hidden = sample;
    ui.clear.hidden = sample;
    ui.zipBtn.querySelector('span').textContent = items.length === 1 ? 'Stiahnuť súbor' : 'Stiahnuť ZIP';

    ui.caseCaption.textContent = CASE_CAPTION[opts.caseMode];
    ui.numPreview.textContent = [0, 1, 2].map((k) => counterText(k, opts)).join(', ') + ' …';
  }

  let raf = 0, saveTimer = 0;
  function changed() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveOpts, 300);
  }

  /* ---------- Súbory ---------- */
  const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;
  function addFiles(files, dirs = 0) {
    const seen = new Set(items.map((x) => fileKey(x.file)));
    let skipped = 0;
    for (const f of files) {
      const k = fileKey(f);
      if (seen.has(k)) { skipped++; continue; }
      seen.add(k);
      items.push({ id: ++seq, file: f, name: f.name });
    }
    const notes = [];
    if (skipped) notes.push(`${skipped} ${plural(skipped, 'súbor už bol', 'súbory už boli', 'súborov už bolo')} v zozname.`);
    if (dirs) notes.push('Priečinky sa nepridávajú – otvorte priečinok a pretiahnite samotné súbory.');
    ui.dropNote.textContent = notes.join(' ');
    ui.status.textContent = '';
    render();
  }
  function removeItem(id) {
    const pos = Array.from(ui.list.children).findIndex((li) => li.contains(document.activeElement));
    items = items.filter((x) => x.id !== id);
    render();
    const next = ui.list.children[Math.min(pos, ui.list.children.length - 1)];
    const btn = next && next.querySelector('.rm');
    if (btn) btn.focus(); else ui.drop.focus();
  }
  function addFromTransfer(dt) {
    const files = [];
    let dirs = 0;
    if (dt.items && dt.items.length) {
      for (const it of dt.items) {
        if (it.kind !== 'file') continue;
        const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
        if (entry && entry.isDirectory) { dirs++; continue; }
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    } else files.push(...dt.files);
    addFiles(files, dirs);
  }

  /* ---------- Udalosti ---------- */
  ui.picker.addEventListener('change', () => { addFiles(ui.picker.files); ui.picker.value = ''; });
  ui.drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.picker.click(); }
  });

  let dragDepth = 0;
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    addFromTransfer(e.dataTransfer);
  });

  const bindSwitch = (el, key) => el.addEventListener('change', () => { opts[key] = el.checked; changed(); });
  bindSwitch(ui.dia, 'dia');
  bindSwitch(ui.fmt, 'fmt');
  bindSwitch(ui.spaces, 'spaces');
  bindSwitch(ui.extLower, 'extLower');
  document.querySelectorAll('input[name="case"]').forEach((r) => r.addEventListener('change', () => { opts.caseMode = r.value; changed(); }));
  ui.prefix.addEventListener('input', () => { opts.prefix = ui.prefix.value; changed(); });
  ui.suffix.addEventListener('input', () => { opts.suffix = ui.suffix.value; changed(); });
  ui.numStart.addEventListener('input', () => { opts.numStart = int(ui.numStart.value, 1); changed(); });
  ui.numStep.addEventListener('input', () => { opts.numStep = int(ui.numStep.value, 1); changed(); });
  ui.numPad.addEventListener('input', () => { opts.numPad = Math.min(8, Math.max(1, int(ui.numPad.value, 2))); changed(); });
  ui.sort.addEventListener('change', () => { opts.sort = ui.sort.value; changed(); });
  ui.onlyChanged.addEventListener('change', () => { onlyChanged = ui.onlyChanged.checked; render(); });

  $('addRule').addEventListener('click', () => {
    opts.rules.push(clone(DEFAULTS.rules[0]));
    buildRules(true);
    changed();
  });
  $('numFront').addEventListener('click', () => {
    if (!/\[C\]/i.test(opts.prefix)) { opts.prefix = '[C]_' + opts.prefix; ui.prefix.value = opts.prefix; changed(); }
    ui.prefix.focus();
  });
  $('numBack').addEventListener('click', () => {
    if (!/\[C\]/i.test(opts.suffix)) { opts.suffix += '_[C]'; ui.suffix.value = opts.suffix; changed(); }
    ui.suffix.focus();
  });
  $('reset').addEventListener('click', () => {
    opts = clone(DEFAULTS);
    syncControls();
    changed();
  });
  ui.clear.addEventListener('click', () => {
    items = [];
    ui.dropNote.textContent = '';
    ui.status.textContent = '';
    render();
    ui.drop.focus();
  });

  async function copyText(text, btn) {
    const label = btn.querySelector('span');
    label.dataset.label = label.dataset.label || label.textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.append(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch { ok = false; }
    }
    label.textContent = ok ? 'Skopírované' : 'Kopírovanie zlyhalo';
    clearTimeout(btn._timer);
    btn._timer = setTimeout(() => { label.textContent = label.dataset.label; }, 2000);
  }
  ui.copyList.addEventListener('click', () => {
    const { list, plan } = currentPlan();
    const lines = list.map((it, i) => `${it.name}\t${plan.rows[i].name}`);
    copyText(['Pôvodný názov\tNový názov', ...lines].join('\r\n'), ui.copyList);
  });

  /* ---------- Sťahovanie ---------- */
  // V artefakte na claude.ai ide sťahovanie cez schopnosť „downloads“, inde cez bežný odkaz.
  let downloads = null;
  const inClaude = !!(window.claude && typeof window.claude.use === 'function');
  function setDownloadAvailable(ok) {
    ui.zipBtn.hidden = !ok;
    ui.zipBtn.disabled = !ok;
    if (!ok) ui.status.textContent = 'Sťahovanie tu nie je dostupné. Nové názvy si môžete skopírovať tlačidlom Kopírovať zoznam.';
  }
  if (inClaude) {
    ui.zipBtn.disabled = true;
    window.claude.use('downloads')
      .then((d) => { downloads = d || null; setDownloadAvailable(!!d); })
      .catch(() => setDownloadAvailable(false));
  }

  async function saveBlob(blob, filename) {
    if (downloads) { await downloads.save({ filename, data: blob }); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function zipName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `PES_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
  }

  ui.zipBtn.addEventListener('click', async () => {
    if (!items.length || busy) return;
    const { list, plan } = currentPlan();
    busy = true;
    ui.zipBtn.disabled = true;
    try {
      let filename;
      if (list.length === 1) {
        filename = plan.rows[0].name;
        if (downloads) ui.status.textContent = 'Potvrďte uloženie súboru.';
        await saveBlob(list[0].file, filename);
      } else {
        if (typeof JSZip === 'undefined') throw Object.assign(new Error('JSZip'), { code: 'nozip' });
        const zip = new JSZip();
        list.forEach((it, i) => zip.file(plan.rows[i].name, it.file, { date: new Date(it.file.lastModified || Date.now()) }));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => {
          ui.status.textContent = `Balím súbory… ${Math.floor(m.percent)} %`;
        });
        filename = zipName();
        if (downloads) ui.status.textContent = 'Potvrďte uloženie súboru.';
        await saveBlob(blob, filename);
      }
      ui.status.textContent = downloads ? `Uložené: ${filename}` : `Sťahovanie sa začalo: ${filename}`;
    } catch (err) {
      const c = err && err.code;
      ui.status.textContent =
        c === 'declined' ? 'Uloženie ste zrušili.'
        : c === 'rate_limited' ? 'Už je otvorené jedno potvrdenie. Skúste to o chvíľu znova.'
        : c === 'too_large' ? 'Súbor je príliš veľký. Rozdeľte súbory do menších dávok.'
        : c === 'nozip' ? 'Nepodarilo sa načítať knižnicu na ZIP. Skontrolujte pripojenie k internetu a obnovte stránku.'
        : 'Sťahovanie zlyhalo. Skúste to znova.';
    } finally {
      busy = false;
      ui.zipBtn.disabled = false;
    }
  });

  syncControls();
  render();
})();
