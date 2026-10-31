
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
    $("importStatus").textContent = "Laden mislukt: " + error.message;
    return;
  }

  if (!data) {
    events = [];
    render();
    $("importStatus").textContent = "Nog geen opgeslagen rooster.";
    return;
  }

  events = (data.events || []).map(e => ({
    ...e,
    start: new Date(e.start),
    end: new Date(e.end)
  }));

  render();
  $("importStatus").textContent = "Je opgeslagen rooster is geladen!";
}

// OPSLAAN
async function saveRoster() {
  if (!currentUserId) {
    $("importStatus").textContent = "Log in om je rooster op te slaan.";
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
    $("authStatus").textContent = "Vul je e-mailadres en wachtwoord in.";
    return;
  }

  if (password.length < 6) {
    $("authStatus").textContent = "Minimaal 6 tekens voor je wachtwoord.";
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

supabaseClient.auth.onAuthStateChange((event, session) => {
  showAccount(session);

  if (event === "SIGNED_IN" && session) {
    currentUserId = session.user.id;
    setTimeout(loadRoster, 0);
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

function sameDay(a, b) {
  return a.toLocaleDateString("en-CA", {
    timeZone: "Europe/Amsterdam"
  }) === b.toLocaleDateString("en-CA", {
    timeZone: "Europe/Amsterdam"
  });
}

function fmtTime(date) {
  return date.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam"
  });
}

// ICS DATUM
function parseICSDate(line) {
  if (!line) return null;

  const colon = line.indexOf(":");
  if (colon < 0) return null;

  const raw = line.substring(colon + 1).trim();

  const match = raw.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);

  if (!match[4]) {
    return new Date(year, month, day);
  }

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);

  if (match[7] === "Z") {
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  return new Date(year, month, day, hour, minute, second);
}

function unescapeICS(value) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// ICS PARSEN
function parseICS(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  const parsed = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);

    const findLine = name =>
      lines.find(line =>
        line.startsWith(name + ":") ||
        line.startsWith(name + ";")
      );

    const getValue = name => {
      const line = findLine(name);
      if (!line) return "";

      return unescapeICS(line.substring(line.indexOf(":") + 1));
    };

    const start = parseICSDate(findLine("DTSTART"));
    const end = parseICSDate(findLine("DTEND"));

    if (!start || !end) continue;

    const summary = getValue("SUMMARY");
    const description = getValue("DESCRIPTION");
    const status = getValue("STATUS").toUpperCase();
    const combined = `${summary} ${description}`.toLowerCase();

    const cancelled =
      status === "CANCELLED" ||
      /\[x\]/i.test(summary) ||
      combined.includes("les vervalt") ||
      combined.includes("les vervallen") ||
      combined.includes("les gaat niet door");

    let changeLabel = "";

    if (cancelled) {
      changeLabel = "VERVALLEN";
    } else if (combined.includes("lokaal gewijzigd")) {
      changeLabel = "LOKAAL GEWIJZIGD";
    } else if (combined.includes("docent gewijzigd")) {
      changeLabel = "DOCENT GEWIJZIGD";
    } else if (combined.includes("verplaatst")) {
      changeLabel = "VERPLAATST";
    } else if (description.toLowerCase().includes("wijzigingen:")) {
      changeLabel = "GEWIJZIGD";
    }

    parsed.push({
      start,
      end,
      summary: summary.replace(/^\[x\]\s*/i, ""),
      description,
      location: getValue("LOCATION"),
      status,
      uid: getValue("UID"),
      cancelled,
      changeLabel
    });
  }

  return parsed;
}

// WEEKBALK
function renderWeek() {
  const week = startOfWeek(selectedDate);
  const tabs = $("weekTabs");

  tabs.innerHTML = "";

  $("weekTitle").textContent =
    "Week van " + week.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });

  const names = ["ma", "di", "wo", "do", "vr", "za", "zo"];

  for (let i = 0; i < 7; i++) {
    const d = new Date(week);
    d.setDate(week.getDate() + i);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-tab";

    if (sameDay(d, selectedDate)) {
      button.classList.add("selected");
    }

    const dayName = document.createElement("strong");
    dayName.textContent = names[i];

    const dayNumber = document.createElement("span");
    dayNumber.textContent = d.getDate();

    button.append(dayName, dayNumber);

    button.addEventListener("click", () => {
      selectedDate = d;
      render();
    });

    tabs.appendChild(button);
  }
}

// LESSEN WEERGEVEN
function renderSchedule() {
  const todays = events
    .filter(e => sameDay(e.start, selectedDate))
    .sort((a, b) => a.start - b.start);

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

    if (e.cancelled) row.classList.add("cancelled");
    else if (e.changeLabel) row.classList.add("changed");

    const time = document.createElement("div");
    time.className = "lesson-time";
    time.textContent = `${fmtTime(e.start)} – ${fmtTime(e.end)}`;

    const bar = document.createElement("div");
    bar.className = "lesson-bar";

    const details = document.createElement("div");

    const name = document.createElement("div");
    name.className = "lesson-name";
    name.textContent = e.summary;

    const meta = document.createElement("div");
    meta.className = "lesson-meta";
    meta.textContent = e.location || "Lokaal niet vermeld";

    details.append(name, meta);
    row.append(time, bar, details);

    if (e.changeLabel) {
      const badge = document.createElement("div");
      badge.className = "lesson-status";
      badge.textContent = e.changeLabel;
      row.append(badge);
    }

    area.append(row);
  });
}

// DASHBOARD
function renderDashboard() {
  const now = new Date();

  $("lessonCount").textContent = events.filter(e =>
    sameDay(e.start, now) && !e.cancelled
  ).length;

  const upcoming = events
    .filter(e => !e.cancelled && e.end > now)
    .sort((a, b) => a.start - b.start)[0];

  $("nextSubject").textContent =
    upcoming?.summary || "Geen komende les";

  $("nextInfo").textContent = upcoming
    ? `${fmtTime(upcoming.start)} · ${upcoming.location || "Lokaal onbekend"}`
    : "Je rooster is bijgewerkt";
}

// ALLES VERVERSEN
function render() {
  renderWeek();
  renderSchedule();
  renderDashboard();
}

// SWIPEN
let swipeStartX = 0;
let swipeStartY = 0;

const weekTabs = $("weekTabs");

weekTabs.addEventListener("touchstart", e => {
  if (e.touches.length !== 1) return;

  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
}, { passive: true });

weekTabs.addEventListener("touchend", e => {
  if (e.changedTouches.length !== 1) return;

  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;

  if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) {
    return;
  }

  const newDate = new Date(selectedDate);
  newDate.setDate(newDate.getDate() + (dx < 0 ? 7 : -7));

  selectedDate = newDate;
  render();
}, { passive: true });

// ICS IMPORTEREN
$("icsFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  $("importStatus").textContent = "Rooster importeren...";

  try {
    const parsed = parseICS(await file.text());

    if (!parsed.length) {
      throw new Error("Geen lessen herkend in dit bestand.");
    }

    events = parsed;
    selectedDate = events[0].start;

    render();
    await saveRoster();

    const cancelledCount = events.filter(e => e.cancelled).length;

    $("importStatus").textContent =
      `Import gelukt: ${events.length} gebeurtenissen, ${cancelledCount} vervallen.`;
  } catch (err) {
    $("importStatus").textContent = "Import mislukt: " + err.message;
  }

  e.target.value = "";
});

// VOORBEELDROOSTER
function demoEvents() {
  const monday = startOfWeek(new Date());

  const data = [
    ["08:45", "09:35", "Nederlands", "Lokaal 1.08"],
    ["09:35", "10:25", "Wiskunde", "Lokaal 2.14"],
    ["10:45", "11:35", "Engels", "Lokaal 1.12"],
    ["11:35", "12:25", "Biologie", "Lokaal 0.06"],
    ["13:15", "14:05", "Geschiedenis", "Lokaal 2.02"],
    ["14:05", "14:55", "Informatica", "Lokaal 3.01"]
  ];

  return data.map((x, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (i < 4 ? 0 : 1));

    const [sh, sm] = x[0].split(":").map(Number);
    const [eh, em] = x[1].split(":").map(Number);

    const start = new Date(d);
    start.setHours(sh, sm, 0, 0);

    const end = new Date(d);
    end.setHours(eh, em, 0, 0);

    return {
      start,
      end,
      summary: x[2],
      location: x[3],
      description: "",
      status: "",
      uid: "",
      cancelled: false,
      changeLabel: ""
    };
  });
}

$("demoBtn").onclick = async () => {
  events = demoEvents();
  selectedDate = new Date();
  render();
  await saveRoster();
};

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
    month: "long",
    timeZone: "Europe/Amsterdam"
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
  navigator.serviceWorker.register("./sw.js?v=5")
    .catch(console.error);
}

// START
render();
checkLogin();
