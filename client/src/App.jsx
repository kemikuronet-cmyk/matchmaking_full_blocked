import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "/";
export default function App() {
  const socketRef = useRef(null);

  // ------------------------
  // ユーザー情報
  // ------------------------
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);

  // ------------------------
  // 管理者
  // ------------------------
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminMatchStatus, setAdminMatchStatus] = useState("停止中");
  const [desks, setDesks] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);

  // ------------------------
  // 初回マウント
  // ------------------------
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => console.log("✅ Connected:", socket.id));

    // ログイン成功
    socket.on("login_ok", (data) => {
      setUser({ name: data.name, id: data.id, sessionId: data.sessionId });
      setLoggedIn(true);
      setHistory(data.history || []);
      setDeskNum(data.deskNum || null);
      setOpponent(data.opponent || null);
      setMatchEnabled(data.matchEnabled ?? false);

      localStorage.setItem(
        "user",
        JSON.stringify({ name: data.name, sessionId: data.sessionId })
      );
    });

    // マッチング更新
    socket.on("match_status_update", ({ enabled, status }) => {
      setMatchEnabled(enabled);
      setAdminMatchStatus(status);
    });

    // マッチング成功
    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });

    // 対戦卓終了
    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    // 対戦履歴更新
    socket.on("history", (hist) => setHistory(hist));

    // 抽選
    socket.on("update_lottery_list", ({ list }) => {
      // 最新当選者
      setLotteryHistory((prev) => [...prev.filter(r => r.time !== list.time), ...list]);
    });
    socket.on("lottery_winner", ({ title }) => alert(`🎉「${title}」に当選しました！`));

    // 管理者
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("管理者パスワードが違います"));
    socket.on("admin_active_matches", (list) => setDesks(list));
    socket.on("admin_lottery_history", (list) => setLotteryHistory(list));

    // セッション復元
    const saved = JSON.parse(localStorage.getItem("user") || "{}");
    if (saved?.name && saved?.sessionId) {
      setName(saved.name);
      socket.emit("login", saved);
    }

    return () => socket.disconnect();
  }, []);

  // ------------------------
  // ログイン / ログアウト
  // ------------------------
  const handleLogin = () => {
    if (!name.trim()) return alert("ユーザー名を入力してください");
    const saved = JSON.parse(localStorage.getItem("user") || "{}");
    socketRef.current.emit("login", { name: name.trim(), sessionId: saved?.sessionId });
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

  // ------------------------
  // マッチング操作
  // ------------------------
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
  // 管理者操作
  // ------------------------
  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socketRef.current.emit("admin_login", { password: adminPassword });
  };
  const adminStartMatching = () => socketRef.current.emit("admin_enable_matching");
  const adminStopMatching = () => socketRef.current.emit("admin_disable_matching");
  const adminRunLottery = () => {
    if (!lotteryTitle || lotteryCount <= 0) return alert("タイトルと人数を正しく設定してください");
    socketRef.current.emit("admin_run_lottery", { title: lotteryTitle, count: lotteryCount });
    setLotteryTitle("");
    setLotteryCount(1);
  };

  // ------------------------
  // JSX
  // ------------------------
  return (
    <div className="app">

      {/* ユーザー画面 */}
      {!loggedIn && !adminMode && (
        <div className="login-screen user-login-center">
          <h2>ログイン</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ユーザー名" />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
      )}

      {loggedIn && !adminMode && user && (
        <div className="menu-screen">
          <h2>{user.name} さん</h2>

          {/* マッチングボタン */}
          {!opponent && !deskNum && (
            <div className="button-row">
              {matchEnabled ? (
                !searching ? (
                  <button className="main-btn" onClick={handleFindOpponent}>対戦相手を探す</button>
                ) : (
                  <button className="main-btn" onClick={handleCancelSearch}>対戦相手を探しています…</button>
                )
              ) : (
                <span>マッチング時間外です</span>
              )}
            </div>
          )}

          {/* 対戦中 */}
          {opponent && (
            <div className="battle-screen">
              <h3>対戦相手：{opponent.name}</h3>
              <p>卓番号：{deskNum}</p>
              <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
            </div>
          )}

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>

          {/* 対戦履歴 */}
          <details style={{ marginTop: 10 }}>
            <summary>対戦履歴</summary>
            {history.length === 0 ? <p>対戦履歴なし</p> : (
              <ul>
                {history.map((h, i) => <li key={i}><strong>{h.opponent}</strong>：{h.result}</li>)}
              </ul>
            )}
          </details>

          {/* 抽選履歴 */}
          <details style={{ marginTop: 10 }}>
            <summary>抽選履歴</summary>
            {lotteryHistory.length === 0 ? <p>抽選履歴なし</p> : (
              <ul>
                {lotteryHistory.map((entry, idx) => (
                  <li key={idx}>
                    <strong>{entry.title}</strong>：
                    {entry.winners?.map((w, i) => <span key={i}>{w.name}{i<entry.winners.length-1?", ":""}</span>)}
                  </li>
                ))}
              </ul>
            )}
          </details>
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
            <h3>マッチング操作（現在: {adminMatchStatus}）</h3>
            <div className="button-row">
              <button className="main-btn" onClick={adminStartMatching}>開始</button>
              <button className="main-btn" onClick={adminStopMatching}>停止</button>
            </div>
          </div>

          {/* 抽選操作 */}
          <div className="admin-section">
            <h3>抽選操作</h3>
            <input placeholder="抽選タイトル" value={lotteryTitle} onChange={e=>setLotteryTitle(e.target.value)} />
            <input type="number" placeholder="当選人数" value={lotteryCount} min={1} onChange={e=>setLotteryCount(Number(e.target.value))} />
            <div className="button-row">
              <button className="main-btn" onClick={adminRunLottery}>抽選実行</button>
            </div>
          </div>

          {/* 対戦卓一覧 */}
          <div className="admin-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? <p>現在稼働中の卓はありません</p> : (
              <div className="table-list">
                {desks.map((d,i) => (
                  <div key={i} className="table-item">
                    <strong>卓 {d.deskNum}</strong>：{d.player1} vs {d.player2}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 抽選履歴 */}
          <div className="admin-section">
            <h3>抽選履歴</h3>
            <ul className="lottery-list">
              {lotteryHistory.map((rec, i)=>(
                <li key={i}>
                  {rec.title}（{new Date(rec.time).toLocaleString()}）：{rec.winners?.map(w=>w.name).join(", ")}
                </li>
              ))}
            </ul>
          </div>

        </div>
      )}

      {/* 管理者ログイン（非表示ユーザー画面） */}
      {!adminMode && !loggedIn && (
        <div className="admin-login-topright">
          <input type="password" placeholder="Admin Pass" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} />
          <button onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      )}
    </div>
  );
}
