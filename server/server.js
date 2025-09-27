const io = require('socket.io')(4000, { cors: { origin: '*' } });

let users = [];
let matchesEnabled = false;
let activeDesks = {};
const desks = Array.from({ length: 999 }, (_, i) => (i + 1).toString().padStart(3, '0'));

// --- マッチング関数 ---
function tryMatch(me) {
  if (!me.searching || !matchesEnabled) return;
  const waitingUsers = users.filter(u =>
    u.id !== me.id &&
    u.searching &&
    !me.history.some(h => h.opponent === u.name) &&
    !Object.values(activeDesks).flat().includes(u.id)
  );
  if (waitingUsers.length === 0) return;

  const opponent = waitingUsers[Math.floor(Math.random() * waitingUsers.length)];
  const deskNum = desks.find(d => !(d in activeDesks));
  if (!deskNum) return;

  activeDesks[deskNum] = [me.id, opponent.id];

  io.to(me.socketId).emit('matched', { opponent: { name: opponent.name, id: opponent.id }, deskNum });
  io.to(opponent.socketId).emit('matched', { opponent: { name: me.name, id: me.id }, deskNum });

  me.searching = false;
  opponent.searching = false;
}

// --- Socket.io ---
io.on('connection', socket => {

  // ユーザーログイン
  socket.on('login', ({ name }) => {
    const userId = (users.length + 1).toString().padStart(3, '0');
    const user = { id: userId, name, socketId: socket.id, points: 0, history: [], searching: false };
    users.push(user);
    socket.emit('login_ok', user);
    socket.emit('match_status', { enabled: matchesEnabled });
  });

  // 対戦相手探す
  socket.on('find_opponent', () => {
    const me = users.find(u => u.socketId === socket.id);
    if (!me) return;
    me.searching = true;
    tryMatch(me);
  });

  socket.on('cancel_find', () => {
    const me = users.find(u => u.socketId === socket.id);
    if (me) me.searching = false;
  });

  // 勝利報告
  socket.on('report_win', () => {
    const me = users.find(u => u.socketId === socket.id);
    if (!me) return;

    const deskNum = Object.keys(activeDesks).find(d => activeDesks[d].includes(me.id));
    if (!deskNum) return;

    const [id1, id2] = activeDesks[deskNum];
    const opponent = users.find(u => u.id === (id1 === me.id ? id2 : id1));

    const now = new Date().toLocaleTimeString();
    me.points += 1;
    me.history.push({ opponent: opponent.name, result: '勝ち', startTime: now, endTime: now });
    opponent.history.push({ opponent: me.name, result: '負け', startTime: now, endTime: now });

    delete activeDesks[deskNum];

    io.to(me.socketId).emit('return_to_menu');
    io.to(opponent.socketId).emit('return_to_menu');
  });

  // 対戦履歴
  socket.on('request_history', () => {
    const me = users.find(u => u.socketId === socket.id);
    if (!me) return;
    socket.emit('history', me.history);
  });

  // ログアウト
  socket.on('logout', () => {
    users = users.filter(u => u.socketId !== socket.id);
    for (const desk in activeDesks) {
      if (activeDesks[desk].includes(socket.id)) {
        delete activeDesks[desk];
      }
    }
  });

  // 管理者ログイン
  socket.on('admin_login', ({ password }) => {
    if (password === '9396') {
      socket.admin = true;
      socket.emit('admin_ok');
    } else socket.emit('admin_fail');
  });

  socket.on('admin_toggle_match', ({ enable }) => {
    if (!socket.admin) return;
    matchesEnabled = enable;
    io.emit(enable ? 'match_enabled' : 'match_disabled');
    users.forEach(u => {
      const s = io.sockets.sockets.get(u.socketId);
      if (s) s.emit('match_status', { enabled: matchesEnabled });
    });
  });

  socket.on('admin_view_users', () => {
    if (!socket.admin) return;
    const list = users.map(u => ({ id: u.id, name: u.name, history: u.history }));
    socket.emit('admin_user_list', list);
  });

  socket.on('admin_draw_lots', ({ count }) => {
    if (!socket.admin) return;
    const eligible = users.filter(u => u.history.length >= 5);
    const shuffled = eligible.sort(() => 0.5 - Math.random());
    socket.emit('admin_draw_result', shuffled.slice(0, count));
  });

  // --- 新機能: 全ユーザー一括ログアウト ---
  socket.on('admin_logout_all', () => {
    if (!socket.admin) return;

    users.forEach(u => {
      const s = io.sockets.sockets.get(u.socketId);
      if (s) s.emit('return_to_menu');
    });

    users = [];
    activeDesks = {};
  });

});
