import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";
import backgroundImage from "./images/background.jpg";

const socket = io(
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:4000"
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
  const [showUserList, setShowUserList] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [drawResult, setDrawResult] = useState([]);

  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setLoggedIn(true);
      socket.emit("login", { name: u.name, sessionId: u.sessionId });
    }

    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      localStorage.setItem("user", JSON.stringify(u));

      if (u.status === "searching") setSearching(true);
      else setSearching(false);

      if (u.currentOpponent) {
        setOpponent(u.currentOpponent);
        setDeskNum(u.deskNum || "");
      } else {
        setOpponent(null);
        setDeskNum("");
      }
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum("");
      setSearching(false);
    });

    socket.on("force_logout", () => {
      localStorage.removeItem("user");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum("");
    });

    socket.on("history", (hist) => {
      setHistory(hist);
      setShowHistory(true);
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("パスワードが間違っています"));
    socket.on("admin_user_list", (list) => setUsersList(list));
    socket.on("admin_draw_result", (res) => setDrawResult(res));

    return () => socket.off();
  }, []);

  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    socket.emit("login", { name: trimmedName });
  };

  const handleFindOpponent = () => {
    if (!matchEnabled) return;
    setSearching(true);
    socket.emit("find_opponent");
  };

  const handleCancelSearch = () => {
    setSearching(false);
    socket.emit("cancel_find");
  };

  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socket.emit("report_win");
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.removeItem("user");
    window.location.reload();
  };

  const commonStyle = {
    backgroundImage: `url(${backgroundImage})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    minHeight: "100vh",
  };

  // --- ここからレンダリング ---
  if (!loggedIn && !adminMode) {
    return (
      <div className="login-screen app-background" style={commonStyle}>
        <input
          type="text"
          placeholder="ユーザー名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button onClick={handleLogin}>ログイン</button>
      </div>
    );
  }

  if (opponent) {
    return (
      <div className="battle-screen app-background" style={commonStyle}>
        <h3>対戦相手: {opponent.name}</h3>
        <div>卓番号: {deskNum}</div>
        <button onClick={handleWinReport}>勝利報告</button>
      </div>
    );
  }

  return (
    <div className="app app-background" style={commonStyle}>
      <div className="header">{user?.name}</div>
      {!searching && matchEnabled && (
        <button onClick={handleFindOpponent}>対戦相手を探す</button>
      )}
      {searching && <button onClick={handleCancelSearch}>検索をキャンセル</button>}
    </div>
  );
}

export default App;
export { socket };
