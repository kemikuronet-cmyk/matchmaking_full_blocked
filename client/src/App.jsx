import React, { useState, useEffect } from "react";
import io from "socket.io-client";
import "./App.css";

// Socket を App 内で定義
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
  const [drawCount, setDrawCount] = useState(1);
  const [drawResult, setDrawResult] = useState([]);

  // --- Socket イベント ---
  useEffect(() => {
    // 自動ログイン復元
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setLoggedIn(true);
    }

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

    return () => {
      socket.off();
    };
  }, []);

  // --- ログイン ---
  const handleLogin = () => {
    if (!name) return;
    socket.emit("login", { name });
  };

  // --- 対戦相手探す / キャンセル ---
  const handleFindOpponent = () => {
    if (searching) {
      setSearching(false);
      socket.emit("cancel_find");
    } else {
      setSearching(true);
      socket.emit("find_opponent");
    }
  };

  // --- 勝利報告 ---
  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socket.emit("report_win");
  };

  // --- 対戦履歴表示 ---
  const handleShowHistory = () => socket.emit("request_history");

  // --- ログアウト ---
  const handleLogout = () => {
    if (!window.confirm("ログイン名、対戦履歴がリセットされます。ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.removeItem("user");
    window.location.reload();
  };

  // --- 管理者ログイン ---
  const handleAdminLogin = () => socket.emit("admin_login", { password: adminPassword });
  const handleToggleMatch = (enable) => socket.emit("admin_toggle_match", { enable });
  const handleViewUsers = () => socket.emit("admin_view_users");
  const handleDrawLots = () => socket.emit("admin_draw_lots", { count: drawCount });

  // --- レンダリング ---
  if (!loggedIn && !adminMode) {
    return (
      <div className="app">
        <div className="login-screen">
          <h2>ユーザーとしてログイン</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ユーザー名" />
          <button onClick={handleLogin}>ログイン</button>

          <hr />

          <h2>管理者としてログイン</h2>
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="管理者パスワード"
          />
          <button onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      </div>
    );
  }

  if (adminMode) {
    return (
      <div className="app">
        <div className="header">管理者画面</div>
        <div className="admin-screen">
          <div className="admin-section">
            <h3>マッチング操作</h3>
            <button onClick={() => handleToggleMatch(true)}>マッチング開始</button>
            <button onClick={() => handleToggleMatch(false)}>マッチング終了</button>
            <div>{matchEnabled ? "マッチング状態" : "マッチング受付時間外"}</div>
          </div>

          <div className="admin-section">
            <h3>ユーザー管理</h3>
            <button onClick={handleViewUsers}>ユーザー一覧表示</button>
            <button onClick={() => socket.emit('admin_logout_all')}>全ユーザーをログアウト</button>
            <ul>
              {usersList.map(u => (
                <li key={u.id}>{u.id} | {u.name} | 対戦数: {u.history.length}</li>
              ))}
            </ul>
          </div>

          <div className="admin-section">
            <h3>抽選</h3>
            <input type="number" min="1" value={drawCount} onChange={(e) => setDrawCount(Number(e.target.value))}/>
            <button onClick={handleDrawLots}>抽選する</button>
            <ul>
              {drawResult.map(u => (
                <li key={u.id}>{u.id} | {u.name}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">{user?.name}</div>

      {!opponent && (
        <div className="menu-screen">
          {matchEnabled ? (
            <button onClick={handleFindOpponent}>
              {searching ? "対戦相手を探しています…" : "対戦相手を探す"}
            </button>
          ) : (
            <div className="match-disabled">マッチング受付時間外です</div>
          )}
          <button onClick={handleShowHistory}>対戦履歴を確認する</button>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      )}

      {opponent && (
        <div className="battle-screen">
          <h3>対戦相手: {opponent.name}</h3>
          <div>卓番号: {deskNum}</div>
          <button onClick={handleWinReport}>勝利報告</button>
        </div>
      )}

      {showHistory && (
        <div className="history-modal">
          <h3>対戦履歴</h3>
          <ul>
            {history.map((h, i) => (
              <li key={i}>
                相手: {h.opponent} | {h.result} | 開始: {h.startTime} | 終了: {h.endTime}
              </li>
            ))}
          </ul>
          <button onClick={() => setShowHistory(false)}>閉じる</button>
        </div>
      )}
    </div>
  );
}

export default App;
