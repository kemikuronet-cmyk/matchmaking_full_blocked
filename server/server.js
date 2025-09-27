const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 4000;

// ===== React 静的ファイル配信 =====
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// React Router などを使う場合、全ルートを index.html にフォールバック
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// ===== HTTP サーバー & Socket.io =====
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // 必要に応じてアクセス制限
    methods: ['GET', 'POST']
  }
});

// ===== マッチング・ユーザー管理 =====
let users = [];       // ログイン済みユーザー情報
let battles = [];     // 対戦履歴
let nextTableNumber = 1;

// サンプル Socket.io ハンドリング
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ユーザーログイン
  socket.on('login', (username) => {
    // 001, 002... の自動ID付与
    const id = String(users.length + 1).padStart(3, '0');
    const user = { id, username, socketId: socket.id, wins: 0, searching: false };
    users.push(user);
    socket.emit('login_success', user);
  });

  // 対戦相手を探す
  socket.on('start_search', () => {
    const me = users.find(u => u.socketId === socket.id);
    if (!me) return;
    me.searching = true;

    // 同じく searching=true のユーザーでランダムにマッチング
    const candidates = users.filter(u => u.searching && u.socketId !== socket.id);
    if (candidates.length === 0) return; // 待機
    const opponent = candidates[Math.floor(Math.random() * candidates.length)];

    // 卓番号付与（001〜999）
    const tableNumber = String(nextTableNumber).padStart(3, '0');
    nextTableNumber = nextTableNumber < 999 ? nextTableNumber + 1 : 1;

    // 対戦開始
    const battle = {
      tableNumber,
      player1: me,
      player2: opponent,
      startTime: new Date(),
      winner: null,
      endTime: null
    };
    battles.push(battle);

    // 検索フラグ解除
    me.searching = false;
    opponent.searching = false;

    // 双方に通知
    io.to(me.socketId).emit('matched', battle);
    io.to(opponent.socketId).emit('matched', battle);
  });

  // 勝利報告
  socket.on('report_win', () => {
    const battle = battles.find(b => b.player1.socketId === socket.id || b.player2.socketId === socket.id);
    if (!battle) return;

    // 勝者判定
    const winner = battle.player1.socketId === socket.id ? battle.player1 : battle.player2;
    winner.wins += 1;
    battle.winner = winner;
    battle.endTime = new Date();

    // 両者にメニュー画面に戻る通知
    io.to(battle.player1.socketId).emit('return_menu', battle);
    io.to(battle.player2.socketId).emit('return_menu', battle);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // ユーザーリストから削除
    users = users.filter(u => u.socketId !== socket.id);
  });
});

// ===== サーバー起動 =====
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
