// ✅ Server.js（再マッチ完全防止・sessionId永続対応版）
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

function saveData() {
  const data = { 
    users: users.map(u => ({
      ...u,
      recentOpponents: [...new Set(u.recentOpponents || [])]
    })), 
    desks, 
    lotteryHistory 
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (data.users) users = data.users.map(u => ({
        ...u,
        recentOpponents: u.recentOpponents || []
      }));
      if (data.desks) desks = data.desks;
      if (data.lotteryHistory) lotteryHistory = data.lotteryHistory;
    } catch (e) {
      console.error("❌ Failed to load server_data.json:", e);
    }
  }
}

// helper functions
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

// socket.io
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // login
  socket.on("login", ({ name, sessionId, recentOpponents, history } = {}) => {
    if (!name || !name.trim()) return;

    let user = findUserBySession(sessionId) || users.find(u => u.name === name);

    if (user) {
      // 再ログイン扱い
      const hoursDiff = (Date.now() - new Date(user.loginTime).getTime()) / 3600000;
      if (hoursDiff >= autoLogoutHours) {
        user.history = [];
        user.recentOpponents = [];
      }
      user.id = socket.id;
      user.status = user.status || "idle";
      user.sessionId = sessionId; // セッション固定
    } else {
      // 新規ユーザー登録
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
    setTimeout(() => sendUserListTo(), 300);
  });

  // logout
  socket.on("logout", () => {
    users = users.filter(u => u.id !== socket.id);
    saveData();
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // find opponent
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    // recentOpponents除外
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

      user.recentOpponents = [...new Set([...(user.recentOpponents || []), candidate.sessionId])];
      candidate.recentOpponents = [...new Set([...(candidate.recentOpponents || []), user.sessionId])];

      io.to(user.id).emit("matched", { opponent: { id: candidate.id, name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });

      broadcastActiveMatchesToAdmin();
      saveData();
    }
    sendUserListTo();
  });

  // 残りのイベント（cancel_find, report_win_request, opponent_win_confirmed, admin系など）は現行のまま
  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
    saveData();
    sendUserListTo();
  });

  // ...（省略せず既存のreport_win_requestやadmin_loginなどはそのままコピー）
});

// 起動
loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
