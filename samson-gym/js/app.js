document.documentElement.classList.add("js");

const Samson = (() => {
  const KEYS = {
    users: "samson_users_v2",
    session: "samson_session_v2",
    occ: "samson_occupancy_v2",
  };
  const CAPACITY = 60;
  const START_GUESTS = 20;
  const RING = 2 * Math.PI * 54;
  const DAY = 864e5;

  const PLANS = {
    napi: { name: "Napijegy", price: 2990, days: 1, duration: "1 nap" },
    havi: { name: "Havi bérlet", price: 12900, days: 30, duration: "30 nap" },
    negyedeves: { name: "Negyedéves bérlet", price: 32900, days: 90, duration: "90 nap" },
    eves: { name: "Éves bérlet", price: 99900, days: 365, duration: "365 nap" },
  };

  const PEAK = [22, 48, 58, 42, 30, 28, 38, 46, 36, 34, 52, 78, 95, 88, 66, 44, 24];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const huf = (n) => `${new Intl.NumberFormat("hu-HU").format(n)} Ft`;
  const timeFmt = (d) =>
    new Date(d).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
  const dateFmt = (d) =>
    new Date(d).toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" });
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /* ---------- Users & session ---------- */
  const users = () => read(KEYS.users, []);
  const session = () => read(KEYS.session, null);

  function currentUser() {
    const s = session();
    if (!s) return null;
    return users().find((u) => u.email === s.email) || null;
  }

  function updateUser(email, patch) {
    const list = users();
    const i = list.findIndex((u) => u.email === email);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    write(KEYS.users, list);
    return list[i];
  }

  const hasActivePlan = (u) => Boolean(u && u.validUntil && new Date(u.validUntil) > new Date());
  const firstName = (name) => String(name).trim().split(/\s+/).pop();

  async function hash(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`samson:${text}`));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return btoa(unescape(encodeURIComponent(`samson:${text}`)));
  }

  async function register({ name, email, password }) {
    const mail = email.trim().toLowerCase();
    const list = users();
    if (list.some((u) => u.email === mail)) {
      return { ok: false, message: "Ezzel az e-mail címmel már van fiók. Jelentkezz be." };
    }
    list.push({
      name: name.trim(),
      email: mail,
      passHash: await hash(password),
      memberId: `SG-${Math.floor(100000 + Math.random() * 900000)}`,
      plan: null,
      validUntil: null,
      createdAt: new Date().toISOString(),
    });
    write(KEYS.users, list);
    write(KEYS.session, { email: mail });
    return { ok: true };
  }

  async function login(email, password) {
    const mail = email.trim().toLowerCase();
    const passHash = await hash(password);
    const user = users().find((u) => u.email === mail && u.passHash === passHash);
    if (!user) return { ok: false, message: "Hibás e-mail cím vagy jelszó." };
    write(KEYS.session, { email: mail });
    return { ok: true };
  }

  function logout() {
    const u = currentUser();
    if (u) {
      const o = occ();
      if (o.members.some((m) => m.email === u.email)) {
        o.members = o.members.filter((m) => m.email !== u.email);
        pushLog(o, -1, "Egy tag kicsekkolt");
        write(KEYS.occ, o);
      }
    }
    localStorage.removeItem(KEYS.session);
    location.href = "index.html";
  }

  function validUntilFor(u, days) {
    const base = hasActivePlan(u) ? new Date(u.validUntil) : new Date();
    return new Date(base.getTime() + days * DAY);
  }

  function purchase(planId) {
    const u = currentUser();
    const plan = PLANS[planId];
    if (!u || !plan) return null;
    return updateUser(u.email, {
      plan: planId,
      purchasedAt: new Date().toISOString(),
      validUntil: validUntilFor(u, plan.days).toISOString(),
      orders: [...(u.orders || []), { plan: planId, price: plan.price, at: Date.now() }],
    });
  }

  /* ---------- Occupancy ---------- */
  function occ() {
    let o = read(KEYS.occ, null);
    if (!o || !Array.isArray(o.members)) {
      const now = Date.now();
      o = {
        guests: START_GUESTS,
        members: [],
        log: [
          { delta: 1, text: "Valaki belépett a terembe", at: now - 2 * 60e3 },
          { delta: -1, text: "Valaki távozott a teremből", at: now - 6 * 60e3 },
          { delta: 1, text: "Valaki belépett a terembe", at: now - 11 * 60e3 },
        ],
      };
      write(KEYS.occ, o);
    }
    return o;
  }

  const countOf = (o) => Math.min(CAPACITY, o.guests + o.members.length);

  function pushLog(o, delta, text) {
    o.log = [{ delta, text, at: Date.now() }, ...(o.log || [])].slice(0, 6);
  }

  function statusOf(ratio) {
    if (ratio >= 1) return { label: "Megtelt", state: "full" };
    if (ratio >= 0.8) return { label: "Zsúfolt", state: "full" };
    if (ratio >= 0.5) return { label: "Közepes forgalom", state: "busy" };
    return { label: "Van bőven hely", state: "ok" };
  }

  let lastCount = null;
  let lastLogAt = null;

  function renderOccupancy() {
    const o = occ();
    const n = countOf(o);
    const ratio = n / CAPACITY;
    const status = statusOf(ratio);

    $$("[data-occ-count]").forEach((el) => {
      el.textContent = String(n);
    });
    $$("[data-occ-cap]").forEach((el) => {
      el.textContent = String(CAPACITY);
    });
    $$("[data-occ-free]").forEach((el) => {
      el.textContent = String(CAPACITY - n);
    });
    $$("[data-occ-percent]").forEach((el) => {
      el.textContent = `${Math.round(ratio * 100)}%`;
    });
    $$("[data-occ-ring]").forEach((el) => {
      el.style.strokeDasharray = String(RING);
      el.style.strokeDashoffset = String(RING * (1 - ratio));
    });
    $$("[data-occ-status]").forEach((el) => {
      el.textContent = status.label;
      el.dataset.state = status.state;
    });

    if (lastCount !== null && n !== lastCount) {
      floatDelta(n - lastCount);
      $$("[data-occ-count]").forEach((el) => {
        el.classList.remove("bump");
        void el.offsetWidth;
        el.classList.add("bump");
      });
    }
    lastCount = n;
    renderFeed(o);
  }

  function floatDelta(delta) {
    $$("[data-occ-floaters]").forEach((box) => {
      const s = document.createElement("span");
      s.className = `floater ${delta > 0 ? "up" : "down"}`;
      s.textContent = delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
      s.setAttribute("aria-hidden", "true");
      box.appendChild(s);
      s.addEventListener("animationend", () => s.remove());
    });
  }

  function renderFeed(o) {
    const lists = $$("[data-occ-feed]");
    if (!lists.length) return;
    const log = o.log || [];
    const newest = log[0] ? log[0].at : null;
    const isFresh = lastLogAt !== null && newest !== lastLogAt;
    lastLogAt = newest;
    const html = log.length
      ? log
          .map(
            (e, i) => `<li class="${i === 0 && isFresh ? "fresh" : ""}">
              <span class="feed-delta ${e.delta > 0 ? "up" : "down"}">${e.delta > 0 ? "+1" : "−1"}</span>
              <span class="feed-text">${escapeHtml(e.text)}</span>
              <time datetime="${new Date(e.at).toISOString()}">${timeFmt(e.at)}</time>
            </li>`
          )
          .join("")
      : `<li class="feed-empty">Még nincs mozgás.</li>`;
    lists.forEach((list) => {
      list.innerHTML = html;
    });
  }

  function drift() {
    const o = occ();
    const n = countOf(o);
    let delta = Math.random() < 0.5 ? -1 : 1;
    if (n >= CAPACITY - 4) delta = -1;
    if (o.guests <= 10) delta = 1;
    o.guests += delta;
    pushLog(o, delta, delta > 0 ? "Valaki belépett a terembe" : "Valaki távozott a teremből");
    write(KEYS.occ, o);
    renderOccupancy();
  }

  function scheduleDrift() {
    setTimeout(() => {
      drift();
      scheduleDrift();
    }, 6000 + Math.random() * 6000);
  }

  function toggleCheckin() {
    const u = currentUser();
    if (!u) return;
    if (!hasActivePlan(u)) {
      toast("A becsekkoláshoz aktív bérlet szükséges.", "err");
      return;
    }
    const o = occ();
    const inside = o.members.some((m) => m.email === u.email);
    if (inside) {
      o.members = o.members.filter((m) => m.email !== u.email);
      pushLog(o, -1, "Egy tag kicsekkolt");
      toast("Kicsekkoltál. Jó pihenést! (−1)");
    } else {
      if (countOf(o) >= CAPACITY) {
        toast("A terem most megtelt, próbáld kicsit később.", "err");
        return;
      }
      o.members.push({ email: u.email, at: Date.now() });
      pushLog(o, 1, "Egy tag becsekkolt");
      toast("Becsekkoltál. Jó edzést! (+1)");
    }
    write(KEYS.occ, o);
    renderOccupancy();
    renderAccount();
  }

  /* ---------- UI helpers ---------- */
  function toast(message, type = "ok") {
    let wrap = $("[data-toasts]");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toasts";
      wrap.dataset.toasts = "";
      wrap.setAttribute("role", "status");
      wrap.setAttribute("aria-live", "polite");
      document.body.appendChild(wrap);
    }
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = message;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add("out");
      t.addEventListener("animationend", () => t.remove());
    }, 3200);
  }

  function showAlert(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }

  function renderNav() {
    const u = currentUser();
    $$("[data-when-guest]").forEach((el) => {
      el.hidden = Boolean(u);
    });
    $$("[data-when-member]").forEach((el) => {
      el.hidden = !u;
    });
    $$("[data-pay]").forEach((el) => {
      el.disabled = !u;
    });
  }

  function bindNav() {
    const header = $("[data-header]");
    const btn = $("[data-nav-toggle]");
    if (!header) return;
    const close = () => {
      header.classList.remove("open");
      if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-label", "Menü megnyitása");
      }
    };
    if (btn) {
      btn.addEventListener("click", () => {
        const open = header.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(open));
        btn.setAttribute("aria-label", open ? "Menü bezárása" : "Menü megnyitása");
      });
    }
    $$(".main-nav a").forEach((a) => a.addEventListener("click", close));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function bindGlobalClicks() {
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-logout]")) {
        e.preventDefault();
        logout();
        return;
      }
      if (e.target.closest("[data-checkin]")) {
        e.preventDefault();
        toggleCheckin();
        return;
      }
      const passBtn = e.target.closest("[data-toggle-pass]");
      if (passBtn) {
        const input = passBtn.parentElement.querySelector("input");
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        passBtn.setAttribute("aria-label", show ? "Jelszó elrejtése" : "Jelszó megjelenítése");
        passBtn.setAttribute("aria-pressed", String(show));
      }
    });
  }

  function initReveal() {
    const items = $$("[data-reveal]");
    if (!items.length) return;
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    items.forEach((el) => io.observe(el));
  }

  function renderPeak() {
    const box = $("[data-peak]");
    if (!box) return;
    const hour = new Date().getHours();
    box.innerHTML = PEAK.map((v, i) => {
      const h = i + 6;
      const label = h % 3 === 0 ? `${h}h` : "";
      return `<div class="peak-col ${h === hour ? "now" : ""}" title="${h}:00 – kb. ${v}% telítettség">
        <div class="peak-bar-wrap"><div class="peak-bar" style="--h:${v}%"></div></div>
        <span class="peak-label">${label}</span>
      </div>`;
    }).join("");
    const tip = $("[data-peak-tip]");
    if (tip) {
      const idx = Math.max(0, Math.min(PEAK.length - 1, hour - 6));
      const quietAhead = PEAK.slice(idx)
        .map((v, i) => ({ v, h: i + idx + 6 }))
        .filter((x) => x.v < 40 && x.h > hour);
      tip.textContent = quietAhead.length
        ? `Tipp: ma ${quietAhead[0].h}:00 körül várhatóan nyugodtabb lesz a terem.`
        : "Tipp: reggel 9 és 11 óra között a legnyugodtabb a terem.";
    }
  }

  /* ---------- Auth page ---------- */
  function nextUrl() {
    const n = new URLSearchParams(location.search).get("next");
    return n && /^[a-z]+\.html(\?[a-z]+=[a-z]+)?$/.test(n) ? n : "fiok.html";
  }

  function scorePassword(p) {
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-ZÁÉÍÓÖŐÚÜŰ]/.test(p) && /[a-záéíóöőúüű]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^A-Za-z0-9ÁÉÍÓÖŐÚÜŰáéíóöőúüű]/.test(p)) s++;
    return p ? Math.max(1, s) : 0;
  }

  function initAuth() {
    const root = $("[data-auth]");
    if (!root) return;
    if (currentUser()) {
      location.replace(nextUrl());
      return;
    }

    const tabs = $$("[data-tab]", root);
    const show = (name, focus = false) => {
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      $$("[data-panel]", root).forEach((p) => {
        p.hidden = p.dataset.panel !== name;
      });
      root.dataset.active = name;
    };
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        show(t.dataset.tab);
        history.replaceState(null, "", `${location.search}${t.dataset.tab === "register" ? "#regisztracio" : "#bejelentkezes"}`);
      });
      t.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          show(t.dataset.tab === "login" ? "register" : "login", true);
        }
      });
    });
    $$("[data-switch]", root).forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        show(a.dataset.switch, true);
      })
    );
    show(location.hash === "#regisztracio" ? "register" : "login");

    const loginForm = $("#login-form");
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(loginForm));
      const result = await login(data.email, data.password);
      if (!result.ok) {
        showAlert($("[data-alert]", loginForm), result.message);
        return;
      }
      location.href = nextUrl();
    });

    const regForm = $("#register-form");
    const pass = $("[name=password]", regForm);
    const meter = $("[data-strength]", regForm);
    const meterLabel = $("[data-strength-label]", regForm);
    const labels = ["Legalább 8 karakter, kis- és nagybetű, szám.", "Gyenge", "Közepes", "Jó", "Erős"];
    pass.addEventListener("input", () => {
      const s = scorePassword(pass.value);
      meter.dataset.score = String(s);
      meterLabel.textContent = labels[s];
    });

    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(regForm));
      const alert = $("[data-alert]", regForm);
      if (data.name.trim().length < 3) return showAlert(alert, "Add meg a teljes neved.");
      if (data.password.length < 8) return showAlert(alert, "A jelszó legalább 8 karakter legyen.");
      if (data.password !== data.password2) return showAlert(alert, "A két jelszó nem egyezik.");
      const result = await register(data);
      if (!result.ok) return showAlert(alert, result.message);
      location.href = nextUrl() === "fiok.html" ? "tagsag.html" : nextUrl();
    });
  }

  /* ---------- Checkout page ---------- */
  function initCheckout() {
    const form = $("[data-checkout]");
    if (!form) return;

    const pre = new URLSearchParams(location.search).get("plan");
    if (pre && PLANS[pre]) {
      const radio = $(`input[name="plan"][value="${pre}"]`, form);
      if (radio) radio.checked = true;
    }

    const update = () => {
      const id = form.elements.plan.value;
      const plan = PLANS[id];
      $("[data-sum-name]").textContent = plan.name;
      $("[data-sum-duration]").textContent = plan.duration;
      $("[data-sum-valid]").textContent = dateFmt(validUntilFor(currentUser(), plan.days));
      $("[data-sum-total]").textContent = huf(plan.price);
      $("[data-pay-amount]").textContent = huf(plan.price);
      const next = encodeURIComponent(`tagsag.html?plan=${id}`);
      $$("[data-gate-login]").forEach((a) => {
        a.href = `belepes.html?next=${next}#bejelentkezes`;
      });
      $$("[data-gate-register]").forEach((a) => {
        a.href = `belepes.html?next=${next}#regisztracio`;
      });
    };
    $$('input[name="plan"]', form).forEach((r) => r.addEventListener("change", update));
    update();

    const num = form.elements.cardnumber;
    const exp = form.elements.exp;
    const cvc = form.elements.cvc;
    const holder = form.elements.holder;
    const pvNum = $("[data-card-number]");
    const pvName = $("[data-card-name]");
    const pvExp = $("[data-card-exp]");

    num.addEventListener("input", () => {
      const digits = num.value.replace(/\D/g, "").slice(0, 16);
      num.value = digits.replace(/(.{4})/g, "$1 ").trim();
      pvNum.textContent = (digits + "•".repeat(16 - digits.length)).replace(/(.{4})/g, "$1 ").trim();
    });
    exp.addEventListener("input", () => {
      const d = exp.value.replace(/\D/g, "").slice(0, 4);
      exp.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
      pvExp.textContent = exp.value || "HH/ÉÉ";
    });
    cvc.addEventListener("input", () => {
      cvc.value = cvc.value.replace(/\D/g, "").slice(0, 3);
    });
    holder.addEventListener("input", () => {
      pvName.textContent = holder.value.trim() || "KÁRTYABIRTOKOS";
    });

    const u = currentUser();
    if (u && !holder.value) {
      holder.value = u.name;
      pvName.textContent = u.name;
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const alert = $("[data-checkout-alert]");
      if (!currentUser()) return showAlert(alert, "A vásárláshoz előbb jelentkezz be vagy regisztrálj.");
      const digits = num.value.replace(/\D/g, "");
      if (holder.value.trim().length < 3) return showAlert(alert, "Add meg a kártyán szereplő nevet.");
      if (digits.length !== 16) return showAlert(alert, "A kártyaszám 16 számjegyből áll.");
      const [mm, yy] = exp.value.split("/").map(Number);
      const expDate = new Date(2000 + (yy || 0), mm || 0, 1);
      if (!mm || mm > 12 || !yy || expDate <= new Date()) return showAlert(alert, "Érvénytelen lejárati dátum.");
      if (cvc.value.length !== 3) return showAlert(alert, "A CVC kód 3 számjegy.");
      showAlert(alert, "");

      const btn = $("[data-pay]");
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Fizetés folyamatban…`;
      setTimeout(() => {
        const plan = PLANS[form.elements.plan.value];
        purchase(form.elements.plan.value);
        toast(`Sikeres vásárlás: ${plan.name}. Jó edzést!`);
        setTimeout(() => {
          location.href = "fiok.html";
        }, 900);
      }, 1300);
    });
  }

  /* ---------- Account page ---------- */
  let timerId = null;

  function renderAccount() {
    const root = $("[data-account]");
    if (!root) return;
    const u = currentUser();
    if (!u) {
      location.replace("belepes.html?next=fiok.html");
      return;
    }
    const active = hasActivePlan(u);
    const plan = PLANS[u.plan];
    const set = (sel, text) => $$(sel).forEach((el) => {
      el.textContent = text;
    });

    set("[data-acc-first]", firstName(u.name));
    set("[data-acc-name]", u.name);
    set("[data-acc-id]", u.memberId);
    set("[data-acc-plan]", active && plan ? plan.name : "Nincs aktív");
    set("[data-acc-valid]", active ? dateFmt(u.validUntil) : "—");
    set("[data-acc-status]", active ? "Aktív tag" : "Nincs bérlet");
    $("[data-member-card]").dataset.active = String(active);

    const daysLeft = active ? Math.ceil((new Date(u.validUntil) - new Date()) / DAY) : 0;
    set("[data-acc-days]", active ? `${daysLeft} nap` : "0 nap");
    set(
      "[data-acc-days-sub]",
      active ? `van hátra a bérletedből · lejár: ${dateFmt(u.validUntil)}` : "Vásárolj bérletet, és már ma becsekkolhatsz."
    );
    const total = active && plan ? Math.max(plan.days, daysLeft) : 1;
    $("[data-acc-progress]").style.width = `${active ? Math.min(100, (daysLeft / total) * 100) : 0}%`;
    set("[data-acc-buy]", active ? "Bérlet hosszabbítása" : "Bérletet veszek");

    const entry = occ().members.find((m) => m.email === u.email);
    const btn = $("[data-checkin]");
    btn.disabled = !active;
    btn.dataset.in = String(Boolean(entry));
    $("[data-checkin-label]").textContent = entry ? "Kicsekkolás" : "Becsekkolás";
    $("[data-checkin-icon-in]").hidden = Boolean(entry);
    $("[data-checkin-icon-out]").hidden = !entry;
    const stateDot = $("[data-checkin-dot]");
    stateDot.classList.toggle("off", !entry);
    set(
      "[data-checkin-state]",
      !active ? "Becsekkoláshoz aktív bérlet kell" : entry ? "Bent vagy a teremben" : "Jelenleg nem vagy bent"
    );
    $("[data-timer-box]").hidden = !entry;

    clearInterval(timerId);
    if (entry) {
      const tick = () => {
        const s = Math.floor((Date.now() - entry.at) / 1000);
        const hh = String(Math.floor(s / 3600)).padStart(2, "0");
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        set("[data-acc-timer]", `${hh}:${mm}:${ss}`);
      };
      tick();
      timerId = setInterval(tick, 1000);
    }
  }

  /* ---------- Init ---------- */
  function init() {
    occ();
    renderNav();
    bindNav();
    bindGlobalClicks();
    renderOccupancy();
    renderPeak();
    initAuth();
    initCheckout();
    renderAccount();
    initReveal();
    scheduleDrift();
    $$("[data-year]").forEach((el) => {
      el.textContent = String(new Date().getFullYear());
    });

    window.addEventListener("storage", (e) => {
      if (e.key === KEYS.occ) {
        renderOccupancy();
        renderAccount();
      }
      if (e.key === KEYS.session || e.key === KEYS.users) {
        renderNav();
        renderAccount();
      }
    });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", Samson.init);
