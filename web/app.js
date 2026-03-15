// PATCHED web/app.js - finalize modal with Yes / Wait / Cancel
let narrateMode = false;
let setupComplete = false;
let awaitingFinalizeConfirmation = false;
const diceSelection = { 4: 0, 6: 0, 8: 0, 10: 0, 12: 0, 20: 0 };

const messageStore = [];
const MAX_RENDERED_MESSAGES = 120;
const OLDER_CHUNK_SIZE = 40;
let renderedStartIndex = 0;
let typingIndicatorEl = null;
let streamingInProgress = false;
let canReloadLast = false;
let canEditLastTurn = false;
let canEditLastWizardPlayer = false;

async function api(url, options = {}) {
  const startedAt = performance.now();
  console.debug("[api] request", { url, options });

  const response = await fetch(url, options);
  let data = null;
  let rawText = "";

  try {
    rawText = await response.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch (err) {
    console.error("[api] response parse error", { url, status: response.status, err, rawText });
    throw new Error(`Invalid JSON response from ${url}`);
  }

  console.debug("[api] response", {
    url,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    data
  });

  if (!response.ok || !data?.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

function storyEl() { return document.getElementById("story"); }
function isNearBottom(container) { return container.scrollHeight - container.scrollTop - container.clientHeight < 80; }

function renderNarrateToggle() {
  const btn = document.getElementById("narrateToggle");
  btn.textContent = narrateMode ? "Narrate: ON" : "Narrate: OFF";
  btn.classList.toggle("on", narrateMode);
}

function renderWizardBanner() {
  const banner = document.getElementById("wizardBanner");
  banner.classList.toggle("hidden", !!setupComplete);
}

function renderReloadButton() {
  const btn = document.getElementById("reloadLastBtn");
  if (btn) btn.disabled = !setupComplete || !canReloadLast || streamingInProgress;
}

function renderEditButtons() {
  const gameBtn = document.getElementById("editLastPlayerBtn");
  const wizardBtn = document.getElementById("editLastWizardBtn");

  if (gameBtn) {
    if (setupComplete) {
      gameBtn.disabled = !canEditLastTurn || streamingInProgress;
      gameBtn.textContent = "Edit last player message";
    } else {
      gameBtn.disabled = !canEditLastWizardPlayer || streamingInProgress;
      gameBtn.textContent = "Edit last player message";
    }
  }

  if (wizardBtn) {
    wizardBtn.style.display = "none";
  }
}

function renderFinalizeButtons() {
  const btn = document.getElementById("finalizeSetupBtn");
  if (btn) btn.disabled = setupComplete || streamingInProgress;
}

function renderDiceButtons() {
  document.querySelectorAll(".dice-btn").forEach((btn) => {
    const die = Number(btn.dataset.die);
    const count = diceSelection[die] || 0;
    btn.textContent = count > 0 ? `${count}D${die}` : `D${die}`;
    btn.classList.toggle("active", count > 0);
  });
}

function createMessageElement(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "player" ? "Player" : "AI";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;
  wrapper.appendChild(label);
  wrapper.appendChild(body);
  return wrapper;
}

function updateLoadOlderButton() {
  const existing = document.getElementById("loadOlderBtn");
  if (existing) existing.remove();
  if (renderedStartIndex <= 0) return;
  const btn = document.createElement("button");
  btn.id = "loadOlderBtn";
  btn.className = "load-older-btn";
  btn.textContent = `Load older messages (${renderedStartIndex} hidden)`;
  btn.addEventListener("click", loadOlderMessages);
  storyEl().prepend(btn);
}

function rerenderMessageWindow(stickBottom = false) {
  const story = storyEl();
  story.innerHTML = "";
  const start = Math.max(0, messageStore.length - MAX_RENDERED_MESSAGES);
  renderedStartIndex = start;
  const visible = messageStore.slice(start);

  for (const msg of visible) {
    const role = msg.role === "ai-stream" ? "ai" : msg.role;
    const el = createMessageElement(role, msg.text);
    if (msg.role === "ai-stream") el.classList.add("streaming");
    story.appendChild(el);
  }

  if (typingIndicatorEl) story.appendChild(typingIndicatorEl);
  updateLoadOlderButton();
  if (stickBottom) story.scrollTop = story.scrollHeight;
}

function loadOlderMessages() {
  const story = storyEl();
  const previousHeight = story.scrollHeight;
  const newStart = Math.max(0, renderedStartIndex - OLDER_CHUNK_SIZE);
  const slice = messageStore.slice(newStart, renderedStartIndex);
  const loadBtn = document.getElementById("loadOlderBtn");
  const insertBeforeNode = loadBtn ? loadBtn.nextSibling : story.firstChild;

  for (const msg of slice) {
    const role = msg.role === "ai-stream" ? "ai" : msg.role;
    const el = createMessageElement(role, msg.text);
    if (msg.role === "ai-stream") el.classList.add("streaming");
    story.insertBefore(el, insertBeforeNode);
  }

  renderedStartIndex = newStart;
  updateLoadOlderButton();
  const newHeight = story.scrollHeight;
  story.scrollTop += newHeight - previousHeight;
}

function appendMessage(role, text) {
  const story = storyEl();
  const shouldStickToBottom = isNearBottom(story);
  messageStore.push({ role, text });

  if (messageStore.length <= MAX_RENDERED_MESSAGES) {
    story.appendChild(createMessageElement(role, text));
    if (typingIndicatorEl) story.appendChild(typingIndicatorEl);
  } else {
    rerenderMessageWindow(false);
  }

  updateLoadOlderButton();
  if (shouldStickToBottom) story.scrollTo({ top: story.scrollHeight, behavior: "smooth" });
}

function replaceLastAiMessage(text) {
  for (let i = messageStore.length - 1; i >= 0; i--) {
    if (messageStore[i].role === "ai" || messageStore[i].role === "ai-stream") {
      messageStore[i] = { role: "ai", text };
      rerenderMessageWindow(true);
      return;
    }
  }
  appendMessage("ai", text);
}

function replaceLastPlayerAndAi(editedPlayer, newAi) {
  let playerIndex = -1;
  let aiIndex = -1;
  for (let i = messageStore.length - 1; i >= 0; i--) {
    if (aiIndex === -1 && (messageStore[i].role === "ai" || messageStore[i].role === "ai-stream")) {
      aiIndex = i;
      continue;
    }
    if (messageStore[i].role === "player") {
      playerIndex = i;
      break;
    }
  }
  if (playerIndex !== -1) messageStore[playerIndex] = { role: "player", text: editedPlayer };
  if (aiIndex !== -1) messageStore[aiIndex] = { role: "ai", text: newAi };
  rerenderMessageWindow(true);
}

function clearStory() {
  messageStore.length = 0;
  typingIndicatorEl = null;
  rerenderMessageWindow(true);
}

function showTypingIndicator() {
  hideTypingIndicator();
  typingIndicatorEl = document.createElement("div");
  typingIndicatorEl.className = "message ai typing-indicator";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "AI";
  const body = document.createElement("div");
  body.className = "message-body";
  body.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  typingIndicatorEl.appendChild(label);
  typingIndicatorEl.appendChild(body);
  storyEl().appendChild(typingIndicatorEl);
  storyEl().scrollTo({ top: storyEl().scrollHeight, behavior: "smooth" });
}

function hideTypingIndicator() {
  if (typingIndicatorEl && typingIndicatorEl.parentNode) typingIndicatorEl.parentNode.removeChild(typingIndicatorEl);
  typingIndicatorEl = null;
}

function openFinalizeModal() {
  document.getElementById("finalizeModal")?.classList.remove("hidden");
}

function closeFinalizeModal() {
  document.getElementById("finalizeModal")?.classList.add("hidden");
}

async function finalizeNowFromModal() {
  closeFinalizeModal();
  await completeSetup();
}

async function waitAndShowOverviewFromModal() {
  closeFinalizeModal();
  appendMessage("player", "I want an overview before finalizing. Keep setup open.");
  showTypingIndicator();
  try {
    const data = await api("/api/setup/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "I want an overview before finalizing. Keep setup open." })
    });
    hideTypingIndicator();
    appendMessage("ai", data.reply);
    awaitingFinalizeConfirmation = !!data.awaitingFinalizeConfirmation;
    canEditLastWizardPlayer = true;
    renderEditButtons();
  } catch (err) {
    hideTypingIndicator();
    appendMessage("ai", `Error: ${err.message}`);
  }
}

function rollDie(sides) { return Math.floor(Math.random() * sides) + 1; }

function doRoll() {
  const lines = [];
  let total = 0;
  let hasAny = false;
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    const count = diceSelection[sides];
    if (!count) continue;
    hasAny = true;
    const results = [];
    for (let i = 0; i < count; i++) {
      const value = rollDie(sides);
      results.push(value);
      total += value;
    }
    lines.push(`D${sides}: ${results.join(", ")}`);
  }
  const log = document.getElementById("rollLogContent");
  if (!hasAny) return void (log.textContent = "No dice selected.");
  lines.push("");
  lines.push(`Total: ${total}`);
  log.textContent = lines.join("\n");
}

function clearDice() {
  for (const k of Object.keys(diceSelection)) diceSelection[k] = 0;
  renderDiceButtons();
  document.getElementById("rollLogContent").textContent = "No rolls yet.";
}

async function setNarrateMode(value) {
  const data = await api("/api/narrate-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ narrateMode: value })
  });
  narrateMode = !!data.narrateMode;
  renderNarrateToggle();
}

async function toggleNarrate() {
  try { await setNarrateMode(!narrateMode); }
  catch (err) { appendMessage("ai", `Error: ${err.message}`); }
}

async function refreshSaves() {
  const data = await api("/api/saves");
  const list = document.getElementById("campaignList");
  list.innerHTML = "";

  for (const save of data.saves) {
    const card = document.createElement("div");
    card.className = "campaign-card";
    const name = document.createElement("div");
    name.className = "campaign-name";
    name.textContent = save + (data.activeSave === save ? " (active)" : "");
    const actions = document.createElement("div");
    actions.className = "campaign-actions";

    const loadBtn = document.createElement("button");
    loadBtn.className = "campaign-button";
    loadBtn.textContent = "Continue";
    loadBtn.onclick = async () => {
      await api("/api/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: save })
      });
      await refreshSaves();
      await refreshState();
      clearStory();
      await bootWizardIfNeeded();
      appendMessage("ai", `Campaign "${save}" loaded.`);
    };

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.onclick = async () => {
      const confirmed = confirm(`Really delete "${save}"?`);
      if (!confirmed) return;
      await api(`/api/saves/${encodeURIComponent(save)}`, { method: "DELETE" });
      await refreshSaves();
      await refreshState();
    };

    actions.appendChild(loadBtn);
    actions.appendChild(delBtn);
    card.appendChild(name);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

async function refreshState() {
  const state = await api("/api/state");
  document.getElementById("activeSaveLabel").textContent = state.activeSave ? `Campaign: ${state.activeSave}` : "No campaign loaded";
  document.getElementById("locationLabel").textContent = state.location?.name || "";
  narrateMode = !!state.narrateMode;
  setupComplete = !!state.setupComplete;
  canReloadLast = !!state.canReloadLast;
  canEditLastTurn = !!state.canEditLastTurn;
  renderNarrateToggle();
  renderWizardBanner();

  if (!setupComplete) {
    try {
      const setupState = await api("/api/setup/state");
      awaitingFinalizeConfirmation = !!setupState.awaitingFinalizeConfirmation;
      canEditLastWizardPlayer = !!setupState.canEditLastWizardPlayer;
    } catch {
      awaitingFinalizeConfirmation = false;
      canEditLastWizardPlayer = false;
    }
  } else {
    awaitingFinalizeConfirmation = false;
    canEditLastWizardPlayer = false;
  }

  renderReloadButton();
  renderEditButtons();
  renderFinalizeButtons();
}

async function createNewGame() {
  const name = prompt("Enter new campaign name:");
  if (!name) return;

  await api("/api/saves", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  await refreshSaves();
  await refreshState();
  clearStory();
  appendMessage("ai", `New campaign "${name}" created and loaded.`);
  await bootWizardIfNeeded();
}

async function bootWizardIfNeeded() {
  const state = await api("/api/state");
  if (state.setupComplete) return;
  const setupState = await api("/api/setup/state");
  awaitingFinalizeConfirmation = !!setupState.awaitingFinalizeConfirmation;
  canEditLastWizardPlayer = !!setupState.canEditLastWizardPlayer;

  if (setupState.messages && setupState.messages.length > 0) {
    for (const msg of setupState.messages) appendMessage(msg.role === "user" ? "player" : "ai", msg.content);
    renderEditButtons();
    return;
  }

  const started = await api("/api/setup/start", { method: "POST" });
  appendMessage("ai", started.message);
  renderEditButtons();
}

async function sendWizardMessage(text) {
  console.debug("[sendWizardMessage] started", { text });
  appendMessage("player", text);
  showTypingIndicator();
  const data = await api("/api/setup/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text })
  });
  hideTypingIndicator();
  console.debug("[sendWizardMessage] success", data);
  appendMessage("ai", data.reply);
  awaitingFinalizeConfirmation = !!data.awaitingFinalizeConfirmation;
  canEditLastWizardPlayer = true;
  renderEditButtons();
}

async function requestFinalizeSetup() {
  openFinalizeModal();
}

async function completeSetup() {
  if (streamingInProgress) return;

  try {
    streamingInProgress = true;
    console.debug("[completeSetup] started");
    showTypingIndicator();

    const data = await api("/api/setup/complete", { method: "POST" });

    console.debug("[completeSetup] success", data);
    hideTypingIndicator();
    setupComplete = true;
    awaitingFinalizeConfirmation = false;
    renderWizardBanner();
    appendMessage("ai", data.opening);
    await refreshState();
  } catch (err) {
    console.error("[completeSetup] error", err);
    hideTypingIndicator();
    appendMessage("ai", `Error: ${err.message}`);
  } finally {
    streamingInProgress = false;
    renderFinalizeButtons();
    renderReloadButton();
    renderEditButtons();
  }
}

async function reloadLastTurn() {
  if (!setupComplete || !canReloadLast || streamingInProgress) return;
  try {
    streamingInProgress = true;
    renderReloadButton();
    showTypingIndicator();
    const data = await api("/api/reload-last-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    hideTypingIndicator();
    replaceLastAiMessage(data.ai_output);
    await refreshState();
  } catch (err) {
    hideTypingIndicator();
    appendMessage("ai", `Error: ${err.message}`);
  } finally {
    streamingInProgress = false;
    renderReloadButton();
  }
}

async function editLastTurn() {
  if (setupComplete) {
    if (!canEditLastTurn || streamingInProgress) return;
    const lastPlayer = [...messageStore].reverse().find(m => m.role === "player")?.text || "";
    const edited = prompt("Edit your last player message:", lastPlayer);
    if (edited === null) return;
    const trimmed = edited.trim();
    if (!trimmed) return;

    try {
      streamingInProgress = true;
      renderEditButtons();
      showTypingIndicator();
      const data = await api("/api/edit-last-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_text: trimmed })
      });
      hideTypingIndicator();
      replaceLastPlayerAndAi(data.player_text, data.ai_output);
      await refreshState();
    } catch (err) {
      hideTypingIndicator();
      appendMessage("ai", `Error: ${err.message}`);
    } finally {
      streamingInProgress = false;
      renderEditButtons();
    }
  } else {
    await editLastWizardPlayer();
  }
}

async function editLastWizardPlayer() {
  if (setupComplete || !canEditLastWizardPlayer || streamingInProgress) return;
  const lastPlayer = [...messageStore].reverse().find(m => m.role === "player")?.text || "";
  const edited = prompt("Edit your last wizard message:", lastPlayer);
  if (edited === null) return;
  const trimmed = edited.trim();
  if (!trimmed) return;

  try {
    streamingInProgress = true;
    renderEditButtons();
    showTypingIndicator();
    const data = await api("/api/setup/edit-last-player-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed })
    });
    hideTypingIndicator();
    replaceLastPlayerAndAi(data.editedMessage, data.reply);
    awaitingFinalizeConfirmation = !!data.awaitingFinalizeConfirmation;
    canEditLastWizardPlayer = true;
    renderEditButtons();
  } catch (err) {
    hideTypingIndicator();
    appendMessage("ai", `Error: ${err.message}`);
  } finally {
    streamingInProgress = false;
    renderEditButtons();
  }
}

async function sendAction() {
  if (streamingInProgress) return;
  const input = document.getElementById("playerInput");
  const action = input.value.trim();
  if (!action) return;
  input.value = "";

  try {
    if (!setupComplete) {
      const lower = action.toLowerCase().trim();
      if (lower === "yes finalize" || lower === "yes, finalize" || lower === "finalize now" || lower === "start game now" || lower === "begin now") {
        appendMessage("player", action);
        openFinalizeModal();
        return;
      }

      await sendWizardMessage(action);
      return;
    }

    appendMessage("player", action);
    showTypingIndicator();
    try {
      const data = await api("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      hideTypingIndicator();
      appendMessage("ai", data.ai_output);
      await refreshState();
    } catch (err) {
      hideTypingIndicator();
      appendMessage("ai", `Error: ${err.message}`);
    }
  } catch (err) {
    hideTypingIndicator();
    appendMessage("ai", `Error: ${err.message}`);
  }
}

document.getElementById("newGameBtn").addEventListener("click", createNewGame);
document.getElementById("sendBtn").addEventListener("click", sendAction);
document.getElementById("reloadLastBtn")?.addEventListener("click", reloadLastTurn);
document.getElementById("editLastPlayerBtn")?.addEventListener("click", editLastTurn);
document.getElementById("editLastWizardBtn")?.addEventListener("click", editLastWizardPlayer);
document.getElementById("finalizeSetupBtn")?.addEventListener("click", requestFinalizeSetup);

document.getElementById("modalFinalizeYes")?.addEventListener("click", finalizeNowFromModal);
document.getElementById("modalFinalizeWait")?.addEventListener("click", waitAndShowOverviewFromModal);
document.getElementById("modalFinalizeCancel")?.addEventListener("click", closeFinalizeModal);

document.getElementById("playerInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAction();
  }
});

document.querySelectorAll(".dice-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const die = Number(btn.dataset.die);
    diceSelection[die] = (diceSelection[die] || 0) + 1;
    renderDiceButtons();
  });
});

document.getElementById("rollBtn").addEventListener("click", doRoll);
document.getElementById("clearDiceBtn").addEventListener("click", clearDice);
document.getElementById("narrateToggle").addEventListener("click", toggleNarrate);

renderDiceButtons();
renderNarrateToggle();
refreshSaves().then(async () => {
  await refreshState();
  if ((document.getElementById("activeSaveLabel").textContent || "").includes("Campaign:")) {
    await bootWizardIfNeeded();
  }
});
