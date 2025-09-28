// 既存のコードに追加・修正部分のみ抜粋

// --- データ管理 ---
let users = [];
let matches = [];
let matchEnabled = false;

io.on("connection", (socket) => {
  console.log("新しいクライアント接続:", socket.id);

  socket.emit("match_status", { enabled: matchEnabled });

  // --- ログイン ---
  socket.on("login", ({ name }) => {
    const now = new Date();
    const user = { 
      id: socket.id, 
      name, 
      history: [], 
      recentOpponents: [], 
      loginTime: now,
      searching: false       // ← 追加
    };
    users.push(user);
    socket.emit("login_ok", user);
    console.log(`${name} がログイン`);
  });

  // --- マッチング操作 ---
  socket.on("find_opponent", () => {
    if (!matchEnabled) return;
    const user = users.find(u => u.id === socket.id);
    if (!user) return;

    user.searching = true;  // 検索中

    const available = users.filter(u =>
      u.id !== socket.id &&
      u.searching &&                  // 検索中の人だけ
      !matches.some(m => m.includes(u.id)) &&
      !user.recentOpponents.includes(u.id)
    );

    if (available.length > 0) {
      const opponent = available[0];
      const match = [socket.id, opponent.id];
      matches.push(match);
      const deskNum = matches.length;

      user.recentOpponents.push(opponent.id);
      opponent.recentOpponents.push(user.id);

      // 対戦成立 → 両者検索フラグ解除
      user.searching = false;
      opponent.searching = false;

      io.to(socket.id).emit("matched", { opponent, deskNum });
      io.to(opponent.id).emit("matched", { opponent: user, deskNum });
    }
  });

  socket.on("cancel_find", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) user.searching = false;  // 検索キャンセル
  });

  // --- 勝利報告 ---
  socket.on("report_win", () => {
    const match = matches.find(m => m.includes(socket.id));
    if (!match) return;

    const opponentId = match.find(id => id !== socket.id);
    const user = users.find(u => u.id === socket.id);
    const opponent = users.find(u => u.id === opponentId);

    if (user && opponent) {
      const now = new Date();
      user.history.push({ opponent: opponent.name, result: "win", startTime: now, endTime: now });
      opponent.history.push({ opponent: user.name, result: "lose", startTime: now, endTime: now });

      // 対戦後は検索解除
      user.searching = false;
      opponent.searching = false;

      socket.emit("return_to_menu_battle");
      io.to(opponentId).emit("return_to_menu_battle");

      matches = matches.filter(m => m !== match);
    }
  });

  // --- 管理者操作 ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

});
