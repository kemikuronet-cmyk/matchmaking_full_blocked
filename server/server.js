// ✅ Server.js（完全統合版）
// 管理者表示・勝利報告・履歴更新 修正版

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

// -----------------
// 永続データ保存
// -----------------
const DATA_FILE = path.join(__dirname, "server_data.json");
function saveData() {
  const data = { users, desks, matchEnabled, lotteryHistory, autoLogoutHours };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      users = data.users || [];
      desks = data.desks || {};
      matchEnabled = data.matchEnabled || false;
      lotteryHistory = data.lotteryHistory || [];
      autoLogoutHours = data.autoLogoutHours || 12;
      console.log(`✅ Loaded ${users.length} users`);
    } catch (e) {
      console.error("❌ Load failed:", e);
    }
  }
}

// -----------------
// 状態変数
// -----------------
let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];

// -----------------
// ヘルパー
// -----------------
const now = () => new Date().toISOString();
const findUserBySocket = (id) => users.find((u) => u.id === id);
const findUserBySession = (sid) => users.find((u) => u.sessionId === sid);

function calculateWinsLosses(u) {
  u.wins = u.history.filter((h) => h.result === "WIN").length;
  u.losses = u.history.filter((h) => h.result === "LOSE").length;
  u.totalBattles = u.history.length;
}

function compactUserForAdmin(u) {
  return {
    id: u.id,
    name: u.name,
    status: u.status,
    loginTime: u.loginTime,
  };
}

function sendUserListTo(socket = null) {
  const payload = users.map(compactUserForAdmin);
  if (adminSocket) adminSocket.emit("admin_user_list", payload);
  if (socket && socket.emit && socket.id !== adminSocket?.id) socket.emit("admin_user_list", payload);
}

function broadcastActiveMatchesToAdmin() {
  const active = Object.keys(desks).map((num) => ({
    deskNum: num,
    player1: desks[num].p1?.name || "?",
    player2: desks[num].p2?.name || "?",
  }));
  if (adminSocket) adminSocket.emit("admin_active_matches", active);
}

// -----------------
// ソケット通信
// -----------------
io.on("connection", (socket) => {
  console.log("🔗 connected:", socket.id);

  // --- login ---
  socket.on("login", ({ name, sessionId }) => {
    if (!name?.trim()) return;

    let user = sessionId ? findUserBySession(sessionId) : null;
    if (user) {
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
        recentOpponents: [],
      };
      users.push(user);
    }
    calculateWinsLosses(user);
    saveData();

    socket.emit("login_ok", {
      ...user,
      wins: user.wins,
      losses: user.losses,
      totalBattles: user.totalBattles,
    });

    socket.emit("update_history", user.history);
    socket.emit("match_status", { enabled: matchEnabled });

    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // --- find opponent ---
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const candidate = users.find(
      (u) =>
        u.id !== user.id &&
        u.status === "searching" &&
        !user.recentOpponents.includes(u.sessionId) &&
        !u.recentOpponents.includes(user.sessionId)
    );

    if (candidate) {
      const deskNum = Object.keys(desks).length + 1;
      desks[deskNum] = { p1: user, p2: candidate, reported: null };

      user.status = candidate.status = "in_battle";
      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", { opponent: { name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { name: user.name }, deskNum });

      saveData();
      broadcastActiveMatchesToAdmin();
    }
    sendUserListTo();
  });

  // --- 勝利報告 ---
  socket.on("report_win", ({ deskNum }) => {
    const desk = desks[deskNum];
    if (!desk) return;

    const winner = findUserBySocket(socket.id);
    if (!winner) return;

    const loser =
      desk.p1.id === winner.id ? findUserBySession(desk.p2.sessionId) : findUserBySession(desk.p1.sessionId);

    if (!loser) return;

    // 履歴登録
    winner.history.push({ opponent: loser.name, result: "WIN", time: now() });
    loser.history.push({ opponent: winner.name, result: "LOSE", time: now() });
    calculateWinsLosses(winner);
    calculateWinsLosses(loser);

    winner.status = "idle";
    loser.status = "idle";

    // 双方に更新送信
    io.to(winner.id).emit("battle_end", { result: "WIN" });
    io.to(loser.id).emit("battle_end", { result: "LOSE" });

    io.to(winner.id).emit("update_history", winner.history);
    io.to(loser.id).emit("update_history", loser.history);

    delete desks[deskNum];
    saveData();
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // --- logout ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    saveData();
    sendUserListTo();
  });

  // --- admin login ---
  socket.on("admin_login", ({ password }) => {
    if (password !== adminPassword) return socket.emit("admin_fail");
    adminSocket = socket;
    socket.emit("admin_ok");
    socket.emit("match_status", { enabled: matchEnabled });
    sendUserListTo(socket);
    broadcastActiveMatchesToAdmin();
  });

  // --- admin toggle match ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
    saveData();
  });

  // --- disconnect ---
  socket.on("disconnect", () => {
    const user = findUserBySocket(socket.id);
    if (user) user.id = null;
    if (adminSocket?.id === socket.id) adminSocket = null;
    saveData();
    sendUserListTo();
  });
});

// -----------------
// 起動
// -----------------
loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
