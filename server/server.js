// Server.js — 改修済み完全版
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(cors());
app.use(express.static("public")); // React buildなど

// ------------------------
// データ管理
// ------------------------
let users = {}; // sessionId → { name, id, socket, recentOpponents, history, deskNum, opponent }
let desks = []; // [{ deskNum, player1SessionId, player2SessionId, player1, player2 }]
let lotteryHistory = []; // [{ title, winners, time }]
let matchEnabled = false;
let nextDeskNum = 1;

// ------------------------
// ユーティリティ
// ------------------------
function findAvailableOpponent(sessionId) {
  for (const sId in users) {
    if (
      sId !== sessionId &&
      !users[sId].deskNum &&
      !users[sessionId].recentOpponents.includes(users[sId].id) &&
      !users[sId].recentOpponents.includes(users[sessionId].id)
    ) {
      return users[sId];
    }
  }
  return null;
}

function assignDesk(player1, player2) {
  const deskNum = nextDeskNum++;
  desks.push({
    deskNum,
    player1SessionId: player1.sessionId,
    player2SessionId: player2.sessionId,
    player1: player1.name,
    player2: player2.name,
  });
  player1.deskNum = deskNum;
  player2.deskNum = deskNum;
  player1.opponent = { name: player2.name, id: player2.id };
  player2.opponent = { name: player1.name, id: player1.id };
  player1.recentOpponents.push(player2.id);
  player2.recentOpponents.push(player1.id);
  player1.socket.emit("matched", { opponent: player2.opponent, deskNum });
  player2.socket.emit("matched", { opponent: player1.opponent, deskNum });
}

// ------------------------
// Socket.io
// ------------------------
io.on("connection", (socket) => {
  console.log("✅ connected", socket.id);

  // ------------------------
  // ログイン
  // ------------------------
  socket.on("login", (data) => {
    const sessionId = data.sessionId || socket.id;
    if (!users[sessionId]) {
      users[sessionId] = {
        id: sessionId,
        name: data.name,
        socket,
        recentOpponents: data.recentOpponents || [],
        history: data.history || [],
        deskNum: null,
        opponent: null,
      };
    } else {
      users[sessionId].socket = socket;
      users[sessionId].name = data.name;
      users[sessionId].recentOpponents = data.recentOpponents || [];
      users[sessionId].history = data.history || [];
    }

    const u = users[sessionId];
    socket.emit("login_ok", {
      name: u.name,
      id: u.id,
      sessionId,
      history: u.history,
      deskNum: u.deskNum,
      opponent: u.opponent,
      matchEnabled,
    });
  });

  // ------------------------
  // マッチング
  // ------------------------
  socket.on("find_opponent", () => {
    const u = Object.values(users).find((usr) => usr.socket.id === socket.id);
    if (!u || !matchEnabled) return;
    const opponent = findAvailableOpponent(u.sessionId);
    if (opponent) assignDesk(u, opponent);
  });

  socket.on("cancel_find", () => {});

  // ------------------------
  // 勝利報告
  // ------------------------
  socket.on("report_win_request", () => {
    const u = Object.values(users).find((usr) => usr.socket.id === socket.id);
    if (!u || !u.deskNum) return;
    const deskIndex = desks.findIndex((d) => d.deskNum === u.deskNum);
    if (deskIndex === -1) return;

    const desk = desks[deskIndex];
    const player1 = users[desk.player1SessionId];
    const player2 = users[desk.player2SessionId];

    // 勝敗登録
    if (u.sessionId === desk.player1SessionId) {
      player1.history.push({ opponent: player2.name, result: "WIN" });
      player2.history.push({ opponent: player1.name, result: "LOSE" });
    } else {
      player2.history.push({ opponent: player1.name, result: "WIN" });
      player1.history.push({ opponent: player2.name, result: "LOSE" });
    }

    // 卓解放
    player1.deskNum = null;
    player2.deskNum = null;
    player1.opponent = null;
    player2.opponent = null;
    desks.splice(deskIndex, 1);

    // メニューに戻す通知
    player1.socket.emit("return_to_menu_battle");
    player2.socket.emit("return_to_menu_battle");

    // 履歴更新通知
    player1.socket.emit("history", player1.history);
    player2.socket.emit("history", player2.history);
  });

  // ------------------------
  // 管理者
  // ------------------------
  socket.on("admin_login", ({ password }) => {
    if (password === "admin") { // 固定パスワード例
      socket.emit("admin_ok");
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    const status = enable ? "マッチング中" : "停止中";
    io.emit("match_status_update", { enabled: matchEnabled, status });
  });

  socket.on("admin_draw_lots", ({ title, count }) => {
    const candidates = Object.values(users);
    const winners = [];
    const copy = [...candidates];
    while (winners.length < count && copy.length > 0) {
      const idx = Math.floor(Math.random() * copy.length);
      winners.push(copy.splice(idx, 1)[0]);
    }
    const record = { title, winners: winners.map((w) => ({ name: w.name })), time: Date.now() };
    lotteryHistory.push(record);
    io.emit("admin_lottery_result", record);
    winners.forEach((w) => w.socket.emit("lottery_winner", { title }));
  });

  // ------------------------
  // 切断
  // ------------------------
  socket.on("disconnect", () => {
    const u = Object.values(users).find((usr) => usr.socket.id === socket.id);
    if (u) {
      if (u.deskNum) {
        // 対戦中なら卓を解放
        const deskIndex = desks.findIndex((d) => d.deskNum === u.deskNum);
        if (deskIndex !== -1) {
          const desk = desks[deskIndex];
          const otherId = desk.player1SessionId === u.sessionId ? desk.player2SessionId : desk.player1SessionId;
          const other = users[otherId];
          if (other) {
            other.deskNum = null;
            other.opponent = null;
            other.socket.emit("return_to_menu_battle");
          }
          desks.splice(deskIndex, 1);
        }
      }
      delete users[u.sessionId];
    }
  });
});

// ------------------------
// サーバ起動
// ------------------------
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
