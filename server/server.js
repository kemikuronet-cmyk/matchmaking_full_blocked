// Server.js — 本番向け最適化版
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

// ------------------------
// React build 配信
// ------------------------
app.use(express.static(path.join(__dirname, "../dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

// ------------------------
// データ管理
// ------------------------
let users = {}; // sessionId -> { name, id, sessionId, socketId, recentOpponents, history }
let desks = {}; // deskNum -> { player1, player2 }
let lotteryHistory = [];
let nextDeskNum = 1;
let matchEnabled = false;

// ------------------------
// Socket.io 接続
// ------------------------
io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  // ログイン
  socket.on("login", ({ name, sessionId, recentOpponents = [], history = [] }) => {
    const id = randomUUID();
    const userData = { name, id, sessionId: sessionId || id, socketId: socket.id, recentOpponents, history };
    users[userData.sessionId] = userData;

    socket.emit("login_ok", {
      name: userData.name,
      id: userData.id,
      sessionId: userData.sessionId,
      history: userData.history,
      deskNum: null,
      opponent: null,
      matchEnabled
    });

    // 更新されたマッチング状態を送信
    socket.emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });
  });

  // 管理者ログイン
  socket.on("admin_login", ({ password }) => {
    if (password === process.env.ADMIN_PASS) {
      socket.emit("admin_ok");
    } else {
      socket.emit("admin_fail");
    }
  });

  // マッチング有効化/無効化
  socket.on("admin_enable_matching", () => {
    matchEnabled = true;
    io.emit("match_status_update", { enabled: true, status: "マッチング中" });
  });

  socket.on("admin_disable_matching", () => {
    matchEnabled = false;
    io.emit("match_status_update", { enabled: false, status: "停止中" });
  });

  // 対戦相手探し
  socket.on("find_opponent", () => {
    if (!matchEnabled) return;

    const requester = Object.values(users).find(u => u.socketId === socket.id);
    if (!requester) return;

    // 対戦可能な相手を検索（過去対戦していないユーザー）
    const available = Object.values(users).filter(u =>
      u.socketId !== socket.id &&
      !requester.recentOpponents.includes(u.id) &&
      !Object.values(desks).some(d => d.player1 === u.id || d.player2 === u.id)
    );

    if (available.length === 0) return; // 今はいない

    const opponent = available[0];
    const deskNum = nextDeskNum++;

    desks[deskNum] = { player1: requester.id, player2: opponent.id };

    requester.recentOpponents.push(opponent.id);
    opponent.recentOpponents.push(requester.id);

    // 各ユーザーに通知
    io.to(requester.socketId).emit("matched", { opponent: { name: opponent.name, id: opponent.id }, deskNum });
    io.to(opponent.socketId).emit("matched", { opponent: { name: requester.name, id: requester.id }, deskNum });
  });

  // 勝利報告
  socket.on("report_win_request", () => {
    const winner = Object.values(users).find(u => u.socketId === socket.id);
    if (!winner) return;

    // 勝利した卓を特定
    const deskNum = Object.entries(desks).find(([num, d]) => d.player1 === winner.id || d.player2 === winner.id)?.[0];
    if (!deskNum) return;

    const desk = desks[deskNum];
    const loserId = desk.player1 === winner.id ? desk.player2 : desk.player1;
    const loser = Object.values(users).find(u => u.id === loserId);

    // 対戦履歴に反映
    winner.history.push({ opponent: loser.name, result: "WIN" });
    loser.history.push({ opponent: winner.name, result: "LOSE" });

    io.to(winner.socketId).emit("return_to_menu_battle");
    io.to(loser.socketId).emit("return_to_menu_battle");

    // 卓を解放
    delete desks[deskNum];
  });

  // 抽選
  socket.on("admin_run_lottery", ({ title, count }) => {
    const allUsers = Object.values(users);
    const winners = [];

    while (winners.length < count && allUsers.length > 0) {
      const idx = Math.floor(Math.random() * allUsers.length);
      const winner = allUsers.splice(idx, 1)[0];
      winners.push({ name: winner.name });
      io.to(winner.socketId).emit("lottery_winner", { title });
    }

    const record = { title, winners, time: Date.now() };
    lotteryHistory.push(record);
    io.emit("admin_lottery_result", record);
  });

  // heartbeat
  socket.on("heartbeat", ({ sessionId }) => {
    // noop: 存在確認
  });

  // disconnect
  socket.on("disconnect", () => {
    // ユーザー切断は特に処理しない
  });
});

// ------------------------
// サーバ起動
// ------------------------
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
