// server.js
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

// --- Reactビルド配信 ---
app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// === メモリ管理 ===
let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];

// === ユーティリティ ===
const now = () => new Date().toISOString();
const generateDeskNum = (() => {
  let counter = 1;
  return () => {
    while (desks[counter]) counter++;
    return counter;
  };
})();
const findUserBySocket = (socketId) => users.find((u) => u.id === socketId);
const findUserBySession = (sessionId) => users.find((u) => u.sessionId === sessionId);
const updateAdminUserList = () => {
  if (adminSocket) {
    adminSocket.emit(
      "admin_user_list",
      users.map((u) => ({
        id: u.id,
        name: u.name,
        sessionId: u.sessionId,
        status: u.status,
        loginTime: u.loginTime,
        history: u.history,
      }))
    );
  }
};
const broadcastActiveMatches = () => {
  if (adminSocket) {
    const active = Object.keys(desks).map((deskNum) => {
      const d = desks[deskNum];
      return {
        deskNum,
        player1: d.p1?.name || "不明",
        player2: d.p2?.name || "不明",
      };
    });
    adminSocket.emit("admin_active_matches", active);
  }
};

// === Socket.io接続 ===
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // --- ユーザーログイン ---
  socket.on("login", ({ name, sessionId }) => {
    if (!name || !sessionId) return;

    let user = findUserBySession(sessionId);
    if (user) {
      user.id = socket.id;
      user.name = name;
      user.status = "idle";
      user.loginTime = now();
    } else {
      user = {
        id: socket.id,
        name,
        sessionId,
        status: "idle",
        loginTime: now(),
        history: [],
      };
      users.push(user);
    }

    socket.emit("login_ok", user);
    socket.emit("match_status", { enabled: matchEnabled });
    updateAdminUserList();
  });

  // --- ログアウト ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    updateAdminUserList();
  });

  // --- 対戦検索・マッチング ---
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const opponent = users.find(
      (u) =>
        u.status === "searching" &&
        u.id !== socket.id &&
        !user.history.some((h) => h.opponent === u.name)
    );

    if (opponent) {
      const deskNum = generateDeskNum();
      desks[deskNum] = { p1: user, p2: opponent, reported: null };
      user.status = "in_battle";
      opponent.status = "in_battle";

      io.to(user.id).emit("matched", { opponent, deskNum });
      io.to(opponent.id).emit("matched", { opponent: user, deskNum });
      broadcastActiveMatches();
    }
    updateAdminUserList();
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user) user.status = "idle";
    updateAdminUserList();
  });

  // --- 勝利報告 ---
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;
    const deskNum = Object.keys(desks).find(
      (d) => desks[d].p1?.id === socket.id || desks[d].p2?.id === socket.id
    );
    if (!deskNum) return;
    const match = desks[deskNum];
    const opponent = match.p1.id === socket.id ? match.p2 : match.p1;

    match.reported = user.id;
    io.to(opponent.id).emit("confirm_opponent_win");
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const opponent = findUserBySocket(socket.id);
    if (!opponent) return;
    const deskNum = Object.keys(desks).find(
      (d) => desks[d].p1?.id === socket.id || desks[d].p2?.id === socket.id
    );
    if (!deskNum) return;
    const match = desks[deskNum];
    if (!match.reported) return;

    const reporter = match.p1.id === match.reported ? match.p1 : match.p2;
    const loser = match.p1.id === match.reported ? match.p2 : match.p1;

    if (!accepted) {
      io.to(reporter.id).emit("win_report_cancelled");
      io.to(loser.id).emit("win_report_cancelled");
      match.reported = null;
      return;
    }

    reporter.history.push({ opponent: loser.name, result: "WIN", endTime: now() });
    loser.history.push({ opponent: reporter.name, result: "LOSE", endTime: now() });

    io.to(reporter.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatches();
    updateAdminUserList();
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password }) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      updateAdminUserList();
      socket.emit("match_status", { enabled: matchEnabled });
      socket.emit("admin_lottery_history", lotteryHistory);
      socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
      broadcastActiveMatches();
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- 抽選 ---
  socket.on("admin_draw_lots", ({ count, title, minBattles = 0, minLoginMinutes = 0 }) => {
    const allWinners = new Set(
      lotteryHistory.flatMap((l) => l.winners.map((w) => w.name))
    );

    const eligible = users.filter((u) => {
      const battles = u.history?.length || 0;
      const loginMinutes = (Date.now() - new Date(u.loginTime).getTime()) / 60000;
      return battles >= minBattles && loginMinutes >= minLoginMinutes && !allWinners.has(u.name);
    });

    const shuffled = eligible.sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, count);
    const entryTitle = title?.trim() || `抽選${lotteryHistory.length + 1}`;
    const entry = { title: entryTitle, winners };
    lotteryHistory.push(entry);

    winners.forEach((w) => io.to(w.id).emit("lottery_won", { title: entryTitle }));
    socket.emit("admin_draw_result", { title: entryTitle, winners });
    io.emit("update_lottery_list", { list: lotteryHistory });
  });

  // --- 切断 ---
  socket.on("disconnect", () => {
    users = users.filter((u) => u.id !== socket.id);
    Object.keys(desks).forEach((d) => {
      const match = desks[d];
      if (match.p1.id === socket.id || match.p2.id === socket.id) delete desks[d];
    });
    broadcastActiveMatches();
    updateAdminUserList();
  });
});

// === サーバ起動 ===
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
