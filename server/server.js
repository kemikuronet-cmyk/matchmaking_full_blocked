// server/Server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

let users = []; // { id, name, sessionId, status, history, currentOpponent, deskNum, loginTime }
let activeMatches = []; // { deskNum, player1Id, player2Id, player1, player2, player1SessionId, player2SessionId }
let nextDeskNum = 1;
let matchEnabled = false;

// --- Socket.io --- 
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

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

    // もし対戦中だった場合、deskNumとcurrentOpponentを復元
    if (user.status === "searching") {
      socket.emit("matched", {
        opponent: user.currentOpponent,
        deskNum: user.deskNum,
      });
    }

    socket.emit("login_ok", user);
  });

  socket.on("find_opponent", () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !matchEnabled) return;

    user.status = "searching";
    const waiting = users.filter((u) => u.status === "searching" && u.id !== socket.id);

    if (waiting.length > 0) {
      const opponent = waiting[0];
      const deskNum = nextDeskNum++;

      // 両者をマッチング
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

  socket.on("report_win_request", () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !user.currentOpponent) return;

    const opponent = users.find((u) => u.id === user.currentOpponent.id);
    if (!opponent) return;

    // 勝利確認
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
      // 勝敗を登録
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

      // リセット
      user.status = "idle";
      opponent.status = "idle";
      const deskNum = user.deskNum;
      user.deskNum = null;
      user.currentOpponent = null;
      opponent.deskNum = null;
      opponent.currentOpponent = null;

      // activeMatches から削除
      activeMatches = activeMatches.filter((m) => m.deskNum !== deskNum);

      io.to(user.id).emit("return_to_menu_battle");
      io.to(opponent.id).emit("return_to_menu_battle");

      // 全クライアントに履歴更新通知
      io.to(user.id).emit("history", user.history);
      io.to(opponent.id).emit("history", opponent.history);
    } else {
      io.to(user.id).emit("win_report_cancelled");
    }
  });

  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    activeMatches = activeMatches.filter((m) => m.player1Id !== socket.id && m.player2Id !== socket.id);
  });

  // --- 管理者関連 ---
  socket.on("admin_login", ({ password }) => {
    if (password === process.env.ADMIN_PASSWORD) {
      socket.emit("admin_ok");
    } else {
      socket.emit("admin_fail");
    }
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
      activeMatches = activeMatches.filter((m) => m.player1Id !== socket.id && m.player2Id !== socket.id);
      users = users.filter((u) => u.id !== socket.id);
    }
  });
});

httpServer.listen(process.env.PORT || 4000, () => {
  console.log("Server is running");
});
