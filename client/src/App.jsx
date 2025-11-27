import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

// サーバURL
const SERVER_URL = "/";
const AUTO_RECONNECT_INTERVAL = 30000; // 30秒ごとに再接続チェック

export default function App() {
  // -----------------------------
  // 状態管理
  // -----------------------------
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [matchStatus, setMatchStatus] = useState({ enabled: false });
  const [lotteryList, setLotteryList] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");

  const sessionIdRef = useRef(null);
  const reconnectTimer = useRef(null);

  // -----------------------------
  // 初期化
  // -----------------------------
  useEffect(() => {
    // sessionId 保存／生成
    let savedSessionId = localStorage.getItem("sessionId");
    if (!savedSessionId) {
      savedSessionId = crypto.randomUUID();
      localStorage.setItem("sessionId", savedSessionId);
    }
    sessionIdRef.current = savedSessionId;

    // Socket.io 接続
    const s = io(SERVER_URL, { reconnection: true });
    setSocket(s);

    // -----------------------------
    // Socket.io イベント
    // -----------------------------
    s.on("connect", () => {
      console.log("✅ Connected to server", s.id);
      if (user?.name) {
        s.emit("login", { name: user.name, sessionId: sessionIdRef.current });
      }
    });

    s.on("login_ok", (data) => setUser(data));
    s.on("match_status", (data) => setMatchStatus(data));
    s.on("update_lottery_list", ({ list }) => setLotteryList(list));
    s.on("admin_ok", () => setAdminLoggedIn(true));
    s.on("admin_fail", () => alert("管理者パスワードが違います"));
    s.on("admin_user_list", (list) => setUsersList(list));

    // -----------------------------
    // 長時間維持対応（自動再接続）
    // -----------------------------
    reconnectTimer.current = setInterval(() => {
      if (!s.connected) {
        console.log("Socket disconnected. Attempting reconnect...");
        s.connect();
      }
    }, AUTO_RECONNECT_INTERVAL);

    return () => {
      clearInterval(reconnectTimer.current);
      s.disconnect();
    };
  }, [user?.name]);

  // -----------------------------
  // ユーザーログイン
  // -----------------------------
  const handleLogin = (name) => {
    if (!name.trim()) return;
    setUser({ ...user, name });
    socket?.emit("login", { name, sessionId: sessionIdRef.current });
  };

  // -----------------------------
  // 対戦操作
  // -----------------------------
  const findOpponent = () => {
    socket?.emit("find_opponent");
  };

  const cancelFind = () => {
    socket?.emit("cancel_find");
  };

  const reportWin = () => {
    socket?.emit("report_win_request");
  };

  const confirmOpponentWin = (accepted) => {
    socket?.emit("opponent_win_confirmed", { accepted });
  };

  const logout = () => {
    socket?.emit("logout");
    setUser(null);
  };

  // -----------------------------
  // 管理者操作
  // -----------------------------
  const handleAdminLogin = () => {
    socket?.emit("admin_login", { password: adminPassword });
  };

  const toggleMatch = (enable) => {
    socket?.emit("admin_toggle_match", { enable });
  };

  const drawLottery = ({ count, minBattles, minLoginMinutes, title }) => {
    socket?.emit("admin_draw_lots", { count, minBattles, minLoginMinutes, title });
  };

  const viewUsers = () => {
    socket?.emit("admin_view_users");
  };

  // -----------------------------
  // ユーザーリスト・表示更新
  // -----------------------------
  const renderUsersList = () => {
    return (
      <ul>
        {usersList.map(u => (
          <li key={u.sessionId}>{u.name} - {u.status}</li>
        ))}
      </ul>
    );
  };

  // ==============================
  // JSX（UI 本体）
  // ==============================
  return (
    <div className="app-container">

      {/* 背景 */}
      <div className="background" />

      {/* 未ログインならログイン画面 */}
      {!user ? (
        <div className="login-container">
          <h2>ユーザーログイン</h2>
          <input
            type="text"
            placeholder="名前を入力"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
          />

          <button className="main-btn" onClick={() => handleLogin(tempName)}>
            ログイン
          </button>

          <hr />

          {/* 管理者ログイン */}
          <h3>管理者ログイン</h3>
          <input
            type="password"
            placeholder="管理者パスワード"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button className="admin-btn" onClick={handleAdminLogin}>
            管理者ログイン
          </button>
        </div>
      ) : null}


      {/* ========================== */}
      {/* ★ 管理者モード */}
      {/* ========================== */}
      {isAdmin && (
        <div className="admin-panel">
          <h2>管理者パネル</h2>

          <button onClick={viewUsers} className="admin-sub-btn">
            ログイン中ユーザー一覧
          </button>

          <div className="user-list-box">{renderUsersList()}</div>

          <hr />

          <h3>マッチング管理</h3>
          <button onClick={() => toggleMatch(true)} className="enable-btn">
            マッチング ON
          </button>
          <button onClick={() => toggleMatch(false)} className="disable-btn">
            マッチング OFF
          </button>

          <hr />

          <h3>抽選機能</h3>

          <input
            type="text"
            placeholder="抽選タイトル"
            value={lotteryTitle}
            onChange={(e) => setLotteryTitle(e.target.value)}
          />

          <input
            type="number"
            placeholder="人数"
            value={lotteryCount}
            onChange={(e) => setLotteryCount(e.target.value)}
          />

          <input
            type="number"
            placeholder="最小試合数"
            value={lotteryMinBattles}
            onChange={(e) => setLotteryMinBattles(e.target.value)}
          />

          <input
            type="number"
            placeholder="最小ログイン分数"
            value={lotteryMinMinutes}
            onChange={(e) => setLotteryMinMinutes(e.target.value)}
          />

          <button
            className="lottery-btn"
            onClick={() =>
              drawLottery({
                title: lotteryTitle,
                count: Number(lotteryCount),
                minBattles: Number(lotteryMinBattles),
                minLoginMinutes: Number(lotteryMinMinutes),
              })
            }
          >
            抽選を実行
          </button>

          {/* 抽選結果 */}
          {lotteryResults.length > 0 && (
            <div className="lottery-results-box">
              <h3>抽選結果</h3>
              <ul>
                {lotteryResults.map((r, idx) => (
                  <li key={idx}>{r.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}


      {/* ========================== */}
      {/* ★ 一般ユーザー画面 */}
      {/* ========================== */}
      {user && !isAdmin && (
        <div className="user-menu">

          <h2>{user.name} さん</h2>

          <div className="stats">
            <p>対戦数：{stats.battles}</p>
            <p>勝利：{stats.wins}</p>
            <p>敗北：{stats.losses}</p>
          </div>

          <div className="menu-buttons">
            <button className="main-btn" onClick={findOpponent}>
              対戦相手を探す
            </button>

            <button className="cancel-btn" onClick={cancelFind}>
              マッチング取消
            </button>

            <button className="report-btn" onClick={reportWin}>
              勝利報告
            </button>
          </div>

          {/* 相手からの勝利報告 */}
          {winRequested && (
            <div className="win-confirm-box">
              <p>相手が勝利報告を申請しています。認めますか？</p>
              <button
                className="yes-btn"
                onClick={() => confirmOpponentWin(true)}
              >
                承認
              </button>
              <button
                className="no-btn"
                onClick={() => confirmOpponentWin(false)}
              >
                拒否
              </button>
            </div>
          )}

          <hr />

          {/* 対戦履歴 */}
          <h3>対戦履歴</h3>
          <div className="history-box">
            {stats.history?.length ? (
              <ul>
                {stats.history.map((h, idx) => (
                  <li key={idx}>
                    {h.opponent}：{h.result}
                  </li>
                ))}
              </ul>
            ) : (
              <p>対戦履歴はありません</p>
            )}
          </div>

          {/* 抽選表示（ユーザー側） */}
          {userLotteryResults.length > 0 && (
            <div className="lottery-box-user">
              <h3>管理者による抽選結果</h3>
              <ul>
                {userLotteryResults.map((v, idx) => (
                  <li key={idx}>{v}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ログアウト */}
          <button className="logout-btn" onClick={logout}>
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
