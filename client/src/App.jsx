import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "/";

export default function App() {
  const socketRef = useRef(null);
  const heartbeatTimer = useRef(null);

  // ------------------------
  // ステート
  // ------------------------
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [searching, setSearching] = useState(false);

  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [desks, setDesks] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);

  // ------------------------
  // 初回マウント
  // ------------------------
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => console.log("✅ Connected:", socket.id));

    socket.on("login_ok", (data) => {
      setUser({ name: data.name, id: data.id, sessionId: data.sessionId });
      setName(data.name);
      setLoggedIn(true);
      setHistory(data.history || []);
      setDeskNum(data.deskNum || null);
      setOpponent(data.opponent || null);
      setMatchEnabled(data.matchEnabled ?? false);

      try {
        localStorage.setItem(
          "user",
          JSON.stringify({
            name: data.name,
            sessionId: data.sessionId,
            recentOpponents: data.recentOpponents || [],
            history: data.history || [],
          })
        );
      } catch {}
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    socket.on("history", (hist) => setHistory(hist));

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("管理者パスワードが違います"));
    socket.on("admin_active_matches", (list) => setDesks(list));
    socket.on("admin_lottery_history", (list) => setLotteryHistory(list));

    heartbeatTimer.current = setInterval(() => {
      const userData = JSON.parse(localStorage.getItem("user") || "{}");
      if (userData?.sessionId) socket.emit("heartbeat", { sessionId: userData.sessionId });
    }, 30000);

    const saved = JSON.parse(localStorage.getItem("user") || "{}");
    if (saved?.name && saved?.sessionId) {
      setName(saved.name);
      socket.emit("login", saved);
    }

    return () => {
      socket.disconnect();
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    };
  }, []);

  // ------------------------
  // ハンドラ
  // ------------------------
  const handleLogin = () => {
    const trimmed = name.trim();
    if (!trimmed) return alert("ユーザー名を入力してください");
    const saved = JSON.parse(localStorage.getItem("user") || "{}");
    socketRef.current.emit("login", {
      name: trimmed,
      sessionId: saved?.sessionId,
      recentOpponents: saved?.recentOpponents || [],
      history: saved?.history || [],
    });
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
    setOpponent(null);
    setDeskNum(null);
    setHistory([]);
    setName("");
    localStorage.removeItem("user");
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

  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socketRef.current.emit("report_win_request");
  };

  // ------------------------
  // メイン JSX
  // ------------------------
  return (
    <div className="app">

      {/* 管理者ログイン右上 */}
      {!adminMode && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="Admin Pass"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      )}

      {/* ログイン画面 */}
      {!loggedIn && !adminMode && (
        <div className="login-screen user-login-center">
          <h2>ログイン</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ユーザー名" />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {loggedIn && !adminMode && user && (
        <div className="menu-screen">
          <h2>{user.name} さん</h2>

          {!opponent && !deskNum && (
            <div className="button-row">
              {!searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>マッチング開始</button>
              ) : (
                <button className="main-btn" onClick={handleCancelSearch}>キャンセル</button>
              )}
            </div>
          )}

          {opponent && (
            <div className="battle-screen">
              <h3>対戦相手：{opponent.name}</h3>
              <p>卓番号：{deskNum}</p>
              <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
            </div>
          )}

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>

          {history.length > 0 && (
            <div className="history-list">
              <h3>対戦履歴</h3>
              <table>
                <thead>
                  <tr>
                    <th>対戦相手</th>
                    <th>結果</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className={h.result === "勝ち" ? "win" : "lose"}>
                      <td>{h.opponent}</td>
                      <td>{h.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-screen">

          <h2>管理者メニュー</h2>
          <div className="button-row">
            <button className="admin-btn" onClick={() => setAdminMode(false)}>ログアウト</button>
          </div>

          {/* マッチング操作 */}
          <div className="admin-section">
            <h3>マッチング操作</h3>
            <div className="button-row">
              <button
                className="main-btn"
                onClick={() => socketRef.current.emit("admin_enable_matching")}
              >
                マッチング開始
              </button>
              <button
                className="main-btn"
                onClick={() => socketRef.current.emit("admin_disable_matching")}
              >
                マッチング停止
              </button>
            </div>
          </div>

          {/* 抽選操作 */}
          <div className="admin-section">
            <h3>抽選操作</h3>
            <div className="button-row">
              <button
                className="main-btn"
                onClick={() => socketRef.current.emit("admin_run_lottery")}
              >
                抽選実行
              </button>
            </div>
          </div>

          {/* 対戦卓一覧 */}
          <div className="admin-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? (
              <p>現在稼働中の卓はありません</p>
            ) : (
              <div className="table-list">
                {desks.map((d, i) => (
                  <div key={i} className="table-item">
                    <strong>卓 {d.deskNum}</strong>：{d.player1} vs {d.player2}
                    <div className="button-row">
                      <button
                        className="main-btn"
                        onClick={() =>
                          socketRef.current.emit("admin_report_win", {
                            winnerSessionId: d.player1SessionId,
                            deskNum: d.deskNum,
                          })
                        }
                      >
                        勝者登録
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 抽選履歴 */}
          <div className="admin-section">
            <h3>抽選履歴</h3>
            <ul className="lottery-list">
              {lotteryHistory.map((rec, i) => (
                <li key={i}>
                  {rec.title}（{new Date(rec.time).toLocaleString()}）：{rec.winners?.map(w => w.name).join(", ")}
                </li>
              ))}
            </ul>
          </div>

        </div>
      )}

    </div>
  );
}
