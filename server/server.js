// Server.js — 完全版（開発/本番対応）
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createProxyMiddleware } from "http-proxy-middleware";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// ------------------------
// React 配信
// ------------------------
const CLIENT_DIST = path.join(__dirname, "../client/dist");

if (process.env.NODE_ENV === "production") {
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get("*", (req, res) =>
      res.sendFile(path.join(CLIENT_DIST, "index.html"))
    );
  } else {
    app.get("*", (req, res) =>
      res.send(
        "Client build not found. Please run 'npm run build' in the client folder."
      )
    );
  }
} else {
  app.use(
    "/",
    createProxyMiddleware({
      target: "http://localhost:5173",
      changeOrigin: true,
    })
  );
}

// ------------------------
// 永続データ
// ------------------------
const DATA_FILE = path.join(__dirname, "server_data.json");
let users = []; // {id, sessionId, name, disconnectedAt, history, recentOpponents}
let desks = {}; // {deskNum: {p1:{id,name,sessionId}, p2:{}, reported}}
let matchEnabled = false;
let adminSocket = null;
let lotteryHistory = [];
let currentLotteryList = [];

// ------------------------
// ヘルパー
// ------------------------
function saveData() {
  const data = { users, desks, matchEnabled, lotteryHistory, currentLotteryList };
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch {}
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    users = data.users || [];
    desks = data.desks || {};
    matchEnabled = data.matchEnabled || false;
    lotteryHistory = data.lotteryHistory || [];
    currentLotteryList = data.currentLotteryList || [];
  } catch {}
}

function findUserBySession(sessionId) {
  return users.find((u) => u.sessionId === sessionId);
}

function getNextDeskNum() {
  let i = 1;
  while (desks[i]) i++;
  return i;
}

function updateMatchStatus() {
  if (adminSocket) adminSocket.emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });
  io.sockets.emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });
}

function updateLottery(user = null) {
  if (user) {
    const wins = currentLotteryList.filter((w) => w.sessionId === user.sessionId);
    if (wins.length > 0) user.socket.emit("lottery_winner", { title: wins[0].title });
  } else {
    io.sockets.emit("update_lottery_list", { list: currentLotteryList });
  }
}

// ------------------------
// Socket.io
// ------------------------
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);
  socket.on("login", ({ name, sessionId, recentOpponents, history }) => {
    let user = findUserBySession(sessionId);
    if (!user) {
      user = { id: uuidv4(), sessionId: sessionId || uuidv4(), name, socket, history: history || [], recentOpponents: recentOpponents || [] };
      users.push(user);
    } else {
      user.name = name;
      user.socket = socket;
    }
    socket.emit("login_ok", { id: user.id, sessionId: user.sessionId, name: user.name, history: user.history, matchEnabled });
    updateMatchStatus();
  });

  // ------------------------
  // ユーザーマッチング
  // ------------------------
  socket.on("find_opponent", () => {
    const user = users.find((u) => u.socket.id === socket.id);
    if (!user || !matchEnabled) return;
    user.searching = true;

    const candidates = users.filter((u) => u.searching && u.id !== user.id && !user.recentOpponents.includes(u.id));
    if (candidates.length > 0) {
      const opponent = candidates[0];
      user.searching = false;
      opponent.searching = false;

      const deskNum = getNextDeskNum();
      desks[deskNum] = { p1: { ...user }, p2: { ...opponent }, reported: null };

      user.opponent = opponent;
      opponent.opponent = user;
      user.deskNum = deskNum;
      opponent.deskNum = deskNum;

      socket.emit("matched", { opponent: { name: opponent.name }, deskNum });
      opponent.socket.emit("matched", { opponent: { name: user.name }, deskNum });

      saveData();
    }
  });

  socket.on("cancel_find", () => {
    const user = users.find((u) => u.socket.id === socket.id);
    if (user) user.searching = false;
  });

  // ------------------------
  // 勝利報告
  // ------------------------
  socket.on("report_win_request", () => {
    const user = users.find((u) => u.socket.id === socket.id);
    if (!user || !user.deskNum) return;
    const desk = desks[user.deskNum];
    if (!desk) return;

    const opponent = desk.p1.sessionId === user.sessionId ? desk.p2 : desk.p1;

    // 勝敗登録
    user.history.push({ opponent: opponent.name, result: "WIN" });
    opponent.history.push({ opponent: user.name, result: "LOSE" });

    // 対戦卓解散
    delete desks[user.deskNum];
    user.opponent = null; user.deskNum = null;
    opponent.opponent = null; opponent.deskNum = null;

    // 再マッチング可能
    saveData();

    user.socket.emit("return_to_menu_battle");
    opponent.socket.emit("return_to_menu_battle");
  });

  // ------------------------
  // 管理者
  // ------------------------
  socket.on("admin_login", ({ password }) => {
    if (password === "admin1234") {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("admin_active_matches", Object.entries(desks).map(([deskNum, d]) => ({
        deskNum, player1: d.p1.name, player2: d.p2.name, player1SessionId: d.p1.sessionId, player2SessionId: d.p2.sessionId
      })));
      socket.emit("admin_lottery_history", lotteryHistory);
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_enable_matching", () => { matchEnabled = true; updateMatchStatus(); saveData(); });
  socket.on("admin_disable_matching", () => { matchEnabled = false; updateMatchStatus(); saveData(); });

  socket.on("admin_run_lottery", ({ title, count }) => {
    const candidates = users.filter(u => u.loggedIn && u.socket);
    const winners = [];
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const idx = Math.floor(Math.random() * candidates.length);
      winners.push({ name: candidates[idx].name, sessionId: candidates[idx].sessionId });
      candidates.splice(idx, 1);
    }
    const entry = { title, winners, time: Date.now() };
    lotteryHistory.push(entry);
    if (lotteryHistory.length > 200) lotteryHistory.shift();
    currentLotteryList = winners;
    io.sockets.emit("update_lottery_list", { list: currentLotteryList });
    lotteryHistory.forEach(entry => entry.winners.forEach(w => {
      const u = users.find(u => u.sessionId === w.sessionId);
      if (u && u.socket) u.socket.emit("lottery_winner", { title: entry.title });
    }));
    if (adminSocket) adminSocket.emit("admin_lottery_result", entry);
    saveData();
  });

  socket.on("disconnect", () => {
    const user = users.find(u => u.socket.id === socket.id);
    if (user) user.socket = null;
  });
});

loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
