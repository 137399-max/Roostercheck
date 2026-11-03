
const SUPABASE_URL = "https://pakdmubgnaowikhztnip.supabase.co";
const SUPABASE_KEY = "sb_publishable_dqTBWx0eJGY72D6b2v-oDw_aPMmJTBp";
const REDIRECT_URL = location.protocol.startsWith("http")
  ? location.origin + location.pathname.replace(/index\.html$/, "")
  : "https://137399-max.github.io/Roostercheck/";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = id => document.getElementById(id);

let events = [];
let selectedDate = new Date();
let deferredPrompt = null;
let currentUserId = null;
let loadedUserId = null;
let icalUrl = "";
let lastSync = null;
let isRefreshing = false;
let refreshQueued = false;
let serviceWorkerRegistration = null;
let authMode = "login";

let currentUserEmail = "";
let currentProfile = null;
let loadedProfileUserId = null;
let chatSessionUserId = null;
let profilesById = new Map();
let contactAliases = new Map();
let aliasesAvailable = false;
let aliasTargetId = null;
let allProfiles = [];
let chatRooms = [];
let activeChatId = null;
let activeChatMessages = [];
let chatChannel = null;
let chatLoadPromise = null;
let presenceHeartbeat = null;
let presencePublishTimer = null;
let toastTimer = null;
let currentView = "rooster";
let chatSearchTerm = "";
let presenceSearchTerm = "";
let newChatTab = "person";
let groupSelected = new Map();
let groupSearchResults = [];
let lastPeopleQuery = "";
let lastGroupQuery = "";

const REFRESH_INTERVAL_MS = 60 * 1000;
const VAPID_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/push-check`;
let vapidPublicKey = null;

const PROFILE_COLUMNS = [
  "user_id",
  "display_name",
  "status",
  "status_detail",
  "status_location",
  "status_until",
  "status_updated_at",
  "last_seen_at"
].join(", ");

const STATUS_LABELS = {
  in_les: "IN LES",
  pauze: "PAUZE",
  tussenuur: "TUSSENUUR",
  vrij: "VRIJ",
  offline: "OFFLINE"
};

// ACCOUNT
function setView(session) {
  $("loadingScreen").hidden = true;
  $("authScreen").hidden = !!session;
  $("appShell").hidden = !session;

  if (session) {
    currentUserEmail = session.user.email || "";
    $("userEmail").textContent = currentUserEmail;
  } else {
    currentUserEmail = "";
    $("userEmail").textContent = "";
    $("authPassword").value = "";
    closeAllModals();
  }
}

function resetRosterState() {
  currentUserId = null;
  loadedUserId = null;
  events = [];
  icalUrl = "";
  lastSync = null;
  isRefreshing = false;
  refreshQueued = false;
  selectedDate = new Date();

  render();
  updateRosterUI();
  $("importStatus").textContent = "Nog geen rooster gekoppeld.";
}

async function checkLogin() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) throw error;

    setView(data.session);

    if (data.session) {
      currentUserId = data.session.user.id;
      currentUserEmail = data.session.user.email || "";
      await ensureRosterLoaded(currentUserId);
      syncPushNotifications().catch(console.error);
      startChatSession().catch(console.error);
    }
  } catch (error) {
    console.error(error);
    setView(null);
    $("authStatus").textContent =
      "Kon je sessie niet laden. Probeer opnieuw in te loggen.";
  }
}

async function ensureRosterLoaded(userId) {
  if (!userId || loadedUserId === userId) return;

  loadedUserId = userId;
  await loadRoster();
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";

  $("loginTab").classList.toggle("active", !isSignup);
  $("signupTab").classList.toggle("active", isSignup);
  $("loginTab").setAttribute("aria-selected", String(!isSignup));
  $("signupTab").setAttribute("aria-selected", String(isSignup));

  $("authSubmitBtn").textContent = isSignup ? "Account aanmaken" : "Inloggen";
  $("authPassword").autocomplete = isSignup ? "new-password" : "current-password";
  $("authStatus").textContent = "";
}

function setAuthBusy(busy) {
  $("authSubmitBtn").disabled = busy;
  $("authEmail").disabled = busy;
  $("authPassword").disabled = busy;
  $("loginTab").disabled = busy;
  $("signupTab").disabled = busy;

  $("authSubmitBtn").textContent = busy
    ? "Bezig..."
    : authMode === "signup"
      ? "Account aanmaken"
      : "Inloggen";
}

function authErrorMessage(error) {
  const message = (error && error.message) || "Er ging iets mis.";

  if (/invalid login credentials/i.test(message)) {
    return "E-mailadres of wachtwoord is onjuist.";
  }

  if (/email not confirmed/i.test(message)) {
    return "Bevestig eerst je e-mailadres via de link in je inbox.";
  }

  if (/user already registered/i.test(message)) {
    return "Er bestaat al een account met dit e-mailadres.";
  }

  if (/password should be at least|password.*6/i.test(message)) {
    return "Kies een wachtwoord van minstens 6 tekens.";
  }

  if (/rate limit|too many/i.test(message)) {
    return "Te veel pogingen. Probeer het later opnieuw.";
  }

  return message;
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("signupTab").addEventListener("click", () => setAuthMode("signup"));

$("authForm").addEventListener("submit", async e => {
  e.preventDefault();

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    $("authStatus").textContent = "Vul je e-mailadres en wachtwoord in.";
    return;
  }

  if (authMode === "signup" && password.length < 6) {
    $("authStatus").textContent = "Kies een wachtwoord van minstens 6 tekens.";
    return;
  }

  setAuthBusy(true);
  $("authStatus").textContent =
    authMode === "signup" ? "Account aanmaken..." : "Bezig met inloggen...";

  try {
    if (authMode === "signup") {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: REDIRECT_URL }
      });

      if (error) throw error;

      $("authStatus").textContent = data.session
        ? "Account aangemaakt! Je bent ingelogd."
        : "Account aangemaakt! Controleer je e-mail om je account te bevestigen.";
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      $("authStatus").textContent = "Je bent ingelogd!";
    }
  } catch (error) {
    console.error(error);
    $("authStatus").textContent = authErrorMessage(error);
  } finally {
    setAuthBusy(false);
  }
});

// GOOGLE
$("googleBtn").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: REDIRECT_URL }
  });

  if (error) $("authStatus").textContent = error.message;
});

// UITLOGGEN
$("logoutBtn").addEventListener("click", async () => {
  $("logoutBtn").disabled = true;
  $("authStatus").textContent = "";

  await disablePushNotifications();

  const { error } = await supabaseClient.auth.signOut();

  $("logoutBtn").disabled = false;

  if (error) {
    $("importStatus").textContent = "Uitloggen mislukt: " + error.message;
  }
});

supabaseClient.auth.onAuthStateChange((event, session) => {
  setView(session);

  if (session) {
    currentUserId = session.user.id;
    currentUserEmail = session.user.email || "";
    ensureRosterLoaded(currentUserId).catch(console.error);
    syncPushNotifications().catch(console.error);
    startChatSession().catch(console.error);
  } else {
    resetRosterState();
    resetChatState();
  }
});

// ROOSTER LADEN
async function loadRoster() {
  const userId = currentUserId;
  if (!userId) return;

  $("importStatus").textContent = "Je rooster laden...";

  let data;
  let error;

  try {
    ({ data, error } = await supabaseClient
      .from("roosters")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle());
  } catch (loadError) {
    error = loadError;
  }

  if (userId !== currentUserId) return;

  if (error) {
    loadedUserId = null;
    $("importStatus").textContent =
      "Laden mislukt: " + (error.message || "netwerkfout");
    return;
  }

  if (!data) {
    events = [];
    icalUrl = "";
    lastSync = null;
    render();
    updateRosterUI();
    schedulePresencePublish();
    $("importStatus").textContent =
      "Nog geen rooster gekoppeld. Plak hierboven je iCal-link.";
    return;
  }

  events = (data.events || [])
    .map(e => ({
      ...e,
      start: new Date(e.start),
      end: new Date(e.end)
    }))
    .filter(e =>
      !isNaN(e.start.getTime()) &&
      !isNaN(e.end.getTime())
    );

  icalUrl = data.ical_url || "";

  const parsedSync = data.updated_at ? new Date(data.updated_at) : null;
  lastSync =
    (icalUrl || events.length) && parsedSync && !isNaN(parsedSync.getTime())
      ? parsedSync
      : null;

  render();
  updateRosterUI();

  schedulePresencePublish();

  if (icalUrl) {
    $("importStatus").textContent = "Rooster geladen. Bezig met bijwerken...";
    await refreshRoster({ silent: true });
  } else {
    $("importStatus").textContent = events.length
      ? "Rooster geladen. Koppel een iCal-link om het automatisch bij te werken."
      : "Nog geen rooster gekoppeld. Plak hierboven je iCal-link.";
  }
}

// OPSLAAN
async function saveRoster({ markSynced = true } = {}) {
  const userId = currentUserId;

  if (!userId) return false;

  const savedEvents = events.map(e => ({
    ...e,
    start: e.start.toISOString(),
    end: e.end.toISOString()
  }));

  let error;

  try {
    ({ error } = await supabaseClient
      .from("roosters")
      .upsert({
        user_id: userId,
        events: savedEvents,
        ical_url: icalUrl || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "user_id"
      }));
  } catch (saveError) {
    error = saveError;
  }

  if (userId !== currentUserId) return false;

  if (error) {
    console.error(error);
    const message = error.message || "netwerkfout";
    $("importStatus").textContent = /ical_url/i.test(message)
      ? "Opslaan mislukt: de database mist de kolom ical_url. Voer supabase/schema.sql uit."
      : "Opslaan mislukt: " + message;
    return false;
  }

  if (markSynced) lastSync = new Date();

  updateRosterUI();
  schedulePresencePublish();
  return true;
}

// ROOSTER-UI
function updateRosterUI() {
  const linked = !!icalUrl;

  $("rosterLinkedTitle").textContent = linked
    ? "Gekoppeld rooster"
    : "Rooster koppelen";

  $("linkRosterBtn").textContent = linked
    ? "Link opslaan"
    : "Rooster koppelen";

  $("syncActions").hidden = !linked;
  $("lastSync").hidden = !lastSync;

  if (document.activeElement !== $("icalUrl")) {
    $("icalUrl").value = icalUrl;
  }

  $("lastSync").textContent = lastSync
    ? "Laatst bijgewerkt: " + lastSync.toLocaleString("nl-NL", {
        dateStyle: "short",
        timeStyle: "short"
      })
    : "";
}

// iCAL-LINK
function normalizeIcalUrl(value) {
  let url = value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/&amp;/gi, "&");

  if (!url) {
    throw new Error("Plak eerst een iCal-link.");
  }

  if (/^webcal:\/\//i.test(url)) {
    url = "https://" + url.replace(/^webcal:\/\//i, "");
  }

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Dit lijkt geen geldige link. Plak de volledige iCal-link.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("De link moet beginnen met https:// of webcal://.");
  }

  return parsed.href;
}

function assertIcalText(text) {
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    const error = new Error("De link bevat geen iCal-agenda.");
    error.code = "no_calendar";
    throw error;
  }
}

async function fetchDirect(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/calendar, text/plain, */*"
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.code = "http";
      throw error;
    }

    const text = await response.text();
    assertIcalText(text);

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaProxy(url) {
  const { data } = await supabaseClient.auth.getSession();
  const session = data ? data.session : null;

  if (!session) {
    const error = new Error("Je sessie is verlopen. Log opnieuw in.");
    error.code = "auth";
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/ical`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ url })
  });

  if (response.status === 404) {
    const error = new Error("Synchronisatiedienst niet gevonden.");
    error.code = "not_deployed";
    throw error;
  }

  const text = await response.text();

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const body = JSON.parse(text);
      if (body && body.error) message = body.error;
    } catch {
      // Geen JSON-foutmelding.
    }

    const error = new Error(message);
    error.code = "proxy";
    throw error;
  }

  assertIcalText(text);

  return text;
}

async function fetchIcalText(url) {
  try {
    return await fetchDirect(url);
  } catch (directError) {
    console.warn("Direct ophalen mislukt, synchronisatiedienst proberen.", directError);

    try {
      return await fetchViaProxy(url);
    } catch (proxyError) {
      console.error("Synchronisatiedienst mislukt.", proxyError);

      if (proxyError.code === "not_deployed") {
        if (directError.code === "http" || directError.code === "no_calendar") {
          throw directError;
        }

        const error = new Error("Kon de link niet ophalen.");
        error.code = "network";
        error.cause = directError;
        throw error;
      }

      throw proxyError;
    }
  }
}

function describeIcalError(error) {
  if (!error) return "Onbekende fout.";

  if (error.code === "no_calendar") {
    return "De link bevat geen iCal-agenda. Controleer of je de juiste link hebt gekopieerd.";
  }

  if (error.code === "http") {
    return `De schoolserver gaf een fout (${error.message}). Controleer de link.`;
  }

  if (error.code === "network") {
    return "Kon de link niet ophalen. Controleer de link. Als de link klopt, activeer dan de synchronisatiedienst (zie README).";
  }

  if (error.code === "not_deployed") {
    return "De synchronisatiedienst is nog niet geactiveerd. Zie de README.";
  }

  if (error.code === "auth") {
    return error.message;
  }

  if (error.code === "proxy" && /jwt|unauthorized|401/i.test(error.message)) {
    return "Je sessie is verlopen. Log opnieuw in.";
  }

  return error.message || "Onbekende fout.";
}

async function refreshRoster({ silent = false, resetDate = false, notifyCancellations = true } = {}) {
  const userId = currentUserId;
  const url = icalUrl;

  if (!userId || !url) return;

  if (isRefreshing) {
    refreshQueued = true;
    return;
  }

  isRefreshing = true;
  $("refreshBtn").disabled = true;

  if (!silent) {
    $("importStatus").textContent = "Rooster ophalen...";
  }

  try {
    const previousEvents = events;
    const text = await fetchIcalText(url);

    if (userId !== currentUserId || url !== icalUrl) return;

    const parsed = parseICS(text);

    if (!parsed.length) {
      const error = new Error("Geen lessen herkend in deze iCal-link.");
      error.code = "no_calendar";
      throw error;
    }

    const newlyCancelled = notifyCancellations
      ? findNewCancellations(previousEvents, parsed)
      : [];

    events = parsed;

    if (resetDate) {
      const today = new Date();
      selectedDate = parsed.some(e => sameDay(e.start, today))
        ? today
        : parsed[0].start;
    }

    render();

    if (!(await saveRoster())) return;

    if (newlyCancelled.length) {
      showCancellationNotification(newlyCancelled).catch(console.error);
    }

    $("importStatus").textContent =
      `Rooster bijgewerkt: ${events.length} lessen.`;
  } catch (error) {
    console.error(error);
    $("importStatus").textContent =
      "Rooster bijwerken mislukt: " + describeIcalError(error);
  } finally {
    isRefreshing = false;
    $("refreshBtn").disabled = false;

    if (refreshQueued) {
      refreshQueued = false;
      refreshRoster({ silent: true });
    }
  }
}

$("icalForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!currentUserId) return;

  let url;

  try {
    url = normalizeIcalUrl($("icalUrl").value);
  } catch (error) {
    $("importStatus").textContent = error.message;
    return;
  }

  const previousUrl = icalUrl;
  const wasLinked = !!icalUrl;

  icalUrl = url;
  $("icalUrl").value = url;
  updateRosterUI();

  $("importStatus").textContent = "Link opslaan...";

  if (!(await saveRoster({ markSynced: false }))) {
    icalUrl = previousUrl;
    updateRosterUI();
    return;
  }

  $("importStatus").textContent = wasLinked
    ? "Link opgeslagen. Rooster bijwerken..."
    : "Link opgeslagen. Rooster ophalen...";

  await refreshRoster({ resetDate: !wasLinked, notifyCancellations: false });
});

$("refreshBtn").addEventListener("click", () => refreshRoster());

$("unlinkBtn").addEventListener("click", async () => {
  if (!icalUrl) return;

  if (!confirm("Weet je zeker dat je de iCal-link wilt ontkoppelen? Je opgeslagen rooster wordt verwijderd.")) {
    return;
  }

  const previousUrl = icalUrl;
  const previousEvents = events;
  const previousLastSync = lastSync;

  icalUrl = "";
  events = [];
  lastSync = null;
  selectedDate = new Date();

  render();
  updateRosterUI();

  if (await saveRoster({ markSynced: false })) {
    $("importStatus").textContent = "De iCal-link is ontkoppeld.";
  } else {
    icalUrl = previousUrl;
    events = previousEvents;
    lastSync = previousLastSync;
    render();
    updateRosterUI();
  }
});

// Automatisch bijwerken zolang de app open staat.
setInterval(() => {
  if (currentUserId && icalUrl && document.visibilityState === "visible") {
    refreshRoster({ silent: true });
  }
}, REFRESH_INTERVAL_MS);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !currentUserId || !icalUrl) {
    return;
  }

  if (!lastSync || Date.now() - lastSync.getTime() > REFRESH_INTERVAL_MS) {
    refreshRoster({ silent: true });
  }
});

window.addEventListener("online", () => {
  if (currentUserId && icalUrl) {
    refreshRoster({ silent: true });
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
      combined.includes("les gaat niet door") ||
      combined.includes("afgelast") ||
      combined.includes("geannuleerd");

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
    : events.length
      ? "Je rooster is bijgewerkt"
      : "Koppel je iCal-link om te beginnen";
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

// WEEK WISSELEN
function shiftWeek(weeks) {
  const newDate = new Date(selectedDate);
  newDate.setDate(newDate.getDate() + weeks * 7);
  selectedDate = newDate;
  render();
}

$("prevWeekBtn").addEventListener("click", () => shiftWeek(-1));
$("nextWeekBtn").addEventListener("click", () => shiftWeek(1));

document.addEventListener("keydown", event => {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
  ) {
    return;
  }

  if (event.key === "ArrowLeft") {
    shiftWeek(-1);
  } else if (event.key === "ArrowRight") {
    shiftWeek(1);
  }
});

// VANDAAG
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

// MELDINGEN
function eventKey(event) {
  const start = new Date(event.start);

  return `${event.uid || event.summary}|${isNaN(start.getTime()) ? "" : start.toISOString()}`;
}

function findNewCancellations(previousEvents, nextEvents) {
  if (!previousEvents.length) return [];

  const previousByKey = new Map(
    previousEvents.map(event => [eventKey(event), event])
  );

  return nextEvents.filter(event => {
    const previous = previousByKey.get(eventKey(event));

    return event.cancelled && previous && !previous.cancelled;
  });
}

function cancellationBody(cancelled) {
  const shown = cancelled.slice(0, 3).map(event =>
    `${event.summary} (${fmtTime(event.start)}–${fmtTime(event.end)})`
  );

  let body = shown.join(", ");

  if (cancelled.length > shown.length) {
    body += ` en ${cancelled.length - shown.length} meer`;
  }

  return body + (cancelled.length === 1 ? " vervalt." : " vervallen.");
}

function notificationsEnabled() {
  return (
    "Notification" in window &&
    Notification.permission === "granted" &&
    localStorage.getItem("rc-notifications-enabled") === "true"
  );
}

function serverChatPushEnabled() {
  return (
    notificationsEnabled() &&
    localStorage.getItem("rc-notifications-local-only") !== "true" &&
    localStorage.getItem("rc-chat-notifications-enabled") !== "false"
  );
}

async function showCancellationNotification(cancelled) {
  if (!notificationsEnabled() || !("serviceWorker" in navigator)) return;

  const sorted = [...cancelled].sort((a, b) => a.start - b.start);
  const registration =
    serviceWorkerRegistration || await navigator.serviceWorker.ready;

  await registration.showNotification(
    sorted.length === 1 ? "Les vervallen" : `${sorted.length} lessen vervallen`,
    {
      body: cancellationBody(sorted),
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "roostercheck-cancelled",
      renotify: true,
      data: { url: "./" },
      timestamp: Date.now()
    }
  );
}

// PUSHMELDINGEN
function pushSupported() {
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function isIosDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalonePwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  );
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes;
}

async function getServiceWorkerRegistration() {
  if (serviceWorkerRegistration) return serviceWorkerRegistration;

  serviceWorkerRegistration = await navigator.serviceWorker.ready;
  return serviceWorkerRegistration;
}

async function getVapidPublicKey() {
  if (vapidPublicKey) return vapidPublicKey;

  const response = await fetch(VAPID_FUNCTION_URL, {
    headers: {
      apikey: SUPABASE_KEY,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    // Geen JSON-antwoord.
  }

  if (!response.ok || !data || !data.publicKey) {
    throw new Error("Pushmeldingen zijn nog niet geactiveerd.");
  }

  vapidPublicKey = data.publicKey;
  return vapidPublicKey;
}

async function savePushSubscription(subscription) {
  if (!currentUserId) {
    throw new Error("Log eerst in om meldingen aan te zetten.");
  }

  const data = subscription.toJSON();
  const keys = data.keys || {};

  if (!data.endpoint || !keys.p256dh || !keys.auth) {
    throw new Error("De browser gaf geen geldige pushinschrijving terug.");
  }

  const record = {
    user_id: currentUserId,
    endpoint: data.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
    chat_enabled:
      localStorage.getItem("rc-chat-notifications-enabled") !== "false",
    last_seen_at: new Date().toISOString()
  };

  let { error } = await supabaseClient
    .from("push_subscriptions")
    .upsert(record, {
      onConflict: "user_id,endpoint"
    });

  // Blijft werken als de chat_enabled-kolom nog niet bestaat.
  if (error && /chat_enabled|column/i.test(error.message || "")) {
    const { chat_enabled, ...legacyRecord } = record;

    const fallback = await supabaseClient
      .from("push_subscriptions")
      .upsert(legacyRecord, {
        onConflict: "user_id,endpoint"
      });

    error = fallback.error;
  }

  if (error) throw new Error(error.message);
}

async function updateChatPushPreference(enabled) {
  if (
    !currentUserId ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return true;
  }

  let subscription = null;

  try {
    const registration = await getServiceWorkerRegistration();
    subscription = await registration.pushManager.getSubscription();
  } catch (error) {
    console.warn("Pushinschrijving ophalen mislukt.", error);
    return true;
  }

  if (!subscription) return true;

  const { error } = await supabaseClient
    .from("push_subscriptions")
    .update({
      chat_enabled: enabled,
      last_seen_at: new Date().toISOString()
    })
    .eq("user_id", currentUserId)
    .eq("endpoint", subscription.endpoint);

  if (error) {
    if (/chat_enabled|column|schema/i.test(error.message || "")) {
      return false;
    }

    console.warn("Chatmeldingen bijwerken mislukt.", error);
    return false;
  }

  return true;
}

async function enablePushNotifications({ allowLocalOnly = false } = {}) {
  if (!pushSupported()) {
    throw new Error("Deze browser ondersteunt geen pushmeldingen.");
  }

  if (isIosDevice() && !isStandalonePwa()) {
    throw new Error(
      "Zet Roostercheck eerst op je beginscherm en open de app daar. Daarna kun je meldingen aanzetten."
    );
  }

  let permission = Notification.permission;

  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    const error = new Error("Meldingen zijn niet toegestaan.");
    error.code = "permission";
    throw error;
  }

  const registration = await getServiceWorkerRegistration();
  let publicKey;

  try {
    publicKey = await getVapidPublicKey();
  } catch (error) {
    if (!allowLocalOnly) throw error;

    // De server is nog niet ingesteld. Laat meldingen wel werken
    // zolang Roostercheck open staat.
    localStorage.setItem("rc-notifications-local-only", "true");
    return null;
  }

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  await savePushSubscription(subscription);
  localStorage.removeItem("rc-notifications-local-only");
  return subscription;
}

async function disablePushNotifications() {
  if (!("serviceWorker" in navigator)) return;

  localStorage.removeItem("rc-notifications-local-only");

  try {
    const registration = await getServiceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) return;

    if (currentUserId) {
      await supabaseClient
        .from("push_subscriptions")
        .delete()
        .eq("user_id", currentUserId)
        .eq("endpoint", subscription.endpoint);
    }

    await subscription.unsubscribe();
  } catch (error) {
    console.warn("Pushmeldingen uitzetten mislukt.", error);
  }
}

async function syncPushNotifications() {
  if (
    !currentUserId ||
    !pushSupported() ||
    Notification.permission !== "granted" ||
    localStorage.getItem("rc-notifications-enabled") !== "true"
  ) {
    return;
  }

  try {
    const registration = await getServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await enablePushNotifications({ allowLocalOnly: true });
    } else {
      await savePushSubscription(subscription);
      localStorage.removeItem("rc-notifications-local-only");
    }
  } catch (error) {
    if (/nog niet geactiveerd|not found|404/i.test(error.message || "")) {
      localStorage.setItem("rc-notifications-local-only", "true");
      updateNotificationUI();
    }

    console.warn("Pushmeldingen synchroniseren mislukt.", error);
  }
}

function notificationErrorMessage(error) {
  const message = (error && error.message) || "Onbekende fout.";

  if (
    (error && error.code === "permission") ||
    /permission|denied|notallowed/i.test(message)
  ) {
    return "Meldingen zijn geblokkeerd. Pas dit aan in je browserinstellingen.";
  }

  if (/beginscherm|home screen/i.test(message)) {
    return message;
  }

  if (/nog niet geactiveerd/i.test(message)) {
    return "Meldingen zijn nog niet geactiveerd op de server. Neem contact op met de beheerder.";
  }

  if (/push_subscriptions|relation|schema|does not exist/i.test(message)) {
    return "De meldingen-database is nog niet ingesteld. Voer supabase/schema.sql uit.";
  }

  return "Meldingen aanzetten mislukt: " + message;
}

function updateNotificationUI(message = "") {
  const toggle = $("notificationsToggle");
  const testButton = $("testNotificationBtn");
  const status = $("notificationStatus");

  if (!pushSupported()) {
    toggle.disabled = true;
    toggle.checked = false;
    testButton.disabled = true;
    status.textContent = isIosDevice() && !isStandalonePwa()
      ? "Op iPhone en iPad moet je Roostercheck eerst op je beginscherm zetten en daar openen."
      : "Deze browser ondersteunt geen pushmeldingen. Gebruik een recente browser of installeer de app.";
    return;
  }

  toggle.disabled = false;

  const enabled = notificationsEnabled();
  const localOnly =
    localStorage.getItem("rc-notifications-local-only") === "true";

  toggle.checked = enabled;
  testButton.disabled = !enabled;

  if (message) {
    status.textContent = message;
  } else if (enabled && localOnly) {
    status.textContent =
      "Meldingen staan aan zolang Roostercheck open is. Voor meldingen als de app dicht is, moet de server nog worden ingesteld.";
  } else if (enabled) {
    status.textContent =
      "Meldingen staan aan! Je krijgt direct bericht als er een les vervalt. 🔔";
  } else if (Notification.permission === "denied") {
    status.textContent =
      "Meldingen zijn geblokkeerd. Je kunt dit aanpassen in je browserinstellingen.";
  } else if (isIosDevice() && !isStandalonePwa()) {
    status.textContent =
      "Op iPhone en iPad moet je Roostercheck eerst op je beginscherm zetten en daar openen.";
  } else {
    status.textContent =
      "Meldingen staan uit. Zet ze aan om te horen wanneer een les vervalt.";
  }
}

$("notificationsToggle").addEventListener("change", async e => {
  const toggle = e.target;
  const status = $("notificationStatus");

  toggle.disabled = true;

  try {
    if (!toggle.checked) {
      status.textContent = "Meldingen uitzetten...";
      localStorage.setItem("rc-notifications-enabled", "false");
      await disablePushNotifications();
      updateNotificationUI();
    } else {
      status.textContent = "Meldingen aanzetten...";
      await enablePushNotifications({ allowLocalOnly: true });
      localStorage.setItem("rc-notifications-enabled", "true");
      updateNotificationUI();
    }
  } catch (error) {
    console.error(error);
    localStorage.setItem("rc-notifications-enabled", "false");
    toggle.checked = false;
    updateNotificationUI(notificationErrorMessage(error));
  } finally {
    toggle.disabled = false;
  }
});

$("testNotificationBtn").addEventListener("click", async () => {
  const status = $("notificationStatus");

  if (!notificationsEnabled()) {
    status.textContent = "Schakel eerst meldingen in.";
    updateNotificationUI();
    return;
  }

  try {
    const registration = await getServiceWorkerRegistration();

    await registration.showNotification("Roostercheck", {
      body: "Dit is een testmelding! Je meldingen werken. 🎉",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "roostercheck-test",
      data: { url: "./" }
    });

    status.textContent = "Testmelding verstuurd! 🎉";
  } catch (error) {
    status.textContent = "Testmelding mislukt: " + error.message;
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data && event.data.type === "push-subscription-change") {
      syncPushNotifications().catch(console.error);
    }

    if (event.data && event.data.type === "open-url" && event.data.url) {
      const target = new URL(event.data.url, location.href);

      if (target.origin === location.origin) {
        if (target.hash) {
          location.hash = target.hash;
        } else if (target.pathname !== location.pathname) {
          location.href = target.href;
        }
      }
    }
  });
}

updateNotificationUI();

// ============================================================
// WEERGAVEN, PROFIEL EN AANWEZIGHEID
// ============================================================
function setAppView(view) {
  currentView = view;

  ["rooster", "chat", "presence", "settings"].forEach(name => {
    const viewElement = $(name + "View");
    if (viewElement) viewElement.hidden = name !== view;
  });

  document.querySelectorAll(".nav-item").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  if (view === "chat") {
    loadChatOverview()
      .then(() => {
        if (currentView === "chat" && activeChatId) {
          return openChat(activeChatId, { fromUrl: true });
        }
      })
      .catch(console.error);
  }

  if (view === "presence") {
    loadAllProfiles().catch(console.error);
  }

  if (view === "settings") {
    renderProfileSettings();
  }

  if (view !== "chat" && location.hash.startsWith("#chat=")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function openModal(id) {
  $(id).hidden = false;
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  $(id).hidden = true;

  if (!document.querySelector(".modal:not([hidden])")) {
    document.body.classList.remove("modal-open");
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal").forEach(modal => {
    modal.hidden = true;
  });

  document.body.classList.remove("modal-open");
}

function showToast(message, tone = "") {
  const toast = $("toast");

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast" + (tone ? " " + tone : "");
  toast.hidden = false;

  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3800);
}

function debounce(fn, delay = 250) {
  let timer;

  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function displayNameFromEmail(email) {
  const local = String(email || "")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();

  if (!local) return "Leerling";

  return local
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .slice(0, 40);
}

function aliasFor(userId) {
  if (!userId || userId === currentUserId) return "";
  return contactAliases.get(userId) || "";
}

function realNameOf(userId) {
  const profile = profilesById.get(userId);
  return profile && profile.display_name
    ? profile.display_name
    : "Onbekende gebruiker";
}

function displayNameOf(userId) {
  return aliasFor(userId) || realNameOf(userId);
}

function matchingAliasIds(query) {
  const clean = query.trim().toLowerCase();

  if (!clean) return [];

  return [...contactAliases.entries()]
    .filter(([userId, alias]) =>
      userId !== currentUserId && alias.toLowerCase().includes(clean)
    )
    .map(([userId]) => userId);
}

function mergeProfileResults(primary, extra) {
  const byId = new Map();

  [...(primary || []), ...(extra || [])].forEach(profile => {
    if (profile && profile.user_id !== currentUserId) {
      byId.set(profile.user_id, profile);
    }
  });

  return [...byId.values()].sort((a, b) => {
    const nameA = aliasFor(a.user_id) || a.display_name || "";
    const nameB = aliasFor(b.user_id) || b.display_name || "";
    return nameA.localeCompare(nameB, "nl");
  });
}

async function loadContactAliases() {
  if (!currentUserId) return;

  const { data, error } = await supabaseClient
    .from("contact_aliases")
    .select("contact_id, alias")
    .eq("owner_id", currentUserId);

  if (error) {
    aliasesAvailable = false;

    if (!/relation|does not exist|schema/i.test(error.message || "")) {
      console.warn("Aliassen laden mislukt.", error);
    }
    return;
  }

  aliasesAvailable = true;
  contactAliases = new Map(
    (data || []).map(row => [row.contact_id, row.alias])
  );
}

function initialsOf(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "?";

  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : ""))
    .toUpperCase();
}

function createAvatar(name, extraClass = "") {
  const avatar = document.createElement("div");
  avatar.className = "avatar" + (extraClass ? " " + extraClass : "");
  avatar.textContent = initialsOf(name);
  avatar.setAttribute("aria-hidden", "true");
  return avatar;
}

async function ensureProfileLoaded(userId) {
  if (!userId || loadedProfileUserId === userId) return currentProfile;

  loadedProfileUserId = userId;

  let { data, error } = await supabaseClient
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Profiel laden mislukt.", error);
    loadedProfileUserId = null;
    return null;
  }

  if (!data) {
    const fallbackName = displayNameFromEmail(currentUserEmail);
    const inserted = await supabaseClient
      .from("profiles")
      .insert({ user_id: userId, display_name: fallbackName })
      .select(PROFILE_COLUMNS)
      .single();

    if (inserted.error) {
      // Een auth-trigger kan het profiel net hebben aangemaakt.
      const retry = await supabaseClient
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();

      data = retry.data;

      if (!data) {
        console.warn("Profiel aanmaken mislukt.", inserted.error);
        loadedProfileUserId = null;
        return null;
      }
    } else {
      data = inserted.data;
    }
  }

  if (userId !== currentUserId) return null;

  currentProfile = data;
  profilesById.set(userId, data);
  renderProfileSettings();
  renderSelfPresence();
  publishPresence({ force: true }).catch(console.error);

  return currentProfile;
}

function renderProfileSettings() {
  if (!currentProfile) return;

  if (document.activeElement !== $("displayNameInput")) {
    $("displayNameInput").value = currentProfile.display_name || "";
  }
}

async function saveDisplayName(event) {
  event.preventDefault();

  if (!currentUserId || !currentProfile) return;

  const name = $("displayNameInput").value.trim().slice(0, 40);

  if (!name) {
    showToast("Vul eerst een naam in.", "error");
    return;
  }

  $("saveNameBtn").disabled = true;

  const { error } = await supabaseClient
    .from("profiles")
    .update({
      display_name: name,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", currentUserId);

  $("saveNameBtn").disabled = false;

  if (error) {
    showToast("Naam opslaan mislukt: " + error.message, "error");
    return;
  }

  currentProfile = { ...currentProfile, display_name: name };
  profilesById.set(currentUserId, currentProfile);
  $("nameForm").hidden = true;
  $("editNameBtn").hidden = false;
  renderProfileSettings();
  renderPresence();
  showToast("Je naam is opgeslagen.", "success");
}

async function loadAllProfiles() {
  const userId = currentUserId;
  if (!userId) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .order("display_name", { ascending: true })
    .limit(500);

  if (userId !== currentUserId) return;

  if (error) {
    console.warn("Profielen laden mislukt.", error);
    $("presenceList").innerHTML =
      '<p class="hint">Profielen laden mislukt. Voer supabase/schema.sql uit en probeer opnieuw.</p>';
    return;
  }

  allProfiles = data || [];

  allProfiles.forEach(profile => {
    profilesById.set(profile.user_id, profile);
  });

  const ownProfile = profilesById.get(userId);
  if (ownProfile) currentProfile = ownProfile;

  renderPresence();
  renderConversations();

  const activeRoom = getActiveRoom();
  if (activeRoom) renderChatHeader(activeRoom);
}

function isRecentlySeen(profile) {
  if (!profile || !profile.last_seen_at) return false;

  const seen = new Date(profile.last_seen_at).getTime();

  return !isNaN(seen) && Date.now() - seen < 5 * 60 * 1000;
}

function relativeSeen(value) {
  if (!value) return "nog niet gezien";

  const diff = Date.now() - new Date(value).getTime();

  if (isNaN(diff) || diff < 0) return "net gezien";
  if (diff < 60 * 1000) return "net gezien";
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.round(diff / 60000))} min geleden`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.round(diff / 3600000)} uur geleden`;

  return new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short"
  });
}

function presenceInfo(profile) {
  if (!profile) {
    return { label: "OFFLINE", cls: "offline", detail: "Nog geen profiel" };
  }

  if (!isRecentlySeen(profile)) {
    return {
      label: "OFFLINE",
      cls: "offline",
      detail: profile.last_seen_at
        ? "Laatst gezien " + relativeSeen(profile.last_seen_at)
        : "Nog niet online geweest"
    };
  }

  const status = STATUS_LABELS[profile.status] ? profile.status : "vrij";
  const parts = [];

  if (profile.status_detail) parts.push(profile.status_detail);
  if (profile.status_location) parts.push(profile.status_location);

  if (profile.status_until) {
    const until = new Date(profile.status_until);
    if (!isNaN(until.getTime())) parts.push("tot " + fmtTime(until));
  }

  return {
    label: STATUS_LABELS[status],
    cls: status,
    detail: parts.join(" · ") || "Status onbekend"
  };
}

function computePresence(now = new Date()) {
  const todays = events
    .filter(event => sameDay(event.start, now))
    .sort((a, b) => a.start - b.start);

  if (!todays.length) {
    return { status: "vrij", detail: "Geen lessen vandaag", location: "", until: null };
  }

  const current = todays.find(event => event.start <= now && event.end > now);

  if (current) {
    if (current.cancelled) {
      return {
        status: "tussenuur",
        detail: (current.summary || "Les") + " vervalt",
        location: current.location || "",
        until: current.end
      };
    }

    const summary = (current.summary || "").toLowerCase();

    if (/pauze|break|lunch/.test(summary)) {
      return {
        status: "pauze",
        detail: current.summary || "Pauze",
        location: current.location || "",
        until: current.end
      };
    }

    if (/tussenuur|tussen\s*uur/.test(summary)) {
      return {
        status: "tussenuur",
        detail: current.summary || "Tussenuur",
        location: current.location || "",
        until: current.end
      };
    }

    return {
      status: "in_les",
      detail: current.summary || "Les",
      location: current.location || "",
      until: current.end
    };
  }

  const first = todays[0];
  const last = todays[todays.length - 1];

  if (now < first.start) {
    const minutes = (first.start - now) / 60000;

    return {
      status: minutes <= 30 ? "pauze" : "vrij",
      detail: minutes <= 30 ? "Eerste les" : "Voor schooltijd",
      location: "",
      until: first.start
    };
  }

  if (now >= last.end) {
    return { status: "vrij", detail: "Klaar voor vandaag", location: "", until: null };
  }

  const nextActive = todays.find(event => event.start > now && !event.cancelled);

  if (nextActive) {
    const minutes = (nextActive.start - now) / 60000;

    return {
      status: minutes <= 30 ? "pauze" : "tussenuur",
      detail: minutes <= 30 ? "Pauze" : "Tussenuur",
      location: "",
      until: nextActive.start
    };
  }

  return {
    status: "tussenuur",
    detail: "Tussenuur",
    location: "",
    until: last.end
  };
}

function presenceTextForSelf(info) {
  const parts = [info.detail];

  if (info.location) parts.push(info.location);
  if (info.until) parts.push("tot " + fmtTime(info.until));

  return parts.filter(Boolean).join(" · ");
}

function renderSelfPresence() {
  const info = computePresence();
  const name = currentProfile ? currentProfile.display_name : displayNameFromEmail(currentUserEmail);

  $("selfAvatar").textContent = initialsOf(name);
  $("selfPresenceStatus").textContent = STATUS_LABELS[info.status] || "VRIJ";
  $("selfPresenceDetail").textContent = presenceTextForSelf(info);

  const badge = $("selfPresenceBadge");
  badge.textContent = STATUS_LABELS[info.status] || "VRIJ";
  badge.className = "status-badge " + info.status;
}

function renderPresence() {
  renderSelfPresence();

  const list = $("presenceList");
  const query = presenceSearchTerm.trim().toLowerCase();
  const others = allProfiles
    .filter(profile => profile.user_id !== currentUserId)
    .filter(profile => {
      if (!query) return true;

      const searchText = [
        profile.display_name,
        aliasFor(profile.user_id)
      ].filter(Boolean).join(" ").toLowerCase();

      return searchText.includes(query);
    });

  const statusRank = {
    in_les: 0,
    tussenuur: 1,
    pauze: 2,
    vrij: 3,
    offline: 4
  };

  others.sort((a, b) => {
    const infoA = presenceInfo(a);
    const infoB = presenceInfo(b);
    const rank = (statusRank[infoA.cls] ?? 9) - (statusRank[infoB.cls] ?? 9);

    if (rank !== 0) return rank;

    return displayNameOf(a.user_id).localeCompare(displayNameOf(b.user_id), "nl");
  });

  list.innerHTML = "";

  if (!others.length) {
    list.innerHTML = query
      ? '<p class="hint">Niemand gevonden met deze naam.</p>'
      : '<p class="hint">Nog niemand om te laten zien. Nodig iemand uit voor een chat!</p>';
    return;
  }

  others.forEach(profile => {
    const info = presenceInfo(profile);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "presence-person";
    row.title = "Chat met " + displayNameOf(profile.user_id);

    const avatar = createAvatar(displayNameOf(profile.user_id));
    const content = document.createElement("span");
    content.className = "presence-info";

    const name = document.createElement("span");
    name.className = "presence-name";
    name.textContent = displayNameOf(profile.user_id);

    const detail = document.createElement("span");
    detail.className = "presence-detail";
    detail.textContent = info.detail;

    content.append(name, detail);

    const statusWrap = document.createElement("span");
    statusWrap.className = "presence-status-wrap";

    const badge = document.createElement("span");
    badge.className = "status-badge " + info.cls;
    badge.textContent = info.label;

    statusWrap.append(badge);

    if (info.cls === "offline" && profile.last_seen_at) {
      const seen = document.createElement("span");
      seen.className = "presence-seen";
      seen.textContent = relativeSeen(profile.last_seen_at);
      statusWrap.append(seen);
    }

    row.append(avatar, content, statusWrap);
    row.addEventListener("click", () => {
      beginDirectChat(profile.user_id).catch(console.error);
    });

    list.append(row);
  });

  $("presenceUpdated").textContent =
    "Bijgewerkt om " + fmtTime(new Date()) + " · status komt automatisch uit het rooster";
}

function schedulePresencePublish() {
  clearTimeout(presencePublishTimer);
  presencePublishTimer = setTimeout(() => {
    publishPresence({ force: true }).catch(console.error);
  }, 700);
}

async function publishPresence({ force = false } = {}) {
  if (!currentUserId || !currentProfile) return;
  if (!force && document.visibilityState !== "visible") return;

  const info = computePresence();
  const now = new Date().toISOString();

  const payload = {
    status: info.status,
    status_detail: info.detail || null,
    status_location: info.location || null,
    status_until: info.until ? info.until.toISOString() : null,
    status_updated_at: now,
    last_seen_at: now,
    updated_at: now
  };

  const { error } = await supabaseClient
    .from("profiles")
    .update(payload)
    .eq("user_id", currentUserId);

  if (error) {
    if (!/relation|does not exist|schema/i.test(error.message || "")) {
      console.warn("Status bijwerken mislukt.", error);
    }
    return;
  }

  currentProfile = { ...currentProfile, ...payload };
  profilesById.set(currentUserId, currentProfile);
  renderSelfPresence();
}

function startPresenceHeartbeat() {
  clearInterval(presenceHeartbeat);

  publishPresence({ force: true }).catch(console.error);

  presenceHeartbeat = setInterval(() => {
    if (document.visibilityState !== "visible" || !currentUserId) return;

    publishPresence().catch(console.error);

    if (currentView === "presence") {
      loadAllProfiles().catch(console.error);
    }
  }, 60 * 1000);
}

// ============================================================
// CHAT: OVERZICHT EN BERICHTEN
// ============================================================
async function startChatSession() {
  const userId = currentUserId;

  if (!userId || chatSessionUserId === userId) return;

  chatSessionUserId = userId;

  try {
    await ensureProfileLoaded(userId);
  } catch (error) {
    console.warn("Profiel starten mislukt.", error);
  }

  if (userId !== currentUserId) return;

  try {
    await loadContactAliases();
  } catch (error) {
    console.warn("Aliassen starten mislukt.", error);
  }

  if (userId !== currentUserId) return;

  updateChatPushPreference(
    localStorage.getItem("rc-chat-notifications-enabled") !== "false"
  ).catch(console.error);

  try {
    await loadChatOverview();
  } catch (error) {
    console.warn("Chats starten mislukt.", error);
  }

  if (userId !== currentUserId) return;

  initChatRealtime();
  startPresenceHeartbeat();
  handleUrlActions();
}

function resetChatState() {
  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }

  clearInterval(presenceHeartbeat);
  presenceHeartbeat = null;
  clearTimeout(presencePublishTimer);
  presencePublishTimer = null;

  currentProfile = null;
  loadedProfileUserId = null;
  chatSessionUserId = null;
  profilesById = new Map();
  contactAliases = new Map();
  aliasesAvailable = false;
  aliasTargetId = null;
  allProfiles = [];
  chatRooms = [];
  activeChatId = null;
  activeChatMessages = [];
  chatLoadPromise = null;
  chatSearchTerm = "";
  presenceSearchTerm = "";

  closeAllModals();
  closeChatRoom();

  $("conversationList").innerHTML = "";
  $("presenceList").innerHTML = "";
  $("chatSearch").value = "";
  $("presenceSearch").value = "";
  $("displayNameInput").value = "";
  $("chatSummary").textContent = "Nog geen gesprekken";
  $("chatListStatus").textContent = "";
  $("presenceUpdated").textContent = "";
  $("chatNavBadge").hidden = true;
  document.title = "Roostercheck";

  setAppView("rooster");
}

async function ensureProfilesFor(userIds) {
  const missing = [...new Set(userIds)]
    .filter(userId => userId && !profilesById.has(userId));

  if (!missing.length) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .in("user_id", missing);

  if (error) {
    console.warn("Profielen voor chat laden mislukt.", error);
    return;
  }

  (data || []).forEach(profile => {
    profilesById.set(profile.user_id, profile);
  });
}

function loadChatOverview() {
  if (!currentUserId) return Promise.resolve();

  if (chatLoadPromise) return chatLoadPromise;

  const userId = currentUserId;

  chatLoadPromise = (async () => {
    $("chatListStatus").textContent = "Chats laden...";

    let membershipResult = await supabaseClient
      .from("chat_members")
      .select("room_id, role, unread_count, last_read_at, hidden_at")
      .eq("user_id", userId);

    // Blijft werken als de nieuwe verberg-update nog niet is uitgevoerd.
    if (
      membershipResult.error &&
      /hidden_at/i.test(membershipResult.error.message || "")
    ) {
      membershipResult = await supabaseClient
        .from("chat_members")
        .select("room_id, role, unread_count, last_read_at")
        .eq("user_id", userId);
    }

    const memberships = membershipResult.data || [];
    const membershipError = membershipResult.error;

    if (userId !== currentUserId) return;

    if (membershipError) {
      $("chatListStatus").textContent =
        "Chats laden mislukt. Voer supabase/schema.sql uit.";
      console.warn(membershipError);
      return;
    }

    const visibleMemberships = memberships.filter(
      member => !member.hidden_at
    );

    if (!visibleMemberships.length) {
      chatRooms = [];
      renderConversations();
      updateChatBadge();
      $("chatListStatus").textContent = "";

      if (activeChatId) closeChatRoom();
      return;
    }

    const roomIds = visibleMemberships.map(member => member.room_id);

    const membersPromise = supabaseClient
      .from("chat_members")
      .select("room_id, user_id, role, joined_at")
      .in("room_id", roomIds);

    let roomsResult = await supabaseClient
      .from("chat_rooms")
      .select(
        "id, kind, name, invite_code, created_by, last_message_at, last_message_preview, last_sender_id, last_sender_name, created_at"
      )
      .in("id", roomIds);

    // Blijft werken als de nieuwe aliassen-update nog niet is uitgevoerd.
    if (
      roomsResult.error &&
      /last_sender_id/i.test(roomsResult.error.message || "")
    ) {
      roomsResult = await supabaseClient
        .from("chat_rooms")
        .select(
          "id, kind, name, invite_code, created_by, last_message_at, last_message_preview, last_sender_name, created_at"
        )
        .in("id", roomIds);
    }

    const membersResult = await membersPromise;

    if (userId !== currentUserId) return;

    if (roomsResult.error || membersResult.error) {
      $("chatListStatus").textContent =
        "Chats laden mislukt. Probeer het opnieuw.";
      console.warn(roomsResult.error || membersResult.error);
      return;
    }

    const membershipByRoom = new Map(
      visibleMemberships.map(member => [member.room_id, member])
    );

    const allMembers = membersResult.data || [];

    await ensureProfilesFor(allMembers.map(member => member.user_id));

    if (userId !== currentUserId) return;

    chatRooms = (roomsResult.data || [])
      .map(room => {
        const members = allMembers
          .filter(member => member.room_id === room.id)
          .map(member => ({
            ...member,
            profile: profilesById.get(member.user_id) || null
          }));

        const mine = membershipByRoom.get(room.id);
        const otherMember =
          room.kind === "direct"
            ? members.find(member => member.user_id !== userId)
            : null;
        const otherProfile = otherMember
          ? otherMember.profile
          : null;

        return {
          ...room,
          members,
          my_role: mine ? mine.role : "member",
          unread_count: mine ? mine.unread_count : 0,
          title:
            room.kind === "group"
              ? room.name || "Groep"
              : otherMember
                ? displayNameOf(otherMember.user_id)
                : "Onbekende gebruiker",
          otherProfile
        };
      })
      .sort((a, b) => {
        const aTime = new Date(a.last_message_at || a.created_at).getTime();
        const bTime = new Date(b.last_message_at || b.created_at).getTime();

        return bTime - aTime;
      });

    renderConversations();
    updateChatBadge();
    $("chatListStatus").textContent = "";

    const activeRoom = getActiveRoom();

    if (activeChatId && !activeRoom) {
      closeChatRoom();
    } else if (activeRoom) {
      renderChatHeader(activeRoom);
    }
  })().finally(() => {
    chatLoadPromise = null;
  });

  return chatLoadPromise;
}

function getActiveRoom() {
  return chatRooms.find(room => room.id === activeChatId) || null;
}

function renderConversations() {
  const list = $("conversationList");
  const query = chatSearchTerm.trim().toLowerCase();

  list.innerHTML = "";

  const visibleRooms = chatRooms.filter(room => {
    if (!query) return true;

    const names = [
      room.title,
      room.kind === "direct" && room.otherProfile
        ? room.otherProfile.display_name
        : ""
    ];

    return names
      .filter(Boolean)
      .some(name => name.toLowerCase().includes(query));
  });

  const unread = chatRooms.reduce(
    (total, room) => total + (room.unread_count || 0),
    0
  );

  $("chatSummary").textContent = chatRooms.length
    ? `${chatRooms.length} gesprek${chatRooms.length === 1 ? "" : "ken"}${
        unread ? ` · ${unread} ongelezen` : ""
      }`
    : "Nog geen gesprekken";

  if (!visibleRooms.length) {
    list.innerHTML = chatRooms.length
      ? '<p class="hint" style="padding:10px;">Geen chats gevonden.</p>'
      : '<p class="hint" style="padding:10px;">Nog geen chats. Tik op + om te beginnen.</p>';
    return;
  }

  visibleRooms.forEach(room => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation" + (room.id === activeChatId ? " active" : "");

    const avatar = createAvatar(
      room.kind === "group" ? room.title : room.title,
      room.kind === "group" ? "group" : ""
    );

    const main = document.createElement("span");
    main.className = "conversation-main";

    const name = document.createElement("span");
    name.className = "conversation-name";
    name.textContent = room.title;

    const preview = document.createElement("span");
    preview.className = "conversation-preview";

    if (room.last_message_preview) {
      const lastSender =
        room.kind === "group" &&
        room.last_sender_id &&
        (profilesById.has(room.last_sender_id) || aliasFor(room.last_sender_id))
          ? displayNameOf(room.last_sender_id)
          : room.last_sender_name;

      preview.textContent =
        (room.kind === "group" && lastSender
          ? lastSender + ": "
          : "") + room.last_message_preview;
    } else {
      preview.textContent =
        room.kind === "group"
          ? "Nieuwe groep · nodig mensen uit"
          : "Nog geen berichten";
    }

    main.append(name, preview);

    const side = document.createElement("span");
    side.className = "conversation-side";

    const time = document.createElement("span");
    time.className = "conversation-time";
    time.textContent = formatChatListTime(
      room.last_message_at || room.created_at
    );

    side.append(time);

    if (room.unread_count > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      badge.textContent = room.unread_count > 99 ? "99+" : room.unread_count;
      side.append(badge);
    }

    button.append(avatar, main, side);
    button.addEventListener("click", () => {
      openChat(room.id).catch(console.error);
    });

    list.append(button);
  });
}

function formatChatListTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (isNaN(date.getTime())) return "";

  if (sameDay(date, new Date())) {
    return fmtTime(date);
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (sameDay(date, yesterday)) return "Gisteren";

  if (Date.now() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString("nl-NL", {
      weekday: "short",
      timeZone: "Europe/Amsterdam"
    });
  }

  return date.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam"
  });
}

function updateChatBadge() {
  const total = chatRooms.reduce(
    (sum, room) => sum + (room.unread_count || 0),
    0
  );

  const badge = $("chatNavBadge");
  badge.textContent = total > 99 ? "99+" : String(total);
  badge.hidden = total === 0;

  document.title = total ? `(${total}) Roostercheck` : "Roostercheck";
}

async function openChat(roomId, { fromUrl = false } = {}) {
  if (!currentUserId || !roomId) return;

  let room = chatRooms.find(item => item.id === roomId);

  if (!room) {
    await loadChatOverview();
    room = chatRooms.find(item => item.id === roomId);
  }

  if (!room) {
    showToast("Deze chat is niet gevonden of je bent geen lid meer.", "error");
    return;
  }

  if (activeChatId !== room.id) {
    $("chatInput").value = "";
    $("chatInput").style.height = "";
  }

  activeChatId = room.id;
  activeChatMessages = [];

  $("chatEmpty").hidden = true;
  $("chatRoom").hidden = false;
  $("chatShell").classList.add("chat-open");
  $("chatMessages").innerHTML = '<p class="chat-intro">Berichten laden...</p>';

  renderChatHeader(room);
  renderConversations();

  if (!fromUrl) {
    const url = new URL(location.href);
    url.hash = "chat=" + roomId;
    history.replaceState(null, "", url);
  }

  const { data, error } = await supabaseClient
    .from("chat_messages")
    .select("id, room_id, sender_id, sender_name, body, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);

  if (activeChatId !== roomId) return;

  if (error) {
    $("chatMessages").innerHTML =
      '<p class="chat-intro">Berichten laden mislukt. Probeer het opnieuw.</p>';
    console.warn(error);
    return;
  }

  activeChatMessages = (data || []).reverse();

  renderChatMessages();
  markChatRead(roomId).catch(console.error);
}

function closeChatRoom() {
  activeChatId = null;
  activeChatMessages = [];
  $("chatEmpty").hidden = false;
  $("chatRoom").hidden = true;
  $("chatShell").classList.remove("chat-open");
  $("chatMessages").innerHTML = "";

  if (location.hash.startsWith("#chat=")) {
    history.replaceState(null, "", location.pathname + location.search);
  }

  renderConversations();
}

function renderChatHeader(room) {
  $("chatRoomName").textContent = room.title;
  $("chatAliasBtn").hidden = room.kind !== "direct" || !aliasesAvailable;

  if (room.kind === "group") {
    const online = room.members.filter(member =>
      isRecentlySeen(member.profile)
    ).length;

    $("chatRoomMeta").textContent =
      `${room.members.length} ${room.members.length === 1 ? "lid" : "leden"}` +
      (online ? ` · ${online} online` : "");
    return;
  }

  const other = room.members.find(member => member.user_id !== currentUserId);
  const profile = other ? other.profile : null;

  if (!profile) {
    $("chatRoomMeta").textContent = "Privéchat";
    return;
  }

  const info = presenceInfo(profile);
  $("chatRoomMeta").textContent = `${info.label} · ${info.detail}`;
}

function renderChatMessages() {
  const area = $("chatMessages");
  const room = getActiveRoom();

  area.innerHTML = "";

  if (!activeChatMessages.length) {
    area.innerHTML =
      '<p class="chat-intro">Nog geen berichten. Zeg hallo 👋</p>';
    return;
  }

  let lastDateKey = "";

  activeChatMessages.forEach(message => {
    const date = new Date(message.created_at);
    const dateKey = date.toLocaleDateString("en-CA", {
      timeZone: "Europe/Amsterdam"
    });

    if (dateKey !== lastDateKey) {
      const separator = document.createElement("div");
      separator.className = "date-separator";
      separator.textContent = chatDateLabel(date);
      area.append(separator);
      lastDateKey = dateKey;
    }

    const own = message.sender_id === currentUserId;
    const wrapper = document.createElement("div");
    wrapper.className = "message" + (own ? " own" : "");

    if (!own && room && room.kind === "group") {
      const sender = document.createElement("div");
      sender.className = "message-sender";
      sender.textContent =
        aliasFor(message.sender_id) ||
        (profilesById.get(message.sender_id) || {}).display_name ||
        message.sender_name ||
        "Onbekend";
      wrapper.append(sender);
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = message.body;

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = fmtTime(date);

    wrapper.append(bubble, time);
    area.append(wrapper);
  });

  scrollChatToBottom();
}

function chatDateLabel(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (sameDay(date, today)) return "Vandaag";
  if (sameDay(date, yesterday)) return "Gisteren";

  return date.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam"
  });
}

function scrollChatToBottom() {
  const area = $("chatMessages");
  area.scrollTop = area.scrollHeight;
}

async function markChatRead(roomId) {
  if (!roomId || !currentUserId) return;

  const room = chatRooms.find(item => item.id === roomId);

  if (room) room.unread_count = 0;

  renderConversations();
  updateChatBadge();

  const { error } = await supabaseClient.rpc("mark_chat_read", {
    target_room: roomId
  });

  if (error) {
    console.warn("Leesstatus bijwerken mislukt.", error);
  }
}

async function sendChatMessage() {
  const input = $("chatInput");
  const body = input.value.trim();

  if (!body || !activeChatId || !currentUserId || $("chatSendBtn").disabled) {
    return;
  }

  $("chatSendBtn").disabled = true;

  const roomId = activeChatId;

  const { data, error } = await supabaseClient
    .from("chat_messages")
    .insert({
      room_id: roomId,
      sender_id: currentUserId,
      body
    })
    .select("id, room_id, sender_id, sender_name, body, created_at")
    .single();

  $("chatSendBtn").disabled = false;

  if (error) {
    showToast("Bericht versturen mislukt: " + error.message, "error");
    return;
  }

  input.value = "";
  input.style.height = "";

  if (activeChatId === roomId) {
    if (!activeChatMessages.some(message => message.id === data.id)) {
      activeChatMessages.push(data);
      renderChatMessages();
    }

    markChatRead(roomId).catch(console.error);
  }

  applyMessageToRoom(data, false);
}

function applyMessageToRoom(message, countUnreadForOthers) {
  const room = chatRooms.find(item => item.id === message.room_id);

  if (!room) return false;

  room.last_message_at = message.created_at;
  room.last_message_preview = message.body.slice(0, 140);
  room.last_sender_id = message.sender_id;
  room.last_sender_name = message.sender_name;

  if (
    countUnreadForOthers &&
    message.sender_id !== currentUserId &&
    activeChatId !== message.room_id
  ) {
    room.unread_count = (room.unread_count || 0) + 1;
  }

  chatRooms.sort((a, b) => {
    const aTime = new Date(a.last_message_at || a.created_at).getTime();
    const bTime = new Date(b.last_message_at || b.created_at).getTime();
    return bTime - aTime;
  });

  renderConversations();
  updateChatBadge();

  return true;
}

function handleIncomingMessage(message) {
  if (!message || !currentUserId) return;

  const own = message.sender_id === currentUserId;
  const active =
    activeChatId === message.room_id &&
    currentView === "chat" &&
    document.visibilityState === "visible";

  if (active) {
    if (!activeChatMessages.some(item => item.id === message.id)) {
      activeChatMessages.push(message);
      renderChatMessages();
    }

    if (!own) markChatRead(message.room_id).catch(console.error);
  }

  const roomExists = applyMessageToRoom(message, !active && !own);

  if (!roomExists) {
    loadChatOverview().catch(console.error);
  }

  if (!own && !active) {
    const room = chatRooms.find(item => item.id === message.room_id);
    notifyIncomingMessage(message, room).catch(console.error);
  }
}

function initChatRealtime() {
  if (!currentUserId) return;

  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }

  chatChannel = supabaseClient
    .channel("roostercheck-chat-" + currentUserId)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages"
      },
      payload => {
        handleIncomingMessage(payload.new);
      }
    )
    .subscribe(status => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("Chat-realtime is niet verbonden. Berichten worden bij opening vernieuwd.");
      }
    });
}

async function notifyIncomingMessage(message, room) {
  if (
    localStorage.getItem("rc-chat-notifications-enabled") === "false" ||
    message.sender_id === currentUserId
  ) {
    return;
  }

  const senderDisplayName =
    aliasFor(message.sender_id) ||
    (profilesById.get(message.sender_id) || {}).display_name ||
    message.sender_name ||
    "Iemand";

  const title =
    room && room.kind === "group"
      ? `${senderDisplayName} · ${room.name || "Groep"}`
      : senderDisplayName || "Nieuw chatbericht";

  const body =
    message.body.length > 120
      ? message.body.slice(0, 117) + "..."
      : message.body;

  if (
    document.visibilityState === "hidden" &&
    !serverChatPushEnabled() &&
    "Notification" in window &&
    Notification.permission === "granted" &&
    "serviceWorker" in navigator
  ) {
    try {
      const registration = await getServiceWorkerRegistration();

      await registration.showNotification(title, {
        body,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: "chat-" + message.room_id,
        renotify: true,
        data: { url: "./#chat=" + message.room_id },
        timestamp: Date.now()
      });
      return;
    } catch (error) {
      console.warn("Chatmelding tonen mislukt.", error);
    }
  }

  if (
    document.visibilityState === "visible" &&
    (currentView !== "chat" || activeChatId !== message.room_id)
  ) {
    showToast(`💬 ${title}: ${body}`);
  }
}

function rememberJoinCodeFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = params.get("join") || params.get("code") || "";

  if (code) {
    localStorage.setItem("rc-pending-join", code.trim().toUpperCase());
  }
}

function handleUrlActions() {
  if (!currentUserId) return;

  const params = new URLSearchParams(location.search);
  const code =
    params.get("join") ||
    params.get("code") ||
    localStorage.getItem("rc-pending-join") ||
    "";

  if (code) {
    localStorage.removeItem("rc-pending-join");
    openNewChatModal("join", { code });
    params.delete("join");
    params.delete("code");

    const nextUrl =
      location.pathname +
      (params.toString() ? "?" + params.toString() : "") +
      location.hash;

    history.replaceState(null, "", nextUrl);
  }

  const match = location.hash.match(/^#chat=([0-9a-f-]{36})/i);

  if (match) {
    setAppView("chat");
    openChat(match[1], { fromUrl: true }).catch(console.error);
  }
}

// ============================================================
// CHAT: NIEUWE CHATS, GROEPEN EN UITNODIGINGEN
// ============================================================
function setNewChatStatus(message) {
  $("newChatStatus").textContent = message || "";
}

function setNewChatTab(tab) {
  if (!["person", "group", "join"].includes(tab)) tab = "person";

  newChatTab = tab;

  ["person", "group", "join"].forEach(name => {
    $("newChat" + name[0].toUpperCase() + name.slice(1) + "Pane").hidden =
      name !== tab;
  });

  document.querySelectorAll(".modal-tab").forEach(button => {
    const active = button.dataset.chatTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  setNewChatStatus("");

  if (tab === "person" && !$("peopleResults").children.length) {
    showPeopleSuggestions().catch(console.error);
  }

  if (tab === "group" && !$("groupPeopleResults").children.length) {
    searchGroupPeople("").catch(console.error);
  }

  if (tab === "join") {
    setTimeout(() => $("joinCodeInput").focus(), 80);
  }
}

function openNewChatModal(tab = "person", { code = "" } = {}) {
  groupSelected.clear();
  groupSearchResults = [];
  lastPeopleQuery = "";
  lastGroupQuery = "";
  $("peopleSearch").value = "";
  $("groupPeopleSearch").value = "";
  $("groupName").value = "";
  $("peopleResults").innerHTML = "";
  $("groupPeopleResults").innerHTML = "";
  $("joinCodeInput").value = code ? code.toUpperCase() : "";

  renderGroupSelected();
  openModal("newChatModal");
  setNewChatTab(tab);

  setTimeout(() => {
    if (tab === "person") $("peopleSearch").focus();
    else if (tab === "group") $("groupName").focus();
    else $("joinCodeInput").focus();
  }, 90);
}

async function showPeopleSuggestions() {
  const userId = currentUserId;
  if (!userId) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .neq("user_id", userId)
    .order("display_name", { ascending: true })
    .limit(20);

  if (userId !== currentUserId || $("peopleSearch").value.trim()) return;

  if (error) {
    $("peopleResults").innerHTML =
      '<p class="hint">Mensen laden mislukt. Voer supabase/schema.sql uit.</p>';
    return;
  }

  (data || []).forEach(profile => {
    profilesById.set(profile.user_id, profile);
  });

  renderPeopleResults(data || [], $("peopleResults"), {
    onSelect: profile => beginDirectChat(profile.user_id)
  });
}

async function searchPeople(query) {
  lastPeopleQuery = query;

  const clean = query.trim();

  if (!clean) {
    await showPeopleSuggestions();
    return;
  }

  const aliasIds = matchingAliasIds(clean);

  const [nameResult, aliasResult] = await Promise.all([
    supabaseClient
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .neq("user_id", currentUserId)
      .ilike("display_name", `%${clean}%`)
      .order("display_name", { ascending: true })
      .limit(25),
    aliasIds.length
      ? supabaseClient
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .in("user_id", aliasIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (lastPeopleQuery !== query) return;

  if (nameResult.error || aliasResult.error) {
    $("peopleResults").innerHTML =
      '<p class="hint">Zoeken mislukt. Probeer het opnieuw.</p>';
    return;
  }

  const people = mergeProfileResults(nameResult.data, aliasResult.data);

  people.forEach(profile => {
    profilesById.set(profile.user_id, profile);
  });

  renderPeopleResults(people, $("peopleResults"), {
    onSelect: profile => beginDirectChat(profile.user_id)
  });
}

async function searchGroupPeople(query) {
  lastGroupQuery = query;

  const clean = query.trim();
  let people = [];

  if (clean) {
    const aliasIds = matchingAliasIds(clean);

    const [nameResult, aliasResult] = await Promise.all([
      supabaseClient
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .neq("user_id", currentUserId)
        .ilike("display_name", `%${clean}%`)
        .order("display_name", { ascending: true })
        .limit(30),
      aliasIds.length
        ? supabaseClient
            .from("profiles")
            .select(PROFILE_COLUMNS)
            .in("user_id", aliasIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (lastGroupQuery !== query) return;

    if (nameResult.error || aliasResult.error) {
      $("groupPeopleResults").innerHTML =
        '<p class="hint">Zoeken mislukt. Probeer het opnieuw.</p>';
      return;
    }

    people = mergeProfileResults(nameResult.data, aliasResult.data);
  } else {
    const { data } = await supabaseClient
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .neq("user_id", currentUserId)
      .order("display_name", { ascending: true })
      .limit(25);

    if (lastGroupQuery !== query) return;

    people = data || [];
  }

  (people || []).forEach(profile => {
    profilesById.set(profile.user_id, profile);
  });

  groupSearchResults = people || [];

  renderPeopleResults(groupSearchResults, $("groupPeopleResults"), {
    selectedIds: groupSelected,
    onSelect: profile => toggleGroupMember(profile)
  });
}

function renderPeopleResults(people, container, { selectedIds = null, onSelect } = {}) {
  container.innerHTML = "";

  if (!people.length) {
    container.innerHTML =
      '<p class="hint">Niemand gevonden. Typ een andere naam.</p>';
    return;
  }

  people.forEach(profile => {
    const info = presenceInfo(profile);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "person-result";

    const avatar = createAvatar(profile.display_name);
    const main = document.createElement("span");
    main.className = "person-result-main";

    const alias = aliasFor(profile.user_id);

    const name = document.createElement("span");
    name.className = "person-result-name";
    name.textContent = alias || profile.display_name || "Onbekende gebruiker";

    const meta = document.createElement("span");
    meta.className = "person-result-meta";
    meta.textContent = alias
      ? `${profile.display_name || "Onbekende gebruiker"} · ${info.detail}`
      : info.detail;

    main.append(name, meta);
    button.append(avatar, main);

    if (selectedIds) {
      const selected = selectedIds.has(profile.user_id);
      const check = document.createElement("span");
      check.className = "person-result-check";
      check.textContent = selected ? "✓" : "+";
      button.append(check);
      button.setAttribute("aria-pressed", String(selected));
    } else {
      const arrow = document.createElement("span");
      arrow.className = "person-result-check";
      arrow.textContent = "›";
      button.append(arrow);
    }

    button.addEventListener("click", () => onSelect(profile));
    container.append(button);
  });
}

function toggleGroupMember(profile) {
  if (groupSelected.has(profile.user_id)) {
    groupSelected.delete(profile.user_id);
  } else {
    groupSelected.set(profile.user_id, profile);
  }

  renderGroupSelected();
  renderPeopleResults(groupSearchResults, $("groupPeopleResults"), {
    selectedIds: groupSelected,
    onSelect: item => toggleGroupMember(item)
  });
}

function renderGroupSelected() {
  const container = $("selectedMembers");
  container.innerHTML = "";

  groupSelected.forEach(profile => {
    const chip = document.createElement("span");
    chip.className = "member-chip";
    chip.append(document.createTextNode(profile.display_name));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "Verwijder " + profile.display_name);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      groupSelected.delete(profile.user_id);
      renderGroupSelected();
      renderPeopleResults(groupSearchResults, $("groupPeopleResults"), {
        selectedIds: groupSelected,
        onSelect: item => toggleGroupMember(item)
      });
    });

    chip.append(remove);
    container.append(chip);
  });
}

function describeChatError(error) {
  const message = (error && error.message) || "Onbekende fout.";

  if (/does not exist|schema cache|function.*not found/i.test(message)) {
    return "De chatdatabase is nog niet ingesteld. Voer supabase/schema.sql uit.";
  }

  return message;
}

async function beginDirectChat(userId) {
  if (!userId || userId === currentUserId) return;

  setNewChatStatus("Chat openen...");

  const { data, error } = await supabaseClient.rpc("start_direct_chat", {
    other_user: userId
  });

  if (error) {
    const message = describeChatError(error);
    setNewChatStatus(message);
    showToast(message, "error");
    return;
  }

  closeModal("newChatModal");
  setAppView("chat");
  await loadChatOverview();
  await openChat(data);
}

async function createNewGroup() {
  const name = $("groupName").value.trim();

  if (!name) {
    setNewChatStatus("Geef de groep eerst een naam.");
    $("groupName").focus();
    return;
  }

  if (name.length > 60) {
    setNewChatStatus("De groepsnaam mag maximaal 60 tekens hebben.");
    return;
  }

  $("createGroupBtn").disabled = true;
  setNewChatStatus("Groep maken...");

  const { data, error } = await supabaseClient.rpc("create_group", {
    group_name: name,
    member_ids: [...groupSelected.keys()]
  });

  $("createGroupBtn").disabled = false;

  if (error) {
    const message = describeChatError(error);
    setNewChatStatus(message);
    showToast(message, "error");
    return;
  }

  closeModal("newChatModal");
  setAppView("chat");
  await loadChatOverview();
  await openChat(data);
  showToast("Groep gemaakt! Deel de code met je vrienden.", "success");
  await openChatInfo();
}

async function joinGroupWithCode() {
  const code = $("joinCodeInput").value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (code.length < 4) {
    setNewChatStatus("Vul een geldige groepscode in.");
    $("joinCodeInput").focus();
    return;
  }

  $("joinGroupBtn").disabled = true;
  setNewChatStatus("Deelnemen...");

  const { data, error } = await supabaseClient.rpc("join_group_by_code", {
    code
  });

  $("joinGroupBtn").disabled = false;

  if (error) {
    const message = describeChatError(error);
    setNewChatStatus(message);
    showToast(message, "error");
    return;
  }

  closeModal("newChatModal");
  setAppView("chat");
  await loadChatOverview();
  await openChat(data);
  showToast("Je bent nu lid van de groep!", "success");
}

function getInviteLink(room) {
  if (!room || !room.invite_code) return "";

  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", room.invite_code);

  return url.href;
}

async function copyText(value, promptLabel = "Kopieer de code:") {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Gekopieerd!", "success");
    return true;
  } catch {
    window.prompt(promptLabel, value);
    return false;
  }
}

async function openChatInfo() {
  const room = getActiveRoom();

  if (!room) return;

  const otherMemberForTitle = room.members.find(
    member => member.user_id !== currentUserId
  );

  const { data, error } = await supabaseClient
    .from("chat_members")
    .select("room_id, user_id, role, joined_at")
    .eq("room_id", room.id);

  if (!error && data) {
    await ensureProfilesFor(data.map(member => member.user_id));

    room.members = data.map(member => ({
      ...member,
      profile: profilesById.get(member.user_id) || null
    }));

    const mine = room.members.find(member => member.user_id === currentUserId);
    if (mine) room.my_role = mine.role;
  }

  renderChatHeader(room);

  $("chatInfoTitle").textContent = room.title;
  $("chatInfoMeta").textContent =
    room.kind === "group"
      ? `Groep · ${room.members.length} ${room.members.length === 1 ? "lid" : "leden"}`
      : otherMemberForTitle && aliasFor(otherMemberForTitle.user_id)
        ? `Privéchat · echte naam: ${realNameOf(otherMemberForTitle.user_id)}`
        : "Privéchat";

  const membersArea = $("chatInfoMembers");
  membersArea.innerHTML = "";

  const sortedMembers = [...room.members].sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return displayNameOf(a.user_id).localeCompare(displayNameOf(b.user_id), "nl");
  });

  sortedMembers.forEach(member => {
    const profile = member.profile || profilesById.get(member.user_id);
    const info = presenceInfo(profile);

    const row = document.createElement("div");
    row.className = "info-member";

    const avatar = createAvatar(displayNameOf(member.user_id));
    const main = document.createElement("span");
    main.className = "info-member-main";

    const name = document.createElement("span");
    name.className = "info-member-name";
    name.textContent =
      displayNameOf(member.user_id) +
      (member.user_id === currentUserId ? " (jij)" : "");

    const role = document.createElement("span");
    role.className = "info-member-role";
    role.textContent =
      (member.role === "owner" ? "Eigenaar" : "Lid") + " · " + info.detail;

    main.append(name, role);

    const badge = document.createElement("span");
    badge.className = "status-badge " + info.cls;
    badge.textContent = info.label;

    row.append(avatar, main, badge);

    if (aliasesAvailable && member.user_id !== currentUserId) {
      const editAlias = document.createElement("button");
      editAlias.type = "button";
      editAlias.className = "alias-edit-btn";
      editAlias.title = "Naam aanpassen";
      editAlias.setAttribute(
        "aria-label",
        "Naam aanpassen voor " + displayNameOf(member.user_id)
      );
      editAlias.textContent = "✎";
      editAlias.addEventListener("click", () => {
        openAliasModal(member.user_id);
      });
      row.append(editAlias);
    }

    if (
      room.kind === "group" &&
      room.my_role === "owner" &&
      member.user_id !== currentUserId &&
      member.role !== "owner"
    ) {
      const removeMember = document.createElement("button");
      removeMember.type = "button";
      removeMember.className = "member-remove-btn";
      removeMember.title = "Uit groep verwijderen";
      removeMember.setAttribute(
        "aria-label",
        "Verwijder " + displayNameOf(member.user_id) + " uit de groep"
      );
      removeMember.textContent = "✕";
      removeMember.addEventListener("click", () => {
        removeGroupMember(member).catch(console.error);
      });
      row.append(removeMember);
    }

    membersArea.append(row);
  });

  const isGroup = room.kind === "group";
  $("editAliasBtn").hidden = isGroup || !aliasesAvailable;
  $("inviteBox").hidden = !isGroup;
  $("leaveGroupBtn").hidden = !isGroup;
  $("deleteChatBtn").hidden = isGroup;

  if (isGroup) {
    $("inviteCode").textContent = room.invite_code || "-";
    $("regenerateInviteBtn").hidden = room.my_role !== "owner";
  }

  openModal("chatInfoModal");
}

function aliasErrorMessage(error) {
  const message = (error && error.message) || "Onbekende fout.";

  if (/does not exist|schema cache|relation/i.test(message)) {
    return "De aliassen-tabel bestaat nog niet. Voer het nieuwe SQL-stuk uit.";
  }

  return "Naam opslaan mislukt: " + message;
}

function openAliasModal(userId) {
  if (!userId || userId === currentUserId) return;

  aliasTargetId = userId;

  const realName = realNameOf(userId);
  const currentAlias = aliasFor(userId);

  $("aliasTitle").textContent = "Naam aanpassen";
  $("aliasSubtitle").textContent =
    `Kies hoe jij ${realName} ziet. Alleen jij ziet deze naam.`;
  $("aliasInput").value = currentAlias;
  $("aliasInput").placeholder = realName;
  $("clearAliasBtn").hidden = !currentAlias;
  $("aliasStatus").textContent = "";

  openModal("aliasModal");
  setTimeout(() => $("aliasInput").focus(), 80);
}

async function saveAlias(event) {
  event.preventDefault();

  if (!aliasTargetId || !currentUserId) return;

  const alias = $("aliasInput").value.trim().slice(0, 40);

  if (!alias) {
    await clearAlias();
    return;
  }

  $("saveAliasBtn").disabled = true;
  $("aliasStatus").textContent = "Opslaan...";

  const { error } = await supabaseClient
    .from("contact_aliases")
    .upsert({
      owner_id: currentUserId,
      contact_id: aliasTargetId,
      alias,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "owner_id,contact_id"
    });

  $("saveAliasBtn").disabled = false;

  if (error) {
    $("aliasStatus").textContent = aliasErrorMessage(error);
    return;
  }

  contactAliases.set(aliasTargetId, alias);
  closeModal("aliasModal");
  showToast("Naam opgeslagen. Alleen jij ziet deze naam.", "success");
  applyAliasChange(aliasTargetId);
}

async function clearAlias() {
  if (!aliasTargetId || !currentUserId) return;

  $("clearAliasBtn").disabled = true;
  $("aliasStatus").textContent = "Echte naam herstellen...";

  const { error } = await supabaseClient
    .from("contact_aliases")
    .delete()
    .eq("owner_id", currentUserId)
    .eq("contact_id", aliasTargetId);

  $("clearAliasBtn").disabled = false;

  if (error) {
    $("aliasStatus").textContent = aliasErrorMessage(error);
    return;
  }

  contactAliases.delete(aliasTargetId);
  closeModal("aliasModal");
  showToast("De echte naam wordt weer gebruikt.", "success");
  applyAliasChange(aliasTargetId);
}

function applyAliasChange(userId) {
  chatRooms.forEach(room => {
    if (room.kind !== "direct") return;

    const other = room.members.find(member => member.user_id !== currentUserId);

    if (other) room.title = displayNameOf(other.user_id);
  });

  renderConversations();
  renderPresence();

  const activeRoom = getActiveRoom();

  if (activeRoom) {
    renderChatHeader(activeRoom);
    if (activeChatId) renderChatMessages();
  }

  if (!$("chatInfoModal").hidden) {
    openChatInfo().catch(console.error);
  }
}

async function regenerateInviteCode() {
  const room = getActiveRoom();

  if (!room) return;

  $("regenerateInviteBtn").disabled = true;

  const { data, error } = await supabaseClient.rpc("regenerate_invite_code", {
    target_room: room.id
  });

  $("regenerateInviteBtn").disabled = false;

  if (error) {
    showToast(describeChatError(error), "error");
    return;
  }

  room.invite_code = data;
  $("inviteCode").textContent = data;
  showToast("Er is een nieuwe code gemaakt.", "success");
}

function mailInviteLink() {
  const room = getActiveRoom();

  if (!room || !room.invite_code) return;

  const url = getInviteLink(room);
  const subject = `Doe mee met "${room.title}" op Roostercheck`;
  const body =
    `Hoi!\n\n` +
    `Ik heb een groep gemaakt op Roostercheck: "${room.title}".\n` +
    `Join met de code: ${room.invite_code}\n` +
    `Of open deze link: ${url}\n\n` +
    `Tot in de chat!`;

  window.location.href =
    "mailto:?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body);
}

async function shareInviteLink() {
  const room = getActiveRoom();

  if (!room || !room.invite_code) return;

  const url = getInviteLink(room);
  const text = `Doe mee met "${room.title}" op Roostercheck. Code: ${room.invite_code}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: room.title,
        text,
        url
      });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }

  await copyText(url, "Kopieer de uitnodigingslink:");
}

async function removeGroupMember(member) {
  const room = getActiveRoom();

  if (
    !room ||
    room.kind !== "group" ||
    room.my_role !== "owner" ||
    !member ||
    member.user_id === currentUserId
  ) {
    return;
  }

  const name = displayNameOf(member.user_id);

  if (!confirm(`Weet je zeker dat je ${name} uit "${room.title}" wilt verwijderen?`)) {
    return;
  }

  const { error } = await supabaseClient.rpc("remove_group_member", {
    target_room: room.id,
    member_user: member.user_id
  });

  if (error) {
    showToast(describeChatError(error), "error");
    return;
  }

  room.members = room.members.filter(item => item.user_id !== member.user_id);
  renderChatHeader(room);
  await loadChatOverview();
  await openChatInfo();
  showToast(`${name} is uit de groep verwijderd.`, "success");
}

async function deleteActiveDirectChat() {
  const room = getActiveRoom();

  if (!room || room.kind !== "direct") return;

  if (
    !confirm(
      `Weet je zeker dat je de chat met ${room.title} wilt verwijderen? ` +
      "De chat verdwijnt uit jouw lijst. Nieuwe berichten brengen hem terug."
    )
  ) {
    return;
  }

  const { error } = await supabaseClient.rpc("delete_direct_chat", {
    target_room: room.id
  });

  if (error) {
    showToast(describeChatError(error), "error");
    return;
  }

  chatRooms = chatRooms.filter(item => item.id !== room.id);
  closeModal("chatInfoModal");
  closeChatRoom();
  updateChatBadge();
  await loadChatOverview();
  showToast("Chat verwijderd.", "success");
}

async function leaveActiveGroup() {
  const room = getActiveRoom();

  if (!room || room.kind !== "group") return;

  if (!confirm(`Weet je zeker dat je "${room.title}" wilt verlaten?`)) {
    return;
  }

  const { error } = await supabaseClient.rpc("leave_group", {
    target_room: room.id
  });

  if (error) {
    showToast(describeChatError(error), "error");
    return;
  }

  closeModal("chatInfoModal");
  closeChatRoom();
  await loadChatOverview();
  showToast("Je hebt de groep verlaten.", "success");
}

// ============================================================
// EVENT LISTENERS VOOR CHAT EN AANWEZIGHEID
// ============================================================
document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    setAppView(button.dataset.view);
  });
});

$("newChatBtn").addEventListener("click", () => openNewChatModal("person"));
$("emptyNewChatBtn").addEventListener("click", () => openNewChatModal("person"));
$("emptyJoinBtn").addEventListener("click", () => openNewChatModal("join"));

$("chatSearch").addEventListener("input", event => {
  chatSearchTerm = event.target.value;
  renderConversations();
});

$("presenceSearch").addEventListener("input", event => {
  presenceSearchTerm = event.target.value;
  renderPresence();
});

$("refreshPresenceBtn").addEventListener("click", async () => {
  await publishPresence({ force: true });
  await loadAllProfiles();
  showToast("Status bijgewerkt.", "success");
});

$("chatBackBtn").addEventListener("click", closeChatRoom);
$("chatInfoBtn").addEventListener("click", () => {
  openChatInfo().catch(console.error);
});

$("chatAliasBtn").addEventListener("click", () => {
  const room = getActiveRoom();

  if (!room || room.kind !== "direct") return;

  const other = room.members.find(member => member.user_id !== currentUserId);

  if (other) openAliasModal(other.user_id);
});

$("chatComposer").addEventListener("submit", event => {
  event.preventDefault();
  sendChatMessage().catch(console.error);
});

$("chatInput").addEventListener("input", event => {
  const input = event.target;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 110) + "px";
});

$("chatInput").addEventListener("keydown", event => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    sendChatMessage().catch(console.error);
  }
});

document.querySelectorAll("[data-close-modal]").forEach(button => {
  button.addEventListener("click", () => {
    closeModal(button.dataset.closeModal);
  });
});

document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closeModal(modal.id);
    }
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeAllModals();
  }
});

document.querySelectorAll(".modal-tab").forEach(button => {
  button.addEventListener("click", () => {
    setNewChatTab(button.dataset.chatTab);
  });
});

$("peopleSearch").addEventListener(
  "input",
  debounce(event => {
    searchPeople(event.target.value).catch(console.error);
  }, 250)
);

$("groupPeopleSearch").addEventListener(
  "input",
  debounce(event => {
    searchGroupPeople(event.target.value).catch(console.error);
  }, 250)
);

$("createGroupBtn").addEventListener("click", () => {
  createNewGroup().catch(console.error);
});

$("joinGroupBtn").addEventListener("click", () => {
  joinGroupWithCode().catch(console.error);
});

$("joinCodeInput").addEventListener("input", event => {
  event.target.value = event.target.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
});

$("copyInviteBtn").addEventListener("click", () => {
  const room = getActiveRoom();
  if (room && room.invite_code) copyText(room.invite_code);
});

$("mailInviteBtn").addEventListener("click", mailInviteLink);

$("shareInviteBtn").addEventListener("click", () => {
  shareInviteLink().catch(console.error);
});

$("regenerateInviteBtn").addEventListener("click", () => {
  regenerateInviteCode().catch(console.error);
});

$("leaveGroupBtn").addEventListener("click", () => {
  leaveActiveGroup().catch(console.error);
});

$("deleteChatBtn").addEventListener("click", () => {
  deleteActiveDirectChat().catch(console.error);
});

$("editAliasBtn").addEventListener("click", () => {
  const room = getActiveRoom();

  if (!room || room.kind !== "direct") return;

  const other = room.members.find(member => member.user_id !== currentUserId);

  if (other) openAliasModal(other.user_id);
});

$("aliasForm").addEventListener("submit", event => {
  saveAlias(event).catch(console.error);
});

$("clearAliasBtn").addEventListener("click", () => {
  clearAlias().catch(console.error);
});

$("editNameBtn").addEventListener("click", () => {
  $("nameForm").hidden = false;
  $("editNameBtn").hidden = true;
  renderProfileSettings();
  $("displayNameInput").focus();
});

$("nameForm").addEventListener("submit", event => {
  saveDisplayName(event).catch(console.error);
});

$("chatNotificationsToggle").checked =
  localStorage.getItem("rc-chat-notifications-enabled") !== "false";

$("chatNotificationsToggle").addEventListener("change", async event => {
  localStorage.setItem(
    "rc-chat-notifications-enabled",
    event.target.checked ? "true" : "false"
  );

  if (
    event.target.checked &&
    "Notification" in window &&
    Notification.permission === "default"
  ) {
    try {
      await Notification.requestPermission();
    } catch {
      // De browser ondersteunt geen toestemmingsvraag.
    }
  }

  if (event.target.checked && notificationsEnabled()) {
    syncPushNotifications().catch(console.error);
  }

  const synced = await updateChatPushPreference(event.target.checked);

  if (!synced) {
    showToast(
      "Chatmeldingen opgeslagen. Voer supabase/schema.sql opnieuw uit voor meldingen bij een gesloten app.",
      "error"
    );
    return;
  }

  if (event.target.checked && !notificationsEnabled()) {
    showToast(
      "Chatmeldingen staan aan. Zet ook Meldingen aan voor meldingen als de app dicht is."
    );
    return;
  }

  showToast(
    event.target.checked
      ? "Chatmeldingen staan aan."
      : "Chatmeldingen staan uit."
  );
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !currentUserId) return;

  publishPresence({ force: true }).catch(console.error);

  if (currentView === "presence") {
    loadAllProfiles().catch(console.error);
  }

  if (currentView === "chat" && activeChatId) {
    openChat(activeChatId, { fromUrl: true }).catch(console.error);
  }
});

window.addEventListener("hashchange", () => {
  if (!currentUserId) return;

  const match = location.hash.match(/^#chat=([0-9a-f-]{36})/i);

  if (match) {
    setAppView("chat");
    openChat(match[1], { fromUrl: true }).catch(console.error);
  } else if (currentView === "chat") {
    closeChatRoom();
  }
});

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
  navigator.serviceWorker.register("./sw.js?v=16")
    .then(registration => {
      serviceWorkerRegistration = registration;
    })
    .catch(console.error);
}

// START
render();
updateRosterUI();
rememberJoinCodeFromUrl();
checkLogin();
