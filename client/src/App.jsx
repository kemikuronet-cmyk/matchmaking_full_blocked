import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "wss://kemikurohuanibentorandamumatsuchingutsur.onrender.com";

const socket = io(SERVER_URL, {
  transports: ["websocket"],
  autoConnect: false,
});

function App() {
  // -------------------------
  // State
  // -------------------------
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [history, setHistory] = useState([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [searching, setSearching] = useState(false);

  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [desks, setDesks] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [lotteryResults, setLotteryResults] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);

  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------------
  // Socket.io 接続
  // -------------------------
  useEffect(() => {
    socket.connect();
    console.log("[SOCKET] connecting...");

    // -------------------------
    // イベントリスナー
    // -------------------------
    const onConnect = () => console.log("[SOCKET] connected");
    const onDisconnect = (reason) =>
      console.log("[SOCKET] disconnected", reason);

    const onLoginOk = (data) => {
      console.log("[SOCKET] login_ok:", data);
      setUser(data.user || {});
      setHistory(data.history || []);
      setLoggedIn(true);
    };

    const onMatched = (data) => {
      console.log("[SOCKET] matched:", data);
      setOpponent(data.opponent);
      setDeskNum(data.deskNum);
      setSearching(false);
    };

    const onReturnToMenu = () => {
      console.log("[SOCKET] return_to_menu_battle");
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    };

    const onLotteryWinner = (data) => {
      console.log("[SOCKET] lottery_winner:", data);
      setLotteryResults((prev) => [...prev, data]);
      setLotteryHistory((prev) => [...prev, data]);
    };

    // 管理者イベント
    const onAdminOk = () => setAdminMode(true);
    const onAdminActiveMatches = (data) => setDesks(data);
    const onAdminLotteryHistory = (data) => setLotteryHistory(data);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("lottery_winner", onLotteryWinner);
    socket.on("admin_ok", onAdminOk);
    socket.on("admin_active_matches", onAdminActiveMatches);
    socket.on("admin_lottery_history", onAdminLotteryHistory);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("lottery_winner", onLotteryWinner);
      socket.off("admin_ok", onAdminOk);
      socket.off("admin_active_matches", onAdminActiveMatches);
      socket.off("admin_lottery_history", onAdminLotteryHistory);

      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);
    };
  }, []);

  // -------------------------
  // ハンドラ
  // -------------------------
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    console.log("[ACTION] login emit:", trimmedName);
    socket.emit("login", { name: trimmedName });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socket.emit("admin_login", { password: adminPassword });
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    setUser(null);
    setLoggedIn(false);
    setOpponent(null);
    setDeskNum(null);
    setHistory([]);
    setName("");
    setSearching(false);
    setAdminMode(false);
  };

  const handleFindOpponent = () => {
    if (!user) return alert("ログインしてください");
    setSearching(true);
    socket.emit("find_opponent");
  };

  const handleCancelSearch = () => {
    setSearching(false);
    socket.emit("cancel_find");
  };

  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socket.emit("report_win_request");
  };

  const handleFetchDesks = () => socket.emit("admin_get_active_matches");
  const handleRunLottery = () => socket.emit("admin_draw_lots", { count: lotteryCount, title: lotteryTitle });
  const handleAdminWin = (deskNum) => socket.emit("admin_report_win", { deskNum });

  // -------------------------
  // ユーザー集計
  // -------------------------
  const userWins = (history || []).filter((h) => h.result === "WIN").length;
  const userLosses = (history || []).filter((h) => h.result === "LOSE").length;
  const userMatches = (history || []).length;

  // -------------------------
  // JSX
  // -------------------------
  return (
    <div className="app">
      {/* -------------------- 管理者ログイン右上 -------------------- */}
      {!adminMode && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="管理者パスワード"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>Admin Login</button>
        </div>
      )}

      {/* -------------------- ログイン画面 -------------------- */}
      {!loggedIn && !adminMode && (
        <div className="user-login-center">
          <h2>ユーザーログイン</h2>
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="main-btn" onClick={handleLogin}>
            ログイン
          </button>
        </div>
      )}

      {/* -------------------- ユーザーメニュー -------------------- */}
      {loggedIn && (
        <div className="user-menu">
          <h2>ようこそ {user?.name || "ユーザー"} さん</h2>

          <div className="user-stats">
            <p>勝ち：{user?.wins ?? userWins}</p>
            <p>負け：{user?.losses ?? userLosses}</p>
            <p>対戦数：{user?.totalBattles ?? userMatches}</p>
          </div>

          {!opponent && !deskNum && (
            <div className="match-controls">
              {!searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>
                  マッチング開始
                </button>
              ) : (
                <button className="cancel-btn" onClick={handleCancelSearch}>
                  キャンセル
                </button>
              )}
            </div>
          )}

          {opponent && (
            <div className="battle-info">
              <h3>対戦相手：{opponent?.name}</h3>
              <p>卓番号：{deskNum}</p>
              <button className="win-btn" onClick={handleWinReport}>
                勝利報告
              </button>
            </div>
          )}

          <div className="history-section">
            <h3>対戦履歴</h3>
            {history.length === 0 ? (
              <p>対戦履歴がありません</p>
            ) : (
              <ul className="history-list">
                {history.map((h, i) => (
                  <li key={i}>
                    <strong>{h.opponent}</strong>：{h.result}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button className="main-btn" onClick={handleLogout}>
              ログアウト
            </button>
          </div>
        </div>
      )}

      {/* -------------------- 管理者メニュー -------------------- */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <div className="admin-controls">
            <button onClick={handleFetchDesks}>卓一覧を更新</button>
          </div>

          <div className="desk-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? (
              <p>現在、稼働中の卓はありません</p>
            ) : (
              <ul className="desk-list">
                {desks.map((d, i) => (
                  <li key={i}>
                    <strong>卓 {d.deskNum}</strong>：{d.players?.map((p) => p.name).join(" vs ")}
                    <button onClick={() => handleAdminWin(d.deskNum)}>勝者登録</button>
                  </li>
                ))}
              </ul>
            )}
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
              {lotteryHistory.length === 0 ? (
                <p>抽選履歴なし</p>
              ) : (
                <ul>
                  {lotteryHistory.map((lot, idx) => (
                    <li key={idx}>
                      <strong>{lot.title}</strong>
                      <ul>
                        {lot.winners?.map((w, i) => (
                          <li key={i}>{w.name}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <button className="logout-btn" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
