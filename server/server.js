// server/Server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

// React クライアント配信
app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

let users = []; // { id, name, sessionId, status, history, currentOpponent, deskNum, loginTime, recentOpponents }
let activeMatches = []; // { deskNum, player1Id, player2Id, player1, player2, player1SessionId, player2SessionId }
let nextDeskNum = 1;
let matchEnabled = false;
let lotteryHistory = [];
let autoLogoutHours = 12;

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  const getUserBySocket = () => users.find((u) => u.id === socket.id);

  // --- ユーザーログイン ---
  socket.on("login", ({ name, sessionId, history, recentOpponents }) => {
    let user = users.find((u) => u.sessionId === sessionId);
    if (!user) {
      user = {
        id: socket.id,
        name,
        sessionId: sessionId || socket.id,
        status: "idle",
        history: history || [],
        recentOpponents: recentOpponents || [],
        currentOpponent: null,
        deskNum: null,
        loginTime: Date.now(),
      };
      users.push(user);
    } else {
      user.name = name;
      user.loginTime = Date.now();
      user.history = history || user.history || [];
      user.recentOpponents = recentOpponents || user.recentOpponents || [];
    }

    // 対戦中復元
    if (user.status === "in_battle" && user.currentOpponent) {
      socket.emit("matched", {
        opponent: user.currentOpponent,
        deskNum: user.deskNum,
      });
    }

    socket.emit("login_ok", user);
  });

  // --- 対戦相手検索 ---
  socket.on("find_opponent", () => {
    const user = getUserBySocket();
    if (!user || !matchEnabled) return;

    user.status = "searching";
    const waiting = users.filter((u) => u.status === "searching" && u.id !== socket.id);

    if (waiting.length > 0) {
      const opponent = waiting[0];
      const deskNum = nextDeskNum++;

      user.status = "in_battle";
      user.currentOpponent = { id: opponent.id, name: opponent.name };
      user.deskNum = deskNum;

      opponent.status = "in_battle";
      opponent.currentOpponent = { id: user.id, name: user.name };
      opponent.deskNum = deskNum;

      activeMatches.push({
        deskNum,
        player1Id: user.id,
        player2Id: opponent.id,
        player1: user.name,
        player2: opponent.name,
        player1SessionId: user.sessionId,
        player2SessionId: opponent.sessionId,
      });

      io.to(user.id).emit("matched", { opponent: opponent, deskNum });
      io.to(opponent.id).emit("matched", { opponent: user, deskNum });
    } else {
      socket.emit("match_status", { enabled: matchEnabled });
    }
  });

  // --- 検索キャンセル ---
  socket.on("cancel_find", () => {
    const user = getUserBySocket();
    if (user && user.status === "searching") {
      user.status = "idle";
      socket.emit("return_to_menu_battle");
    }
  });

  // --- 勝利報告 ---
  socket.on("report_win_request", () => {
    const user = getUserBySocket();
    if (!user || !user.currentOpponent) return;

    const opponent = users.find((u) => u.id === user.currentOpponent.id);
    if (!opponent) return;

    io.to(opponent.id).emit("confirm_opponent_win", {
      deskNum: user.deskNum,
      winnerName: user.name,
    });
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const user = getUserBySocket();
    if (!user || !user.currentOpponent) return;

    const opponent = users.find((u) => u.id === user.currentOpponent.id);
    if (!opponent) return;

    if (accepted) {
      // 勝敗登録
      user.history.push({ opponent: opponent.name, result: "WIN", endTime: Date.now() });
      opponent.history.push({ opponent: user.name, result: "LOSE", endTime: Date.now() });

      // リセット
      const deskNum = user.deskNum;
      user.status = opponent.status = "idle";
      user.deskNum = opponent.deskNum = null;
      user.currentOpponent = opponent.currentOpponent = null;

      activeMatches = activeMatches.filter((m) => m.deskNum !== deskNum);

      io.to(user.id).emit("return_to_menu_battle");
      io.to(opponent.id).emit("return_to_menu_battle");

      // 履歴更新
      io.to(user.id).emit("history", user.history);
      io.to(opponent.id).emit("history", opponent.history);
    } else {
      io.to(user.id).emit("win_report_cancelled");
    }
  });

  // --- ユーザーログアウト ---
  socket.on("logout", () => {
    const leaving = getUserBySocket();
    if (leaving) {
      activeMatches = activeMatches.filter(
        (m) => m.player1Id !== leaving.id && m.player2Id !== leaving.id
      );
      users = users.filter((u) => u.id !== leaving.id);
    }
  });

  // --- 管理者関連 ---
  socket.on("admin_login", ({ password }) => {
    if (password === process.env.ADMIN_PASSWORD) {
      socket.emit("admin_ok");
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_view_users", () => socket.emit("admin_user_list", users));

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- 抽選管理 ---
  socket.on("admin_draw_lots", ({ count, minBattles, minLoginMinutes, title }) => {
    const candidates = users.filter(
      (u) =>
        u.history.length >= minBattles &&
        Date.now() - u.loginTime >= minLoginMinutes * 60 * 1000
    );
    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, count).map((u) => ({ name: u.name }));
    lotteryHistory.push({ title, winners });
    io.emit("admin_draw_result", { title, winners });
  });

  socket.on("admin_get_lottery_history", () => {
    socket.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_delete_lottery_history", ({ index }) => {
    if (index >= 0 && index < lotteryHistory.length) lotteryHistory.splice(index, 1);
    io.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("admin_clear_lottery_history", () => {
    lotteryHistory = [];
    io.emit("admin_lottery_history", lotteryHistory);
  });

  socket.on("disconnect", () => {
    const leaving = getUserBySocket();
    if (leaving) {
      activeMatches = activeMatches.filter(
        (m) => m.player1Id !== leaving.id && m.player2Id !== leaving.id
      );
      users = users.filter((u) => u.id !== leaving.id);
    }
  });
});

httpServer.listen(process.env.PORT || 4000, () => {
  console.log("Server is running");
});
