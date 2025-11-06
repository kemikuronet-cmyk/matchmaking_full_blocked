// ✅ Server.js（完全統合・永続化・状態復元・Render対応版）
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

// ✅ React ビルド配信 (Render対応)
const CLIENT_DIST = path.join(__dirname, "../client/dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
} else {
  app.get("/", (req, res) => res.send("Client dist not found. Please build client."));
}

// -----------------
// 永続データ保存
// -----------------
const DATA_FILE = path.join(__dirname, "server_data.json");
function saveData() {
  const data = { users, desks, lotteryHistory, matchEnabled, autoLogoutHours };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (data.users) users = data.users;
      if (data.desks) desks = data.desks;
      if (data.lotteryHistory) lotteryHistory = data.lotteryHistory;
      if (data.matchEnabled !== undefined) matchEnabled = data.matchEnabled;
      if (data.autoLogoutHours) autoLogoutHours = data.autoLogoutHours;
      console.log("✅ Loaded saved data:", users.length, "users");
    } catch (e) {
      console.error("❌ Failed to load data:", e);
    }
  }
}

// -----------------
// メモリ状態
// -----------------
let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];
let currentLotteryTitle = "";

// -----------------
// ヘルパー関数
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
  return { id: u.id, name: u.name, sessionId: u.sessionId, status: u.status, loginTime: u.loginTime };
}

function sendUserListTo(socket = null) {
  const payload = users.map(compactUserForAdmin);
  if (socket?.emit) socket.emit("admin_user_list", payload);
  if (adminSocket && adminSocket.id !== socket?.id) adminSocket.emit("admin_user_list", payload);
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
  socket.on("login", ({ name, sessionId } = {}) => {
    if (!name?.trim()) return;

    let user = sessionId ? findUserBySession(sessionId) : null;
    if (user) {
      // ✅ 既存ユーザー復元
      user.id = socket.id;
      user.status = user.status || "idle";
    } else {
      // ✅ 新規ユーザー登録
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

    // ✅ 状態送信
    socket.emit("login_ok", {
      ...user,
      history: user.history,
      wins: user.wins,
      losses: user.losses,
      totalBattles: user.totalBattles,
    });

    // ✅ マッチング有効状態送信
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
    if (user) user.id = null; // IDは消すがデータ保持
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
