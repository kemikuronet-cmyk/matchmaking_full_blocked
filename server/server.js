// Server.js — 本番運用フル機能版 + React build対応
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

// ============================
// React build 配信
// ============================
const CLIENT_DIST = path.join(__dirname, "../client/build"); // buildフォルダ
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) => res.send("Client build not found. Please run npm run build."));
}

// ============================
// 永続データ
// ============================
const DATA_FILE = path.join(__dirname, "server_data.json");
const RECONNECT_GRACE_MS = 60 * 60 * 1000; // 1時間
const MAX_LOTTERY_HISTORY = 200;

let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];
let currentLotteryList = [];

function nowISO() { return new Date().toISOString(); }

// --- データ保存・復元 ---
function saveData() {
  try {
    const data = { users, desks, lotteryHistory, currentLotteryList, matchEnabled, autoLogoutHours };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error("❌ saveData error:", e); }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (data.users) users = data.users;
    if (data.desks) desks = data.desks;
    if (Array.isArray(data.lotteryHistory)) lotteryHistory = data.lotteryHistory;
    if (Array.isArray(data.currentLotteryList)) currentLotteryList = data.currentLotteryList;
    if (typeof data.matchEnabled === "boolean") matchEnabled = data.matchEnabled;
    if (typeof data.autoLogoutHours === "number") autoLogoutHours = data.autoLogoutHours;
  } catch (e) { console.error("❌ loadData error:", e); }
}

// --- ユーティリティ ---
function assignDeskSequential() {
  let i = 1;
  while (desks[i]) i++;
  return i.toString();
}
function findUserBySocket(socketId) { return users.find(u => u.id === socketId); }
function findUserBySession(sessionId) { return users.find(u => u.sessionId === sessionId); }

// --- Socket.io ---
io.on("connection", socket => {
  console.log("✅ Connected:", socket.id);

  if (currentLotteryList.length > 0) socket.emit("update_lottery_list", { list: currentLotteryList });

  // ---------- ログイン ----------
  socket.on("login", ({ name, sessionId, recentOpponents, history } = {}) => {
    if (!name) return;

    let user = sessionId ? findUserBySession(sessionId) : null;
    if (!user) user = users.find(u => u.name === name);

    if (user) {
      const hoursDiff = user.loginTime ? (Date.now() - new Date(user.loginTime).getTime()) / 3600000 : 0;
      if (hoursDiff >= autoLogoutHours) { user.history = []; user.recentOpponents = []; }
      user.id = socket.id;
      user.status = user.status || "idle";
      user.disconnectedAt = null;
      user.name = name;
    } else {
      user = { id: socket.id, name, sessionId: sessionId || socket.id, status: "idle", loginTime: nowISO(), history: history || [], recentOpponents: recentOpponents || [], disconnectedAt: null };
      users.push(user);
    }

    socket.emit("login_ok", { ...user, history: user.history, matchEnabled });
    socket.emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });
  });

  // ---------- マッチング ----------
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const candidate = users.find(u => u.sessionId !== user.sessionId && u.status === "searching" &&
      !(user.recentOpponents || []).includes(u.sessionId) && !(u.recentOpponents || []).includes(user.sessionId)
    );

    if (candidate) {
      const deskNum = assignDeskSequential();
      desks[deskNum] = { p1: { sessionId: user.sessionId, id: user.id, name: user.name }, p2: { sessionId: candidate.sessionId, id: candidate.id, name: candidate.name }, reported: null };
      user.status = candidate.status = "in_battle";
      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", { opponent: { id: candidate.id, name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });
    }
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
  });

  // ---------- 勝利報告 ----------
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;

    const deskNum = Object.keys(desks).find(dn => {
      const m = desks[dn];
      return m && (m.p1?.id === socket.id || m.p2?.id === socket.id);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    const opponent = match.p1.sessionId === user.sessionId ? match.p2 : match.p1;
    match.reported = user.sessionId;

    setTimeout(() => {
      const stillMatch = desks[deskNum];
      if (stillMatch && stillMatch.reported === user.sessionId) {
        const loser = findUserBySession(opponent.sessionId);
        if (loser) {
          user.history.push({ opponent: opponent.name, result: "WIN", endTime: nowISO() });
          loser.history.push({ opponent: user.name, result: "LOSE", endTime: nowISO() });
          user.status = loser.status = "idle";

          io.to(user.id).emit("history", user.history);
          io.to(loser.id).emit("history", loser.history);

          io.to(user.id).emit("return_to_menu_battle");
          io.to(loser.id).emit("return_to_menu_battle");

          delete desks[deskNum];
        }
      }
    }, 2000);
  });

  // ---------- 管理者 ----------
  socket.on("admin_login", ({ password }) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });
      socket.emit("admin_lottery_history", lotteryHistory);
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_enable_matching", () => {
    matchEnabled = true;
    io.emit("match_status_update", { enabled: matchEnabled, status: "マッチング中" });
  });

  socket.on("admin_disable_matching", () => {
    matchEnabled = false;
    io.emit("match_status_update", { enabled: matchEnabled, status: "停止中" });
  });

  socket.on("admin_run_lottery", ({ title, count }) => {
    const candidates = users.filter(u => u.status !== "admin");
    if (candidates.length === 0) return;

    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);
    const winners = selected.map(u => ({ name: u.name, sessionId: u.sessionId }));

    winners.forEach(u => { if (u.id) io.to(u.id).emit("lottery_winner", { title }); });
    const record = { title, winners, time: nowISO() };
    lotteryHistory.push(record);
    if (lotteryHistory.length > MAX_LOTTERY_HISTORY) lotteryHistory.shift();

    io.emit("update_lottery_list", { list: winners });
    if (adminSocket) adminSocket.emit("admin_lottery_result", record);
  });

  // ---------- 切断 ----------
  socket.on("disconnect", () => {
    const user = findUserBySocket(socket.id);
    if (user) user.status = "idle";
  });
});

loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
