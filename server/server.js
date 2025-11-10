// ✅ Server.js（完全統合版：管理者画面ユーザー表示 + 抽選機能 + マッチング + 勝敗履歴 + 永続化）
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Render / Vite ビルド対応
const CLIENT_DIST = path.join(__dirname, "../client/dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) => res.send("Client dist not found. Please build client."));
}

// 永続データ保存用
const DATA_FILE = path.join(__dirname, "server_data.json");

let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];

// ------------------------------
// データ永続化
// ------------------------------
function saveData() {
  const data = {
    users: users.map(u => ({ ...u, recentOpponents: u.recentOpponents || [] })),
    desks,
    lotteryHistory
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (data.users) users = data.users.map(u => ({ ...u, recentOpponents: u.recentOpponents || [] }));
      if (data.desks) desks = data.desks;
      if (data.lotteryHistory) lotteryHistory = data.lotteryHistory;
    } catch (e) {
      console.error("❌ Failed to load server_data.json:", e);
    }
  }
}

// ------------------------------
// ヘルパー関数
// ------------------------------
const now = () => new Date().toISOString();
function assignDeskSequential() { let i = 1; while (desks[i]) i++; return i; }
const findUserBySocket = (socketId) => users.find((u) => u.id === socketId);
const findUserBySession = (sessionId) => users.find((u) => u.sessionId === sessionId);

function calculateWinsLosses(user) {
  user.wins = user.history.filter(h => h.result === "WIN").length;
  user.losses = user.history.filter(h => h.result === "LOSE").length;
  user.totalBattles = user.history.length;
}

function compactUserForAdmin(u) {
  return {
    id: u.id,
    name: u.name,
    sessionId: u.sessionId,
    status: u.status,
    loginTime: u.loginTime,
    history: u.history || []
  };
}

function sendUserListTo(socket = null) {
  const payload = users.map(u => compactUserForAdmin(u));
  if (socket && typeof socket.emit === "function") socket.emit("admin_user_list", payload);
  if (adminSocket && adminSocket.id !== socket?.id) adminSocket.emit("admin_user_list", payload);
}

function broadcastActiveMatchesToAdmin() {
  const active = Object.keys(desks).map(deskNum => {
    const d = desks[deskNum];
    return {
      deskNum,
      player1: d.p1?.name || "不明",
      player2: d.p2?.name || "不明",
      player1SessionId: d.p1?.sessionId,
      player2SessionId: d.p2?.sessionId
    };
  });
  if (adminSocket) adminSocket.emit("admin_active_matches", active);
}

// ------------------------------
// Socket.IO イベント
// ------------------------------
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // ------------------------------
  // ユーザーログイン
  // ------------------------------
  socket.on("login", ({ name, sessionId, recentOpponents, history } = {}) => {
    if (!name || !name.trim()) return;

    let user = sessionId ? findUserBySession(sessionId) : null;
    if (!user) user = users.find(u => u.name === name);

    if (user) {
      const hoursDiff = (Date.now() - new Date(user.loginTime).getTime()) / 3600000;
      if (hoursDiff >= autoLogoutHours) {
        user.history = [];
        user.recentOpponents = [];
      }
      user.id = socket.id;
      user.status = user.status || "idle";
    } else {
      user = {
        id: socket.id,
        name,
        sessionId: sessionId || socket.id,
        status: "idle",
        loginTime: now(),
        history: history || [],
        recentOpponents: recentOpponents || []
      };
      users.push(user);
    }

    calculateWinsLosses(user);
    saveData();

    socket.emit("match_status", { enabled: matchEnabled });
    socket.emit("login_ok", { ...user, history: user.history, wins: user.wins, losses: user.losses, totalBattles: user.totalBattles });

    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // ------------------------------
  // ログアウト
  // ------------------------------
  socket.on("logout", () => {
    users = users.filter(u => u.id !== socket.id);
    saveData();
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // ------------------------------
  // マッチング関連
  // ------------------------------
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const candidate = users.find(u =>
      u.id !== user.id &&
      u.status === "searching" &&
      !(user.recentOpponents || []).includes(u.sessionId) &&
      !(u.recentOpponents || []).includes(user.sessionId)
    );

    if (candidate) {
      const deskNum = assignDeskSequential();
      desks[deskNum] = { p1: user, p2: candidate, reported: null };
      user.status = candidate.status = "in_battle";

      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", { opponent: { id: candidate.id, name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });

      broadcastActiveMatchesToAdmin();
      saveData();
    }
    sendUserListTo();
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
    saveData();
    sendUserListTo();
  });

  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;
    const deskNum = Object.keys(desks).find(d => {
      const m = desks[d];
      return m && (m.p1.id === socket.id || m.p2.id === socket.id);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    const opponent = match.p1.id === socket.id ? match.p2 : match.p1;
    match.reported = user.id;

    io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });
    sendUserListTo();
  });

  socket.on("opponent_win_confirmed", ({ accepted } = {}) => {
    const confirmer = findUserBySocket(socket.id);
    if (!confirmer) return;

    const deskNum = Object.keys(desks).find(d => {
      const m = desks[d];
      return m && (m.p1.id === socket.id || m.p2.id === socket.id);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    if (!match || !match.reported) return;

    const reporter = match.p1.id === match.reported ? match.p1 : match.p2;
    const loser = match.p1.id === match.reported ? match.p2 : match.p1;

    if (!accepted) {
      io.to(reporter.id).emit("win_report_cancelled");
      io.to(loser.id).emit("win_report_cancelled");
      match.reported = null;
      return;
    }

    reporter.history.push({ opponent: loser.name, result: "WIN", endTime: now() });
    loser.history.push({ opponent: reporter.name, result: "LOSE", endTime: now() });

    calculateWinsLosses(reporter);
    calculateWinsLosses(loser);
    saveData();

    io.to(reporter.id).emit("history", reporter.history);
    io.to(loser.id).emit("history", loser.history);
    io.to(reporter.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

  // ------------------------------
  // 管理者関連
  // ------------------------------
  socket.on("admin_login", ({ password } = {}) => {
    if (password === adminPassword) {
      adminSocket = socket;
      console.log("Admin logged in:", socket.id);
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
      sendUserListTo(adminSocket);
      broadcastActiveMatchesToAdmin();
      socket.emit("admin_lottery_history", lotteryHistory);
    } else socket.emit("admin_fail");
  });

  socket.on("admin_toggle_match", ({ enable } = {}) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
    saveData();
  });

  socket.on("admin_view_users", () => sendUserListTo());

  // ✅ 抽選機能を追加
  socket.on("admin_draw_lots", ({ count = 1, title = "抽選", minBattles = 0, minLoginMinutes = 0 }) => {
    if (socket.id !== adminSocket?.id) return;

    const nowTime = Date.now();
    const eligibleUsers = users.filter(u => {
      const battles = u.history?.length || 0;
      const minutes = (nowTime - new Date(u.loginTime).getTime()) / 60000;
      return battles >= minBattles && minutes >= minLoginMinutes && u.status !== "in_battle";
    });

    if (eligibleUsers.length === 0) {
      socket.emit("admin_draw_result", { title, winners: [] });
      return;
    }

    const shuffled = [...eligibleUsers].sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, count);

    // 当選者に通知
    winners.forEach(w => {
      io.to(w.id).emit("lottery_winner", { title });
    });

    // 履歴に追加
    const record = {
      title,
      winners: winners.map(w => w.name),
      time: now(),
    };
    lotteryHistory.unshift(record);
    if (lotteryHistory.length > 100) lotteryHistory.pop();

    // 管理者と全員に通知
    socket.emit("admin_draw_result", { title, winners });
    socket.emit("admin_lottery_history", lotteryHistory);
    io.emit("update_lottery_list", { list: lotteryHistory });

    console.log(`🎯 抽選実行: ${title} / 当選者: ${winners.map(w => w.name).join(", ")}`);
    saveData();
  });

  // ------------------------------
  // 切断
  // ------------------------------
  socket.on("disconnect", () => {
    users = users.filter(u => u.id !== socket.id);
    Object.keys(desks).forEach(d => {
      const match = desks[d];
      if (match && (match.p1.id === socket.id || match.p2.id === socket.id)) delete desks[d];
    });
    if (adminSocket && adminSocket.id === socket.id) adminSocket = null;
    saveData();
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });
});

// ------------------------------
// サーバー起動
// ------------------------------
loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
