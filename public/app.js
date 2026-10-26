// IRCHub Teams - İstemci Motoru
const socket = io();

// Uygulama Durumu (State)
const state = {
  servers: [],
  activeServerId: null,
  activeTarget: null, // '#sohbet' veya 'Ahmet'
  lastChannel: null, // Kullanıcı listesini sabit tutmak için son kanal
  users: {}, // { [serverId]: { [channel]: { [nick]: { prefix } } } }
  messages: {}, // { [serverId]: { [target]: [] } }
  searchQuery: '',
  selectedColor: '',
};

// Web Audio API ile Özel Mesaj Bildirim Sesi
let audioCtx = null;
function playChime() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08); // A5
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {}
}

// Masaüstü / Telefon Bildirimi
function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/manifest.json' });
    } catch (e) {}
  }
}
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// Bildirim Balonu (Toast)
function showToast(message) {
  let toast = document.getElementById('irchubToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'irchubToast';
    toast.style.cssText = 'position:fixed; top:20px; right:20px; z-index:999999; background:#1e293b; color:#f8fafc; border:1px solid #334155; border-left:4px solid #5865f2; padding:12px 18px; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.5); font-size:13px; max-width:360px; font-weight:500; transition:all 0.3s ease;';
    document.body.appendChild(toast);
  }
  toast.innerText = message;
  toast.style.opacity = '1';
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 4000);
}

// DOM Elemanları
const serverIconsContainer = document.getElementById('serverIconsContainer');
const openAddServerBtn = document.getElementById('openAddServerBtn');
const activeServerNameEl = document.getElementById('activeServerName');
const activeServerNickEl = document.getElementById('activeServerNick');
const openChangeNickBtn = document.getElementById('openChangeNickBtn');
const toggleConnectBtn = document.getElementById('toggleConnectBtn');
const editServerBtn = document.getElementById('editServerBtn');
const dmListContainer = document.getElementById('dmListContainer');
const channelListContainer = document.getElementById('channelListContainer');
const openNewDmModalBtn = document.getElementById('openNewDmModalBtn');
const openJoinChannelModalBtn = document.getElementById('openJoinChannelModalBtn');
const chatTargetIcon = document.getElementById('chatTargetIcon');
const chatTargetTitle = document.getElementById('chatTargetTitle');
const chatTargetDesc = document.getElementById('chatTargetDesc');
const toggleUsersBtn = document.getElementById('toggleUsersBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const phoneLinkBtn = document.getElementById('phoneLinkBtn');
const phoneModal = document.getElementById('phoneModal');
const closePhoneModalBtn = document.getElementById('closePhoneModalBtn');
const cancelPhoneModalBtn = document.getElementById('cancelPhoneModalBtn');
const phoneUrlText = document.getElementById('phoneUrlText');
const copyPhoneUrlBtn = document.getElementById('copyPhoneUrlBtn');
let currentTunnelUrl = null;
const messagesList = document.getElementById('messagesList');
const chatInput = document.getElementById('chatInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const userSidebar = document.getElementById('userSidebar');
const usersHeaderTitle = document.getElementById('usersHeaderTitle');
const closeUsersSidebarBtn = document.getElementById('closeUsersSidebarBtn');
const userSearchInput = document.getElementById('userSearchInput');
const userListScroll = document.getElementById('userListScroll');

// Modallar
const nickModal = document.getElementById('nickModal');
const closeNickModalBtn = document.getElementById('closeNickModalBtn');
const cancelNickModalBtn = document.getElementById('cancelNickModalBtn');
const saveNickBtn = document.getElementById('saveNickBtn');
const newNickInput = document.getElementById('newNickInput');

const newDmModal = document.getElementById('newDmModal');
const closeNewDmModalBtn = document.getElementById('closeNewDmModalBtn');
const cancelNewDmModalBtn = document.getElementById('cancelNewDmModalBtn');
const startNewDmBtn = document.getElementById('startNewDmBtn');
const newDmNickInput = document.getElementById('newDmNickInput');

const joinChannelModal = document.getElementById('joinChannelModal');
const closeJoinChannelModalBtn = document.getElementById('closeJoinChannelModalBtn');
const cancelJoinChannelModalBtn = document.getElementById('cancelJoinChannelModalBtn');
const confirmJoinChannelBtn = document.getElementById('confirmJoinChannelBtn');
const channelNameInput = document.getElementById('channelNameInput');

const serverModal = document.getElementById('serverModal');
const closeServerModalBtn = document.getElementById('closeServerModalBtn');
const cancelServerModalBtn = document.getElementById('cancelServerModalBtn');
const saveServerBtn = document.getElementById('saveServerBtn');
const deleteServerBtn = document.getElementById('deleteServerBtn');
const serverFormId = document.getElementById('serverFormId');
const serverFormName = document.getElementById('serverFormName');
const serverFormHost = document.getElementById('serverFormHost');
const serverFormPort = document.getElementById('serverFormPort');
const serverFormSsl = document.getElementById('serverFormSsl');
const serverFormNick = document.getElementById('serverFormNick');
const serverFormPass = document.getElementById('serverFormPass');
const serverFormChannels = document.getElementById('serverFormChannels');
const serverFormAutoConnect = document.getElementById('serverFormAutoConnect');

// Mobil Alt Butonlar
const navBtnServers = document.getElementById('navBtnServers');
const navBtnChats = document.getElementById('navBtnChats');
const navBtnMessage = document.getElementById('navBtnMessage');
const navBtnUsers = document.getElementById('navBtnUsers');
const serverBar = document.getElementById('serverBar');
const channelSidebar = document.getElementById('channelSidebar');
const chatContainer = document.getElementById('chatContainer');

// Yardımcı: mIRC Renk Kodları Çözücü
function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text || '';
  return div.innerHTML;
}

function parseMircColors(str) {
  if (!str) return '';
  const colorMap = {
    '0': '#ffffff', '00': '#ffffff',
    '1': '#222222', '01': '#222222',
    '2': '#2563eb', '02': '#2563eb',
    '3': '#16a34a', '03': '#16a34a',
    '4': '#ef4444', '04': '#ef4444',
    '5': '#991b1b', '05': '#991b1b',
    '6': '#a855f7', '06': '#a855f7',
    '7': '#f97316', '07': '#f97316',
    '8': '#eab308', '08': '#eab308',
    '9': '#84cc16', '09': '#84cc16',
    '10': '#06b6d4',
    '11': '#38bdf8',
    '12': '#3b82f6',
    '13': '#ec4899',
    '14': '#9ca3af',
    '15': '#e5e7eb'
  };

  const stripped = str.replace(/[\x02\x1F\x16\x1D]/g, '');
  const parts = stripped.split('\x03');
  let html = escapeHtml(parts[0]);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) {
      html += '</span>';
      continue;
    }
    const match = part.match(/^(\d{1,2})(?:,(\d{1,2}))?(.*)$/s);
    if (match) {
      const code = match[1];
      const rest = match[3] || '';
      const col = colorMap[code] || '#ffffff';
      html += `<span style="color:${col}; font-weight:600;">${escapeHtml(rest)}</span>`;
    } else {
      html += escapeHtml(part);
    }
  }
  return html.replace(/\x0F/g, '');
}

function cleanMircColors(str) {
  if (!str) return '';
  return str
    .replace(/\x03\d{1,2}(,\d{1,2})?/g, '')
    .replace(/[\x02\x1F\x16\x0F\x1D]/g, '');
}

// Rumuz için Tutarlı Renk Üreteci
function getNickColor(nick) {
  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
    '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'
  ];
  let hash = 0;
  for (let i = 0; i < (nick || '').length; i++) {
    hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getActiveServer() {
  return state.servers.find((s) => s.id === state.activeServerId);
}

function getChannelUsers(serverId, channel) {
  if (!serverId || !channel) return {};
  const srvUsers = state.users[serverId] || {};
  if (srvUsers[channel] && Object.keys(srvUsers[channel]).length > 0) return srvUsers[channel];
  const matchKey = Object.keys(srvUsers).find((k) => k.toLowerCase() === channel.toLowerCase());
  return (matchKey && srvUsers[matchKey]) ? srvUsers[matchKey] : (srvUsers[channel] || {});
}

// SOCKET OLAYLARI
socket.on('tunnel_url', ({ url }) => {
  currentTunnelUrl = url;
  if (phoneUrlText) {
    phoneUrlText.innerText = url || 'Tünel bağlanıyor, lütfen birkaç saniye bekleyin...';
  }
});

socket.on('state', (servers) => {
  state.servers = servers;

  // Kullanıcı listelerini doldur
  servers.forEach((srv) => {
    if (!state.users[srv.id]) state.users[srv.id] = {};
    (srv.channels || []).forEach((ch) => {
      if (ch.users && Object.keys(ch.users).length > 0) {
        state.users[srv.id][ch.name] = ch.users;
      }
    });
  });

  if (!state.activeServerId && servers.length > 0) {
    state.activeServerId = servers[0].id;
    const srv = servers[0];
    if (srv.channels && srv.channels.length > 0) {
      state.activeTarget = srv.channels[0].name;
      state.lastChannel = srv.channels[0].name;
    }
  }

  renderAll();

  if (state.activeServerId && state.activeTarget) {
    socket.emit('get_messages', { serverId: state.activeServerId, target: state.activeTarget });
    if (state.activeTarget.startsWith('#')) {
      socket.emit('get_users', { serverId: state.activeServerId, channel: state.activeTarget });
    }
  }
});

socket.on('status_changed', ({ serverId, status, message, nick }) => {
  const srv = state.servers.find((s) => s.id === serverId);
  if (srv) {
    srv.status = status;
    if (nick) srv.currentNick = nick;
    if (status === 'disconnected') {
      if (state.messages[serverId]) state.messages[serverId] = {};
      srv.directMessages = [];
      (srv.channels || []).forEach((ch) => (ch.userCount = 0));
    }
  }
  renderAll();
});

socket.on('nick_changed', ({ serverId, oldNick, newNick }) => {
  const srv = state.servers.find((s) => s.id === serverId);
  if (srv && srv.currentNick && srv.currentNick.toLowerCase() === oldNick.toLowerCase()) {
    srv.currentNick = newNick;
    showToast(`Rumuzunuz ${newNick} olarak değiştirildi`);
  }
  renderSidebar();
});

socket.on('channel_error', ({ serverId, channel, message }) => {
  showToast(`[Kanal Bildirimi] ${channel ? channel + ': ' : ''}${message}`);
});

socket.on('irc_notice', ({ serverId, from, text }) => {
  const srv = state.servers.find((s) => s.id === serverId);
  const serverName = srv ? srv.name : 'IRC';
  showToast(`[${serverName} - ${from}] ${cleanMircColors(text)}`);

  if (state.activeServerId === serverId && messagesList) {
    const noticeEl = document.createElement('div');
    noticeEl.className = 'system-notice';
    noticeEl.innerHTML = `<strong>[${escapeHtml(from)}]</strong> ${parseMircColors(text)}`;
    messagesList.appendChild(noticeEl);
    messagesList.scrollTop = messagesList.scrollHeight;
  }
});

socket.on('irc_error', ({ serverId, target, message }) => {
  showToast(`[Uyarı] ${message}`);
  if (state.activeServerId === serverId && messagesList) {
    const noticeEl = document.createElement('div');
    noticeEl.className = 'system-notice';
    noticeEl.style.color = 'var(--danger)';
    noticeEl.innerHTML = `⚠️ ${escapeHtml(message)}`;
    messagesList.appendChild(noticeEl);
    messagesList.scrollTop = messagesList.scrollHeight;
  }
});

socket.on('channel_joined', ({ serverId, channel }) => {
  if (!channel || channel.toLowerCase() === '#karantina') return;
  const srv = state.servers.find((s) => s.id === serverId);
  if (srv) {
    let existing = srv.channels.find((c) => c.name.toLowerCase() === channel.toLowerCase());
    if (!existing) {
      existing = { name: channel, userCount: 0, unread: 0 };
      srv.channels.push(existing);
    }
    if (state.activeServerId === serverId && !state.activeTarget) {
      selectTarget(channel);
    }
  }
  renderSidebar();
});

socket.on('channel_parted', ({ serverId, channel }) => {
  const srv = state.servers.find((s) => s.id === serverId);
  if (srv) {
    srv.channels = srv.channels.filter((c) => c.name.toLowerCase() !== channel.toLowerCase());
    if (state.activeServerId === serverId && state.activeTarget && state.activeTarget.toLowerCase() === channel.toLowerCase()) {
      state.activeTarget = srv.channels[0] ? srv.channels[0].name : null;
      if (state.activeTarget && state.activeTarget.startsWith('#')) {
        state.lastChannel = state.activeTarget;
      }
    }
  }
  renderAll();
});

socket.on('dm_opened', ({ serverId, nick }) => {
  const srv = state.servers.find((s) => s.id === serverId);
  if (srv) {
    if (!srv.directMessages.some((d) => d.nick.toLowerCase() === nick.toLowerCase())) {
      srv.directMessages.push({ nick, unread: 0 });
    }
  }
  renderSidebar();
});

socket.on('dm_closed', ({ serverId, nick }) => {
  const srv = state.servers.find((s) => s.id === serverId);
  if (srv) {
    srv.directMessages = srv.directMessages.filter((d) => d.nick.toLowerCase() !== nick.toLowerCase());
    if (state.activeServerId === serverId && state.activeTarget && state.activeTarget.toLowerCase() === nick.toLowerCase()) {
      state.activeTarget = state.lastChannel || (srv.channels[0] ? srv.channels[0].name : null);
    }
  }
  renderAll();
});

socket.on('users_updated', ({ serverId, channel, users }) => {
  if (!state.users[serverId]) state.users[serverId] = {};
  state.users[serverId][channel] = users;

  const srv = state.servers.find((s) => s.id === serverId);
  if (srv) {
    const ch = srv.channels.find((c) => c.name.toLowerCase() === channel.toLowerCase());
    if (ch) ch.userCount = Object.keys(users || {}).length;
  }

  renderUsers();
  renderSidebar();
  renderChatHeader();
});

let renderUsersDebounceTimer = null;
function scheduleRenderUsers() {
  clearTimeout(renderUsersDebounceTimer);
  renderUsersDebounceTimer = setTimeout(() => {
    renderUsers();
  }, 400);
}

socket.on('user_joined', ({ serverId, channel, nick }) => {
  if (!state.users[serverId]) state.users[serverId] = {};
  const matchKey = Object.keys(state.users[serverId]).find((k) => k.toLowerCase() === channel.toLowerCase()) || channel;
  if (!state.users[serverId][matchKey]) state.users[serverId][matchKey] = {};
  state.users[serverId][matchKey][nick] = { prefix: '' };

  const srv = state.servers.find((s) => s.id === serverId);
  if (srv) {
    const ch = srv.channels.find((c) => c.name.toLowerCase() === channel.toLowerCase());
    if (ch) ch.userCount = Object.keys(state.users[serverId][matchKey]).length;
  }

  scheduleRenderUsers();
  renderSidebar();
  renderChatHeader();
});

socket.on('user_parted', ({ serverId, channel, nick }) => {
  if (!state.users[serverId]) return;
  const matchKey = Object.keys(state.users[serverId]).find((k) => k.toLowerCase() === channel.toLowerCase());
  if (matchKey && state.users[serverId][matchKey]) {
    delete state.users[serverId][matchKey][nick];

    const srv = state.servers.find((s) => s.id === serverId);
    if (srv) {
      const ch = srv.channels.find((c) => c.name.toLowerCase() === channel.toLowerCase());
      if (ch) ch.userCount = Object.keys(state.users[serverId][matchKey]).length;
    }

    scheduleRenderUsers();
    renderSidebar();
    renderChatHeader();
  }
});

socket.on('messages_loaded', ({ serverId, target, messages }) => {
  if (!state.messages[serverId]) state.messages[serverId] = {};
  const targetKey = Object.keys(state.messages[serverId]).find(
    (k) => k.toLowerCase() === (target || '').toLowerCase()
  ) || target;

  state.messages[serverId][targetKey] = messages;

  if (
    state.activeServerId === serverId &&
    state.activeTarget &&
    state.activeTarget.toLowerCase() === (target || '').toLowerCase()
  ) {
    renderMessages();
  }
});

socket.on('new_message', ({ serverId, chatTarget, message, isDM }) => {
  if (!state.messages[serverId]) state.messages[serverId] = {};

  const targetKey = Object.keys(state.messages[serverId]).find(
    (k) => k.toLowerCase() === (chatTarget || '').toLowerCase()
  ) || chatTarget;

  if (!state.messages[serverId][targetKey]) state.messages[serverId][targetKey] = [];
  state.messages[serverId][targetKey].push(message);

  const srv = state.servers.find((s) => s.id === serverId);

  // Gelen özel mesajsa DM listesine ekle
  if (isDM && srv) {
    if (!srv.directMessages.some((d) => d.nick.toLowerCase() === chatTarget.toLowerCase())) {
      srv.directMessages.push({ nick: chatTarget, unread: 0 });
    }
  }

  // Aktif olarak bakılıyor mu?
  const isCurrentlyViewing =
    state.activeServerId === serverId &&
    state.activeTarget &&
    state.activeTarget.toLowerCase() === (chatTarget || '').toLowerCase();

  if (isCurrentlyViewing) {
    renderMessages();
    socket.emit('get_messages', { serverId, target: state.activeTarget });
  } else {
    // Okunmamış sayaç artışı
    if (srv) {
      if (isDM) {
        const dm = srv.directMessages.find((d) => d.nick.toLowerCase() === chatTarget.toLowerCase());
        if (dm) dm.unread += 1;
      } else {
        const ch = srv.channels.find((c) => c.name.toLowerCase() === chatTarget.toLowerCase());
        if (ch) ch.unread += 1;
      }
    }
    renderServerBar();
    renderSidebar();
  }

  // Gelen DM için ses ve masaüstü bildirimi
  if (isDM && !message.isSelf) {
    playChime();
    showNotification(`Yeni Özel Mesaj [${srv ? srv.name : 'IRC'}]`, `${message.from}: ${cleanMircColors(message.text)}`);
  }
});

// ARAYÜZ ÇİZİM FONKSİYONLARI (RENDER)
function renderAll() {
  renderServerBar();
  renderSidebar();
  renderChatHeader();
  renderMessages();
  renderUsers();
}

function renderServerBar() {
  serverIconsContainer.innerHTML = '';
  state.servers.forEach((srv) => {
    const icon = document.createElement('div');
    icon.className = `server-icon ${srv.id === state.activeServerId ? 'active' : ''}`;
    icon.title = `${srv.name} (${srv.host})`;

    const initials = srv.name.slice(0, 2).toUpperCase();
    icon.innerText = initials;

    // Durum Noktası
    const dot = document.createElement('div');
    dot.className = `server-status-dot dot-${srv.status || 'disconnected'}`;
    icon.appendChild(dot);

    // Toplam Okunmamış Rozeti
    let totalUnread = 0;
    (srv.directMessages || []).forEach((d) => (totalUnread += d.unread || 0));
    (srv.channels || []).forEach((c) => (totalUnread += c.unread || 0));

    if (totalUnread > 0) {
      const badge = document.createElement('div');
      badge.className = 'server-badge';
      badge.innerText = totalUnread > 99 ? '99+' : totalUnread;
      icon.appendChild(badge);
    }

    icon.addEventListener('click', () => {
      selectServer(srv.id);
    });

    serverIconsContainer.appendChild(icon);
  });
}

function selectServer(serverId) {
  state.activeServerId = serverId;
  const srv = getActiveServer();
  if (srv) {
    if (srv.channels && srv.channels.length > 0) {
      state.activeTarget = srv.channels[0].name;
      state.lastChannel = srv.channels[0].name;
    } else if (srv.directMessages && srv.directMessages.length > 0) {
      state.activeTarget = srv.directMessages[0].nick;
    } else {
      state.activeTarget = null;
    }
  }
  renderAll();

  if (state.activeTarget) {
    socket.emit('get_messages', { serverId: state.activeServerId, target: state.activeTarget });
    if (state.activeTarget.startsWith('#')) {
      socket.emit('get_users', { serverId: state.activeServerId, channel: state.activeTarget });
    }
  }
}

function renderSidebarHeader() {
  const srv = getActiveServer();
  if (!srv) {
    activeServerNameEl.innerText = 'Sunucu Yok';
    activeServerNickEl.innerText = '-';
    toggleConnectBtn.style.display = 'none';
    return;
  }

  activeServerNameEl.innerText = srv.name;
  activeServerNickEl.innerText = srv.currentNick || srv.nick || 'Misafir';
  toggleConnectBtn.style.display = 'block';

  if (srv.status === 'connected') {
    toggleConnectBtn.innerText = 'Bağlantıyı Kes';
    toggleConnectBtn.className = 'toggle-connect-btn btn-disconnect';
  } else if (srv.status === 'connecting') {
    toggleConnectBtn.innerText = 'Bağlanılıyor...';
    toggleConnectBtn.className = 'toggle-connect-btn btn-disconnect';
  } else {
    toggleConnectBtn.innerText = 'Bağlan';
    toggleConnectBtn.className = 'toggle-connect-btn btn-connect';
  }
}

function renderSidebar() {
  renderSidebarHeader();
  const srv = getActiveServer();
  if (!srv) {
    dmListContainer.innerHTML = '';
    channelListContainer.innerHTML = '';
    return;
  }

  // KANALLAR
  channelListContainer.innerHTML = '';
  const visibleChannels = (srv.channels || []).filter((ch) => ch.name.toLowerCase() !== '#karantina');
  if (visibleChannels.length === 0) {
    channelListContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:6px 10px;">Henüz kanal yok</div>';
  } else {
    visibleChannels.forEach((ch) => {
      const isCurrent = state.activeTarget && state.activeTarget.toLowerCase() === ch.name.toLowerCase();
      const item = document.createElement('div');
      item.className = `sidebar-item ${isCurrent ? 'active' : ''}`;

      const name = document.createElement('span');
      name.className = 'item-name';
      name.innerText = ch.name;
      item.appendChild(name);

      if (ch.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'item-badge';
        badge.innerText = ch.unread;
        item.appendChild(badge);
      } else if (ch.userCount > 0) {
        const count = document.createElement('span');
        count.className = 'item-count';
        count.innerText = ch.userCount;
        item.appendChild(count);
      }

      // KANALDAN AYRIL / KAPAT BUTONU (✕)
      const closeBtn = document.createElement('button');
      closeBtn.className = 'close-item-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Kanalı Kapat';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('part_channel', { serverId: srv.id, channel: ch.name });
      });
      item.appendChild(closeBtn);

      item.addEventListener('click', () => {
        selectTarget(ch.name);
      });

      channelListContainer.appendChild(item);
    });
  }

  // ÖZEL MESAJLAR (DM)
  dmListContainer.innerHTML = '';
  if (!srv.directMessages || srv.directMessages.length === 0) {
    dmListContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:6px 10px;">Özel mesaj yok</div>';
  } else {
    srv.directMessages.forEach((dm) => {
      const isCurrent = state.activeTarget && state.activeTarget.toLowerCase() === dm.nick.toLowerCase();
      const item = document.createElement('div');
      item.className = `sidebar-item ${isCurrent ? 'active' : ''}`;

      const avatar = document.createElement('div');
      avatar.className = 'item-avatar';
      avatar.style.backgroundColor = getNickColor(dm.nick);
      avatar.style.color = '#fff';
      avatar.innerText = dm.nick.slice(0, 1).toUpperCase();
      item.appendChild(avatar);

      const name = document.createElement('span');
      name.className = 'item-name';
      name.innerText = dm.nick;
      item.appendChild(name);

      if (dm.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'item-badge';
        badge.innerText = dm.unread;
        item.appendChild(badge);
      }

      // ÖZEL MESAJI KAPAT BUTONU (✕)
      const closeBtn = document.createElement('button');
      closeBtn.className = 'close-item-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Sohbeti Kapat';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('close_dm', { serverId: srv.id, nick: dm.nick });
      });
      item.appendChild(closeBtn);

      item.addEventListener('click', () => {
        selectTarget(dm.nick);
      });

      dmListContainer.appendChild(item);
    });
  }
}

function selectTarget(target) {
  if (!target) return;
  state.activeTarget = target;
  if (target.startsWith('#')) {
    state.lastChannel = target;
  }
  renderSidebar();
  renderChatHeader();
  renderMessages();
  renderUsers();

  if (state.activeServerId && target) {
    socket.emit('get_messages', { serverId: state.activeServerId, target });
    if (target.startsWith('#')) {
      socket.emit('get_users', { serverId: state.activeServerId, channel: target });
    }
  }

  chatInput.focus();
}

function renderChatHeader() {
  const srv = getActiveServer();
  if (!state.activeTarget || !srv) {
    chatTargetIcon.innerText = '';
    chatTargetTitle.innerText = 'Sohbet Seçin';
    chatTargetDesc.innerText = 'Sol menüden bir kanal veya özel mesaj seçin';
    return;
  }

  const isChannel = state.activeTarget.startsWith('#');
  chatTargetIcon.innerText = isChannel ? '#' : '@';
  chatTargetTitle.innerText = state.activeTarget;

  if (isChannel) {
    const ch = srv.channels.find((c) => c.name.toLowerCase() === state.activeTarget.toLowerCase());
    const count = ch ? ch.userCount : 0;
    chatTargetDesc.innerText = `${srv.name} sunucusunda ${count} kullanıcı çevrim içi`;
  } else {
    chatTargetDesc.innerText = `${srv.name} sunucusunda ${state.activeTarget} ile özel mesajlaşma`;
  }
}

function renderMessages() {
  messagesList.innerHTML = '';
  if (!state.activeServerId || !state.activeTarget) {
    messagesList.innerHTML = '<div class="system-notice">Sohbete başlamak için bir kanal veya kişi seçin.</div>';
    return;
  }

  let msgs = [];
  if (state.messages[state.activeServerId]) {
    const srvMsgs = state.messages[state.activeServerId];
    if (srvMsgs[state.activeTarget]) {
      msgs = srvMsgs[state.activeTarget];
    } else {
      const matchKey = Object.keys(srvMsgs).find((k) => k.toLowerCase() === state.activeTarget.toLowerCase());
      msgs = matchKey ? srvMsgs[matchKey] : [];
    }
  }

  if (msgs.length === 0) {
    messagesList.innerHTML = `<div class="system-notice">${state.activeTarget} sohbetine hoş geldiniz. Henüz mesaj yok.</div>`;
    return;
  }

  msgs.forEach((m) => {
    const item = document.createElement('div');
    item.className = `message-item ${m.isSelf ? 'is-self' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.style.backgroundColor = getNickColor(m.from || '?');
    avatar.style.color = '#fff';
    avatar.innerText = (m.from || '?').slice(0, 1).toUpperCase();

    const content = document.createElement('div');
    content.className = 'msg-content';

    const header = document.createElement('div');
    header.className = 'msg-header';

    const author = document.createElement('span');
    author.className = 'msg-author';
    author.innerText = m.from;
    author.title = `${m.from} ile özel mesajlaşmak için tıklayın`;
    author.addEventListener('click', () => {
      if (!m.isSelf) {
        openDirectMessageWith(m.from);
      }
    });

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.innerText = m.time || '';

    header.appendChild(author);
    header.appendChild(time);

    const text = document.createElement('div');
    text.className = 'msg-text';
    text.innerHTML = parseMircColors(m.text);

    content.appendChild(header);
    content.appendChild(text);

    item.appendChild(avatar);
    item.appendChild(content);

    messagesList.appendChild(item);
  });

  messagesList.scrollTop = messagesList.scrollHeight;
}

// SAĞ KULLANICI LİSTESİ (Çevrim içi Kullanıcılar)
function renderUsers() {
  if (!state.activeServerId) return;

  const srv = getActiveServer();
  if (!srv) return;

  // Hangi kanalın kullanıcıları gösterilecek?
  let channelForUsers = null;
  if (state.activeTarget && state.activeTarget.startsWith('#')) {
    channelForUsers = state.activeTarget;
    state.lastChannel = state.activeTarget;
  } else if (state.lastChannel) {
    channelForUsers = state.lastChannel;
  } else if (srv.channels && srv.channels.length > 0) {
    channelForUsers = srv.channels[0].name;
    state.lastChannel = channelForUsers;
  }

  const usersObj = channelForUsers ? getChannelUsers(state.activeServerId, channelForUsers) : {};
  const userNicks = Object.keys(usersObj);

  if (state.activeTarget && state.activeTarget.startsWith('#')) {
    usersHeaderTitle.innerText = `Kullanıcılar (${userNicks.length})`;
  } else {
    usersHeaderTitle.innerText = `Kullanıcılar (${channelForUsers || 'Kanal'} - ${userNicks.length})`;
  }

  // Masaüstünde sağ panel daima açık (asla kaybolmaz)
  if (window.innerWidth > 640) {
    userSidebar.style.display = 'flex';
  } else {
    userSidebar.style.display = '';
  }

  // Kullanıcı aşağı kaydırırken başa dönmemesi için scroll konumunu sakla
  const prevScroll = userListScroll.scrollTop;

  userListScroll.innerHTML = '';

  // Arama filtrelemesi
  const query = state.searchQuery.toLowerCase();
  const filtered = userNicks.filter((n) => n.toLowerCase().includes(query));

  const ops = [];
  const voices = [];
  const regulars = [];

  filtered.forEach((nick) => {
    const pfx = (usersObj[nick] && usersObj[nick].prefix) || '';
    if (['@', '&', '~'].includes(pfx)) ops.push({ nick, pfx });
    else if (pfx === '%') ops.push({ nick, pfx });
    else if (pfx === '+') voices.push({ nick, pfx });
    else regulars.push({ nick, pfx: '' });
  });

  const renderGroup = (title, list) => {
    if (list.length === 0) return;
    const gTitle = document.createElement('div');
    gTitle.className = 'user-group-title';
    gTitle.innerText = `${title} — ${list.length}`;
    userListScroll.appendChild(gTitle);

    list.sort((a, b) => a.nick.localeCompare(b.nick, 'tr')).forEach(({ nick, pfx }) => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.title = `${nick} ile özel mesajlaşmak için tıklayın`;

      const badge = document.createElement('span');
      badge.className = `prefix-badge ${['@', '&', '~'].includes(pfx) ? 'prefix-op' : pfx === '%' ? 'prefix-halfop' : pfx === '+' ? 'prefix-voice' : ''}`;
      badge.innerText = pfx;

      const name = document.createElement('span');
      name.className = 'user-name';
      name.innerText = nick;

      const hint = document.createElement('span');
      hint.className = 'dm-hint';
      hint.innerText = 'Özel Mesaj';

      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(hint);

      // KULLANICIYA TIKLAYINCA ANINDA ÖZEL MESAJ BAŞLAT
      row.addEventListener('click', () => {
        openDirectMessageWith(nick);
      });

      userListScroll.appendChild(row);
    });
  };

  renderGroup('👑 Yöneticiler (@, %)', ops);
  renderGroup('🎙️ Yetkililer (+)', voices);
  renderGroup('👤 Kullanıcılar', regulars);

  // Scroll konumunu geri yükle (böylece K harfindeyken başa sıçramaz)
  if (prevScroll > 0) {
    userListScroll.scrollTop = prevScroll;
  }
}

// ÖZEL MESAJ AÇMA
function openDirectMessageWith(nick) {
  if (!state.activeServerId || !nick) return;
  socket.emit('open_dm', { serverId: state.activeServerId, nick });

  const srv = getActiveServer();
  if (srv && !srv.directMessages.some((d) => d.nick.toLowerCase() === nick.toLowerCase())) {
    srv.directMessages.push({ nick, unread: 0 });
  }

  selectTarget(nick);

  // Küçük ekranda ise kullanıcı çekmecesini kapat ve sohbete geç
  if (window.innerWidth <= 640) {
    userSidebar.classList.remove('show-mobile-users');
    showChatScreenOnMobile();
  }
}

// MESAJ GÖNDERME
function handleSendMessage() {
  let text = chatInput.value.trim();
  if (!text || !state.activeServerId) return;

  const srv = getActiveServer();
  if (!srv || srv.status !== 'connected') {
    showToast('Sunucuya bağlı değilsiniz! Lütfen önce "Bağlan" butonuna tıklayın.');
    return;
  }

  // Komut kontrolü (/join, /part, /nick vb.)
  if (text.startsWith('/')) {
    socket.emit('irc_command', {
      serverId: state.activeServerId,
      target: state.activeTarget,
      command: text,
    });
    chatInput.value = '';
    return;
  }

  if (!state.activeTarget) {
    showToast('Lütfen önce bir kanal veya kişi seçin.');
    return;
  }

  // Seçilen mIRC yazı rengini uygula
  if (state.selectedColor) {
    text = `\x03${state.selectedColor}${text}\x03`;
  }

  socket.emit('send_message', {
    serverId: state.activeServerId,
    target: state.activeTarget,
    text,
  });

  chatInput.value = '';
}

sendMsgBtn.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleSendMessage();
  }
});

// YAZI RENGİ SEÇİCİ
document.querySelectorAll('.color-dot').forEach((dot) => {
  dot.addEventListener('click', () => {
    document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
    dot.classList.add('active');
    state.selectedColor = dot.dataset.color || '';
    const hex = dot.dataset.hex;
    chatInput.style.color = hex || '';
    chatInput.focus();
  });
});

// HIZLI EMOJİLER
document.querySelectorAll('.quick-emoji').forEach((el) => {
  el.addEventListener('click', () => {
    chatInput.value += el.innerText;
    chatInput.focus();
  });
});

// BAĞLAN / BAĞLANTIYI KES
toggleConnectBtn.addEventListener('click', () => {
  const srv = getActiveServer();
  if (!srv) return;
  if (srv.status === 'connected') {
    socket.emit('disconnect_server', { serverId: srv.id });
  } else {
    socket.emit('connect_server', { serverId: srv.id });
  }
});

// KULLANICI ARAMA FİLTRESİ
userSearchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  renderUsers();
});

// KULLANICI LİSTESİ PANELİNİ AÇ/KAPAT
toggleUsersBtn.addEventListener('click', () => {
  userSidebar.classList.toggle('show-mobile-users');
});
closeUsersSidebarBtn.addEventListener('click', () => {
  userSidebar.classList.remove('show-mobile-users');
});

// MODALLARIN YÖNETİMİ
// 0. Telefon Giriş Linki Modalı
phoneLinkBtn.addEventListener('click', () => {
  phoneUrlText.innerText = currentTunnelUrl || 'Tünel bağlanıyor, lütfen bekleyin...';
  phoneModal.style.display = 'flex';
});
closePhoneModalBtn.addEventListener('click', () => (phoneModal.style.display = 'none'));
cancelPhoneModalBtn.addEventListener('click', () => (phoneModal.style.display = 'none'));
copyPhoneUrlBtn.addEventListener('click', () => {
  if (currentTunnelUrl) {
    navigator.clipboard.writeText(currentTunnelUrl);
    showToast('Telefon giriş linki kopyalandı!');
  } else {
    showToast('Henüz link hazır değil, lütfen birkaç saniye bekleyin.');
  }
});

// Dışarı tıklayınca açık olan modalı kapat
document.querySelectorAll('.modal-overlay').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
});

// 1. Rumuz Değiştir Modalı
openChangeNickBtn.addEventListener('click', () => {
  const srv = getActiveServer();
  newNickInput.value = srv ? (srv.currentNick || '') : '';
  nickModal.style.display = 'flex';
  newNickInput.focus();
});
closeNickModalBtn.addEventListener('click', () => (nickModal.style.display = 'none'));
cancelNickModalBtn.addEventListener('click', () => (nickModal.style.display = 'none'));
saveNickBtn.addEventListener('click', () => {
  const nick = newNickInput.value.trim();
  if (nick && state.activeServerId) {
    socket.emit('change_nick', { serverId: state.activeServerId, nick });
    nickModal.style.display = 'none';
  }
});
newNickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveNickBtn.click();
});

// 2. Yeni Özel Mesaj Modalı
openNewDmModalBtn.addEventListener('click', () => {
  newDmNickInput.value = '';
  newDmModal.style.display = 'flex';
  newDmNickInput.focus();
});
closeNewDmModalBtn.addEventListener('click', () => (newDmModal.style.display = 'none'));
cancelNewDmModalBtn.addEventListener('click', () => (newDmModal.style.display = 'none'));
startNewDmBtn.addEventListener('click', () => {
  const nick = newDmNickInput.value.trim();
  if (nick) {
    openDirectMessageWith(nick);
    newDmModal.style.display = 'none';
  }
});
newDmNickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startNewDmBtn.click();
});

// 3. Kanala Katıl Modalı
openJoinChannelModalBtn.addEventListener('click', () => {
  channelNameInput.value = '';
  joinChannelModal.style.display = 'flex';
  channelNameInput.focus();
});
closeJoinChannelModalBtn.addEventListener('click', () => (joinChannelModal.style.display = 'none'));
cancelJoinChannelModalBtn.addEventListener('click', () => (joinChannelModal.style.display = 'none'));
confirmJoinChannelBtn.addEventListener('click', () => {
  const rawCh = channelNameInput.value.trim();
  if (rawCh && state.activeServerId) {
    const ch = rawCh.startsWith('#') ? rawCh : '#' + rawCh;
    socket.emit('join_channel', { serverId: state.activeServerId, channel: ch });
    joinChannelModal.style.display = 'none';
  }
});
channelNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmJoinChannelBtn.click();
});

// 4. Sunucu Ayarları / Ekleme Modalı
openAddServerBtn.addEventListener('click', () => {
  serverFormId.value = '';
  serverFormName.value = '';
  serverFormHost.value = '';
  serverFormPort.value = '6667';
  serverFormSsl.checked = false;
  serverFormNick.value = '';
  serverFormPass.value = '';
  serverFormChannels.value = '#sohbet';
  serverFormAutoConnect.checked = true;
  deleteServerBtn.style.display = 'none';
  document.getElementById('serverModalTitle').innerText = 'Yeni Sunucu Ekle';
  serverModal.style.display = 'flex';
});

editServerBtn.addEventListener('click', () => {
  const srv = getActiveServer();
  if (!srv) return;
  serverFormId.value = srv.id;
  serverFormName.value = srv.name;
  serverFormHost.value = srv.host;
  serverFormPort.value = srv.port || 6667;
  serverFormSsl.checked = Boolean(srv.ssl);
  serverFormNick.value = srv.nick || '';
  serverFormPass.value = srv.password || '';
  serverFormChannels.value = (srv.channels || []).map((c) => (typeof c === 'string' ? c : c.name)).join(', ');
  serverFormAutoConnect.checked = srv.autoConnect !== false;
  deleteServerBtn.style.display = 'block';
  document.getElementById('serverModalTitle').innerText = `${srv.name} Ayarları`;
  serverModal.style.display = 'flex';
});

closeServerModalBtn.addEventListener('click', () => (serverModal.style.display = 'none'));
cancelServerModalBtn.addEventListener('click', () => (serverModal.style.display = 'none'));

saveServerBtn.addEventListener('click', () => {
  const name = serverFormName.value.trim();
  const host = serverFormHost.value.trim();
  if (!name || !host) {
    alert('Lütfen sunucu adı ve adresini girin!');
    return;
  }

  const channels = serverFormChannels.value
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const serverData = {
    id: serverFormId.value || 'srv_' + Date.now(),
    name,
    host,
    port: Number(serverFormPort.value) || 6667,
    ssl: serverFormSsl.checked,
    nick: serverFormNick.value.trim() || 'Misafir',
    password: serverFormPass.value.trim(),
    channels,
    autoConnect: serverFormAutoConnect.checked,
  };

  socket.emit('save_server', serverData);
  serverModal.style.display = 'none';
});

deleteServerBtn.addEventListener('click', () => {
  const id = serverFormId.value;
  if (!id) return;
  if (confirm('Bu sunucuyu silmek istediğinize emin misiniz?')) {
    socket.emit('delete_server', { serverId: id });
    serverModal.style.display = 'none';
  }
});

// MOBİL ALT GEZİNME (TELEFON UYUMU)
function showChatScreenOnMobile() {
  channelSidebar.classList.remove('show-mobile-sidebar');
  serverBar.classList.remove('show-mobile-servers');
  userSidebar.classList.remove('show-mobile-users');
  chatContainer.classList.add('show-mobile-chat');

  navBtnServers.classList.remove('active');
  navBtnChats.classList.remove('active');
  navBtnUsers.classList.remove('active');
  navBtnMessage.classList.add('active');
}

navBtnServers.addEventListener('click', () => {
  serverBar.classList.toggle('show-mobile-servers');
  navBtnServers.classList.toggle('active');
});

navBtnChats.addEventListener('click', () => {
  chatContainer.classList.remove('show-mobile-chat');
  userSidebar.classList.remove('show-mobile-users');
  channelSidebar.classList.add('show-mobile-sidebar');

  navBtnChats.classList.add('active');
  navBtnMessage.classList.remove('active');
  navBtnUsers.classList.remove('active');
});

navBtnMessage.addEventListener('click', () => {
  showChatScreenOnMobile();
});

navBtnUsers.addEventListener('click', () => {
  userSidebar.classList.toggle('show-mobile-users');
  navBtnUsers.classList.toggle('active');
});

// TEMA DEĞİŞTİRME (AÇIK / KOYU)
const savedTheme = localStorage.getItem('irchub_theme');
if (savedTheme === 'light') {
  document.body.classList.add('theme-light');
  themeToggleBtn.innerText = '☀️ Açık';
} else {
  themeToggleBtn.innerText = '🌙 Koyu';
}

themeToggleBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('theme-light');
  if (isLight) {
    localStorage.setItem('irchub_theme', 'light');
    themeToggleBtn.innerText = '☀️ Açık';
  } else {
    localStorage.setItem('irchub_theme', 'dark');
    themeToggleBtn.innerText = '🌙 Koyu';
  }
});
