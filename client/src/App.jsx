import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SERVER_URL = "/"; // 本番は同ドメイン
const AUTO_RECONNECT_INTERVAL = 30000; // 30秒

const socket = io(SERVER_URL, { autoConnect: false });

function App() {
  // -------------------------
  // 状態管理
  // -------------------------
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [lotteryResults, setLotteryResults] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);

  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------------
  // 初回接続 & heartbeat
  // -------------------------
  useEffect(() => {
    socket.connect();

    socket.on("connect", () => {
      console.log("✅ Connected to server", socket.id);
      if (user?.sessionId) {
        socket.emit("login", {
          name: user.name,
          sessionId: user.sessionId,
          recentOpponents: user.recentOpponents,
          history: user.history,
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("❌ Disconnected");
    });

    socket.on("login_ok", (data) => {
      console.log("login_ok", data);
      setUser(data);
      setLoggedIn(true);
      setHistory(data.history || []);
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));
    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });
    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
    });
    socket.on("history", (h) => setHistory(h));
    socket.on("update_lottery_list", ({ list }) => setLotteryResults(list));
    socket.on("lottery_winner", ({ title }) => alert(`抽選「${title}」で当選しました！`));
    socket.on("admin_lottery_history", (history) => setLotteryHistory(history));

    heartbeatTimer.current = setInterval(() => {
      if (user?.sessionId) socket.emit("heartbeat", { sessionId: user.sessionId });
    }, 30000);

    reconnectIntervalRef.current = setInterval(() => {
      if (!socket.connected) socket.connect();
    }, AUTO_RECONNECT_INTERVAL);

    return () => {
      socket.off();
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);
    };
  }, [user]);

  // -------------------------
  // ハンドラ
  // -------------------------
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem("user") || "{}");
      } catch {
        return {};
      }
    })();
    const sessionId = saved?.sessionId || localStorage.getItem("sessionId");
    const recentOpponents = saved?.recentOpponents || [];
    socket.emit("login", { name: trimmedName, sessionId, recentOpponents, history });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socket.emit("admin_login", { password: adminPassword });
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("管理者パスワードが間違っています"));
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.clear();
    setUser(null);
    setLoggedIn(false);
    setSearching(false);
    setOpponent(null);
    setDeskNum(null);
    setHistory([]);
    setLotteryHistory([]);
    setLotteryResults([]);
    setName("");
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
    socket.emit("report_win_request");
  };

  const drawLottery = (count, minBattles, minLoginMinutes, title) => {
    socket.emit("admin_draw_lots", { count, minBattles, minLoginMinutes, title });
  };

  // -------------------------
  // JSX
  // -------------------------
  return (
    <div className="app">
      {/* 背景はCSSで制御 */}

      {/* 管理者ログイン右上 */}
      {!adminMode && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="Admin Pass"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>Admin</button>
        </div>
      )}

      {/* ユーザーログイン */}
      {!loggedIn && (
        <div className="user-login-center">
          <h2>ユーザー ログイン</h2>
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={handleLogin} className="main-btn">
            ログイン
          </button>
        </div>
      )}

      {/* ユーザーメニュー */}
      {loggedIn && user && !adminMode && (
        <div className="menu-screen">
          <h2>ようこそ {user.name} さん</h2>
          <p>勝ち: {user.wins || 0}</p>
          <p>負け: {user.losses || 0}</p>
          <p>対戦数: {user.totalBattles || 0}</p>

          {!opponent && !deskNum && (
            <div>
              {!searching ? (
                <button onClick={handleFindOpponent} className="main-btn">
                  マッチング開始
                </button>
              ) : (
                <button onClick={handleCancelSearch} className="main-btn">
                  検索キャンセル
                </button>
              )}
            </div>
          )}

          {opponent && (
            <div>
              <h3>対戦相手: {opponent.name}</h3>
              <p>卓番号: {deskNum}</p>
              <button onClick={handleWinReport} className="main-btn">
                勝利報告
              </button>
            </div>
          )}

          <div>
            <h3>対戦履歴</h3>
            {history.length === 0 ? <p>履歴なし</p> : (
              <ul>
                {history.map((h, i) => (
                  <li key={i}>{h.opponent}: {h.result}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>抽選履歴</h3>
            {lotteryHistory.length === 0 ? <p>なし</p> : (
              <ul>
                {lotteryHistory.map((rec, i) => (
                  <li key={i}>
                    {rec.title} ({new Date(rec.time).toLocaleString()}): {rec.winners.map(w => w.name).join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button onClick={handleLogout} className="main-btn">ログアウト</button>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>
          <div>
            <h3>抽選履歴</h3>
            <ul>
              {lotteryHistory.map((rec, i) => (
                <li key={i}>
                  {rec.title} ({new Date(rec.time).toLocaleString()}): {rec.winners.map(w => w.name).join(", ")}
                </li>
              ))}
            </ul>
            <button onClick={() => drawLottery(1, 0, 0, "抽選テスト")}>抽選実行</button>
          </div>
          <button onClick={() => setAdminMode(false)} className="main-btn">ログアウト</button>
        </div>
      )}
    </div>
  );
}

export default App;
