// server/Server.js（フル統合版・永続化対応）
// 現行機能 + 履歴保持 + 状態復元 + 自動バックアップ

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ---------------------------------------------------
// パス定義
// ---------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "server_data.json");

// ---------------------------------------------------
// 永続化：保存と読み込み
// ---------------------------------------------------
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      console.log("✅ server_data.json loaded");
      return data;
    }
  } catch (err) {
    console.error("❌ Failed to load data:", err);
  }
  return { users: [], desks: {}, lotteryHistory: [] };
}

function saveData() {
  try {
    const data = { users, desks, lotteryHistory };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ Failed to save data:", err);
  }
}

// 定期的に保存（5秒ごと）
setInterval(() => saveData(), 5000);

// ---------------------------------------------------
// Express設定
// ---------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// React ビルド配信
const CLIENT_DIST = path.join(__dirname, "../client/dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) => res.send("Client dist not found. Please build client."));
}

// ---------------------------------------------------
// Socket.IO設定
// ---------------------------------------------------
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ---------------------------------------------------
// 状態管理
// ---------------------------------------------------
let { users, desks, lotteryHistory } = loadData();
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let currentLotteryTitle = "";

// ---------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------
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
  return { id: u.id, name: u.name, sessionId: u.sessionId, status: u.status, loginTime: u.loginTime, history: u.history || [] };
}

function sendUserListTo(socket = null) {
  const payload = users.map(u => compactUserForAdmin(u));
  if (socket && typeof socket.emit === "function") socket.emit("admin_user_list", payload);
  if (adminSocket && adminSocket.id !== socket?.id) adminSocket.emit("admin_user_list", payload);
}

function broadcastActiveMatchesToAdmin() {
  const active = Object.keys(desks).map(deskNum => {
    const d = desks[deskNum];
    return { deskNum, player1: d.p1?.name || "不明", player2: d.p2?.name || "不明" };
  });
  if (adminSocket) adminSocket.emit("admin_active_matches", active);
}

// ---------------------------------------------------
// Socket.IO ハンドラ
// ---------------------------------------------------
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // --- login ---
  socket.on("login", ({ name, sessionId } = {}) => {
    if (!name || !name.trim()) return;
    let user = sessionId ? findUserBySession(sessionId) : null;
    if (!user) user = users.find(u => u.name === name);

    if (user) {
      const hoursDiff = (Date.now() - new Date(user.loginTime).getTime()) / 3600000;
      if (hoursDiff >= autoLogoutHours) { user.history = []; user.recentOpponents = []; }
      user.id = socket.id;
      user.status = user.status || "idle";
    } else {
      user = { id: socket.id, name, sessionId: sessionId || socket.id, status: "idle", loginTime: now(), history: [], recentOpponents: [] };
      users.push(user);
    }

    calculateWinsLosses(user);

    socket.emit("login_ok", {
      ...user,
      history: user.history,
      wins: user.wins,
      losses: user.losses,
      totalBattles: user.totalBattles,
    });

    saveData();
    sendUserListTo(socket);
    broadcastActiveMatchesToAdmin();
  });

  // --- logout ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    saveData();
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // --- find opponent ---
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const candidate = users.find(
      (u) => u.id !== user.id && u.status === "searching" &&
        !(user.recentOpponents || []).includes(u.sessionId)
    );

    if (candidate) {
      const deskNum = assignDeskSequential();
      desks[deskNum] = { p1: user, p2: candidate, reported: null };
      user.status = candidate.status = "in_battle";

      io.to(user.id).emit("matched", { opponent: { id: candidate.id, name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });
      broadcastActiveMatchesToAdmin();
      saveData();
    }

    sendUserListTo();
  });

  // --- cancel find ---
  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
    saveData();
    sendUserListTo();
  });

  // --- report win request ---
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
      match.reported = null;
      return;
    }

    const nowStamp = now();
    reporter.history.push({ opponent: loser.name, result: "WIN", endTime: nowStamp });
    loser.history.push({ opponent: reporter.name, result: "LOSE", endTime: nowStamp });

    calculateWinsLosses(reporter);
    calculateWinsLosses(loser);

    io.to(reporter.id).emit("history", reporter.history);
    io.to(loser.id).emit("history", loser.history);
    io.to(reporter.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
    saveData();
  });

  // --- 管理者 ---
  socket.on("admin_login", ({ password } = {}) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
      sendUserListTo(adminSocket);
      broadcastActiveMatchesToAdmin();
    } else socket.emit("admin_fail");
  });

  socket.on("admin_toggle_match", ({ enable } = {}) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- disconnect ---
  socket.on("disconnect", () => {
    users = users.filter((u) => u.id !== socket.id);
    Object.keys(desks).forEach(d => {
      const m = desks[d];
      if (m && (m.p1.id === socket.id || m.p2.id === socket.id)) delete desks[d];
    });
    if (adminSocket && adminSocket.id === socket.id) adminSocket = null;
    saveData();
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });
});

// ---------------------------------------------------
// サーバー起動
// ---------------------------------------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
