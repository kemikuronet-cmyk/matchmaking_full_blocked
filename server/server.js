// server/Server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- 簡易 in-memory データ ---
let users = []; // { id, name, sessionId, status, history, recentOpponents, loginTime }
let activeMatches = []; // { deskNum, player1, player2, player1SessionId, player2SessionId }
let matchEnabled = false;
let lotteryHistory = [];

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- React ビルド配信設定 ---
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "../client/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // --- ログイン ---
  socket.on("login", ({ name, sessionId, history, recentOpponents }) => {
    let user = users.find((u) => u.sessionId === sessionId);
    if (!user) {
      user = {
        id: socket.id,
        name,
        sessionId: socket.id,
        status: "idle",
        history: history || [],
        recentOpponents: recentOpponents || [],
        loginTime: Date.now(),
      };
      users.push(user);
    } else {
      user.name = name;
      user.history = history || user.history;
      user.recentOpponents = recentOpponents || user.recentOpponents;
      user.loginTime = Date.now();
    }
    socket.emit("login_ok", user);
  });

  // --- 管理者認証 ---
  socket.on("admin_login", ({ password }) => {
    if (password === process.env.ADMIN_PASSWORD) {
      socket.emit("admin_ok");
    } else {
      socket.emit("admin_fail");
    }
  });

  // --- マッチング ---
  socket.on("find_opponent", () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    user.status = "searching";

    const waiting = users.find((u) => u.status === "searching" && u.id !== socket.id);
    if (waiting && matchEnabled) {
      const deskNum = Math.floor(Math.random() * 1000);
      activeMatches.push({
        deskNum,
        player1: user.name,
        player2: waiting.name,
        player1SessionId: user.sessionId,
        player2SessionId: waiting.sessionId,
      });
      user.status = "playing";
      waiting.status = "playing";

      socket.emit("matched", { opponent: waiting, deskNum });
      io.to(waiting.id).emit("matched", { opponent: user, deskNum });
    }
  });

  socket.on("cancel_find", () => {
    const user = users.find((u) => u.id === socket.id);
    if (user) user.status = "idle";
  });

  socket.on("report_win_request", () => {
    const match = activeMatches.find((m) => m.player1SessionId === socket.id || m.player2SessionId === socket.id);
    if (!match) return;
    const opponentSessionId =
      match.player1SessionId === socket.id ? match.player2SessionId : match.player1SessionId;
    const opponent = users.find((u) => u.sessionId === opponentSessionId);
    if (!opponent) return;

    io.to(opponent.id).emit("confirm_opponent_win", { winnerName: users.find(u => u.sessionId === socket.id).name });
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    if (accepted) {
      // 勝敗を反映
      const match = activeMatches.find((m) => m.player1SessionId === socket.id || m.player2SessionId === socket.id);
      if (match) {
        const winner = users.find((u) => u.sessionId === socket.id);
        const loserSessionId =
          match.player1SessionId === socket.id ? match.player2SessionId : match.player1SessionId;
        const loser = users.find((u) => u.sessionId === loserSessionId);

        if (winner && loser) {
          winner.history.push({ opponent: loser.name, result: "WIN", endTime: Date.now() });
          loser.history.push({ opponent: winner.name, result: "LOSE", endTime: Date.now() });
        }

        activeMatches = activeMatches.filter((m) => m.deskNum !== match.deskNum);
        io.to(socket.id).emit("return_to_menu_battle");
        io.to(loser?.id).emit("return_to_menu_battle");
      }
    }
  });

  // --- マッチング有効化 ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- 管理者用ユーザーリスト ---
  socket.on("admin_view_users", () => {
    socket.emit("admin_user_list", users);
  });

  // --- 管理者ログアウト ---
  socket.on("admin_logout_user", ({ userId }) => {
    const u = users.find((usr) => usr.id === userId);
    if (u) {
      io.to(u.id).emit("force_logout", { reason: "admin" });
      users = users.filter((usr) => usr.id !== userId);
    }
  });

  socket.on("admin_logout_all", () => {
    users.forEach((u) => io.to(u.id).emit("force_logout", { reason: "admin" }));
    users = [];
  });

  // --- 抽選 ---
  socket.on("admin_draw_lots", ({ count, minBattles, minLoginMinutes, title }) => {
    const eligible = users.filter(
      (u) =>
        (u.history?.length || 0) >= minBattles &&
        ((Date.now() - u.loginTime) / 1000 / 60) >= minLoginMinutes
    );
    const winners = [];
    for (let i = 0; i < count && eligible.length > 0; i++) {
      const idx = Math.floor(Math.random() * eligible.length);
      winners.push({ name: eligible[idx].name });
      eligible.splice(idx, 1);
    }
    const entry = { title, winners };
    lotteryHistory.push(entry);
    io.emit("admin_draw_result", entry);
    io.emit("update_lottery_list", { list: [entry] });
  });

  socket.on("admin_get_lottery_history", () => {
    socket.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_clear_lottery_history", () => {
    lotteryHistory = [];
    io.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("disconnect", () => {
    users = users.filter((u) => u.id !== socket.id);
    console.log("User disconnected:", socket.id);
  });
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
