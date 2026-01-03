import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "/";
const AUTO_RECONNECT_INTERVAL = 30000;

function App() {
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [lotteryResults, setLotteryResults] = useState([]);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [desks, setDesks] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [lotteryVisible, setLotteryVisible] = useState(true);
  const socketRef = useRef(null);
  const heartbeatTimer = useRef(null);

  // -------------------------
  // Socket.io 初期化
  // -------------------------
  useEffect(() => {
    socketRef.current = io(SERVER_URL);
    const socket = socketRef.current;

    socket.on("connect", () => {
      console.log("✅ Connected:", socket.id);
      if (user?.sessionId) socket.emit("heartbeat", { sessionId: user.sessionId });
    });

    socket.on("login_ok", (payload) => {
      setUser(payload);
      setLoggedIn(true);
      setHistory(payload.history || []);
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    socket.on("matched", ({ opponent, deskNum }) => {
      setDesks(prev => [...prev, { deskNum, opponent }]);
    });

    socket.on("return_to_menu_battle", ({ deskNum }) => {
      setDesks(prev => prev.filter(d => d.deskNum !== deskNum));
    });

    socket.on("history", (hist) => setHistory(hist));

    socket.on("update_lottery_list", ({ list }) => setLotteryResults(list));

    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("管理者パスワードが違います"));
    socket.on("admin_user_list", (users) => setDesks(users));

    heartbeatTimer.current = setInterval(() => {
      if (user?.sessionId) socket.emit("heartbeat", { sessionId: user.sessionId });
    }, 30000);

    return () => {
      socket.disconnect();
      clearInterval(heartbeatTimer.current);
    };
  }, [user]);

  // -------------------------
  // ハンドラ
  // -------------------------
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    const sessionId = localStorage.getItem("sessionId") || undefined;
    socketRef.current.emit("login", { name: trimmedName, sessionId, recentOpponents: [], history });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socketRef.current.emit("admin_login", { password: adminPassword });
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socketRef.current.emit("logout");
    setUser(null);
    setLoggedIn(false);
    setDesks([]);
    setHistory([]);
    setName("");
  };

  const handleFindOpponent = () => {
    if (!matchEnabled) return;
    setSearching(true);
    socketRef.current.emit("find_opponent");
  };

  const handleCancelSearch = () => {
    setSearching(false);
    socketRef.current.emit("cancel_find");
  };

  const handleWinReport = (deskNum) => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socketRef.current.emit("report_win_request");
  };

  const toggleHistory = () => setHistoryVisible(prev => !prev);
  const toggleLottery = () => setLotteryVisible(prev => !prev);

  // -------------------------
  // レンダリング
  // -------------------------
  return (
    <div className="app">
      {/* 管理者ログインフォーム 右上 */}
      {!adminMode && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="Admin Password"
            value={adminPassword}
            onChange={e => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>Admin</button>
        </div>
      )}

      {/* ユーザー未ログイン */}
      {!loggedIn && (
        <div className="user-login-center">
          <h2>ユーザー名でログイン</h2>
          <input value={name} onChange={e => setName(e.target.value)} />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {loggedIn && !adminMode && user && (
        <div className="user-menu">
          <h2>{user.name} さん</h2>

          <div className="user-stats">
            <p>勝ち：{user.wins || 0}</p>
            <p>負け：{user.losses || 0}</p>
            <p>対戦数：{user.totalBattles || 0}</p>
          </div>

          <div className="match-controls">
            {!desks.length ? (
              !searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>マッチング開始</button>
              ) : (
                <button className="cancel-btn" onClick={handleCancelSearch}>キャンセル</button>
              )
            ) : (
              desks.map(d => (
                <div key={d.deskNum} className="battle-info">
                  <h3>卓 {d.deskNum} / 対戦相手: {d.opponent.name}</h3>
                  <button className="win-btn" onClick={() => handleWinReport(d.deskNum)}>勝利報告</button>
                </div>
              ))
            )}
          </div>

          <button className="main-btn" onClick={toggleHistory}>
            {historyVisible ? "対戦履歴を閉じる" : "対戦履歴を表示"}
          </button>
          {historyVisible && (
            <div className="history-section">
              {history.length === 0 ? <p>対戦履歴なし</p> :
                <ul className="history-list">{history.map((h, i) => <li key={i}>{h.opponent}: {h.result}</li>)}</ul>}
            </div>
          )}

          <button className="main-btn" onClick={toggleLottery}>
            {lotteryVisible ? "抽選結果を閉じる" : "抽選結果を表示"}
          </button>
          {lotteryVisible && (
            <div className="lottery-section">
              {lotteryResults.length === 0 ? <p>抽選結果なし</p> :
                <ul className="lottery-user-history">{lotteryResults.map((entry, i) => <li key={i}>{entry.name}</li>)}</ul>}
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button className="main-btn" onClick={handleLogout}>ログアウト</button>
          </div>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <div className="admin-controls">
            <button className="admin-btn" onClick={() => socketRef.current.emit("admin_toggle_match", { enable: !matchEnabled })}>
              {matchEnabled ? "マッチング停止" : "マッチング開始"}
            </button>
          </div>

          <div className="desk-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? (
              <p>現在、稼働中の卓はありません</p>
            ) : (
              <ul className="desk-list">
                {desks.map((d, i) => (
                  <li key={i}>
                    <strong>卓 {d.deskNum}</strong>: {d.opponent?.name || "不明"}
                    <button className="win-btn" onClick={() => handleWinReport(d.deskNum)}>勝利報告</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lottery-admin-section">
            <h3>抽選履歴</h3>
            <ul>
              {lotteryHistory.map((rec, i) => (
                <li key={i}>
                  {rec.title} ({new Date(rec.time).toLocaleString()}): {rec.winners.map(w => w.name).join(", ")}
                </li>
              ))}
            </ul>
            <button className="admin-btn" onClick={() => alert("抽選実行")}>抽選実行</button>
          </div>

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>
        </div>
      )}
    </div>
  );
}

export default App;
