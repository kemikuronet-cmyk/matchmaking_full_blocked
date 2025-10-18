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

// --- Reactビルド静的配信 ---
app.use(express.static(path.join(__dirname, "client/build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/build", "index.html"));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// === メモリ管理 ===
let users = []; // { id: socketId, name, sessionId, status, loginTime, history }
let desks = {}; // { deskNum: { p1, p2, reported } }
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234"; // 任意
let autoLogoutHours = 12;
let lotteryHistory = [];

// === ユーティリティ ===
const now = () => new Date().toISOString();
const generateDeskNum = () => {
  let n;
  do {
    n = Math.floor(Math.random() * 9000) + 1000;
  } while (desks[n]);
  return n;
};
const findUser = (socketId) => users.find((u) => u.id === socketId);
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
        player1SessionId: d.p1?.sessionId,
        player2SessionId: d.p2?.sessionId,
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
    if (!name) return;
    let existing = users.find((u) => u.name === name);
    if (existing) {
      existing.id = socket.id;
      existing.sessionId = sessionId || existing.sessionId;
      existing.status = "idle";
      existing.loginTime = now();
    } else {
      existing = {
        id: socket.id,
        name,
        sessionId: sessionId || socket.id,
        status: "idle",
        loginTime: now(),
        history: [],
      };
      users.push(existing);
    }
    socket.emit("login_ok", existing);
    updateAdminUserList();
  });

  // --- ログアウト ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    updateAdminUserList();
  });

  // --- 対戦検索・マッチング ---
  socket.on("find_opponent", () => {
    const user = findUser(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const opponent = users.find(
      (u) => u.status === "searching" && u.id !== socket.id
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
    const user = findUser(socket.id);
    if (user) user.status = "idle";
    updateAdminUserList();
  });

  // --- 勝利報告（ダブルチェック） ---
  socket.on("report_win_request", () => {
    const user = findUser(socket.id);
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
    const opponent = findUser(socket.id);
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

    reporter.history.push({
      opponent: loser.name,
      result: "WIN",
      endTime: now(),
    });
    loser.history.push({
      opponent: reporter.name,
      result: "LOSE",
      endTime: now(),
    });

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
      socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
      socket.emit("admin_lottery_history", lotteryHistory);
      broadcastActiveMatches();
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_view_users", updateAdminUserList);

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  socket.on("admin_report_win", ({ winnerSessionId, deskNum }) => {
    const match = desks[deskNum];
    if (!match) return;
    const winner = match.p1.sessionId === winnerSessionId ? match.p1 : match.p2;
    const loser = match.p1.sessionId === winnerSessionId ? match.p2 : match.p1;

    winner.history.push({ opponent: loser.name, result: "WIN", endTime: now() });
    loser.history.push({ opponent: winner.name, result: "LOSE", endTime: now() });

    io.to(winner.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatches();
    updateAdminUserList();
  });

  socket.on("admin_report_both_lose", ({ deskNum }) => {
    const match = desks[deskNum];
    if (!match) return;
    const { p1, p2 } = match;
    p1.history.push({ opponent: p2.name, result: "LOSE", endTime: now() });
    p2.history.push({ opponent: p1.name, result: "LOSE", endTime: now() });

    io.to(p1.id).emit("return_to_menu_battle");
    io.to(p2.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatches();
    updateAdminUserList();
  });

  // --- 抽選機能 ---
  socket.on("admin_draw_lots", ({ count, minBattles, minLoginMinutes }) => {
    const eligible = users.filter((u) => {
      const battles = u.history?.length || 0;
      const loginMinutes = (Date.now() - new Date(u.loginTime).getTime()) / 60000;
      return battles >= minBattles && loginMinutes >= minLoginMinutes;
    });
    const shuffled = eligible.sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, count);
    const title = `抽選${lotteryHistory.length + 1}`;
    const entry = { title, winners };
    lotteryHistory.push(entry);

    socket.emit("admin_draw_result", { title, winners });
    io.emit("update_lottery_list", { list: lotteryHistory });
  });

  socket.on("admin_get_lottery_history", () => {
    socket.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_delete_lottery_history", ({ title }) => {
    lotteryHistory = lotteryHistory.filter((l) => l.title !== title);
    io.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_clear_lottery_history", () => {
    lotteryHistory = [];
    io.emit("admin_lottery_history", lotteryHistory);
  });

  // --- 自動ログアウト設定 ---
  socket.on("admin_set_auto_logout", ({ hours }) => {
    autoLogoutHours = hours;
    socket.emit("admin_set_auto_logout_ok", { hours });
  });

  socket.on("admin_get_auto_logout", () => {
    socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
  });

  // --- 管理者によるユーザー強制ログアウト ---
  socket.on("admin_logout_user", ({ userId }) => {
    const target = users.find((u) => u.id === userId);
    if (target) io.to(userId).emit("force_logout", { reason: "admin" });
    users = users.filter((u) => u.id !== userId);
    updateAdminUserList();
  });

  socket.on("admin_logout_all", () => {
    users.forEach((u) => io.to(u.id).emit("force_logout", { reason: "admin" }));
    users = [];
    updateAdminUserList();
  });

  // --- 切断処理 ---
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
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
