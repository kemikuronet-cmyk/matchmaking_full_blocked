import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "/";

export default function App() {
  const socketRef = useRef(null);

  // -------------------------
  // ユーザーセッション
  // -------------------------
  const [sessionId, setSessionId] = useState(
    localStorage.getItem("sessionId") || crypto.randomUUID()
  );
  const [name, setName] = useState(localStorage.getItem("name") || "");
  const [loggedIn, setLoggedIn] = useState(false);

  // -------------------------
  // マッチング・対戦
  // -------------------------
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [deskNum, setDeskNum] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [history, setHistory] = useState([]);

  // -------------------------
  // 抽選
  // -------------------------
  const [lotteryList, setLotteryList] = useState([]);

  // -------------------------
  // 管理者
  // -------------------------
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPass, setAdminPass] = useState("");
  const [activeMatches, setActiveMatches] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);

  // -------------------------
  // Socket 初期化
  // -------------------------
  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    // -------------------------
    // ユーザーログイン成功
    // -------------------------
    socket.on("login_ok", (data) => {
      setLoggedIn(true);
      setMatchEnabled(data.matchEnabled);
      setDeskNum(data.deskNum ?? null);
      setOpponent(data.opponent ?? null);
      setHistory(data.history || []);
      setLotteryList(data.lotteryList || []);
    });

    // -------------------------
    // マッチング
    // -------------------------
    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent.name);
      setDeskNum(deskNum);
    });

    socket.on("return_to_menu_battle", () => {
      setDeskNum(null);
      setOpponent(null);
    });

    socket.on("match_status_update", ({ enabled }) => {
      setMatchEnabled(enabled);
    });

    socket.on("update_lottery_list", ({ list }) => {
      setLotteryList(list || []);
    });

    // -------------------------
    // 管理者
    // -------------------------
    socket.on("admin_ok", () => setIsAdmin(true));
    socket.on("admin_fail", () => alert("管理者パスワードが違います"));
    socket.on("admin_active_matches", (desks) => setActiveMatches(desks || []));
    socket.on("admin_lottery_history", (hist) => setLotteryHistory(hist || []));
    socket.on("admin_lottery_result", (record) => alert(`抽選完了: ${record.title}`));

    return () => socket.disconnect();
  }, []);

  // -------------------------
  // ログイン処理
  // -------------------------
  const handleLogin = () => {
    if (!name) return alert("名前を入力してください");
    localStorage.setItem("name", name);
    localStorage.setItem("sessionId", sessionId);
    socketRef.current.emit("login", { name, sessionId });
  };

  // -------------------------
  // 対戦処理
  // -------------------------
  const findOpponent = () => socketRef.current.emit("find_opponent");
  const reportWin = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socketRef.current.emit("report_win_request");
  };

  // -------------------------
  // 管理者処理
  // -------------------------
  const adminLogin = () => socketRef.current.emit("admin_login", { password: adminPass });
  const enableMatch = () => socketRef.current.emit("admin_enable_matching");
  const disableMatch = () => socketRef.current.emit("admin_disable_matching");
  const runLottery = () =>
    socketRef.current.emit("admin_run_lottery", {
      title: lotteryTitle || "抽選",
      count: Number(lotteryCount) || 1,
    });

  // -------------------------
  // ログイン画面
  // -------------------------
  if (!loggedIn && !isAdmin) {
    return (
      <div className="container center">
        <h2>ログイン</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ユーザー名"
        />
        <button onClick={handleLogin}>ログイン</button>

        {/* 管理者ログイン：右下固定 */}
        <div className="admin-login-bottomright">
          <input
            type="password"
            placeholder="管理者パスワード"
            value={adminPass}
            onChange={(e) => setAdminPass(e.target.value)}
          />
          <button onClick={adminLogin}>管理者ログイン</button>
        </div>
      </div>
    );
  }

  // -------------------------
  // 対戦中画面
  // -------------------------
  if (deskNum) {
    return (
      <div className="container center">
        <h2>対戦中</h2>
        <p>卓番号：{deskNum}</p>
        <p>対戦相手：{opponent}</p>
        <button onClick={reportWin}>勝利報告</button>
      </div>
    );
  }

  // -------------------------
  // ユーザーメニュー画面
  // -------------------------
  return (
    <div className="container center">
      <h2>ユーザーメニュー</h2>
      <p>名前：{name}</p>

      {matchEnabled ? (
        <button onClick={findOpponent}>対戦相手を探す</button>
      ) : (
        <p>マッチング時間外です</p>
      )}

      <h3>対戦履歴</h3>
      <ul>
        {history.map((h, i) => (
          <li key={i}>
            {h.opponent}：{h.result}
          </li>
        ))}
      </ul>

      <h3>抽選当選者</h3>
      <ul>
        {lotteryList.map((w, i) => (
          <li key={i}>{w.name}</li>
        ))}
      </ul>

      {/* 管理者画面 */}
      {isAdmin && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <h3>マッチング操作</h3>
          <button onClick={enableMatch}>開始</button>
          <button onClick={disableMatch}>停止</button>

          <h3>アクティブ対戦卓</h3>
          <ul>
            {activeMatches.map((d) => (
              <li key={d.deskNum}>
                卓{d.deskNum}：{d.player1} vs {d.player2}
              </li>
            ))}
          </ul>

          <h3>抽選</h3>
          <input
            placeholder="抽選タイトル"
            value={lotteryTitle}
            onChange={(e) => setLotteryTitle(e.target.value)}
          />
          <input
            type="number"
            min="1"
            value={lotteryCount}
            onChange={(e) => setLotteryCount(e.target.value)}
          />
          <button onClick={runLottery}>抽選実行</button>

          <h3>抽選履歴</h3>
          <ul>
            {lotteryHistory.map((r, i) => (
              <li key={i}>
                {r.title}（{new Date(r.time).toLocaleString()}）
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
