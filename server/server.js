// server/Server.js
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

// Vite ビルド出力（React アプリ）の静的配信
app.use(express.static(path.join(__dirname, "../client/dist")));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// --- データ保持 ---
let users = []; // { id, name, sessionId, status, history, currentOpponent, deskNum, loginTime }
let activeMatches = []; // { deskNum, player1Id, player2Id, player1, player2, player1SessionId, player2SessionId }
let nextDeskNum = 1;
let matchEnabled = false;

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

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

    if (user.status === "searching") {
      socket.emit("matched", {
        opponent: user.currentOpponent,
        deskNum: user.deskNum,
      });
    }

    socket.emit("login_ok", user);
  });

  // --- 対戦相手を探す ---
  socket.on("find_opponent", () => {
    const user = users.find((u) => u.id === socket.id);
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

  socket.on("cancel_find", () => {
    const user = users.find((u) => u.id === socket.id);
    if (user && user.status === "searching") {
      user.status = "idle";
      socket.emit("return_to_menu_battle");
    }
  });

  // --- 勝利報告 ---
  socket.on("report_win_request", () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !user.currentOpponent) return;

    const opponent = users.find((u) => u.id === user.currentOpponent.id);
    if (!opponent) return;

    io.to(opponent.id).emit("confirm_opponent_win", {
      deskNum: user.deskNum,
      winnerName: user.name,
    });
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !user.currentOpponent) return;
    const opponent = users.find((u) => u.id === user.currentOpponent.id);
    if (!opponent) return;

    if (accepted) {
      user.history.push({
        opponent: opponent.name,
        result: "WIN",
        endTime: Date.now(),
      });
      opponent.history.push({
        opponent: user.name,
        result: "LOSE",
        endTime: Date.now(),
      });

      user.status = "idle";
      opponent.status = "idle";
      const deskNum = user.deskNum;
      user.deskNum = null;
      user.currentOpponent = null;
      opponent.deskNum = null;
      opponent.currentOpponent = null;

      activeMatches = activeMatches.filter((m) => m.deskNum !== deskNum);

      io.to(user.id).emit("return_to_menu_battle");
      io.to(opponent.id).emit("return_to_menu_battle");

      io.to(user.id).emit("history", user.history);
      io.to(opponent.id).emit("history", opponent.history);
    } else {
      io.to(user.id).emit("win_report_cancelled");
    }
  });

  // --- ユーザーログアウト ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    activeMatches = activeMatches.filter(
      (m) => m.player1Id !== socket.id && m.player2Id !== socket.id
    );
  });

  // --- 管理者 ---
  socket.on("admin_login", ({ password }) => {
    if (password === process.env.ADMIN_PASSWORD) socket.emit("admin_ok");
    else socket.emit("admin_fail");
  });

  socket.on("admin_view_users", () => {
    socket.emit("admin_user_list", users);
  });

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  socket.on("disconnect", () => {
    const leavingUser = users.find((u) => u.id === socket.id);
    if (leavingUser) {
      activeMatches = activeMatches.filter(
        (m) => m.player1Id !== socket.id && m.player2Id !== socket.id
      );
      users = users.filter((u) => u.id !== socket.id);
    }
  });
});

// --- React SPA ルーティング対応 ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

// --- サーバ起動 ---
httpServer.listen(process.env.PORT || 4000, () => {
  console.log("Server is running");
});
