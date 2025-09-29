import React, { useState, useEffect } from "react";
import io from "socket.io-client";

const socket = io(); // 同一ホストのサーバーに接続

export default function App() {
  const [sessionId, setSessionId] = useState(localStorage.getItem("sessionId") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "");
  const [loggedIn, setLoggedIn] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [lotteryList, setLotteryList] = useState([]);
  const [isWinner, setIsWinner] = useState(false);

  // 管理者用
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);

  // 抽選条件
  const [drawCount, setDrawCount] = useState(1);
  const [minMatches, setMinMatches] = useState(0);
  const [minLoginTime, setMinLoginTime] = useState(0);

  // --- ソケットイベント ---
  useEffect(() => {
    socket.on("login_ok", (data) => {
      localStorage.setItem("sessionId", data.sessionId);
      localStorage.setItem("name", data.name);
      setSessionId(data.sessionId);
      setName(data.name);
      setLoggedIn(true);
      setOpponent(data.currentOpponent);
      setDeskNum(data.deskNum);
      setIsWinner(data.lotteryWinner);
      socket.emit("request_history");
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
    });

    socket.on("history", (hist) => setHistory(hist));

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    socket.on("update_lottery_list", (list) => setLotteryList(list));
    socket.on("lottery_winner", () => setIsWinner(true));

    socket.on("force_logout", () => {
      localStorage.removeItem("sessionId");
      localStorage.removeItem("name");
      setLoggedIn(false);
      setOpponent(null);
      setDeskNum(null);
      setIsAdmin(false);
      setHistory([]);
    });

    socket.on("admin_user_list", (list) => setAdminUsers(list));

    return () => {
      socket.off();
    };
  }, []);

  // --- 関数 ---
  const login = () => {
    socket.emit("login", { name, sessionId });
  };

  const logout = () => {
    socket.emit("logout");
  };

  const findOpponent = () => {
    socket.emit("find_opponent");
  };

  const cancelFind = () => {
    socket.emit("cancel_find");
  };

  const reportWin = () => {
    socket.emit("report_win");
  };

  const adminLogin = (password) => {
    socket.emit("admin_login", { password });
  };

  const toggleMatch = () => {
    socket.emit("admin_toggle_match", { enable: !matchEnabled });
  };

  const adminDraw = () => {
    socket.emit("admin_draw_lots", {
      count: drawCount,
      minMatches,
      minLoginTime,
    });
  };

  const refreshUsers = () => {
    socket.emit("admin_view_users");
  };

  const forceUnmatch = (userId) => {
    socket.emit("admin_force_unmatch", { userId });
  };

  // --- UI ---
  if (!loggedIn && !isAdmin) {
    return (
      <div className="p-4">
        <h2>ログイン</h2>
        <input
          className="border p-1 m-1"
          placeholder="ユーザー名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="border p-1 m-1" onClick={login}>
          ログイン
        </button>

        <h3 className="mt-6">管理者ログイン</h3>
        <input
          className="border p-1 m-1"
          type="password"
          placeholder="パスワード"
          onKeyDown={(e) => {
            if (e.key === "Enter") adminLogin(e.target.value);
          }}
        />
        <button
          className="border p-1 m-1"
          onClick={() => {
            const pw = prompt("管理者パスワードを入力");
            if (pw) adminLogin(pw);
          }}
        >
          管理者ログイン
        </button>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="p-4">
        <h2>管理者画面</h2>
        <button className="border p-1 m-1" onClick={toggleMatch}>
          マッチング {matchEnabled ? "停止" : "開始"}
        </button>
        <div className="mt-2">
          <h3>抽選条件</h3>
          <input
            className="border p-1 m-1"
            type="number"
            placeholder="当選数"
            value={drawCount}
            onChange={(e) => setDrawCount(Number(e.target.value))}
          />
          <input
            className="border p-1 m-1"
            type="number"
            placeholder="最低対戦数"
            value={minMatches}
            onChange={(e) => setMinMatches(Number(e.target.value))}
          />
          <input
            className="border p-1 m-1"
            type="number"
            placeholder="最低ログイン時間(分)"
            value={minLoginTime}
            onChange={(e) => setMinLoginTime(Number(e.target.value))}
          />
          <button className="border p-1 m-1" onClick={adminDraw}>
            抽選実行
          </button>
        </div>
        <div className="mt-4">
          <button className="border p-1 m-1" onClick={refreshUsers}>
            ユーザー一覧更新
          </button>
          <h3>ユーザー一覧</h3>
          {adminUsers.map((u) => (
            <div
              key={u.id}
              className="border p-1 m-1 flex justify-between items-center"
            >
              <span>
                {u.name} ({u.status})
                {u.deskNum && ` / Desk${u.deskNum}`}
              </span>
              <button
                className="border p-1 bg-red-300"
                onClick={() => forceUnmatch(u.id)}
              >
                マッチング解除
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2>ユーザーメニュー</h2>
      <div>ようこそ、{name} さん</div>
      {isWinner && (
        <div className="text-red-500 font-bold">当選しました！</div>
      )}
      <button className="border p-1 m-1" onClick={logout}>
        ログアウト
      </button>

      {!opponent && (
        <button className="border p-1 m-1" onClick={findOpponent}>
          対戦相手を探す
        </button>
      )}
      {opponent && (
        <>
          <div className="mt-2">
            対戦相手: {opponent.name} / 卓番号: {deskNum}
          </div>
          <button className="border p-1 m-1" onClick={reportWin}>
            勝利報告
          </button>
          <button className="border p-1 m-1" onClick={cancelFind}>
            対戦キャンセル
          </button>
        </>
      )}

      <div className="mt-4">
        <h3>対戦履歴</h3>
        {history.map((h, idx) => (
          <div key={idx} className="border p-1 m-1">
            {idx + 1}回目: {h.opponent} / {h.result}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <h3>当選者一覧</h3>
        {lotteryList.map((w, idx) => (
          <div key={idx} className="border p-1 m-1">
            {w.name}
          </div>
        ))}
      </div>
    </div>
  );
}
