// Server.js — マッチング＆抽選要件対応版
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

// React 配信
const CLIENT_DIST = path.join(__dirname, "../client/dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) => res.send("Client dist not found. Build client first."));
}

// ------------------------
// 永続データ
// ------------------------
const DATA_FILE = path.join(__dirname, "server_data.json");
let users = [];
let desks = {}; // { deskNum: { p1, p2 } }
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let lotteryHistory = [];
let currentLotteryList = [];
const RECONNECT_GRACE_MS = 60 * 60 * 1000; // 1時間
const MAX_LOTTERY_HISTORY = 200;

function nowISO() { return new Date().toISOString(); }

function saveData() {
  const data = { users, desks, matchEnabled, lotteryHistory, currentLotteryList };
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("❌ saveData error:", e); }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    users = data.users || [];
    desks = data.desks || {};
    matchEnabled = data.matchEnabled ?? false;
    lotteryHistory = data.lotteryHistory || [];
    currentLotteryList = data.currentLotteryList || [];
  } catch (e) { console.error("❌ loadData error:", e); }
}

// ------------------------
// ユーティリティ
// ------------------------
function findUserBySession(sessionId) { return users.find(u => u.sessionId === sessionId); }
function findUserBySocket(socketId) { return users.find(u => u.id === socketId); }
function assignDeskNum() {
  let i = 1;
  while (desks[i]) i++;
  return i.toString();
}
function hasAlreadyBattled(u1, u2) {
  const user1 = findUserBySession(u1.sessionId);
  return user1?.recentOpponents?.includes(u2.sessionId);
}

// ------------------------
// Socket.io
// ------------------------
io.on("connection", socket => {
  console.log("✅ Connected:", socket.id);

  // ------------------------
  // ログイン
  // ------------------------
  socket.on("login", ({ name, sessionId, recentOpponents = [], history = [] }) => {
    if (!name) return;

    let user = sessionId ? findUserBySession(sessionId) : null;
    if (!user) {
      user = users.find(u => u.name === name);
    }

    if (user) {
      user.id = socket.id;
      user.status = user.status || "idle";
      user.recentOpponents = user.recentOpponents || recentOpponents;
      user.history = user.history || history;
    } else {
      user = { id: socket.id, name, sessionId: sessionId || socket.id, status: "idle", history, recentOpponents };
      users.push(user);
    }

    socket.emit("login_ok", {
      name: user.name,
      id: user.id,
      sessionId: user.sessionId,
      history: user.history,
      opponent: null,
      deskNum: null,
      matchEnabled
    });

    socket.emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });

    if (currentLotteryList.length) socket.emit("update_lottery_list", { list: currentLotteryList });
    socket.emit("admin_lottery_result", lotteryHistory);

    saveData();
  });

  // ------------------------
  // マッチング
  // ------------------------
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;

    user.status = "searching";

    // 対戦候補
    const candidate = users.find(u =>
      u.sessionId !== user.sessionId &&
      u.status === "searching" &&
      !hasAlreadyBattled(user, u)
    );

    if (candidate) {
      const deskNum = assignDeskNum();
      desks[deskNum] = {
        p1: { sessionId: user.sessionId, id: user.id, name: user.name },
        p2: { sessionId: candidate.sessionId, id: candidate.id, name: candidate.name },
        reported: null
      };
      user.status = candidate.status = "in_battle";
      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", { opponent: { name: candidate.name, id: candidate.id }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { name: user.name, id: user.id }, deskNum });

      saveData();
    }
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
    saveData();
  });

  // ------------------------
  // 勝利報告
  // ------------------------
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;

    const deskNum = Object.keys(desks).find(dn =>
      desks[dn].p1.sessionId === user.sessionId || desks[dn].p2.sessionId === user.sessionId
    );

    if (!deskNum) return;

    const match = desks[deskNum];
    const opponent = match.p1.sessionId === user.sessionId ? match.p2 : match.p1;

    // 勝利を記録
    user.history.push({ opponent: opponent.name, result: "WIN", endTime: nowISO() });
    const opponentUser = findUserBySession(opponent.sessionId);
    if (opponentUser) opponentUser.history.push({ opponent: user.name, result: "LOSE", endTime: nowISO() });

    user.status = "idle";
    if (opponentUser) opponentUser.status = "idle";

    // 卓を解放
    delete desks[deskNum];

    // 更新通知
    io.to(user.id).emit("return_to_menu_battle");
    if (opponentUser) io.to(opponentUser.id).emit("return_to_menu_battle");

    saveData();
  });

  // ------------------------
  // 管理者
  // ------------------------
  socket.on("admin_login", ({ password }) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });
      socket.emit("admin_lottery_result", lotteryHistory);
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_enable_matching", () => {
    matchEnabled = true;
    io.emit("match_status_update", { enabled: true, status: "マッチング中" });
    saveData();
  });

  socket.on("admin_disable_matching", () => {
    matchEnabled = false;
    io.emit("match_status_update", { enabled: false, status: "停止中" });
    saveData();
  });

  socket.on("admin_run_lottery", ({ title, count }) => {
    const candidates = users.filter(u => u.history?.length >= 0); // 全員対象
    if (candidates.length === 0) {
      if (adminSocket) adminSocket.emit("admin_lottery_result", { title, winners: [] });
      return;
    }
    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, count).map(u => ({ name: u.name, sessionId: u.sessionId }));
    winners.forEach(w => {
      const wUser = findUserBySession(w.sessionId);
      if (wUser) io.to(wUser.id).emit("lottery_winner", { title });
    });
    const record = { title, winners, time: nowISO() };
    lotteryHistory.push(record);
    if (lotteryHistory.length > MAX_LOTTERY_HISTORY) lotteryHistory.shift();
    currentLotteryList = winners.map(w => ({ name: w.name, sessionId: w.sessionId }));

    io.emit("update_lottery_list", { list: currentLotteryList });
    if (adminSocket) adminSocket.emit("admin_lottery_result", { title, winners });

    saveData();
  });

  // ------------------------
  // 切断
  // ------------------------
  socket.on("disconnect", () => {
    const user = findUserBySocket(socket.id);
    if (user) user.status = "idle";
  });

});

loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
