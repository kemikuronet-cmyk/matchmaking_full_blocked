// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- ユーザー管理 ---
let users = {};        // socketId -> { id, name }
let waitingQueue = []; // 対戦待機ユーザー

// --- Socket.IO イベント ---
io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  // ユーザーログイン
  socket.on("login", ({ name }) => {
    const user = { id: socket.id, name, history: [] };
    users[socket.id] = user;
    socket.emit("login_ok", user);
    console.log(`User logged in: ${name}`);
  });

  // 対戦相手を探す
  socket.on("find_opponent", () => {
    if (!users[socket.id]) return;
    if (!waitingQueue.includes(socket.id)) waitingQueue.push(socket.id);

    if (waitingQueue.length >= 2) {
      const [player1Id, player2Id] = waitingQueue.splice(0, 2);
      const player1 = users[player1Id];
      const player2 = users[player2Id];

      // 卓番号は簡易的に socketId の一部を利用
      const deskNum = Math.floor(Math.random() * 1000);

      io.to(player1Id).emit("matched", { opponent: player2, deskNum });
      io.to(player2Id).emit("matched", { opponent: player1, deskNum });

      console.log(`Matched: ${player1.name} vs ${player2.name} at desk ${deskNum}`);
    }
  });

  // 対戦キャンセル
  socket.on("cancel_find", () => {
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    console.log(`User ${socket.id} canceled finding`);
  });

  // 勝利報告
  socket.on("report_win", () => {
    console.log(`User ${socket.id} reports win`);
    // 簡易的に履歴を保存
    if (users[socket.id]) users[socket.id].history.push({ result: "win", timestamp: new Date() });
  });

  // 対戦履歴リクエスト
  socket.on("request_history", () => {
    const hist = users[socket.id]?.history || [];
    socket.emit("history", hist);
  });

  // ログアウト
  socket.on("logout", () => {
    delete users[socket.id];
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    console.log(`User ${socket.id} logged out`);
  });

  // 切断時
  socket.on("disconnect", () => {
    delete users[socket.id];
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    console.log(`Disconnected: ${socket.id}`);
  });
});

// --- React 静的ファイル配信 ---
app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

// --- サーバー起動 ---
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
