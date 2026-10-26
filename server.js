const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const IrcConnection = require('./irc-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const CONFIG_FILE = path.join(__dirname, 'servers.json');
let serverConfigs = [];
const ircInstances = {}; // serverId -> IrcConnection
let disconnectTimer = null;
let publicTunnelUrl = null;
let tunnelProcess = null;

function startTunnel() {
  if (tunnelProcess) {
    try { tunnelProcess.kill(); } catch (e) {}
  }

  console.log('Telefon için canlı HTTPS internet tüneli başlatılıyor...');
  tunnelProcess = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-R', '80:127.0.0.1:' + PORT,
    'nokey@localhost.run'
  ]);

  tunnelProcess.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9]+\.lhr\.life/i);
    if (match) {
      publicTunnelUrl = match[0];
      console.log('===========================================================');
      console.log(' TELEFON İÇİN CANLI GİRİŞ LİNKİ (HTTPS):');
      console.log(' ' + publicTunnelUrl);
      console.log('===========================================================');
      io.emit('tunnel_url', { url: publicTunnelUrl });
    }
  });

  tunnelProcess.stderr.on('data', () => {});

  tunnelProcess.on('close', (code) => {
    console.log('Tünel kapandı, 5 saniye içinde yeniden bağlanılıyor...');
    publicTunnelUrl = null;
    io.emit('tunnel_url', { url: null });
    setTimeout(startTunnel, 5000);
  });
}

function loadServers() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      serverConfigs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Sunucu ayarları okunamadı:', err);
    serverConfigs = [];
  }
}

function saveServers() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(serverConfigs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Sunucu ayarları kaydedilemedi:', err);
  }
}

function initIrcInstance(cfg) {
  if (ircInstances[cfg.id]) {
    ircInstances[cfg.id].disconnect();
  }

  const conn = new IrcConnection(cfg);
  ircInstances[cfg.id] = conn;

  conn.on('status', (data) => {
    io.emit('status_changed', {
      serverId: cfg.id,
      status: data.status,
      message: data.message,
      nick: conn.currentNick,
    });
  });

  conn.on('nick_changed', (data) => {
    io.emit('nick_changed', {
      serverId: cfg.id,
      oldNick: data.oldNick,
      newNick: data.newNick,
    });
  });

  conn.on('channel_joined', (data) => {
    io.emit('channel_joined', { serverId: cfg.id, channel: data.channel });
  });

  conn.on('channel_parted', (data) => {
    io.emit('channel_parted', { serverId: cfg.id, channel: data.channel });
  });

  conn.on('channel_error', (data) => {
    io.emit('channel_error', { serverId: cfg.id, channel: data.channel, message: data.message });
  });

  conn.on('users_updated', (data) => {
    io.emit('users_updated', {
      serverId: cfg.id,
      channel: data.channel,
      users: data.users,
    });
  });

  conn.on('user_joined', (data) => {
    io.emit('user_joined', {
      serverId: cfg.id,
      channel: data.channel,
      nick: data.nick,
    });
  });

  conn.on('user_parted', (data) => {
    io.emit('user_parted', {
      serverId: cfg.id,
      channel: data.channel,
      nick: data.nick,
    });
  });

  conn.on('message', (data) => {
    io.emit('new_message', data);
  });

  conn.on('notice', (data) => {
    io.emit('irc_notice', {
      serverId: cfg.id,
      from: data.from,
      text: data.text,
    });
  });

  conn.on('irc_error', (data) => {
    io.emit('irc_error', {
      serverId: cfg.id,
      target: data.target,
      message: data.message,
    });
  });
}

loadServers();
serverConfigs.forEach((cfg) => initIrcInstance(cfg));

app.use(express.static(path.join(__dirname, 'public')));

function buildFullState() {
  return serverConfigs.map((cfg) => {
    const inst = ircInstances[cfg.id];
    const isConn = inst && inst.connected;

    let chList = [];
    if (isConn && Object.keys(inst.channels).length > 0) {
      chList = Object.keys(inst.channels).map((ch) => ({
        name: ch,
        userCount: Object.keys(inst.channels[ch].users || {}).length,
        users: inst.channels[ch].users || {},
        unread: inst.channels[ch].unread || 0,
      }));
    } else {
      chList = (cfg.channels || []).map((c) => {
        const name = typeof c === 'string' ? c : c.name;
        return { name, userCount: 0, users: {}, unread: 0 };
      });
    }

    return {
      ...cfg,
      status: inst ? (inst.connected ? 'connected' : inst.connecting ? 'connecting' : 'disconnected') : 'disconnected',
      currentNick: inst ? inst.currentNick : cfg.nick,
      channels: chList,
      directMessages: isConn
        ? Object.keys(inst.directMessages).map((nick) => ({
            nick,
            unread: inst.directMessages[nick].unread || 0,
          }))
        : [],
    };
  });
}

io.on('connection', (socket) => {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  // Connect configured autoConnect servers when client opens app
  serverConfigs.forEach((cfg) => {
    if (cfg.autoConnect) {
      const inst = ircInstances[cfg.id];
      if (inst && !inst.connected && !inst.connecting) {
        inst.connect();
      }
    }
  });

  socket.emit('state', buildFullState());
  socket.emit('tunnel_url', { url: publicTunnelUrl });

  socket.on('disconnect', () => {
    disconnectTimer = setTimeout(() => {
      if (io.engine.clientsCount === 0) {
        console.log('Sayfalar kapatıldı. Arka planda kaynak tüketmemesi için tüm IRC sunucularından çıkılıyor...');
        Object.values(ircInstances).forEach((inst) => inst.disconnect());
      }
    }, 60000);
  });

  socket.on('get_messages', ({ serverId, target }) => {
    const inst = ircInstances[serverId];
    if (inst) {
      inst.markRead(target);
      const msgKey = inst.getMessageKey(target);
      socket.emit('messages_loaded', {
        serverId,
        target,
        messages: inst.messages[msgKey] || [],
      });
    }
  });

  socket.on('get_users', ({ serverId, channel }) => {
    const inst = ircInstances[serverId];
    if (inst) {
      const chKey = inst.getChannelKey(channel);
      if (chKey && inst.channels[chKey] && Object.keys(inst.channels[chKey].users || {}).length > 0) {
        socket.emit('users_updated', {
          serverId,
          channel: chKey,
          users: inst.channels[chKey].users,
        });
      } else if (inst.connected && chKey) {
        inst.raw(`NAMES ${chKey}`);
      }
    }
  });

  socket.on('send_message', ({ serverId, target, text }) => {
    const inst = ircInstances[serverId];
    if (inst && inst.connected) {
      const msg = inst.sendMessage(target, text);
      if (msg) {
        io.emit('new_message', {
          serverId,
          chatTarget: target,
          message: msg,
          isDM: !target.startsWith('#'),
        });
      }
    }
  });

  socket.on('irc_command', ({ serverId, target, command }) => {
    const inst = ircInstances[serverId];
    if (!inst || !inst.connected) return;

    const trimmed = (command || '').slice(1).trim();
    const spaceIdx = trimmed.indexOf(' ');
    const cmd = (spaceIdx !== -1 ? trimmed.slice(0, spaceIdx) : trimmed).toLowerCase();
    const rest = spaceIdx !== -1 ? trimmed.slice(spaceIdx + 1) : '';

    if (cmd === 'ns' || cmd === 'nickserv') {
      inst.raw(`PRIVMSG NickServ :${rest}`);
    } else if (cmd === 'cs' || cmd === 'chanserv') {
      inst.raw(`PRIVMSG ChanServ :${rest}`);
    } else if (cmd === 'join' || cmd === 'j') {
      inst.join(rest);
    } else if (cmd === 'part') {
      inst.part(rest || target);
    } else if (cmd === 'nick') {
      inst.changeNick(rest);
    } else if (cmd === 'msg') {
      const msgSpace = rest.indexOf(' ');
      if (msgSpace !== -1) {
        const msgTarget = rest.slice(0, msgSpace);
        const msgText = rest.slice(msgSpace + 1);
        inst.sendMessage(msgTarget, msgText);
      }
    } else {
      inst.raw(trimmed);
    }
  });

  socket.on('change_nick', ({ serverId, nick }) => {
    const inst = ircInstances[serverId];
    if (inst && inst.connected) {
      inst.changeNick(nick);
    }
  });

  socket.on('join_channel', ({ serverId, channel }) => {
    const inst = ircInstances[serverId];
    if (inst && inst.connected) {
      inst.join(channel);
    }
  });

  socket.on('part_channel', ({ serverId, channel }) => {
    const inst = ircInstances[serverId];
    if (inst && inst.connected) {
      inst.part(channel);
      io.emit('channel_parted', { serverId, channel });
    }
  });

  socket.on('open_dm', ({ serverId, nick }) => {
    const inst = ircInstances[serverId];
    if (inst) {
      const dmKey = inst.getDMKey(nick);
      if (!inst.directMessages[dmKey]) {
        inst.directMessages[dmKey] = { unread: 0, lastSeen: new Date() };
      }
      io.emit('dm_opened', { serverId, nick: dmKey });
    }
  });

  socket.on('close_dm', ({ serverId, nick }) => {
    const inst = ircInstances[serverId];
    if (inst) {
      inst.closeDM(nick);
      io.emit('dm_closed', { serverId, nick });
    }
  });

  socket.on('connect_server', ({ serverId }) => {
    const inst = ircInstances[serverId];
    if (inst) {
      inst.connect();
    }
  });

  socket.on('disconnect_server', ({ serverId }) => {
    const inst = ircInstances[serverId];
    if (inst) {
      inst.disconnect();
      io.emit('state', buildFullState());
    }
  });

  socket.on('save_server', (serverData) => {
    const existingIdx = serverConfigs.findIndex((s) => s.id === serverData.id);
    if (existingIdx !== -1) {
      serverConfigs[existingIdx] = { ...serverConfigs[existingIdx], ...serverData };
    } else {
      serverData.id = serverData.id || 'srv_' + Date.now();
      serverConfigs.push(serverData);
    }
    saveServers();

    initIrcInstance(serverData);
    if (serverData.autoConnect) {
      ircInstances[serverData.id].connect();
    }
    io.emit('state', buildFullState());
  });

  socket.on('delete_server', ({ serverId }) => {
    if (ircInstances[serverId]) {
      ircInstances[serverId].disconnect();
      delete ircInstances[serverId];
    }
    serverConfigs = serverConfigs.filter((s) => s.id !== serverId);
    saveServers();
    io.emit('state', buildFullState());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` IRCHub Teams Sunucusu Hazır!`);
  console.log(` Masaüstünden: http://localhost:${PORT}`);
  console.log(` Telefondan (Yerel): http://193.255.173.210:${PORT}`);
  console.log(`===============================================`);
  startTunnel();
});
