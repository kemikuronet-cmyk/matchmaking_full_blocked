import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

// サーバーURL（本番用）
const SERVER_URL = "/";

export default function App() {
  const socketRef = useRef(null);
  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

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
  const [lotteryResults, setLotteryResults] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [matchEnabled, setMatchEnabled] = useState(false);

  // ------------------------
  // 初回マウント時
  // ------------------------
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    // ------------------------
    // socket ハンドラ
    // ------------------------
    socket.on("connect", () => {
      console.log("✅ Connected:", socket.id);
    });

    socket.on("login_ok", (data) => {
      console.log("✅ login_ok", data);
      setUser({ name: data.name, id: data.id, sessionId: data.sessionId });
      setName(data.name);
      setLoggedIn(true);
      setHistory(data.history || []);
      setDeskNum(data.deskNum || null);
      setOpponent(data.opponent || null);
      setMatchEnabled(data.matchEnabled ?? false);

      // localStorage に保存
      try {
        localStorage.setItem("user", JSON.stringify({
          name: data.name,
          sessionId: data.sessionId,
          recentOpponents: data.recentOpponents || [],
          history: data.history || []
        }));
      } catch {}
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      console.log("✅ matched", opponent, deskNum);
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      console.log("✅ return_to_menu_battle");
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    socket.on("history", (hist) => {
      console.log("✅ history update", hist);
      setHistory(hist);
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    // 管理者
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("管理者パスワードが違います"));
    socket.on("admin_user_list", (list) => console.log("admin_user_list", list));
    socket.on("admin_active_matches", (list) => setDesks(list));
    socket.on("admin_draw_result", ({ title, winners }) => {
      setLotteryResults(prev => [...prev, { title, winners }]);
    });
    socket.on("admin_lottery_history", (list) => setLotteryHistory(list));
    socket.on("update_lottery_list", ({ list }) => setLotteryResults(list));

    // ------------------------
    // heartbeat
    // ------------------------
    heartbeatTimer.current = setInterval(() => {
      const userData = JSON.parse(localStorage.getItem("user") || "{}");
      if (userData?.sessionId) socket.emit("heartbeat", { sessionId: userData.sessionId });
    }, 30000);

    // ------------------------
    // 画面初期化時に localStorage から復元
    // ------------------------
    const saved = JSON.parse(localStorage.getItem("user") || "{}");
    if (saved?.name && saved?.sessionId) {
      setName(saved.name);
      socket.emit("login", saved);
    }

    return () => {
      // cleanup
      socket.disconnect();
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);
    };
  }, []);

  // ------------------------
  // ハンドラ
  // ------------------------
  const handleLogin = () => {
    const trimmed = name.trim();
    if (!trimmed) return alert("ユーザー名を入力してください");
    const saved = JSON.parse(localStorage.getItem("user") || "{}");
    const sessionId = saved?.sessionId;
    socketRef.current.emit("login", { name: trimmed, sessionId, recentOpponents: saved?.recentOpponents || [], history: saved?.history || [] });
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

  return (
  <div className="app-wrapper">
    
    {/* 管理者右上 */}
    {!adminMode && (
      <div className="admin-login-badge">
        <input
          type="password"
          placeholder="Admin Pass"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
        />
        <div className="admin-login-panel">
          <button onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      </div>
    )}

    {/* ログイン画面 */}
    {!loggedIn && !adminMode && (
      <div className="container">
        <h2>ログイン</h2>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ユーザー名"
        />

        <div className="button-row">
          <button onClick={handleLogin}>ログイン</button>
        </div>
      </div>
    )}

    {/* ユーザー画面 */}
    {loggedIn && !adminMode && user && (
      <div className="container">

        <div className="user-welcome">
          {user.name} さん
        </div>

        {!opponent && !deskNum && (
          <div className="button-row">
            {!searching ? (
              <button onClick={handleFindOpponent}>マッチング開始</button>
            ) : (
              <button onClick={handleCancelSearch}>キャンセル</button>
            )}
          </div>
        )}

        {opponent && (
          <div className="section-box">
            <h3>対戦中</h3>
            <p><strong>対戦相手：</strong>{opponent.name}</p>
            <p><strong>卓番号：</strong>{deskNum}</p>

            <div className="button-row">
              <button onClick={handleWinReport}>勝利報告</button>
            </div>
          </div>
        )}

        <div className="button-row">
          <button onClick={handleLogout}>ログアウト</button>
        </div>

        <div className="section-box">
          <div className="section-header">
            <span>対戦履歴</span>
          </div>

          {history.length === 0 ? (
            <p>対戦履歴なし</p>
          ) : (
            <ul>
              {history.map((h, i) => (
                <li key={i}>
                  <strong>{h.opponent}</strong>：{h.result}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="section-box">
          <div className="section-header">
            <span>抽選履歴</span>
          </div>

          {lotteryHistory.length === 0 ? (
            <p>抽選履歴なし</p>
          ) : (
            <ul>
              {lotteryHistory.map((entry, idx) => (
                <li key={idx}>
                  <strong>{entry.title}</strong>
                  <ul>
                    {entry.winners?.map((w, i) => (
                      <li key={i}>{w.name}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )}

    {/* 管理者画面 */}
    {adminMode && (
      <div className="container">
        <h2>管理者メニュー</h2>

        <div className="button-row">
          <button onClick={() => setAdminMode(false)}>ログアウト</button>
        </div>

        <h3>対戦卓一覧</h3>

        {desks.length === 0 ? (
          <p>現在稼働中の卓はありません</p>
        ) : (
          <div className="table-list">
            {desks.map((d, i) => (
              <div key={i} className="table-item">
                <strong>卓 {d.deskNum}</strong>
                ：{d.player1} vs {d.player2}

                <div className="table-actions">
                  <button
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

        <div className="section-box">
          <h3>抽選履歴</h3>
          <ul>
            {lotteryHistory.map((rec, i) => (
              <li key={i}>
                {rec.title}（{new Date(rec.time).toLocaleString()}）：
                {rec.winners.map((w) => w.name).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      </div>
    )}
  </div>
);
}
