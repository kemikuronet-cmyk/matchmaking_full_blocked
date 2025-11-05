// server/Server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// --------------------
// データ保持用メモリ
// --------------------
let users = {}; // sessionId -> { id, name, socketId, history, recentOpponents, status, loginTime }
let adminPassword = "admin123"; // ここは適宜変更
let matchEnabled = false;
let searchingUsers = [];
let activeMatches = []; // { deskNum, player1SessionId, player2SessionId, player1, player2 }
let lotteryHistory = []; // { title, winners: [{name, sessionId}] }
let lotteryCurrent = []; // 抽選結果を一時保持
let autoLogoutHours = 12;

// --------------------
// ユーティリティ関数
// --------------------
function generateDeskNum() {
  return Math.floor(Math.random() * 1000);
}

function emitUserList() {
  const list = Object.values(users).map(u => ({
    id: u.id,
    name: u.name,
    history: u.history,
    loginTime: u.loginTime,
    status: u.status,
  }));
  io.emit("admin_user_list", list);
}

function checkMatchmaking() {
  while (matchEnabled && searchingUsers.length >= 2) {
    const player1 = searchingUsers.shift();
    const player2 = searchingUsers.shift();
    const deskNum = generateDeskNum();
    activeMatches.push({
      deskNum,
      player1SessionId: player1.sessionId,
      player2SessionId: player2.sessionId,
      player1: player1.name,
      player2: player2.name,
    });

    io.to(player1.socketId).emit("matched", { opponent: { name: player2.name }, deskNum });
    io.to(player2.socketId).emit("matched", { opponent: { name: player1.name }, deskNum });
  }
}

// --------------------
// Socket.io 接続
// --------------------
io.on("connection", socket => {
  console.log("New client connected:", socket.id);

  // --------------------
  // ユーザーログイン
  // --------------------
  socket.on("login", ({ name, sessionId, history = [], recentOpponents = [] }) => {
    let sid = sessionId || uuidv4();
    users[sid] = {
      id: sid,
      name,
      socketId: socket.id,
      history,
      recentOpponents,
      status: "idle",
      loginTime: Date.now(),
      currentOpponent: null,
    };
    socket.emit("login_ok", users[sid]);
    emitUserList();
  });

  // --------------------
  // 管理者ログイン
  // --------------------
  socket.on("admin_login", ({ password }) => {
    if (password === adminPassword) {
      socket.emit("admin_ok");
    } else {
      socket.emit("admin_fail");
    }
  });

  // --------------------
  // マッチング制御
  // --------------------
  socket.on("find_opponent", () => {
    const u = Object.values(users).find(user => user.socketId === socket.id);
    if (!u) return;
    if (!searchingUsers.includes(u)) searchingUsers.push(u);
    u.status = "searching";
    checkMatchmaking();
  });

  socket.on("cancel_find", () => {
    const u = Object.values(users).find(user => user.socketId === socket.id);
    if (!u) return;
    searchingUsers = searchingUsers.filter(user => user.socketId !== socket.id);
    u.status = "idle";
  });

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
    if (enable) checkMatchmaking();
  });

  // --------------------
  // 勝敗報告
  // --------------------
  socket.on("report_win_request", () => {
    const u = Object.values(users).find(user => user.socketId === socket.id);
    if (!u) return;
    // activeMatches から desk を探す
    const match = activeMatches.find(m => m.player1SessionId === u.id || m.player2SessionId === u.id);
    if (!match) return;
    const opponentId = match.player1SessionId === u.id ? match.player2SessionId : match.player1SessionId;
    const opponent = users[opponentId];
    if (!opponent) return;

    io.to(opponent.socketId).emit("confirm_opponent_win", { winnerName: u.name, deskNum: match.deskNum });
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const u = Object.values(users).find(user => user.socketId === socket.id);
    if (!u) return;
    if (!accepted) return;
    // 勝敗を記録
    const match = activeMatches.find(m => m.player1SessionId === u.id || m.player2SessionId === u.id);
    if (!match) return;

    let winner, loser;
    if (match.player1SessionId === u.id) {
      winner = u;
      loser = users[match.player2SessionId];
    } else {
      winner = u;
      loser = users[match.player1SessionId];
    }

    winner.history.push({ opponent: loser.name, result: "WIN", endTime: Date.now() });
    loser.history.push({ opponent: winner.name, result: "LOSE", endTime: Date.now() });

    io.to(winner.socketId).emit("win_report_cancelled");
    io.to(loser.socketId).emit("win_report_cancelled");

    // activeMatches から削除
    activeMatches = activeMatches.filter(m => m !== match);
  });

  // --------------------
  // ログアウト
  // --------------------
  socket.on("logout", () => {
    const u = Object.values(users).find(user => user.socketId === socket.id);
    if (!u) return;
    delete users[u.id];
    searchingUsers = searchingUsers.filter(user => user.id !== u.id);
    activeMatches = activeMatches.filter(m => m.player1SessionId !== u.id && m.player2SessionId !== u.id);
    emitUserList();
  });

  // --------------------
  // 抽選処理
  // --------------------
  socket.on("admin_draw_lots", ({ count, minBattles, minLoginMinutes, title }) => {
    const eligible = Object.values(users).filter(u =>
      u.history.length >= minBattles &&
      (Date.now() - u.loginTime) / 60000 >= minLoginMinutes
    );
    const winners = [];
    for (let i = 0; i < count && eligible.length > 0; i++) {
      const idx = Math.floor(Math.random() * eligible.length);
      winners.push({ name: eligible[idx].name, sessionId: eligible[idx].id });
      eligible.splice(idx, 1);
    }
    lotteryHistory.push({ title, winners });
    lotteryCurrent = { title, winners };
    io.emit("admin_draw_result", { title, winners });
    io.emit("lottery_winner", { title });
  });

  socket.on("admin_set_lottery_title", ({ title }) => {
    lotteryCurrent.title = title;
    socket.emit("admin_set_lottery_title_ok", { title });
  });

  socket.on("admin_get_lottery_history", () => {
    socket.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_delete_lottery_history", ({ index }) => {
    lotteryHistory.splice(index, 1);
    io.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_clear_lottery_history", () => {
    lotteryHistory = [];
    io.emit("admin_lottery_history", lotteryHistory);
  });

  // --------------------
  // 自動ログアウト設定
  // --------------------
  socket.on("admin_get_auto_logout", () => {
    socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
  });

  socket.on("admin_set_auto_logout", ({ hours }) => {
    autoLogoutHours = hours;
    socket.emit("admin_set_auto_logout_ok", { hours });
  });

  // --------------------
  // 強制ログアウト（ユーザー操作）
  // --------------------
  socket.on("admin_logout_user", ({ userId }) => {
    const u = users[userId];
    if (u) {
      io.to(u.socketId).emit("force_logout", { reason: "admin" });
      delete users[userId];
      searchingUsers = searchingUsers.filter(user => user.id !== userId);
      activeMatches = activeMatches.filter(m => m.player1SessionId !== userId && m.player2SessionId !== userId);
    }
    emitUserList();
  });

  socket.on("admin_logout_all", () => {
    Object.values(users).forEach(u => io.to(u.socketId).emit("force_logout", { reason: "admin" }));
    users = {};
    searchingUsers = [];
    activeMatches = [];
    emitUserList();
  });

  // --------------------
  // 管理者対戦操作
  // --------------------
  socket.on("admin_report_win", ({ winnerSessionId, deskNum }) => {
    const match = activeMatches.find(m => m.deskNum === deskNum);
    if (!match) return;
    const winner = users[winnerSessionId];
    const loserSessionId = match.player1SessionId === winnerSessionId ? match.player2SessionId : match.player1SessionId;
    const loser = users[loserSessionId];
    if (!winner || !loser) return;
    winner.history.push({ opponent: loser.name, result: "WIN", endTime: Date.now() });
    loser.history.push({ opponent: winner.name, result: "LOSE", endTime: Date.now() });
    activeMatches = activeMatches.filter(m => m !== match);
  });

  socket.on("admin_report_both_lose", ({ deskNum }) => {
    const match = activeMatches.find(m => m.deskNum === deskNum);
    if (!match) return;
    const p1 = users[match.player1SessionId];
    const p2 = users[match.player2SessionId];
    if (p1) p1.history.push({ opponent: p2 ? p2.name : "不明", result: "LOSE", endTime: Date.now() });
    if (p2) p2.history.push({ opponent: p1 ? p1.name : "不明", result: "LOSE", endTime: Date.now() });
    activeMatches = activeMatches.filter(m => m !== match);
  });

  // --------------------
  // アクティブマッチ一覧
  // --------------------
  socket.on("admin_get_active_matches", () => {
    socket.emit("admin_active_matches", activeMatches);
  });

  socket.on("disconnect", () => {
    const u = Object.values(users).find(user => user.socketId === socket.id);
    if (u) {
      delete users[u.id];
      searchingUsers = searchingUsers.filter(user => user.id !== u.id);
      activeMatches = activeMatches.filter(m => m.player1SessionId !== u.id && m.player2SessionId !== u.id);
      emitUserList();
    }
  });
});

// --------------------
// Express ルート
// --------------------
app.get("/", (req, res) => {
  res.send("Server is running");
});

// --------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
