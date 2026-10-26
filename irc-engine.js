const net = require('net');
const tls = require('tls');
const iconv = require('iconv-lite');
const EventEmitter = require('events');

function sanitizeNick(nick) {
  if (!nick) return 'Misafir' + Math.floor(Math.random() * 1000);
  const trMap = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'I': 'I', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U'
  };
  let clean = nick.split('').map(c => trMap[c] || c).join('');
  clean = clean.replace(/[^a-zA-Z0-9\[\]\\`_^{|}-]/g, '');
  if (!clean || clean.length === 0) {
    clean = 'User_' + Math.floor(Math.random() * 1000);
  }
  return clean.slice(0, 15);
}

class IrcConnection extends EventEmitter {
  constructor(serverConfig) {
    super();
    this.config = { ...serverConfig };
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.currentNick = sanitizeNick(this.config.nick || 'Misafir');
    this.buffer = Buffer.alloc(0);
    this.channels = {}; // { [channelName]: { users: { [nick]: { prefix: '@' } }, unread: 0 } }
    this.directMessages = {}; // { [nick]: { unread: 0, lastSeen: Date } }
    this.messages = {}; // { [target]: [ { id, from, target, text, time, isSelf, isDM } ] }
    this.pingInterval = null;
    this.joinRetryTimer = null;
    this.serverName = null;
  }

  getChannelKey(channel) {
    if (!channel) return null;
    const lower = channel.toLowerCase();
    const existing = Object.keys(this.channels).find((k) => k.toLowerCase() === lower);
    return existing || channel;
  }

  getMessageKey(target) {
    if (!target) return '';
    const lower = target.toLowerCase();
    const existing = Object.keys(this.messages).find((k) => k.toLowerCase() === lower);
    return existing || target;
  }

  getDMKey(nick) {
    if (!nick) return '';
    const lower = nick.toLowerCase();
    const existing = Object.keys(this.directMessages).find((k) => k.toLowerCase() === lower);
    return existing || nick;
  }

  connect() {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    // Clean session state
    this.messages = {};
    this.directMessages = {};
    this.channels = {};

    this.emit('status', { status: 'connecting', message: 'Sunucuya bağlanılıyor...' });

    this.currentNick = sanitizeNick(this.config.nick || this.currentNick);
    const port = Number(this.config.port) || 6667;
    const host = this.config.host;
    const isSsl = Boolean(this.config.ssl);

    const onConnect = () => {
      this.connecting = false;
      this.connected = true;
      this.emit('status', { status: 'connected', message: 'Sunucuya bağlandı, oturum açılıyor...' });

      // Keep-Alive Ping every 30s
      clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.connected && this.socket && !this.socket.destroyed) {
          this.raw(`PING :${this.serverName || 'irchub'}`);
        }
      }, 30000);

      // Handshake
      if (this.config.serverPassword) {
        this.raw(`PASS ${this.config.serverPassword}`);
      }
      this.raw(`NICK ${this.currentNick}`);
      const ident = this.currentNick.slice(0, 8);
      this.raw(`USER ${ident} 0 * :${this.currentNick}`);
    };

    try {
      if (isSsl) {
        this.socket = tls.connect({ host, port, rejectUnauthorized: false }, onConnect);
      } else {
        this.socket = net.connect({ host, port }, onConnect);
      }

      this.socket.on('data', (chunk) => this.handleData(chunk));

      this.socket.on('error', (err) => {
        this.emit('status', { status: 'error', message: 'Bağlantı hatası: ' + err.message });
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.connecting = false;
        clearInterval(this.pingInterval);
        clearTimeout(this.joinRetryTimer);
        this.messages = {};
        this.directMessages = {};
        this.channels = {};
        this.emit('status', { status: 'disconnected', message: 'Bağlantı kesildi' });
      });
    } catch (err) {
      this.connecting = false;
      this.connected = false;
      this.emit('status', { status: 'error', message: err.message });
    }
  }

  disconnect() {
    clearInterval(this.pingInterval);
    clearTimeout(this.joinRetryTimer);

    if (this.socket) {
      try {
        this.raw('QUIT :IRCHub kapatildi');
        this.socket.end();
        this.socket.destroy();
      } catch (e) {}
    }
    this.connected = false;
    this.connecting = false;
    this.messages = {};
    this.directMessages = {};
    this.channels = {};
    this.emit('status', { status: 'disconnected', message: 'Bağlantı kapatıldı' });
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let delimiterIndex;

    while ((delimiterIndex = this.buffer.indexOf('\n')) !== -1) {
      const lineBuf = this.buffer.slice(0, delimiterIndex);
      this.buffer = this.buffer.slice(delimiterIndex + 1);

      let line = '';
      try {
        line = lineBuf.toString('utf-8');
        if (line.includes('\uFFFD')) {
          line = iconv.decode(lineBuf, 'win1254');
        }
      } catch (e) {
        line = iconv.decode(lineBuf, 'win1254');
      }

      line = line.replace(/\r$/, '');
      if (line.trim().length > 0) {
        this.parseLine(line);
      }
    }
  }

  raw(str) {
    if (this.socket && !this.socket.destroyed) {
      try {
        const encoded = iconv.encode(str + '\r\n', 'win1254');
        this.socket.write(encoded);
      } catch (e) {
        try {
          this.socket.write(str + '\r\n');
        } catch (err) {}
      }
    }
  }

  parseLine(rawLine) {
    let line = rawLine;
    let prefix = '';
    let command = '';
    let params = [];

    if (line.startsWith(':')) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx !== -1) {
        prefix = line.slice(1, spaceIdx);
        line = line.slice(spaceIdx + 1);
      }
    }

    const trailingIdx = line.indexOf(' :');
    let trailing = null;
    if (trailingIdx !== -1) {
      trailing = line.slice(trailingIdx + 2);
      line = line.slice(0, trailingIdx);
    }

    const parts = line.split(' ').filter(Boolean);
    command = parts[0] ? parts[0].toUpperCase() : '';
    params = parts.slice(1).map((p) => p.replace(/^:/, ''));
    if (trailing !== null) {
      params.push(trailing);
    }

    this.handleCommand(command, params, prefix, rawLine);
  }

  extractNick(prefix) {
    if (!prefix) return '';
    const exclamation = prefix.indexOf('!');
    return exclamation !== -1 ? prefix.slice(0, exclamation) : prefix;
  }

  handleCommand(command, params, prefix, rawLine) {
    // PING
    if (command === 'PING') {
      const token = params[0] || (rawLine.split('PING ')[1] || '').replace(/^:/, '').trim();
      this.raw(`PONG :${token}`);
      return;
    }

    if (command === 'PONG') return;

    // 001 RPL_WELCOME
    if (command === '001') {
      this.serverName = prefix || this.config.host;
      this.currentNick = params[0] || this.currentNick;
      this.emit('status', { status: 'connected', message: `${this.currentNick} olarak bağlandı` });

      if (this.config.password && this.config.password.trim().length > 0) {
        this.raw(`PRIVMSG NickServ :IDENTIFY ${this.config.password}`);
      }

      this.joinConfiguredChannels();

      // Retry auto-join after quarantine gate (15.5s)
      clearTimeout(this.joinRetryTimer);
      this.joinRetryTimer = setTimeout(() => {
        if (this.connected) {
          this.joinConfiguredChannels();
        }
      }, 15500);
      return;
    }

    // 432 ERR_ERRONEUSNICKNAME
    if (command === '432') {
      const fallback = 'User' + Math.floor(Math.random() * 10000);
      this.currentNick = fallback;
      this.raw(`NICK ${fallback}`);
      this.emit('status', { status: 'warning', message: `Geçersiz rumuz! Yeni rumuz atandı: ${fallback}` });
      return;
    }

    // 433 ERR_NICKNAMEINUSE
    if (command === '433') {
      this.currentNick = this.currentNick.slice(0, 10) + '_' + Math.floor(Math.random() * 100);
      this.raw(`NICK ${this.currentNick}`);
      this.emit('status', { status: 'warning', message: `Rumuz kullanımda. Yeni rumuz: ${this.currentNick}` });
      return;
    }

    // Channel Access Errors (403, 471, 473, 474, 475, 477)
    if (['403', '471', '473', '474', '475', '477'].includes(command)) {
      const channel = params[1] || '';
      let errMsg = 'Böyle bir kanal bulunamadı.';
      if (command === '473') errMsg = 'Bu kanal sadece davetle girilebilir (+i).';
      if (command === '474') errMsg = 'Bu kanaldan yasaklandınız (+b).';
      if (command === '475') errMsg = 'Bu kanal şifrelidir (+k).';
      if (command === '477') errMsg = 'Bu kanala girmek için kayıtlı rumuz gereklidir (+r).';

      this.emit('channel_error', { channel, message: errMsg });
      return;
    }

    // User / Message Errors (401, 404, 486)
    if (command === '401') {
      const target = params[1] || '';
      this.emit('irc_error', {
        target,
        message: `${target} rumuzlu kullanıcı bulunamadı veya sunucudan ayrıldı.`,
      });
      return;
    }

    if (command === '404' || command === '486') {
      const target = params[1] || '';
      const text = params[2] || (command === '486' ? 'Bu kullanıcı sadece kayıtlı rumuzlardan özel mesaj kabul etmektedir (+R).' : 'Mesaj gönderilemedi.');
      this.emit('irc_error', {
        target,
        message: text,
      });
      return;
    }

    // NICK change
    if (command === 'NICK') {
      const oldNick = this.extractNick(prefix);
      const newNick = params[0];
      if (oldNick.toLowerCase() === this.currentNick.toLowerCase()) {
        this.currentNick = newNick;
      }
      Object.keys(this.channels).forEach((ch) => {
        if (this.channels[ch].users[oldNick]) {
          const userMeta = this.channels[ch].users[oldNick];
          delete this.channels[ch].users[oldNick];
          this.channels[ch].users[newNick] = userMeta;
        }
      });
      const oldDMKey = this.getDMKey(oldNick);
      if (this.directMessages[oldDMKey]) {
        this.directMessages[newNick] = this.directMessages[oldDMKey];
        delete this.directMessages[oldDMKey];
      }
      this.emit('nick_changed', { oldNick, newNick });
      return;
    }

    // JOIN
    if (command === 'JOIN') {
      const nick = this.extractNick(prefix);
      let rawChannel = (params[0] || '').replace(/^:/, '').trim();
      if (rawChannel.toLowerCase() === '#karantina') return;
      const chKey = this.getChannelKey(rawChannel);

      if (!this.channels[chKey]) {
        this.channels[chKey] = { users: {}, unread: 0 };
      }

      if (nick.toLowerCase() === this.currentNick.toLowerCase()) {
        this.emit('channel_joined', { channel: chKey });
      } else {
        this.channels[chKey].users[nick] = { prefix: '' };
        this.emit('user_joined', { channel: chKey, nick });
      }
      return;
    }

    // PART
    if (command === 'PART') {
      const nick = this.extractNick(prefix);
      let rawChannel = (params[0] || '').replace(/^:/, '').trim();
      if (rawChannel.toLowerCase() === '#karantina') return;
      const chKey = this.getChannelKey(rawChannel);

      if (nick.toLowerCase() === this.currentNick.toLowerCase()) {
        delete this.channels[chKey];
        this.emit('channel_parted', { channel: chKey });
      } else if (this.channels[chKey] && this.channels[chKey].users[nick]) {
        delete this.channels[chKey].users[nick];
        this.emit('user_parted', { channel: chKey, nick });
      }
      return;
    }

    // KICK
    if (command === 'KICK') {
      const rawChannel = (params[0] || '').replace(/^:/, '').trim();
      const kickedNick = params[1];
      const chKey = this.getChannelKey(rawChannel);

      if (kickedNick.toLowerCase() === this.currentNick.toLowerCase()) {
        delete this.channels[chKey];
        this.emit('channel_parted', { channel: chKey });
      } else if (this.channels[chKey] && this.channels[chKey].users[kickedNick]) {
        delete this.channels[chKey].users[kickedNick];
        this.emit('user_parted', { channel: chKey, nick: kickedNick });
      }
      return;
    }

    // QUIT
    if (command === 'QUIT') {
      const nick = this.extractNick(prefix);
      Object.keys(this.channels).forEach((ch) => {
        if (this.channels[ch].users[nick]) {
          delete this.channels[ch].users[nick];
          this.emit('user_parted', { channel: ch, nick });
        }
      });
      return;
    }

    // 353 RPL_NAMREPLY
    if (command === '353') {
      let rawChannel = '';
      let namesStr = '';
      for (let i = 1; i < params.length; i++) {
        if (params[i].startsWith('#') || params[i].startsWith('&')) {
          rawChannel = params[i];
          namesStr = params[i + 1] || '';
          break;
        }
      }
      if (!rawChannel && params.length >= 3) {
        rawChannel = params[2];
        namesStr = params[3] || '';
      }
      rawChannel = rawChannel.replace(/^:/, '').trim();
      if (!rawChannel || rawChannel.toLowerCase() === '#karantina') return;
      const names = namesStr.split(' ').filter(Boolean);
      const chKey = this.getChannelKey(rawChannel);

      if (!this.channels[chKey]) {
        this.channels[chKey] = { users: {}, unread: 0 };
      }

      names.forEach((name) => {
        let pfx = '';
        let cleanNick = name;
        if (['@', '+', '%', '~', '&', '.'].includes(name[0])) {
          pfx = name[0];
          cleanNick = name.slice(1);
        }
        if (cleanNick) {
          this.channels[chKey].users[cleanNick] = { prefix: pfx };
        }
      });
      return;
    }

    // 366 RPL_ENDOFNAMES
    if (command === '366') {
      let rawChannel = '';
      for (let i = 1; i < params.length; i++) {
        if (params[i].startsWith('#') || params[i].startsWith('&')) {
          rawChannel = params[i];
          break;
        }
      }
      if (!rawChannel) {
        rawChannel = (params[1] || '').replace(/^:/, '').trim();
      }
      if (!rawChannel || rawChannel.toLowerCase() === '#karantina') return;
      const chKey = this.getChannelKey(rawChannel);
      if (this.channels[chKey]) {
        this.emit('users_updated', {
          channel: chKey,
          users: this.channels[chKey].users,
        });
      }
      return;
    }

    // PRIVMSG
    if (command === 'PRIVMSG') {
      const sender = this.extractNick(prefix);
      const target = params[0] || '';
      const text = params[1] || '';

      const isChannel = target.startsWith('#') || target.startsWith('&');
      const chatTarget = isChannel ? this.getChannelKey(target) : sender;
      const isDirectMessage = !isChannel;

      if (isDirectMessage) {
        const dmKey = this.getDMKey(sender);
        if (!this.directMessages[dmKey]) {
          this.directMessages[dmKey] = { unread: 0, lastSeen: new Date() };
        }
        this.directMessages[dmKey].unread += 1;
      }

      const msgKey = this.getMessageKey(chatTarget);
      const msgObj = {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        from: sender,
        target: msgKey,
        text,
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        isSelf: false,
        isDM: isDirectMessage,
      };

      if (!this.messages[msgKey]) {
        this.messages[msgKey] = [];
      }
      this.messages[msgKey].push(msgObj);
      if (this.messages[msgKey].length > 400) {
        this.messages[msgKey].shift();
      }

      this.emit('message', {
        serverId: this.config.id,
        chatTarget: msgKey,
        message: msgObj,
        isDM: isDirectMessage,
      });
      return;
    }

    // NOTICE
    if (command === 'NOTICE') {
      const sender = this.extractNick(prefix) || 'Sistem';
      const text = params[1] || '';
      this.emit('notice', { from: sender, text });
      return;
    }
  }

  joinConfiguredChannels() {
    if (Array.isArray(this.config.channels)) {
      this.config.channels.forEach((ch) => {
        const chName = typeof ch === 'string' ? ch : ch.name;
        if (chName && chName.trim()) {
          this.join(chName.trim());
        }
      });
    }
  }

  join(channel) {
    if (!channel) return;
    const ch = channel.startsWith('#') ? channel : '#' + channel;
    this.raw(`JOIN ${ch}`);
  }

  part(channel) {
    if (!channel) return;
    const ch = channel.startsWith('#') ? channel : '#' + channel;
    const chKey = this.getChannelKey(ch);
    this.raw(`PART ${chKey} :Kapatildi`);
    delete this.channels[chKey];
    this.emit('channel_parted', { channel: chKey });
  }

  changeNick(newNick) {
    const clean = sanitizeNick(newNick);
    if (!clean) return;
    this.raw(`NICK ${clean}`);
  }

  sendMessage(target, text) {
    if (!target || !text) return null;
    this.raw(`PRIVMSG ${target} :${text}`);

    const isDirectMessage = !target.startsWith('#');
    const dmKey = isDirectMessage ? this.getDMKey(target) : target;
    if (isDirectMessage && !this.directMessages[dmKey]) {
      this.directMessages[dmKey] = { unread: 0, lastSeen: new Date() };
    }

    const msgKey = this.getMessageKey(target);
    const msgObj = {
      id: Date.now() + Math.random().toString(36).substr(2, 5),
      from: this.currentNick,
      target: msgKey,
      text,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      isSelf: true,
      isDM: isDirectMessage,
    };

    if (!this.messages[msgKey]) {
      this.messages[msgKey] = [];
    }
    this.messages[msgKey].push(msgObj);
    return msgObj;
  }

  markRead(target) {
    const dmKey = this.getDMKey(target);
    if (this.directMessages[dmKey]) {
      this.directMessages[dmKey].unread = 0;
    }
    const chKey = this.getChannelKey(target);
    if (this.channels[chKey]) {
      this.channels[chKey].unread = 0;
    }
  }

  closeDM(nick) {
    const dmKey = this.getDMKey(nick);
    const msgKey = this.getMessageKey(nick);
    delete this.directMessages[dmKey];
    delete this.messages[msgKey];
  }
}

module.exports = IrcConnection;
