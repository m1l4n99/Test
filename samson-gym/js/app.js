const Samson = (() => {
  const KEYS = {
    members: "samson_members",
    session: "samson_session",
    occupancy: "samson_occupancy",
  };
  const CAPACITY = 80;

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

  function members() {
    return read(KEYS.members, []);
  }

  function session() {
    return read(KEYS.session, null);
  }

  function occupancy() {
    const data = read(KEYS.occupancy, null);
    if (data) return data;
    const seeded = { guests: 24, checkedIn: [] };
    write(KEYS.occupancy, seeded);
    return seeded;
  }

  function currentUser() {
    const s = session();
    if (!s) return null;
    return members().find((m) => m.email === s.email) || null;
  }

  function count() {
    const o = occupancy();
    return Math.min(CAPACITY, o.guests + o.checkedIn.length);
  }

  function statusText(n) {
    if (n >= CAPACITY) return { label: "Megtelt", cls: "status-full" };
    if (n >= 60) return { label: "Zsúfolt", cls: "status-busy" };
    return { label: "Van hely", cls: "status-ok" };
  }

  function renderOccupancy() {
    const n = count();
    const percent = Math.round((n / CAPACITY) * 100);
    const status = statusText(n);
    document.querySelectorAll("[data-occ-count]").forEach((el) => {
      el.textContent = String(n);
    });
    document.querySelectorAll("[data-occ-cap]").forEach((el) => {
      el.textContent = String(CAPACITY);
    });
    document.querySelectorAll("[data-occ-bar]").forEach((el) => {
      el.style.width = `${percent}%`;
    });
    document.querySelectorAll("[data-occ-status]").forEach((el) => {
      el.textContent = status.label;
      el.className = `status-pill ${status.cls}`;
    });
  }

  function setNav() {
    const user = currentUser();
    document.querySelectorAll("[data-when-guest]").forEach((el) => {
      el.style.display = user ? "none" : "";
    });
    document.querySelectorAll("[data-when-member]").forEach((el) => {
      el.style.display = user ? "" : "none";
    });
    document.querySelectorAll("[data-member-name]").forEach((el) => {
      if (user) el.textContent = user.name;
    });
  }

  function register(payload) {
    const list = members();
    if (list.some((m) => m.email === payload.email)) {
      return { ok: false, message: "Ez az e-mail már tagsággal rendelkezik. Lépj be." };
    }
    list.push({
      name: payload.name,
      email: payload.email.toLowerCase(),
      password: payload.password,
      plan: payload.plan,
      purchasedAt: new Date().toISOString(),
    });
    write(KEYS.members, list);
    write(KEYS.session, { email: payload.email.toLowerCase() });
    return { ok: true };
  }

  function login(email, password) {
    const user = members().find(
      (m) => m.email === email.toLowerCase() && m.password === password
    );
    if (!user) {
      return { ok: false, message: "Hibás e-mail vagy jelszó, vagy még nincs tagságod." };
    }
    write(KEYS.session, { email: user.email });
    return { ok: true };
  }

  function logout() {
    localStorage.removeItem(KEYS.session);
    location.href = "index.html";
  }

  function toggleCheckin() {
    const user = currentUser();
    if (!user) return;
    const o = occupancy();
    const i = o.checkedIn.indexOf(user.email);
    if (i >= 0) {
      o.checkedIn.splice(i, 1);
    } else {
      if (count() >= CAPACITY) return { ok: false, message: "A terem most megtelt." };
      o.checkedIn.push(user.email);
    }
    write(KEYS.occupancy, o);
    renderOccupancy();
    renderAccount();
    return { ok: true };
  }

  function isCheckedIn() {
    const user = currentUser();
    if (!user) return false;
    return occupancy().checkedIn.includes(user.email);
  }

  function planLabel(id) {
    return (
      {
        havi: "Havi tagság — 12 900 Ft",
        negyedeves: "Negyedéves tagság — 32 900 Ft",
        eves: "Éves tagság — 99 900 Ft",
      }[id] || id
    );
  }

  function renderAccount() {
    const box = document.querySelector("[data-account]");
    if (!box) return;
    const user = currentUser();
    if (!user) {
      location.href = "belepes.html";
      return;
    }
    const inGym = isCheckedIn();
    box.querySelector("[data-plan]").textContent = planLabel(user.plan);
    box.querySelector("[data-email]").textContent = user.email;
    box.querySelector("[data-since]").textContent = new Date(
      user.purchasedAt
    ).toLocaleDateString("hu-HU");
    const btn = box.querySelector("[data-checkin]");
    btn.textContent = inGym ? "Kilépés a teremből" : "Belépés a terembe";
    box.querySelector("[data-in-gym]").textContent = inGym
      ? "Bent vagy a teremben."
      : "Jelenleg nem vagy bent.";
  }

  function showAlert(id, type, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `alert show ${type}`;
    el.textContent = message;
  }

  function bindForms() {
    const buy = document.getElementById("buy-form");
    if (buy) {
      buy.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(buy));
        if (data.password.length < 4) {
          showAlert("buy-alert", "err", "A jelszónak legalább 4 karakteresnek kell lennie.");
          return;
        }
        const result = register(data);
        if (!result.ok) {
          showAlert("buy-alert", "err", result.message);
          return;
        }
        location.href = "fiok.html";
      });
    }

    const loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(loginForm));
        const result = login(data.email, data.password);
        if (!result.ok) {
          showAlert("login-alert", "err", result.message);
          return;
        }
        location.href = "fiok.html";
      });
    }

    document.addEventListener("click", (e) => {
      const logoutLink = e.target.closest("[data-logout]");
      if (logoutLink) {
        e.preventDefault();
        logout();
        return;
      }
      if (e.target.closest("[data-checkin]")) {
        e.preventDefault();
        toggleCheckin();
      }
    });
  }

  function driftGuests() {
    const o = occupancy();
    const change = Math.random() < 0.5 ? -1 : 1;
    o.guests = Math.max(8, Math.min(55, o.guests + change));
    write(KEYS.occupancy, o);
    renderOccupancy();
  }

  function init() {
    occupancy();
    setNav();
    renderOccupancy();
    renderAccount();
    bindForms();
    setInterval(driftGuests, 8000);
  }

  return { init, CAPACITY, checkin: toggleCheckin, logout };
})();

document.addEventListener("DOMContentLoaded", Samson.init);
