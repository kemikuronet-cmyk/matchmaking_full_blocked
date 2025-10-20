// server/server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// -----------------
// in-memory state
// -----------------
let users = []; // { id, name, sessionId, status, loginTime, history:[], recentOpponents:[] }
let desks = {}; // deskNum -> { p1, p2, reported }
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = []; // { title, winners: [{id, sessionId, name}] }
let currentLotteryTitle = "";
let historyStore = {}; // sessionId -> history[] 永続化用

// -----------------
// helpers
// -----------------
const now = () => new Date().toISOString();

function assignDeskSequential() {
  let i = 1;
  while (desks[i]) i++;
  return i;
}

const findUserBySocket = (socketId) => users.find((u) => u.id === socketId);
const findUserBySession = (sessionId) => users.find((u) => u.sessionId === sessionId);

function sendUserListTo(socket = null) {
  const payload = users.map((u) => ({
    id: u.id,
    name: u.name,
    sessionId: u.sessionId,
    status: u.status,
    loginTime: u.loginTime,
    history: u.history || [],
  }));
  if (socket && typeof socket.emit === "function") socket.emit("admin_user_list", payload);
  if (adminSocket && adminSocket.id !== socket?.id) adminSocket.emit("admin_user_list", payload);
}

function broadcastActiveMatchesToAdmin() {
  const active = Object.keys(desks).map((deskNum) => {
    const d = desks[deskNum];
    return {
      deskNum,
      player1: d.p1?.name || "不明",
      player2: d.p2?.name || "不明",
      player1SessionId: d.p1?.sessionId,
      player2SessionId: d.p2?.sessionId,
    };
  });
  if (adminSocket) adminSocket.emit("admin_active_matches", active);
}

function formatLotteryForClient(hist = []) {
  return hist.map((e) => ({
    title: e.title,
    winners: (Array.isArray(e.winners) ? e.winners : []).map((w) => ({ name: w.name })),
  }));
}

function allLotteryWinnerSessionIds() {
  return lotteryHistory.flatMap((e) =>
    (Array.isArray(e.winners) ? e.winners.map((w) => w.sessionId) : [])
  );
}

// -----------------
// socket.io handlers
// -----------------
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // --- login ---
  socket.on("login", ({ name, sessionId } = {}) => {
    if (!name || !name.trim()) return;

    let user = findUserBySession(sessionId);
    if (!user) user = users.find((u) => u.name === name);

    if (user) {
      user.id = socket.id;
      user.sessionId = sessionId || user.sessionId || socket.id;
      user.status = user.status === "in_battle" ? user.status : "idle";
      user.loginTime = user.loginTime || now();
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

    // ✅ 履歴復元処理
    if (historyStore[user.sessionId]) {
      user.history = [...historyStore[user.sessionId]];
    } else {
      user.history = user.history || [];
      historyStore[user.sessionId] = user.history;
    }

    socket.emit("login_ok", {
      ...user,
      history: user.history,
      lotteryList: formatLotteryForClient(lotteryHistory),
    });

    sendUserListTo(socket);
    broadcastActiveMatchesToAdmin();
  });

  // --- logout ---
  socket.on("logout", () => {
    const user = findUserBySocket(socket.id);
    if (user) {
      historyStore[user.sessionId] = [...user.history];
    }
    users = users.filter((u) => u.id !== socket.id);
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
        !(user.recentOpponents || []).includes(u.sessionId) &&
        !(u.recentOpponents || []).includes(user.sessionId)
    );

    if (candidate) {
      const deskNum = assignDeskSequential();
      desks[deskNum] = { p1: user, p2: candidate, reported: null };
      user.status = "in_battle";
      candidate.status = "in_battle";

      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", {
        opponent: { id: candidate.id, name: candidate.name },
        deskNum,
      });
      io.to(candidate.id).emit("matched", {
        opponent: { id: user.id, name: user.name },
        deskNum,
      });

      broadcastActiveMatchesToAdmin();
    }
    sendUserListTo();
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
    sendUserListTo();
  });

  // --- report win request ---
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;

    const deskNum = Object.keys(desks).find((d) => {
      const m = desks[d];
      return m && (m.p1.id === socket.id || m.p2.id === socket.id);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    const opponent = match.p1.id === socket.id ? match.p2 : match.p1;
    match.reported = user.id;

    io.to(opponent.id).emit("confirm_opponent_win", {
      deskNum,
      winnerName: user.name,
    });
  });

  // --- opponent confirms ---
  socket.on("opponent_win_confirmed", ({ accepted } = {}) => {
    const confirmer = findUserBySocket(socket.id);
    if (!confirmer) return;

    const deskNum = Object.keys(desks).find((d) => {
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

    const nowStamp = now();
    reporter.history.push({
      opponent: loser.name,
      result: "WIN",
      endTime: nowStamp,
    });
    loser.history.push({
      opponent: reporter.name,
      result: "LOSE",
      endTime: nowStamp,
    });

    // ✅ 履歴を永続保存
    historyStore[reporter.sessionId] = [...reporter.history];
    historyStore[loser.sessionId] = [...loser.history];

    io.to(reporter.id).emit("history", reporter.history);
    io.to(loser.id).emit("history", loser.history);
    io.to(reporter.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

  // --- 管理者・抽選・その他 ---
  socket.on("admin_login", ({ password } = {}) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
      socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
      socket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
      sendUserListTo(socket);
      broadcastActiveMatchesToAdmin();
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_toggle_match", ({ enable } = {}) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  socket.on("admin_report_win", ({ winnerSessionId, deskNum } = {}) => {
    const match = desks[deskNum];
    if (!match) return;

    const winner = match.p1.sessionId === winnerSessionId ? match.p1 : match.p2;
    const loser = match.p1.sessionId === winnerSessionId ? match.p2 : match.p1;

    const nowStamp = now();
    winner.history.push({ opponent: loser.name, result: "WIN", endTime: nowStamp });
    loser.history.push({ opponent: winner.name, result: "LOSE", endTime: nowStamp });

    historyStore[winner.sessionId] = [...winner.history];
    historyStore[loser.sessionId] = [...loser.history];

    io.to(winner.id).emit("history", winner.history);
    io.to(loser.id).emit("history", loser.history);
    io.to(winner.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

  // --- disconnect ---
  socket.on("disconnect", () => {
    const user = findUserBySocket(socket.id);
    if (user) {
      historyStore[user.sessionId] = [...user.history];
    }
    users = users.filter((u) => u.id !== socket.id);
    Object.keys(desks).forEach((d) => {
      const match = desks[d];
      if (match && (match.p1.id === socket.id || match.p2.id === socket.id)) delete desks[d];
    });
    if (adminSocket && adminSocket.id === socket.id) adminSocket = null;
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });
});

// -----------------
// server start
// -----------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
