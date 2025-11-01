// ✅ Server.js 完全統合版（全機能保持 + 永続化 + 状態復元対応）
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// -----------------
// 永続化ヘルパー
// -----------------
const STATE_FILE = path.join(__dirname, "state.json");
function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ users, desks, lotteryHistory, currentLotteryTitle }, null, 2));
}
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE));
      users = data.users || [];
      desks = data.desks || {};
      lotteryHistory = data.lotteryHistory || [];
      currentLotteryTitle = data.currentLotteryTitle || "";
      console.log("✅ 状態復元済み");
    } catch {
      console.error("❌ 状態復元失敗: JSONパースエラー");
    }
  }
}

// -----------------
// in-memory state
// -----------------
let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];
let currentLotteryTitle = "";

loadState(); // 起動時に復元

// -----------------
// helpers
// -----------------
const now = () => new Date().toISOString();
function assignDeskSequential() { let i = 1; while (desks[i]) i++; return i; }
const findUserBySocket = (socketId) => users.find((u) => u.id === socketId);
const findUserBySession = (sessionId) => users.find((u) => u.sessionId === sessionId);

function calculateWinsLosses(user) {
  user.wins = user.history.filter(h => h.result === "WIN").length;
  user.losses = user.history.filter(h => h.result === "LOSE").length;
  user.totalBattles = user.history.length;
}

function formatLotteryForClient(hist = []) {
  return hist.map(e => ({
    title: e.title,
    winners: (Array.isArray(e.winners) ? e.winners : []).map(w => ({ name: w.name }))
  }));
}

function allLotteryWinnerSessionIds() {
  return lotteryHistory.flatMap(e => (Array.isArray(e.winners) ? e.winners.map(w => w.sessionId) : []));
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
    return { deskNum, player1: d.p1?.name || "不明", player2: d.p2?.name || "不明", player1SessionId: d.p1?.sessionId, player2SessionId: d.p2?.sessionId };
  });
  if (adminSocket) adminSocket.emit("admin_active_matches", active);
}

// -----------------
// socket.io handlers
// -----------------
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // --- login ---
  socket.on("login", ({ name, sessionId } = {}) => {
    if (!name || !name.trim()) return;
    let user = sessionId ? findUserBySession(sessionId) : null;
    if (!user) user = users.find(u => u.name === name);

    if (user) {
      const hoursDiff = (Date.now() - new Date(user.loginTime).getTime()) / 3600000;
      if (hoursDiff >= autoLogoutHours) {
        user.history = [];
        user.recentOpponents = [];
        user.wins = 0;
        user.losses = 0;
        user.totalBattles = 0;
      }
      user.id = socket.id;

      // 対戦卓復帰チェック
      const activeDesk = Object.entries(desks).find(([_, d]) =>
        d.p1?.sessionId === user.sessionId || d.p2?.sessionId === user.sessionId
      );
      if (activeDesk) {
        const [deskNum, desk] = activeDesk;
        user.status = "in_battle";
        const opponent = desk.p1.sessionId === user.sessionId ? desk.p2 : desk.p1;
        socket.emit("matched", { opponent: { id: opponent.id, name: opponent.name }, deskNum });
      } else {
        user.status = "idle";
      }
    } else {
      user = { id: socket.id, name, sessionId: sessionId || socket.id, status: "idle", loginTime: now(), history: [], recentOpponents: [], wins: 0, losses: 0, totalBattles: 0 };
      users.push(user);
    }

    calculateWinsLosses(user);
    socket.emit("login_ok", {
      ...user,
      history: user.history,
      wins: user.wins,
      losses: user.losses,
      totalBattles: user.totalBattles,
      lotteryList: formatLotteryForClient(lotteryHistory)
    });

    sendUserListTo(socket);
    broadcastActiveMatchesToAdmin();
    saveState();
  });

  // --- logout ---
  socket.on("logout", () => {
    users = users.filter(u => u.id !== socket.id);
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
    saveState();
  });

  // --- find opponent ---
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
      saveState();
    }
    sendUserListTo();
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
    sendUserListTo();
    saveState();
  });

  // --- 勝敗報告 ---
  socket.on("report_win_request", ({ deskNum }) => {
    const desk = desks[deskNum];
    if (!desk) return;
    const reporter = findUserBySocket(socket.id);
    if (!reporter) return;

    if (!desk.reported) {
      desk.reported = reporter.sessionId;
      io.to(desk.p1.id).emit("info_message", `${reporter.name} が勝利を申告しました。`);
      io.to(desk.p2.id).emit("info_message", `${reporter.name} が勝利を申告しました。`);
      if (adminSocket) adminSocket.emit("admin_message", `${reporter.name} が卓 ${deskNum} で勝利報告`);
    } else if (desk.reported !== reporter.sessionId) {
      const loser = desk.p1.sessionId === reporter.sessionId ? desk.p2 : desk.p1;
      reporter.history.push({ opponent: loser.name, result: "WIN", time: now() });
      loser.history.push({ opponent: reporter.name, result: "LOSE", time: now() });

      calculateWinsLosses(reporter);
      calculateWinsLosses(loser);

      delete desks[deskNum];
      reporter.status = "idle";
      loser.status = "idle";

      io.to(reporter.id).emit("battle_result", { result: "WIN", wins: reporter.wins, losses: reporter.losses, totalBattles: reporter.totalBattles });
      io.to(loser.id).emit("battle_result", { result: "LOSE", wins: loser.wins, losses: loser.losses, totalBattles: loser.totalBattles });

      broadcastActiveMatchesToAdmin();
      sendUserListTo();
      saveState();
    }
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", (pw) => {
    if (pw !== adminPassword) {
      socket.emit("admin_login_result", { ok: false });
      return;
    }
    adminSocket = socket;
    socket.emit("admin_login_result", { ok: true });
    sendUserListTo(socket);
    broadcastActiveMatchesToAdmin();
  });

  // --- 管理者パネル操作 ---
  socket.on("admin_command", ({ type, value }) => {
    if (socket !== adminSocket) return;
    switch (type) {
      case "toggle_match":
        matchEnabled = !matchEnabled;
        io.emit("match_status", matchEnabled);
        break;
      case "set_auto_logout":
        autoLogoutHours = value;
        break;
      case "logout_all":
        users = [];
        desks = {};
        io.emit("force_logout");
        break;
      case "reset_stats":
        users.forEach(u => {
          u.history = [];
          u.wins = 0;
          u.losses = 0;
          u.totalBattles = 0;
        });
        io.emit("reset_stats_done");
        sendUserListTo();
        break;
      case "lottery_start":
        currentLotteryTitle = value || `抽選 ${new Date().toLocaleString("ja-JP")}`;
        io.emit("lottery_started", { title: currentLotteryTitle });
        break;
      case "lottery_draw":
        const available = users.filter(u => !allLotteryWinnerSessionIds().includes(u.sessionId));
        if (available.length === 0) {
          socket.emit("admin_message", "抽選可能なユーザーがいません。");
          return;
        }
        const winner = available[Math.floor(Math.random() * available.length)];
        const record = { title: currentLotteryTitle, winners: [{ name: winner.name, sessionId: winner.sessionId }] };
        lotteryHistory.unshift(record);
        io.emit("lottery_update", formatLotteryForClient(lotteryHistory));
        break;
      case "lottery_clear":
        lotteryHistory = [];
        io.emit("lottery_update", []);
        break;
    }
    saveState();
  });

  // --- 接続解除 ---
  socket.on("disconnect", () => {
    const user = findUserBySocket(socket.id);
    if (user) user.status = "offline";
    if (socket.id === adminSocket?.id) adminSocket = null;
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
    saveState();
  });
});

// -----------------
// サーバー起動
// -----------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
