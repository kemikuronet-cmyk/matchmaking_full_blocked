// ✅ Server.js 完全統合版（スマホ長時間維持用）
// 現行機能 + 勝敗保持 + 状態復元 + 自動リセット機能 + スマホ最適化
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// React ビルド配信
const CLIENT_DIST = path.join(__dirname, "../client/dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
} else {
  app.get("/", (req, res) => res.send("Client dist not found. Please build client."));
}

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- データ管理 ---
const users = new Map(); // sessionId -> userオブジェクト
const matches = new Map(); // deskNum -> { player1, player2 }
const lotteryHistory = []; // { title, winners: [{name}] }
let lotteryList = [];
let matchEnabled = true;
let autoLogoutHours = 12;
let nextDeskNum = 1;

// --- ヘルパー ---
const generateSessionId = () => crypto.randomBytes(8).toString("hex");

const getUserByName = (name) => {
  for (const u of users.values()) {
    if (u.name === name) return u;
  }
  return null;
};

const cleanInactiveUsers = () => {
  const now = Date.now();
  for (const [sid, u] of users.entries()) {
    if (now - u.lastActive > autoLogoutHours * 3600 * 1000) {
      users.delete(sid);
      io.to(sid).emit("force_logout", { reason: "auto" });
    }
  }
};

// --- Socket.io ---
io.on("connection", (socket) => {
  socket.on("login", ({ name, sessionId, history = [], recentOpponents = [] }) => {
    let u = sessionId && users.get(sessionId);
    if (!u) {
      sessionId = generateSessionId();
      u = { name, sessionId, history, recentOpponents, status: "idle", lastActive: Date.now() };
      users.set(sessionId, u);
    } else {
      u.name = name;
      u.lastActive = Date.now();
      u.history = Array.isArray(history) ? history : u.history;
    }

    // --- 勝敗履歴の同期 ---
    const finalHistory = u.history.length >= (history?.length || 0) ? u.history : history;

    u.history = finalHistory;

    socket.join(sessionId);
    socket.emit("login_ok", u);

    // --- スマホ向け最適化 ---
    socket.on("disconnect", () => {
      u.lastActive = Date.now(); // 切断時も更新
    });
  });

  // マッチング関連
  socket.on("find_opponent", () => {
    const user = Array.from(users.values()).find(u => u.sessionId === socket.id || u.status === "searching");
    if (!user || !matchEnabled) return;

    user.status = "searching";

    const opponent = Array.from(users.values()).find(u => u.status === "searching" && u.sessionId !== user.sessionId);
    if (opponent) {
      const deskNum = nextDeskNum++;
      matches.set(deskNum, { player1: user, player2: opponent });

      user.status = "in_match"; opponent.status = "in_match";

      user.currentOpponent = { name: opponent.name };
      opponent.currentOpponent = { name: user.name };
      user.deskNum = deskNum;
      opponent.deskNum = deskNum;

      io.to(user.sessionId).emit("matched", { opponent: opponent, deskNum });
      io.to(opponent.sessionId).emit("matched", { opponent: user, deskNum });
    }
  });

  socket.on("cancel_find", () => {
    const user = Array.from(users.values()).find(u => u.sessionId === socket.id);
    if (user) user.status = "idle";
  });

  socket.on("report_win_request", () => {
    // 対戦相手に勝利確認要求
    const user = Array.from(users.values()).find(u => u.sessionId === socket.id);
    if (!user || !user.currentOpponent) return;

    const opponent = getUserByName(user.currentOpponent.name);
    if (opponent) {
      io.to(opponent.sessionId).emit("confirm_opponent_win", { winnerName: user.name, deskNum: user.deskNum });
    }
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const user = Array.from(users.values()).find(u => u.sessionId === socket.id);
    if (!user) return;
    // 勝敗登録処理
  });

  socket.on("logout", () => {
    const user = Array.from(users.values()).find(u => u.sessionId === socket.id);
    if (user) users.delete(user.sessionId);
    socket.disconnect(true);
  });

  // --- 管理者機能 ---
  socket.on("admin_login", ({ password }) => {
    if (password === process.env.ADMIN_PASSWORD) {
      socket.emit("admin_ok");
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_view_users", () => {
    socket.emit("admin_user_list", Array.from(users.values()));
  });

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  socket.on("admin_logout_user", ({ userId }) => {
    const user = users.get(userId);
    if (user) {
      io.to(user.sessionId).emit("force_logout", { reason: "admin" });
      users.delete(userId);
    }
  });

  socket.on("admin_logout_all", () => {
    for (const u of users.values()) {
      io.to(u.sessionId).emit("force_logout", { reason: "admin" });
    }
    users.clear();
  });

  socket.on("admin_set_auto_logout", ({ hours }) => {
    autoLogoutHours = hours;
    socket.emit("admin_set_auto_logout_ok", { hours });
  });

  socket.on("admin_get_auto_logout", () => {
    socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
  });

  // --- 抽選機能 ---
  socket.on("admin_draw_lots", ({ count, minBattles, minLoginMinutes, title }) => {
    const candidates = Array.from(users.values()).filter(u => u.history.length >= minBattles && (Date.now() - u.lastActive) >= minLoginMinutes * 60000);
    const winners = [];

    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const idx = Math.floor(Math.random() * candidates.length);
      winners.push({ name: candidates[idx].name });
      candidates.splice(idx, 1);
    }

    const entry = { title, winners };
    lotteryHistory.push(entry);
    io.emit("update_lottery_list", { list: entry });
  });

});
// --- 勝敗登録 ---
io.on("connection", (socket) => {
  socket.on("admin_report_win", ({ winnerSessionId, deskNum }) => {
    const match = matches.get(deskNum);
    if (!match) return;

    const winner = users.get(winnerSessionId);
    if (!winner) return;

    const loser = match.player1.sessionId === winnerSessionId ? match.player2 : match.player1;

    winner.history.push({ opponent: loser.name, result: "WIN" });
    loser.history.push({ opponent: winner.name, result: "LOSE" });

    // 部屋削除
    matches.delete(deskNum);

    io.to(winner.sessionId).emit("return_to_menu_battle");
    io.to(loser.sessionId).emit("return_to_menu_battle");
  });

  socket.on("admin_report_both_lose", (deskNum) => {
    const match = matches.get(deskNum);
    if (!match) return;

    match.player1.history.push({ opponent: match.player2.name, result: "LOSE" });
    match.player2.history.push({ opponent: match.player1.name, result: "LOSE" });

    matches.delete(deskNum);

    io.to(match.player1.sessionId).emit("return_to_menu_battle");
    io.to(match.player2.sessionId).emit("return_to_menu_battle");
  });

  socket.on("win_report_cancelled", ({ deskNum }) => {
    const match = matches.get(deskNum);
    if (!match) return;

    io.to(match.player1.sessionId).emit("win_report_cancelled");
    io.to(match.player2.sessionId).emit("win_report_cancelled");
  });

  // --- 抽選履歴管理 ---
  socket.on("admin_lottery_history", () => {
    socket.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_delete_lottery_history", ({ index }) => {
    if (lotteryHistory[index]) {
      lotteryHistory.splice(index, 1);
    }
    io.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_clear_lottery_history", () => {
    lotteryHistory.length = 0;
    io.emit("admin_lottery_history", lotteryHistory);
  });

  // --- アクティブマッチ一覧送信（管理者用） ---
  socket.on("admin_get_active_matches", () => {
    const list = Array.from(matches.entries()).map(([deskNum, m]) => ({
      deskNum,
      player1: { name: m.player1.name, sessionId: m.player1.sessionId },
      player2: { name: m.player2.name, sessionId: m.player2.sessionId },
    }));
    socket.emit("admin_active_matches", list);
  });
});

// --- 定期タスク：自動ログアウトチェック ---
setInterval(() => {
  cleanInactiveUsers();
}, 60 * 1000); // 1分毎

// --- Server 起動 ---
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
