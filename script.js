/* ══════════════════════════════════════════════════════════
   RAG ARENA — script.js
   ══════════════════════════════════════════════════════════ */

// ── NAZWY AGENTÓW (edytuj tutaj) ────────────────────────
const NAME_A = 'Agent A';
const NAME_B = 'Agent B';

// ── STAN APLIKACJI ───────────────────────────────────────
let currentUser        = null;
let sessionId          = crypto.randomUUID();
let isVoting           = false;
let isLocked           = false;
let chatHistory        = [];

let lastQuery          = '';
let lastResponseA      = '';
let lastResponseB      = '';
let lastLatencyA       = 0;
let lastLatencyB       = 0;
let feedbackMode       = 'Bad';       // 'Bad' | 'A' | 'B'
let totalQuestions     = 0;

// Aktualne karty (do kolorowania po głosowaniu)
let currentCardA       = null;
let currentCardB       = null;

// Lokalne statystyki sesji
const sessionVotes     = { A_OK_B_BAD:0, Tie:0, Bad:0, B_OK_A_BAD:0, A:0, Tie_Phase2:0, B:0 };

// ── STORAGE KEY ──────────────────────────────────────────
function storageKey() { return `rag_arena_${currentUser}`; }

// ════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════

function loginKey(e) {
  if (e.key === 'Enter') handleLogin();
}

async function handleLogin() {
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  if (!user || !pass) { errEl.textContent = 'Wpisz login i hasło.'; return; }

  try {
    const res  = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();

    if (data.success) {
      currentUser = data.username;
      document.getElementById('display-user').textContent = currentUser;
      document.getElementById('login-screen').style.display = 'none';

      renderHistory();
      calculateQuestions();
      updateMiniLb();

      // Wczytaj ostatni niezablokowany czat lub zacznij nowy
      const all = getChats();
      const last = all.find(c => !c.isLocked);
      if (last) loadChat(last.id);
      else      resetChat();

      document.getElementById('chat-input').focus();
    } else {
      errEl.textContent = data.message || 'Błąd logowania.';
    }
  } catch (e) {
    errEl.textContent = 'Błąd połączenia z serwerem.';
  }
}

function togglePw() {
  const inp = document.getElementById('login-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function logout() { location.reload(); }

// ════════════════════════════════════════════════════════
//  LOCALSTORAGE — HISTORIA CZATÓW
// ════════════════════════════════════════════════════════

function getChats() {
  return JSON.parse(localStorage.getItem(storageKey()) || '[]');
}

function saveChats(arr) {
  localStorage.setItem(storageKey(), JSON.stringify(arr));
}

function saveCurrentChat() {
  if (!currentUser || chatHistory.length === 0) return;

  let all = getChats();
  const idx = all.findIndex(c => c.id === sessionId);

  let title = 'Nowa rozmowa';
  if (idx !== -1 && all[idx].title) {
    title = all[idx].title;
  } else if (chatHistory.length > 0 && chatHistory[0].role === 'user') {
    const t = chatHistory[0].content;
    title = t.length > 28 ? t.slice(0, 28) + '…' : t;
  }

  const chatData = {
    id:        sessionId,
    title:     title,
    timestamp: Date.now(),
    messages:  chatHistory,
    isLocked:  isLocked,
    severity:  (idx !== -1 ? all[idx].severity : 0)
  };

  if (idx !== -1) {
    if (all[idx].isLocked) chatData.isLocked = true;
    chatData.severity = all[idx].severity;
    all.splice(idx, 1);
  }
  all.unshift(chatData);
  if (all.length > 15) all = all.slice(0, 15);
  saveChats(all);
  renderHistory();
}

// ════════════════════════════════════════════════════════
//  HISTORIA — RENDER SIDEBAR
// ════════════════════════════════════════════════════════

function renderHistory() {
  if (!currentUser) return;

  const all = getChats();
  const now = Date.now();
  const dayStart = new Date().setHours(0, 0, 0, 0);

  const today  = all.filter(c => c.timestamp >= dayStart);
  const older  = all.filter(c => c.timestamp <  dayStart);

  document.getElementById('history-today-label').style.display  = today.length  ? '' : 'none';
  document.getElementById('history-older-label').style.display  = older.length  ? '' : 'none';

  renderHistoryGroup('history-today',  today);
  renderHistoryGroup('history-older',  older);
}

function renderHistoryGroup(containerId, chats) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  chats.forEach(chat => {
    const item = document.createElement('button');
    item.className = 'history-item' +
      (chat.id === sessionId ? ' active' : '') +
      (chat.isLocked ? ' locked' : '');

    // Ikona statusu
    let icon = '·';
    if (chat.isLocked) {
      const s = parseInt(chat.severity || 0);
      icon = s >= 5 ? '💥' : ('⭐'.repeat(Math.max(1, s)));
    }

    item.innerHTML = `
      <span class="hist-icon">${icon}</span>
      <span class="hist-title">${esc(chat.title)}</span>
      <button class="hist-rename" onclick="openRename('${chat.id}', event)" title="Zmień nazwę">✎</button>
    `;
    item.addEventListener('click', () => loadChat(chat.id));
    el.appendChild(item);
  });
}

// ════════════════════════════════════════════════════════
//  ŁADOWANIE CZATU Z HISTORII
// ════════════════════════════════════════════════════════

function loadChat(id) {
  const all  = getChats();
  const chat = all.find(c => c.id === id);
  if (!chat) return;

  sessionId   = chat.id;
  chatHistory = chat.messages || [];
  isLocked    = chat.isLocked === true;
  isVoting    = false;

  // Wyczyść chat area
  const area = document.getElementById('chat-area');
  area.innerHTML = '';
  document.getElementById('vote-bar').classList.remove('visible');
  document.getElementById('topbar-agents').style.display = 'none';

  // Zamknij success modal jeśli był
  document.getElementById('success-modal').classList.add('hidden');

  // Renderuj wiadomości
  chatHistory.forEach((msg, i) => {
    if (msg.role === 'user') {
      appendUserBubble(msg.content);
    } else if (msg.role === 'battle') {
      const { cardA, cardB } = appendBattleRow(
        msg.contentA, msg.contentB, msg.latencyA, msg.latencyB
      );
      // Przywróć kolory kart na podstawie zapisanego głosu
      const w = msg.vote_winner;
      if (w) applyVoteColors(cardA, cardB, w);
    }
  });

  if (isLocked) {
    showSuccessModal('history');
  }

  updateInputState();
  renderHistory();
  scrollDown();
}

// ════════════════════════════════════════════════════════
//  LICZNIK PYTAŃ
// ════════════════════════════════════════════════════════

function calculateQuestions() {
  if (!currentUser) return;
  const all = getChats();
  let total = 0;
  all.forEach(c => {
    total += (c.messages || []).filter(m => m.role === 'user').length;
  });
  totalQuestions = total;
  document.getElementById('question-count').textContent = total;
}

// ════════════════════════════════════════════════════════
//  MINI LEADERBOARD (MongoDB)
// ════════════════════════════════════════════════════════

async function updateMiniLb() {
  try {
    const res  = await fetch('/api/leaderboard');
    const data = await res.json();
    const el   = document.getElementById('mini-lb-list');

    if (!data.length) {
      el.innerHTML = '<div class="mini-lb-empty">Brak danych</div>';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = data.slice(0, 3).map((item, i) => `
      <div class="mini-lb-item">
        <span class="mini-lb-rank">${medals[i] || (i + 1) + '.'}</span>
        <span class="mini-lb-name">${esc(item.username)}</span>
        <span class="mini-lb-score">${item.score}</span>
      </div>
    `).join('');
  } catch (e) {
    console.warn('Leaderboard error:', e);
  }
}

// ════════════════════════════════════════════════════════
//  LEADERBOARD PANEL (statystyki sesji)
// ════════════════════════════════════════════════════════

function openLeaderboard() {
  const v = sessionVotes;
  const total = Object.values(v).reduce((a, b) => a + b, 0);
  document.getElementById('lb-sub').textContent = `Łącznie głosowań w tej sesji: ${total}`;

  if (total === 0) {
    document.getElementById('lb-content').innerHTML = '<div class="lb-empty">Brak głosowań — zadaj pytanie i oceń odpowiedzi.</div>';
  } else {
    const pct = n => total > 0 ? Math.round((n / total) * 100) : 0;
    const rows = [
      { label: `A: Dobre / B: Błąd`,         val: v.A_OK_B_BAD,  color: '#3b82f6' },
      { label: `Oba poprawne → Lewy (A)`,     val: v.A,           color: '#10a37f' },
      { label: `Oba poprawne → Takie same`,   val: v.Tie_Phase2,  color: '#eab308' },
      { label: `Oba poprawne → Prawy (B)`,    val: v.B,           color: '#8b5cf6' },
      { label: `Oba słabe`,                   val: v.Bad,         color: '#ef4444' },
      { label: `B: Dobre / A: Błąd`,          val: v.B_OK_A_BAD,  color: '#f59e0b' },
    ].filter(r => r.val > 0).sort((a, b) => b.val - a.val);

    document.getElementById('lb-content').innerHTML = `
      <table class="lb-table">
        <thead><tr><th>Ocena</th><th>Głosy</th><th style="width:110px">Udział</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td>${r.label}</td>
            <td class="lb-count">${r.val} <span style="color:var(--text3);font-weight:400">(${pct(r.val)}%)</span></td>
            <td><div class="lb-bar-wrap"><div class="lb-bar" style="width:${pct(r.val)}%;background:${r.color}"></div></div></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  document.getElementById('lb-panel').classList.add('open');
}

function closeLeaderboard() {
  document.getElementById('lb-panel').classList.remove('open');
}

// ════════════════════════════════════════════════════════
//  NOWY CZAT / RESET
// ════════════════════════════════════════════════════════

function newChat() {
  // Nowy czat tylko gdy czat jest zablokowany (błąd zgłoszony) lub brak historii
  if (isVoting && !isLocked) {
    showToast('⚠ Najpierw oceń odpowiedzi agentów');
    return;
  }
  if (!isLocked && chatHistory.length > 0) {
    showToast('⚠ Nowy czat dostępny dopiero po zgłoszeniu błędu');
    return;
  }
  sessionId   = crypto.randomUUID();
  chatHistory = [];
  isVoting    = false;
  isLocked    = false;
  currentCardA = null;
  currentCardB = null;

  const area = document.getElementById('chat-area');
  area.innerHTML = '';

  // Przywróć empty state
  const es = document.createElement('div');
  es.id = 'empty-state';
  es.innerHTML = `
    <div class="empty-icon">⚔️</div>
    <div class="empty-title">RAG Arena</div>
    <p class="empty-sub">Zadaj pytanie — obaj agenci RAG odpowiedzą równocześnie. Zdecyduj który radzi sobie lepiej i zgłoś błędy.</p>
    <div class="empty-hints">
      <span class="hint-chip" onclick="useHint(this)">Potrzebuję samozamykacza</span>
      <span class="hint-chip" onclick="useHint(this)">Jakie zamki do drzwi zewnętrznych?</span>
      <span class="hint-chip" onclick="useHint(this)">Klamki do drzwi przesuwnych</span>
      <span class="hint-chip" onclick="useHint(this)">Zawiasy do drzwi drewnianych</span>
    </div>`;
  area.appendChild(es);

  document.getElementById('vote-bar').classList.remove('visible');
  document.getElementById('topbar-agents').style.display = 'none';
  document.getElementById('success-modal').classList.add('hidden');

  updateInputState();
  renderHistory();
  document.getElementById('chat-input').focus();
}

function resetChat() {
  document.getElementById('success-modal').classList.add('hidden');
  newChat();
}

// ════════════════════════════════════════════════════════
//  WYSYŁANIE WIADOMOŚCI
// ════════════════════════════════════════════════════════

function useHint(el) {
  document.getElementById('chat-input').value = el.textContent;
  autoResize(document.getElementById('chat-input'));
  sendMessage();
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const msg   = input.value.trim();
  if (!msg || isVoting || isLocked) return;

  // Ukryj empty state
  const es = document.getElementById('empty-state');
  if (es) es.style.display = 'none';

  input.value = '';
  autoResize(input);
  disableInput();
  document.getElementById('vote-bar').classList.remove('visible');

  appendUserBubble(msg);
  chatHistory.push({ role: 'user', content: msg });
  saveCurrentChat();
  calculateQuestions();

  lastQuery = msg;
  lastResponseA = ''; lastResponseB = '';
  lastLatencyA  = 0;  lastLatencyB  = 0;

  // Stwórz battle row z loading dots
  const turnId = Date.now();
  const idA = `body-a-${turnId}`;
  const idB = `body-b-${turnId}`;
  const cardIdA = `card-a-${turnId}`;
  const cardIdB = `card-b-${turnId}`;

  const turn = document.createElement('div');
  turn.className = 'msg-turn fade-up';
  turn.innerHTML = buildBattleRowHTML(cardIdA, cardIdB, idA, idB, null, null);
  document.getElementById('chat-area').appendChild(turn);
  document.getElementById('topbar-agents').style.display = 'flex';
  scrollDown();

  // Pobierz odpowiedzi równolegle
  const [rA, rB] = await Promise.allSettled([
    callChat(msg, 'A'),
    callChat(msg, 'B'),
  ]);

  // Agent A
  const bodyA = document.getElementById(idA);
  if (rA.status === 'fulfilled') {
    lastResponseA = rA.value.output;
    lastLatencyA  = rA.value.latency;
    setLatencyBadge(cardIdA, lastLatencyA);
    typewriter(bodyA, lastResponseA);
  } else {
    bodyA.innerHTML = errMsg(NAME_A, rA.reason);
  }

  // Agent B
  const bodyB = document.getElementById(idB);
  if (rB.status === 'fulfilled') {
    lastResponseB = rB.value.output;
    lastLatencyB  = rB.value.latency;
    setLatencyBadge(cardIdB, lastLatencyB);
    typewriter(bodyB, lastResponseB);
  } else {
    bodyB.innerHTML = errMsg(NAME_B, rB.reason);
  }

  // Zapisz w historii
  chatHistory.push({
    role: 'battle',
    contentA: lastResponseA, contentB: lastResponseB,
    latencyA: lastLatencyA,  latencyB: lastLatencyB,
  });
  saveCurrentChat();

  // Zapamiętaj karty
  currentCardA = document.getElementById(cardIdA);
  currentCardB = document.getElementById(cardIdB);

  // Pokaż głosowanie
  isVoting = true;
  showVotePhase1();
  updateInputState();

  scrollDown();
}

async function callChat(message, model) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, model, user: currentUser }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();  // { output, latency }
}

// ════════════════════════════════════════════════════════
//  BUDOWANIE HTML KART
// ════════════════════════════════════════════════════════

function buildBattleRowHTML(cardIdA, cardIdB, idA, idB, latencyA, latencyB) {
  return `
    <div class="battle-row">
      ${buildCardHTML('a', NAME_A, cardIdA, idA, latencyA)}
      ${buildCardHTML('b', NAME_B, cardIdB, idB, latencyB)}
    </div>`;
}

function buildCardHTML(side, name, cardId, bodyId, latency) {
  const badge = latency !== null ? `<span class="latency-badge" id="lb-${cardId}">⏱ ${latency}s</span>` : `<span class="latency-badge" id="lb-${cardId}" style="display:none"></span>`;
  const body  = latency !== null
    ? `<div class="agent-card-body" id="${bodyId}"></div>`
    : `<div class="agent-card-body" id="${bodyId}"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;

  return `
    <div class="agent-card" id="${cardId}">
      <div class="agent-card-header">
        <span class="agent-card-label ${side}">${esc(name)}</span>
        <div class="agent-card-actions">
          ${badge}
          <button class="card-action-btn" onclick="copyCard('${bodyId}')" title="Kopiuj odpowiedź">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
          </button>
        </div>
      </div>
      ${body}
    </div>`;
}

// Przy ładowaniu z historii — render od razu
function appendBattleRow(contentA, contentB, latencyA, latencyB) {
  const turnId = Date.now() + Math.random();
  const idA = `body-a-${turnId}`;
  const idB = `body-b-${turnId}`;
  const cardIdA = `card-a-${turnId}`;
  const cardIdB = `card-b-${turnId}`;

  const turn = document.createElement('div');
  turn.className = 'msg-turn';
  turn.innerHTML = buildBattleRowHTML(cardIdA, cardIdB, idA, idB, latencyA, latencyB);
  document.getElementById('chat-area').appendChild(turn);

  // Renderuj markdown od razu
  const bodyA = document.getElementById(idA);
  const bodyB = document.getElementById(idB);
  if (contentA) { bodyA.innerHTML = renderMd(contentA); postProcessLinks(bodyA); }
  if (contentB) { bodyB.innerHTML = renderMd(contentB); postProcessLinks(bodyB); }

  document.getElementById('topbar-agents').style.display = 'flex';

  return {
    cardA: document.getElementById(cardIdA),
    cardB: document.getElementById(cardIdB),
  };
}

function appendUserBubble(text) {
  const el = document.createElement('div');
  el.className = 'msg-turn fade-up';
  el.innerHTML = `<div class="user-wrap"><div class="user-bubble">${esc(text)}</div></div>`;
  document.getElementById('chat-area').appendChild(el);
  scrollDown();
}

function setLatencyBadge(cardId, latency) {
  const el = document.getElementById(`lb-${cardId}`);
  if (el) { el.textContent = `⏱ ${latency}s`; el.style.display = ''; }
}

function errMsg(name, reason) {
  return `<span style="color:#ef4444;font-size:12.5px">⚠ Błąd połączenia z ${esc(name)}: ${esc(String(reason))}</span>`;
}

// ════════════════════════════════════════════════════════
//  TYPEWRITER + MARKDOWN
// ════════════════════════════════════════════════════════

function typewriter(el, text) {
  el.innerHTML = '';
  el.classList.add('streaming-cursor');
  const delay = Math.max(4, Math.min(22, Math.floor(2200 / text.length)));
  let i = 0;
  const tick = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      scrollDown();
      setTimeout(tick, delay);
    } else {
      el.classList.remove('streaming-cursor');
      el.innerHTML = renderMd(text);
      postProcessLinks(el);
    }
  };
  tick();
}

function renderMd(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text));
  }
  // Fallback — własny parser
  return text
    .split('\n\n')
    .map(para => {
      const t = para.trim();
      if (t.startsWith('### ')) return `<p><strong>${esc(t.slice(4))}</strong></p>`;
      if (t.startsWith('## '))  return `<p><strong>${esc(t.slice(3))}</strong></p>`;
      if (t.startsWith('# '))   return `<p><strong>${esc(t.slice(2))}</strong></p>`;
      if (/^[-•*]\s/.test(t)) {
        const items = t.split('\n').filter(Boolean).map(l => `<li>${esc(l.replace(/^[-•*]\s*/,''))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${esc(para)}</p>`;
    })
    .join('')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function postProcessLinks(el) {
  el.querySelectorAll('a').forEach(a => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
}

// ════════════════════════════════════════════════════════
//  GŁOSOWANIE — FAZA 1 I 2
// ════════════════════════════════════════════════════════

function showVotePhase1() {
  const bar = document.getElementById('vote-bar');
  bar.classList.add('visible');
  document.getElementById('vote-phase-1').classList.remove('phase2-hidden');
  document.getElementById('vote-phase-2').classList.add('phase2-hidden');
  document.getElementById('vote-label').textContent = 'Oceń odpowiedzi agentów';
  setVoteBtnsDisabled(false);
}

function showVotePhase2() {
  document.getElementById('vote-phase-1').classList.add('phase2-hidden');
  document.getElementById('vote-phase-2').classList.remove('phase2-hidden');
  document.getElementById('vote-label').textContent = 'Który agent odpowiedział lepiej?';
  // Re-enable tylko przyciski fazy 2
  document.querySelectorAll('#vote-phase-2 .vote-btn').forEach(b => b.disabled = false);
}

function setVoteBtnsDisabled(disabled) {
  document.querySelectorAll('.vote-btn').forEach(b => b.disabled = disabled);
}

function vote(winner) {
  if (!isVoting) return;
  // Upewnij się że karty są dostępne
  if (!currentCardA || !currentCardB) {
    const cards = document.querySelectorAll('.agent-card');
    if (cards.length >= 2) {
      const lastBattle = document.querySelector('.msg-turn:last-child .battle-row');
      if (lastBattle) {
        currentCardA = lastBattle.querySelector('.agent-card:nth-child(1)');
        currentCardB = lastBattle.querySelector('.agent-card:nth-child(2)');
      }
    }
  }
  setVoteBtnsDisabled(true);
  sessionVotes[winner] = (sessionVotes[winner] || 0) + 1;

  if (winner === 'Tie') {
    // Oba poprawne → faza 2
    applyClasses(currentCardA, 'success');
    applyClasses(currentCardB, 'success');
    showVotePhase2();
    return;
  }

  if (winner === 'Bad') {
    applyClasses(currentCardA, 'error');
    applyClasses(currentCardB, 'error');
    openErrorModal('Bad');
    return;
  }

  if (winner === 'A_OK_B_BAD') {
    applyClasses(currentCardA, 'success');
    applyClasses(currentCardB, 'error');
    openErrorModal('B');
    return;
  }

  if (winner === 'B_OK_A_BAD') {
    applyClasses(currentCardB, 'success');
    applyClasses(currentCardA, 'error');
    openErrorModal('A');
    return;
  }

  // Faza 2 — preferencja
  if (winner === 'A') {
    applyClasses(currentCardA, 'success');
    applyClasses(currentCardB, 'error');
    addWinnerStar(currentCardA);
  } else if (winner === 'B') {
    applyClasses(currentCardB, 'success');
    applyClasses(currentCardA, 'error');
    addWinnerStar(currentCardB);
  } else if (winner === 'Tie_Phase2') {
    applyClasses(currentCardA, 'success');
    applyClasses(currentCardB, 'success');
  }

  saveVoteToHistory(winner);
  sendFeedbackData(winner, null, 'preference');
  finishVoting();
}

function applyClasses(card, type) {
  if (!card) return;
  card.classList.remove('success-card', 'error-card');
  if (type === 'success') card.classList.add('success-card');
  if (type === 'error')   card.classList.add('error-card');
}

function applyVoteColors(cardA, cardB, winner) {
  if (winner === 'Tie' || winner === 'Tie_Phase2') {
    applyClasses(cardA, 'success'); applyClasses(cardB, 'success');
  } else if (winner === 'Bad') {
    applyClasses(cardA, 'error');   applyClasses(cardB, 'error');
  } else if (winner === 'A_OK_B_BAD') {
    applyClasses(cardA, 'success'); applyClasses(cardB, 'error');
  } else if (winner === 'B_OK_A_BAD') {
    applyClasses(cardB, 'success'); applyClasses(cardA, 'error');
  } else if (winner === 'A') {
    applyClasses(cardA, 'success'); applyClasses(cardB, 'error');
    addWinnerStar(cardA);
  } else if (winner === 'B') {
    applyClasses(cardB, 'success'); applyClasses(cardA, 'error');
    addWinnerStar(cardB);
  }
}

function addWinnerStar(card) {
  const label = card.querySelector('.agent-card-label');
  if (label && !label.querySelector('.winner-star')) {
    label.innerHTML += ' <span class="winner-star">★</span>';
  }
}

function finishVoting() {
  isVoting = false;
  document.getElementById('vote-bar').classList.remove('visible');
  updateInputState();
  document.getElementById('chat-input').focus();
  showToast('✓ Głos zapisany');
}

function saveVoteToHistory(winner) {
  const last = chatHistory.filter(m => m.role === 'battle').pop();
  if (last) last.vote_winner = winner;
  saveCurrentChat();
}

// ════════════════════════════════════════════════════════
//  MODAL BŁĘDU
// ════════════════════════════════════════════════════════

function openErrorModal(mode) {
  // mode: 'Bad' | 'A' | 'B'
  feedbackMode = mode;

  // Reset pól
  document.getElementById('error-note-a').value = '';
  document.getElementById('error-note-b').value = '';
  document.querySelectorAll('input[name="rating-a"], input[name="rating-b"]').forEach(r => r.checked = false);

  const colA     = document.getElementById('error-col-a');
  const colB     = document.getElementById('error-col-b');
  const divider  = document.getElementById('error-modal-divider');
  const box      = document.getElementById('error-modal-box');

  // Pokaż kolumnę tego agenta który popełnił błąd
  // mode='A' → Agent A ma błąd → pokazujemy colA
  // mode='B' → Agent B ma błąd → pokazujemy colB
  // mode='Bad' → obaj mają błąd → pokazujemy obie
  colA.style.display     = (mode === 'Bad' || mode === 'A') ? '' : 'none';
  colB.style.display     = (mode === 'Bad' || mode === 'B') ? '' : 'none';
  divider.style.display  = mode === 'Bad' ? '' : 'none';
  box.style.width        = mode === 'Bad' ? '680px' : '380px';

  document.getElementById('error-modal').classList.remove('hidden');
}

function cancelError() {
  document.getElementById('error-modal').classList.add('hidden');
  // Przywróć karty do neutralnego
  applyClasses(currentCardA, null);
  applyClasses(currentCardB, null);
  // Wróć do głosowania
  showVotePhase1();
  setVoteBtnsDisabled(false);
}

async function submitError() {
  const noteA   = document.getElementById('error-note-a').value;
  const noteB   = document.getElementById('error-note-b').value;
  const starA   = document.querySelector('input[name="rating-a"]:checked')?.value || '0';
  const starB   = document.querySelector('input[name="rating-b"]:checked')?.value || '0';

  const starLabels = { '0':'Brak oceny','1':'⭐','2':'⭐⭐','3':'⭐⭐⭐','4':'⭐⭐⭐⭐','5':'💥 Krytyczny' };

  const details = {
    A: { note: noteA, stars: starLabels[starA] },
    B: { note: noteB, stars: starLabels[starB] },
  };

  const maxSeverity = Math.max(parseInt(starA), parseInt(starB));

  // Mapuj feedbackMode na finalny winner
  const winnerMap = { Bad: 'Bad', A: 'B_OK_A_BAD', B: 'A_OK_B_BAD' };
  const finalWinner = winnerMap[feedbackMode] || 'Bad';

  saveVoteToHistory(finalWinner);
  document.getElementById('error-modal').classList.add('hidden');

  await sendFeedbackData(finalWinner, details, 'error_report');
  lockChat(maxSeverity);
  showSuccessModal('fresh');
}

// ════════════════════════════════════════════════════════
//  ZABLOKOWANIE CZATU
// ════════════════════════════════════════════════════════

function lockChat(severity) {
  isLocked = true;
  isVoting = false;
  document.getElementById('vote-bar').classList.remove('visible');

  // Zaktualizuj tytuł w historii
  const all = getChats();
  const idx = all.findIndex(c => c.id === sessionId);
  if (idx !== -1) {
    all[idx].isLocked  = true;
    all[idx].severity  = severity;
    all[idx].title     = severity >= 5 ? '💥 BŁĄD KRYTYCZNY' : `Zgłoszenie błędu ${'⭐'.repeat(Math.max(1, severity))}`;
    saveChats(all);
  }

  updateInputState();
  renderHistory();
  updateMiniLb();
}

// ════════════════════════════════════════════════════════
//  SUCCESS MODAL
// ════════════════════════════════════════════════════════

function showSuccessModal(mode) {
  const modal     = document.getElementById('success-modal');
  const title     = document.getElementById('success-title');
  const sub       = document.getElementById('success-sub');
  const closeBtn  = document.getElementById('success-close-btn');

  if (mode === 'history') {
    title.textContent   = 'Archiwum błędu';
    sub.textContent     = 'Przeglądasz zablokowane zgłoszenie. Czat jest zarchiwizowany.';
    closeBtn.style.display = '';
  } else {
    title.textContent   = 'Gratulacje!';
    sub.textContent     = 'Dziękujemy za znalezienie błędu. Ten czat jest zablokowany.';
    closeBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

function closeSuccessModal() {
  document.getElementById('success-modal').classList.add('hidden');
}

// ════════════════════════════════════════════════════════
//  FEEDBACK — WYSYŁANIE DO BACKENDU
// ════════════════════════════════════════════════════════

async function sendFeedbackData(winner, errorDetails, voteType) {
  // Buduj pełną historię tekstu
  const histA = [], histB = [];
  chatHistory.forEach(m => {
    if (m.role === 'user') {
      histA.push(`👤 USER:\n${m.content}`);
      histB.push(`👤 USER:\n${m.content}`);
    } else if (m.role === 'battle') {
      histA.push(`🤖 AGENT A:\n${m.contentA}`);
      histB.push(`🤖 AGENT B:\n${m.contentB}`);
    }
  });
  const sep = '\n\n━━━━━━━━━━━━━━━━━━\n\n';

  // Status labels
  const statusMap = {
    'A_OK_B_BAD':  { A: 'WYGRANA 🏆', B: 'BŁĄD ❌' },
    'B_OK_A_BAD':  { A: 'BŁĄD ❌',    B: 'WYGRANA 🏆' },
    'Bad':         { A: '.',           B: '.' },
    'A':           { A: 'WYGRANA 🏆', B: 'PRZEGRANA' },
    'B':           { A: 'PRZEGRANA',  B: 'WYGRANA 🏆' },
    'Tie':         { A: 'REMIS 🤝',   B: 'REMIS 🤝' },
    'Tie_Phase2':  { A: 'REMIS 🤝',   B: 'REMIS 🤝' },
  };
  const status = statusMap[winner] || { A: '.', B: '.' };

  const payload = {
    user:                   currentUser,
    sessionId:              sessionId,
    winner:                 winner,
    vote_type:              voteType,
    query:                  lastQuery,
    response_A:             lastResponseA,
    response_B:             lastResponseB,
    status_A:               status.A,
    status_B:               status.B,
    latency_A:              lastLatencyA,
    latency_B:              lastLatencyB,
    user_total_questions:   totalQuestions,
    full_history_A:         histA.join(sep),
    full_history_B:         histB.join(sep),
    chat_history_json:      chatHistory,
    timestamp:              new Date().toISOString(),
  };

  if (errorDetails) payload.error_details = errorDetails;

  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Feedback error:', e);
  }
}

// ════════════════════════════════════════════════════════
//  RENAME
// ════════════════════════════════════════════════════════

function openRename(id, event) {
  event.stopPropagation();
  const all  = getChats();
  const chat = all.find(c => c.id === id);
  if (!chat) return;

  document.getElementById('rename-input').value   = chat.title;
  document.getElementById('rename-chat-id').value = id;
  document.getElementById('rename-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('rename-input').focus(), 50);
}

function closeRename() {
  document.getElementById('rename-modal').classList.add('hidden');
}

function renameKey(e) {
  if (e.key === 'Enter') submitRename();
  if (e.key === 'Escape') closeRename();
}

function submitRename() {
  const id       = document.getElementById('rename-chat-id').value;
  const newTitle = document.getElementById('rename-input').value.trim();
  if (!id || !newTitle) return;

  const all = getChats();
  const idx = all.findIndex(c => c.id === id);
  if (idx !== -1) {
    all[idx].title = newTitle;
    saveChats(all);
    renderHistory();
  }
  closeRename();
}

// ════════════════════════════════════════════════════════
//  INPUT STATE
// ════════════════════════════════════════════════════════

function updateInputState() {
  const box   = document.getElementById('input-area').querySelector('.input-box');
  const input = document.getElementById('chat-input');
  const btn   = document.getElementById('send-btn');

  if (isLocked) {
    input.disabled = true;
    btn.disabled   = true;
    input.placeholder = 'Test zakończony — czat zablokowany.';
    box.style.opacity = '0.4';
    return;
  }

  if (isVoting) {
    input.disabled = true;
    btn.disabled   = true;
    input.placeholder = 'Oceń odpowiedzi, aby kontynuować…';
    box.style.opacity = '0.5';
    return;
  }

  input.disabled = false;
  btn.disabled   = false;
  input.placeholder = 'Zadaj pytanie obu agentom…';
  box.style.opacity = '1';
}

function disableInput() {
  document.getElementById('chat-input').disabled = true;
  document.getElementById('send-btn').disabled   = true;
}

// ════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  // Ignoruj gdy jesteś w inpucie / textarei
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (!isVoting) return;

  const p1Hidden = document.getElementById('vote-phase-1').classList.contains('phase2-hidden');
  const p2Hidden = document.getElementById('vote-phase-2').classList.contains('phase2-hidden');

  if (!p1Hidden) {
    if (e.key === '1') { e.preventDefault(); vote('A_OK_B_BAD'); }
    if (e.key === '2') { e.preventDefault(); vote('Tie'); }
    if (e.key === '3') { e.preventDefault(); vote('Bad'); }
    if (e.key === '4') { e.preventDefault(); vote('B_OK_A_BAD'); }
  } else if (!p2Hidden) {
    const k = e.key.toLowerCase();
    if (k === 'a' || e.key === 'ArrowLeft')  { e.preventDefault(); vote('A'); }
    if (k === 's')                            { e.preventDefault(); vote('Tie_Phase2'); }
    if (k === 'b' || e.key === 'ArrowRight') { e.preventDefault(); vote('B'); }
  }
});

// Escape zamyka modals i panel
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLeaderboard();
    closeRename();
  }
});

// Klik w tło zamyka panele
document.getElementById('lb-panel').addEventListener('click', e => {
  if (e.target.id === 'lb-panel') closeLeaderboard();
});
document.getElementById('rename-modal').addEventListener('click', e => {
  if (e.target.id === 'rename-modal') closeRename();
});

// ════════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════════

function scrollDown() {
  const ca = document.getElementById('chat-area');
  ca.scrollTop = ca.scrollHeight;
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function copyCard(id) {
  const el = document.getElementById(id);
  navigator.clipboard.writeText(el?.innerText || '')
    .then(() => showToast('✓ Skopiowano'));
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ════════════════════════════════════════════════════════
//  INIT — pokazuj login, reszta po zalogowaniu
// ════════════════════════════════════════════════════════
document.getElementById('tag-a').textContent = NAME_A;
document.getElementById('tag-b').textContent = NAME_B;
