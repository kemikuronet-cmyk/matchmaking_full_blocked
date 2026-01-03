import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = window.location.origin;

function App() {
  // -------------------------
  // State
  // -------------------------
  const [user, setUser] = useState(null);
  const [name, setName] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [desks, setDesks] = useState([]);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [searching, setSearching] = useState(false);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [lotteryResults, setLotteryResults] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(true);

  const socketRef = useRef(null);

  // -------------------------
  // Socket.io 初期化
  // -------------------------
  useEffect(() => {
    const socket = io(SERVER_URL, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 20000,
    });
    socketRef.current = socket;

    socket.on("connect", () => console.log("[SOCKET] connected", socket.id));
    socket.on("connect_error", (err) => console.log("[SOCKET] connect_error", err));
    socket.on("disconnect", (reason) => console.log("[SOCKET] disconnect", reason));

    // -------------------------
    // サーバイベント
    // -------------------------
    socket.on("login_ok", (data) => {
      console.log("[SOCKET] login_ok", data);
      setUser(data.user);
      setHistory(data.history || []);
      setLoggedIn(true);
    });

    socket.on("matched", (data) => {
      console.log("[SOCKET] matched", data);
      setOpponent(data.opponent);
      setDeskNum(data.deskNum);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
    });

    socket.on("history", (data) => setHistory(data || []));
    socket.on("update_lottery_list", (data) => setLotteryResults(data || []));
    socket.on("admin_lottery_history", (data) => setLotteryHistory(data || []));

    socket.on("admin_active_matches", (data) => setDesks(data || []));
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("管理者パスワードが違います"));

    return () => {
      socket.disconnect();
    };
  }, []);

  // -------------------------
  // ハンドラ関数
  // -------------------------
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");

    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      alert("通信がまだ接続されていません。少し待って再度試してください。");
      return;
    }

    const saved = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } })();
    const sessionId = saved?.sessionId || localStorage.getItem("sessionId");
    const recentOpponents = saved?.recentOpponents || [];

    console.log("[LOGIN] emitting login", trimmedName);
    socket.emit("login", { name: trimmedName, sessionId, history, recentOpponents });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    const socket = socketRef.current;
    socket.emit("admin_login", { password: adminPassword });
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    const socket = socketRef.current;
    socket.emit("logout");
    localStorage.clear();
    setUser(null); setLoggedIn(false);
    setOpponent(null); setDeskNum(null);
    setAdminMode(false);
  };

  const handleFindOpponent = () => {
    const socket = socketRef.current;
    if (!matchEnabled || !socket.connected) return;
    setSearching(true);
    socket.emit("find_opponent");
  };

  const handleCancelSearch = () => {
    const socket = socketRef.current;
    setSearching(false);
    socket.emit("cancel_find");
  };

  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    const socket = socketRef.current;
    socket.emit("report_win_request");
  };

  const handleAdminWin = (deskNum) => {
    if (!window.confirm("この部屋の勝者を登録しますか？")) return;
    const socket = socketRef.current;
    socket.emit("admin_report_win", { deskNum });
  };

  const handleForceClearDesk = (deskNum) => {
    if (!window.confirm("この卓を削除しますか？")) return;
    const socket = socketRef.current;
    socket.emit("admin_delete_desk", { deskNum });
  };

  const handleRunLottery = () => {
    if (!lotteryTitle) return alert("抽選タイトルを入力してください");
    const socket = socketRef.current;
    socket.emit("admin_draw_lots", { title: lotteryTitle, count: lotteryCount });
  };

  const handleLogoutAdmin = () => {
    if (!window.confirm("管理者ログアウトしますか？")) return;
    setAdminMode(false);
  };

  // -------------------------
  // JSX
  // -------------------------
  return (
    <div className="app">
      {/* 右上管理者ログイン */}
      {!adminMode && !loggedIn && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="Admin PW"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>Admin</button>
        </div>
      )}

      {/* ユーザーログイン画面 */}
      {!loggedIn && (
        <div className="user-login-center">
          <h2>ユーザー名を入力</h2>
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {loggedIn && user && (
        <div className="user-menu">
          <h2>ようこそ {user.name} さん</h2>
          <p>勝ち：{history.filter(h => h.result === "WIN").length}</p>
          <p>負け：{history.filter(h => h.result === "LOSE").length}</p>

          {!opponent && (
            <div>
              {!searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>マッチング開始</button>
              ) : (
                <button className="main-btn" onClick={handleCancelSearch}>キャンセル</button>
              )}
            </div>
          )}

          {opponent && (
            <div>
              <h3>対戦相手：{opponent.name}</h3>
              <p>卓番号：{deskNum}</p>
              <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
            </div>
          )}

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <div className="admin-controls">
            <button onClick={handleLogoutAdmin}>ログアウト</button>
          </div>

          <div className="desk-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? <p>現在稼働中の卓はありません</p> :
              <ul>
                {desks.map((d, i) => (
                  <li key={i}>
                    <strong>卓 {d.deskNum}</strong>：{d.players?.map(p => p.name).join(" vs ")}
                    <button onClick={() => handleAdminWin(d.deskNum)}>勝者登録</button>
                    <button onClick={() => handleForceClearDesk(d.deskNum)}>卓削除</button>
                  </li>
                ))}
              </ul>
            }
          </div>

          <div className="lottery-admin-section">
            <h3>抽選機能</h3>
            <input
              type="text"
              placeholder="抽選タイトル"
              value={lotteryTitle}
              onChange={(e) => setLotteryTitle(e.target.value)}
            />
            <input
              type="number"
              placeholder="当選人数"
              value={lotteryCount}
              onChange={(e) => setLotteryCount(Number(e.target.value))}
            />
            <button onClick={handleRunLottery}>抽選を実行</button>

            <div className="lottery-history">
              <h4>抽選履歴</h4>
              {lotteryHistory.length === 0 ? <p>抽選履歴なし</p> :
                <ul>
                  {lotteryHistory.map((entry, idx) => (
                    <li key={idx}>
                      <strong>{entry.title}</strong>
                      <ul>
                        {entry.winners?.map((w, i) => <li key={i}>{w.name}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
