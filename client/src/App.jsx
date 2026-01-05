import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SERVER_URL = "/";
const socket = io(SERVER_URL);

export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [name, setName] = useState("");

  const [loggedIn, setLoggedIn] = useState(false);

  // --- マッチング関係 ---
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [searching, setSearching] = useState(false);

  // --- 抽選 ---
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [currentWinners, setCurrentWinners] = useState([]);

  // --- 対戦履歴 ---
  const [history, setHistory] = useState([]);

  // --- 管理者 ---
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");

  const [adminLotteryTitle, setAdminLotteryTitle] = useState("抽選");
  const [adminLotteryCount, setAdminLotteryCount] = useState(1);

  // =========================================================
  // 初回ロード時
  // =========================================================
  useEffect(() => {
    const stored = localStorage.getItem("sessionId");
    if (stored) setSessionId(stored);
  }, []);

  // =========================================================
  // ソケット受信ハンドラ登録
  // =========================================================
  useEffect(() => {

    // ログイン成功
    socket.on("login_ok", (u) => {
      setLoggedIn(true);
      setSessionId(u.sessionId);
      setHistory(u.history || []);

      localStorage.setItem("sessionId", u.sessionId);
    });

    // 旧形式の初期通知
    socket.on("match_status", ({ enabled }) => {
      setMatchEnabled(enabled);
      setSearching(false);
    });

    // NEW：管理者操作のリアルタイム更新
    socket.on("match_status_update", ({ enabled }) => {
      setMatchEnabled(enabled);
      setSearching(false);
    });

    // 対戦履歴更新
    socket.on("history", (h) => setHistory(h));

    // 検索開始OK
    socket.on("matched", () => setSearching(false));

    // 抽選：最新当選リスト
    socket.on("update_lottery_list", ({ list }) => {
      setCurrentWinners(list || []);
    });

    // 管理者：抽選履歴
    socket.on("admin_lottery_history", (list) => {
      setLotteryHistory(list || []);
    });

    // 管理者：抽選結果
    socket.on("admin_lottery_result", ({ title, winners }) => {
      setLotteryHistory((prev) => [
        ...prev,
        { title, winners, time: Date.now() }
      ]);
    });

    // 当選者へトースト
    socket.on("lottery_winner", ({ title }) => {
      alert(`🎉「${title}」に当選しました！`);
    });

    return () => {
      socket.off("login_ok");
      socket.off("match_status");
      socket.off("match_status_update");
      socket.off("history");
      socket.off("matched");
      socket.off("update_lottery_list");
      socket.off("admin_lottery_history");
      socket.off("admin_lottery_result");
      socket.off("lottery_winner");
    };
  }, []);

  // =========================================================
  // ログイン
  // =========================================================
  const handleLogin = () => {
    if (!name.trim()) return;

    socket.emit("login", {
      name,
      sessionId
    });
  };

  // =========================================================
  // マッチング操作（ユーザー）
  // =========================================================
  const startFind = () => {
    setSearching(true);
    socket.emit("find_opponent");
  };

  const cancelFind = () => {
    setSearching(false);
    socket.emit("cancel_find");
  };

  // =========================================================
  // 管理者ログイン
  // =========================================================
  const adminLogin = () => {
    socket.emit("admin_login", { password: adminPassword });
  };

  // =========================================================
  // 管理者：マッチング開始 / 停止
  // =========================================================
  const toggleMatch = (enable) => {
    socket.emit("admin_toggle_match", { enable });
  };

  // =========================================================
  // 管理者：抽選実行
  // =========================================================
  const runLottery = () => {
    socket.emit("admin_draw_lots", {
      title: adminLotteryTitle,
      count: Number(adminLotteryCount)
    });
  };

  // =========================================================
  // UI
  // =========================================================

  if (!loggedIn)
    return (
      <div className="login-screen">

        {/* 管理者ログイン（右上） */}
        <div className="admin-login-topright">
          <input
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="管理者PASS"
          />
          <button onClick={adminLogin}>管理</button>
        </div>

        <div className="user-login-center">
          <h2>ユーザーログイン</h2>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ユーザー名"
          />

          <button className="main-btn" onClick={handleLogin}>
            ログイン
          </button>
        </div>
      </div>
    );

  // =========================================================
  // ここからユーザーメニュー
  // =========================================================
  return (
    <div className="menu-screen">

      <div className="header">対戦マッチングサイト</div>

      {/* ======== マッチングボタン ======== */}
      {matchEnabled ? (
        searching ? (
          <button className="main-btn" onClick={cancelFind}>
            対戦相手を探しています…（キャンセル）
          </button>
        ) : (
          <button className="main-btn" onClick={startFind}>
            対戦相手を探す
          </button>
        )
      ) : (
        <p>マッチング時間外です</p>
      )}

      {/* ======== 当選者 ======== */}
      {currentWinners.length > 0 && (
        <div className="lottery-list">
          <h3>🎉 最新抽選 当選者</h3>
          {currentWinners.map((w, i) => (
            <div key={i}>{w.name}</div>
          ))}
        </div>
      )}

      {/* ======== 対戦履歴 ======== */}
      <div className="history-list">
        <table>
          <thead>
            <tr>
              <th>相手</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td>{h.opponent}</td>
                <td className={h.result === "WIN" ? "win" : "lose"}>
                  {h.result}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* =====================================================
            管理者モード（ログイン済のみ表示）
      ===================================================== */}
      {adminMode && (
        <div className="admin-screen">

          <div className="admin-section">
            <h3>マッチング操作</h3>

            <p>
              現在：{matchEnabled ? "🟢 マッチング中" : "🔴 停止中"}
            </p>

            <button
              className="admin-btn"
              onClick={() => toggleMatch(true)}
            >
              マッチング開始
            </button>

            <button
              className="admin-btn"
              onClick={() => toggleMatch(false)}
            >
              マッチング停止
            </button>
          </div>

          <div className="admin-section">
            <h3>抽選機能</h3>

            <input
              value={adminLotteryTitle}
              onChange={(e) => setAdminLotteryTitle(e.target.value)}
              placeholder="抽選タイトル"
            />

            <input
              type="number"
              value={adminLotteryCount}
              onChange={(e) => setAdminLotteryCount(e.target.value)}
            />

            <button className="admin-btn" onClick={runLottery}>
              抽選実行
            </button>

            <div className="lottery-list">
              <h4>抽選履歴</h4>
              <ul>
                {lotteryHistory.map((rec, i) => (
                  <li key={i}>
                    {rec.title}：
                    {rec.winners.map((w) => w.name).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
