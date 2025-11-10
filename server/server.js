// ✅ Server.js（全機能完全版＋抽選機能修正版）
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

const CLIENT_DIST = path.join(__dirname, "../client/dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) => res.send("Client dist not found. Please build client."));
}

// --- 永続データ ---
const DATA_FILE = path.join(__dirname, "server_data.json");
let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];

function saveData() {
  const data = { users, desks, lotteryHistory };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      users = data.users || [];
      desks = data.desks || {};
      lotteryHistory = data.lotteryHistory || [];
    } catch (e) {
      console.error("❌ Failed to load server_data.json:", e);
    }
  }
}

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
    totalBattles: u.history.length,
    wins: u.wins || 0,
    losses: u.losses || 0
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

io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // --- 通常ログイン ---
  socket.on("login", ({ name, sessionId } = {}) => {
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
        history: [],
        recentOpponents: []
      };
      users.push(user);
    }

    calculateWinsLosses(user);
    saveData();
    socket.emit("login_ok", { ...user });
    socket.emit("match_status", { enabled: matchEnabled });

    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // --- 対戦処理 ---
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const candidate = users.find(u =>
      u.id !== user.id &&
      u.status === "searching" &&
      !(user.recentOpponents || []).includes(u.sessionId)
    );

    if (candidate) {
      const deskNum = assignDeskSequential();
      desks[deskNum] = { p1: user, p2: candidate, reported: null };
      user.status = candidate.status = "in_battle";
      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", { opponent: { name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { name: user.name }, deskNum });

      broadcastActiveMatchesToAdmin();
      saveData();
    }
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
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const confirmer = findUserBySocket(socket.id);
    if (!confirmer) return;
    const deskNum = Object.keys(desks).find(d => {
      const m = desks[d];
      return m && (m.p1.id === socket.id || m.p2.id === socket.id);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    const reporter = match.p1.id === match.reported ? match.p1 : match.p2;
    const loser = match.p1.id === match.reported ? match.p2 : match.p1;

    if (!accepted) {
      match.reported = null;
      return;
    }

    reporter.history.push({ opponent: loser.name, result: "WIN", endTime: now() });
    loser.history.push({ opponent: reporter.name, result: "LOSE", endTime: now() });
    calculateWinsLosses(reporter);
    calculateWinsLosses(loser);
    delete desks[deskNum];

    io.to(reporter.id).emit("history", reporter.history);
    io.to(loser.id).emit("history", loser.history);
    io.to(reporter.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    saveData();
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password }) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
      sendUserListTo(adminSocket);
      broadcastActiveMatchesToAdmin();
      socket.emit("admin_lottery_history", lotteryHistory);
    } else socket.emit("admin_fail");
  });

  // --- 管理者操作 ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
    saveData();
  });

  socket.on("admin_draw_lots", ({ count = 3, minBattles = 1, minLoginMinutes = 0, title = "" }) => {
    const eligible = users.filter(u => {
      const minutesSinceLogin = (Date.now() - new Date(u.loginTime).getTime()) / 60000;
      return u.history.length >= minBattles && minutesSinceLogin >= minLoginMinutes;
    });

    if (eligible.length === 0) {
      if (adminSocket) adminSocket.emit("admin_lottery_result", { title, winners: [], message: "該当者なし" });
      return;
    }

    const winners = [];
    while (eligible.length > 0 && winners.length < count) {
      const idx = Math.floor(Math.random() * eligible.length);
      winners.push(eligible.splice(idx, 1)[0]);
    }

    const record = { title, winners: winners.map(w => w.name), date: now() };
    lotteryHistory.push(record);
    saveData();

    if (adminSocket) {
      adminSocket.emit("admin_lottery_result", { title, winners: winners.map(w => w.name), message: "抽選完了" });
      adminSocket.emit("admin_lottery_history", lotteryHistory);
    }
  });

  socket.on("admin_set_auto_logout", ({ hours }) => {
    autoLogoutHours = hours;
    if (adminSocket) adminSocket.emit("admin_set_auto_logout_ok", { hours });
    saveData();
  });

  socket.on("admin_logout_all", () => {
    users.forEach(u => io.to(u.id).emit("force_logout", { reason: "admin" }));
    users = [];
    saveData();
    sendUserListTo();
  });

  socket.on("disconnect", () => {
    users = users.filter(u => u.id !== socket.id);
    Object.keys(desks).forEach(d => {
      const m = desks[d];
      if (m && (m.p1.id === socket.id || m.p2.id === socket.id)) delete desks[d];
    });
    if (adminSocket && adminSocket.id === socket.id) adminSocket = null;
    saveData();
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });
});

loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
