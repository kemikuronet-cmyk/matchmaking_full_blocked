// ✅ Server.js（ロールバック安定版＋復元＋マッチング表示修正）
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

let users = [];
let matches = [];
let matchEnabled = true;
let autoLogoutHours = 12;

// ✅ 接続時
io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // --- クライアントへ現在のマッチング状態を即送信（ボタン非表示対策）---
  socket.emit("match_status", { enabled: matchEnabled });

  // --- ログイン処理 ---
  socket.on("login", ({ name, sessionId, history = [], recentOpponents = [] }) => {
    if (!name) return;

    let user = users.find((u) => u.sessionId === sessionId);
    const now = new Date();

    if (user) {
      // ⏰ 自動ログアウト期限切れ時のみリセット
      const hoursDiff = (Date.now() - new Date(user.loginTime).getTime()) / 3600000;
      if (hoursDiff >= autoLogoutHours) {
        user.history = [];
        user.recentOpponents = [];
      }
      // セッション復元
      user.id = socket.id;
      user.status = "idle";
    } else {
      // 新規ログイン
      user = {
        id: socket.id,
        name,
        sessionId: sessionId || socket.id,
        status: "idle",
        loginTime: now,
        history: history || [],
        recentOpponents: recentOpponents || [],
        wins: 0,
        losses: 0,
        totalBattles: 0,
      };
      users.push(user);
    }

    // --- 履歴・勝敗数をサーバ上でも更新 ---
    user.totalBattles = user.history.length;
    user.wins = user.history.filter((h) => h.result === "WIN").length;
    user.losses = user.history.filter((h) => h.result === "LOSE").length;

    socket.emit("login_ok", user);
    console.log(`✅ ${user.name} logged in (${user.sessionId})`);
  });

  // --- 履歴同期（localStorage反映対策）---
  socket.on("sync_history", ({ sessionId, history, recentOpponents }) => {
    const user = users.find((u) => u.sessionId === sessionId);
    if (user && Array.isArray(history)) {
      user.history = history;
      user.recentOpponents = recentOpponents || [];
      user.totalBattles = history.length;
      user.wins = history.filter((h) => h.result === "WIN").length;
      user.losses = history.filter((h) => h.result === "LOSE").length;
    }
  });

  // --- 履歴更新 ---
  socket.on("history_update", ({ sessionId, history }) => {
    const user = users.find((u) => u.sessionId === sessionId);
    if (user && Array.isArray(history)) {
      user.history = history;
      user.totalBattles = history.length;
      user.wins = history.filter((h) => h.result === "WIN").length;
      user.losses = history.filter((h) => h.result === "LOSE").length;
    }
  });

  // --- マッチング要求 ---
  socket.on("find_opponent", () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const opponent = users.find(
      (u) =>
        u.status === "searching" &&
        u.id !== user.id &&
        u.sessionId !== user.sessionId
    );

    if (opponent) {
      const deskNum = Math.floor(1000 + Math.random() * 9000);
      user.status = opponent.status = "battling";
      matches.push({
        deskNum,
        player1: user.name,
        player2: opponent.name,
        player1SessionId: user.sessionId,
        player2SessionId: opponent.sessionId,
      });
      io.to(user.id).emit("matched", { opponent, deskNum });
      io.to(opponent.id).emit("matched", { opponent: user, deskNum });
      console.log(`🎯 Match: ${user.name} vs ${opponent.name}`);
    }
  });

  socket.on("cancel_find", () => {
    const user = users.find((u) => u.id === socket.id);
    if (user) user.status = "idle";
  });

  // --- 勝利報告 ---
  socket.on("report_win_request", () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const match = matches.find(
      (m) => m.player1 === user.name || m.player2 === user.name
    );
    if (!match) return;

    const opponent =
      match.player1 === user.name
        ? users.find((u) => u.name === match.player2)
        : users.find((u) => u.name === match.player1);

    if (opponent) {
      io.to(opponent.id).emit("confirm_opponent_win", {
        deskNum: match.deskNum,
        winnerName: user.name,
      });
    }
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const loser = users.find((u) => u.id === socket.id);
    if (!loser) return;

    const match = matches.find(
      (m) => m.player1 === loser.name || m.player2 === loser.name
    );
    if (!match) return;

    const winnerName =
      match.player1 === loser.name ? match.player2 : match.player1;
    const winner = users.find((u) => u.name === winnerName);

    if (accepted && winner) {
      const now = new Date();
      winner.history.push({
        opponent: loser.name,
        result: "WIN",
        endTime: now,
      });
      loser.history.push({
        opponent: winner.name,
        result: "LOSE",
        endTime: now,
      });

      winner.totalBattles++;
      loser.totalBattles++;
      winner.wins++;
      loser.losses++;

      io.to(winner.id).emit("return_to_menu_battle");
      io.to(loser.id).emit("return_to_menu_battle");

      matches = matches.filter((m) => m.deskNum !== match.deskNum);
      console.log(`🏁 Result: ${winner.name} WIN vs ${loser.name}`);
    } else {
      io.to(loser.id).emit("win_report_cancelled");
    }
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", (pw) => {
    if (pw === "admin1234") {
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
    } else {
      socket.emit("admin_fail");
    }
  });

  // --- 管理者機能 ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  socket.on("admin_view_users", () => {
    socket.emit("admin_user_list", users);
  });

  socket.on("admin_logout_all", () => {
    users = [];
    matches = [];
    io.emit("force_logout", { reason: "admin" });
  });

  socket.on("logout", () => {
    const index = users.findIndex((u) => u.id === socket.id);
    if (index >= 0) users.splice(index, 1);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
  });
});

app.use(express.static(path.join(__dirname, "client", "dist")));
app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
