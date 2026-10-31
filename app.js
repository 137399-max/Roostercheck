
const SUPABASE_URL = "https://pakdmubgnaowikhztnip.supabase.co";
const SUPABASE_KEY = "sb_publishable_dqTBWx0eJGY72D6b2v-oDw_aPMmJTBp";
const REDIRECT_URL = "https://137399-max.github.io/Roostercheck/";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = id => document.getElementById(id);

let events = [];
let selectedDate = new Date();
let deferredPrompt = null;
let currentUserId = null;

// ACCOUNT
async function checkLogin() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    $("authStatus").textContent = error.message;
    return;
  }

  showAccount(data.session);

  if (data.session) {
    currentUserId = data.session.user.id;
    await loadRoster();
  }
}

function showAccount(session) {
  $("signedInArea").hidden = !session;
  $("authForm").hidden = !!session;
  $("googleBtn").hidden = !!session;

  if (session) {
    $("userEmail").textContent = "Ingelogd als " + session.user.email;
  } else {
    currentUserId = null;
  }
}

// ROOSTER LADEN
async function loadRoster() {
  if (!currentUserId) return;

  $("importStatus").textContent = "Je rooster laden...";

  const { data, error } = await supabaseClient
    .from("roosters")
    .select("events")
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (error) {
    $("importStatus").textContent =
      "Rooster laden mislukt: " + error.message;
    return;
  }

  if (!data) {
    events = [];
    $("importStatus").textContent = "Nog geen opgeslagen rooster.";
    render();
    return;
  }

  events = (data.events || []).map(e => ({
    ...e,
    start: new Date(e.start),
    end: new Date(e.end)
  }));

  if (events.length) {
    selectedDate = events[0].start;
    $("importStatus").textContent = "Je opgeslagen rooster is geladen!";
  } else {
    $("importStatus").textContent = "Je rooster is leeg.";
  }

  render();
}

// ROOSTER OPSLAAN
async function saveRoster() {
  if (!currentUserId) {
    $("importStatus").textContent =
      "Log in om je rooster op te slaan.";
    return;
  }

  const savedEvents = events.map(e => ({
    ...e,
    start: e.start.toISOString(),
    end: e.end.toISOString()
  }));

  const { error } = await supabaseClient
    .from("roosters")
    .upsert({
      user_id: currentUserId,
      events: savedEvents,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "user_id"
    });

  $("importStatus").textContent = error
    ? "Opslaan mislukt: " + error.message
    : "Je rooster is online opgeslagen!";
}

// INLOGGEN
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();

  $("authStatus").textContent = "Bezig met inloggen...";

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: $("authEmail").value.trim(),
    password: $("authPassword").value
  });

  $("authStatus").textContent = error
    ? error.message
    : "Je bent ingelogd!";
});

// ACCOUNT AANMAKEN
$("signupBtn").onclick = async () => {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    $("authStatus").textContent =
      "Vul je e-mailadres en wachtwoord in.";
    return;
  }

  if (password.length < 6) {
    $("authStatus").textContent =
      "Minimaal 6 tekens voor je wachtwoord.";
    return;
  }

  $("authStatus").textContent = "Account aanmaken...";

  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: REDIRECT_URL }
  });

  $("authStatus").textContent = error
    ? error.message
    : "Account aangemaakt! Controleer je e-mail.";
};

// GOOGLE
$("googleBtn").onclick = async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: REDIRECT_URL }
  });

  if (error) $("authStatus").textContent = error.message;
};

// UITLOGGEN
$("logoutBtn").onclick = async () => {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    $("authStatus").textContent = error.message;
    return;
  }

  events = [];
  render();
  $("authStatus").textContent = "Je bent uitgelogd.";
};

// AUTH STATUS
supabaseClient.auth.onAuthStateChange((event, session) => {
  showAccount(session);

  if (event === "SIGNED_IN" && session) {
    currentUserId = session.user.id;
    setTimeout(() => loadRoster(), 0);
  }

  if (event === "SIGNED_OUT") {
    events = [];
    render();
  }
});

// DATUMFUNCTIES
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function atTime(date, time) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function fmtTime(date) {
  return date.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function sameDay(a, b) {
  return a.toDateString() === b.toDateString();
}

// VOORBEELDROOSTER
function demoEvents() {
  const monday = startOfWeek(new Date());

  const data = [
    ["08:30", "09:20", "Nederlands", "Lokaal 1.08"],
    ["09:20", "10:10", "Wiskunde", "Lokaal 2.14"],
    ["10:30", "11:20", "Engels", "Lokaal 1.12"],
    ["11:20", "12:10", "Biologie", "Lokaal 0.06"],
    ["13:00", "13:50", "Geschiedenis", "Lokaal 2.02"],
    ["13:50", "14:40", "Informatica", "Lokaal 3.01"]
  ];

  return data.map((x, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (i < 4 ? 0 : 1));

    return {
      start: atTime(d, x[0]),
      end: atTime(d, x[1]),
      summary: x[2],
      location: x[3]
    };
  });
}

// ROOSTER WEERGEVEN
function render() {
  const week = startOfWeek(selectedDate);
  const tabs = $("weekTabs");
  tabs.innerHTML = "";

  // WEEKNAVIGATIE
  const nav = document.createElement("div");
  nav.className = "week-navigation";

  const prev = document.createElement("button");
  prev.textContent = "← Vorige";
  prev.onclick = () => {
    selectedDate.setDate(selectedDate.getDate() - 7);
    render();
  };

  const label = document.createElement("strong");
  label.textContent = "Week van " +
    week.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });

  const nextWeek = document.createElement("button");
  nextWeek.textContent = "Volgende →";
  nextWeek.onclick = () => {
    selectedDate.setDate(selectedDate.getDate() + 7);
    render();
  };

  nav.append(prev, label, nextWeek);
  tabs.append(nav);

  // VANDAAG
  const today = document.createElement("button");
  today.textContent = "Vandaag";
  today.onclick = () => {
    selectedDate = new Date();
    render();
  };
  tabs.append(today);

  // DAGKNOPPEN
  for (let i = 0; i < 5; i++) {
    const d = new Date(week);
    d.setDate(week.getDate() + i);

    const button = document.createElement("button");
    button.className = "day-tab" +
      (sameDay(d, selectedDate) ? " selected" : "");

    button.innerHTML = `<strong>${d.toLocaleDateString("nl-NL", {
      weekday: "short"
    })}</strong><span>${d.getDate()} ${d.toLocaleDateString("nl-NL", {
      month: "short"
    })}</span>`;

    button.onclick = () => {
      selectedDate = d;
      render();
    };

    tabs.append(button);
  }

  // LESSEN
  const todays = events
    .filter(e => sameDay(e.start, selectedDate))
    .sort((a, b) => a.start - b.start);

  $("lessonCount").textContent =
    events.filter(e => sameDay(e.start, new Date())).length;

  const upcoming = events
    .filter(e => e.end > new Date())
    .sort((a, b) => a.start - b.start)[0];

  $("nextSubject").textContent =
    upcoming?.summary || "Geen komende les";

  $("nextInfo").textContent = upcoming
    ? `${fmtTime(upcoming.start)} · ${upcoming.location || "Lokaal onbekend"}`
    : "Je rooster is bijgewerkt";

  const area = $("schedule");
  area.innerHTML = "";

  if (!todays.length) {
    area.innerHTML =
      '<div class="empty"><div class="empty-icon">☀️</div><h3>Geen lessen gevonden</h3><p>Er staan geen lessen op deze dag.</p></div>';
    return;
  }

  todays.forEach(e => {
    const row = document.createElement("div");
    row.className = "lesson";

    row.innerHTML =
      `<div class="lesson-time">${fmtTime(e.start)}<br><span class="muted">${fmtTime(e.end)}</span></div><div class="lesson-bar"></div><div><div class="lesson-name"></div><div class="lesson-meta"></div></div><span class="lesson-tag">Les</span>`;

    row.querySelector(".lesson-name").textContent = e.summary;
    row.querySelector(".lesson-meta").textContent =
      e.location || "Lokaal niet vermeld";

    area.append(row);
  });
}

// ICS LEZEN
function parseICS(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  const parsed = [];

  for (const block of blocks) {
    const get = key => {
      const line = block.split(/\r?\n/).find(l => l.startsWith(key));
      return line
        ? line.substring(line.indexOf(":") + 1).trim()
        : "";
    };

    const dt = key => {
      const line = block.split(/\r?\n/).find(l => l.startsWith(key));
      if (!line) return null;

      const raw = line.substring(line.indexOf(":") + 1).trim();

      if (/^\d{8}$/.test(raw)) {
        return new Date(
          +raw.slice(0, 4),
          +raw.slice(4, 6) - 1,
          +raw.slice(6, 8)
        );
      }

      const m = raw.match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z?$/
      );

      if (!m) return null;

      return new Date(
        +m[1], +m[2] - 1, +m[3],
        +m[4], +m[5], +(m[6] || 0)
      );
    };

    const start = dt("DTSTART");
    const end = dt("DTEND");

    if (start && end) {
      parsed.push({
        start,
        end,
        summary: get("SUMMARY")
          .replace(/\\,/g, ",")
          .replace(/\\n/g, " "),
        location: get("LOCATION").replace(/\\,/g, ",")
      });
    }
  }

  return parsed;
}

// ICS IMPORTEREN
$("icsFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const parsed = parseICS(await file.text());

    if (!parsed.length) {
      throw new Error("Geen lessen herkend in dit bestand.");
    }

    events = parsed;
    selectedDate = events[0].start;

    render();
    await saveRoster();
  } catch (err) {
    $("importStatus").textContent =
      "Import mislukt: " + err.message;
  }
});

// VOORBEELDROOSTER LADEN
$("demoBtn").onclick = async () => {
  events = demoEvents();
  selectedDate = new Date();
  render();
  await saveRoster();
};

// VANDAAG-KNOP IN HTML
$("todayBtn").onclick = () => {
  selectedDate = new Date();
  render();
};

// DONKERE MODUS
$("themeBtn").onclick = () => {
  document.body.classList.toggle("dark");

  localStorage.setItem(
    "rc-theme",
    document.body.classList.contains("dark") ? "dark" : "light"
  );
};

if (localStorage.getItem("rc-theme") === "dark") {
  document.body.classList.add("dark");
}

// DATUM
$("todayLabel").textContent =
  new Date().toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).toUpperCase();

// INSTALLEREN
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  $("installBtn").hidden = false;
});

$("installBtn").onclick = async () => {
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  await deferredPrompt.userChoice;

  deferredPrompt = null;
  $("installBtn").hidden = true;
};

// SERVICE WORKER
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(console.error);
}

// START
render();
checkLogin();
