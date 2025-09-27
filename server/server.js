// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// -----------------------------
// データ管理
// -----------------------------
let nextUserId = 1;
const users = {}; // { socketId: { id, name, wins, history: [], searching, opponentId } }
const matches = {}; // 卓番号: { player1, player2, startTime }
let nextTableNumber = 1;
const MAX_TABLE_NUMBER = 999;

let isMatchingEnabled = false; // 管理者によるマッチング制御

// -----------------------------
// 静的ファイル配信
// -----------------------------
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// -----------------------------
// Socket.io イベント
// -----------------------------
io.on('connection', (socket) => {
  console.log('ユーザー接続:', socket.id);

  // ログイン
  socket.on('login', ({ name }) => {
    if (!users[socket.id]) {
      const id = String(nextUserId).padStart(3, '0');
      nextUserId++;
      users[socket.id] = { id, name, wins: 0, history: [], searching: false, opponentId: null };
      socket.emit('login_success', { id, name, wins: 0 });
      console.log(`ログイン: ${name} (${id})`);
    }
  });

  // 対戦相手を探す
  socket.on('find_opponent', () => {
    if (!isMatchingEnabled) return;
    const user = users[socket.id];
    if (!user || user.searching) return;

    user.searching = true;

    // マッチング対象: searching=true かつ opponentId=null かつ 過去に対戦していないユーザー
    const candidates = Object.entries(users).filter(([sid, u]) => {
      return u.searching && u.opponentId === null && sid !== socket.id &&
             !user.history.find(h => h.opponentId === u.id);
    });

    if (candidates.length === 0) return; // 待機

    // ランダム選択
    const randomIndex = Math.floor(Math.random() * candidates.length);
    const [opponentSocketId, opponent] = candidates[randomIndex];

    // 卓番号割り当て
    let tableNum = String(nextTableNumber).padStart(3, '0');
    nextTableNumber++;
    if (nextTableNumber > MAX_TABLE_NUMBER) nextTableNumber = 1;

    // マッチング
    user.opponentId = opponent.id;
    opponent.opponentId = user.id;

    const startTime = new Date();
    matches[tableNum] = { player1: socket.id, player2: opponentSocketId, startTime };

    // 両者に通知
    socket.emit('matched', { opponentName: opponent.name, tableNum });
    io.to(opponentSocketId).emit('matched', { opponentName: user.name, tableNum });
  });

  // マッチングキャンセル
  socket.on('cancel_find', () => {
    const user = users[socket.id];
    if (user) user.searching = false;
  });

  // 勝利報告
  socket.on('report_win', ({ opponentId }) => {
    const user = users[socket.id];
    const opponent = Object.values(users).find(u => u.id === opponentId);
    if (!user || !opponent) return;

    const now = new Date();
    user.wins++;
    user.history.push({ opponentId: opponent.id, result: '勝ち', startTime: now, endTime: now });
    opponent.history.push({ opponentId: user.id, result: '負け', startTime: now, endTime: now });

    // 両者をメニュー画面に戻す
    user.opponentId = null;
    opponent.opponentId = null;
    user.searching = false;
    opponent.searching = false;

    socket.emit('match_ended');
    io.to(Object.keys(users).find(k => users[k].id === opponentId)).emit('match_ended');
  });

  // 管理者用: マッチング開始
  socket.on('admin_start_matching', () => {
    isMatchingEnabled = true;
    io.emit('matching_status', { enabled: true });
  });

  // 管理者用: マッチング終了
  socket.on('admin_stop_matching', () => {
    isMatchingEnabled = false;
    io.emit('matching_status', { enabled: false });
  });

  // 切断時
  socket.on('disconnect', () => {
    console.log('ユーザー切断:', socket.id);
    const user = users[socket.id];
    if (user) {
      delete users[socket.id];
    }
  });
});

// -----------------------------
// サーバー起動
// -----------------------------
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
