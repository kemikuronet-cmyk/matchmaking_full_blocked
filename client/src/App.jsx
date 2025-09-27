import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Socket を App 内で定義（外部に export しない）
const socket = io(
  process.env.NODE_ENV === "production"
    ? window.location.origin   // 本番 Render URL
    : "http://localhost:4000" // ローカル開発用
);

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState("");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [drawResult, setDrawResult] = useState([]);

  useEffect(() => {
    // 自動ログイン復元
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setLoggedIn(true);
    }

    // --- Socket イベント ---
    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      localStorage.setItem("user", JSON.stringify(u));
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
    });

    socket.on("return_to_menu", () => {
      setOpponent(null);
      setDeskNum("");
      setSearching(false);
    });

    socket.on("history", (hist) => {
      setHistory(hist);
      setShowHistory(true);
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_user_list", (list) => setUsersList(list));
    socket.on("admin_draw_result", (res) => setDrawResult(res));

    // クリーンアップ
    return () => {
      socket.off();
    };
  }, []);

  const handleLogin = () => {
    if (!name) return;
    socket.emit("login", { name });
  };

  // ...（handleFindOpponent, handleWinReport, handleLogout なども同じ）
}

export default App;
